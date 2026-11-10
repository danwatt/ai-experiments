"""Big loose roadside groups cut down to the part nearest the route (loose.py)."""

from app import timeline
from app.planner import candidates, loose
from app.pois import db
from app.pois.clusters import build_clusters
from app.pois.extract import Extract, Poi

from .fakes import leg, line, trip

START, END = (39.0, -105.0), (39.0, -104.1)


def food(n, lat, lon):
    return Poi(kind="food", subkind="restaurant", name=f"Diner {n}", lat=lat, lon=lon, osm_type="n", osm_id=n)


def test_a_sprawling_group_becomes_its_part_nearest_the_route(tmp_path):
    # 20 diners in a chain 1.5 km north of the road, 690 m apart (one "other" group 13 km long),
    # and one more closer to the road at its east end.
    chain = [food(i, 39.0135, -104.75 + 0.008 * i) for i in range(20)]
    by_road = food(99, 39.008, -104.598)  # 600 m from the chain, so in the same group
    pois = chain + [by_road]
    path = tmp_path / "pois.sqlite"
    db.write_all(path, Extract(pois=pois), build_clusters(pois))
    con = db.connect(path)
    tl = timeline.build(trip(leg(line(START, END, 181), 3600, 48.5)), 1.0)

    (c,) = candidates.find(con, tl)
    assert c["kind"] == "other" and c["food"] == 21
    whole_mile = c["mile"]
    loose.tighten([c], con, tl)
    assert c["spread"] == {"kept": c["food"], "of": 21}
    assert c["food"] < 5  # the diner by the road and its neighbours within half a mile
    assert c["mile"] > whole_mile + 3  # at the east end, where the near diner is
    assert c["key"] == f"{c['id']}@{c['mile']:.1f}"


def test_small_groups_and_other_kinds_are_left_alone(tmp_path):
    pois = [food(i, 39.0135, -104.75 + 0.008 * i) for i in range(5)]
    path = tmp_path / "pois.sqlite"
    db.write_all(path, Extract(pois=pois), build_clusters(pois))
    con = db.connect(path)
    tl = timeline.build(trip(leg(line(START, END, 181), 3600, 48.5)), 1.0)
    (c,) = candidates.find(con, tl)
    before = dict(c)
    loose.tighten([c], con, tl)
    assert c == before
