"""From candidates to choices: names, skips, merges, costs, the detour limit (choices.py)."""

from app.models import BreakSettings, StopRef
from app.planner import candidates, choices

from .fakes import cand

S = BreakSettings()


def prep(cands, stop_miles=(0, 500), pins=(), skips=(), settings=S):
    return choices.prepare(cands, list(stop_miles), settings, [StopRef(key=k, name=n) for k, n in pins], [StopRef(key=k, name=n) for k, n in skips])


def test_a_loop_passing_a_place_twice_gives_two_passes():
    cands = [cand(7, 300), cand(7, 20), cand(8, 100)]
    choices.add_stop_keys(cands)
    assert {c["mile"]: c["stop_key"] for c in cands} == {20: "7#1", 100: "8#1", 300: "7#2"}


def test_the_detour_limit_is_five_minutes_each_way():
    assert candidates.DETOUR_LIMIT_MIN == 10  # the matrix detour is there and back
    assert choices.detour_ok(cand(1, 10, detour=9.5), S)
    assert not choices.detour_ok(cand(1, 10, detour=10.5), S)
    assert not choices.detour_ok(cand(1, 10, detour=7), BreakSettings(max_detour_each_way=3))
    assert not choices.detour_ok(cand(1, 10, status="unreachable"), S)


def test_candidates_mark_over_limit_at_ten_minutes_there_and_back():
    c = {}
    candidates.set_detour(c, (600, 500, 600), pace=1.0)  # 500 s = 8.3 min there and back
    assert not c["over_limit"]
    candidates.set_detour(c, (600, 700, 600), pace=1.0)  # 11.7 min
    assert c["over_limit"]


def test_preference_order_is_rest_area_plaza_services_any():
    kinds = [cand(1, 10, kind="rest_area", food=0, fuel=0), cand(2, 10, kind="service_plaza"), cand(3, 10, kind="exit", food=4, fuel=2),
             cand(4, 10, kind="exit", food=0, fuel=0)]
    costs = []
    for c in kinds:
        c["stop_kind"] = choices.stop_kind(c)
        costs.append(choices.stop_cost(c))
    assert [c["stop_kind"] for c in kinds] == ["rest_area", "service_plaza", "services", "any"]
    assert costs == sorted(costs) and len(set(costs)) == 4


def test_detour_and_thin_amenities_add_cost():
    a, b, c = cand(1, 10, detour=0, food=5, fuel=2), cand(2, 10, detour=4, food=5, fuel=2), cand(3, 10, detour=0, food=1, fuel=1)
    for x in (a, b, c):
        x["stop_kind"] = choices.stop_kind(x)
    assert choices.stop_cost(b) == choices.stop_cost(a) + 4
    assert choices.stop_cost(c) == choices.stop_cost(a) + choices.THIN_COST


def test_places_within_two_miles_merge_and_keep_the_best():
    # Glenwood Springs: the town and I-70 Exit 116 a mile apart are one stop.
    town = cand(1, 100, kind="town", name="Glenwood Springs", food=40, fuel=6, detour=2.5)
    exit_ = cand(2, 101, kind="exit", name="I 70 exit 116", food=12, fuel=3, detour=0.4)
    far = cand(3, 104, kind="exit", name="Exit 114")
    p = prep([town, exit_, far])
    assert [c["name"] for c in p.choices] == ["I 70 exit 116", "Exit 114"]
    first = p.choices[0]
    assert first["also"] == ["Glenwood Springs"] and first["members"] == ["1#1", "2#1"]


def test_a_merge_prefers_a_place_within_the_detour_limit():
    near_side = cand(1, 100, kind="exit", detour=3)
    far_side = cand(2, 100.5, kind="rest_area", food=0, fuel=0, detour=12)  # across the median
    assert prep([near_side, far_side]).choices[0]["id"] == 1


def test_a_pinned_member_represents_its_group():
    p = prep([cand(1, 100, detour=0), cand(2, 101, detour=3)], pins=[("2#1", "B")])
    assert p.choices[0]["id"] == 2 and p.choices[0]["pinned"]


def test_skipped_places_are_left_out_and_listed():
    p = prep([cand(1, 100), cand(2, 150)], skips=[("1#1", "A")])
    assert [c["id"] for c in p.choices] == [2]
    assert [c["id"] for c in p.skipped] == [1]
    assert p.dropped == []


def test_places_near_a_waypoint_the_trip_stops_at_are_left_out():
    p = prep([cand(1, 1.5), cand(2, 150), cand(3, 251), cand(4, 260)], stop_miles=(0, 250, 400))
    assert [c["id"] for c in p.choices] == [2, 4]


def test_pins_and_skips_no_longer_on_the_route_are_dropped_with_a_reason():
    p = prep([cand(1, 1.0), cand(2, 150)], pins=[("9#1", "Gone"), ("1#1", "At the start")], skips=[("8#2", "")])
    reasons = {d["key"]: (d["what"], d["reason"]) for d in p.dropped}
    assert reasons["9#1"] == ("pin", "is no longer on the route")
    assert reasons["8#2"] == ("skip", "is no longer on the route")
    assert reasons["1#1"] == ("pin", "is within 2 miles of a waypoint the trip stops at")


def test_prepare_leaves_the_candidate_list_alone():
    cands = [cand(1, 100), cand(2, 101)]
    prep(cands)
    assert "stop_key" not in cands[0] and "members" not in cands[0]
