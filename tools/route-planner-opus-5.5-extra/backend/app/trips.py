"""Trip files: plain JSON in `trips/<slug>.json`, and the settings new trips start from.

    trips/colorado-loop.json     one trip (the whole of the page's `state.trip`, see TripFile)
    trips/zones.json             the zone library, shared by every trip (library.py)
    trips/defaults.json          the settings a new trip starts from (TripSettings)
    examples/*.json              two example trips, committed and read-only

A trip file is what the page keeps in `state.trip`, with two differences:
zones that live in the library are not copied into the file (the file lists
the ids that are switched on in `library_on`), and the server adds `version`,
`saved_at`. Everything is validated with the pydantic models below on the way
in and on the way out, so a file written by an older version of the app loads
with the newer fields at their defaults, and a damaged file gives an error
that names the field.

Writes go to a temporary file in the same folder and are renamed into place,
so a crash never leaves half a trip behind.
"""

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from .models import (
    BreakSettings, DaySettings, FuelSettings, LodgingSettings, MealSettings, RoadOptions, StopRef, Waypoint, Zone,
)

TRIPS_DIR = Path(os.environ.get("TRIPS_DIR", "/trips"))
EXAMPLES_DIR = Path(os.environ.get("EXAMPLES_DIR", "/examples"))

VERSION = 1  # bump when a field changes meaning, and add a step to MIGRATIONS
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
# Files that share the folder with the trips and so cannot be trip ids.
RESERVED = {"zones", "defaults"}


class TripError(Exception):
    """A problem with a trip file or an id that the user can fix. `status` is the HTTP code."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------- the file ----------


class TripDays(DaySettings):
    """The day settings, plus when a day starts (PlanRequest.day_start)."""

    start: str = "08:00"


class TripBreaks(BaseModel):
    """Everything the break planner reads, as the page keeps it in `trip.breaks`."""

    settings: BreakSettings = BreakSettings()
    meals: MealSettings = MealSettings()
    fuel: FuelSettings = FuelSettings()
    days: TripDays = TripDays()
    lodging: LodgingSettings = LodgingSettings()
    warn_closures: bool = True
    pins: list[StopRef] = []
    skips: list[StopRef] = []


class TripSummary(BaseModel):
    """What the page knew about the route when it saved: for the trip picker's list."""

    miles: float | None = None
    driving_minutes: float | None = None
    days: int | None = None
    arrive: str | None = None  # local, "2027-09-29T17:05"


class TripSettings(BaseModel):
    """The settings a new trip starts from (`trips/defaults.json`): everything in a trip except its places."""

    version: int = VERSION
    pace: float = Field(default=1.05, ge=0.5, le=2.0)
    search_miles: float = Field(default=2.0, ge=0.5, le=10)
    options: RoadOptions = RoadOptions()
    breaks: TripBreaks = TripBreaks()


class TripFile(TripSettings):
    name: str = "Untitled trip"
    saved_at: str | None = None
    depart: str | None = None  # local, "2027-09-25T08:00"
    waypoints: list[Waypoint] = []
    zones: list[Zone] = []  # zones for this trip only
    library_on: list[str] = []  # ids of the library zones that are switched on for this trip
    summary: TripSummary | None = None


# ---------- reading and checking ----------

# Steps from an older file version to the next: {old version: function(dict) -> dict}.
# There is only version 1 so far. A step goes here the day a field changes meaning.
MIGRATIONS: dict[int, object] = {}


def parse(data: object, what: str = "trip", model=TripFile):
    """Check a loaded JSON document and return it as `model`, with defaults filled in."""
    if not isinstance(data, dict):
        raise TripError(f"The {what} file is not a JSON object.")
    version = data.get("version", 1)
    if not isinstance(version, int) or version < 1:
        raise TripError(f"The {what} file has a bad version: {version!r}.")
    if version > VERSION:
        raise TripError(f"The {what} file is from a newer version of the app (file version {version}, this app reads up to {VERSION}).")
    while version < VERSION:
        data = MIGRATIONS[version](data)
        version += 1
    try:
        return model.model_validate({**data, "version": VERSION})
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(x) for x in err["loc"])
        raise TripError(f"The {what} file is not valid at {where}: {err['msg']}.") from exc


def check_id(trip_id: str) -> str:
    """Only plain slugs are ids: lower-case letters, digits and hyphens. That keeps a
    request from naming a path outside the trips folder."""
    if not isinstance(trip_id, str) or not SLUG.match(trip_id) or trip_id in RESERVED:
        raise TripError(f"“{trip_id}” is not a usable trip id: use lower-case letters, digits and hyphens, starting with a letter or digit.", 400)
    return trip_id


