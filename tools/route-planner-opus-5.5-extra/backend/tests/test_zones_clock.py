"""Stop zones, time zones, sunset and "avoid this road" (phase 4)."""

from datetime import date, datetime, timedelta

from app import seasonal, timeline, zones
from app.geometry import ring_contains
from app.models import DaySettings, FuelSettings
from app.planner import choices, clock
from app.models import BreakSettings

from .fakes import box, cand, leg, line, trip
from .phase4 import NO_MEALS, box_at, hhmm, rows_of, run, town, towns, wp

ONE_DAY = DaySettings(auto_overnights=False)


# ---------- each zone type, on the candidates ----------


def prepared(cands, zs, **kw):
    return choices.prepare(cands, [0.0, 1000.0], BreakSettings(), [], [], zs, **kw)


def test_no_stops_takes_a_place_out_for_everything_and_keeps_it_for_the_picker():
    p = prepared([town(1, 100, name="Metro"), town(2, 200)], [box("z", *box_at(100), type="no_stops", name="Denver metro")])
    assert [c["name"] for c in p.choices] == ["T200"]
    assert [c["name"] for c in p.zoned] == ["Metro"] and p.zoned[0]["blocked"]["break"] == "no-stops zone “Denver metro”"
    assert [c["name"] for c in p.lodging] == ["T200"]


def test_no_meals_keeps_breaks_and_fuel_but_not_meals():
    p = prepared([town(1, 100, name="Montrose")], [box("z", *box_at(100), type="no_meals", name="Montrose")])
    (c,) = p.choices
    assert c["meal"] is None and c["meal_why_not"] == "no-meals zone “Montrose”" and c["fuel"] > 0
    assert "overnight" not in c["blocked"] and p.lodging


def test_no_overnight_keeps_breaks_and_meals_but_not_the_night():
    p = prepared([town(1, 100, name="Aspen")], [box("z", *box_at(100), type="no_overnight", name="Aspen")])
    (c,) = p.choices
    assert c["meal"] is not None and p.lodging == [] and p.lodging_blocked[0]["name"] == "Aspen"


def test_prefer_lowers_the_cost_by_the_bonus_and_wins_a_close_call():
    plain = prepared([town(1, 100)], [])
    liked = prepared([town(1, 100)], [box("z", *box_at(100), type="prefer", name="Glenwood")])
    assert liked.choices[0]["cost"] == plain.choices[0]["cost"] - choices.PREFER_BONUS
    assert liked.choices[0]["prefer"] == "prefer zone “Glenwood”"
    # A break: two places in the window, the slightly later one preferred.
    cands = [town(1, 100, name="Early"), town(2, 105, name="Liked", detour=3.0)]
    out = run([wp("a", 0), wp("b", 200)], cands, days=ONE_DAY, meals=NO_MEALS, fuel=FuelSettings(on=False))
    assert rows_of(out, "break")[0]["name"] == "Early"
    out = run([wp("a", 0), wp("b", 200)], cands, days=ONE_DAY, meals=NO_MEALS, fuel=FuelSettings(on=False),
              zones=[box("z", *box_at(105, 0.02), type="prefer", name="Liked")])
    brk = rows_of(out, "break")[0]
    assert brk["name"] == "Liked" and brk["moved"] == "⭐ prefer zone: instead of Early"


def test_a_switched_off_zone_does_nothing():
    p = prepared([town(1, 100)], [box("z", *box_at(100), type="no_stops", enabled=False)])
    assert len(p.choices) == 1 and p.zoned == []


def test_no_stops_moves_a_break_and_the_zone_says_what_it_did():
    cands = towns(every=10, end=300)
    first = rows_of(run([wp("a", 0), wp("b", 300)], cands, days=ONE_DAY, meals=NO_MEALS), "break")[0]
    out = run([wp("a", 0), wp("b", 300)], cands, days=ONE_DAY, meals=NO_MEALS, zones=[box("z", *box_at(first["mile"], 0.02), type="no_stops", name="Town")])
    brk = rows_of(out, "break")[0]
    assert brk["name"] != first["name"] and brk["moved"] == f"moved from {first['name']}: no-stops zone"
    ruled = [a for a in brk["alternatives"] if a["name"] == first["name"]]
    assert ruled and ruled[0]["reason"] == "in the no-stops zone “Town”"


def test_a_zone_the_route_only_crosses_says_so():
    out = run([wp("a", 0), wp("b", 300)], towns(every=10, end=300), days=ONE_DAY,
              zones=[box("far", 45.0, -100.0, 45.1, -99.9, type="no_meals", name="Elsewhere")])
    assert out["zone_effects"]["far"] == ["not on this route"]


def test_stop_zones_never_change_the_route_request():
    from app.models import PlanRequest

    req = PlanRequest(waypoints=[wp("a", 0)[0], wp("b", 10)[0]], zones=[box("a", 1, 1, 2, 2), box("m", 1, 1, 2, 2, type="no_meals"),
                                                                         box("o", 1, 1, 2, 2, enabled=False)])
    assert [z.id for z in req.analysis_request().zones] == ["a"]


def test_zone_rules_by_purpose():
    z = {t: box(t, 0, 0, 1, 1, type=t) for t in zones.STOP_ZONE_TYPES}
    assert zones.ruled_out_by("break", [z["no_meals"], z["prefer"]]) is None
    assert zones.ruled_out_by("lunch", [z["prefer"], z["no_meals"]]).type == "no_meals"
    assert zones.ruled_out_by("overnight", [z["no_stops"]]).type == "no_stops"
    assert zones.ruled_out_by("fuel", [z["no_overnight"]]) is None


# ---------- time zones ----------

