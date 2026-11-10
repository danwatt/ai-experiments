"""The stop-data database: writing, the R*Tree box query, and name search."""

import pytest

from app.pois import db
from app.pois.clusters import build_clusters
from app.pois.extract import Extract, Poi, SeasonalWay


def poi(kind, name, lat, lon, subkind=None, **kw):
    return Poi(kind=kind, subkind=subkind or kind, name=name, lat=lat, lon=lon, osm_type="n", osm_id=abs(hash((name, lat))) % 10**8, **kw)


PLACES = [
    poi("place", "Salida", 38.53, -106.0, "town", population=5600),
    poi("place", "Salida Heights", 38.60, -106.1, "hamlet"),
    poi("place", "Saline", 38.9, -106.3, "village", population=40),
    poi("place", "Poncha Springs", 38.51, -106.08, "town", population=900),
    poi("place", "Fairplay", 39.22, -106.0, "town", population=724),
    poi("place", "Fairplay Estates", 39.30, -106.0, "hamlet"),
]
OTHERS = [
    poi("rest_area", "Salida Rest Area", 38.50, -106.05),
    poi("exit", "", 39.55, -107.33, "exit", ref="116", road="I 70"),
    poi("food", "Casa", 38.531, -106.001, "restaurant"),
    poi("lodging", "Motel", 38.532, -106.0, "motel", brand="Super 8"),
]


@pytest.fixture()
def con(tmp_path):
    pois = PLACES + OTHERS
    extract = Extract(pois=pois, seasonal_ways=[SeasonalWay(1, "secondary", "Trail Ridge Road", "US 34", "access:conditional=no @ Oct 14th - May 31st", 40.4, -105.7)])
    path = tmp_path / "pois.sqlite"
    db.write_all(path, extract, build_clusters(pois), source="tiny.osm")
    return db.connect(path)


def names(results):
    return [r["name"] for r in results]


def test_write_all_counts_and_meta(con):
    info = db.info(con)
    assert info["source"] == "tiny.osm"
    assert info["counts"]["pois"]["place"] == 6
    assert info["counts"]["clusters"]["town"] == 4
    assert info["counts"]["seasonal_ways"] == 1


def test_every_amenity_row_knows_its_cluster(con):
    rows = con.execute("SELECT cluster_id FROM pois WHERE kind IN ('food','lodging')").fetchall()
    assert all(r["cluster_id"] for r in rows)


def test_box_query_uses_the_rtree_and_returns_cluster_dicts(con):
    found = db.clusters_in_box(con, 38.4, -106.2, 38.7, -105.9)
    by_name = {c["name"]: c for c in found}
    assert set(by_name) >= {"Salida", "Poncha Springs", "Salida Rest Area"}
    assert "Fairplay" not in by_name
    salida = by_name["Salida"]
    assert (salida["food"], salida["lodging"]) == (1, 1)
    assert salida["detail"]["brands"]["lodging"] == {"Super 8": 1}
    assert by_name["Salida Rest Area"]["toilets"] is None


def test_search_ranks_towns_before_hamlets_and_rest_areas(con):
    assert names(db.search(con, "sal")) == ["Salida", "Saline", "Salida Heights", "Salida Rest Area"]


def test_search_matches_word_prefixes_in_any_order(con):
    assert names(db.search(con, "springs pon")) == ["Poncha Springs"]
    assert names(db.search(con, "Poncha Spr")) == ["Poncha Springs"]
    assert names(db.search(con, "fairplay"))[0] == "Fairplay"


def test_search_result_has_a_detail_line_and_position(con):
    (hit,) = db.search(con, "poncha")
    assert hit["detail"] == "Town · pop. 900" and (hit["lat"], hit["lon"]) == (38.51, -106.08)
    (exit_hit,) = db.search(con, "exit")
    assert exit_hit["kind"] == "exit" and exit_hit["detail"].startswith("Exit 116")


def test_search_handles_odd_input(con):
    assert db.search(con, "") == []
    assert db.search(con, "   ") == []
    assert db.search(con, '"; DROP TABLE x; --') == []
    assert db.search(con, "zzzz") == []
    assert len(db.search(con, "sal", limit=2)) == 2


def test_seasonal_lookup_by_way_id(con):
    rows = db.seasonal_by_ids(con, [1, 2, 3])
    assert [r["name"] for r in rows] == ["Trail Ridge Road"]
    assert db.seasonal_by_ids(con, []) == []