def slugify(name: str, taken: set[str] = frozenset()) -> str:
    """'Colorado loop!' -> 'colorado-loop'; adds -2, -3 ... until the id is free."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48].strip("-") or "trip"
    if base in RESERVED:
        base += "-trip"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


PAIR = re.compile(r"\[\s+(-?\d[\d.eE+-]*),\s+(-?\d[\d.eE+-]*)\s+\]")


def dumps(doc: dict) -> str:
    """Indented JSON, with each [lon, lat] pair of a zone's ring on one line so a file reads like a list of points."""
    return PAIR.sub(r"[\1, \2]", json.dumps(doc, indent=2, ensure_ascii=False)) + "\n"


def write_json(path: Path, doc: dict) -> None:
    """Write through a temporary file in the same folder, then rename it into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(dumps(doc))
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)  # mkstemp makes it private; trips are the user's own files
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_json(path: Path, what: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TripError(f"The {what} file is damaged (not JSON): {exc}.") from exc


# ---------- trips ----------


def trip_path(trip_id: str) -> Path:
    return TRIPS_DIR / f"{check_id(trip_id)}.json"


def read(trip_id: str) -> dict:
    """A saved trip, checked, with every field present."""
    path = trip_path(trip_id)
    if not path.exists():
        raise TripError(f"There is no saved trip called “{trip_id}”.", 404)
    return parse(read_json(path, "trip")).model_dump(mode="json")


def write(trip_id: str, doc: dict) -> dict:
    """Check and save a trip; returns what was written (with `saved_at`)."""
    trip = parse(doc)
    trip.saved_at = now_utc()
    out = trip.model_dump(mode="json")
    write_json(trip_path(trip_id), out)
    return out


def delete(trip_id: str) -> None:
    path = trip_path(trip_id)
    if not path.exists():
        raise TripError(f"There is no saved trip called “{trip_id}”.", 404)
    path.unlink()


def listing_entry(trip_id: str, doc: dict) -> dict:
    s = doc.get("summary") or {}
    depart = doc.get("depart")
    return {
        "id": trip_id, "name": doc["name"], "depart": depart, "arrive": s.get("arrive"), "miles": s.get("miles"),
        "days": s.get("days"), "waypoints": len(doc["waypoints"]), "saved_at": doc.get("saved_at"),
    }


def list_folder(folder: Path) -> list[dict]:
    """Every trip in a folder, newest saved first. A file that cannot be read is listed with an `error`."""
    out = []
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        trip_id = path.stem
        if trip_id in RESERVED or not SLUG.match(trip_id):
            continue
        try:
            out.append(listing_entry(trip_id, parse(read_json(path, "trip")).model_dump(mode="json")))
        except TripError as exc:
            out.append({"id": trip_id, "name": trip_id, "error": exc.message})
    return sorted(out, key=lambda e: e.get("saved_at") or "", reverse=True)


def listing() -> list[dict]:
    return list_folder(TRIPS_DIR)


# ---------- examples ----------


def examples() -> list[dict]:
    return sorted(list_folder(EXAMPLES_DIR), key=lambda e: e["name"])


def read_example(example_id: str) -> dict:
    path = EXAMPLES_DIR / f"{check_id(example_id)}.json"
    if not path.exists():
        raise TripError(f"There is no example called “{example_id}”.", 404)
    return parse(read_json(path, "example")).model_dump(mode="json")


def copy_example(example_id: str) -> tuple[str, dict]:
    """Copy an example into the user's trips under a free id. Returns (id, trip)."""
    doc = read_example(example_id)
    taken = {e["id"] for e in listing()}
    new_id = slugify(doc["name"], taken)
    return new_id, write(new_id, doc)


# ---------- defaults for new trips ----------


def defaults_path() -> Path:
    return TRIPS_DIR / "defaults.json"


def read_defaults() -> dict:
    path = defaults_path()
    doc = parse(read_json(path, "defaults"), "defaults", TripSettings) if path.exists() else TripSettings()
    out = doc.model_dump(mode="json")
    out["breaks"].pop("pins")
    out["breaks"].pop("skips")
    return out


def write_defaults(doc: dict) -> dict:
    settings = parse({**doc, "breaks": {**(doc.get("breaks") or {}), "pins": [], "skips": []}}, "defaults", TripSettings)
    out = settings.model_dump(mode="json")
    write_json(defaults_path(), out)
    return read_defaults()
