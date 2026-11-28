"""Choosing every stop of one driving segment: breaks, lunch, dinner and fuel.

This is graph.py's cheapest path through the segment's places, in route
order, with more to remember on the way. A segment runs from one hard stop
to the next (the start, a timed stop, an overnight, the end).

## What a way of getting somewhere remembers (a label)

    cost          the cost so far (below)
    clock         when you leave the place, in UTC minutes (clock.py)
    lunch, dinner whether that meal is done today: eaten, or its window passed
    fuel_mile     the trip mile of the last fill-up
    reset         the driving minute and mile where the break clock last
                  started: the last break, meal or hard stop
    last_stop     the driving minute of the last stop of any kind, so a fuel
                  stop is never planned within 20 minutes of another stop

## What can happen at a place

    break         15 min (plus the detour). The break clock starts again.
    lunch, dinner the meal's minutes. Only when you arrive inside its window
                  (local time there), at a place with food that matches the
                  filter and outside no-meals zones. The break clock starts again.
    fuel only     10 min. Does not restart the break clock. Never within
                  20 min of another stop: then the fuel is bought at that
                  stop instead ("merged").

A break or meal at a place that sells fuel may also fill the tank. That is
how fuel is merged into a stop.

## What it costs (same units as graph.py: minutes of the break interval)

    each drive into a break or meal   graph.gap_cost: 0 inside the 75-100 % window,
                                      more the earlier or later it lands
    each break                        BREAK_COST + the place's own cost (choices.py)
    each meal                         MEAL_COST + the place's meal cost
    filling up at a break or meal     REFUEL_COST: small, so the tank is filled
                                      only where it helps
    a fuel-only stop                  FUEL_STOP_COST + its detour: large, so
                                      fuel goes with a break or meal when it can
    a meal window that passes         MISSED_MEAL_COST: so a meal is planned
      without the meal                whenever any place fits; the plan warns
    each mile past the fuel due mile  FUEL_LATE_COST (only when relaxed, below)

## Rules, relaxed only when nothing fits (as in graph.py)

    0. every drive keeps the break clock within the hard maximum, fuel is
       bought by the due mile (300 of 400 mi), detours are within the limit;
    1. stops over the detour limit may be used;
    2. fuel may be bought after the due mile;
    3. drives past the hard maximum may be used. This always finds a path.

## Keeping it small

Many ways reach each place. For each place and each (lunch done, dinner
done), a way is dropped when another one is no costlier, filled up no
earlier, restarted the break clock no earlier, and leaves no later but at
most CLOSE_MINUTES earlier. Ways whose clocks differ more are both kept,
because an earlier or a later clock can each be the one that fits a meal
window further on. At most KEEP per (place, meals) are kept, the cheapest.
That makes this a very good plan, not a proven cheapest one, but with meals
and fuel off it finds exactly graph.py's path.
"""

from dataclasses import dataclass, field, replace

from .graph import BREAK_COST, OVER_LIMIT_COST, Node, Rules, gap_cost, share

MEAL_COST = 10.0  # like a break: other things equal, no extra stops
REFUEL_COST = 2.0
FUEL_STOP_COST = 25.0
MISSED_MEAL_COST = 120.0
FUEL_LATE_COST = 5.0  # per mile past the due mile
CLOSE_MINUTES = 20.0
KEEP = 8

LEVELS = ("rules kept", "over-limit detour used", "fuel later than due", "gap past the hard maximum")


@dataclass(frozen=True)
class Meal:
    name: str  # "lunch" or "dinner"
    minutes: float


@dataclass
class Setup:
    """What a segment is planned with, besides its places."""

    rules: Rules
    break_minutes: float = 15.0
    meals: tuple[Meal, ...] = ()  # the meals planned on the road today
    # windows[j][name] = (earliest, latest) arrival for that meal at node j, in UTC minutes
    windows: list[dict[str, tuple[float, float]]] = field(default_factory=list)
    fuel_due: float | None = None  # miles after a fill-up when fuel is due; None: fuel is not planned
    fuel_minutes: float = 10.0
    merge_minutes: float = 20.0
    meal_resets: bool = True  # a meal restarts the break clock (the default); off: only a break does


@dataclass
class Start:
    """Where a segment starts from: the clock, today's meals and the tank."""

    clock: float  # UTC minutes when leaving the segment's first place
    lunch: bool = False
    dinner: bool = False
    fuel_mile: float = 0.0


