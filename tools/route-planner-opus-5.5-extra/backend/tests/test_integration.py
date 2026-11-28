"""Against the running Valhalla (skipped when it is down).

These check the facts the planner relies on, with the Colorado tiles: the
speed fix, through points, avoid zones and alternates.
"""

import httpx
import pytest

from app import routing, valhalla
from tests.fakes import box, request, wp


def _up() -> bool:
    try:
        valhalla.status()
        return True
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _up(), reason="valhalla is not reachable")

DENVER, DURANGO = (39.7392, -104.9903), (37.2753, -107.8801)


def test_denver_durango_takes_us285_in_about_six_hours():
    # Phase 0 got 405 mi / 8:29 via I-70 and US-550: speeds were wrong.
    out = routing.plan_route(request([wp("a", *DENVER), wp("b", *DURANGO)], pace=1.0))
    assert 320 < out["total"]["miles"] < 350
    assert 5.5 * 60 < out["total"]["minutes"] < 6.75 * 60


def test_alternates_with_a_departure_date():
    out = routing.plan_route(request([wp("a", *DENVER), wp("b", *DURANGO)], depart="2027-09-24T08:00"))
    assert len(out["alternates"]) >= 1
    assert all(a["extra_minutes"] > -30 for a in out["alternates"])


def test_avoid_zone_changes_the_route():
    trip = [wp("a", *DENVER), wp("b", *DURANGO)]
    plain = routing.plan_route(request(trip))
    # US-285 over Kenosha Pass, between Bailey and Jefferson.
    avoided = routing.plan_route(request(trip, [box("k", 39.30, -105.85, 39.48, -105.45, name="Kenosha")]))
    assert avoided["total"]["miles"] != plain["total"]["miles"]


def test_through_point_shapes_one_leg():
    # Ouray pulls the route west onto US-550 (plain: 337 mi on US-160); still one leg.
    out = routing.plan_route(request([wp("a", *DENVER), wp("o", 38.0228, -107.6714, "through"), wp("b", *DURANGO)]))
    assert len(out["legs"]) == 1 and out["legs"][0]["through"] == ["o"]
    assert out["total"]["miles"] > 360


def test_colorado_loop():
    loop = [
        wp("a", *DENVER), wp("b", 40.4413, -105.7546, "through"), wp("c", *DURANGO, "overnight"),
        wp("d", 37.7326, -105.5122), wp("e", *DENVER),
    ]
    out = routing.plan_route(request(loop, depart="2027-09-25T08:00"))
    assert [l["to"] for l in out["legs"]] == ["c", "d", "e"]
    positions = out["waypoint_positions"]
    assert positions["a"] < positions["b"] < positions["c"] < positions["d"] < positions["e"]


# ---------- phase 2: stop data (needs data/pois.sqlite from `make import`) ----------

from pathlib import Path  # noqa: E402

from app.planner import analysis  # noqa: E402
from app.pois import db  # noqa: E402

needs_pois = pytest.mark.skipif(not Path(db.DB_PATH).exists(), reason="run `make import` first")
GRAND_JUNCTION = (39.0639, -108.5506)


def stops_of(waypoints, **kw):
    return analysis.analyze(request(waypoints, **kw), db.connect())


@needs_pois
def test_far_side_rest_areas_have_larger_detours_than_near_side_ones():
    # Edwards, CO: the CDOT rest area is on the westbound side of I-70.
    east = {c["name"]: c for c in stops_of([wp("a", *DENVER), wp("b", *GRAND_JUNCTION)])["candidates"]}
    west = {c["name"]: c for c in stops_of([wp("a", *GRAND_JUNCTION), wp("b", *DENVER)])["candidates"]}
    edwards = "CDOT Rest Area: Edwards"
    assert east[edwards]["detour_min"] < 2 and west[edwards]["detour_min"] > 4
    # 6.7 min there and back eastbound is about 3.4 each way: inside the 5-minutes-each-way
    # limit since phase 3 (phase 2 counted 5 minutes in total and marked it over).
    assert not west[edwards]["over_limit"] and not east[edwards]["over_limit"]


@needs_pois
def test_vail_pass_rest_area_is_a_candidate_with_a_mile_and_a_minute():
    out = stops_of([wp("a", *DENVER), wp("b", *GRAND_JUNCTION)])
    (vail,) = [c for c in out["candidates"] if c["name"] == "CDOT Rest Area: Vail Pass"]
    assert 75 < vail["mile"] < 90 and 70 < vail["minute"] < 120 and vail["toilets"] is True


