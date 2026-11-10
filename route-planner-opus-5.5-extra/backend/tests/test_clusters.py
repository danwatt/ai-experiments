"""Clustering rules: who attaches to which exit, plaza, town, or group."""

from app.pois.clusters import build_clusters, dedupe_places
from app.pois.extract import Poi

# 0.01 degrees of latitude is about 1.1 km.
LAT, LON = 39.0, -105.0


def poi(kind, dlat=0.0, dlon=0.0, subkind=None, **kw):
    return Poi(kind=kind, subkind=subkind or kind, name=kw.pop("name", ""), lat=LAT + dlat, lon=LON + dlon, osm_type="n", osm_id=id(kw) % 10**6, **kw)


def by_kind(clusters, kind):
    return [c for c in clusters if c.kind == kind]


def test_amenity_within_a_mile_of_an_exit_goes_to_the_exit():
    exit_ = poi("exit", ref="116", road="I 70")
    town = poi("place", 0.02, 0, subkind="town", name="Glenwood", population=9000)
    gas = poi("fuel", 0.005, 0, brand="Shell")  # 550 m from the exit, 1.7 km from the town
    clusters = build_clusters([exit_, town, gas])
    (ex,) = by_kind(clusters, "exit")
    assert ex.fuel == 1 and ex.members == [gas]
    assert by_kind(clusters, "town")[0].fuel == 0


def test_amenity_beyond_a_mile_from_the_exit_goes_to_the_nearest_town():
    exit_ = poi("exit", ref="1")
    town = poi("place", 0.03, 0, subkind="village", name="Smallville")
    food = poi("food", 0.025, 0, subkind="restaurant")  # 2.8 km from the exit, 550 m from the town
    clusters = build_clusters([exit_, town, food])
    assert by_kind(clusters, "exit")[0].food == 0
    (t,) = by_kind(clusters, "town")
    assert t.food == 1 and t.food_sitdown == 1


def test_a_hamlet_is_not_an_anchor():
    hamlet = poi("place", 0, 0, subkind="hamlet", name="Tiny")
    motel = poi("lodging", 0.001, 0, subkind="motel")
    clusters = build_clusters([hamlet, motel])
    assert not by_kind(clusters, "town")
    (other,) = by_kind(clusters, "other")  # a loose group, named after the hamlet
    assert other.lodging == 1 and other.name == "Near Tiny"


def test_loose_amenities_near_each_other_make_one_small_cluster_and_far_ones_another():
    close = [poi("fuel", 0, 0), poi("food", 0.002, 0, subkind="fast_food"), poi("lodging", 0.004, 0, subkind="motel")]
    far = poi("fuel", 0.5, 0)
    clusters = build_clusters(close + [far])
    others = sorted(by_kind(clusters, "other"), key=lambda c: -len(c.members))
    assert [len(c.members) for c in others] == [3, 1]
    assert (others[0].fuel, others[0].food_fast, others[0].lodging) == (1, 1, 1)


def test_amenities_inside_a_service_plaza_go_to_the_plaza_before_the_exit():
    plaza = poi("service_plaza", 0, 0, name="Love's")
    exit_ = poi("exit", 0.002, 0, ref="5")
    gas = poi("fuel", 0.001, 0)
    clusters = build_clusters([plaza, exit_, gas])
    assert by_kind(clusters, "service_plaza")[0].fuel == 1
    assert by_kind(clusters, "exit")[0].fuel == 0


def test_rest_areas_and_empty_exits_still_make_clusters():
    clusters = build_clusters([poi("rest_area", name="Vail Pass", toilets=True, picnic=False), poi("exit", 0.5, 0, ref="9")])
    rest = by_kind(clusters, "rest_area")[0]
    assert (rest.name, rest.toilets, rest.picnic, rest.food) == ("Vail Pass", True, False, 0)
    assert by_kind(clusters, "exit")[0].fuel == 0


def test_the_two_directions_of_an_exit_are_one_cluster():
    a, b = poi("exit", 0, 0, ref="116", road="I 70"), poi("exit", 0.002, 0.003, ref="116", road="I 70")
    c = poi("exit", 0, 0.002, ref="117", road="I 70")  # a different number next door stays separate
    exits = by_kind(build_clusters([a, b, c]), "exit")
    assert sorted(e.ref for e in exits) == ["116", "117"]


def test_cluster_position_is_the_middle_of_its_amenities():
    exit_ = poi("exit", 0, 0, ref="1")
    clusters = build_clusters([exit_, poi("fuel", 0.004, 0), poi("food", 0.008, 0, subkind="cafe")])
    (ex,) = by_kind(clusters, "exit")
    assert ex.lat == LAT + 0.006


def test_counts_and_detail_for_the_card():
    town = poi("place", 0, 0, subkind="town", name="T")
    members = [
        poi("food", 0.001, 0, subkind="restaurant", cuisine="mexican", name="Casa"),
        poi("food", 0.001, 0.001, subkind="restaurant", cuisine="mexican;tex-mex", name="Casa Dos"),
        poi("food", 0.001, 0.002, subkind="fast_food", brand="Subway"),
        poi("food", 0.002, 0.002, subkind="cafe"),
        poi("fuel", 0.002, 0, brand="Shell"),
        poi("lodging", 0.002, 0.001, subkind="motel", brand="Super 8"),
    ]
    (t,) = by_kind(build_clusters([town] + members), "town")
    assert (t.food, t.food_sitdown, t.food_fast, t.food_cafe, t.fuel, t.lodging) == (4, 2, 1, 1, 1, 1)
    assert t.detail["cuisines"] == {"mexican": 2}
    assert t.detail["brands"] == {"fuel": {"Shell": 1}, "food": {"Subway": 1}, "lodging": {"Super 8": 1}}
    assert t.detail["names"] == ["Casa", "Casa Dos"]


def test_every_amenity_lands_in_exactly_one_cluster():
    pois = [poi("exit", 0, 0, ref="1"), poi("place", 0.05, 0, subkind="town", name="X")]
    pois += [poi(k, dlat, dlon, subkind="restaurant" if k == "food" else k) for k in ("fuel", "food", "lodging") for dlat in (0, 0.02, 0.3) for dlon in (0, 0.4)]
    clusters = build_clusters(pois)
    assert sum(len(c.members) for c in clusters) == 18


def test_duplicate_places_are_dropped_bigger_kind_first():
    pois = [
        poi("place", 0, 0, subkind="village", name="Fairplay"),
        poi("place", 0.001, 0, subkind="town", name="Fairplay", population=700),
        poi("place", 0.5, 0, subkind="town", name="Fairplay"),  # far away: a different Fairplay
        poi("fuel", 0, 0),
    ]
    kept = dedupe_places(pois)
    assert sorted((p.kind, p.subkind) for p in kept) == [("fuel", "fuel"), ("place", "town"), ("place", "town")]
    assert any(p.population == 700 for p in kept)