# Amarillo, TX (Central) west to Albuquerque, NM (Mountain): the Texas / New
# Mexico line is near longitude -103.04. 290 mi at 60 mph.
AMARILLO, ALBUQUERQUE = (35.19, -101.83), (35.08, -106.65)
TX_NM = timeline.build(trip(leg(line(AMARILLO, ALBUQUERQUE, 291), 290 * 60, 290)), 1.0)


def test_crossings_finds_the_texas_new_mexico_line():
    ((mile, before, after),) = clock.crossings(TX_NM, 0, 290)
    assert before.key == "America/Chicago" and after.key == "America/Denver"
    lat, lon = TX_NM.at_mile(mile)
    assert abs(lon - -103.04) < 0.05


def test_the_itinerary_gets_a_clock_change_row_and_local_times():
    out = run([wp("a", 0), wp("b", 290)], towns(every=20, end=290), tl=TX_NM, days=ONE_DAY, meals=NO_MEALS)
    types = [r["type"] for r in out["rows"]]
    assert types.count("clock") == 1
    clk = rows_of(out, "clock")[0]
    assert clk["shift_minutes"] == -60 and clk["tz"] == "MDT" and clk["before_tz"] == "CDT"
    assert datetime.fromisoformat(clk["before"]) - datetime.fromisoformat(clk["arrive"]) == timedelta(hours=1)  # 15:00 CDT is 14:00 MDT
    start, end = out["rows"][0], out["rows"][-1]
    assert start["tz"] == "CDT" and end["tz"] == "MDT"
    stopped = sum(r.get("dwell", 0) for r in out["rows"] if r["type"] == "break")
    # 08:00 CDT + 290 min driving + stops, shown an hour earlier on Mountain time.
    minutes = 8 * 60 + 290 + stopped - 60
    assert hhmm(end["arrive"]) == f"{int(minutes // 60):02d}:{int(round(minutes % 60)):02d}"
    rows = out["rows"]
    i = rows.index(clk)
    assert all(r["tz"] == "CDT" for r in rows[:i]) and all(r["tz"] == "MDT" for r in rows[i:])


def test_meal_windows_are_local_time_where_the_meal_happens():
    # Leaving Amarillo at 10:30 CDT: 11:30 local is reached in Texas, 13:30 local
    # in New Mexico is 14:30 by the Texas clock. Lunch lands inside the window
    # by the clock of the place where it happens.
    out = run([wp("a", 0), wp("b", 290)], towns(every=15, end=290), tl=TX_NM, days=ONE_DAY, depart="2027-09-24T10:30")
    (lunch,) = rows_of(out, "lunch")
    assert "11:30" <= hhmm(lunch["arrive"]) <= "13:30"


def test_colorado_has_one_zone():
    assert clock.zone_at(39.74, -104.99).key == clock.zone_at(37.28, -107.88).key == "America/Denver"


# ---------- sunset ----------


def test_sunset_is_on_each_day_and_arriving_after_dark_warns():
    # December: sunset near 17:00 on this route; leaving at 10:00 for 9 hours arrives in the dark.
    out = run([wp("a", 0), wp("b", 540)], towns(every=20, end=540), depart="2027-12-20T10:00", days=ONE_DAY)
    day = out["days"][0]
    assert day["sunset"] and "16:30" <= hhmm(day["sunset"]) <= "17:30"
    assert any(c["code"] == "after_dark" for c in day["chips"])
    assert any(w["code"] == "after_dark" for w in out["warnings"])
    assert rows_of(out, "end")[0]["after_dark"]


def test_stop_driving_at_sunset_ends_the_day_before_dark():
    cands = towns(every=20, end=450)
    plain = run([wp("a", 0), wp("b", 450)], cands, depart="2027-12-20T09:00")
    sunset = run([wp("a", 0), wp("b", 450)], cands, depart="2027-12-20T09:00", days=DaySettings(stop_at_sunset=True))
    assert not rows_of(plain, "overnight")  # 7 h 30 arriving about 18:00: inside the limits, but after dark
    assert any(w["code"] == "after_dark" for w in plain["warnings"])
    night = [r for r in rows_of(sunset, "overnight") if r["auto"]]
    assert night and not night[0].get("after_dark")


def test_sunset_function():
    zone = clock.zone_at(39.74, -104.99)
    s = clock.sunset(39.74, -104.99, date(2027, 9, 24), zone)
    assert "18:50" <= s.strftime("%H:%M") <= "18:56"  # Denver, late September


# ---------- "avoid this road" ----------


def test_the_avoid_ring_covers_every_way_of_a_closed_road():
    pts = [(40.40 + i * 0.01, -105.70 + (i % 3) * 0.01) for i in range(20)]
    ring = seasonal.avoid_ring(pts)
    assert ring[0] == ring[-1] and len(ring) < 80
    assert all(ring_contains([tuple(p) for p in ring], lat, lon) for lat, lon in pts)
    assert not ring_contains([tuple(p) for p in ring], 40.0, -105.0)
    assert seasonal.avoid_ring([]) is None


def test_only_a_closed_road_gets_an_avoid_ring():
    from app.planner.analysis import place_closures

    pts = [(39.0, -105.0 + i / 60) for i in range(5)]
    closures = [{"level": "closed", "points": pts}, {"level": "open", "points": pts}, {"level": "check", "points": pts}]
    place_closures(closures, timeline.build(trip(leg(line((39.0, -105.0), (39.0, -104.0), 11), 3600, 54)), 1.0))
    assert closures[0]["avoid_ring"] and closures[1]["avoid_ring"] is None and closures[2]["avoid_ring"] is None
    assert closures[0]["miles"] is not None


def test_cand_helper_is_on_latitude_39():
    assert cand(1, 60)["lon"] == -104.0
