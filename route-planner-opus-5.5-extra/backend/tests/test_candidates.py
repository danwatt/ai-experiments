"""Candidate stops along a route: projection, detour math (matrix mocked), caching."""

import pytest

from app import timeline, valhalla
from app.planner import candidates
from app.pois import db
from app.pois.clusters import build_clusters
from app.pois.extract import Extract, Poi

from .fakes import leg, line, trip

# A straight route east along latitude 39.0, 0.9 degrees of longitude (about 78 km, 48.5 mi), in 3600 s.
START, END = (39.0, -105.0), (39.0, -104.1)


def make_timeline(pace=1.0, points=None, seconds=3600, miles=48.5):
    return timeline.build(trip(leg(points or line(START, END, 181), seconds, miles)), pace)


def rest_area(name, lat, lon):
    return Poi(kind="rest_area", subkind="rest_area", name=name, lat=lat, lon=lon, osm_type="n", osm_id=abs(hash(name)) % 10**8)


@pytest.fixture()
def make_db(tmp_path):
    def build(*pois):
        path = tmp_path / "pois.sqlite"
        db.write_all(path, Extract(pois=list(pois)), build_clusters(list(pois)))
        return db.connect(path)

    return build


# ---------- the timeline ----------


def test_timeline_has_the_miles_and_minutes_the_sidebar_adds_up():
    tl = make_timeline(pace=1.05)
    assert tl.miles[0] == 0 and tl.miles[-1] == pytest.approx(48.5)
    assert tl.minutes[-1] == pytest.approx(3600 * 1.05 / 60)  # same as routing.minutes(...) for one leg
    mile, minute = tl.interpolate(tl.cum_m[-1] / 2)
    assert mile == pytest.approx(24.25, abs=0.05) and minute == pytest.approx(31.5, abs=0.1)


def test_timeline_at_mile_gives_a_point_on_the_route_and_clamps():
    tl = make_timeline()
    lat, lon = tl.at_mile(24.25)
    assert lat == pytest.approx(39.0) and lon == pytest.approx(-104.55, abs=0.002)
    assert tl.at_mile(-5) == pytest.approx(START) and tl.at_mile(500) == pytest.approx(END)


def test_timeline_over_two_legs_continues_the_clock():
    mid = (39.0, -104.55)
    tl = timeline.build(trip(leg(line(START, mid, 91), 1500, 24.0), leg(line(mid, END, 91), 2100, 24.5)), 1.0)
    assert tl.miles[-1] == pytest.approx(48.5) and tl.minutes[-1] == pytest.approx(60.0)
    assert len(tl.points) == 181  # the shared point is kept once


# ---------- finding candidates ----------


def test_find_projects_clusters_within_two_miles_onto_the_route(make_db):
    con = make_db(
        rest_area("on route", 39.0, -104.55),  # halfway
        rest_area("one mile north", 39.0145, -104.2),  # 1 mi off, 89 % of the way
        rest_area("five miles north", 39.072, -104.55),  # out of reach
    )
    found = candidates.find(con, make_timeline())
    assert [c["name"] for c in found] == ["on route", "one mile north"]
    first, second = found
    assert first["mile"] == pytest.approx(24.2, abs=0.3) and first["minute"] == pytest.approx(30.0, abs=0.5)
    assert first["off_route_m"] < 5
    assert second["mile"] == pytest.approx(43.1, abs=0.5) and 1400 < second["off_route_m"] < 1800
    assert first["key"].startswith(f"{first['id']}@")


def test_there_and_back_route_gives_one_candidate_per_pass(make_db):
    out = line(START, END, 91)
    back = line((39.001, -104.1), (39.001, -105.0), 91)  # about 110 m north of the way out
    tl = timeline.build(trip(leg(out, 1800, 24.0), leg(back, 1800, 24.0)), 1.0)
    con = make_db(rest_area("middle", 39.0005, -104.55))
    found = candidates.find(con, tl)
    assert len(found) == 2
    assert found[0]["mile"] == pytest.approx(12.0, abs=1.0) and found[1]["mile"] == pytest.approx(36.0, abs=1.0)
    assert found[0]["key"] != found[1]["key"]


def test_runs_groups_neighbouring_pieces():
    assert candidates.runs([2, 3, 4, 9, 10, 30]) == [[2, 3, 4], [9, 10], [30]]
    assert candidates.runs([]) == []


# ---------- detours, with the matrix mocked ----------


def fake_candidates(n, start=5.0):
    return [{"id": i, "lat": 39.0 + 0.001 * i, "lon": -104.9 + 0.01 * i, "mile": start + i, "minute": 5.0 + i} for i in range(n)]


def matrix_with(times, calls):
    """A stand-in for valhalla.matrix. `times(i)` gives (A->c, c->B, A->B) for the i-th candidate of the batch."""

    def matrix(sources, targets, **kw):
        n = len(sources) // 2
        calls.append(n)
        m = [[None] * len(targets) for _ in sources]
        for i in range(n):
            m[i][i], m[n + i][n + i], m[i][n + i] = times(i)
        return m

    return matrix


