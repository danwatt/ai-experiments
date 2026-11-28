"""Group single businesses into clusters a person would stop at.

The planner never thinks about one gas station. It thinks about "Exit 116,
Glenwood Springs: 9 food, 4 fuel, 6 lodging". This module builds those.

Anchors, in the order an amenity (fuel, food, lodging) picks one:

    1. a rest area or service plaza within PLAZA_RADIUS_M   (clusters of their own)
    2. the nearest exit within EXIT_RADIUS_M, 1 mile
    3. the nearest city, town or village within TOWN_RADIUS_M, about 2 miles
    4. none: amenities within GROUP_RADIUS_M of each other make an "other"
       cluster, named after the nearest place

Rest areas and service plazas always make a cluster, with or without amenities.
So do exits and towns, so a town with nothing in OSM still shows up.

Each cluster's position is the middle of its amenities when it has any (that
is where you would drive to), otherwise its anchor.
"""

import math
from collections import Counter
from dataclasses import dataclass, field

from .extract import Poi

PLAZA_RADIUS_M = 650  # 0.4 mi: businesses inside a service plaza
EXIT_RADIUS_M = 1609  # 1 mi
TOWN_RADIUS_M = 3219  # 2 mi
GROUP_RADIUS_M = 800  # 0.5 mi: how close loose businesses must be to count as one place
NAME_RADIUS_M = 8000  # a place this near gives a loose group (or a rest area) its name
EXIT_MERGE_M = 1500  # the two directions of one exit are mapped as two nodes
UNNUMBERED_EXIT_MERGE_M = 300

AMENITIES = ("fuel", "food", "lodging")
TOWNS = ("city", "town", "village")  # place subkinds that anchor amenities


@dataclass
class Cluster:
    kind: str  # rest_area, service_plaza, exit, town, other
    name: str
    lat: float
    lon: float
    anchor: Poi | None = None
    ref: str = ""  # exit number
    road: str = ""  # "I 70"
    near: str = ""  # nearest place, for rest areas and loose groups
    population: int | None = None
    toilets: bool | None = None
    picnic: bool | None = None
    members: list[Poi] = field(default_factory=list)

    # filled by finish()
    food: int = 0
    food_fast: int = 0
    food_sitdown: int = 0
    food_cafe: int = 0
    fuel: int = 0
    lodging: int = 0
    detail: dict = field(default_factory=dict)

    def finish(self) -> None:
        """Count the members, name their brands, and settle the position."""
        by_kind = Counter(m.kind for m in self.members)
        by_sub = Counter(m.subkind for m in self.members if m.kind == "food")
        self.food, self.fuel, self.lodging = by_kind["food"], by_kind["fuel"], by_kind["lodging"]
        self.food_fast, self.food_sitdown, self.food_cafe = by_sub["fast_food"], by_sub["restaurant"], by_sub["cafe"]
        cuisines = Counter()
        for m in self.members:
            if m.kind == "food" and m.cuisine:
                cuisines[m.cuisine.split(";")[0].strip().replace("_", " ")] += 1
        brands = {kind: Counter(m.brand for m in self.members if m.kind == kind and m.brand) for kind in AMENITIES}
        self.detail = {
            "cuisines": dict(cuisines.most_common(8)),
            "brands": {kind: dict(c.most_common(8)) for kind, c in brands.items() if c},
            "names": sorted({m.name for m in self.members if m.name})[:12],
        }
        if self.members:
            self.lat = sum(m.lat for m in self.members) / len(self.members)
            self.lon = sum(m.lon for m in self.members) / len(self.members)


# ---------- distances and a grid to find neighbours quickly ----------


def distance_m(a, b) -> float:
    """Metres between two things with .lat and .lon (flat approximation; fine under 50 km)."""
    dy = (a.lat - b.lat) * 111_195
    dx = (a.lon - b.lon) * 111_195 * math.cos(math.radians((a.lat + b.lat) / 2))
    return math.hypot(dx, dy)


