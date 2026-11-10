"""Request building, type mapping and the route summary, with Valhalla mocked."""

import pytest

from app import routing, valhalla
from app.models import RoadOptions
from app.zones import ZoneError
from tests.fakes import box, leg, line, request, trip, wp

DENVER, SALIDA, DURANGO = (39.74, -104.99), (38.53, -106.00), (37.28, -107.88)


# ---------- type mapping ----------


@pytest.mark.parametrize(
    "types, expected",
    [
        (["stop", "stop"], ["break", "break"]),
        # The start and end are breaks whatever the waypoint says.
        (["through", "overnight"], ["break", "break"]),
        (["stop", "through", "stop"], ["break", "through", "break"]),
        (["stop", "stop", "overnight", "through", "stop"], ["break", "break", "break", "through", "break"]),
    ],
)
def test_location_types(types, expected):
    req = request([wp(str(i), 39 + i / 10, -105, t) for i, t in enumerate(types)])
    body = routing.build_request(req)
    assert [loc["type"] for loc in body["locations"]] == expected


def test_through_points_snap_to_real_roads_only():
    req = request([wp("a", *DENVER), wp("b", *SALIDA, "through"), wp("c", *DURANGO)])
    locs = routing.build_request(req)["locations"]
    assert locs[1]["search_filter"] == {"min_road_class": "residential"}
    assert "search_filter" not in locs[0] and "search_filter" not in locs[2]


# ---------- request building ----------


def test_plain_request():
    body = routing.build_request(request([wp("a", *DENVER), wp("b", *DURANGO)], options=RoadOptions(alternates=0)))
    assert body["costing"] == "auto"
    assert body["directions_options"] == {"units": "miles"}
    assert body["locations"][0] == {"lat": 39.74, "lon": -104.99, "type": "break"}
    for key in ("costing_options", "exclude_polygons", "alternates", "date_time"):
        assert key not in body


def test_road_options_become_costing_options():
    opts = RoadOptions(avoid_tolls=True, avoid_ferries=True, avoid_unpaved=True)
    body = routing.build_request(request([wp("a", *DENVER), wp("b", *DURANGO)], options=opts))
    assert body["costing_options"] == {"auto": {"use_tolls": 0.0, "use_ferry": 0.0, "exclude_unpaved": True}}


def test_only_enabled_avoid_zones_are_excluded():
    zones = [
        box("on", 38, -106, 38.5, -105.5),
        box("off", 38, -107, 38.5, -106.5, enabled=False),
        box("meals", 37, -107, 37.5, -106.5, type="no_meals"),
    ]
    body = routing.build_request(request([wp("a", *DENVER), wp("b", *DURANGO)], zones))
    assert body["exclude_polygons"] == [[[-106, 38], [-105.5, 38], [-105.5, 38.5], [-106, 38.5], [-106, 38]]]


def test_alternates_only_for_two_waypoints():
    two = request([wp("a", *DENVER), wp("b", *DURANGO)])
    three = request([wp("a", *DENVER), wp("b", *SALIDA, "through"), wp("c", *DURANGO)])
    assert routing.build_request(two)["alternates"] == 2
    assert "alternates" not in routing.build_request(three)


def test_a_dated_request_never_asks_for_alternates():
    # Valhalla returns none with date_time; plan_route asks for them undated.
    req = request([wp("a", *DENVER), wp("b", *DURANGO)], depart="2027-09-24T08:00")
    dated = routing.build_request(req)
    undated = routing.build_request(req, dated=False)
    assert dated["date_time"] == {"type": 1, "value": "2027-09-24T08:00"} and "alternates" not in dated
    assert undated["alternates"] == 2 and "date_time" not in undated


# ---------- the summary ----------


def fake_result():
    """Denver -> (through near Salida) -> Durango as one leg, then Durango -> Salida."""
    leg1 = line(DENVER, (38.53, -106.0)) + line((38.53, -106.0), DURANGO)[1:]
    leg2 = line(DURANGO, SALIDA)
    return {"trip": trip(leg(leg1, 6 * 3600, 330.0), leg(leg2, 3 * 3600, 150.0))}