@dataclass
class Label:
    cost: float
    clock: float  # leaving this place
    arrive: float  # arriving at this place
    lunch: bool
    dinner: bool
    fuel_mile: float
    reset_minute: float
    reset_mile: float
    last_stop: float
    node: int
    visit: str  # start, break, lunch, dinner, fuel, end
    refuel: bool = False  # filled the tank here
    missed: tuple[str, ...] = ()  # meals whose window passed on the drive into here
    fuel_late: float = 0.0  # miles past the due mile on the drive into here
    level: int = 0
    prev: "Label | None" = None

    def meals_key(self) -> tuple[bool, bool]:
        return self.lunch, self.dinner


def relaxed(rules: Rules, level: int) -> Rules:
    """The rules at relaxing step `level` (see LEVELS)."""
    return replace(rules, over_limit_ok=level >= 1, fuel_late_ok=level >= 2, long_gaps_ok=level >= 3)


def place_extra(node: Node, rules: Rules) -> float | None:
    """What stopping at this place costs on top of the stop itself, or None if
    it may not be used: no way in, or a detour over the limit (until relaxed).
    A pinned place is the user's choice and is always usable."""
    if node.pin:
        return 0.0
    if not node.usable:
        return None
    if node.over_limit:
        return OVER_LIMIT_COST if rules.over_limit_ok else None
    return 0.0


def share_since(lab: Label, node: Node, rules: Rules) -> float:
    """How much of the break interval is used between the label's last break-clock start and `node`."""
    return max((node.minute - lab.reset_minute) / rules.every_minutes, (node.mile - lab.reset_mile) / rules.every_miles)


def arrivals(lab: Label, nodes: list[Node], j: int, setup: Setup, rules: Rules, is_end: bool):
    """Every way to go on from `lab` to node j: the labels that come out."""
    here = nodes[j]
    arrive = lab.clock + (here.minute - nodes[lab.node].minute)
    cost = lab.cost
    done = {"lunch": lab.lunch, "dinner": lab.dinner}
    missed = []
    for meal in setup.meals:
        lo, hi = setup.windows[j][meal.name]
        if not done[meal.name] and arrive > hi:
            done[meal.name] = True
            missed.append(meal.name)
            cost += MISSED_MEAL_COST

    late = 0.0
    if setup.fuel_due is not None:
        late = max(0.0, here.mile - lab.fuel_mile - setup.fuel_due)
        if late > 0 and not rules.fuel_late_ok:
            return
        cost += late * FUEL_LATE_COST

    s = share_since(lab, here, rules)
    base = dict(arrive=arrive, fuel_mile=lab.fuel_mile, node=j, missed=tuple(missed), fuel_late=late, prev=lab, level=lab.level)
    if is_end:
        gap = gap_cost(s, rules, to_end=True)
        if gap is not None:
            yield Label(cost=cost + gap, clock=arrive, lunch=done["lunch"], dinner=done["dinner"], reset_minute=lab.reset_minute,
                        reset_mile=lab.reset_mile, last_stop=lab.last_stop, visit="end", **base)
        return

    extra = place_extra(here, rules)
    if extra is None:
        return
    gap = gap_cost(s, rules, to_end=False)
    after_fuel_stop = lab.visit == "fuel" and here.minute - lab.last_stop < setup.merge_minutes
    stops = []  # (visit, cost, dwell, lunch, dinner, fuel here)
    if gap is not None and not after_fuel_stop:
        if here.pin in (None, "break"):
            stops.append(("break", BREAK_COST + here.cost, setup.break_minutes + here.detour, done["lunch"], done["dinner"], here.fuel))
        for meal in setup.meals:
            lo, hi = setup.windows[j][meal.name]
            pinned = here.pin == meal.name
            fits = here.meal_cost is not None and lo <= arrive <= hi and here.pin is None
            if not done[meal.name] and (fits or pinned):
                eaten = {**done, meal.name: True}
                stops.append((meal.name, MEAL_COST + (here.meal_cost or 0.0), meal.minutes + here.meal_detour,
                              eaten["lunch"], eaten["dinner"], here.meal_fuel))
    for visit, stop_cost, dwell, lunch, dinner, sells_fuel in stops:
        restarts = visit == "break" or setup.meal_resets
        common = dict(clock=arrive + dwell, lunch=lunch, dinner=dinner,
                      reset_minute=here.minute if restarts else lab.reset_minute, reset_mile=here.mile if restarts else lab.reset_mile,
                      last_stop=here.minute, visit=visit)
        total = cost + gap + stop_cost + extra
        yield Label(cost=total, **common, **base)
        if sells_fuel and setup.fuel_due is not None:
            yield Label(cost=total + REFUEL_COST, refuel=True, **common, **{**base, "fuel_mile": here.mile})

    fuel_stop_ok = (
        setup.fuel_due is not None and here.fuel and here.pin is None
        and here.minute - lab.last_stop >= setup.merge_minutes
        and (s <= rules.hard_max or rules.long_gaps_ok)
    )
    if fuel_stop_ok:
        yield Label(cost=cost + FUEL_STOP_COST + here.detour + extra, clock=arrive + setup.fuel_minutes + here.detour,
                    lunch=done["lunch"], dinner=done["dinner"], reset_minute=lab.reset_minute, reset_mile=lab.reset_mile,
                    last_stop=here.minute, visit="fuel", refuel=True, **{**base, "fuel_mile": here.mile})


