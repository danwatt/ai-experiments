"""From the candidate list to the choices the break planner picks from.

    prepared = prepare(candidates, stop_miles, settings, pins, skips)

1. Name each candidate by place and pass: "1234#2" is the second time the
   route passes place 1234. Pins and skips use these names, so they survive a
   small change of route that moves every mile a little.
2. Leave out the places the user skipped on this trip.
3. Leave out places within 2 miles of a waypoint the trip stops at. The
   start, the end, timed stops and overnights are stops already.
4. Merge places within 2 miles of each other along the route into one choice
   and keep the best of them. Glenwood Springs (the town) and I-70 Exit 116
   are the same stop.
5. Give each choice its own cost: what kind of place it is, its detour, and
   whether it has much there.

Phase 4 adds, per candidate (with its own lat/lon):

6. Zones (zones.py). A place in a no-stops zone is taken out (kept in
   `zoned`, so the picker can say why). A place in a no-meals or
   no-overnight zone stays, with that purpose blocked. A place in a prefer
   zone costs PREFER_BONUS less, which wins close calls.
7. Meals: the place's meal cost, or None when it has no food that matches
   the trip's food filter, or is in a no-meals zone.
8. Places to stay: candidates with enough lodging, for the overnight
   choice (days.py), and the ones a zone ruled out, for its warnings.
"""

from dataclasses import dataclass, field

from .. import zones as zone_rules
from ..models import BreakSettings, LodgingSettings, StopRef, Zone

MERGE_MILES = 2.0  # places this close along the route are one choice
NEAR_WAYPOINT_MILES = 2.0  # places this close to a stop waypoint are left out

# The preference order agreed in PLAN.md, as a cost: a rest area wins a close
# call against a town with services, which wins against a bare exit. The
# numbers are in the same unit as the window cost in graph.py (minutes of the
# break interval), so a rest area 8 minutes early still beats an exit with
# fuel and food right on time, but not one 20 minutes early.
KIND_ORDER = ("rest_area", "service_plaza", "services", "any")  # the agreed order; the user may change it (settings)
KIND_COSTS = (0.0, 4.0, 8.0, 16.0)  # by place in the order
KIND_COST = dict(zip(KIND_ORDER, KIND_COSTS))
KIND_LABEL = {"rest_area": "rest area", "service_plaza": "service plaza", "services": "fuel and food", "any": "few services"}
THIN_COST = 4.0  # fewer than THIN places to eat or buy fuel
THIN = 3
DETOUR_COST_PER_MIN = 1.0  # each minute of detour (there and back) costs this
PREFER_BONUS = 8.0  # a stop in a prefer zone: less than a break's fixed cost, so it adds no stops
MEAL_THIN = 3  # fewer places to eat than this (that match the filter) costs MEAL_THIN_COST
MEAL_THIN_COST = 6.0
PURPOSES = ("break", "lunch", "dinner", "fuel", "overnight")
FOOD_WORDS = {"all": "nothing to eat mapped", "sitdown": "no sit-down restaurant", "fast": "no fast food"}


@dataclass
class Prepared:
    choices: list[dict]  # what the planner may pick, in route order; each has stop_key, members, also
    skipped: list[dict]  # the candidates the user skipped (shown in the picker, never planned)
    dropped: list[dict] = field(default_factory=list)  # pins and skips no longer on the route: {key, name, what, reason}
    zoned: list[dict] = field(default_factory=list)  # taken out by a no-stops zone (shown in the picker with the reason)
    lodging: list[dict] = field(default_factory=list)  # places to stay the overnight choice may use, in route order
    lodging_blocked: list[dict] = field(default_factory=list)  # places to stay a zone rules out (for the warnings)


