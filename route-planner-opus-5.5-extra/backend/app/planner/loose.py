"""Big roadside groups, cut down to the part a driver would stop at.

Phase 2 groups loose businesses (not near an exit, a town or a plaza) by
chaining any two within half a mile of each other. In a city's outskirts the
chain runs on for miles: "Near Redmond" has 134 places to eat, and its middle
can be miles from any of them. As a break, that would be a dot that means
nothing.

So for a big group along the route, keep the member nearest the route and the
members within half a mile of it, and work the counts, the position and the
mile out again from those. The name stays ("Near Redmond"); `spread` says how
much of the group was kept.

This runs once per route, before the detours are asked for, so the detour is
the detour to the place the planner will actually name.
"""

from bisect import bisect_left, bisect_right

from shapely.geometry import LineString, Point as ShapelyPoint

from ..pois import db
from ..pois.clusters import GROUP_RADIUS_M, Cluster, distance_m
from ..timeline import Timeline

BIG = 12  # a loose group with more fuel, food and lodging than this gets cut down
NEAR_PASS_MILES = 3.0  # "nearest the route" means nearest this pass of it, for loops


def tighten(cands: list[dict], con, tl: Timeline) -> list[dict]:
    """Cut every big loose group in `cands` down to its part nearest the route. Sorted by mile again."""
    for c in cands:
        if c["kind"] == "other" and c["food"] + c["fuel"] + c["lodging"] > BIG:
            members = db.cluster_members(con, c["id"])
            if members:
                cut_down(c, members, tl)
    cands.sort(key=lambda c: c["mile"])
    return cands


def cut_down(c: dict, members: list, tl: Timeline) -> None:
    """Replace the candidate's position and counts with those of its members
    within GROUP_RADIUS_M of the one nearest the route."""
    line, start_m = route_near(tl, c["mile"])
    point = lambda p: ShapelyPoint(tl.proj.xy(p.lat, p.lon))  # noqa: E731
    nearest = min(members, key=lambda p: line.distance(point(p)))
    kept = [p for p in members if distance_m(p, nearest) <= GROUP_RADIUS_M]

    part = Cluster(kind="other", name=c["name"], lat=nearest.lat, lon=nearest.lon, members=kept)
    part.finish()
    pt = ShapelyPoint(tl.proj.xy(part.lat, part.lon))
    mile, minute = tl.interpolate(start_m + line.project(pt))
    c.update(
        lat=part.lat,
        lon=part.lon,
        food=part.food,
        food_fast=part.food_fast,
        food_sitdown=part.food_sitdown,
        food_cafe=part.food_cafe,
        fuel=part.fuel,
        lodging=part.lodging,
        detail=part.detail,
        mile=round(mile, 1),
        minute=round(minute, 1),
        off_route_m=round(line.distance(pt)),
        key=f"{c['id']}@{mile:.1f}",
        spread={"kept": len(kept), "of": len(members)},
    )


def route_near(tl: Timeline, mile: float) -> tuple[LineString, float]:
    """The route from NEAR_PASS_MILES before `mile` to as far after it, in flat
    metres, and how far along the whole route that piece starts."""
    i = max(bisect_left(tl.miles, mile - NEAR_PASS_MILES) - 1, 0)
    j = min(bisect_right(tl.miles, mile + NEAR_PASS_MILES), len(tl.xy) - 1)
    if j <= i:
        j = min(i + 1, len(tl.xy) - 1)
        i = j - 1
    return LineString(tl.xy[i : j + 1]), tl.cum_m[i]
