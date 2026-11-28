"""The importer's reading step, on a small hand-written .osm file."""

from pathlib import Path

import pytest

from app.pois import extract as ex

TINY = Path(__file__).parent / "data" / "tiny.osm"


@pytest.fixture(scope="module")
def result():
    return ex.extract(TINY)


def of_kind(result, kind):
    return [p for p in result.pois if p.kind == kind]


def test_exits_keep_ref_name_and_the_road_they_are_on(result):
    exits = of_kind(result, "exit")
    assert len(exits) == 2  # one node per direction
    assert {e.ref for e in exits} == {"116"}
    assert {e.road for e in exits} == {"I 70"}  # learned from the motorway way that contains them
    assert "Glenwood Springs" in {e.name for e in exits}


def test_fuel_and_food_keep_brand_and_cuisine(result):
    (fuel,) = [p for p in of_kind(result, "fuel") if p.brand]
    assert fuel.brand == "Shell"
    (burger,) = [p for p in of_kind(result, "food") if p.name == "Burger Stop"]
    assert (burger.subkind, burger.brand, burger.cuisine) == ("fast_food", "McDonald's", "burger")
    assert {p.subkind for p in of_kind(result, "food")} == {"fast_food", "restaurant", "cafe"}


def test_a_closed_way_becomes_one_point_at_its_centre(result):
    (motel,) = of_kind(result, "lodging")
    assert (motel.subkind, motel.name, motel.osm_type, motel.osm_id) == ("motel", "Rim Rock Motel", "w", 200)
    assert motel.lat == pytest.approx(39.5513, abs=1e-4)
    assert motel.lon == pytest.approx(-107.3290, abs=1e-4)


def test_rest_area_and_plaza_flags(result):
    (rest,) = of_kind(result, "rest_area")
    assert rest.name == "Vail Pass Rest Area"
    assert rest.toilets is True and rest.picnic is False
    (plaza,) = of_kind(result, "service_plaza")
    assert plaza.osm_type == "w" and plaza.toilets is None


def test_places_keep_population(result):
    places = {(p.name, p.subkind): p for p in of_kind(result, "place")}
    assert places[("Fairplay", "town")].population == 724
    assert ("Lonely", "hamlet") in places


def test_seasonal_ways_keep_closure_tags_as_written(result):
    by_id = {w.way_id: w for w in result.seasonal_ways}
    assert set(by_id) == {400, 401}  # not 402 (seasonal=no), 403 (a speed rule), 404 (nothing), 405 (not a highway)
    trail = by_id[400]
    assert (trail.name, trail.ref, trail.highway) == ("Trail Ridge Road", "US 34", "secondary")
    assert trail.tags == "access:conditional=no @ Oct 14th - May 31st"
    assert by_id[401].tags == "seasonal=winter"


def test_closure_tags_joins_several_with_a_bar():
    tags = {"seasonal": "winter", "access:conditional": "no @ (Nov 1-Apr 30)", "motor_vehicle:conditional": "no @ (Nov 1-Apr 30)", "hgv:conditional": "no @ x"}
    assert ex.closure_tags(tags) == "seasonal=winter | access:conditional=no @ (Nov 1-Apr 30) | motor_vehicle:conditional=no @ (Nov 1-Apr 30)"
    assert ex.closure_tags({"highway": "primary"}) == ""


def test_population_and_yes_no_parsing():
    assert ex.parse_int("1,234") == 1234
    assert ex.parse_int("about 900") is None
    assert ex.parse_int(None) is None
    assert ex.yes_no("yes") is True and ex.yes_no("no") is False and ex.yes_no("maybe") is None
