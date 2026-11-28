"""The zone library: shared zones, per-trip switches, trip-only zones, GeoJSON, and "what if I switch it on"."""

import json

import pytest
from fastapi.testclient import TestClient

from app import library, main, trips, valhalla, whatif
from app.models import PlanRequest, Waypoint, Zone
from app.planner import choices

from .fakes import box, leg, line, trip
from .phase4 import TL, box_at, town, towns, wp

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def folders(tmp_path, monkeypatch):
    monkeypatch.setattr(trips, "TRIPS_DIR", tmp_path / "trips")
    monkeypatch.setattr(trips, "EXAMPLES_DIR", tmp_path / "examples")
    (tmp_path / "trips").mkdir()
    (tmp_path / "examples").mkdir()
    return tmp_path


SQUARE = [[-105, 39], [-104, 39], [-104, 40], [-105, 40], [-105, 39]]


def zone(id, name="Z", type="no_stops", ring=SQUARE, shape="rectangle"):
    return {"id": id, "name": name, "type": type, "ring": ring, "shape": shape}


def test_the_library_starts_from_the_example_zones_until_the_user_changes_it(folders):
    trips.write_json(folders / "examples" / "zones.json", {"version": 1, "zones": [zone("boulder", "Boulder", "avoid")]})
    first = client.get("/api/zones").json()
    assert first["seeded"] is True and [z["id"] for z in first["zones"]] == ["boulder"]
    assert not (folders / "trips" / "zones.json").exists()  # reading does not write
    saved = client.put("/api/zones", json={"zones": first["zones"] + [zone("mine", "Mine", "prefer")]}).json()
    assert saved["seeded"] is False and [z["id"] for z in saved["zones"]] == ["boulder", "mine"]
    assert json.loads((folders / "trips" / "zones.json").read_text())["zones"][1]["name"] == "Mine"
    trips.write_json(folders / "examples" / "zones.json", {"version": 1, "zones": []})  # the seed is no longer used
    assert [z["id"] for z in client.get("/api/zones").json()["zones"]] == ["boulder", "mine"]


def test_the_library_keeps_shape_and_type_but_not_the_trips_switch():
    out = client.put("/api/zones", json={"zones": [{**zone("a"), "enabled": False}]}).json()
    assert "enabled" not in out["zones"][0] and out["zones"][0]["ring"][0] == [-105, 39]
    assert client.put("/api/zones", json={"zones": [zone("a"), zone("a")]}).status_code == 422  # one id twice
    assert client.put("/api/zones", json={"zones": [zone("a", ring=[[0, 0], [1, 1]])]}).status_code == 422  # not a ring
    assert client.put("/api/zones", json={"zones": [zone("a", type="nonsense")]}).status_code == 422


def test_a_trip_stores_which_library_zones_are_on_plus_its_own_zones(folders):
    client.put("/api/zones", json={"zones": [zone("lib1", "Library one", "avoid"), zone("lib2", "Library two", "prefer")]})
    doc = {"name": "T", "waypoints": [{"id": "a", "lat": 39, "lon": -105}, {"id": "b", "lat": 38, "lon": -105}],
           "library_on": ["lib2"], "zones": [{**zone("mine", "Only here", "no_meals"), "enabled": True}]}
    client.put("/api/trips/t", json=doc)
    saved = client.get("/api/trips/t").json()
    assert saved["library_on"] == ["lib2"] and [z["id"] for z in saved["zones"]] == ["mine"]  # no copy of lib2's shape in the trip
    assert "Library two" not in (folders / "trips" / "t.json").read_text()
    # Another trip switches the same library zone on and the other one off: the library is shared.
    client.put("/api/trips/u", json={**doc, "name": "U", "library_on": ["lib1"], "zones": []})
    assert client.get("/api/trips/u").json()["library_on"] == ["lib1"]
    # Changing a library zone changes it for both: the files do not hold a copy.
    client.put("/api/zones", json={"zones": [zone("lib1", "Renamed", "avoid"), zone("lib2", "Library two", "prefer")]})
    assert "Renamed" not in (folders / "trips" / "u.json").read_text()