@needs_pois
def test_trail_ridge_closure_is_flagged_in_january_and_open_in_september():
    estes, grand_lake = (40.3772, -105.5217), (40.2522, -105.8227)
    winter = stops_of([wp("a", *estes), wp("b", *grand_lake)], depart="2027-01-15T08:00")["closures"]
    summer = stops_of([wp("a", *estes), wp("b", *grand_lake)], depart="2027-09-25T08:00")["closures"]
    winter_trail = [c for c in winter if c["road"] == "Trail Ridge Road"]
    summer_trail = [c for c in summer if c["road"] == "Trail Ridge Road"]
    assert [c["level"] for c in winter_trail] == ["closed"] and [c["level"] for c in summer_trail] == ["open"]
    assert "Oct 14th" in winter_trail[0]["message"] and winter_trail[0]["tags"].startswith("access:conditional=no @")
    assert winter_trail[0]["ways"] > 10 and winter_trail[0]["miles"][1] - winter_trail[0]["miles"][0] > 25


# ---------- phase 3: breaks (needs data/pois.sqlite) ----------

from app.models import PlanRequest, Waypoint  # noqa: E402
from app.planner import schedule  # noqa: E402

from .test_schedule import BREAKS_ONLY  # noqa: E402  (meals, fuel and automatic overnights off)


def plan_of(waypoints, **kw):
    req = PlanRequest(waypoints=waypoints, **kw)
    out, tl = analysis.analyze_with_timeline(req.analysis_request(), db.connect())
    return schedule.plan(req, out, tl)


@needs_pois
def test_denver_durango_gets_three_breaks_spaced_within_the_rules():
    plan = plan_of([wp("a", *DENVER, name="Denver"), wp("b", *DURANGO, name="Durango")], depart="2027-09-24T08:00", **BREAKS_ONLY)
    breaks = [r for r in plan["rows"] if r["type"] == "break"]
    assert len(breaks) == 3, [b["name"] for b in breaks]
    minutes = [0] + [b["minute"] for b in breaks] + [plan["rows"][-1]["minute"]]
    miles = [0] + [b["mile"] for b in breaks] + [plan["rows"][-1]["mile"]]
    for a, b, ma, mb in zip(minutes, minutes[1:], miles, miles[1:]):
        assert b - a <= 132 and mb - ma <= 165  # never past 110 % of 2 h / 150 mi
    for b in breaks:
        assert 90 <= b["gap_minutes"] <= 120 or b["gap_miles"] >= 112.5  # inside the 75-100 % window
        assert b["detour_min"] <= 10
    assert breaks[0]["name"] == "Fairplay"  # the town over Kenosha Pass, as in the mockup
    assert plan["warnings"] == []
    assert "14:30" <= plan["rows"][-1]["arrive"][11:] <= "15:45"


@needs_pois
def test_colorado_loop_breaks_reset_at_the_timed_stop_and_after_the_nights():
    loop = [
        wp("a", *DENVER, name="Denver"), wp("b", 40.4413, -105.7546, "through"),
        Waypoint(id="c", lat=DURANGO[0], lon=DURANGO[1], type="overnight", nights=2, name="Durango"),
        Waypoint(id="d", lat=37.7326, lon=-105.5122, type="stop", minutes=180, name="Great Sand Dunes"),
        wp("e", *DENVER, name="Denver"),
    ]
    plan = plan_of(loop, depart="2027-09-25T08:00", **BREAKS_ONLY)
    rows = plan["rows"]
    night = next(r for r in rows if r["type"] == "overnight")
    assert night["depart"] == "2027-09-27T08:00"
    dunes = next(r for r in rows if r["type"] == "stop")
    after = next(r for r in rows if r["type"] == "break" and r["minute"] > dunes["minute"])
    assert after["gap_minutes"] == round(after["minute"] - dunes["minute"], 1)  # counted from the dunes
    assert [d["driving"] for d in plan["days"]] == [True, False, True]
    assert all(r["gap_minutes"] <= 132 for r in rows if r["type"] == "break")


# ---------- phase 4: days, meals, fuel and zones on the example trips ----------

OURAY = (38.0228, -107.6714)


def example_zones():
    from tests.fakes import box

    return [
        box("boulder", 40.005, -105.295, 40.03, -105.255, name="Boulder downtown"),
        box("denver", 39.55, -105.15, 39.92, -104.75, type="no_stops", name="Denver metro"),
        box("montrose", 38.44, -107.93, 38.52, -107.83, type="no_meals", name="Montrose"),
        box("glenwood", 39.50, -107.38, 39.58, -107.28, type="prefer", name="Glenwood Springs"),
    ]


