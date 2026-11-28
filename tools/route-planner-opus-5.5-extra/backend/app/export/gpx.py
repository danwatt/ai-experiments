"""GPX: one track per driving day, a waypoint for every place and stop.

The track is the route's own shape between the day's first and last mile.
Each waypoint has its name, a type (the row type: break, lunch, overnight ...),
a symbol most GPS apps know, a short description with the local arrival time,
and `time`, the arrival as UTC (GPX times are UTC).
"""

from bisect import bisect_left, bisect_right
from datetime import datetime, timezone

import gpxpy.gpx as g

from ..planner import clock
from ..timeline import Timeline
from .common import PLACE_TYPES, day_rows, hm, selected_days

SYMBOLS = {  # Garmin symbol names, which other apps mostly show as a pin
    "start": "Flag, Green", "end": "Flag, Red", "through": "Navaid, Blue", "stop": "Flag, Blue",
    "break": "Rest Area", "lunch": "Restaurant", "dinner": "Restaurant", "fuel": "Gas Station", "overnight": "Lodging",
}
TITLES = {"start": "Start", "end": "End", "through": "Pass through", "stop": "Stop", "break": "Break", "lunch": "Lunch",
          "dinner": "Dinner", "fuel": "Fuel", "overnight": "Overnight"}


def describe(row: dict) -> str:
    """'Break, 15 min · 09:37 MDT · mile 85 · US-285 · 6 food, 2 fuel'"""
    parts = [TITLES[row["type"]]]
    if row.get("stay_minutes"):
        parts[0] += f", {hm(row['stay_minutes'])}"
    if row["type"] == "overnight" and row.get("nights", 1) > 1:
        parts[0] += f" ({row['nights']} nights)"
    if row.get("refuel") and row["type"] != "fuel":
        parts[0] += " + fuel"
    time = row.get("arrive") or row.get("depart")
    if time:
        parts.append(f"{time[11:16]} {row.get('tz') or ''}".strip())
    parts.append(f"mile {row['mile']:g}")
    if row.get("road"):
        parts.append(f"{row['road']} exit {row['ref']}" if row.get("kind") == "exit" and row.get("ref") else row["road"])
    amenities = [f"{row[k]} {k}" for k in ("food", "fuel", "lodging") if row.get(k)]
    if amenities and row["type"] not in ("start", "end", "through"):
        parts.append(", ".join(amenities))
    return " · ".join(parts)


def utc_of(row: dict, tl: Timeline) -> datetime | None:
    """The row's arrival (or departure, for the start) as an aware UTC time."""
    local = row.get("arrive") or row.get("depart")
    if not local:
        return None
    zone = clock.zone_at_mile(tl, row["mile"])
    return datetime.fromisoformat(local).replace(tzinfo=zone).astimezone(timezone.utc)


def build(plan: dict, tl: Timeline, name: str, only: list[int] | None = None) -> str:
    """The GPX document as text."""
    doc = g.GPX()
    doc.name = name
    doc.description = "Planned with Road trip planner"
    doc.creator = "Road trip planner"
    seen: set[str] = set()
    for day in selected_days(plan, only):
        rows = day_rows(plan, day)
        lo, hi = rows[0]["mile"], rows[-1]["mile"]
        a, b = bisect_left(tl.miles, lo), bisect_right(tl.miles, hi)
        track = g.GPXTrack(name=f"Day {day['day']}: {day['start']} → {day['end']}", description=f"{day['miles']:g} mi, {hm(day['driving_minutes'])} driving")
        seg = g.GPXTrackSegment()
        seg.points = [g.GPXTrackPoint(lat, lon) for lat, lon in tl.points[a:b]]
        track.segments.append(seg)
        doc.tracks.append(track)
        for r in rows:
            if r["type"] not in PLACE_TYPES or r.get("lat") is None:
                continue
            key = r["id"] if r["type"] in ("start", "through", "stop", "overnight", "end") else f"{r['type']}:{r['id']}:{r['mile']}"
            if key in seen:  # an overnight ends one day and starts the next
                continue
            seen.add(key)
            doc.waypoints.append(g.GPXWaypoint(
                latitude=r["lat"], longitude=r["lon"], name=r["name"], type=r["type"], symbol=SYMBOLS[r["type"]],
                description=describe(r), time=utc_of(r, tl),
            ))
    return doc.to_xml()


def filename(name: str) -> str:
    from .common import slug
    return f"{slug(name)}.gpx"
