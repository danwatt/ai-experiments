"""Turn a trip into one Valhalla /route request, and its answer into a route.

    plan_route(request) -> dict

1. Check the zones (zones.py). A bad zone stops here with a ZoneError.
2. build_request(): waypoints become Valhalla locations, avoid zones become
   exclude_polygons, road options become costing options.
3. Ask Valhalla.
4. summarize(): one GeoJSON line for the whole trip, a summary per leg, where
   each waypoint sits on that line, and the alternates.

A leg runs from one stop to the next. Through points do not split legs: they
only shape the route inside one.
"""

import time

from . import geometry, speeds, valhalla, zones
from .models import RouteRequest, Waypoint

# Waypoint type -> Valhalla location type. "through": the route must pass
# here, but it is not a stop, so the leg goes on and no U-turn is allowed.
# Stops and overnights end a leg ("break"); the planner adds the time spent
# there itself (phase 3 on).
LOCATION_TYPE = {"through": "through", "stop": "break", "overnight": "break"}

# A through point only bends the route, so it should land on a real road, not
# on the farm track or parking aisle that happens to be closest to the click
# (found in phase 1: a click east of Colorado Springs snapped to a 2 km/h
# track and added 8 hours). Stops keep Valhalla's default, because a park or
# a motel can sit on a service road.
THROUGH_SEARCH_FILTER = {"min_road_class": "residential"}


