"""Start from here, now: the position becomes the start; passed waypoints, pins and skips go."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import here, main
from app.models import PlanRequest, StopRef
from app.planner import choices

from .fakes import cand, leg, line, trip
from .phase4 import TL, towns, wp

client = TestClient(main.app)
NOW = datetime(2027, 9, 25, 20, 30, tzinfo=timezone.utc)  # 14:30 in Denver


def analysis(cands, *miles):
    cs = [dict(c) for c in cands]
    choices.add_stop_keys(cs)
    ids = ["a", "b", "c", "d"]
    return {"waypoints": [{"id": i, "mile": m, "minute": m} for i, m in zip(ids, miles)], "candidates": cs}


def request(**kw):
    ws = [wp("a", 0)[0], wp("b", 300, type="stop")[0], wp("c", 600, type="through")[0], wp("d", 900)[0]]
    return PlanRequest(waypoints=ws, depart="2027-09-24T08:00", **kw)


def at(mile, off=0.0):
    lat, lon = TL.at_mile(mile)
    return lat, lon + off


def test_passed_waypoints_go_and_the_position_is_the_new_start():
    out = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(350), NOW)
    assert out["mile"] == pytest.approx(350, abs=1.5) and out["miles_left"] == pytest.approx(550, abs=1.5)
    assert [w["id"] for w in out["waypoints"][1:]] == ["c", "d"]  # b (mile 300) is behind; the end stays
    first = out["waypoints"][0]
    assert first["name"] == "Current position" and first["type"] == "stop" and first["lat"] == pytest.approx(at(350)[0], abs=1e-5)
    assert out["dropped"]["waypoints"] == ["A", "B"]


def test_departure_is_now_in_the_local_time_there():
    out = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(350), NOW)
    assert out["depart"] == "2027-09-25T14:30"  # 20:30Z in Mountain daylight time
    winter = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(350), datetime(2027, 12, 1, 20, 30, tzinfo=timezone.utc))
    assert winter["depart"] == "2027-12-01T13:30"  # standard time
    with pytest.raises(here.HereError, match="time zone"):
        here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(350), datetime(2027, 9, 25, 14, 30))


def test_a_waypoint_just_ahead_is_kept_and_one_just_behind_is_dropped():
    out = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(299.8), NOW)
    assert [w["id"] for w in out["waypoints"][1:]] == ["c", "d"]  # within half a mile counts as passed
    out = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(296), NOW)
    assert [w["id"] for w in out["waypoints"][1:]] == ["b", "c", "d"]


def test_settings_zones_pins_and_skips_ahead_are_kept_and_behind_are_dropped():
    cands = [cand(11, 150, name="Behind"), cand(12, 450, name="Ahead"), cand(13, 700, name="Further")]
    pins = [StopRef(key="11#1", name="Behind", kind="lunch"), StopRef(key="12#1", name="Ahead", kind="overnight")]
    skips = [StopRef(key="13#1", name="Further"), StopRef(key="99#1", name="Unknown")]
    req = request(pins=pins, skips=skips)
    out = here.start_from_here(req, analysis(cands, 0, 300, 600, 900), TL, *at(350), NOW)
    assert [(p["key"], p["kind"]) for p in out["pins"]] == [("12#1", "overnight")]
    assert [s["key"] for s in out["skips"]] == ["13#1", "99#1"]  # an unknown key is left for the planner to report
    assert out["dropped"]["pins"] == ["Behind"] and out["dropped"]["skips"] == []


def test_pass_numbers_are_counted_from_the_new_start():
    """The same place passed twice: the key of its second pass becomes the first once the first is behind."""
    cands = [cand(7, 100, name="Twice"), cand(7, 800, name="Twice")]
    out = here.start_from_here(request(pins=[StopRef(key="7#2", name="Twice")]), analysis(cands, 0, 300, 600, 900), TL, *at(350), NOW)
    assert [p["key"] for p in out["pins"]] == ["7#1"]


def test_arriving_at_the_end_is_refused():
    with pytest.raises(here.HereError, match="end of the trip"):
        here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(899.8), NOW)


def test_a_position_off_the_route_still_works_and_says_how_far():
    out = here.start_from_here(request(), analysis(towns(), 0, 300, 600, 900), TL, *at(350, off=0.05), NOW)  # 0.05 degrees of longitude is about 4.4 km east of the road
    assert out["off_m"] == pytest.approx(4400, rel=0.1) and out["mile"] == pytest.approx(350, abs=2)


# ---------- a loop passes the same place twice ----------

OUT_AND_BACK = timeline = None


def loop_timeline():
    from app import timeline

    out = line((39.0, -105.0), (39.0, -104.0), 101)
    back = line((39.0004, -104.0), (39.0004, -105.0), 101)  # 45 m north of the way out
    return timeline.build(trip(leg(out, 3600, 54.0), leg(back, 3600, 54.0)), 1.0)


def test_a_loop_position_near_two_passes_asks_which_one():
    tl = loop_timeline()
    req = PlanRequest(waypoints=[wp("a", 0)[0], wp("d", 108)[0]], depart="2027-09-24T08:00")
    an = {"waypoints": [{"id": "a", "mile": 0, "minute": 0}, {"id": "d", "mile": 108, "minute": 120}], "candidates": []}
    lat, lon = 39.0002, -104.5
    asked = here.start_from_here(req, an, tl, lat, lon, NOW)
    assert asked["ambiguous"] and [round(p["mile"]) for p in asked["passes"]] == [27, 81]
    out = here.start_from_here(req, an, tl, lat, lon, NOW, mile=asked["passes"][1]["mile"])
    assert not out["ambiguous"] and out["mile"] == pytest.approx(81, abs=1) and out["miles_left"] == pytest.approx(27, abs=1)


# ---------- the endpoint ----------


def test_the_endpoint_takes_the_trip_and_the_position(monkeypatch):
    an = analysis(towns(), 0, 300, 600, 900)
    monkeypatch.setattr(main.analysis, "analyze_with_timeline", lambda req, con: (an, TL))
    monkeypatch.setattr(main.db, "shared", lambda: None)
    ws = [{"id": w.id, "lat": w.lat, "lon": w.lon, "name": w.name, "type": w.type} for w in request().waypoints]
    lat, lon = at(350)
    ok = client.post("/api/trip/start-from-here", json={"trip": {"waypoints": ws}, "lat": lat, "lon": lon, "now": "2027-09-25T20:30:00Z"})
    assert ok.status_code == 200 and ok.json()["depart"] == "2027-09-25T14:30" and len(ok.json()["waypoints"]) == 3
    end = client.post("/api/trip/start-from-here", json={"trip": {"waypoints": ws}, "lat": at(899.9)[0], "lon": at(899.9)[1], "now": "2027-09-25T20:30:00Z"})
    assert end.status_code == 422 and end.json()["error"]["code"] == "start_from_here"
    assert client.post("/api/trip/start-from-here", json={"trip": {"waypoints": ws}, "lat": 99, "lon": 0, "now": "2027-09-25T20:30:00Z"}).status_code == 422
