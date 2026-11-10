"""Candidate stops along a route, and what each would cost in time.

    cands = find(con, timeline)              clusters within 2 mi of the line
    add_detours(cands, timeline, ...)        minutes each one adds

find() projects every nearby cluster onto the route to get its mile and its
minute, from the same Timeline the sidebar's totals come from.

Detours are direction-aware. For a candidate at mile M, take the route point 3
miles before (A) and 3 miles after (B):

    detour = time(A -> candidate) + time(candidate -> B) - time(A -> B)

All three are Valhalla drive times, so one-way streets, ramps and the median
of a divided highway count. A rest area on the far carriageway comes out with a
large detour, because getting there and back onto your own side means the next
interchange. The times come from /sources_to_targets in batches.
"""

import math
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import httpx
from shapely import STRtree
from shapely.geometry import LineString, Point as ShapelyPoint

from .. import valhalla
from ..geometry import METRES_PER_MILE
from ..pois import db
from ..timeline import Timeline
from ..valhalla import Point

CORRIDOR_M = 2 * METRES_PER_MILE  # candidates this close to the route
# The agreed limit is 5 minutes each way. The matrix figure above is the whole
# there-and-back (off the route and on again), so the limit on it is twice that.
# Phase 2 used 5 minutes in total, which was wrong (fixed in phase 3).
DETOUR_EACH_WAY_MIN = 5.0
DETOUR_LIMIT_MIN = 2 * DETOUR_EACH_WAY_MIN  # more than this, there and back, is "over the limit"
LEAD_MILES = 3.0  # A and B sit this far before and after the candidate
BATCH = 12  # candidates per matrix request: 24 x 24 pairs, under Valhalla's 2500
PIECE_M = 3000  # the route is cut into pieces this long to search it quickly
BOX_M = 30_000  # database queries cover the route in boxes this long


# ---------- finding candidates ----------


def find(con, tl: Timeline, corridor_m: float = CORRIDOR_M) -> list[dict]:
    """Clusters within `corridor_m` (2 mi unless the trip says otherwise) of the route, each with its mile and minute.

    A cluster the route passes twice (a loop) appears twice, once per pass.
    Sorted by mile. Cluster fields are as db.cluster_dict gives them, plus:
    key, mile, minute, off_route_m.
    """
    clusters = {}
    for box in route_boxes(tl, corridor_m):
        for c in db.clusters_in_box(con, *box):
            clusters[c["id"]] = c

    pieces = route_pieces(tl)
    tree = STRtree([geom for geom, _ in pieces])
    out = []
    for c in clusters.values():
        pt = ShapelyPoint(tl.proj.xy(c["lat"], c["lon"]))
        hits = sorted(tree.query(pt, predicate="dwithin", distance=corridor_m))
        for run in runs(hits):
            best = min(run, key=lambda i: pieces[i][0].distance(pt))
            geom, start_m = pieces[best]
            off = geom.distance(pt)
            mile, minute = tl.interpolate(start_m + geom.project(pt))
            out.append({**c, "key": f"{c['id']}@{mile:.1f}", "mile": round(mile, 1), "minute": round(minute, 1), "off_route_m": round(off)})
    out.sort(key=lambda c: c["mile"])
    return out


def runs(indexes) -> list[list[int]]:
    """Group sorted piece numbers into runs of neighbours: one run per pass of the route."""
    groups: list[list[int]] = []
    for i in indexes:
        if groups and i - groups[-1][-1] <= 1:
            groups[-1].append(int(i))
        else:
            groups.append([int(i)])
    return groups


def route_pieces(tl: Timeline) -> list[tuple[LineString, float]]:
    """The route cut into pieces about PIECE_M long: (line in flat metres, metres from the start)."""
    out, first = [], 0
    for i in range(1, len(tl.xy)):
        if tl.cum_m[i] - tl.cum_m[first] >= PIECE_M or i == len(tl.xy) - 1:
            if i > first:
                out.append((LineString(tl.xy[first : i + 1]), tl.cum_m[first]))
            first = i
    return out


def route_boxes(tl: Timeline, corridor_m: float = CORRIDOR_M) -> list[tuple[float, float, float, float]]:
    """(south, west, north, east) boxes along the route, each padded by the corridor."""
    pad_lat = corridor_m / 111_195 * 1.2
    boxes, first = [], 0
    for i in range(1, len(tl.points)):
        if tl.cum_m[i] - tl.cum_m[first] >= BOX_M or i == len(tl.points) - 1:
            chunk = tl.points[first : i + 1]
            lats, lons = [p[0] for p in chunk], [p[1] for p in chunk]
            pad_lon = pad_lat / math.cos(math.radians(max(abs(min(lats)), abs(max(lats)))))
            boxes.append((min(lats) - pad_lat, min(lons) - pad_lon, max(lats) + pad_lat, max(lons) + pad_lon))
            first = i
    return boxes


