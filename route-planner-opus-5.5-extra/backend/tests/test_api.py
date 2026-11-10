"""The HTTP layer: status codes and error shapes, with routing mocked."""

from fastapi.testclient import TestClient

from app import main, routing

client = TestClient(main.app)

TWO = [{"id": "a", "lat": 39.74, "lon": -104.99}, {"id": "b", "lat": 37.28, "lon": -107.88, "name": "Durango"}]


def test_zone_error_is_422_with_names():
    zone = {"id": "z", "name": "Durango box", "type": "avoid", "ring": [[-108, 37.2], [-107.8, 37.2], [-107.8, 37.4], [-108, 37.4]]}
    resp = client.post("/api/route", json={"waypoints": TWO, "zones": [zone]})
    assert resp.status_code == 422
    err = resp.json()["error"]
    assert err["code"] == "waypoint_in_avoid_zone" and err["zone_id"] == "z" and err["waypoint_id"] == "b"
    assert "Durango box" in err["message"]


def test_route_error_is_422(monkeypatch):
    def fail(req, client=None):
        raise routing.RouteError("No route connects these waypoints.", 442)

    monkeypatch.setattr(routing, "plan_route", fail)
    resp = client.post("/api/route", json={"waypoints": TWO})
    assert resp.status_code == 422
    assert resp.json()["error"] == {"code": "no_route", "message": "No route connects these waypoints.", "valhalla_code": 442}


def test_request_is_validated():
    assert client.post("/api/route", json={"waypoints": TWO[:1]}).status_code == 422
    bad_type = [dict(TWO[0], type="teleport"), TWO[1]]
    assert client.post("/api/route", json={"waypoints": bad_type}).status_code == 422
    assert client.post("/api/route", json={"waypoints": TWO, "depart": "tomorrow"}).status_code == 422


def test_success_passes_the_summary_through(monkeypatch):
    monkeypatch.setattr(routing, "plan_route", lambda req, client=None: {"total": {"miles": 1}, "seen": [w.id for w in req.waypoints]})
    resp = client.post("/api/route", json={"waypoints": TWO})
    assert resp.status_code == 200 and resp.json()["seen"] == ["a", "b"]


def test_search_endpoint_passes_query_and_limit(monkeypatch):
    seen = {}
    monkeypatch.setattr(main.db, "shared", lambda: "con")
    monkeypatch.setattr(main.db, "search", lambda con, q, limit: seen.update(q=q, limit=limit) or [{"name": "Fairplay"}])
    assert client.get("/api/search", params={"q": "fair", "limit": 99}).json() == {"results": [{"name": "Fairplay"}]}
    assert seen == {"q": "fair", "limit": 25}  # the limit is capped


def test_search_without_stop_data_is_503(monkeypatch):
    def missing():
        raise FileNotFoundError("no pois.sqlite")

    monkeypatch.setattr(main.db, "shared", missing)
    resp = client.get("/api/search", params={"q": "x"})
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "no_stop_data"


def test_route_stops_shares_route_errors_and_validation(monkeypatch):
    zone = {"id": "z", "name": "Durango box", "type": "avoid", "ring": [[-108, 37.2], [-107.8, 37.2], [-107.8, 37.4], [-108, 37.4]]}
    monkeypatch.setattr(main.db, "shared", lambda: "con")
    resp = client.post("/api/route/stops", json={"waypoints": TWO, "zones": [zone]})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "waypoint_in_avoid_zone"
    assert client.post("/api/route/stops", json={"waypoints": TWO[:1]}).status_code == 422


def test_route_stops_returns_the_analysis(monkeypatch):
    monkeypatch.setattr(main.db, "shared", lambda: "con")
    monkeypatch.setattr(main.analysis, "analyze", lambda req, con: {"candidates": [], "closures": [], "con": con, "pace": req.pace})
    resp = client.post("/api/route/stops", json={"waypoints": TWO, "pace": 1.1})
    assert resp.status_code == 200 and resp.json()["pace"] == 1.1 and resp.json()["con"] == "con"


# ---------- phase 3: /api/plan ----------

from app import seasonal, valhalla  # noqa: E402
from app.planner import analysis  # noqa: E402
from app.pois import db  # noqa: E402
from app.pois.clusters import build_clusters  # noqa: E402
from app.pois.extract import Extract, Poi  # noqa: E402

from .fakes import leg, line, trip  # noqa: E402

# A straight 200-mile, 3-hour road east along latitude 38.5, with one town half way.
ROAD_START, ROAD_END = (38.5, -104.0), (38.5, -100.3)
ROAD = [{"id": "s", "lat": ROAD_START[0], "lon": ROAD_START[1], "name": "West"}, {"id": "e", "lat": ROAD_END[0], "lon": ROAD_END[1], "name": "East"}]


def poi(kind, subkind, name, lat, lon, n):
    return Poi(kind=kind, subkind=subkind, name=name, lat=lat, lon=lon, osm_type="n", osm_id=n)