class Grid:
    """Items bucketed in 0.05 degree cells (about 5 km), for 'who is near here'."""

    CELL = 0.05

    def __init__(self, items):
        self.cells: dict[tuple[int, int], list] = {}
        for item in items:
            self.cells.setdefault(self._key(item.lat, item.lon), []).append(item)

    def _key(self, lat, lon):
        return int(lat // self.CELL), int(lon // self.CELL)

    def near(self, point, radius_m: float):
        """(distance, item) for every item within radius_m of `point`."""
        reach = int(radius_m / 5500) + 1
        kx, ky = self._key(point.lat, point.lon)
        out = []
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for item in self.cells.get((kx + dx, ky + dy), ()):
                    d = distance_m(point, item)
                    if d <= radius_m:
                        out.append((d, item))
        return out

    def nearest(self, point, radius_m: float):
        """The closest item within radius_m, or None."""
        found = self.near(point, radius_m)
        return min(found, key=lambda pair: pair[0])[1] if found else None


# ---------- the anchors ----------


def merge_exits(exits: list[Poi]) -> list[list[Poi]]:
    """Group the exit nodes that are one exit.

    A numbered exit is usually mapped once per direction, a few hundred metres
    apart. Same ref, same road (when both are known) and within EXIT_MERGE_M:
    one exit. Exits without a number only merge when almost on top of each other.
    """
    parent = list(range(len(exits)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    grid = Grid(exits)
    index = {id(e): i for i, e in enumerate(exits)}
    for i, e in enumerate(exits):
        limit = EXIT_MERGE_M if e.ref else UNNUMBERED_EXIT_MERGE_M
        for _, other in grid.near(e, limit):
            j = index[id(other)]
            if other.ref == e.ref and not (other.road and e.road and other.road != e.road):
                parent[find(i)] = find(j)
    groups: dict[int, list[Poi]] = {}
    for i, e in enumerate(exits):
        groups.setdefault(find(i), []).append(e)
    return list(groups.values())


def exit_cluster(group: list[Poi]) -> Cluster:
    first = next((e for e in group if e.road), group[0])
    ref = first.ref
    name = next((e.name for e in group if e.name), "")
    road = first.road
    title = name or (f"{road} exit {ref}".strip() if ref else f"{road} exit".strip())
    title = title.strip() if title.strip() != "exit" else "Exit"
    return Cluster(
        kind="exit",
        name=title,
        lat=sum(e.lat for e in group) / len(group),
        lon=sum(e.lon for e in group) / len(group),
        anchor=first,
        ref=ref,
        road=road,
    )


PLACE_RANK = {"city": 0, "town": 1, "village": 2, "hamlet": 3}
SAME_PLACE_M = 8000  # two place nodes with one name this close are one place


def dedupe_places(pois: list[Poi]) -> list[Poi]:
    """Drop repeated place nodes (a town drawn twice, a village and its CDP).

    The bigger kind wins, then the one with a population. Other kinds pass through.
    """
    places = sorted(
        (p for p in pois if p.kind == "place" and p.name),
        key=lambda p: (PLACE_RANK.get(p.subkind, 9), -(p.population or 0)),
    )
    kept: list[Poi] = []
    grid_cells: dict[str, list[Poi]] = {}
    for p in places:
        same = grid_cells.setdefault(p.name.casefold(), [])
        if any(distance_m(p, q) <= SAME_PLACE_M for q in same):
            continue
        same.append(p)
        kept.append(p)
    drop = {id(p) for p in places} - {id(p) for p in kept}
    return [p for p in pois if id(p) not in drop]


def build_clusters(pois: list[Poi]) -> list[Cluster]:
    """All clusters for a list of pois. Each amenity ends up in exactly one."""
    by_kind: dict[str, list[Poi]] = {}
    for p in pois:
        by_kind.setdefault(p.kind, []).append(p)

    clusters: list[Cluster] = []
    plazas: list[Cluster] = []
    for p in by_kind.get("rest_area", []) + by_kind.get("service_plaza", []):
        c = Cluster(kind=p.kind, name=p.name, lat=p.lat, lon=p.lon, anchor=p, toilets=p.toilets, picnic=p.picnic)
        plazas.append(c)
    exits = [exit_cluster(g) for g in merge_exits(by_kind.get("exit", []))]
    places = by_kind.get("place", [])
    towns = [
        Cluster(kind="town", name=p.name, lat=p.lat, lon=p.lon, anchor=p, population=p.population)
        for p in places
        if p.subkind in TOWNS and p.name
    ]
    clusters += plazas + exits + towns

    plaza_grid, exit_grid, town_grid = Grid(plazas), Grid(exits), Grid(towns)
    place_grid = Grid(places)
    loose: list[Poi] = []
    for p in by_kind.get("fuel", []) + by_kind.get("food", []) + by_kind.get("lodging", []):
        target = plaza_grid.nearest(p, PLAZA_RADIUS_M) or exit_grid.nearest(p, EXIT_RADIUS_M) or town_grid.nearest(p, TOWN_RADIUS_M)
        if target:
            target.members.append(p)
        else:
            loose.append(p)

    for group in group_loose(loose):
        c = Cluster(kind="other", name="", lat=group[0].lat, lon=group[0].lon, members=group)
        c.lat = sum(m.lat for m in group) / len(group)
        c.lon = sum(m.lon for m in group) / len(group)
        clusters.append(c)

    for c in clusters:
        c.finish()
        if c.kind != "town":
            place = place_grid.nearest(c, NAME_RADIUS_M)
            c.near = place.name if place and place.name else ""
        if c.kind == "other":
            c.name = f"Near {c.near}" if c.near else most_common_name(c.members)
        if c.kind == "exit" and c.name == "Exit" and c.near:
            c.name = f"Exit near {c.near}"
        if c.kind in ("rest_area", "service_plaza") and not c.name:
            c.name = "Rest area" if c.kind == "rest_area" else "Service plaza"
    return clusters


def group_loose(loose: list[Poi]) -> list[list[Poi]]:
    """Single-link groups: amenities within GROUP_RADIUS_M of each other."""
    grid = Grid(loose)
    seen: set[int] = set()
    groups = []
    for start in loose:
        if id(start) in seen:
            continue
        seen.add(id(start))
        group, queue = [], [start]
        while queue:
            p = queue.pop()
            group.append(p)
            for _, other in grid.near(p, GROUP_RADIUS_M):
                if id(other) not in seen:
                    seen.add(id(other))
                    queue.append(other)
        groups.append(group)
    return groups


def most_common_name(members: list[Poi]) -> str:
    """Name for a group with no place nearby: its most common brand, else the first name."""
    brands = Counter(m.brand for m in members if m.brand)
    if brands:
        return brands.most_common(1)[0][0]
    return next((m.name for m in members if m.name), "Roadside stop")