# ---------- detours ----------


class DetourCache:
    """Detour times remembered between requests, so editing one end of a trip
    does not recompute the candidates at the other end.

    The key holds everything the answer depends on: the candidate, the two
    route points around it, and the road options and avoid zones.
    """

    def __init__(self, size: int = 20_000):
        self.size = size
        self.data: OrderedDict[tuple, tuple[float | None, float | None, float | None]] = OrderedDict()

    def get(self, key):
        if key in self.data:
            self.data.move_to_end(key)
            return self.data[key]
        return None

    def put(self, key, value):
        self.data[key] = value
        while len(self.data) > self.size:
            self.data.popitem(last=False)


CACHE = DetourCache()


def add_detours(
    cands: list[dict],
    tl: Timeline,
    *,
    pace: float,
    scope: str = "",
    exclude_polygons: list | None = None,
    costing_options: dict | None = None,
    client: httpx.Client | None = None,
    cache: DetourCache | None = None,
) -> dict:
    """Fill detour_min, over_limit and detour_status on every candidate.

    `scope` identifies the road options and zones in the cache key. Returns
    counts and timing for the status bar.
    """
    cache = CACHE if cache is None else cache
    started = time.perf_counter()
    todo, hits = [], 0
    for c in cands:
        a = tl.at_mile(c["mile"] - LEAD_MILES)
        b = tl.at_mile(c["mile"] + LEAD_MILES)
        c["_a"], c["_b"] = a, b
        key = (c["id"], round(c["lat"], 5), round(c["lon"], 5), round(a[0], 4), round(a[1], 4), round(b[0], 4), round(b[1], 4), scope)
        c["_key"] = key
        times = cache.get(key)
        if times is None:
            todo.append(c)
        else:
            hits += 1
            set_detour(c, times, pace)

    batches = [todo[i : i + BATCH] for i in range(0, len(todo), BATCH)]
    calls = 0

    def run(batch):
        return matrix_batch(batch, exclude_polygons, costing_options, client)

    if batches:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for batch, (times, n) in zip(batches, pool.map(run, batches)):
                calls += n
                for c, t in zip(batch, times):
                    cache.put(c["_key"], t)
                    set_detour(c, t, pace)
    for c in cands:
        for private in ("_a", "_b", "_key"):
            c.pop(private, None)
    return {
        "candidates": len(cands),
        "cached": hits,
        "matrix_calls": calls,
        "detour_ms": round((time.perf_counter() - started) * 1000),
    }


def matrix_batch(batch: list[dict], exclude_polygons, costing_options, client) -> tuple[list[tuple], int]:
    """(A->c, c->B, A->B) seconds for each candidate in the batch, and the number of requests made.

    One request has sources A1..An, c1..cn and targets c1..cn, B1..Bn; the
    three numbers per candidate are on its diagonals. If Valhalla refuses
    (two candidates further apart than its 400 km limit), the batch is halved.
    """
    n = len(batch)
    sources = [Point(*c["_a"]) for c in batch] + [Point(c["lat"], c["lon"]) for c in batch]
    targets = [Point(c["lat"], c["lon"]) for c in batch] + [Point(*c["_b"]) for c in batch]
    try:
        m = valhalla.matrix(sources, targets, exclude_polygons=exclude_polygons, costing_options=costing_options, client=client)
    except valhalla.ValhallaError:
        if n == 1:
            return [(None, None, None)], 1
        left, right = batch[: n // 2], batch[n // 2 :]
        (lt, ln), (rt, rn) = (matrix_batch(part, exclude_polygons, costing_options, client) for part in (left, right))
        return lt + rt, ln + rn + 1
    return [(m[i][i], m[n + i][n + i], m[i][n + i]) for i in range(n)], 1


def set_detour(c: dict, times: tuple, pace: float) -> None:
    """Detour minutes from (A->c, c->B, A->B) seconds; None when Valhalla found no path."""
    to_c, from_c, direct = times
    if to_c is None or from_c is None or direct is None:
        c.update(detour_min=None, over_limit=True, detour_status="unreachable")
        return
    minutes = max(0.0, (to_c + from_c - direct) * pace / 60)
    c.update(detour_min=round(minutes, 1), over_limit=minutes > DETOUR_LIMIT_MIN, detour_status="ok")
