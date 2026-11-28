"""Lunch, dinner and fuel in the stop plan (stops.py, through schedule.plan)."""

import random

from app.models import DaySettings, FuelSettings, MealSettings, StopRef
from app.planner import graph, stops

from .fakes import box, cand
from .phase4 import NO_MEALS, box_at, hhmm, rows_of, run, town, towns, wp

ONE_DAY = DaySettings(auto_overnights=False)


# ---------- meals ----------


def test_lunch_falls_inside_its_window_and_resets_the_break_clock():
    out = run([wp("a", 0), wp("b", 400)], towns(every=10, end=400), days=ONE_DAY)
    (lunch,) = rows_of(out, "lunch")
    assert "11:30" <= hhmm(lunch["arrive"]) <= "13:30"
    assert lunch["dwell"] == 45.5  # 45 min and the 0.5 min detour
    after = next(r for r in rows_of(out, "break") if r["minute"] > lunch["minute"])
    assert after["gap_minutes"] == round(after["minute"] - lunch["minute"], 1)  # counted from lunch
    assert lunch["window"]["meal"] == "lunch" and hhmm(lunch["window"]["earliest_clock"]) == "11:30"
    assert lunch["reason"].startswith("6 to eat")


def test_dinner_happens_at_an_overnight_reached_before_the_end_of_the_dinner_window():
    out = run([wp("a", 0), wp("n", 420, type="overnight"), wp("b", 500)], towns(every=10, end=500))
    night = rows_of(out, "overnight")[0]
    assert night["hotel_dinner"] and night["events"] == {"hotel_dinner": True}
    assert rows_of(out, "dinner") == []


def test_dinner_on_the_road_when_the_day_runs_past_the_dinner_window():
    out = run([wp("a", 0), wp("b", 600)], towns(every=10, end=600), depart="2027-09-24T10:00", days=ONE_DAY)
    (dinner,) = rows_of(out, "dinner")
    assert "17:30" <= hhmm(dinner["arrive"]) <= "19:30" and dinner["dwell"] == 60.5


def test_a_no_meals_zone_moves_lunch_and_says_so():
    first = rows_of(run([wp("a", 0), wp("b", 400)], towns(every=40, end=400), days=ONE_DAY), "lunch")[0]
    zone = box("m", *box_at(first["mile"]), type="no_meals", name="Montrose")
    out = run([wp("a", 0), wp("b", 400)], towns(every=40, end=400), days=ONE_DAY, zones=[zone])
    (lunch,) = rows_of(out, "lunch")
    assert lunch["name"] != first["name"]
    assert lunch["moved"] == f"moved from {first['name']}: no-meals zone"
    ruled = next(a for a in lunch["alternatives"] if a["name"] == first["name"])
    assert ruled["status"] == "ruled_out" and ruled["reason"] == "no-meals zone “Montrose”"
    assert out["zone_effects"]["m"] == [f"lunch on day 1 moved from {first['name']} to {lunch['name']}"]


def test_the_food_filter_rules_out_places_without_that_kind_of_food():
    cands = [dict(c, food_sitdown=0, food_fast=c["food"]) for c in towns(every=10, end=400)]
    cands[20] = dict(cands[20], food_sitdown=4, name="Diner")  # mile 220: the only sit-down restaurant
    out = run([wp("a", 0), wp("b", 400)], cands, days=ONE_DAY, meals=MealSettings(food="sitdown"))
    (lunch,) = rows_of(out, "lunch")
    assert lunch["name"] == "Diner"
    assert "no sit-down restaurant" in {a["reason"] for a in lunch["alternatives"] if a["status"] == "ruled_out"}
    fast = run([wp("a", 0), wp("b", 400)], cands, days=ONE_DAY, meals=MealSettings(food="fast"))
    assert len(rows_of(fast, "lunch")) == 1  # every town has fast food


def test_a_meal_that_cannot_happen_warns():
    # Food only at mile 50 and 380: nothing inside 11:30-13:30 (miles about 210-330).
    cands = [town(1, 50), town(2, 380), cand(3, 120, food=0, fuel=0, kind="rest_area"), cand(4, 240, food=0, fuel=0, kind="rest_area")]
    out = run([wp("a", 0), wp("b", 400)], cands, days=ONE_DAY, fuel=FuelSettings(on=False))
    assert rows_of(out, "lunch") == []
    (warning,) = [w for w in out["warnings"] if w["code"] == "no_lunch"]
    assert "nowhere to eat fits 11:30–13:30" in warning["message"]


def test_a_long_timed_stop_over_lunch_counts_as_lunch():
    out = run([wp("a", 0), wp("d", 200, minutes=180), wp("b", 400)], towns(every=20, end=400), days=ONE_DAY)
    dunes = rows_of(out, "stop")[0]
    assert dunes["events"] == {"during": ["lunch"]} and rows_of(out, "lunch") == []


def test_a_pinned_lunch_holds():
    cands = towns(every=20, end=400)
    out = run([wp("a", 0), wp("b", 400)], cands, days=ONE_DAY, pins=[StopRef(key="1240#1", name="T240", kind="lunch")])
    (lunch,) = rows_of(out, "lunch")
    assert lunch["name"] == "T240" and lunch["pinned"] and lunch["reason"].startswith("pinned by you")


