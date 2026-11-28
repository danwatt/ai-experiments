"""Sunset is taken on each day's own date, and the day estimate counts the way to the hotel."""

from datetime import date, datetime, timedelta

import pytest

from app.models import PlanRequest
from app.planner import choices, clock, days as days_mod

from .phase4 import TL, wp, towns

START = datetime(2027, 9, 24, 14, 0)  # 08:00 MDT, as UTC


def overnights(points, cands, **kw):
    from app.planner import schedule

    wps, at = zip(*points)
    req = PlanRequest(waypoints=list(wps), depart="2027-09-24T08:00", **kw)
    analysis = {"waypoints": list(at), "candidates": cands}
    pl = schedule.places(req, analysis)
    prepared = choices.prepare(cands, [p.mile for p in pl if p.type != "through"], req.breaks, [], [], (), "all", 2)
    depart = schedule.start_utc(req, TL)
    return days_mod.Overnights(pl, prepared, req, TL, depart), req


def test_a_spot_knows_the_sunset_of_every_trip_day():
    ov, _ = overnights([wp("a", 0), wp("b", 900)], towns(every=50, lodging=4))
    spot = ov.stretches[0].spots[3]
    lat, lon = TL.at_mile(spot.mile)
    zone = clock.zone_at(lat, lon)
    for d in (0, 3, 6):
        sun = clock.sunset(lat, lon, date(2027, 9, 24) + timedelta(days=d), zone)
        assert spot.sunset(d) == sun.hour * 60 + sun.minute
    assert spot.sunset(6) < spot.sunset(0) - 5, "a week later in September the sun sets more than 5 minutes earlier at this latitude"


def test_each_stretch_counts_its_days_from_the_trip_start():
    """A user's overnight with two nights puts a rest day between the stretches."""
    ov, _ = overnights([wp("a", 0), wp("n", 400, type="overnight", nights=2), wp("b", 800)], towns(every=20, lodging=4))
    first, second = ov.stretches
    assert first.base_day == 0
    assert second.base_day == (len(first.path) - 1) - 1 + 2  # days driven, less one, plus the two nights


def test_the_day_estimate_uses_the_days_own_sunset_for_its_cost():
    ov, req = overnights([wp("a", 0), wp("b", 900)], towns(every=50, lodging=4), days={"stop_at_sunset": True, "arrive_by": "23:00"})
    st = ov.stretches[0]
    j = len(st.spots) - 1
    early = ov.day(st, 0, 3, 0)
    # Make day 0's sunset later than the arrival and day 5's earlier: the same day costs more on day 5.
    st.spots[3].sunset = lambda d: early.arrive + 30 if d == 0 else early.arrive - 30
    on_day_0, on_day_5 = ov.day(st, 0, 3, 0), ov.day(st, 0, 3, 5)
    assert on_day_5.day == 5 and on_day_0.day == 0
    assert on_day_5.cost - on_day_0.cost == pytest.approx(days_mod.OVER_COST * 30)
    assert j > 3


def test_the_path_passes_the_right_day_to_each_edge(monkeypatch):
    ov, _ = overnights([wp("a", 0), wp("b", 1000)], towns(every=50, lodging=4))
    st = ov.stretches[0]
    seen = []
    real = ov.day

    def spy(st_, i, j, done=0):
        out = real(st_, i, j, done)
        seen.append((j, done, out.day))
        return out

    monkeypatch.setattr(ov, "day", spy)
    path = ov.cheapest(st)
    assert len(path) >= 3
    assert all(day == done for _, done, day in seen)  # base 0 for the first stretch
    assert max(done for _, done, _ in seen) >= 1, "later days of the stretch were costed with their own day number"


def test_the_plans_sunset_per_day_differs_by_date():
    from .phase4 import run

    out = run([wp("a", 0), wp("b", 1000)], towns(every=20, lodging=4), depart="2027-09-24T08:00")
    suns = [d["sunset"] for d in out["days"] if d.get("sunset")]
    assert len(suns) >= 2 and [s[:10] for s in suns] == sorted({s[:10] for s in suns})


# ---------- detours in the arrival estimate ----------


def test_the_arrival_estimate_includes_half_the_hotels_detour():
    ov, req = overnights([wp("a", 0), wp("b", 900)], towns(every=50, lodging=4))
    st = ov.stretches[0]
    a, b = st.spots[0], st.spots[3]
    b.ref = {**b.ref, "detour_min": 0.0}
    base = days_mod.day_between(a, b, 480, 0, req)
    b.ref = {**b.ref, "detour_min": 10.0}  # there and back; the way in is half of it
    with_detour = days_mod.day_between(a, b, 480, 0, req)
    assert with_detour.arrive - base.arrive == pytest.approx(5.0)
    assert days_mod.hotel_detour(b) == 5.0
