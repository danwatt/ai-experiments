"""Trip files: round trips, versions and defaults, bad ids, the example trips, the defaults file."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main, trips
from app.models import PlanRequest

client = TestClient(main.app)
REPO_EXAMPLES = Path(__file__).resolve().parents[2] / "examples"

WP = [
    {"id": "a", "lat": 39.74, "lon": -104.99, "name": "Denver", "type": "stop"},
    {"id": "b", "lat": 37.28, "lon": -107.88, "name": "Durango", "type": "stop"},
]


@pytest.fixture(autouse=True)
def folders(tmp_path, monkeypatch):
    """Every test works in its own trips and examples folders, never the real ones."""
    monkeypatch.setattr(trips, "TRIPS_DIR", tmp_path / "trips")
    monkeypatch.setattr(trips, "EXAMPLES_DIR", tmp_path / "examples")
    (tmp_path / "trips").mkdir()
    (tmp_path / "examples").mkdir()
    return tmp_path


def full_trip(**kw):
    return {"name": "Test trip", "depart": "2027-09-25T08:00", "waypoints": WP, **kw}


def test_a_trip_survives_a_round_trip_with_everything_in_it():
    doc = full_trip(
        pace=1.2, search_miles=3.5, library_on=["boulder", "montrose"],
        zones=[{"id": "z1", "name": "Mine", "type": "no_meals", "shape": "polygon", "ring": [[-105, 39], [-104, 39], [-104, 40]], "enabled": False}],
        breaks={"settings": {"every_minutes": 90, "stop_order": ["services", "rest_area", "service_plaza", "any"]},
                "meals": {"food": "sitdown"}, "fuel": {"range_miles": 350}, "days": {"start": "07:30", "stop_at_sunset": True},
                "lodging": {"brands": ["Hilton"], "rule": "only"}, "warn_closures": False,
                "pins": [{"key": "12#1", "name": "Fairplay", "kind": "lunch"}], "skips": [{"key": "13#1", "name": "Bailey"}]},
        summary={"miles": 337, "driving_minutes": 380, "days": 1, "arrive": "2027-09-25T15:37"},
    )
    saved = trips.write("test-trip", doc)
    assert saved["version"] == 1 and saved["saved_at"].endswith("Z")
    back = trips.read("test-trip")
    assert back == saved
    assert back["pace"] == 1.2 and back["search_miles"] == 3.5 and back["library_on"] == ["boulder", "montrose"]
    assert back["zones"][0]["enabled"] is False
    assert back["breaks"]["settings"]["every_minutes"] == 90 and back["breaks"]["settings"]["stop_order"][0] == "services"
    assert back["breaks"]["days"]["start"] == "07:30" and back["breaks"]["lodging"] == {"brands": ["Hilton"], "rule": "only"}
    assert back["breaks"]["pins"][0]["kind"] == "lunch" and back["breaks"]["skips"][0]["key"] == "13#1"
    assert back["breaks"]["warn_closures"] is False


def test_the_file_is_plain_readable_json_with_a_version(folders):
    trips.write("plain", full_trip())
    path = folders / "trips" / "plain.json"
    text = path.read_text()
    assert text.startswith("{\n  ") and text.endswith("}\n")  # indented, for reading and for git
    assert json.loads(text)["version"] == 1
    assert [p.name for p in (folders / "trips").iterdir()] == ["plain.json"]  # no temporary file left behind


def test_zone_rings_are_written_one_point_per_line(folders):
    ring = [[-105.295, 40.005], [-105.255, 40.005], [-105.255, 40.03], [-105.295, 40.03], [-105.295, 40.005]]
    trips.write("rings", full_trip(zones=[{"id": "z", "name": "Z", "type": "avoid", "shape": "rectangle", "ring": ring}]))
    text = (folders / "trips" / "rings.json").read_text()
    assert "[-105.295, 40.005]" in text and text.count("[-105.295, 40.005]") == 2
    assert trips.read("rings")["zones"][0]["ring"] == ring


def test_a_failed_write_leaves_the_old_file_alone(folders, monkeypatch):
    trips.write("keep", full_trip(name="First"))

    def boom(*a, **k):
        raise OSError("disk full")

    with monkeypatch.context() as m:
        m.setattr(trips.os, "replace", boom)
        with pytest.raises(OSError):
            trips.write("keep", full_trip(name="Second"))
    assert trips.read("keep")["name"] == "First"
    assert [p.name for p in (folders / "trips").iterdir()] == ["keep.json"]


def test_an_old_trip_without_the_newer_fields_loads_with_defaults(folders):
    old = {"version": 1, "name": "Phase 3 trip", "waypoints": WP, "zones": [], "breaks": {"settings": {"every_minutes": 100}, "pins": [], "skips": []}}
    (folders / "trips" / "old.json").write_text(json.dumps(old))
    t = trips.read("old")
    assert t["breaks"]["settings"]["every_minutes"] == 100 and t["breaks"]["settings"]["every_miles"] == 150
    assert t["breaks"]["meals"]["lunch"]["start"] == "11:30"
    assert t["breaks"]["fuel"]["range_miles"] == 400 and t["breaks"]["days"]["start"] == "08:00"
    assert t["breaks"]["lodging"] == {"brands": [], "rule": "prefer"} and t["breaks"]["warn_closures"] is True
    assert t["library_on"] == [] and t["search_miles"] == 2.0 and t["pace"] == 1.05
    assert t["breaks"]["settings"]["stop_order"] == ["rest_area", "service_plaza", "services", "any"]


def test_a_file_with_no_version_is_version_one(folders):
    (folders / "trips" / "bare.json").write_text(json.dumps({"name": "Bare", "waypoints": WP}))
    assert trips.read("bare")["version"] == 1


def test_bad_files_give_errors_that_name_the_problem(folders):
    (folders / "trips" / "future.json").write_text(json.dumps({"version": 9, "name": "x"}))
    (folders / "trips" / "junk.json").write_text("{not json")
    (folders / "trips" / "wrong.json").write_text(json.dumps({"name": "x", "breaks": {"meals": {"lunch": {"start": "noon", "end": "13:00", "minutes": 30}}}}))
    with pytest.raises(trips.TripError, match="newer version"):
        trips.read("future")
    with pytest.raises(trips.TripError, match="damaged"):
        trips.read("junk")
    with pytest.raises(trips.TripError, match=r"breaks\.meals\.lunch\.start"):
        trips.read("wrong")
    with pytest.raises(trips.TripError) as missing:
        trips.read("nothing-here")
    assert missing.value.status == 404


@pytest.mark.parametrize("bad", ["../etc/passwd", "a/b", "A", "UPPER", "with space", "", ".hidden", "-lead", "x" * 70, "zones", "defaults", "a.json", "é"])
def test_ids_that_are_not_plain_slugs_are_refused(bad):
    with pytest.raises(trips.TripError) as err:
        trips.check_id(bad)
    assert err.value.status == 400


def test_the_api_refuses_bad_ids_and_never_leaves_the_folder(folders):
    for bad in ("Bad_Id", "zones", "defaults", "a.b"):
        assert client.put(f"/api/trips/{bad}", json=full_trip()).status_code == 400
        assert client.get(f"/api/trips/{bad}").status_code == 400
        assert client.delete(f"/api/trips/{bad}").status_code == 400
    assert client.get("/api/trips/..%2F..%2Fetc%2Fpasswd").status_code in (400, 404)
    assert list((folders / "trips").iterdir()) == []


def test_the_api_saves_lists_loads_and_deletes(folders):
    assert client.get("/api/trips").json() == {"trips": [], "examples": []}
    put = client.put("/api/trips/loop", json=full_trip(name="Loop", summary={"miles": 928.4, "days": 5, "arrive": "2027-09-29T17:05"}))
    assert put.status_code == 200 and put.json()["saved_at"]
    client.put("/api/trips/other", json=full_trip(name="Other"))
    listed = client.get("/api/trips").json()["trips"]
    assert {t["id"] for t in listed} == {"loop", "other"}
    entry = next(t for t in listed if t["id"] == "loop")
    assert entry["name"] == "Loop" and entry["miles"] == 928.4 and entry["days"] == 5 and entry["depart"] == "2027-09-25T08:00"
    assert entry["arrive"] == "2027-09-29T17:05" and entry["waypoints"] == 2 and entry["saved_at"]
    assert client.get("/api/trips/loop").json()["name"] == "Loop"
    assert client.delete("/api/trips/loop").json() == {"deleted": "loop"}
    assert client.get("/api/trips/loop").status_code == 404
    assert client.delete("/api/trips/loop").status_code == 404
    assert [t["id"] for t in client.get("/api/trips").json()["trips"]] == ["other"]


def test_an_invalid_trip_is_refused_with_the_field_and_nothing_is_written(folders):
    resp = client.put("/api/trips/bad", json=full_trip(waypoints=[{"id": "a", "lat": 99, "lon": 0}]))
    assert resp.status_code == 422 and "waypoints.0.lat" in resp.json()["error"]["message"]
    assert not (folders / "trips" / "bad.json").exists()


def test_the_list_skips_the_library_and_defaults_files_and_shows_a_broken_trip(folders):
    trips.write("good", full_trip())
    (folders / "trips" / "zones.json").write_text("{}")
    (folders / "trips" / "defaults.json").write_text("{}")
    (folders / "trips" / "broken.json").write_text("nope")
    listed = {t["id"]: t for t in trips.listing()}
    assert set(listed) == {"good", "broken"} and "error" in listed["broken"]


def test_the_list_is_newest_first(folders, monkeypatch):
    for n, stamp in enumerate(["2027-01-01T00:00:00Z", "2027-03-01T00:00:00Z", "2027-02-01T00:00:00Z"]):
        monkeypatch.setattr(trips, "now_utc", lambda s=stamp: s)
        trips.write(f"t{n}", full_trip(name=f"T{n}"))
    assert [t["id"] for t in trips.listing()] == ["t1", "t2", "t0"]


# ---------- examples ----------


def test_examples_are_listed_apart_and_cannot_be_written_through_the_trips_api(folders):
    trips.write_json(folders / "examples" / "demo.json", trips.parse(full_trip(name="Demo")).model_dump(mode="json"))
    body = client.get("/api/trips").json()
    assert body["trips"] == [] and [e["id"] for e in body["examples"]] == ["demo"]
    assert client.get("/api/trips/demo").status_code == 404  # an example is not one of the user's trips
    assert client.get("/api/examples/demo").json()["name"] == "Demo"
    assert client.delete("/api/trips/demo").status_code == 404
    assert (folders / "examples" / "demo.json").exists()


def test_copy_to_my_trips_picks_a_free_id_each_time(folders):
    trips.write_json(folders / "examples" / "demo.json", trips.parse(full_trip(name="Demo trip")).model_dump(mode="json"))
    ids = [client.post("/api/examples/demo/copy").json()["id"] for _ in range(3)]
    assert ids == ["demo-trip", "demo-trip-2", "demo-trip-3"]
    assert client.post("/api/examples/nope/copy").status_code == 404
    assert (folders / "examples" / "demo.json").exists()  # the example itself is untouched


def test_the_committed_examples_are_valid_and_plan_like_the_notes_say():
    assert (REPO_EXAMPLES / "colorado-loop.json").exists() and (REPO_EXAMPLES / "denver-to-durango.json").exists()
    zones = {z["id"] for z in json.loads((REPO_EXAMPLES / "zones.json").read_text())["zones"]}
    for name, n_waypoints in (("colorado-loop", 6), ("denver-to-durango", 2)):
        t = trips.parse(json.loads((REPO_EXAMPLES / f"{name}.json").read_text()))
        assert len(t.waypoints) == n_waypoints and t.depart.startswith("2027-09-2")
        assert set(t.library_on) <= zones
    loop = trips.parse(json.loads((REPO_EXAMPLES / "colorado-loop.json").read_text()))
    assert loop.library_on == ["boulder-downtown", "denver-metro", "montrose", "glenwood-springs"]
    assert [w.type for w in loop.waypoints] == ["stop", "through", "through", "overnight", "stop", "stop"]


# ---------- defaults for new trips ----------


def test_defaults_start_as_the_agreed_settings_and_can_be_changed(folders):
    d = trips.read_defaults()
    assert d["pace"] == 1.05 and d["breaks"]["settings"]["every_minutes"] == 120 and "pins" not in d["breaks"]
    assert not (folders / "trips" / "defaults.json").exists()  # nothing written until the user saves
    saved = client.put("/api/defaults", json={**d, "pace": 1.1, "breaks": {**d["breaks"], "fuel": {**d["breaks"]["fuel"], "range_miles": 300}}}).json()
    assert saved["pace"] == 1.1 and saved["breaks"]["fuel"]["range_miles"] == 300
    assert client.get("/api/defaults").json() == saved
    assert json.loads((folders / "trips" / "defaults.json").read_text())["pace"] == 1.1


def test_defaults_never_hold_pins_or_skips(folders):
    d = client.put("/api/defaults", json={"breaks": {"pins": [{"key": "1#1"}], "skips": [{"key": "2#1"}]}}).json()
    assert "pins" not in d["breaks"] and "skips" not in d["breaks"]
    assert client.put("/api/defaults", json={"pace": 9}).status_code == 422


def test_a_saved_trip_makes_a_valid_plan_request(folders):
    """The file holds what the page sends to /api/plan: settings, meals, fuel, days, pins, skips."""
    t = trips.parse(full_trip(breaks={"days": {"start": "07:00"}, "pins": [{"key": "5#1", "kind": "overnight"}]}))
    b = t.breaks
    days = b.days.model_dump()
    start = days.pop("start")
    req = PlanRequest(waypoints=t.waypoints, zones=t.zones, options=t.options, depart=t.depart, pace=t.pace, search_miles=t.search_miles,
                      breaks=b.settings, meals=b.meals, fuel=b.fuel, days=days, day_start=start, lodging=b.lodging,
                      warn_closures=b.warn_closures, pins=b.pins, skips=b.skips)
    assert req.day_start == "07:00" and req.pins[0].kind == "overnight"