# ---------- fuel ----------


def fills(out):
    """Miles where the tank is filled: refuels and overnights."""
    return [r["mile"] for r in out["rows"] if r.get("refuel") or r["type"] in ("start", "overnight")]


def test_fuel_is_bought_by_the_due_mile_and_merged_into_a_stop():
    out = run([wp("a", 0), wp("b", 700)], towns(every=25, end=700), days=ONE_DAY, meals=NO_MEALS)
    miles = fills(out)
    assert len(miles) >= 3 and all(b - a <= 300 for a, b in zip(miles, miles[1:] + [700]))
    merged = [r for r in out["rows"] if r.get("refuel")]
    assert all(r["type"] == "break" for r in merged)  # every fill-up rides on a break
    assert merged[0]["fuel_note"] == "merged: fuel was due by mile 300"


def test_a_fuel_only_stop_when_no_break_place_sells_fuel():
    rest = [cand(i, m, kind="rest_area", food=0, fuel=0) for i, m in enumerate(range(90, 600, 90), start=1)]
    gas = [cand(50, 250, kind="other", food=0, fuel=1, name="Lonely Gas")]
    out = run([wp("a", 0), wp("b", 450)], rest + gas, days=ONE_DAY, meals=NO_MEALS)
    (fuel,) = rows_of(out, "fuel")
    assert fuel["name"] == "Lonely Gas" and fuel["dwell"] == 10.5 and fuel["fuel_note"] == "fuel was due by mile 300"
    breaks = [r["minute"] for r in rows_of(out, "break")]
    assert all(abs(b - fuel["minute"]) >= 20 for b in breaks)  # never within 20 min of a break: that would merge


def test_a_fuel_stop_close_to_a_break_is_merged_into_it():
    rest = [cand(i, m, kind="rest_area", food=0, fuel=0) for i, m in enumerate(range(100, 500, 100), start=1)]
    gas = [cand(50, 210, kind="other", food=0, fuel=1, name="Gas by the rest area")]  # 10 min after the 200 rest area
    out = run([wp("a", 0), wp("b", 450)], rest + gas, days=ONE_DAY, meals=NO_MEALS)
    assert rows_of(out, "fuel") == []
    assert any(r["name"] == "Gas by the rest area" and r["refuel"] and r["type"] == "break" for r in out["rows"])


def test_the_tank_is_filled_at_each_overnight_and_carried_across_days():
    cands = towns(every=25, end=560)
    with_fill = run([wp("a", 0), wp("n", 250, type="overnight"), wp("b", 500)], cands, meals=NO_MEALS)
    assert [r for r in with_fill["rows"] if r.get("refuel")] == []  # 250 + 250, each under 300
    no_fill = run([wp("a", 0), wp("n", 250, type="overnight"), wp("b", 500)], cands, meals=NO_MEALS, fuel=FuelSettings(fill_at_overnight=False))
    assert [r["mile"] for r in no_fill["rows"] if r.get("refuel")]  # the tank carried over the night: fuel by mile 300
    assert all(r["mile"] <= 300 for r in no_fill["rows"] if r.get("refuel"))


def test_fuel_carries_through_a_timed_stop():
    out = run([wp("a", 0), wp("d", 200, minutes=60), wp("b", 450)], towns(every=25, end=450), days=ONE_DAY, meals=NO_MEALS)
    refuel = [r["mile"] for r in out["rows"] if r.get("refuel")]
    assert refuel and refuel[0] <= 300


def test_fuel_can_be_turned_off():
    out = run([wp("a", 0), wp("b", 700)], towns(every=25, end=700), days=ONE_DAY, fuel=FuelSettings(on=False))
    assert not any(r.get("refuel") for r in out["rows"]) and rows_of(out, "fuel") == []


# ---------- the state path against phase 3's break-only path ----------


def test_with_meals_and_fuel_off_the_state_path_is_the_break_path():
    rng = random.Random(4)
    rules = graph.Rules()
    for _ in range(40):
        miles = sorted(rng.sample(range(5, 495), rng.randint(3, 30)))
        nodes = [graph.Node(0, 0)] + [graph.Node(m, m * rng.uniform(0.9, 1.3), cost=rng.choice([0, 4, 8, 16])) for m in miles]
        nodes.sort(key=lambda n: n.minute)
        nodes.append(graph.Node(500, max(n.minute for n in nodes) + 20))
        want, level = graph.plan_segment(nodes, rules)
        labels, slevel = stops.plan_segment(nodes, stops.Setup(rules=rules), stops.Start(clock=0))
        got = [lab.node for lab in labels]
        cost = lambda path: sum(  # noqa: E731
            graph.gap_cost(graph.share(nodes[a], nodes[b], rules.relaxed(level)), rules.relaxed(level), to_end=b == len(nodes) - 1)
            + (0 if b == len(nodes) - 1 else graph.node_cost(nodes[b], rules.relaxed(level)))
            for a, b in zip(path, path[1:])
        )
        assert (level == 2) == (slevel == 3) and abs(cost(got) - cost(want)) < 1e-6, (miles, want, got)
