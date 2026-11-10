"""Google Maps links, one or more per driving day.

Format and limits come from Google's Maps URLs documentation
(https://developers.google.com/maps/documentation/urls/get-started, read
2026-11-09), the "Directions" action:

    https://www.google.com/maps/dir/?api=1&origin=A&destination=B&waypoints=P%7CQ&travelmode=driving

- `waypoints` are separated by `|` (written %7C); coordinates are "lat,lon".
- "The number of waypoints allowed varies by the platform where the link
  opens, with up to three waypoints supported on mobile browsers, and a
  maximum of nine waypoints supported otherwise."
- The URL must stay under 2,048 characters.

A day with more points than that is split into several links that follow
each other: the next link starts where the last one ended. Through points
are sent as waypoints, so Google's route passes them (it would otherwise
choose its own road). Google has no way to mark a waypoint as "pass, don't
stop", so each one shows as a stop. Google may still route between the
points differently from Valhalla.
"""

from urllib.parse import quote, urlencode

from ..models import RoadOptions
from .common import PLANNED_STOPS, day_rows, hm, selected_days

LIMITS = {"mobile": 3, "desktop": 9}  # waypoints per link, from the documentation above
MAX_URL = 2048
BASE = "https://www.google.com/maps/dir/"


def point(row: dict) -> str:
    return f"{row['lat']:.5f},{row['lon']:.5f}"


def day_points(rows: list[dict], include_stops: bool) -> list[dict]:
    """The places of a day Google is told about, in order: the start, the user's
    through points and stops, optionally the planned breaks, meals and fuel, the end.
    Places at the same spot as the one before are left out."""
    keep = ["through", "stop"] + (list(PLANNED_STOPS) if include_stops else [])
    out = []
    for i, r in enumerate(rows):
        if r.get("lat") is None:
            continue
        if i == 0 or i == len(rows) - 1 or r["type"] in keep:
            if out and point(out[-1]) == point(r):
                continue
            out.append(r)
    return out


def split(points: list[dict], limit: int) -> list[tuple[dict, list[dict], dict]]:
    """(origin, waypoints, destination) per link; each link ends where the next begins."""
    links, a = [], 0
    last = len(points) - 1
    while a < last:
        if last - a - 1 <= limit:
            links.append((points[a], points[a + 1 : last], points[last]))
            break
        links.append((points[a], points[a + 1 : a + 1 + limit], points[a + 1 + limit]))
        a += 1 + limit
    return links


def url(origin: dict, waypoints: list[dict], destination: dict, options: RoadOptions) -> str:
    q = {"api": "1", "origin": point(origin), "destination": point(destination), "travelmode": "driving"}
    if waypoints:
        q["waypoints"] = "|".join(point(w) for w in waypoints)
    avoid = [w for w, on in (("tolls", options.avoid_tolls), ("ferries", options.avoid_ferries)) if on]
    if avoid:
        q["avoid"] = ",".join(avoid)
    return f"{BASE}?{urlencode(q, quote_via=quote, safe='')}"


def build(plan: dict, options: RoadOptions, platform: str = "mobile", include_stops: bool = True, only: list[int] | None = None) -> list[dict]:
    """One entry per driving day: {day, title, links: [{url, from, to, waypoints}], note}."""
    limit = LIMITS[platform]
    out = []
    for day in selected_days(plan, only):
        rows = day_rows(plan, day)
        points = day_points(rows, include_stops)
        links = []
        for origin, waypoints, destination in split(points, limit):
            link = url(origin, waypoints, destination, options)
            links.append({"url": link, "from": origin["name"], "to": destination["name"], "waypoints": len(waypoints),
                          "points": [origin["name"], *[w["name"] for w in waypoints], destination["name"]], "length": len(link)})
        n = len(points) - 2
        note = ""
        if len(links) > 1:
            note = f"{n} stops in between is more than {limit} per link, so this day is {len(links)} links: open them in order."
        out.append({"day": day["day"], "title": f"Day {day['day']} · {day['start']} → {day['end']}", "miles": day["miles"],
                    "driving": hm(day["driving_minutes"]), "stops": max(n, 0), "links": links, "note": note})
    return out
