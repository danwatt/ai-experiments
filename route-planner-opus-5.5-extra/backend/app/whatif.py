"""What would turning a zone on do to this trip? (the zone library, phase 5)

Asked on request for zones that are off, so a big library never slows planning:

- A zone the route does not touch, and with no candidate stop inside, changes
  nothing: "not on this route". No work at all.
- A stop zone (no stops, no meals, no overnight, prefer) needs one more plan
  with the zone on, from the analysis already cached. No Valhalla call.
- An avoid zone needs one more route request with the zone added, compared
  with the route the trip has now (same Timeline, so same speeds and pace).

The answer for each zone is {text, minutes, miles}: plain words to show under
the zone, and for an avoid zone the extra time and miles.
"""

import httpx
from shapely.geometry import LineString, Point, Polygon

from . import routing, timeline, valhalla, zones
from .models import PlanRequest, Zone
from .planner import schedule
from .timeline import Timeline
from .zones import ZoneError


def touches(zone: Zone, tl: Timeline, analysis_out: dict) -> tuple[bool, bool]:
    """(the route passes through the zone, a candidate stop is inside it)."""
    poly = Polygon(zones.closed(zone.ring))
    if not poly.is_valid:
        poly = poly.buffer(0)
    route = LineString([(lon, lat) for lat, lon in tl.points])
    on_route = route.intersects(poly)
    stop_inside = any(poly.contains(_pt(c["lon"], c["lat"])) for c in analysis_out["candidates"])
    return on_route, stop_inside


def _pt(lon: float, lat: float) -> Point:
    return Point(lon, lat)


def longer(minutes: float) -> str:
    """'29 min longer', '1 h 05 shorter'"""
    h, m = divmod(round(abs(minutes)), 60)
    return (f"{h} h {m:02d}" if h else f"{m} min") + (" longer" if minutes >= 0 else " shorter")


def check(req: PlanRequest, ids: list[str], out: dict, tl: Timeline, client: httpx.Client | None = None) -> dict[str, dict]:
    """The effect of switching on each zone in `ids` (zones of `req` that are off)."""
    result: dict[str, dict] = {}
    by_id = {z.id: z for z in req.zones}
    for zid in ids[:12]:
        zone = by_id.get(zid)
        if zone is None:
            continue
        on = zone.model_copy(update={"enabled": True})
        try:
            on_route, stop_inside = touches(on, tl, out)
        except Exception:
            on_route, stop_inside = True, True  # a zone shape that cannot be tested is tried for real
        if not on_route and not stop_inside:
            result[zid] = {"text": "not on this route: switching it on changes nothing", "minutes": 0, "miles": 0}
            continue
        trial = req.model_copy(update={"zones": [on if z.id == zid else z for z in req.zones]})
        if zone.type == "avoid":
            result[zid] = avoid_effect(trial, on, out, tl, client)
        else:
            result[zid] = stop_effect(trial, on, out, tl)
    return result


def stop_effect(trial: PlanRequest, zone: Zone, out: dict, tl: Timeline) -> dict:
    """Plan again with the zone on (the candidates come from the cache) and read what it did."""
    plan = schedule.plan(trial, out, tl)
    lines = plan["zone_effects"].get(zone.id) or ["nothing changes"]
    return {"text": "turning it on: " + " · ".join(lines), "minutes": 0, "miles": 0, "plan_ms": plan["plan_ms"]}


def avoid_effect(trial: PlanRequest, zone: Zone, out: dict, tl: Timeline, client: httpx.Client | None) -> dict:
    """One route request with the zone added, compared with the route as it is."""
    try:
        zones.check_sizes(trial.zones)
        zones.check_waypoints(trial.waypoints, trial.zones)
    except ZoneError as exc:
        return {"text": f"cannot be switched on: {exc.message}", "minutes": None, "miles": None, "blocked": True}
    one = trial.route_request().model_copy(update={"options": trial.options.model_copy(update={"alternates": 0})})
    try:
        route = valhalla.post_route(routing.build_request(one), client)["trip"]
    except valhalla.ValhallaError:
        return {"text": "no route exists with this zone on", "minutes": None, "miles": None, "blocked": True}
    other = timeline.build(route, trial.pace)
    minutes, miles = other.minutes[-1] - tl.minutes[-1], other.miles[-1] - tl.miles[-1]
    if abs(miles) < 0.05 and abs(minutes) < 0.5:
        return {"text": "the route already avoids it: switching it on changes nothing", "minutes": 0, "miles": 0}
    return {"text": f"turning it on: {longer(minutes)}, {abs(miles):.0f} mi {'longer' if miles >= 0 else 'shorter'}",
            "minutes": round(minutes, 1), "miles": round(miles, 1)}
