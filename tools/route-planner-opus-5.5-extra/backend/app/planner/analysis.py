"""Everything /api/route/stops answers for one trip: candidate stops with
detours, and seasonal-closure warnings.

Kept apart from /api/route so that dragging the route line, which asks for a
fresh route on every mouse move, never waits for matrix requests.
"""

import json
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import httpx
from shapely.geometry import LineString, Point as ShapelyPoint

from .. import routing, seasonal, timeline, valhalla, zones
from ..geometry import METRES_PER_MILE
from ..models import RouteRequest
from ..pois import db
from . import candidates, choices, loose

# Recent answers, with the Timeline they were built on (the break planner
# needs it to turn minutes into miles). A re-plan after a pin or a skip finds
# its trip here and makes no Valhalla call.
_results: OrderedDict[str, tuple[dict, timeline.Timeline]] = OrderedDict()
RESULTS_KEPT = 8


def trip_key(req: RouteRequest) -> str:
    """Same request, same key. The pace is part of it: it scales every minute."""
    return json.dumps(req.model_dump(mode="json"), sort_keys=True)


def analyze(req: RouteRequest, con, client: httpx.Client | None = None) -> dict:
    """Candidates and closures for a trip. Raises ZoneError / RouteError like plan_route."""
    return analyze_with_timeline(req, con, client)[0]


def analyze_with_timeline(req: RouteRequest, con, client: httpx.Client | None = None) -> tuple[dict, timeline.Timeline]:
    """analyze(), plus the route's Timeline (miles and minutes at every point)."""
    key = trip_key(req)
    if key in _results:
        _results.move_to_end(key)
        out, tl = _results[key]
        return {**out, "from_cache": True}, tl

    zones.check_sizes(req.zones)
    zones.check_waypoints(req.waypoints, req.zones)
    t0 = time.perf_counter()
    try:
        result = valhalla.post_route(routing.build_request(req), client)
    except valhalla.ValhallaError as exc:
        raise routing.route_error(exc, req) from exc
    tl = timeline.build(result["trip"], req.pace)
    stops_at = waypoint_places(req, result["trip"], tl)
    t1 = time.perf_counter()

    found = loose.tighten(candidates.find(con, tl, req.search_miles * METRES_PER_MILE), con, tl)
    choices.add_stop_keys(found)  # "id#pass": how pins and skips name a place
    t2 = time.perf_counter()
    options = routing.costing_options(req)
    polygons = zones.exclude_polygons(req.zones)
    scope = json.dumps([options, polygons], sort_keys=True)
    detour_stats = candidates.add_detours(
        found, tl, pace=req.pace, scope=scope, exclude_polygons=polygons or None, costing_options=options or None, client=client
    )
    t3 = time.perf_counter()

    stays = sum(max(0, wp.nights - 1) for i, wp in enumerate(req.waypoints[1:-1], start=1) if wp.type == "overnight")
    try:
        closures = seasonal.check(tl.points, tl.minutes[-1], req.depart, stays, con, client)
    except (valhalla.ValhallaError, httpx.HTTPError):
        closures = []  # Valhalla could not follow the line; no warning is better than a wrong one
    place_closures(closures, tl)
    t4 = time.perf_counter()
    avoided = avoid_effects(req, result["trip"], client)

    out = {
        "candidates": found,
        "waypoints": stops_at,
        "closures": closures,
        "avoid_effects": avoided,
        "limit_minutes": candidates.DETOUR_LIMIT_MIN,
        "timing": {
            "route_ms": ms(t1 - t0),
            "find_ms": ms(t2 - t1),
            "detours": detour_stats,
            "closures_ms": ms(t4 - t3),
            "total_ms": ms(t4 - t0),
        },
        "from_cache": False,
    }
    _results[key] = (out, tl)
    while len(_results) > RESULTS_KEPT:
        _results.popitem(last=False)
    return out, tl


MAX_AVOID_CHECKS = 4  # avoid zones checked one by one; more than this are not explained


def avoid_effects(req: RouteRequest, trip: dict, client: httpx.Client | None = None) -> dict[str, dict]:
    """What each avoid zone that is on costs this route: the route asked for
    again without that one zone, compared with the real one.

    {zone id: {minutes, miles, text}}. One extra Valhalla route per zone, in
    parallel, only when the trip has avoid zones; cached with the analysis.
    A zone that cannot be checked (Valhalla refuses the route without it) is
    left out.
    """
    zs = zones.avoid_zones(req.zones)[:MAX_AVOID_CHECKS]
    if not zs:
        return {}
    base_min = sum(lg["summary"]["time"] for lg in trip["legs"]) * req.pace / 60
    base_mi = sum(lg["summary"]["length"] for lg in trip["legs"])

    def without(z):
        other = req.model_copy(update={"zones": [x for x in req.zones if x.id != z.id], "options": req.options.model_copy(update={"alternates": 0})})
        try:
            t = valhalla.post_route(routing.build_request(other), client)["trip"]
        except (valhalla.ValhallaError, httpx.HTTPError):
            return z.id, None
        return z.id, (sum(lg["summary"]["time"] for lg in t["legs"]) * req.pace / 60, sum(lg["summary"]["length"] for lg in t["legs"]))

    out = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for zid, res in pool.map(without, zs):
            if res is None:
                continue
            extra_min, extra_mi = base_min - res[0], base_mi - res[1]
            if abs(extra_mi) < 0.05 and abs(extra_min) < 0.5:
                text = "not on this route: it is the same without the zone"
            else:
                text = f"the route goes around it: {'+' if extra_min >= 0 else '−'}{abs(extra_min):.0f} min, {'+' if extra_mi >= 0 else '−'}{abs(extra_mi):.1f} mi"
            out[zid] = {"minutes": round(extra_min, 1), "miles": round(extra_mi, 1), "text": text}
    return out


def waypoint_places(req: RouteRequest, trip: dict, tl: timeline.Timeline) -> list[dict]:
    """Each waypoint's mile and driving minute on the route, for the break planner."""
    points, spans = routing.trip_points(trip)
    positions = routing.waypoint_positions(req, points, spans)
    return [
        {"id": wp.id, "mile": round(tl.miles[i], 2), "minute": round(tl.minutes[i], 2)}
        for wp, i in zip(req.waypoints, positions)
    ]


def place_closures(closures: list[dict], tl: timeline.Timeline) -> None:
    """Replace each closure's list of way positions with the miles it spans on the route.

    A road that is closed on the trip's dates also gets `avoid_ring`: an avoid
    zone around its ways, which the page offers as "avoid this road" (phase 4).
    """
    line = LineString(tl.xy)
    for c in closures:
        points = c.pop("points")
        c["avoid_ring"] = seasonal.avoid_ring(points) if c["level"] == "closed" else None
        miles = []
        for lat, lon in points:
            pt = ShapelyPoint(tl.proj.xy(lat, lon))
            if line.distance(pt) < 1000:  # the way's middle is on the route
                miles.append(tl.interpolate(line.project(pt))[0])
        c["miles"] = [round(min(miles), 1), round(max(miles), 1)] if miles else None


def ms(seconds: float) -> int:
    return round(seconds * 1000)