def three_stop_request(**kw):
    return request([wp("a", *DENVER), wp("t", 38.53, -106.0, "through"), wp("b", *DURANGO, "overnight"), wp("c", *SALIDA)], **kw)


def test_summary_legs_and_positions():
    out = routing.summarize(fake_result(), three_stop_request(pace=1.0))
    assert [(l["from"], l["to"], l["through"]) for l in out["legs"]] == [("a", "b", ["t"]), ("b", "c", [])]
    assert [l["miles"] for l in out["legs"]] == [330.0, 150.0]
    # Straight lines: no curves, so the time is Valhalla's.
    assert [l["minutes"] for l in out["legs"]] == [360.0, 180.0]
    coords = out["geometry"]["coordinates"]
    assert len(coords) == 21 + 10  # the shared Durango point is kept once
    assert out["waypoint_positions"] == {"a": 0, "t": 10, "b": 20, "c": 30}
    assert out["legs"][1]["span"] == [20, 30]
    assert out["total"] == {"miles": 480.0, "minutes": 540.0, "valhalla_minutes": 540.0}


def test_pace_scales_times():
    out = routing.summarize(fake_result(), three_stop_request(pace=1.1))
    assert out["total"]["minutes"] == pytest.approx(594.0)


def test_alternate_extra_time_and_adopt_point():
    main = line(DENVER, DURANGO)
    # The alternate bows south through Salida's latitude band.
    alt = line(DENVER, (37.6, -105.5)) + line((37.6, -105.5), DURANGO)[1:]
    result = {"trip": trip(leg(main, 6 * 3600, 330.0)), "alternates": [{"trip": trip(leg(alt, 7 * 3600, 380.0))}]}
    out = routing.summarize(result, request([wp("a", *DENVER), wp("b", *DURANGO)], pace=1.0))
    [a] = out["alternates"]
    assert a["extra_minutes"] == pytest.approx(60, abs=1)  # the bend itself costs a little
    # The adopt point is the bend, the spot farthest from the main route.
    assert (a["adopt"]["lat"], a["adopt"]["lon"]) == pytest.approx((37.6, -105.5))


# ---------- plan_route ----------


def test_zone_error_comes_before_valhalla(monkeypatch):
    called = []
    monkeypatch.setattr(valhalla, "post_route", lambda body, client=None: called.append(body))
    req = request([wp("a", *DENVER, name="Denver"), wp("b", *DURANGO, name="Durango")], [box("z", 37, -108, 37.5, -107.5, name="Durango box")])
    with pytest.raises(ZoneError) as err:
        routing.plan_route(req)
    assert "Durango box" in err.value.message and "B (Durango)" in err.value.message
    assert called == []


def test_valhalla_442_becomes_a_message_naming_the_zones(monkeypatch):
    def fail(body, client=None):
        raise valhalla.ValhallaError("No path could be found for input", 442)

    monkeypatch.setattr(valhalla, "post_route", fail)
    req = request([wp("a", *DENVER), wp("b", *DURANGO)], [box("z", 38, -106.5, 38.5, -106, name="Ring around Salida")])
    with pytest.raises(routing.RouteError) as err:
        routing.plan_route(req)
    assert "Ring around Salida" in err.value.message


def test_two_requests_when_dated_with_alternates(monkeypatch):
    bodies = []
    main = line(DENVER, DURANGO)
    alt = line(DENVER, (37.6, -105.5)) + line((37.6, -105.5), DURANGO)[1:]

    def fake(body, client=None):
        bodies.append(body)
        result = {"trip": trip(leg(main, 6 * 3600, 330.0))}
        if "alternates" in body:
            result["alternates"] = [{"trip": trip(leg(alt, 7 * 3600, 380.0))}]
        return result

    monkeypatch.setattr(valhalla, "post_route", fake)
    out = routing.plan_route(request([wp("a", *DENVER), wp("b", *DURANGO)], depart="2027-09-24T08:00"))
    assert len(bodies) == 2 and "date_time" in bodies[0] and "alternates" in bodies[1]
    assert len(out["alternates"]) == 1
