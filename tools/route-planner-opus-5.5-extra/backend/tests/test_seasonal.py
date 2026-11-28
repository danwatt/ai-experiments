"""Seasonal closure check: tag text, dates, chunking, and the lookup against the database."""

from datetime import date

import pytest

from app import seasonal, valhalla
from app.pois import db
from app.pois.clusters import build_clusters
from app.pois.extract import Extract, SeasonalWay

TRAIL = "access:conditional=no @ Oct 14th - May 31st"
PASS = "motor_vehicle:conditional=no @ Nov 15-May 15"


def way(way_id, name, ref, tags, lat=40.4, lon=-105.7, highway="secondary"):
    return {"way_id": way_id, "highway": highway, "name": name, "ref": ref, "tags": tags, "lat": lat, "lon": lon}


# ---------- reading the tag text ----------


def test_parse_range_understands_the_dates_osm_mappers_write():
    assert seasonal.parse_range("no @ Oct 14th - May 31st") == ((10, 14), (5, 31), "Oct 14th – May 31st")
    assert seasonal.parse_range("no @ (Nov 15-May 15)")[:2] == ((11, 15), (5, 15))
    assert seasonal.parse_range("no @ December 1 to April 30")[:2] == ((12, 1), (4, 30))
    assert seasonal.parse_range("no @ (22:00-06:00)") is None
    assert seasonal.parse_range("no @ winter") is None


def test_ranges_that_wrap_the_new_year():
    start, end = (10, 14), (5, 31)
    assert seasonal.in_range(date(2027, 12, 25), start, end)
    assert seasonal.in_range(date(2027, 1, 15), start, end)
    assert seasonal.in_range(date(2027, 10, 14), start, end) and seasonal.in_range(date(2027, 5, 31), start, end)
    assert not seasonal.in_range(date(2027, 9, 25), start, end)
    assert not seasonal.in_range(date(2027, 6, 1), start, end)
    # and one that does not wrap
    assert seasonal.in_range(date(2027, 7, 4), (6, 1), (8, 31)) and not seasonal.in_range(date(2027, 9, 1), (6, 1), (8, 31))


def test_trip_days_cover_driving_days_and_days_staying_put():
    assert seasonal.trip_days(None, 600, 0) is None
    days = seasonal.trip_days("2027-09-25T08:00", 1050, 1)  # 17.5 h = 3 driving days, plus one rest day
    assert days[0] == date(2027, 9, 25) and days[-1] == date(2027, 9, 28) and len(days) == 4
    assert len(seasonal.trip_days("2027-09-25T08:00", 90, 0)) == 1


# ---------- the verdict ----------


def assess(rows, minutes=400, depart="2027-09-25T08:00", extra=0):
    return seasonal.assess(rows, minutes, depart, extra)


def test_open_on_the_trips_dates():
    (w,) = assess([way(1, "Trail Ridge Road", "US 34", TRAIL)])
    assert w["level"] == "open" and w["road"] == "Trail Ridge Road" and w["range"] == "Oct 14th – May 31st"
    assert w["message"] == "Trail Ridge Road: closed Oct 14th – May 31st. Open on your dates (Sep 25)."
    assert w["tags"] == TRAIL  # raw text, untouched


def test_closed_when_every_day_of_the_trip_is_inside():
    (w,) = assess([way(1, "Trail Ridge Road", "US 34", TRAIL)], depart="2027-01-15T08:00")
    assert w["level"] == "closed"
    assert w["message"] == "Trail Ridge Road: closed Oct 14th – May 31st. Your trip (Jan 15) is inside those dates."


def test_check_dates_when_the_trip_straddles_the_closure():
    (w,) = assess([way(1, "Trail Ridge Road", "US 34", TRAIL)], minutes=1500, depart="2027-10-12T08:00")  # Oct 12 - Oct 14
    assert w["level"] == "check" and w["message"].endswith("Check dates.")


def test_check_dates_without_a_departure_date():
    (w,) = assess([way(1, "Trail Ridge Road", "US 34", TRAIL)], depart=None)
    assert w["level"] == "check" and w["message"] == "Trail Ridge Road: closed Oct 14th – May 31st. Check dates."