def test_a_library_zone_that_is_switched_on_acts_on_the_plan_like_any_zone():
    """The page hands the planner library zones as ordinary zones, switched on or off for the trip."""
    from .phase4 import run, rows_of

    cands = [town(1, 300, name="Early"), town(2, 360, name="Middle"), town(3, 420, name="Late")]
    off = run([wp("a", 0), wp("b", 720)], cands, zones=[box("n", *box_at(360), type="no_overnight", name="Middle", enabled=False)])
    on = run([wp("a", 0), wp("b", 720)], cands, zones=[box("n", *box_at(360), type="no_overnight", name="Middle")])
    night = lambda out: [r for r in rows_of(out, "overnight") if r["auto"]][0]["name"]  # noqa: E731
    assert night(off) == "Middle" and night(on) != "Middle"


# ---------- GeoJSON ----------


def test_geojson_round_trips_names_types_and_shapes():
    zs = [zone("a", "Aspen", "no_overnight"), zone("b", "Odd shape", "avoid", [[-105, 39], [-104, 39.5], [-104.2, 40], [-105.1, 39.8], [-105, 39]], "polygon")]
    gj = library.to_geojson(zs)
    assert gj["type"] == "FeatureCollection" and [f["properties"]["name"] for f in gj["features"]] == ["Aspen", "Odd shape"]
    assert gj["features"][0]["properties"]["type"] == "no_overnight" and gj["features"][0]["geometry"]["type"] == "Polygon"
    back = library.from_geojson(json.loads(json.dumps(gj)))
    assert [(z.name, z.type, z.shape) for z in back] == [("Aspen", "no_overnight", "rectangle"), ("Odd shape", "avoid", "polygon")]
    assert [list(p) for p in back[1].ring] == zs[1]["ring"]
    assert len({z.id for z in back}) == 2 and back[0].id != "a"  # imported zones get fresh ids


def test_importing_adds_to_the_library_and_accepts_other_tools_output(folders):
    client.put("/api/zones", json={"zones": [zone("keep")]})
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "Two parts", "type": "no-stops"},
         "geometry": {"type": "MultiPolygon", "coordinates": [[SQUARE, [[-104.6, 39.4], [-104.5, 39.4], [-104.5, 39.5], [-104.6, 39.4]]], [[[-100, 30], [-99, 30], [-99, 31], [-100, 30]]]]}},
        {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[-98, 30], [-97, 30], [-97, 31]]]}},
        {"type": "Feature", "properties": {"name": "A road"}, "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}},
    ]}
    out = client.post("/api/zones/import", json=gj).json()
    names = [z["name"] for z in out["added"]]
    assert names == ["Two parts (1)", "Two parts (2)", "Imported zone 3"]
    assert out["added"][0]["type"] == "no_stops" and out["added"][2]["type"] == "avoid"  # the alias is understood; no type means avoid
    assert len(out["added"][0]["ring"]) == 5 and out["added"][2]["ring"][0] == out["added"][2]["ring"][-1]  # holes dropped, ring closed
    assert [z["id"] for z in out["library"]["zones"]][0] == "keep" and len(out["library"]["zones"]) == 4