def prepare(
    candidates: list[dict],
    stop_miles: list[float],
    settings: BreakSettings,
    pins: list[StopRef],
    skips: list[StopRef],
    zones: list[Zone] = (),
    food: str = "all",
    min_lodging: int = 2,
    lodging: LodgingSettings | None = None,
) -> Prepared:
    """The steps above. `candidates` is not changed; the choices are copies."""
    cands = [dict(c) for c in candidates]
    add_stop_keys(cands)
    stop_zones = zone_rules.stop_zones(list(zones))
    for c in cands:
        c["stop_kind"] = stop_kind(c)
        c["detour_ok"] = detour_ok(c, settings)
        inside = zone_rules.zones_at(c["lat"], c["lon"], stop_zones) if stop_zones else []
        c["zones"] = [z.id for z in inside]
        c["blocked"] = {p: zone_rules.zone_words(z) for p in PURPOSES if (z := zone_rules.ruled_out_by(p, inside))}
        c["prefer"] = next((zone_rules.zone_words(z) for z in inside if z.type == "prefer"), None)
        c["cost"] = stop_cost(c, settings.stop_order) - (PREFER_BONUS if c["prefer"] else 0.0)
        brand_lodging(c, lodging)
        c["food_match"] = food_count(c, food)
        c["meal_cost"] = meal_cost(c, food)
        c["meal_why_not"] = c["blocked"].get("lunch") or (FOOD_WORDS[food] if not c["food_match"] else None)

    by_key = {c["stop_key"]: c for c in cands}
    skip_keys = {s.key for s in skips}
    pin_keys = {p.key for p in pins}
    dropped = [gone(ref, "skip") for ref in skips if ref.key not in by_key]
    dropped += [gone(ref, "pin") for ref in pins if ref.key not in by_key]

    kept, skipped, zoned = [], [], []
    for c in cands:
        if c["stop_key"] in skip_keys:
            skipped.append(c)
        elif near_a_stop(c, stop_miles):
            if c["stop_key"] in pin_keys:
                pin = next(p for p in pins if p.key == c["stop_key"])
                if pin.kind != "overnight":  # an overnight pin is a stop waypoint of its own (days.py)
                    dropped.append(gone(pin, "pin", "is within 2 miles of a waypoint the trip stops at"))
        elif "break" in c["blocked"] and c["stop_key"] not in pin_keys:
            zoned.append(c)
        else:
            kept.append(c)
    meal_pins = {p.key for p in pins if p.kind in ("lunch", "dinner")}
    break_pins = {p.key for p in pins if p.kind == "break"}
    night_pins = {p.key for p in pins if p.kind == "overnight"}
    stay = [c for c in kept if (c["lodging"] >= min_lodging or c["stop_key"] in night_pins) and c["detour_status"] == "ok"]
    return Prepared(
        choices=merge_nearby(kept, break_pins, meal_pins),
        skipped=skipped,
        dropped=dropped,
        zoned=zoned,
        lodging=[c for c in stay if "overnight" not in c["blocked"] or c["stop_key"] in night_pins],
        lodging_blocked=[c for c in stay if "overnight" in c["blocked"] and c["stop_key"] not in night_pins],
    )


def gone(ref: StopRef, what: str, reason: str = "is no longer on the route") -> dict:
    return {"key": ref.key, "name": ref.name, "what": what, "reason": reason}


def add_stop_keys(cands: list[dict]) -> None:
    """stop_key = cluster id # pass number, counting passes in route order."""
    passes: dict[int, int] = {}
    for c in sorted(cands, key=lambda c: c["mile"]):
        passes[c["id"]] = passes.get(c["id"], 0) + 1
        c["stop_key"] = f"{c['id']}#{passes[c['id']]}"


def stop_kind(c: dict) -> str:
    """Where the place sits in the preference order: rest_area, service_plaza,
    services (an exit, town or roadside group with both fuel and food), any."""
    if c["kind"] in ("rest_area", "service_plaza"):
        return c["kind"]
    if c["fuel"] > 0 and c["food"] > 0:
        return "services"
    return "any"


def detour_ok(c: dict, settings: BreakSettings) -> bool:
    """Within the detour limit. The limit is per way; the detour figure is there and back."""
    if c.get("detour_status") != "ok" or c.get("detour_min") is None:
        return False
    return c["detour_min"] <= 2 * settings.max_detour_each_way


def stop_cost(c: dict, order=KIND_ORDER) -> float:
    """A place's own cost as a break: its kind (by its place in the user's
    order), its detour, and a little more when there is hardly anything there.
    Lower is better."""
    cost = KIND_COSTS[list(order).index(c["stop_kind"])]
    cost += DETOUR_COST_PER_MIN * (c.get("detour_min") or 0.0)
    if c["stop_kind"] not in ("rest_area", "service_plaza") and c["food"] + c["fuel"] < THIN:
        cost += THIN_COST
    return round(cost, 2)