def beats(a: Label, b: Label) -> bool:
    """a makes b pointless: no costlier, tank no emptier, break clock no older,
    and leaving no later but not much earlier (see "Keeping it small")."""
    return (
        a.cost <= b.cost and a.fuel_mile >= b.fuel_mile and a.reset_minute >= b.reset_minute
        and b.clock - CLOSE_MINUTES <= a.clock <= b.clock
    )


def keep(bucket: list[Label], new: Label) -> None:
    """Add `new` to a place's labels unless one there beats it; drop the ones it beats."""
    same = [x for x in bucket if x.meals_key() == new.meals_key()]
    if any(beats(x, new) for x in same):
        return
    for x in same:
        if beats(new, x):
            bucket.remove(x)
    bucket.append(new)
    same = [x for x in bucket if x.meals_key() == new.meals_key()]
    if len(same) > KEEP:
        bucket.remove(max(same, key=lambda x: x.cost))


def cheapest(nodes: list[Node], setup: Setup, start: Start, rules: Rules) -> list[Label] | None:
    """The labels of the cheapest way from nodes[0] to nodes[-1], or None.

    One forward pass, as in graph.cheapest_path: every way into place j comes
    from an earlier place i. Looking back from j it stops at the first pinned
    place (no drive skips one), at the first drive longer than the hard
    maximum and at the first drive longer than the fuel due distance (earlier
    places are further), unless the rules are relaxed for that.
    """
    first = nodes[0]
    labels: list[list[Label]] = [[] for _ in nodes]
    labels[0] = [Label(cost=0.0, clock=start.clock, arrive=start.clock, lunch=start.lunch, dinner=start.dinner, fuel_mile=start.fuel_mile,
                       reset_minute=first.minute, reset_mile=first.mile, last_stop=first.minute, node=0, visit="start")]
    last = len(nodes) - 1
    for j in range(1, len(nodes)):
        for i in range(j - 1, -1, -1):
            if share(nodes[i], nodes[j], rules) > rules.hard_max and not rules.long_gaps_ok:
                break
            if setup.fuel_due is not None and nodes[j].mile - nodes[i].mile > setup.fuel_due and not rules.fuel_late_ok:
                break
            for lab in labels[i]:
                for new in arrivals(lab, nodes, j, setup, rules, j == last):
                    keep(labels[j], new)
            if nodes[i].pin:
                break
    if not labels[last]:
        return None
    path = [min(labels[last], key=lambda x: x.cost)]
    while path[-1].prev is not None:
        path.append(path[-1].prev)
    return path[::-1]


def plan_segment(nodes: list[Node], setup: Setup, start: Start) -> tuple[list[Label], int]:
    """The cheapest way under the strictest rules that allow one, and how far
    the rules had to be relaxed (an index into LEVELS)."""
    for level in range(len(LEVELS)):
        path = cheapest(nodes, setup, start, relaxed(setup.rules, level))
        if path is not None:
            for lab in path:
                lab.level = level
            return path, level
    raise AssertionError("with everything relaxed, start -> end is always a path")
