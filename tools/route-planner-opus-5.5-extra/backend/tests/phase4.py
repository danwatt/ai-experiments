"""Hand-made trips for the phase 4 tests: days, meals, fuel, zones, clocks.

The route runs north along longitude -106.5 from El Paso into Montana: about
1100 miles, all in Mountain time (America/Denver), at 60 mph, so a place's
minute equals its mile. Candidates come from fakes.cand: their own lat/lon
(used by zones) sit on latitude 39, at lon -105 + mile / 60.
"""

from app import timeline
from app.models import MealSettings, PlanRequest, Waypoint
from app.planner import schedule

from .fakes import cand, leg, line, trip

MILES = 1100
TL = timeline.build(trip(leg(line((32.0, -106.5), (48.0, -106.5), MILES + 1), MILES * 60, MILES)), 1.0)
NO_MEALS = MealSettings(lunch={"on": False, "start": "11:30", "end": "13:30", "minutes": 45},
                        dinner={"on": False, "start": "17:30", "end": "19:30", "minutes": 60})


def wp(id, mile, type="stop", **kw):
    """A waypoint at `mile`, and where the analysis puts it."""
    return Waypoint(id=id, lat=39.0, lon=-105.0 + mile / 60, name=id.upper(), type=type, **kw), {"id": id, "mile": mile, "minute": mile}


def town(id, mile, **kw):
    """A town with food, fuel and (by default) a few places to stay."""
    kw.setdefault("lodging", 4)
    kw.setdefault("food", 6)
    kw.setdefault("fuel", 2)
    kw.setdefault("name", f"T{mile}")
    return cand(id, mile, **kw)


def towns(every=20, start=20, end=MILES, **kw):
    return [town(1000 + m, m, **kw) for m in range(start, end, every)]


def run(points, cands, depart="2027-09-24T08:00", tl=TL, **kw):
    wps, at = zip(*points)
    req = PlanRequest(waypoints=list(wps), depart=depart, **kw)
    return schedule.plan(req, {"waypoints": list(at), "candidates": cands}, tl)


def rows_of(out, *types):
    return [r for r in out["rows"] if not types or r["type"] in types]


def box_at(mile, half=0.05):
    """(south, west, north, east) around the place fakes.cand puts at `mile`."""
    lon = -105.0 + mile / 60
    return 38.95, lon - half, 39.05, lon + half


def hhmm(iso):
    return iso[11:16]
