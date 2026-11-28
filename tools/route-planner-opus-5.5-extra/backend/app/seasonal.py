"""Warn when a route uses a road that is closed for part of the year.

Valhalla does not enforce every seasonal closure (Trail Ridge Road's dates are
written as "Oct 14th - May 31st", which no parser takes), so the importer keeps
the OSM way id of every road with `seasonal=*` or a conditional access tag
(pois/extract.py), and this module checks the route against that list:

1. cut the route into chunks Valhalla's /trace_attributes accepts (200 km),
2. ask Valhalla which OSM ways each chunk follows,
3. look those ids up in the `seasonal_ways` table,
4. one warning per road, with the tag text as OSM has it.

The text is shown exactly as written. Dates are only understood when they look
like "Oct 14 - May 31"; the trip's own dates then say whether the road is
closed, open, or worth checking.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import httpx

from . import valhalla
from .geometry import haversine_m
from .pois import db

CHUNK_M = 120_000  # Valhalla's limit is 200 km
CHUNK_POINTS = 6_000  # and 16000 points
MIN_SPACING_M = 25  # thin the shape: a point every 25 m is plenty to follow a road

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# "Oct 14th - May 31st", "Nov 15-May 15", "Oct 14 to May 31"
RANGE = re.compile(
    r"([A-Za-z]{3,9})\.?\s*(\d{1,2}(?:st|nd|rd|th)?)\s*(?:-|–|—|to|through|thru)\s*([A-Za-z]{3,9})\.?\s*(\d{1,2}(?:st|nd|rd|th)?)"
)
# What a conditional tag says happens: "no @ (...)", "private @ ..."
CONDITION = re.compile(r"^(?P<key>[a-z_]+(?::conditional)?)=(?P<value>[a-z_]+)\s*@\s*(?P<when>.*)$")
CLOSED_VALUES = {"no", "private"}
TIME_OF_DAY = re.compile(r"\d{1,2}:\d{2}")


def chunks(points: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Cut a (lat, lon) line into pieces under Valhalla's trace limits.

    First thins the line to one point per MIN_SPACING_M. Pieces share their
    joining point, so no road between two pieces is missed.
    """
    thin = [points[0]]
    for p in points[1:-1]:
        if haversine_m(thin[-1], p) >= MIN_SPACING_M:
            thin.append(p)
    thin.append(points[-1])

    out, current, length = [], [thin[0]], 0.0
    for p in thin[1:]:
        length += haversine_m(current[-1], p)
        current.append(p)
        if length >= CHUNK_M or len(current) >= CHUNK_POINTS:
            out.append(current)
            current, length = [p], 0.0
    if len(current) > 1:
        out.append(current)
    return out


def route_way_ids(points: list[tuple[float, float]], client: httpx.Client | None = None) -> set[int]:
    """OSM way ids of every road the route follows."""
    pieces = chunks(points)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = pool.map(lambda piece: valhalla.trace_way_ids(piece, client=client), pieces)
        return set().union(*results)


def parse_range(text: str) -> tuple[tuple[int, int], tuple[int, int], str] | None:
    """((month, day) start, (month, day) end, 'Oct 14th – May 31st') for the first date range in a tag."""
    for m in RANGE.finditer(text):
        a, b = m.group(1)[:3].lower(), m.group(3)[:3].lower()
        if a in MONTHS and b in MONTHS:
            start = (MONTHS[a], int(re.sub(r"\D", "", m.group(2))))
            end = (MONTHS[b], int(re.sub(r"\D", "", m.group(4))))
            return start, end, f"{m.group(1)} {m.group(2)} – {m.group(3)} {m.group(4)}"
    return None


def names_a_month(text: str) -> bool:
    return any(word[:3].lower() in MONTHS for word in re.findall(r"[A-Za-z]{3,}", text))


def in_range(day: date, start: tuple[int, int], end: tuple[int, int]) -> bool:
    """Is the date inside a yearly range? Ranges may wrap the new year (Oct 14 – May 31)."""
    md = (day.month, day.day)
    return start <= md <= end if start <= end else md >= start or md <= end


