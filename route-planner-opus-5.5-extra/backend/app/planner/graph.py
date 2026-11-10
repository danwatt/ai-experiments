"""Choosing the breaks of one driving segment: a cheapest path through a graph.

A segment runs from one hard stop to the next (the start, a timed stop, an
overnight, the end). Its nodes, in route order:

    segment start -> candidate stops -> segment end

An edge joins two nodes when the drive between them stays within the hard
maximum: N x 1.1 minutes and M x 1.1 miles (N, M: the break interval). A path
from start to end is a list of breaks that never leaves you driving too long.

The cost of a path adds up, for every edge, how far that drive lands from the
75-100 % window, and for every stop, a fixed cost per break plus its own cost
(kind, detour, amenities; see choices.py). The cheapest path is the plan.

Pinned stops must be on the path: an edge may not jump over one.

If no path keeps to the rules (a long stretch with nothing on it), the rules
are relaxed one step at a time, and only as far as needed:

    1. stops over the detour limit may be used, at a high cost each;
    2. drives longer than the hard maximum may be used, at a high cost per minute.

Step 2 always finds a path (start straight to end, if nothing else), so
planning never fails. The caller reports what had to be relaxed.

Since phase 4 the planner uses stops.py, which walks the same graph with
the same edge and stop costs but also carries the clock, meals and fuel.
This break-only path stays as the reference: with meals and fuel off,
stops.py must find the same plan (tests/test_stops.py checks that).
"""

from dataclasses import dataclass, replace

from ..models import BreakSettings

BREAK_COST = 10.0  # every break costs this much: other things equal, fewer breaks
LATE_WEIGHT = 2.0  # a minute late (between 100 % and the hard maximum) costs this many early ones
OVER_LIMIT_COST = 60.0  # using a stop over the detour limit (step 1)
LONG_GAP_COST = 10.0  # per minute past the hard maximum (step 2)

LEVELS = ("rules kept", "over-limit detour used", "gap past the hard maximum")


@dataclass
class Node:
    mile: float
    minute: float  # driving minutes from the start of the trip
    cost: float = 0.0  # the stop's own cost; 0 for the segment's ends
    pinned: bool = False
    over_limit: bool = False  # detour over the limit: used only when nothing else fits
    usable: bool = True  # False: Valhalla found no way in; never used
    ref: object = None  # what the caller wants back for this node
    # Phase 4 (stops.py). Defaults keep a node a plain break place.
    meal_cost: float | None = None  # own cost as a lunch or dinner place; None: no meal here
    fuel: bool = False  # sells fuel
    detour: float = 0.0  # minutes there and back, added to a break's dwell
    meal_detour: float = 0.0  # the same for a meal (it can be at a neighbouring place, choices.merge_nearby)
    meal_fuel: bool = False  # the meal place sells fuel
    pin: str | None = None  # "break", "lunch" or "dinner" when pinned for that


@dataclass(frozen=True)
class Rules:
    every_minutes: float = 120
    every_miles: float = 150
    window_start: float = 0.75
    window_end: float = 1.0
    hard_max: float = 1.10
    over_limit_ok: bool = False  # step 1 of relaxing
    long_gaps_ok: bool = False  # step 2 of relaxing
    fuel_late_ok: bool = False  # stops.py only: fuel bought after its due mile

    @classmethod
    def from_settings(cls, s: BreakSettings) -> "Rules":
        return cls(s.every_minutes, s.every_miles, s.window_start, s.window_end, s.hard_max)

    def relaxed(self, level: int) -> "Rules":
        return replace(self, over_limit_ok=level >= 1, long_gaps_ok=level >= 2)


def share(a: Node, b: Node, rules: Rules) -> float:
    """How much of the break interval the drive from a to b uses: 1.0 is a full
    N minutes or M miles, whichever comes first."""
    return max((b.minute - a.minute) / rules.every_minutes, (b.mile - a.mile) / rules.every_miles)


def gap_cost(s: float, rules: Rules, *, to_end: bool) -> float | None:
    """Cost of a drive that uses share `s` of the interval; None if not allowed.

    Inside the window it costs nothing. Before the window, each minute early
    costs 1. After it, each minute late costs LATE_WEIGHT. Past the hard
    maximum the drive is not allowed, unless the rules are relaxed. The last
    drive of a segment is never "early": arriving soon after a break is fine.
    """
    if s > rules.hard_max and not rules.long_gaps_ok:
        return None
    n = rules.every_minutes
    cost = 0.0
    if s < rules.window_start and not to_end:
        cost += (rules.window_start - s) * n
    if s > rules.window_end:
        cost += (min(s, rules.hard_max) - rules.window_end) * n * LATE_WEIGHT
    if s > rules.hard_max:
        cost += (s - rules.hard_max) * n * LONG_GAP_COST
    return cost


def node_cost(node: Node, rules: Rules) -> float | None:
    """Cost of stopping at a node; None if it may not be used. A pinned node
    is the user's choice and is always used, whatever its detour."""
    if node.pinned:
        return BREAK_COST + node.cost
    if not node.usable:
        return None
    if node.over_limit:
        return BREAK_COST + node.cost + OVER_LIMIT_COST if rules.over_limit_ok else None
    return BREAK_COST + node.cost


def cheapest_path(nodes: list[Node], rules: Rules) -> list[int] | None:
    """Indexes of the cheapest path from nodes[0] to nodes[-1], or None.

    The nodes are in route order, so every edge goes forward and this is a
    single pass: the best way to reach node j is the best way to reach some
    earlier node i, plus the drive from i to j, plus stopping at j. Looking
    back from j, it stops at the first pinned node (no edge jumps over one)
    and at the first drive past the hard maximum (earlier ones are longer).
    """
    best: list[float | None] = [None] * len(nodes)
    came_from = [-1] * len(nodes)
    best[0] = 0.0
    last = len(nodes) - 1
    for j in range(1, len(nodes)):
        stop = 0.0 if j == last else node_cost(nodes[j], rules)
        if stop is None:
            continue
        for i in range(j - 1, -1, -1):
            s = share(nodes[i], nodes[j], rules)
            drive = gap_cost(s, rules, to_end=j == last)
            if drive is None:
                break
            if best[i] is not None and (best[j] is None or best[i] + drive + stop < best[j]):
                best[j] = best[i] + drive + stop
                came_from[j] = i
            if nodes[i].pinned:
                break
    if best[last] is None:
        return None
    path = [last]
    while path[-1] != 0:
        path.append(came_from[path[-1]])
    return path[::-1]


def plan_segment(nodes: list[Node], rules: Rules) -> tuple[list[int], int]:
    """The cheapest path under the strictest rules that allow one, and how far
    the rules had to be relaxed (an index into LEVELS)."""
    for level in range(len(LEVELS)):
        path = cheapest_path(nodes, rules.relaxed(level))
        if path is not None:
            return path, level
    raise AssertionError("with long gaps allowed, start -> end is always a path")
