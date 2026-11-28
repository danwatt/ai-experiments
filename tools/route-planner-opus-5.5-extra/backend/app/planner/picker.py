"""What the stop picker shows for one planned break: why it won, and the
other places that could have taken its slot.

The alternatives of a break are the choices between the stop before it and
the stop after it. Each is judged as if it took the break's place with its
neighbours left where they are:

    score = drive from the previous stop + drive to the next stop + its own cost

(graph.gap_cost and choices.stop_cost, the same numbers the planner adds up).
A place is ruled out, with the reason, when it is skipped, over the detour
limit, unreachable, or would make either drive longer than the hard maximum.

Phase 4: lunch and dinner have their own alternatives (`purpose`). For a meal
a place is also ruled out when you would get there outside the meal window,
when it has no food that matches the filter, or when it is in a no-meals zone,
and its score uses the meal cost (stops.MEAL_COST + choices.meal_cost). Places
taken out by a no-stops zone are listed as ruled out, with the zone's name.
"""

from datetime import datetime, timedelta

from . import choices
from .graph import Node, Rules, gap_cost, node_cost, share

MAX_OK = 8  # alternatives listed that could take the slot
MAX_RULED_OUT = 6  # ruled-out ones listed, nearest first


def hm(minutes: float) -> str:
    """90 -> "1 h 30", 45 -> "45 min"."""
    m = round(minutes)
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


def label(node: Node) -> str:
    """A node's name: a place's name, or a waypoint's."""
    ref = node.ref
    return ref["name"] if isinstance(ref, dict) else ref.name


def timing(s: float, minutes: float, prev: str, rules: Rules) -> str:
    """'1 h 38 after Denver, in the window', or early / late."""
    when = f"{hm(minutes)} after {prev}"
    if s < rules.window_start:
        return f"early: {when}"
    if s > rules.window_end:
        return f"late: {when}"
    return f"{when}, in the window"


def detour_text(c: dict) -> str:
    d = c.get("detour_min")
    if d is None:
        return "no way in from this side of the road"
    return "on the way" if d < 1 else f"+{d:g} min off the route and back"


MEAL_COST = 10.0  # stops.MEAL_COST (not imported: stops.py imports this module's neighbours)


def clock_of(t: datetime) -> str:
    return t.strftime("%H:%M")


def judge(node: Node, prev: Node, nxt: Node, rules: Rules, next_is_end: bool, limit: float,
          purpose: str = "break", window: tuple[datetime, datetime] | None = None, at: datetime | None = None) -> dict:
    """status ('ok' or 'ruled_out'), reason and score of one place in this slot.
    For a meal, `window` is its (earliest, latest) arrival and `at` when you would get there."""
    c = node.ref
    s1, s2 = share(prev, node, rules), share(node, nxt, rules)
    if purpose != "break":
        if node.meal_cost is None and node.pin != purpose:
            return {"status": "ruled_out", "reason": c.get("meal_why_not") or "no food here", "score": None}
        if window and at and not window[0] <= at <= window[1] and node.pin != purpose:
            side = "before" if at < window[0] else "after"
            return {"status": "ruled_out", "reason": f"{side} the {purpose} window ({clock_of(at)})", "score": None}
    if not node.usable and not node.pinned:
        return {"status": "ruled_out", "reason": "no way in from this side of the road", "score": None}
    if node.over_limit and not node.pinned:
        return {"status": "ruled_out", "reason": f"detour +{c['detour_min']:g} min, over the {limit:g} min limit ({limit / 2:g} each way)", "score": None}
    if s1 > rules.hard_max:
        return {"status": "ruled_out", "reason": f"too late: {hm(node.minute - prev.minute)} after {label(prev)}", "score": None}
    if s2 > rules.hard_max:
        return {"status": "ruled_out", "reason": f"leaves {hm(nxt.minute - node.minute)} to {label(nxt)}", "score": None}
    own = node_cost(node, rules) if purpose == "break" else MEAL_COST + (node.meal_cost or 0.0)
    score = gap_cost(s1, rules, to_end=False) + gap_cost(s2, rules, to_end=next_is_end) + own
    if purpose == "break":
        what = choices.KIND_LABEL[c["stop_kind"]]
    else:
        meal = c.get("meal") or c
        what = f"{meal['food_match']} to eat" if meal.get("food_match") else "food"
        c = meal
    reason = f"{what} · {timing(s1, node.minute - prev.minute, label(prev), rules)} · {detour_text(c)}"
    if c.get("prefer"):
        reason += f" · ⭐ {c['prefer']}"
    return {"status": "ok", "reason": reason, "score": round(score, 1)}