def example_loop():
    return [
        wp("a", *DENVER, name="Denver"), wp("b", 40.4413, -105.7546, "through", name="Trail Ridge Road"),
        wp("o", *OURAY, "through", name="Ouray"),
        Waypoint(id="c", lat=DURANGO[0], lon=DURANGO[1], type="overnight", nights=2, name="Durango"),
        Waypoint(id="d", lat=37.7326, lon=-105.5122, type="stop", minutes=180, name="Great Sand Dunes"),
        wp("e", *DENVER, name="Denver"),
    ]


@needs_pois
def test_example_loop_plans_days_meals_and_fuel_within_the_rules():
    plan = plan_of(example_loop(), depart="2027-09-25T08:00", zones=example_zones())
    rows = plan["rows"]
    days = [d for d in plan["days"] if d["driving"]]
    assert len(plan["days"]) >= 5
    # Days 1 and 2 come out of one 9-10 h stretch to Durango: an automatic night in between.
    first_night = next(r for r in rows if r["type"] == "overnight")
    assert first_night["auto"] and first_night["day"] == 1
    for d in days:
        assert d["driving_minutes"] <= 480 or any(w["code"] == "day_over_limit" and w["day"] == d["day"] for w in plan["warnings"])
    for r in rows:
        if r["type"] in ("lunch", "dinner"):
            m = plan["meals"][r["type"]]
            assert m["start"] <= r["arrive"][11:16] <= m["end"]
        assert r["type"] == "start" or r["tz"] == "MDT"
    # No stop in metro Denver, no meal in Montrose.
    from app.geometry import ring_contains

    zs = {z.id: z for z in example_zones()}
    for r in rows:
        if r["type"] in ("break", "lunch", "dinner", "fuel") or (r["type"] == "overnight" and r["auto"]):
            assert not ring_contains(zs["denver"].ring, r["lat"], r["lon"])
        if r["type"] in ("lunch", "dinner"):
            assert not ring_contains(zs["montrose"].ring, r["lat"], r["lon"])
    # The tank never runs past 300 mi without a fill-up (refuel or overnight).
    fills = [r["mile"] for r in rows if r.get("refuel") or r["type"] in ("start", "overnight")] + [rows[-1]["mile"]]
    assert all(b - a <= 300 for a, b in zip(fills, fills[1:]))
    assert set(plan["zone_effects"]) == set(zs) and all(plan["zone_effects"].values())
    assert not [w for w in plan["warnings"] if w["code"] in ("long_gap", "fuel_late")]


@needs_pois
def test_denver_durango_gets_lunch_in_its_window_and_fuel_before_wolf_creek_pass():
    plan = plan_of([wp("a", *DENVER, name="Denver"), wp("b", *DURANGO, name="Durango")], depart="2027-09-24T08:00")
    (lunch,) = [r for r in plan["rows"] if r["type"] == "lunch"]
    assert "11:30" <= lunch["arrive"][11:16] <= "13:30"
    fuel = [r for r in plan["rows"] if r.get("refuel")]
    assert len(fuel) == 1 and fuel[0]["mile"] <= 300 and fuel[0]["fuel_note"] == "merged: fuel was due by mile 300"
    assert len(plan["days"]) == 1 and plan["days"][0]["sunset"]


@needs_pois
def test_avoid_this_road_routes_around_trail_ridge_in_winter():
    estes, grand_lake = (40.3772, -105.5217), (40.2522, -105.8227)
    trip = [wp("a", *estes), wp("b", *grand_lake)]
    winter = stops_of(trip, depart="2027-01-15T08:00")
    (trail,) = [c for c in winter["closures"] if c["road"] == "Trail Ridge Road"]
    assert trail["level"] == "closed" and trail["avoid_ring"]
    from app.models import Zone

    zone = Zone(id="closed", name="Closed: Trail Ridge Road", type="avoid", ring=[tuple(p) for p in trail["avoid_ring"]])
    plain = routing.plan_route(request(trip, depart="2027-01-15T08:00"))
    around = routing.plan_route(request(trip, [zone], depart="2027-01-15T08:00"))
    assert around["total"]["miles"] > plain["total"]["miles"] + 40  # no road over the park: round by I-70 or Berthoud Pass
