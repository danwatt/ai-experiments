"""Read an OSM file and keep what the planner needs.

    extract(path) -> Extract(pois, seasonal_ways)

A "poi" is one thing on the map: a rest area, an exit, a gas station, a
restaurant, a motel, a town. Each has a `kind`:

    rest_area, service_plaza   highway=rest_area, highway=services
    exit                       highway=motorway_junction (ref, name)
    fuel                       amenity=fuel
    food                       amenity=restaurant, fast_food, cafe
    lodging                    tourism=hotel, motel, guest_house
    place                      place=city, town, village, hamlet (+ population)

Features can be nodes or closed ways (a motel drawn as a building outline).
A way becomes one point, the average of its corners, which is close enough to
a centroid for buildings and parking lots.

Seasonal ways are a second, separate list: every road with `seasonal=*` or a
`*:conditional` access tag. Valhalla does not enforce all of those (Trail
Ridge Road, phase 0), so the API checks routes against this list itself.
"""

from dataclasses import dataclass, field
from pathlib import Path

import osmium

# (tag key, tag value) -> (kind, subkind)
TAG_KINDS = {
    ("highway", "rest_area"): ("rest_area", "rest_area"),
    ("highway", "services"): ("service_plaza", "services"),
    ("highway", "motorway_junction"): ("exit", "exit"),
    ("amenity", "fuel"): ("fuel", "fuel"),
    ("amenity", "restaurant"): ("food", "restaurant"),
    ("amenity", "fast_food"): ("food", "fast_food"),
    ("amenity", "cafe"): ("food", "cafe"),
    ("tourism", "hotel"): ("lodging", "hotel"),
    ("tourism", "motel"): ("lodging", "motel"),
    ("tourism", "guest_house"): ("lodging", "guest_house"),
    ("place", "city"): ("place", "city"),
    ("place", "town"): ("place", "town"),
    ("place", "village"): ("place", "village"),
    ("place", "hamlet"): ("place", "hamlet"),
}

# Tag keys that make an object worth looking at; everything else is skipped by
# osmium before Python sees it.
INTERESTING_KEYS = ("highway", "amenity", "tourism", "place")

# Ways with these highway values carry the road's own ref ("I 70"), which is
# how an exit learns which road it is on.
MAINLINE = ("motorway", "trunk")

# Access tags whose conditional form can close a road to cars.
ACCESS_KEYS = ("access", "motor_vehicle", "vehicle", "motorcar")


@dataclass
class Poi:
    kind: str
    subkind: str
    name: str
    lat: float
    lon: float
    osm_type: str  # "n" or "w"
    osm_id: int
    brand: str = ""
    cuisine: str = ""
    ref: str = ""  # exit number
    road: str = ""  # for an exit: the road it is on, "I 70"
    toilets: bool | None = None
    picnic: bool | None = None
    population: int | None = None


@dataclass
class SeasonalWay:
    way_id: int
    highway: str
    name: str
    ref: str
    tags: str  # the closure tags on one line, " | " between them: "access:conditional=no @ ... | seasonal=winter"
    lat: float
    lon: float


@dataclass
class Extract:
    pois: list[Poi] = field(default_factory=list)
    seasonal_ways: list[SeasonalWay] = field(default_factory=list)


def classify(tags) -> tuple[str, str] | None:
    """(kind, subkind) for a tagged object, or None if it is not one we keep."""
    for key in INTERESTING_KEYS:
        value = tags.get(key)
        if value is not None and (key, value) in TAG_KINDS:
            return TAG_KINDS[(key, value)]
    return None


def yes_no(value: str | None) -> bool | None:
    """OSM yes/no tag -> True / False, None when untagged or unclear."""
    if value in ("yes", "designated"):
        return True
    if value == "no":
        return False
    return None


def parse_int(value: str | None) -> int | None:
    """Population is sometimes "1,234" or "about 900"; keep the leading digits."""
    if not value:
        return None
    digits = "".join(ch for ch in value.replace(",", "").split(" ")[0] if ch.isdigit())
    return int(digits) if digits else None