class RouteError(Exception):
    """Valhalla could not route the trip. `message` is meant for the user."""

    def __init__(self, message: str, valhalla_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.valhalla_code = valhalla_code


def location_type(index: int, count: int, wp: Waypoint) -> str:
    """The start and the end are always breaks, whatever the waypoint says."""
    if index == 0 or index == count - 1:
        return "break"
    return LOCATION_TYPE[wp.type]


def location(index: int, count: int, wp: Waypoint) -> dict:
    """One Valhalla location for a waypoint."""
    kind = location_type(index, count, wp)
    loc = {"lat": wp.lat, "lon": wp.lon, "type": kind}
    if kind == "through":
        loc["search_filter"] = THROUGH_SEARCH_FILTER
    return loc


def costing_options(req: RouteRequest) -> dict:
    """Valhalla `auto` costing options from the trip's road options.

    use_tolls / use_ferry run from 0 (avoid if at all possible) to 1 (prefer);
    0.5 is Valhalla's neutral default. exclude_unpaved is a hard rule.
    """
    opts = req.options
    out: dict = {}
    if opts.avoid_tolls:
        out["use_tolls"] = 0.0
    if opts.avoid_ferries:
        out["use_ferry"] = 0.0
    if opts.avoid_unpaved:
        out["exclude_unpaved"] = True
    return out


def alternates_allowed(req: RouteRequest) -> bool:
    """Valhalla only returns alternates for two locations (checked in 3.9.1:
    a through point in between is enough to get none)."""
    return len(req.waypoints) == 2 and req.options.alternates > 0


def build_request(req: RouteRequest, *, dated: bool = True) -> dict:
    """The /route body for a trip. Pure: no checks, no network.

    Valhalla returns no alternates for a request with date_time (its
    time-dependent search does not do them). So a dated request never asks for
    alternates; plan_route() asks for them separately with dated=False.
    """
    n = len(req.waypoints)
    body: dict = {
        "locations": [location(i, n, wp) for i, wp in enumerate(req.waypoints)],
        "costing": "auto",
        "directions_options": {"units": "miles"},
    }
    if co := costing_options(req):
        body["costing_options"] = {"auto": co}
    if polygons := zones.exclude_polygons(req.zones):
        body["exclude_polygons"] = polygons
    if req.depart and dated:
        body["date_time"] = {"type": 1, "value": req.depart}  # 1 = depart at
    elif alternates_allowed(req):
        body["alternates"] = req.options.alternates
    return body


def plan_route(req: RouteRequest, client=None) -> dict:
    """Check, route and summarize. Raises ZoneError or RouteError."""
    zones.check_sizes(req.zones)
    zones.check_waypoints(req.waypoints, req.zones)
    started = time.perf_counter()
    try:
        result = valhalla.post_route(build_request(req), client)
        if req.depart and alternates_allowed(req):
            # Second, undated request just for the alternates. Without a date
            # Valhalla applies timed closures as of today, so the alternates
            # can differ from what the travel date would allow.
            undated = valhalla.post_route(build_request(req, dated=False), client)
            result["alternates"] = undated.get("alternates", [])
    except valhalla.ValhallaError as exc:
        raise route_error(exc, req) from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    out = summarize(result, req)
    out["valhalla_ms"] = elapsed_ms
    return out


def route_error(exc: valhalla.ValhallaError, req: RouteRequest) -> RouteError:
    """A message the user can act on, for the Valhalla errors we know."""
    if exc.code == 442:
        names = [z.name or "unnamed" for z in zones.avoid_zones(req.zones)]
        if names:
            return RouteError(
                "No route gets around the avoid zones (" + ", ".join(names) + "). Turn one off or make it smaller.",
                exc.code,
            )
        return RouteError("No route connects these waypoints. Is one of them off the road network?", exc.code)
    if exc.code in (171, 154):  # no suitable edges near a location / distance limit
        return RouteError(f"Valhalla could not use a waypoint: {exc}", exc.code)
    return RouteError(f"Valhalla error {exc.code}: {exc}", exc.code)


# ---------- summarizing the answer ----------


def trip_points(trip: dict) -> tuple[list[tuple[float, float]], list[tuple[int, int]]]:
    """All legs' shapes joined into one (lat, lon) list, and each leg's
    [start, end] index in it. Legs share their end point, so it is kept once."""
    points: list[tuple[float, float]] = []
    spans = []
    for leg in trip["legs"]:
        shape = valhalla.decode_polyline6(leg["shape"])
        start = max(len(points) - 1, 0)
        points.extend(shape[1:] if points else shape)
        spans.append((start, len(points) - 1))
    return points, spans


def waypoint_positions(req: RouteRequest, points, spans) -> list[int]:
    """Index into `points` where each waypoint sits.

    Breaks sit where legs meet. A through point is matched to the nearest
    shape point inside its leg, after the previous through point, so loops
    (Denver ... Denver) never confuse the order.
    """
    n = len(req.waypoints)
    positions, leg = [], 0
    for i, wp in enumerate(req.waypoints):
        kind = location_type(i, n, wp)
        if i == 0:
            positions.append(0)
        elif kind == "break":
            positions.append(spans[leg][1])
            leg += 1
        else:
            start = max(positions[-1], spans[leg][0])
            positions.append(geometry.nearest_index(points, wp.lat, wp.lon, start, spans[leg][1] + 1))
    return positions


def line(points) -> dict:
    """GeoJSON LineString ([lon, lat]) from (lat, lon) points."""
    return {"type": "LineString", "coordinates": [[round(lon, 6), round(lat, 6)] for lat, lon in points]}


def minutes(seconds: float, pace: float) -> float:
    return round(seconds * pace / 60, 1)


def summarize(result: dict, req: RouteRequest) -> dict:
    trip = result["trip"]
    points, spans = trip_points(trip)
    positions = waypoint_positions(req, points, spans)
    n = len(req.waypoints)
    break_indexes = [i for i, wp in enumerate(req.waypoints) if location_type(i, n, wp) == "break"]

    legs = []
    for k, leg in enumerate(trip["legs"]):
        a, b = break_indexes[k], break_indexes[k + 1]
        legs.append(
            {
                "from": req.waypoints[a].id,
                "to": req.waypoints[b].id,
                "through": [wp.id for wp in req.waypoints[a + 1 : b]],
                "miles": round(leg["summary"]["length"], 1),
                "minutes": minutes(speeds.leg_seconds(leg), req.pace),
                "valhalla_minutes": round(leg["summary"]["time"] / 60, 1),
                "span": list(spans[k]),
            }
        )

    total_minutes = round(sum(leg["minutes"] for leg in legs), 1)
    out = {
        "geometry": line(points),
        "legs": legs,
        "total": {
            "miles": round(trip["summary"]["length"], 1),
            "minutes": total_minutes,
            "valhalla_minutes": round(trip["summary"]["time"] / 60, 1),
        },
        "waypoint_positions": dict(zip((wp.id for wp in req.waypoints), positions)),
        "alternates": alternates(result, points, total_minutes, req),
        "warnings": warnings(result, req),
    }
    return out


def alternates(result: dict, main_points, main_minutes: float, req: RouteRequest) -> list[dict]:
    """Each alternate with its extra time, and the point to adopt it by.

    The adopt point is the spot on the alternate farthest from the main route
    and from the other alternates. A through point there makes the router take
    that alternate, and keeps it doing so after later edits.
    """
    alts = []
    shapes = []
    for alt in result.get("alternates", []):
        pts, _ = trip_points(alt["trip"])
        shapes.append(pts)
    for i, alt in enumerate(result.get("alternates", [])):
        trip = alt["trip"]
        others = [main_points] + [s for j, s in enumerate(shapes) if j != i]
        lat, lon = geometry.farthest_point(shapes[i], others)
        mins = minutes(speeds.corrected_trip_seconds(trip), req.pace)
        alts.append(
            {
                "geometry": line(shapes[i]),
                "miles": round(trip["summary"]["length"], 1),
                "minutes": mins,
                "extra_minutes": round(mins - main_minutes, 1),
                "adopt": {"lat": round(lat, 6), "lon": round(lon, 6)},
            }
        )
    return alts


def warnings(result: dict, req: RouteRequest) -> list[str]:
    out = [w.get("description", str(w)) for w in result.get("trip", {}).get("warnings", [])]
    if req.options.alternates > 0 and len(req.waypoints) > 2:
        out.append("Alternate routes are only shown for trips with two waypoints.")
    return out