def test_detour_is_to_plus_from_minus_direct(monkeypatch):
    calls = []
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (600, 500, 900), calls))
    cands = fake_candidates(3)
    stats = candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert [c["detour_min"] for c in cands] == [3.3, 3.3, 3.3]  # (600 + 500 - 900) / 60
    assert all(not c["over_limit"] and c["detour_status"] == "ok" for c in cands)
    assert stats["matrix_calls"] == 1 and calls == [3]


def test_far_side_rest_area_comes_out_over_the_limit(monkeypatch):
    # Candidate 1 is across the median: getting back on your own side takes 8 minutes more.
    times = lambda i: (600, 500 + (480 if i == 1 else 0), 900)  # noqa: E731
    monkeypatch.setattr(valhalla, "matrix", matrix_with(times, []))
    cands = fake_candidates(3)
    candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert [c["over_limit"] for c in cands] == [False, True, False]
    assert cands[1]["detour_min"] == pytest.approx(11.3)  # kept, marked, not dropped


def test_detour_is_scaled_by_the_pace_and_never_negative(monkeypatch):
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (600, 500, 900) if i == 0 else (300, 300, 700), []))
    cands = fake_candidates(2)
    candidates.add_detours(cands, make_timeline(), pace=1.5, cache=candidates.DetourCache())
    assert cands[0]["detour_min"] == 5.0  # 200 s * 1.5 / 60
    assert cands[1]["detour_min"] == 0.0 and not cands[1]["over_limit"]


def test_unreachable_candidate_is_marked_not_dropped(monkeypatch):
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (None, 500, 900) if i == 0 else (600, 500, 900), []))
    cands = fake_candidates(2)
    candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert (cands[0]["detour_min"], cands[0]["detour_status"], cands[0]["over_limit"]) == (None, "unreachable", True)
    assert cands[1]["detour_status"] == "ok"


def test_candidates_go_to_valhalla_in_batches_of_twelve(monkeypatch):
    calls = []
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (600, 500, 900), calls))
    cands = fake_candidates(30)
    stats = candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert sorted(calls) == [6, 12, 12] and stats["matrix_calls"] == 3
    assert all(c["detour_status"] == "ok" for c in cands)


def test_a_batch_valhalla_refuses_is_halved(monkeypatch):
    calls = []

    def matrix(sources, targets, **kw):
        n = len(sources) // 2
        calls.append(n)
        if n > 2:
            raise valhalla.ValhallaError("Exceeded max distance", 154)
        m = [[None] * len(targets) for _ in sources]
        for i in range(n):
            m[i][i], m[n + i][n + i], m[i][n + i] = 600, 500, 900
        return m

    monkeypatch.setattr(valhalla, "matrix", matrix)
    cands = fake_candidates(5)
    candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert calls == [5, 2, 3, 1, 2]  # 5 refused -> 2 ok, 3 refused -> 1 and 2 ok
    assert all(c["detour_status"] == "ok" for c in cands)


def test_a_candidate_valhalla_always_refuses_is_unreachable(monkeypatch):
    def matrix(sources, targets, **kw):
        raise valhalla.ValhallaError("nope", 171)

    monkeypatch.setattr(valhalla, "matrix", matrix)
    cands = fake_candidates(2)
    candidates.add_detours(cands, make_timeline(), pace=1.0, cache=candidates.DetourCache())
    assert [c["detour_status"] for c in cands] == ["unreachable", "unreachable"]


def test_detours_are_remembered_so_the_same_trip_asks_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (600, 500, 900), calls))
    cache = candidates.DetourCache()
    tl = make_timeline()
    candidates.add_detours(fake_candidates(4), tl, pace=1.0, cache=cache)
    again = fake_candidates(4)
    stats = candidates.add_detours(again, tl, pace=1.0, cache=cache)
    assert calls == [4] and stats["cached"] == 4 and stats["matrix_calls"] == 0
    assert all(c["detour_min"] == 3.3 for c in again)


def test_other_road_options_do_not_share_cached_detours(monkeypatch):
    calls = []
    monkeypatch.setattr(valhalla, "matrix", matrix_with(lambda i: (600, 500, 900), calls))
    cache = candidates.DetourCache()
    tl = make_timeline()
    candidates.add_detours(fake_candidates(2), tl, pace=1.0, scope="tolls", cache=cache)
    candidates.add_detours(fake_candidates(2), tl, pace=1.0, scope="no tolls", cache=cache)
    assert calls == [2, 2]


def test_a_route_point_before_the_start_is_clamped(monkeypatch):
    seen = []

    def matrix(sources, targets, **kw):
        seen.append((sources[0], targets[-1]))
        return [[0] * len(targets) for _ in sources]

    monkeypatch.setattr(valhalla, "matrix", matrix)
    tl = make_timeline()
    candidates.add_detours([{"id": 1, "lat": 39.0, "lon": -104.99, "mile": 0.5, "minute": 1.0}], tl, pace=1.0, cache=candidates.DetourCache())
    a, _b = seen[0]
    assert (a.lat, a.lon) == pytest.approx(START)  # A is the start, not 3 miles before it