def brand_lodging(c: dict, lodging: LodgingSettings | None) -> None:
    """Count the lodgings with one of the chosen brands (the cluster keeps its 8
    commonest). A chosen brand matches any brand name that contains it, in any
    case: "Hampton" matches "Hampton Inn & Suites". Sets `lodging_brand` (that count), `brand_pref` (a bonus when
    the rule is "prefer") and, for "only these", replaces `lodging` with the
    matching count, so a town with no such brand has no place to stay."""
    c["lodging_brand"], c["brand_pref"] = 0, False
    if lodging is None or not lodging.brands:
        return
    wanted = {b.casefold() for b in lodging.brands}
    mine = sum(n for b, n in (c.get("detail") or {}).get("brands", {}).get("lodging", {}).items() if any(w in b.casefold() for w in wanted))
    c["lodging_brand"] = mine
    if lodging.rule == "only":
        c["lodging_all"], c["lodging"] = c["lodging"], mine
    else:
        c["brand_pref"] = mine > 0


def place_name(c: dict) -> str:
    """A name for a place to stay: "Glenwood Springs (exit 116)" rather than the
    exit's own "I 70 exit 116", since a night is booked by town."""
    if c["kind"] == "exit" and c.get("near"):
        return f"{c['near']} (exit {c['ref']})" if c.get("ref") else c["near"]
    return c["name"]


def food_count(c: dict, food: str) -> int:
    """Places to eat that match the trip's food filter."""
    return {"all": c["food"], "sitdown": c["food_sitdown"], "fast": c["food_fast"]}[food]


def meal_cost(c: dict, food: str) -> float | None:
    """A place's own cost as a lunch or dinner stop, or None if no meal can
    happen there: no food that matches the filter, or a no-meals (or no-stops)
    zone. A place with only one or two places to eat costs a little more,
    each minute of detour costs 1, and a prefer zone gives its bonus."""
    if "lunch" in c["blocked"] or food_count(c, food) == 0:
        return None
    cost = DETOUR_COST_PER_MIN * (c.get("detour_min") or 0.0)
    if food_count(c, food) < MEAL_THIN:
        cost += MEAL_THIN_COST
    if c["prefer"]:
        cost -= PREFER_BONUS
    return round(cost, 2)


def near_a_stop(c: dict, stop_miles: list[float]) -> bool:
    return any(abs(c["mile"] - m) <= NEAR_WAYPOINT_MILES for m in stop_miles)


def merge_nearby(cands: list[dict], pin_keys: set[str], meal_pins: set[str] = frozenset()) -> list[dict]:
    """One choice per run of places within MERGE_MILES of the run's first place.

    The choice is the best member: a pinned one if there is one, else one
    within the detour limit before one over it, then the lowest cost. It keeps
    the keys of all its members and the names of the others ("also").

    A meal may happen at a different member than a break: a rest area wins
    a break, but lunch goes to the town next to it. `meal` is the member a meal
    would use (pinned for a meal, else the cheapest meal place), or None.
    """
    groups: list[list[dict]] = []
    for c in sorted(cands, key=lambda c: c["mile"]):
        if groups and c["mile"] - groups[-1][0]["mile"] <= MERGE_MILES:
            groups[-1].append(c)
        else:
            groups.append([c])

    out = []
    for group in groups:
        best = min(group, key=lambda c: (c["stop_key"] not in pin_keys, not c["detour_ok"], c["cost"], c["mile"]))
        choice = dict(best)
        choice["members"] = [c["stop_key"] for c in group]
        choice["also"] = sorted({c["name"] for c in group if c is not best and c["name"] != best["name"]})
        choice["pinned"] = best["stop_key"] in pin_keys
        eaters = [c for c in group if c["meal_cost"] is not None or c["stop_key"] in meal_pins]
        meal = min(eaters, key=lambda c: (c["stop_key"] not in meal_pins, not c["detour_ok"], c["meal_cost"] if c["meal_cost"] is not None else 99, c["mile"]), default=None)
        choice["meal"] = None if meal is None else {**meal, "pinned": meal["stop_key"] in meal_pins}
        choice["meal_why_not"] = None if meal else best["meal_why_not"]
        out.append(choice)
    return out
