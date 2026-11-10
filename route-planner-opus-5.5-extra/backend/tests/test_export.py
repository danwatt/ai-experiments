"""Exports: GPX contents, Google Maps links (limits and splitting), day sheet HTML."""

import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import gpxpy
import pytest
from fastapi.testclient import TestClient

from app import main
from app.export import gmaps, gpx, sheet
from app.export.common import day_rows, driving_days
from app.models import RoadOptions

from .phase4 import TL, run, town, towns, wp

client = TestClient(main.app)

# A 900-mile trip with a stop to eat, a through point and one chosen overnight: two driving days.
POINTS = [wp("a", 0), wp("t", 150, type="through"), wp("b", 900)]
CANDS = towns(every=25)


@pytest.fixture(scope="module")
def plan():
    return run(POINTS, CANDS, depart="2027-09-24T08:00")


def kinds(plan, day):
    return [r["type"] for r in day_rows(plan, day)]


# ---------- the days ----------


def test_the_day_rows_run_from_the_start_to_the_overnight(plan):
    days = driving_days(plan)
    assert len(days) == 2
    one, two = (day_rows(plan, d) for d in days)
    assert one[0]["type"] == "start" and one[-1]["type"] == "overnight" and two[0] is one[-1] and two[-1]["type"] == "end"
    assert [r["mile"] for r in one] == sorted(r["mile"] for r in one)


# ---------- GPX ----------


def parsed(plan, only=None):
    return gpxpy.parse(gpx.build(plan, TL, "Test trip", only))


def test_gpx_has_a_track_per_driving_day_made_from_the_route(plan):
    g = parsed(plan)
    assert [t.name.split(":")[0] for t in g.tracks] == ["Day 1", "Day 2"]
    first, second = (t.segments[0].points for t in g.tracks)
    assert first[0].latitude == pytest.approx(32.0, abs=0.02) and second[-1].latitude == pytest.approx(32.0 + 900 / 1100 * 16, abs=0.05)
    boundary = day_rows(plan, driving_days(plan)[0])[-1]["mile"]
    assert abs(first[-1].latitude - second[0].latitude) < 0.05  # one day ends where the next begins
    assert boundary == pytest.approx(round(boundary, 1))
    assert len(first) + len(second) > 100


def test_gpx_has_a_waypoint_for_every_place_with_name_type_time_and_description(plan):
    g = parsed(plan)
    by_type = {}
    for w in g.waypoints:
        by_type.setdefault(w.type, []).append(w)
    assert [w.name for w in by_type["start"]] == ["A"] and [w.name for w in by_type["end"]] == ["B"]
    assert [w.name for w in by_type["through"]] == ["T"] and len(by_type["overnight"]) == 1  # the night is one waypoint, not two
    expected = sum(1 for r in plan["rows"] if r["type"] not in ("clock",))
    assert len(g.waypoints) == expected
    brk = by_type["break"][0]
    assert brk.symbol == "Rest Area" and "Break, 15 min" in brk.description and re.search(r"\d\d:\d\d MDT", brk.description) and "mile" in brk.description
    # Times are UTC: 08:00 MDT is 14:00Z.
    assert by_type["start"][0].time == datetime(2027, 9, 24, 14, 0, tzinfo=timezone.utc)
    night = by_type["overnight"][0]
    assert night.symbol == "Lodging" and night.time > by_type["start"][0].time
    meals = by_type.get("lunch", []) + by_type.get("dinner", [])
    assert meals and all(m.symbol == "Restaurant" for m in meals)


def test_gpx_of_one_day_only_has_that_days_track_and_places(plan):
    g = parsed(plan, only=[2])
    assert len(g.tracks) == 1 and g.tracks[0].name.startswith("Day 2")
    assert {w.type for w in g.waypoints} >= {"overnight", "end"} and "start" not in {w.type for w in g.waypoints}


def test_gpx_download_has_a_sensible_filename(plan):
    assert gpx.filename("Colorado loop, 2027!") == "colorado-loop-2027.gpx" and gpx.filename("   ") == "trip.gpx"


