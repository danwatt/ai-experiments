"""The whole break plan with clock times, on a hand-made 600-mile route at 60 mph (schedule.py)."""

from app import timeline
from app.models import BreakSettings, DaySettings, FuelSettings, MealSettings, PlanRequest, StopRef, Waypoint
from app.planner import schedule

from .fakes import cand, leg, line, trip

# Along latitude 39 through Utah and Colorado, all in Mountain time. (Until
# phase 4 this ran east into Kansas; the clock now changes at the Central
# time line there, so the break tests moved west.)
TL = timeline.build(trip(leg(line((39.0, -113.5), (39.0, -102.4), 601), 600 * 60, 600)), 1.0)

# These are the phase 3 break tests: meals, fuel and automatic overnights off.
BREAKS_ONLY = dict(
    meals=MealSettings(lunch={"on": False, "start": "11:30", "end": "13:30", "minutes": 45},
                       dinner={"on": False, "start": "17:30", "end": "19:30", "minutes": 60}),
    fuel=FuelSettings(on=False),
    days=DaySettings(auto_overnights=False),
)


def wp(id, mile, type="stop", **kw):
    return Waypoint(id=id, lat=39.0, lon=-105.0 + mile / 55, name=id.upper(), type=type, **kw), {"id": id, "mile": mile, "minute": mile}


def run(points, cands, depart="2027-09-24T08:00", **kw):
    """Plan a trip whose waypoints sit at the given miles (minute == mile)."""
    wps, at = zip(*points)
    req = PlanRequest(waypoints=list(wps), depart=depart, **{**BREAKS_ONLY, **kw})
    return schedule.plan(req, {"waypoints": list(at), "candidates": cands}, TL)


def rows_of(out, *types):
    return [r for r in out["rows"] if not types or r["type"] in types]


def test_a_break_adds_its_minutes_and_its_detour_to_the_clock():
    out = run([wp("a", 0), wp("b", 200)], [cand(1, 100, detour=2.0)])
    (brk,) = rows_of(out, "break")
    assert brk["arrive"] == "2027-09-24T09:40" and brk["dwell"] == 17 and brk["depart"] == "2027-09-24T09:57"
    assert rows_of(out, "end")[0]["arrive"] == "2027-09-24T11:37"  # 200 min driving + 17 stopped


def test_a_timed_stop_adds_its_minutes_and_resets_the_break_clock():
    stop = wp("s", 100, minutes=60)
    out = run([wp("a", 0), stop, wp("b", 300)], [cand(1, 50), cand(2, 200), cand(3, 230)])
    names = [(r["type"], r.get("name")) for r in out["rows"]]
    assert names == [("start", "A"), ("stop", "S"), ("break", "place 2"), ("end", "B")]
    s = rows_of(out, "stop")[0]
    assert (s["arrive"], s["depart"]) == ("2027-09-24T09:40", "2027-09-24T10:40")
    assert rows_of(out, "break")[0]["gap_minutes"] == 100  # counted from the timed stop, not the start


def test_an_overnight_starts_the_next_day_at_the_day_start_time_after_its_nights():
    night = wp("n", 300, type="overnight", nights=2)
    out = run([wp("a", 0), night, wp("b", 400)], [cand(1, 100), cand(2, 200), cand(3, 350)], day_start="08:30")
    n = rows_of(out, "overnight")[0]
    assert n["arrive"].startswith("2027-09-24") and n["depart"] == "2027-09-26T08:30"
    assert (n["day"], n["depart_day"]) == (1, 3)
    end = rows_of(out, "end")[0]
    assert end["arrive"] == "2027-09-26T10:10" and end["day"] == 3  # 100 min after leaving, no break needed
    assert [d["driving"] for d in out["days"]] == [True, False, True]
    assert out["days"][1]["at"] == "N" and out["days"][2]["miles"] == 100


def test_a_through_point_does_not_split_the_segment():
    thru = wp("t", 100, type="through")
    out = run([wp("a", 0), thru, wp("b", 220)], [cand(1, 105), cand(2, 110)])
    brk = rows_of(out, "break")[0]
    assert brk["gap_minutes"] in (105, 110)  # counted from the start: the through point is not a stop
    assert [r["type"] for r in out["rows"]] == ["start", "through", "break", "end"]


def test_window_due_time_and_alternatives():
    out = run([wp("a", 0), wp("b", 200)], [cand(1, 80), cand(2, 100), cand(3, 110, detour=30), cand(4, 60)])
    brk = rows_of(out, "break")[0]
    w = brk["window"]
    assert (w["earliest_minute"], w["latest_minute"], w["hard_minute"]) == (90, 120, 132)
    assert (w["earliest_clock"], w["latest_clock"]) == ("2027-09-24T09:30", "2027-09-24T10:00")
    alts = {a["name"]: a for a in brk["alternatives"]}
    assert alts["place 2"]["status"] == "chosen"
    assert alts["place 1"]["status"] == "ok" and alts["place 1"]["reason"].startswith("fuel and food · early: 1 h 20 after A")
    assert alts["place 4"]["status"] == "ruled_out" and alts["place 4"]["reason"] == "leaves 2 h 20 to B"
    assert alts["place 3"]["status"] == "ruled_out" and "over the 10 min limit" in alts["place 3"]["reason"]
    assert alts["place 1"]["arrive"] == "2027-09-24T09:20"
    dues = [d["clock"] for d in out["due"]]
    assert dues == ["2027-09-24T10:00", "2027-09-24T11:55"]  # 120 min after leaving the start, and after the break (15.5 min stop)
    assert out["days"][0]["next_due"]["clock"] == "2027-09-24T11:55"


def test_a_skipped_stop_shows_as_skipped_and_a_pin_holds():
    cands = [cand(1, 95), cand(2, 100), cand(3, 200)]
    out = run([wp("a", 0), wp("b", 300)], cands, skips=[StopRef(key="2#1", name="place 2")], pins=[StopRef(key="1#1", name="place 1")])
    brks = rows_of(out, "break")
    assert brks[0]["name"] == "place 1" and brks[0]["pinned"]
    assert brks[0]["reason"].startswith("pinned by you")
    assert any(a["status"] == "skipped" and a["name"] == "place 2" for a in brks[0]["alternatives"])


def test_a_long_empty_stretch_gives_a_warning_that_names_it():
    out = run([wp("a", 0), wp("b", 400)], [cand(1, 100, name="Saguache"), cand(2, 250, name="Del Norte"), cand(3, 340)])
    (warning,) = [w for w in out["warnings"] if w["code"] == "long_gap"]
    assert warning["message"] == "No stop between Saguache and Del Norte within 2 h 12; longest gap 2 h 30."
    assert [r["name"] for r in rows_of(out, "break")] == ["Saguache", "Del Norte", "place 3"]


def test_settings_change_the_interval():
    cands = [cand(i, i) for i in range(10, 300, 10)]
    out = run([wp("a", 0), wp("b", 300)], cands, breaks=BreakSettings(every_minutes=60, minutes=10))
    times = [r["minute"] for r in rows_of(out, "break")]
    assert all(45 <= b - a <= 60 for a, b in zip([0] + times, times))
    assert all(r["dwell"] == 10.5 for r in rows_of(out, "break"))  # 10 min plus the 0.5 min detour


def test_no_departure_date_means_today_at_the_day_start():
    out = run([wp("a", 0), wp("b", 50)], [], depart=None, day_start="07:15")
    assert out["rows"][0]["depart"].endswith("T07:15")