def poi_from_tags(tags, kind: str, subkind: str, lat: float, lon: float, osm_type: str, osm_id: int) -> Poi:
    """Build a Poi from an object's tags."""
    name = tags.get("name") or ""
    if kind == "exit":
        name = name or tags.get("exit_to", "")
    return Poi(
        kind=kind,
        subkind=subkind,
        name=name,
        lat=round(lat, 6),
        lon=round(lon, 6),
        osm_type=osm_type,
        osm_id=osm_id,
        brand=(tags.get("brand") or tags.get("operator") or "") if kind in ("fuel", "food", "lodging") else "",
        cuisine=tags.get("cuisine", "") if kind == "food" else "",
        ref=tags.get("ref", "") if kind == "exit" else "",
        toilets=yes_no(tags.get("toilets")) if kind in ("rest_area", "service_plaza") else None,
        picnic=yes_no(tags.get("picnic_table") or tags.get("picnic")) if kind in ("rest_area", "service_plaza") else None,
        population=parse_int(tags.get("population")) if kind == "place" else None,
    )


def closure_tags(tags) -> str:
    """The seasonal / conditional-access tags of a road, as one line.

    "" when the road has none. Values are kept exactly as written in OSM
    (Trail Ridge's "no @ Oct 14th - May 31st" is not valid OSM syntax, so
    nothing here tries to understand it).
    """
    parts = []
    seasonal = tags.get("seasonal")
    if seasonal and seasonal != "no":
        parts.append(f"seasonal={seasonal}")
    for key in ACCESS_KEYS:
        value = tags.get(f"{key}:conditional")
        if value:
            parts.append(f"{key}:conditional={value}")
    return " | ".join(parts)


def way_center(way) -> tuple[float, float] | None:
    """Average of a way's corners, or None if the file lacks their locations."""
    lats, lons = [], []
    for node in way.nodes:
        try:
            loc = node.location
            if loc.valid():
                lats.append(loc.lat)
                lons.append(loc.lon)
        except osmium.InvalidLocationError:
            continue
    if not lats:
        return None
    # A closed way repeats its first corner at the end.
    if way.is_closed() and len(lats) > 1:
        lats, lons = lats[:-1], lons[:-1]
    return sum(lats) / len(lats), sum(lons) / len(lons)


def extract(path: str | Path) -> Extract:
    """Read the file once and return everything we keep."""
    out = Extract()
    exit_nodes: dict[int, Poi] = {}  # node id -> its exit, to learn the road later

    # with_locations() first, so ways know where their corners are; the key
    # filter then drops the other 99 % of the file before Python sees it.
    processor = osmium.FileProcessor(str(path)).with_locations().with_filter(osmium.filter.KeyFilter(*INTERESTING_KEYS))
    for obj in processor:
        tags = obj.tags
        if obj.is_node():
            found = classify(tags)
            if found and obj.location.valid():
                poi = poi_from_tags(tags, *found, obj.location.lat, obj.location.lon, "n", obj.id)
                out.pois.append(poi)
                if poi.kind == "exit":
                    exit_nodes[obj.id] = poi
        elif obj.is_way():
            highway = tags.get("highway")
            if highway:
                closed = closure_tags(tags)
                if closed and (centre := way_center(obj)):
                    out.seasonal_ways.append(
                        SeasonalWay(obj.id, highway, tags.get("name", ""), tags.get("ref", ""), closed, round(centre[0], 6), round(centre[1], 6))
                    )
                if highway in MAINLINE and exit_nodes:
                    ref = tags.get("ref", "")
                    if ref:
                        for node in obj.nodes:
                            if node.ref in exit_nodes and not exit_nodes[node.ref].road:
                                exit_nodes[node.ref].road = ref.split(";")[0]
            found = classify(tags)
            # Lines are only kept for rest areas and plazas; every other kind
            # must be an outline (a building or a lot).
            if found and (obj.is_closed() or found[0] in ("rest_area", "service_plaza")) and (centre := way_center(obj)):
                out.pois.append(poi_from_tags(tags, *found, centre[0], centre[1], "w", obj.id))
    return out