def fake_planner_backend(monkeypatch, tmp_path):
    """Valhalla, the closures check and the stop data replaced; returns the call counts."""
    mid = -102.15
    pois = [poi("place", "town", "Midtown", 38.505, mid, 1), poi("food", "restaurant", "Diner", 38.504, mid + 0.002, 2),
            poi("fuel", "fuel", "Gas", 38.503, mid - 0.002, 3)]
    path = tmp_path / "pois.sqlite"
    db.write_all(path, Extract(pois=pois), build_clusters(pois))
    con = db.connect(path)
    calls = {"route": 0, "matrix": 0}

    def post_route(body, client=None):
        calls["route"] += 1
        return {"trip": trip(leg(line(ROAD_START, ROAD_END, 201), 3 * 3600, 200))}

    def matrix(sources, targets, **kw):
        calls["matrix"] += 1
        n = len(sources) // 2
        m = [[None] * len(targets) for _ in sources]
        for i in range(n):
            m[i][i], m[n + i][n + i], m[i][n + i] = 600, 500, 1050
        return m

    monkeypatch.setattr(valhalla, "post_route", post_route)
    monkeypatch.setattr(valhalla, "matrix", matrix)
    monkeypatch.setattr(seasonal, "check", lambda *a, **k: [])
    monkeypatch.setattr(main.db, "shared", lambda: con)
    analysis._results.clear()
    monkeypatch.setattr(analysis.candidates, "CACHE", analysis.candidates.DetourCache())
    return calls


def test_plan_returns_candidates_and_a_schedule(monkeypatch, tmp_path):
    fake_planner_backend(monkeypatch, tmp_path)
    resp = client.post("/api/plan", json={"waypoints": ROAD, "depart": "2027-09-24T08:00"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["limit_minutes"] == 10 and len(out["candidates"]) == 1
    (brk,) = [r for r in out["plan"]["rows"] if r["type"] == "break"]
    assert brk["name"] == "Midtown" and brk["stop_key"] == out["candidates"][0]["stop_key"]
    assert brk["window"]["earliest_clock"] == "2027-09-24T09:30"  # 90 min after 08:00
    assert "09:30" <= brk["arrive"][11:] <= "10:00"  # the town is half way: 100 mi, about 95 min at pace 1.05
    assert out["plan"]["warnings"] == []


def test_replanning_after_a_pin_skip_or_settings_change_makes_no_valhalla_call(monkeypatch, tmp_path):
    calls = fake_planner_backend(monkeypatch, tmp_path)
    first = client.post("/api/plan", json={"waypoints": ROAD}).json()
    key = first["candidates"][0]["stop_key"]
    assert calls == {"route": 1, "matrix": 1}

    skipped = client.post("/api/plan", json={"waypoints": ROAD, "skips": [{"key": key, "name": "Midtown"}]}).json()
    # The road crosses into Central time in Kansas (phase 4 adds that row).
    assert [r["type"] for r in skipped["plan"]["rows"]] == ["start", "clock", "end"]
    assert skipped["plan"]["warnings"][0]["code"] == "long_gap"  # 3 h with nothing allowed

    pinned = client.post("/api/plan", json={"waypoints": ROAD, "pins": [{"key": key}], "breaks": {"every_minutes": 90, "minutes": 20}}).json()
    assert [r["type"] for r in pinned["plan"]["rows"]] == ["start", "break", "clock", "end"]
    assert pinned["plan"]["rows"][1]["pinned"] and pinned["plan"]["settings"]["minutes"] == 20
    assert calls == {"route": 1, "matrix": 1}  # the same route: everything came from the cache


def test_plan_validates_pins_and_settings():
    assert client.post("/api/plan", json={"waypoints": TWO, "pins": [{"key": "Fairplay"}]}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "breaks": {"hard_max": 0.5}}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "day_start": "8am"}).status_code == 422


# ---------- phase 4: meals, fuel, days and zones through /api/plan ----------


def test_plan_takes_meals_fuel_and_days_and_answers_with_days_and_zone_effects(monkeypatch, tmp_path):
    calls = fake_planner_backend(monkeypatch, tmp_path)
    body = {"waypoints": ROAD, "depart": "2027-09-24T10:00", "day_start": "07:30",
            "meals": {"food": "sitdown", "lunch": {"on": True, "start": "11:00", "end": "13:00", "minutes": 30}},
            "fuel": {"range_miles": 300}, "days": {"driving_minutes": 420, "stop_at_sunset": True}}
    out = client.post("/api/plan", json=body).json()
    plan = out["plan"]
    assert plan["meals"]["food"] == "sitdown" and plan["meals"]["lunch"]["minutes"] == 30
    assert plan["fuel"]["range_miles"] == 300 and plan["day_settings"]["start"] == "07:30" and plan["day_settings"]["stop_at_sunset"]
    assert plan["days"][0]["sunset"] and "chips" in plan["days"][0]
    assert plan["rows"][0]["tz"] == "MDT" and plan["rows"][-1]["tz"] == "CDT"
    # A zone that only moves stops: the plan says what it did, and Valhalla is not asked again.
    zone = {"id": "m", "name": "Midtown", "type": "no_meals", "ring": [[-102.2, 38.4], [-102.1, 38.4], [-102.1, 38.6], [-102.2, 38.6]]}
    zoned = client.post("/api/plan", json={**body, "zones": [zone]}).json()["plan"]
    assert zoned["zone_effects"]["m"]
    retyped = client.post("/api/plan", json={**body, "zones": [{**zone, "type": "prefer"}]}).json()["plan"]
    assert retyped["zone_effects"]["m"]
    assert calls == {"route": 1, "matrix": 1}


def test_plan_validates_phase_4_settings():
    assert client.post("/api/plan", json={"waypoints": TWO, "meals": {"lunch": {"start": "noon", "end": "13:30", "minutes": 45}}}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "fuel": {"range_miles": 10}}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "days": {"arrive_by": "7pm"}}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "meals": {"food": "vegan"}}).status_code == 422
    assert client.post("/api/plan", json={"waypoints": TWO, "pins": [{"key": "1#1", "kind": "brunch"}]}).status_code == 422
