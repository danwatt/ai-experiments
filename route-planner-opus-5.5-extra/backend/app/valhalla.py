"""A small Valhalla client: ask for a route, decode its shape.

Valhalla docs: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
"""

import os
from dataclasses import dataclass

import httpx

VALHALLA_URL = os.environ.get("VALHALLA_URL", "http://valhalla:8002")


class ValhallaError(Exception):
    """Valhalla answered with an error. `code` is Valhalla's own error code."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


@dataclass
class Point:
    lat: float
    lon: float
    # "break" starts/ends a leg; "through" only shapes the route.
    type: str = "break"

    def as_location(self) -> dict:
        return {"lat": self.lat, "lon": self.lon, "type": self.type}


def decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decode a Valhalla shape into [(lat, lon), ...].

    Same algorithm as Google's polyline, but with 6 decimal places.
    """
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):  # one latitude delta, then one longitude delta
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        coords.append((lat / 1e6, lon / 1e6))
    return coords


def status(client: httpx.Client | None = None) -> dict:
    """Valhalla's /status document. Raises httpx.HTTPError if unreachable."""
    return _get("/status", client)


def route(
    points: list[Point],
    *,
    alternates: int = 0,
    exclude_polygons: list[list[tuple[float, float]]] | None = None,
    date_time: str | None = None,
    costing_options: dict | None = None,
    client: httpx.Client | None = None,
) -> dict:
    """Request a route and return Valhalla's JSON.

    exclude_polygons: rings of (lon, lat) pairs, as Valhalla wants them.
    date_time: local departure time, e.g. "2027-09-24T08:00".
    The result has the main route under "trip" and extra ones under
    "alternates" (each of those is {"trip": ...}).
    """
    body: dict = {
        "locations": [p.as_location() for p in points],
        "costing": "auto",
        "directions_options": {"units": "miles"},
    }
    if alternates:
        body["alternates"] = alternates
    if exclude_polygons:
        body["exclude_polygons"] = [[list(pt) for pt in ring] for ring in exclude_polygons]
    if date_time:
        body["date_time"] = {"type": 1, "value": date_time}  # 1 = depart at
    if costing_options:
        body["costing_options"] = {"auto": costing_options}
    return post_route(body, client)


def post_route(body: dict, client: httpx.Client | None = None) -> dict:
    """Send a ready-made /route request body. See routing.build_request."""
    return _post("/route", body, client)


def matrix(
    sources: list[Point],
    targets: list[Point],
    *,
    exclude_polygons: list | None = None,
    costing_options: dict | None = None,
    client: httpx.Client | None = None,
) -> list[list[float | None]]:
    """Drive times in seconds, `result[i][j]` from sources[i] to targets[j].

    None where there is no path (a point inside an excluded polygon, or an
    island). Valhalla caps a request at 2500 source-target pairs and 400 km
    between any pair (service_limits.auto).
    """
    body: dict = {
        "sources": [{"lat": p.lat, "lon": p.lon} for p in sources],
        "targets": [{"lat": p.lat, "lon": p.lon} for p in targets],
        "costing": "auto",
    }
    if exclude_polygons:
        body["exclude_polygons"] = [[list(pt) for pt in ring] for ring in exclude_polygons]
    if costing_options:
        body["costing_options"] = {"auto": costing_options}
    rows = _post("/sources_to_targets", body, client)["sources_to_targets"]
    return [[cell.get("time") for cell in row] for row in rows]


def trace_way_ids(points: list[tuple[float, float]], *, client: httpx.Client | None = None) -> set[int]:
    """OSM way ids of the roads a (lat, lon) line follows.

    Valhalla snaps the line to its graph (`map_snap`) and reports the way id
    of every edge. A request may carry at most 200 km and 16000 points
    (service_limits.trace); the caller cuts longer routes into chunks.
    """
    body = {
        "shape": [{"lat": lat, "lon": lon} for lat, lon in points],
        "costing": "auto",
        "shape_match": "map_snap",
        "filters": {"attributes": ["edge.way_id"], "action": "include"},
    }
    edges = _post("/trace_attributes", body, client).get("edges", [])
    return {e["way_id"] for e in edges if "way_id" in e}


def _get(path: str, client: httpx.Client | None) -> dict:
    owns = client is None
    client = client or httpx.Client(base_url=VALHALLA_URL, timeout=10)
    try:
        resp = client.get(path)
        resp.raise_for_status()
        return resp.json()
    finally:
        if owns:
            client.close()


def _post(path: str, body: dict, client: httpx.Client | None) -> dict:
    owns = client is None
    client = client or httpx.Client(base_url=VALHALLA_URL, timeout=120)
    try:
        resp = client.post(path, json=body)
        if resp.status_code >= 400:
            try:
                err = resp.json()
                raise ValhallaError(err.get("error", resp.text), err.get("error_code"))
            except ValueError:
                raise ValhallaError(resp.text) from None
        return resp.json()
    finally:
        if owns:
            client.close()
