"""Small geometry helpers. Points are (lat, lon) unless a name says otherwise.

Everything here works on short distances (a route, a zone), so a flat
projection around the first point is accurate enough and keeps the maths
readable: x and y in metres, as on a paper map.
"""

import math

from shapely.geometry import LineString, Point as ShapelyPoint, Polygon

EARTH_RADIUS_M = 6_371_000
METRES_PER_MILE = 1609.344


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two (lat, lon) points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


class LocalProjection:
    """Flat x/y metres around a reference latitude (equirectangular)."""

    def __init__(self, ref_lat: float):
        self.kx = math.radians(1) * EARTH_RADIUS_M * math.cos(math.radians(ref_lat))
        self.ky = math.radians(1) * EARTH_RADIUS_M

    def xy(self, lat: float, lon: float) -> tuple[float, float]:
        return lon * self.kx, lat * self.ky

    def latlon(self, x: float, y: float) -> tuple[float, float]:
        return y / self.ky, x / self.kx

    def line(self, points: list[tuple[float, float]]) -> LineString:
        return LineString([self.xy(lat, lon) for lat, lon in points])


def resample(xy: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    """Points every `step` metres along a polyline, keeping both ends."""
    if len(xy) < 2:
        return list(xy)
    out = [xy[0]]
    to_next = step  # distance left until the next sample
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        seg = math.hypot(x2 - x1, y2 - y1)
        pos = to_next
        while pos <= seg:
            t = pos / seg
            out.append((x1 + t * (x2 - x1), y1 + t * (y2 - y1)))
            pos += step
        to_next = pos - seg
    if out[-1] != xy[-1]:
        out.append(xy[-1])
    return out


def ring_perimeter_m(ring_lonlat: list[tuple[float, float]]) -> float:
    """Length of a closed ring of (lon, lat) pairs, closing it if needed."""
    pts = [(lat, lon) for lon, lat in ring_lonlat]
    if pts and pts[0] != pts[-1]:
        pts.append(pts[0])
    return sum(haversine_m(a, b) for a, b in zip(pts, pts[1:]))


def ring_contains(ring_lonlat: list[tuple[float, float]], lat: float, lon: float) -> bool:
    """True if (lat, lon) is inside or on the edge of the ring."""
    return Polygon(ring_lonlat).covers(ShapelyPoint(lon, lat))


def nearest_index(points: list[tuple[float, float]], lat: float, lon: float, start: int = 0, end: int | None = None) -> int:
    """Index of the shape point closest to (lat, lon), searching points[start:end]."""
    end = len(points) if end is None else end
    proj = LocalProjection(lat)
    x0, y0 = proj.xy(lat, lon)
    best, best_d = start, math.inf
    for i in range(start, end):
        x, y = proj.xy(*points[i])
        d = (x - x0) ** 2 + (y - y0) ** 2
        if d < best_d:
            best, best_d = i, d
    return best


def farthest_point(line: list[tuple[float, float]], others: list[list[tuple[float, float]]]) -> tuple[float, float]:
    """The point of `line` that is farthest from every line in `others`.

    Used to adopt an alternate route: a through point there is a place only
    that alternate passes, so the router keeps choosing it after later edits.
    """
    proj = LocalProjection(line[0][0])
    other_lines = [proj.line(o) for o in others if len(o) > 1]
    best, best_d = line[len(line) // 2], -1.0
    every = max(1, len(line) // 500)  # about 500 candidates is plenty
    for lat, lon in line[::every]:
        p = ShapelyPoint(proj.xy(lat, lon))
        d = min((o.distance(p) for o in other_lines), default=0.0)
        if d > best_d:
            best, best_d = (lat, lon), d
    return best