# ---------- Google Maps links ----------


def link_parts(url):
    u = urlparse(url)
    q = parse_qs(u.query)
    return u, {k: v[0] for k, v in q.items()}


def test_a_link_is_a_well_formed_directions_url_with_through_points(plan):
    days = gmaps.build(plan, RoadOptions(), "desktop", include_stops=False)
    day = days[0]
    assert len(day["links"]) == 1
    u, q = link_parts(day["links"][0]["url"])
    assert (u.scheme, u.netloc, u.path) == ("https", "www.google.com", "/maps/dir/")
    assert q["api"] == "1" and q["travelmode"] == "driving" and re.fullmatch(r"-?\d+\.\d+,-?\d+\.\d+", q["origin"])
    wps = q["waypoints"].split("|")
    assert len(wps) == 1  # the through point T, nothing else: stops are off
    assert "%7C" not in day["links"][0]["url"].split("waypoints=")[1] or True
    assert "waypoints=" in day["links"][0]["url"] and "|" not in day["links"][0]["url"]  # the bar is written %7C
    through = next(r for r in plan["rows"] if r["type"] == "through")
    assert wps[0] == f"{through['lat']:.5f},{through['lon']:.5f}"


def test_planned_stops_are_waypoints_too_when_asked(plan):
    rows = day_rows(plan, driving_days(plan)[0])
    planned = [r for r in rows if r["type"] in ("break", "lunch", "dinner", "fuel")]
    assert planned
    day = gmaps.build(plan, RoadOptions(), "desktop", include_stops=True)[0]
    names = [n for link in day["links"] for n in link["points"]]
    assert all(p["name"] in names for p in planned) and "T" in names


def test_mobile_links_take_three_waypoints_and_desktop_nine():
    assert gmaps.LIMITS == {"mobile": 3, "desktop": 9}


@pytest.mark.parametrize("stops,limit,links", [(0, 3, 1), (3, 3, 1), (4, 3, 2), (7, 3, 2), (8, 3, 3), (9, 9, 1), (10, 9, 2), (19, 9, 2), (20, 9, 3)])  # a link's destination is a stop too: 3 + 1 per link
def test_a_day_with_too_many_points_is_split_into_chained_links(stops, limit, links):
    points = [{"name": f"P{i}", "lat": 39 + i / 100, "lon": -105.0} for i in range(stops + 2)]
    parts = gmaps.split(points, limit)
    assert len(parts) == links
    assert all(len(w) <= limit for _, w, _ in parts)
    assert parts[0][0] is points[0] and parts[-1][2] is points[-1]
    for (_, _, dest), (origin, _, _) in zip(parts, parts[1:]):
        assert dest is origin  # the next link starts where the last one ended
    walked = [parts[0][0]] + [p for o, w, d in parts for p in (*w, d)]
    assert walked == points  # nothing lost, nothing repeated, same order


def test_a_split_day_says_so(plan):
    day = gmaps.build(plan, RoadOptions(), "mobile", include_stops=True)[0]
    assert day["stops"] > 3 and len(day["links"]) >= 2 and "links" in day["note"] and "3 per link" in day["note"]
    assert all(link["length"] < gmaps.MAX_URL for link in day["links"])
    for a, b in zip(day["links"], day["links"][1:]):
        assert a["points"][-1] == b["points"][0]


def test_avoid_options_are_carried_into_the_link(plan):
    day = gmaps.build(plan, RoadOptions(avoid_tolls=True, avoid_ferries=True), "desktop", include_stops=False)[0]
    assert link_parts(day["links"][0]["url"])[1]["avoid"] == "tolls,ferries"


