"""The zone library: zones shared by every trip, in `trips/zones.json`.

A trip does not copy library zones. Its file lists the ids that are switched
on (`library_on`), and the page puts the library zone's shape and type
together with the trip's own switch when it loads the trip. A zone that
belongs to one trip only lives in that trip's file.

The first time the library is read and no file exists, it starts from
`examples/zones.json` (the four zones of the Colorado loop plus three more),
so the example trips work from the start. That file is not written back
until the user changes the library.

GeoJSON in and out: a FeatureCollection of Polygons (a MultiPolygon becomes
one zone per polygon; holes are dropped), with `name` and `type` in each
feature's properties.
"""

import uuid
from pathlib import Path

from pydantic import BaseModel, ValidationError

from . import trips
from .models import Zone, ZoneType
from .trips import TripError

TYPES = ("avoid", "no_stops", "no_meals", "no_overnight", "prefer")
ALIASES = {  # spellings other tools use
    "no-stops": "no_stops", "nostops": "no_stops", "no stops": "no_stops",
    "no-meals": "no_meals", "nomeals": "no_meals", "no meals": "no_meals",
    "no-overnight": "no_overnight", "no overnight": "no_overnight", "no-stay": "no_overnight",
    "prefer stops": "prefer", "preferred": "prefer", "prefer-stops": "prefer",
}


class Library(BaseModel):
    version: int = trips.VERSION
    zones: list[Zone] = []


def path() -> Path:
    return trips.TRIPS_DIR / "zones.json"


def seed_path() -> Path:
    return trips.EXAMPLES_DIR / "zones.json"


def parse(data: object) -> Library:
    if not isinstance(data, dict):
        raise TripError("The zone library file is not a JSON object.")
    if data.get("version", 1) > trips.VERSION:
        raise TripError("The zone library is from a newer version of the app.")
    try:
        lib = Library.model_validate(data)
    except ValidationError as exc:
        err = exc.errors()[0]
        raise TripError(f"The zone library is not valid at {'.'.join(str(x) for x in err['loc'])}: {err['msg']}.") from exc
    ids = [z.id for z in lib.zones]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise TripError(f"The zone library has the id {dupes[0]} twice.")
    return lib


def read() -> dict:
    """{zones, seeded}. `seeded` is true while the library is still the example one (no file yet)."""
    if path().exists():
        lib, seeded = parse(trips.read_json(path(), "zone library")), False
    elif seed_path().exists():
        lib, seeded = parse(trips.read_json(seed_path(), "example zone library")), True
    else:
        lib, seeded = Library(), True
    return {"zones": [clean(z) for z in lib.zones], "seeded": seeded}


def clean(zone: Zone) -> dict:
    """A zone as the library keeps it: the switch belongs to the trip, not to the library."""
    out = zone.model_dump(mode="json")
    out.pop("enabled")
    return out


def write(zones: list[dict]) -> dict:
    """Replace the whole library. Returns what is stored."""
    lib = parse({"zones": zones})
    trips.write_json(path(), {"version": trips.VERSION, "zones": [clean(z) for z in lib.zones]})
    return read()


# ---------- GeoJSON ----------


def to_geojson(zones: list[dict | Zone]) -> dict:
    """A FeatureCollection with one Polygon per zone."""
    features = []
    for z in zones:
        z = z if isinstance(z, dict) else z.model_dump(mode="json")
        features.append({
            "type": "Feature",
            "id": z["id"],
            "properties": {"name": z.get("name", ""), "type": z.get("type", "avoid"), "shape": z.get("shape", "polygon")},
            "geometry": {"type": "Polygon", "coordinates": [closed([list(p) for p in z["ring"]])]},
        })
    return {"type": "FeatureCollection", "features": features}


def closed(ring: list[list[float]]) -> list[list[float]]:
    return ring if ring[0] == ring[-1] else [*ring, ring[0]]


def zone_type(value: object) -> ZoneType:
    text = str(value or "avoid").strip().lower()
    text = ALIASES.get(text, text)
    if text not in TYPES:
        raise TripError(f"Unknown zone type “{value}”. Use one of: {', '.join(TYPES)}.")
    return text  # type: ignore[return-value]


def is_box(ring: list[list[float]]) -> bool:
    """A closed four-corner ring with sides along the compass: a rectangle."""
    if len(ring) != 5:
        return False
    xs, ys = sorted({round(p[0], 7) for p in ring}), sorted({round(p[1], 7) for p in ring})
    return len(xs) == 2 and len(ys) == 2


def from_geojson(data: object) -> list[Zone]:
    """The polygons in a GeoJSON document as new zones (fresh ids, switched on)."""
    if not isinstance(data, dict):
        raise TripError("That is not GeoJSON: expected a JSON object.")
    kind = data.get("type")
    if kind == "FeatureCollection":
        features = data.get("features") or []
    elif kind == "Feature":
        features = [data]
    elif kind in ("Polygon", "MultiPolygon"):
        features = [{"type": "Feature", "properties": {}, "geometry": data}]
    else:
        raise TripError("That is not GeoJSON polygons: expected a FeatureCollection, a Feature or a Polygon.")
    out: list[Zone] = []
    for n, f in enumerate(features, start=1):
        geom = (f or {}).get("geometry") or {}
        props = (f or {}).get("properties") or {}
        polygons = [geom["coordinates"]] if geom.get("type") == "Polygon" else geom.get("coordinates") if geom.get("type") == "MultiPolygon" else []
        for k, poly in enumerate(polygons, start=1):
            if not poly:
                continue
            ring = closed([[float(p[0]), float(p[1])] for p in poly[0]])  # the outer ring; holes are dropped
            if len(ring) < 4:
                raise TripError(f"Feature {n} has a polygon with fewer than 3 corners.")
            name = str(props.get("name") or props.get("Name") or props.get("title") or "").strip() or f"Imported zone {len(out) + 1}"
            if len(polygons) > 1:
                name += f" ({k})"
            try:
                out.append(Zone(id=uuid.uuid4().hex[:8], name=name, type=zone_type(props.get("type")), ring=[tuple(p) for p in ring],
                                shape="rectangle" if is_box(ring) else "polygon"))
            except ValidationError as exc:
                raise TripError(f"Feature {n} is not a usable zone: {exc.errors()[0]['msg']}.") from exc
    if not out:
        raise TripError("No polygons found in that GeoJSON.")
    return out


def import_geojson(data: object) -> dict:
    """Add the polygons of a GeoJSON document to the library. Returns {library, added}."""
    new = from_geojson(data)
    cur = read()["zones"]
    lib = write(cur + [clean(z) for z in new])
    return {"library": lib, "added": [clean(z) for z in new]}
