"""Settings the page edits that the planner reads: stop order, search distance, lodging brands, closures."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.models import BreakSettings, LodgingSettings, PlanRequest
from app.planner import candidates, choices, days as days_mod

from .fakes import cand
from .phase4 import TL, rows_of, run, town, towns, wp
from .test_candidates import make_db, make_timeline, rest_area  # noqa: F401  (make_db is a fixture)

client = TestClient(main.app)


# ---------- the order of places to stop ----------


def kinded(kind, **kw):
    c = cand(1, 100, kind=kind, **kw)
    c["stop_kind"] = choices.stop_kind(c)
    return c


def test_the_default_order_is_the_agreed_one():
    assert BreakSettings().stop_order == ["rest_area", "service_plaza", "services", "any"]
    rest, plaza, town_, bare = kinded("rest_area"), kinded("service_plaza"), kinded("town"), kinded("town", food=0, fuel=0)
    costs = [choices.stop_cost(c) for c in (rest, plaza, town_, bare)]
    assert costs == sorted(costs) and costs[1] - costs[0] == 4


def test_moving_a_kind_up_the_ladder_makes_it_win_close_calls():
    rest, town_ = kinded("rest_area"), kinded("town")
    assert choices.stop_cost(rest) < choices.stop_cost(town_)
    order = ["services", "rest_area", "service_plaza", "any"]
    assert choices.stop_cost(town_, order) < choices.stop_cost(rest, order)


def test_the_order_changes_which_place_the_plan_picks():
    cands = [cand(1, 118, kind="rest_area", name="Rest area", food=0, fuel=0), cand(2, 120, kind="town", name="Town", food=5, fuel=2)]
    default = run([wp("a", 0), wp("b", 240)], cands)
    flipped = run([wp("a", 0), wp("b", 240)], cands, breaks=BreakSettings(stop_order=["services", "rest_area", "service_plaza", "any"]))
    assert [r["name"] for r in rows_of(default, "break")] == ["Rest area"]
    assert [r["name"] for r in rows_of(flipped, "break")] == ["Town"]


def test_the_order_must_list_each_kind_once():
    for bad in (["rest_area"], ["rest_area", "rest_area", "services", "any"], ["rest_area", "service_plaza", "services", "bogus"]):
        with pytest.raises(ValidationError):
            BreakSettings(stop_order=bad)


# ---------- how far from the route ----------


def test_the_search_distance_decides_which_places_are_candidates(make_db):
    con = make_db(rest_area("close", 39.0, -104.55), rest_area("three miles north", 39.0435, -104.3))
    tl = make_timeline()
    mile = 1609.344
    assert [c["name"] for c in candidates.find(con, tl)] == ["close"]  # the default is 2 mi
    assert [c["name"] for c in candidates.find(con, tl, 4 * mile)] == ["close", "three miles north"]
    assert [c["name"] for c in candidates.find(con, tl, 0.5 * mile)] == ["close"]


def test_the_search_distance_is_part_of_the_route_request_cache_key():
    a = PlanRequest(waypoints=[wp("a", 0)[0], wp("b", 90)[0]])
    b = a.model_copy(update={"search_miles": 4})
    assert a.analysis_request().search_miles == 2 and b.analysis_request().search_miles == 4
    assert a.analysis_request().model_dump() != b.analysis_request().model_dump()
    with pytest.raises(ValidationError):
        PlanRequest(waypoints=a.waypoints, search_miles=40)


# ---------- lodging brands ----------


def hotel(id, mile, lodging, brands=None, **kw):
    c = town(id, mile, lodging=lodging, name=f"T{id}", **kw)
    c["detail"] = {"brands": {"lodging": brands or {}}}
    return c


def prepared(cands, lodging):
    return choices.prepare(cands, [0.0, 900.0], BreakSettings(), [], [], (), "all", 2, lodging)


def test_prefer_gives_brand_places_a_bonus_and_changes_no_counts():
    cands = [hotel(1, 300, 4, {"Hilton": 2, "Local Inn": 2}), hotel(2, 340, 4, {"Best Western": 4})]
    p = prepared(cands, LodgingSettings(brands=["hilton"], rule="prefer"))  # case does not matter
    by = {c["id"]: c for c in p.lodging}
    assert by[1]["brand_pref"] and by[1]["lodging_brand"] == 2 and by[1]["lodging"] == 4
    assert not by[2]["brand_pref"] and by[2]["lodging_brand"] == 0
    assert days_mod.spot_cost(by[1]) == days_mod.spot_cost(by[2]) - days_mod.BRAND_BONUS


def test_a_chosen_brand_matches_longer_names_that_contain_it():
    p = prepared([hotel(1, 300, 4, {"Hampton Inn & Suites": 3, "Local": 1}), hotel(2, 340, 4, {"Super 8 by Wyndham": 2})], LodgingSettings(brands=["hampton", "super 8"]))
    assert {c["id"]: c["lodging_brand"] for c in p.lodging} == {1: 3, 2: 2}


def test_a_brand_under_prefer_decides_the_night():
    cands = [hotel(1, 360, 4, {"Local Inn": 4}), hotel(2, 400, 4, {"Hilton": 3, "Local Inn": 1})]
    plain = run([wp("a", 0), wp("b", 720)], cands, lodging=LodgingSettings())
    liked = run([wp("a", 0), wp("b", 720)], cands, lodging=LodgingSettings(brands=["Hilton"], rule="prefer"))
    night = lambda out: [r for r in rows_of(out, "overnight") if r["auto"]][0]  # noqa: E731
    assert night(plain)["name"] == "T1"  # the more even split
    assert night(liked)["name"] == "T2" and night(liked)["lodging_brand"] == 3


def test_only_these_counts_just_the_brands_toward_the_minimum():
    cands = [hotel(1, 300, 5, {"Hilton": 1, "Other": 4}), hotel(2, 340, 3, {"Hilton": 3}), hotel(3, 380, 6, {})]
    p = prepared(cands, LodgingSettings(brands=["Hilton"], rule="only"))
    assert [c["id"] for c in p.lodging] == [2]  # place 1 has one Hilton (the minimum is 2), place 3 has no brand tags at all
    only = {c["id"]: c for c in p.lodging}[2]
    assert only["lodging"] == 3 and only["lodging_all"] == 3
    unfiltered = prepared(cands, LodgingSettings(brands=[], rule="only"))
    assert [c["id"] for c in unfiltered.lodging] == [1, 2, 3]  # no brands chosen: no filter


def test_only_these_can_leave_no_place_to_stay_and_the_plan_says_so():
    cands = towns(every=20, lodging=4)
    out = run([wp("a", 0), wp("b", 900)], cands, lodging=LodgingSettings(brands=["Hilton"], rule="only"))
    assert not [r for r in rows_of(out, "overnight") if r["auto"]]
    assert any(w["code"] == "day_over_limit" for w in out["warnings"])


# ---------- closures warning ----------


def test_warn_closures_off_hides_the_closure_list(monkeypatch):
    out = {"waypoints": [{"id": "a", "mile": 0, "minute": 0}, {"id": "b", "mile": 90, "minute": 90}], "candidates": towns(every=30, end=90),
           "closures": [{"level": "closed", "message": "Trail Ridge Road: closed"}], "timing": {}}
    monkeypatch.setattr(main.analysis, "analyze_with_timeline", lambda req, con: (out, TL))
    monkeypatch.setattr(main.db, "shared", lambda: None)
    body = {"waypoints": [{"id": "a", "lat": 39.0, "lon": -105.0}, {"id": "b", "lat": 39.0, "lon": -103.5}], "depart": "2027-09-24T08:00"}
    assert len(client.post("/api/plan", json=body).json()["closures"]) == 1
    assert client.post("/api/plan", json={**body, "warn_closures": False}).json()["closures"] == []


# ---------- a meal resets the break clock (or not) ----------


def test_a_meal_resets_the_break_clock_unless_the_setting_says_not():
    from app.models import MealSettings

    cands = towns(every=10, start=10, end=400, food=6)
    reset = run([wp("a", 0), wp("b", 400)], cands, depart="2027-09-24T08:00")
    keep_going = run([wp("a", 0), wp("b", 400)], cands, depart="2027-09-24T08:00", meals=MealSettings(resets_break_clock=False))
    assert rows_of(reset, "lunch") and rows_of(keep_going, "lunch")
    assert len(rows_of(keep_going, "break")) >= len(rows_of(reset, "break"))
    lunch = rows_of(reset, "lunch")[0]
    after = next(r for r in rows_of(reset, "break", "fuel") if r["minute"] > lunch["minute"])
    after_off = next(r for r in rows_of(keep_going, "break") if r["minute"] > rows_of(keep_going, "lunch")[0]["minute"])
    # With the reset the next break is measured from lunch; without it, from the break before lunch.
    assert after["gap_minutes"] == pytest.approx(after["minute"] - lunch["minute"], abs=0.1)
    before = [r for r in rows_of(keep_going, "break") if r["minute"] < rows_of(keep_going, "lunch")[0]["minute"]]
    assert after_off["gap_minutes"] == pytest.approx(after_off["minute"] - (before[-1]["minute"] if before else 0), abs=0.1)
