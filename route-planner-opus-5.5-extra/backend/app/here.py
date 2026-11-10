"""Start from here, now: use the app during the trip.

Given where the car is (a GPS position, or a point clicked on the route) and
the time, make that the new start of the trip:

- the new start is a waypoint at that point, and the departure is now;
- waypoints already passed leave the trip (the end always stays);
- pins and skips for places already passed leave it too; the ones ahead are
  kept and renumbered, because a place's pass number ("1234#2") counts the
  passes still ahead;
- everything else (settings, zones, options) stays as it is.

Where on the route "here" is: the point of the route nearest to the position.
A loop passes the same place twice (Denver is both the start and the end of
the example loop), so a position near more than one pass of the route is
ambiguous. Then nothing is changed and `passes` lists the miles; ask again with
the chosen `mile`.
"""

import uuid
from datetime import datetime, timezone

from shapely.geometry import Point as ShapelyPoint

from .models import PlanRequest
from .planner import candidates, clock
from .timeline import Timeline

PASSED_MILES = 0.5  # a waypoint this far ahead of the car or less counts as passed
SAME_PASS_M = 800  # nearest points of the route closer than this to each other, along it, are one pass


class HereError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def passes(tl: Timeline, lat: float, lon: float) -> list[dict]:
    """Every pass of the route near (lat, lon): [{mile, off_m}], by mile. Near means
    within 1.5 km, or twice the distance to the nearest point if that is further."""
    pt = ShapelyPoint(tl.proj.xy(lat, lon))
    pieces = candidates.route_pieces(tl)
    dist = [geom.distance(pt) for geom, _ in pieces]
    reach = max(1500.0, 2 * min(dist))
    near = [i for i, d in enumerate(dist) if d <= reach]
    out = []
    for run in candidates.runs(near):
        best = min(run, key=lambda i: dist[i])
        geom, start_m = pieces[best]
        mile, _ = tl.interpolate(start_m + geom.project(pt))
        out.append({"mile": round(mile, 1), "off_m": round(dist[best])})
    return out


def utc_minutes_of(now: datetime) -> float:
    if now.tzinfo is None:
        raise HereError("The time needs a time zone (send it as UTC, e.g. 2027-09-25T14:30:00Z).")
    return now.astimezone(timezone.utc).timestamp() / 60


def renumber(key: str, ahead: dict[str, int]) -> str | None:
    """'1234#2' when `ahead` says how many passes of place 1234 are behind the car: '1234#1' for one."""
    cid, n = key.split("#")
    n = int(n) - ahead.get(cid, 0)
    return f"{cid}#{n}" if n >= 1 else None


def start_from_here(req: PlanRequest, analysis: dict, tl: Timeline, lat: float, lon: float, now: datetime, mile: float | None = None) -> dict:
    """The changes to make to the trip. Returns {passes, mile, ambiguous: True} when the
    position is near several passes and `mile` was not given, else {mile, off_m, waypoints,
    depart, pins, skips, dropped}."""
    found = passes(tl, lat, lon)
    if mile is None:
        if len(found) > 1:
            return {"ambiguous": True, "passes": found}
        mile = found[0]["mile"]
    else:
        found = [min(found, key=lambda p: abs(p["mile"] - mile))] if found else [{"mile": mile, "off_m": 0}]
    at = {w["id"]: w["mile"] for w in analysis["waypoints"]}
    total = at[req.waypoints[-1].id]  # where the trip ends (the route can run past it only in a test)
    if mile >= total - PASSED_MILES:
        raise HereError("That is at the end of the trip already: there is nothing left to plan.")

    kept, dropped_wps = [], []
    for i, wp in enumerate(req.waypoints):
        last = i == len(req.waypoints) - 1
        if i == 0 or (not last and at[wp.id] <= mile + PASSED_MILES):
            dropped_wps.append(wp.name or f"waypoint {i + 1}")
        else:
            kept.append(wp)
    here = {"id": uuid.uuid4().hex[:8], "lat": round(lat, 6), "lon": round(lon, 6), "name": "Current position", "type": "stop", "minutes": 30, "nights": 1}
    waypoints = [here] + [{"id": w.id, "lat": w.lat, "lon": w.lon, "name": w.name, "type": w.type, "minutes": w.minutes, "nights": w.nights} for w in kept]

    # Passes of each place behind the car, to renumber what is ahead.
    stop_cands = [c for c in analysis["candidates"] if c.get("stop_key")]
    behind: dict[str, int] = {}
    mile_of = {}
    for c in stop_cands:
        mile_of[c["stop_key"]] = c["mile"]
        if c["mile"] <= mile:
            behind[str(c["id"])] = behind.get(str(c["id"]), 0) + 1

    def keep(refs):
        out, gone = [], []
        for ref in refs:
            m = mile_of.get(ref.key)
            if m is None:
                out.append(ref.model_dump())  # unknown to this route: the planner will say so
            elif m > mile:
                out.append({**ref.model_dump(), "key": renumber(ref.key, behind)})
            else:
                gone.append(ref.name or ref.key)
        return out, gone

    pins, gone_pins = keep(req.pins)
    skips, gone_skips = keep(req.skips)

    zone = clock.zone_at(lat, lon)
    local = clock.naive(utc_minutes_of(now), zone)
    return {
        "ambiguous": False,
        "mile": round(mile, 1),
        "off_m": found[0]["off_m"],
        "waypoints": waypoints,
        "depart": local.isoformat(timespec="minutes"),
        "pins": pins,
        "skips": skips,
        "dropped": {"waypoints": dropped_wps, "pins": gone_pins, "skips": gone_skips},
        "miles_left": round(total - mile, 1),
    }