def trip_days(depart: str | None, total_minutes: float, extra_days: int) -> list[date] | None:
    """The dates a trip may touch: from departure, one per day of driving at
    8 h a day, plus the days spent staying put. None without a departure date.

    This is a guess until phase 4 plans real days; it only decides how sure a
    warning sounds.
    """
    if not depart:
        return None
    first = date.fromisoformat(depart[:10])
    driving_days = max(1, -(-int(total_minutes) // 480))
    return [first + timedelta(days=i) for i in range(driving_days + extra_days)]


def assess(rows: list[dict], total_minutes: float, depart: str | None, extra_days: int = 0) -> list[dict]:
    """Turn the matching `seasonal_ways` rows into one warning per road.

    Each warning: road, ref, tags (raw text), range (nice text or None), level
    ("closed" on your dates, "check" when the dates are unclear or partly
    inside, "open" when the road is seasonal but open on your dates), message,
    ways (how many OSM ways), lat/lon (a place on the road, for the caller to
    place it on the route).
    """
    days = trip_days(depart, total_minutes, extra_days)
    verdicts: dict[str, tuple[str, str | None] | None] = {}  # tags -> (level, nice range)
    groups: dict[tuple[str, str], list[dict]] = {}  # (road, level) -> ways
    for row in rows:
        tags = row["tags"]
        if tags not in verdicts:
            verdicts[tags] = verdict_for(tags, days)
        if verdicts[tags] is None:
            continue  # only a time-of-day rule, such as a night closure
        road = row["name"] or row["ref"] or "Unnamed road"
        groups.setdefault((road, verdicts[tags][0]), []).append(row)

    out = []
    for (road, level), ways in groups.items():
        # One road, one warning. The ways can carry slightly different dates
        # ("Oct 14th" on most of Trail Ridge, "Oct 1" on one piece): say what
        # most of them say.
        tags = max({w["tags"] for w in ways}, key=lambda t: sum(w["tags"] == t for w in ways))
        rng = verdicts[tags][1]
        out.append(
            {
                "road": road,
                "ref": ways[0]["ref"],
                "tags": tags,
                "range": rng,
                "level": level,
                "message": message(road, tags, rng, level, days),
                "ways": len(ways),
                "points": [(w["lat"], w["lon"]) for w in ways],
            }
        )
    order = {"closed": 0, "check": 1, "open": 2}
    return sorted(out, key=lambda w: (order[w["level"]], w["road"]))


def verdict_for(tags: str, days: list[date] | None) -> tuple[str, str | None] | None:
    """(level, nice date range) for one road's tags, or None if not worth a warning."""
    conditional = False
    for part in tags.split(" | "):
        m = CONDITION.match(part)
        if not m or m["value"] not in CLOSED_VALUES:
            continue
        rng = parse_range(m["when"])
        if rng:
            start, end, text = rng
            if days is None:
                return "check", text
            inside = [in_range(d, start, end) for d in days]
            level = "closed" if all(inside) else "open" if not any(inside) else "check"
            return level, text
        if TIME_OF_DAY.search(m["when"]) and not names_a_month(m["when"]):
            continue  # "no @ (22:00-06:00)": a night rule, not a season
        conditional = True
    if any(p.startswith("seasonal=") for p in tags.split(" | ")):
        return "check", None
    return ("check", None) if conditional else None


def message(road: str, tags: str, rng: str | None, level: str, days: list[date] | None) -> str:
    """One line for the itinerary and the status bar."""
    what = f"closed {rng}" if rng else f"seasonal road ({tags})"
    if days:
        span = f"{days[0]:%b} {days[0].day}" + (f" – {days[-1]:%b} {days[-1].day}" if len(days) > 1 else "")
    else:
        span = ""
    if level == "closed":
        return f"{road}: {what}. Your trip ({span}) is inside those dates."
    if level == "open":
        return f"{road}: {what}. Open on your dates ({span})."
    return f"{road}: {what}. Check dates."


def check(
    points: list[tuple[float, float]],
    total_minutes: float,
    depart: str | None,
    extra_days: int,
    con,
    client: httpx.Client | None = None,
) -> list[dict]:
    """Closure warnings for a route (a (lat, lon) line)."""
    ids = route_way_ids(points, client)
    rows = db.seasonal_by_ids(con, sorted(ids))
    return assess(rows, total_minutes, depart, extra_days)


# ---------- phase 4: "avoid this road" ----------

AVOID_PAD_M = 400  # how far the avoid zone reaches around the closed road's ways
AVOID_SIMPLIFY_M = 150


def avoid_ring(points: list[tuple[float, float]]) -> list[list[float]] | None:
    """A ring of [lon, lat] around a closed road, for an avoid zone.

    `points` are (lat, lon) places on the road's ways (one per OSM way). The
    ring is a tight hull around them, padded by AVOID_PAD_M and simplified,
    so Valhalla's exclude_polygons cut every way of the road and little else.
    Valhalla drops any edge that touches the polygon, so the ways' own
    middles are enough to block the road. None for an empty list.
    """
    import shapely
    from shapely.geometry import MultiPoint

    from .geometry import LocalProjection

    if not points:
        return None
    proj = LocalProjection(sum(p[0] for p in points) / len(points))
    cloud = MultiPoint([proj.xy(lat, lon) for lat, lon in points])
    shape = shapely.concave_hull(cloud, ratio=0.3).buffer(AVOID_PAD_M).simplify(AVOID_SIMPLIFY_M)
    if shape.geom_type != "Polygon":
        shape = shape.convex_hull
    ring = [list(reversed([round(v, 6) for v in proj.latlon(x, y)])) for x, y in shape.exterior.coords]
    return ring