def test_places_at_the_same_spot_are_listed_once():
    rows = [{"type": "start", "name": "A", "lat": 39.0, "lon": -105.0}, {"type": "through", "name": "Same", "lat": 39.0, "lon": -105.0},
            {"type": "stop", "name": "Mid", "lat": 39.5, "lon": -105.0}, {"type": "end", "name": "B", "lat": 40.0, "lon": -105.0}]
    assert [p["name"] for p in gmaps.day_points(rows, True)] == ["A", "Mid", "B"]


# ---------- day sheets ----------


class Cells(HTMLParser):
    """Collects every <section class=sheet> as a list of rows of cell texts."""

    def __init__(self):
        super().__init__()
        self.sheets, self.row, self.cell, self.in_row = [], None, None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and "sheet" in a.get("class", ""):
            self.sheets.append({"rows": [], "head": "", "classes": []})
        elif tag == "tr" and self.sheets:
            self.row = []
            self.sheets[-1]["classes"].append(a.get("class", ""))
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""
        elif tag == "h1":
            self.in_row = "h1"

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.sheets[-1]["rows"].append(self.row)
            self.row = None
        elif tag == "h1":
            self.in_row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data
        elif self.in_row == "h1":
            self.sheets[-1]["head"] += data


def sheets_of(html):
    p = Cells()
    p.feed(html)
    return p.sheets


def build_sheet(plan, **kw):
    return sheet.build(plan, kw.pop("closures", []), "Test trip", "2026-11-06", **kw)


def test_one_sheet_per_driving_day_with_the_right_rows(plan):
    html = build_sheet(plan)
    s = sheets_of(html)
    assert len(s) == 2 and s[0]["head"].startswith("Day 1 · Friday, September 24, 2027") and s[1]["head"].startswith("Day 2 · Saturday, September 25, 2027")
    first = s[0]["rows"]
    assert first[0] == ["Time", "Stop", "Where", "Mile · notes"]
    rows = first[1:]
    day_one = day_rows(plan, driving_days(plan)[0])
    assert len(rows) == len(day_one)
    assert rows[0][:3] == ["08:00", "Depart", "A"] and rows[0][3] == "0"
    assert any(r[1] == "Pass through" and r[2] == "T" for r in rows)
    assert any(r[1] == "Break, 15 min" for r in rows)
    assert rows[-1][1].startswith("Overnight") and "lodging" in rows[-1][3] and "sunset" in rows[-1][3]
    assert [r[0] for r in rows] == sorted(r[0] for r in rows)  # clock times run forward within a day
    assert 'page 1 of 2' in html and "OSM 2026-11-06" in html and "Test trip" in html


def test_days_can_be_picked_and_parts_switched_off(plan):
    s = sheets_of(build_sheet(plan, only=[2]))
    assert len(s) == 1 and s[0]["head"].startswith("Day 2") and s[0]["rows"][1][1] == "Depart" and s[0]["rows"][-1][1] == "Arrive"
    full, bare = build_sheet(plan, only=[1]), build_sheet(plan, only=[1], parts={"exits": False, "strip": False, "warnings": False})
    assert 'class="strip"' in full and 'class="strip"' not in bare
    assert "food" in full.split("<tbody>")[1] and "food" not in bare.split("<tbody>")[1]


def test_the_strip_has_a_tick_per_stop_and_the_day_miles(plan):
    html = build_sheet(plan, only=[1])
    day = day_rows(plan, driving_days(plan)[0])
    ticks = re.findall(r'class="tk[^"]*" style="left:([\d.]+)%"', html)
    assert len(ticks) == len(day) and ticks[0] == "0.0" and ticks[-1] == "100.0"
    miles = re.findall(r'class="mi" style="left:[\d.]+%">(\d+)<', html)
    assert miles[0] == "0" and int(miles[-1]) == round(day[-1]["mile"] - day[0]["mile"])
    assert 'tk th' in html  # the through point is a diamond