def test_ways_of_one_road_make_one_warning_and_unnamed_roads_use_their_ref():
    rows = [way(i, "Trail Ridge Road", "US 34", TRAIL) for i in range(3)]
    rows.append(way(9, "Trail Ridge Road", "US 34", "access:conditional=no @ Oct 1 - May 31st"))  # one odd piece
    rows += [way(20, "", "CO 82", PASS), way(21, "", "CO 82", PASS)]
    out = assess(rows, depart="2027-12-20T08:00")
    assert [(w["road"], w["ways"], w["level"]) for w in out] == [("CO 82", 2, "closed"), ("Trail Ridge Road", 4, "closed")]
    assert out[1]["range"] == "Oct 14th – May 31st"  # what most of its ways say


def test_closed_comes_before_check_before_open():
    rows = [way(1, "A road", "", TRAIL), way(2, "B road", "", "seasonal=winter"), way(3, "C road", "", "access:conditional=no @ Jun 1 - Aug 31")]
    out = assess(rows, depart="2027-12-20T08:00")
    assert [(w["road"], w["level"]) for w in out] == [("A road", "closed"), ("B road", "check"), ("C road", "open")]


def test_night_closures_and_other_conditions_are_not_seasonal_warnings():
    rows = [way(1, "Night road", "", "access:conditional=no @ (22:00-06:00)"), way(2, "Truck road", "", "access:conditional=delivery @ (Mo-Fr)")]
    assert assess(rows) == []


def test_seasonal_tag_without_dates_says_check():
    (w,) = assess([way(1, "Mine road", "", "seasonal=winter")])
    assert w["level"] == "check" and "seasonal=winter" in w["message"]


# ---------- chunking and the whole check ----------


def test_chunks_stay_under_the_trace_limits_and_share_their_joints():
    # 400 km of road east along 39 N, one point every 100 m.
    pts = [(39.0, -106.0 + i * 0.001155) for i in range(4000)]
    pieces = seasonal.chunks(pts)
    assert len(pieces) >= 4
    assert all(len(p) <= seasonal.CHUNK_POINTS for p in pieces)
    assert pieces[0][0] == pts[0] and pieces[-1][-1] == pts[-1]
    assert all(a[-1] == b[0] for a, b in zip(pieces, pieces[1:]))
    from app.geometry import haversine_m

    assert all(sum(haversine_m(p, q) for p, q in zip(piece, piece[1:])) <= seasonal.CHUNK_M + 200 for piece in pieces)


def test_check_looks_up_the_ways_valhalla_reports(tmp_path, monkeypatch):
    extract = Extract(seasonal_ways=[SeasonalWay(400, "secondary", "Trail Ridge Road", "US 34", TRAIL, 40.4, -105.75), SeasonalWay(999, "track", "Elsewhere", "", "seasonal=winter", 38, -106)])
    path = tmp_path / "pois.sqlite"
    db.write_all(path, extract, build_clusters([]))
    asked = []

    def trace(points, client=None):
        asked.append(len(points))
        return {400, 12345}  # one flagged way, one ordinary one

    monkeypatch.setattr(valhalla, "trace_way_ids", trace)
    route = [(40.0 + i * 0.01, -105.0) for i in range(60)]
    out = seasonal.check(route, 90, "2027-01-10T08:00", 0, db.connect(path))
    assert [(w["road"], w["level"]) for w in out] == [("Trail Ridge Road", "closed")]
    assert asked  # the route went to Valhalla's trace_attributes


def test_ways_valhalla_does_not_report_give_no_warning(tmp_path, monkeypatch):
    path = tmp_path / "pois.sqlite"
    db.write_all(path, Extract(seasonal_ways=[SeasonalWay(400, "secondary", "Trail Ridge Road", "US 34", TRAIL, 40.4, -105.75)]), build_clusters([]))
    monkeypatch.setattr(valhalla, "trace_way_ids", lambda points, client=None: {1, 2, 3})
    assert seasonal.check([(40.0, -105.0), (40.1, -105.0)], 60, "2027-01-10T08:00", 0, db.connect(path)) == []