def test_bad_geojson_is_refused_without_changing_the_library():
    client.put("/api/zones", json={"zones": [zone("keep")]})
    for bad in ({"type": "FeatureCollection", "features": []}, {"type": "Point", "coordinates": [0, 0]},
                {"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]},
                {"type": "Feature", "properties": {"type": "teleport"}, "geometry": {"type": "Polygon", "coordinates": [SQUARE]}}):
        resp = client.post("/api/zones/import", json=bad)
        assert resp.status_code == 422, bad
    assert len(client.get("/api/zones").json()["zones"]) == 1


def test_the_library_exports_as_a_download():
    client.put("/api/zones", json={"zones": [zone("a", "Aspen", "no_overnight")]})
    resp = client.get("/api/zones/export.geojson")
    assert resp.status_code == 200 and "zone-library.geojson" in resp.headers["content-disposition"]
    assert resp.json()["features"][0]["properties"] == {"name": "Aspen", "type": "no_overnight", "shape": "rectangle"}


# ---------- what switching a zone on would do ----------


def analysis(cands):
    choices.add_stop_keys(cands)
    return {"waypoints": [{"id": "a", "mile": 0, "minute": 0}, {"id": "b", "mile": 720, "minute": 720}], "candidates": cands}


def request(*zones):
    return PlanRequest(waypoints=[wp("a", 0)[0], wp("b", 720)[0]], zones=list(zones), depart="2027-09-24T08:00", pace=1.0)  # TL was built at pace 1.0


def test_an_off_stop_zone_says_what_it_would_move_without_asking_valhalla(monkeypatch):
    monkeypatch.setattr(valhalla, "post_route", lambda *a, **k: pytest.fail("a stop zone must not ask Valhalla"))
    cands = [town(1, 300, name="Early"), town(2, 360, name="Middle"), town(3, 420, name="Late")]
    off = box("n", *box_at(360), type="no_overnight", name="Middle", enabled=False)
    fx = whatif.check(request(off), ["n"], analysis(cands), TL)["n"]
    assert "night on day 1 moved from Middle" in fx["text"] and fx["text"].startswith("turning it on:")


def test_an_off_zone_the_route_does_not_touch_costs_nothing(monkeypatch):
    monkeypatch.setattr(valhalla, "post_route", lambda *a, **k: pytest.fail("nothing to ask"))
    far = box("far", 10.0, -80.0, 11.0, -79.0, type="avoid", enabled=False)
    far_stop = box("far2", 10.0, -80.0, 11.0, -79.0, type="no_meals", enabled=False)
    out = whatif.check(request(far, far_stop), ["far", "far2"], analysis(towns()), TL)
    assert out["far"]["text"].startswith("not on this route") and out["far2"]["text"].startswith("not on this route")


def test_an_off_avoid_zone_costs_one_route_and_reports_the_difference(monkeypatch):
    calls = []
    def fake(body, client=None):
        calls.append(body)
        return {"trip": trip(leg(line((32.0, -106.5), (48.0, -106.0), 800), 1100 * 60 + 2400, 1112.0))}  # 40 min and 12 mi longer than TL

    monkeypatch.setattr(valhalla, "post_route", fake)
    on_route = box("canyon", 38.0, -107.0, 39.0, -106.0, type="avoid", enabled=False)
    fx = whatif.check(request(on_route), ["canyon"], analysis(towns()), TL)["canyon"]
    assert len(calls) == 1 and calls[0]["exclude_polygons"], "one route request, with the zone excluded"
    assert fx["minutes"] == pytest.approx(40, abs=1) and fx["miles"] == pytest.approx(12, abs=0.1)
    assert "40 min longer" in fx["text"] and "12 mi longer" in fx["text"]


def test_an_avoid_zone_that_traps_a_waypoint_cannot_be_switched_on(monkeypatch):
    monkeypatch.setattr(valhalla, "post_route", lambda *a, **k: pytest.fail("refused before asking"))
    start = Waypoint(id="a", lat=32.0, lon=-106.5, name="Start")  # on the fixture route
    trap = box("trap", 31.9, -106.6, 32.1, -106.4, type="avoid", enabled=False)
    req = PlanRequest(waypoints=[start, wp("b", 720)[0]], zones=[trap], depart="2027-09-24T08:00")
    fx = whatif.check(req, ["trap"], analysis(towns()), TL)["trap"]
    assert fx.get("blocked") and "inside the avoid zone" in fx["text"]