def entry(c: dict, verdict: dict, chosen: dict, arrive: datetime) -> dict:
    """One line of the picker: the place, when you would get there, and the verdict."""
    at = arrive + timedelta(minutes=c["minute"] - chosen["minute"])
    return {
        "key": c["stop_key"],
        "cand_key": c["key"],
        "name": c["name"],
        "kind": c["kind"],
        "stop_kind": c["stop_kind"],
        "ref": c["ref"],
        "road": c["road"],
        "lat": c["lat"],
        "lon": c["lon"],
        "mile": c["mile"],
        "minute": c["minute"],
        "arrive": at.isoformat(timespec="minutes"),
        "detour_min": c.get("detour_min"),
        "food": c["food"],
        "fuel": c["fuel"],
        "lodging": c["lodging"],
        "also": c.get("also", []),
        "pinned": c.get("pinned", False),
        **verdict,
    }


def alternatives(
    nodes: list[Node], path: list[int], k: int, rules: Rules, skipped: list[dict], arrive: datetime, limit: float,
    purpose: str = "break", window: tuple[datetime, datetime] | None = None, zoned: list[dict] = (),
) -> tuple[list[dict], str]:
    """The ranked alternatives for the stop at path[k], and why it won.

    `nodes` and `path` are one segment's graph and plan; `arrive` is the
    stop's arrival time, from which the others' times are worked out.
    `purpose` is "break", "lunch" or "dinner"; a meal shows the place it
    would eat at (choices.merge_nearby's `meal`). `zoned` are places a
    no-stops zone took out.
    """
    prev, here, nxt = nodes[path[k - 1]], nodes[path[k]], nodes[path[k + 1]]
    next_is_end = path[k + 1] == len(nodes) - 1
    meal = purpose != "break"
    show = (lambda c: c.get("meal") or c) if meal else (lambda c: c)
    chosen = show(here.ref)
    ok, ruled = [], []
    for i in range(path[k - 1] + 1, path[k + 1]):
        if i == path[k]:
            continue
        at = arrive + timedelta(minutes=nodes[i].minute - here.minute)
        verdict = judge(nodes[i], prev, nxt, rules, next_is_end, limit, purpose, window, at)
        (ok if verdict["status"] == "ok" else ruled).append(entry(show(nodes[i].ref), verdict, chosen, arrive))
    for c in skipped:
        if prev.mile < c["mile"] < nxt.mile:
            ruled.append(entry(c, {"status": "skipped", "reason": "skipped on this trip", "score": None}, chosen, arrive))
    for c in zoned:
        if prev.mile < c["mile"] < nxt.mile:
            ruled.append(entry(c, {"status": "ruled_out", "reason": f"in the {c['blocked']['break']}", "score": None}, chosen, arrive))

    mine = judge(here, prev, nxt, rules, next_is_end, limit, purpose, window, arrive)
    if mine["status"] == "ruled_out":  # only when the rules had to be relaxed
        mine = {**mine, "reason": f"{mine['reason']}; nothing within the rules here"}
    why = why_it_won(here, mine, prev, rules, len(ok), purpose)
    top = entry(chosen, {**mine, "status": "chosen", "reason": why}, chosen, arrive)
    ok.sort(key=lambda e: e["score"])
    # Skipped places first, then the ones a zone ruled out (the itinerary may say a
    # stop moved from one of them), then the nearest.
    ruled.sort(key=lambda e: (e["status"] != "skipped", "zone" not in e["reason"], abs(e["minute"] - chosen["minute"])))
    return [top] + ok[:MAX_OK] + ruled[:MAX_RULED_OUT], why


def why_it_won(here: Node, verdict: dict, prev: Node, rules: Rules, others: int, purpose: str = "break") -> str:
    """One line for the itinerary row: pinned, or the kind, timing and detour, and how many it beat."""
    if here.pin == purpose or (purpose == "break" and here.pinned and here.pin in (None, "break")):
        s = share(prev, here, rules)
        return f"pinned by you · {timing(s, here.minute - prev.minute, label(prev), rules)}"
    if verdict["status"] != "ok":
        return verdict["reason"]
    return verdict["reason"] + (f" · best of {others + 1}" if others else " · the only place that fits")