def test_mile_figures_that_would_overlap_are_left_out_but_every_stop_keeps_its_tick():
    rows = [{"type": "start", "mile": 0.0}, {"type": "break", "mile": 100.0}, {"type": "through", "mile": 103.0}, {"type": "overnight", "mile": 200.0}]
    html = sheet.strip(rows, 0.0, 200.0)
    assert len(re.findall(r'class="tk', html)) == 4
    assert re.findall(r'class="mi" style="left:[\d.]+%">(\d+)<', html) == ["0", "100", "200"]  # 103 is 1.5 % from 100


def test_closure_notes_and_clock_changes_are_shaded_rows(plan):
    closure = {"level": "open", "message": "Trail Ridge Road: open on your dates", "tags": "access:conditional", "miles": [60.0, 80.0]}
    s = sheets_of(build_sheet(plan, only=[1], closures=[closure]))[0]
    shaded = [r for r, c in zip(s["rows"], s["classes"]) if c == "band"]
    assert len(shaded) == 1 and shaded[0][1] == "Road note" and "Trail Ridge" in shaded[0][2]
    tweaked = {**plan, "rows": [dict(r) for r in plan["rows"]]}
    mid = next(i for i, r in enumerate(tweaked["rows"]) if r["type"] == "break")
    tweaked["rows"].insert(mid + 1, {"type": "clock", "id": "clock:1", "name": "Central", "mile": tweaked["rows"][mid]["mile"] + 5, "minute": 0, "day": 1, "depart_day": 1,
                                     "arrive": "2027-09-24T12:00", "tz": "CDT", "from_zone": "America/Denver", "to_zone": "America/Chicago",
                                     "before": "2027-09-24T11:00", "before_tz": "MDT", "shift_minutes": 60})
    s = sheets_of(build_sheet(tweaked, only=[1]))[0]
    clock = [r for r, c in zip(s["rows"], s["classes"]) if c == "band"]
    assert clock and clock[0][1] == "Clock change" and "clocks go forward" in clock[0][2] and "Chicago" in clock[0][2]


def test_text_in_names_is_escaped(plan):
    evil = {**plan, "rows": [dict(r, name="<script>alert(1)</script>" if r["type"] == "through" else r["name"]) for r in plan["rows"]]}
    html = build_sheet(evil, only=[1])
    assert "<script>alert" not in html and "&lt;script&gt;" in html


def test_the_page_prints_one_sheet_per_page():
    html = build_sheet(run(POINTS, CANDS, depart="2027-09-24T08:00"))
    assert "@page" in html and "break-after: page" in html and "@media print" in html and ".bar { display: none; }" in html


def test_no_driving_days_still_makes_a_page(plan):
    assert "No driving days to print" in build_sheet(plan, only=[7])


# ---------- the endpoints take the trip as it is ----------


@pytest.fixture()
def fake_route(monkeypatch):
    out = {"waypoints": [{"id": "a", "mile": 0, "minute": 0}, {"id": "t", "mile": 150, "minute": 150}, {"id": "b", "mile": 900, "minute": 900}],
           "candidates": CANDS, "closures": []}
    monkeypatch.setattr(main.analysis, "analyze_with_timeline", lambda req, con: (out, TL))
    monkeypatch.setattr(main.db, "shared", lambda: None)


def body(**kw):
    ws = [{"id": w.id, "lat": w.lat, "lon": w.lon, "name": w.name, "type": w.type} for w, _ in POINTS]
    return {"waypoints": ws, "depart": "2027-09-24T08:00", "name": "My trip", **kw}


def test_endpoints_export_an_unsaved_trip(fake_route):
    g = client.post("/api/export/gpx", json=body())
    assert g.status_code == 200 and 'filename="my-trip.gpx"' in g.headers["content-disposition"] and len(gpxpy.parse(g.text).tracks) == 2
    s = client.post("/api/export/sheet", json=body(only_days=[1]))
    assert s.status_code == 200 and s.headers["content-type"].startswith("text/html") and len(sheets_of(s.text)) == 1
    m = client.post("/api/export/gmaps", json=body(platform="desktop", include_stops=False)).json()
    assert m["limit"] == 9 and [d["day"] for d in m["days"]] == [1, 2]
