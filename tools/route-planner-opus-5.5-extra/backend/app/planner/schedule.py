"""The plan for a trip: days, breaks, meals and fuel, with local clock times.

    plan(req, analysis, tl) -> dict

1. Places: every waypoint with its mile and driving minute (from analysis.py).
2. Choices: the candidates named, skipped, zoned, merged and costed (choices.py).
3. Days: where each driving day ends. The user's overnights stay; between
   them the planner picks places to stay near the daily limit (days.py).
   Those become overnight places like the user's.
4. Segments: the trip cut at every place it stops at: the start, timed
   stops, overnights and the end. Through points cut nothing.
5. Stops: in each segment, in route order, the cheapest way through its
   choices with breaks, lunch, dinner and fuel (stops.py). What one segment
   ends with carries into the next (after_hard_stop): the clock, today's
   meals and the miles since the last fill-up. A timed stop keeps the tank
   and, if it covers a meal window for long enough, counts as that meal. An
   overnight fills the tank, has dinner "near the hotel" when you get there
   by the end of the dinner window, and starts the next day at the day-start
   time with no meals done.
6. Clock: walk the rows in route order and add up the driving minutes and
   each stop's minutes, in UTC; show each row in its own place's time zone,
   with a row of its own where the route crosses into another zone (clock.py).
7. Per stop: the window it was chosen from and its ranked alternatives
   (picker.py; days.py for overnights). Per reset of the break clock: when the
   next break falls due. Per day: miles, driving, sunset and warnings.
8. Zones: the same plan without the stop zones, to say which stop each zone
   moved and what it did to the trip (zone_effects).
"""

import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ..models import PlanRequest
from ..geometry import ring_contains
from ..timeline import Timeline
from ..zones import RULES_OUT, TYPE_WORDS, stop_zones
from . import choices, clock, days as days_mod, picker, stops
from .graph import Node, Rules, share
from .picker import hm

STOP_TYPES = ("break", "lunch", "dinner", "fuel")


@dataclass
class Place:
    """A waypoint on the route, or an overnight the planner chose (auto)."""

    index: int
    id: str
    name: str
    type: str  # start, through, stop, overnight, end
    mile: float
    minute: float
    stay_minutes: int = 0  # a timed stop
    nights: int = 0  # an overnight
    auto: dict | None = None  # the candidate, for an overnight the planner chose
    events: dict = field(default_factory=dict)  # what happened here: meals during a stop, dinner at the hotel, missed meals
    lat: float | None = None  # where it is (waypoints; an automatic overnight has its candidate's)
    lon: float | None = None


def letter(i: int) -> str:
    return chr(65 + i) if i < 26 else str(i + 1)


def places(req: PlanRequest, analysis: dict) -> list[Place]:
    """The trip's waypoints in order, each with its mile and minute on the route."""
    at = {w["id"]: w for w in analysis["waypoints"]}
    n = len(req.waypoints)
    out = []
    for i, wp in enumerate(req.waypoints):
        kind = "start" if i == 0 else "end" if i == n - 1 else wp.type
        out.append(
            Place(
                index=i,
                id=wp.id,
                name=wp.name or f"waypoint {letter(i)}",
                type=kind,
                mile=at[wp.id]["mile"],
                minute=at[wp.id]["minute"],
                stay_minutes=wp.minutes if kind == "stop" else 0,
                nights=wp.nights if kind == "overnight" else 0,
                lat=wp.lat,
                lon=wp.lon,
            )
        )
    return out


def with_nights(pl: list[Place], nights: list[days_mod.Spot]) -> list[Place]:
    """The places plus the planner's overnights, in route order."""
    auto = [
        Place(index=-1, id=f"night:{s.ref['stop_key']}", name=choices.place_name(s.ref), type="overnight", mile=s.mile, minute=s.minute, nights=1, auto=s.ref)
        for s in nights
    ]
    order = {"start": 0, "through": 1, "stop": 1, "overnight": 1, "end": 2}
    return sorted(pl + auto, key=lambda p: (p.minute, order[p.type]))


def segments(pl: list[Place]) -> list[tuple[Place, Place]]:
    """Consecutive pairs of the places the trip stops at. Through points cut nothing."""
    hard = [p for p in pl if p.type != "through"]
    return list(zip(hard, hard[1:]))


def choice_node(c: dict, pin_kinds: dict[str, str]) -> Node:
    meal = c.get("meal")
    pin = "break" if c["pinned"] else (pin_kinds.get(meal["stop_key"]) if meal and meal["pinned"] else None)
    return Node(
        mile=c["mile"],
        minute=c["minute"],
        cost=c["cost"],
        pinned=pin is not None,
        over_limit=c["detour_status"] == "ok" and not c["detour_ok"],
        usable=c["detour_status"] == "ok",
        ref=c,
        meal_cost=meal["meal_cost"] if meal else None,
        fuel=c["fuel"] > 0,
        detour=c.get("detour_min") or 0.0,
        meal_detour=(meal.get("detour_min") or 0.0) if meal else 0.0,
        meal_fuel=bool(meal and meal["fuel"] > 0),
        pin=pin,
    )


# ---------- walking the segments ----------


@dataclass
class Leg:
    """One segment's graph, the way chosen through it, and how it was planned."""

    a: Place
    b: Place
    nodes: list[Node]
    labels: list[stops.Label]
    level: int
    setup: stops.Setup
    day_date: date


def meals_today(req: PlanRequest) -> tuple[stops.Meal, ...]:
    m = req.meals
    return tuple(stops.Meal(name, meal.minutes) for name, meal in (("lunch", m.lunch), ("dinner", m.dinner)) if meal.on)


def window_at(req: PlanRequest, name: str, day: date, zone) -> tuple[float, float]:
    meal = getattr(req.meals, name)
    return clock.window_utc(day, meal.start, zone), clock.window_utc(day, meal.end, zone)


def walk(pl: list[Place], prepared: choices.Prepared, req: PlanRequest, tl: Timeline, depart_utc: float, rules: Rules) -> list[Leg]:
    """Plan the segments in route order, each starting from where the last one ended."""
    pin_kinds = {p.key: p.kind for p in req.pins}
    state = stops.Start(clock=depart_utc)
    meals = meals_today(req)
    fuel_due = req.fuel.due_miles if req.fuel.on else None
    out = []
    for a, b in segments(pl):
        inside = [choice_node(c, pin_kinds) for c in prepared.choices if a.mile < c["mile"] < b.mile]
        nodes = [Node(a.mile, a.minute, ref=a)] + inside + [Node(b.mile, b.minute, ref=b)]
        day_date = clock.local(state.clock, clock.zone_at_mile(tl, a.mile)).date()
        zones = [clock.zone_at_mile(tl, n.mile) for n in nodes]
        windows = [{m.name: window_at(req, m.name, day_date, z) for m in meals} for z in zones]
        setup = stops.Setup(rules=rules, break_minutes=req.breaks.minutes, meals=meals, windows=windows, fuel_due=fuel_due,
                            fuel_minutes=req.fuel.minutes, merge_minutes=req.fuel.merge_minutes, meal_resets=req.meals.resets_break_clock)
        labels, level = stops.plan_segment(nodes, setup, state)
        out.append(Leg(a, b, nodes, labels, level, setup, day_date))
        state = after_hard_stop(b, labels[-1], req, tl, day_date)
    return out


def after_hard_stop(b: Place, end: stops.Label, req: PlanRequest, tl: Timeline, day: date) -> stops.Start:
    """What the next segment starts with, after arriving at `b` (see step 5)."""
    zone = clock.zone_at_mile(tl, b.mile)
    lunch, dinner = end.lunch, end.dinner
    if b.type == "stop":
        leave = end.clock + b.stay_minutes
        done = {"lunch": lunch, "dinner": dinner}
        for name in done:
            meal = getattr(req.meals, name)
            if done[name] or not meal.on:
                continue
            lo, hi = window_at(req, name, day, zone)
            if min(leave, hi) - max(end.clock, lo) >= meal.minutes:
                done[name] = True
                b.events.setdefault("during", []).append(name)
            elif leave > hi:
                done[name] = True
                b.events.setdefault("missed", []).append(name)
        return stops.Start(clock=leave, lunch=done["lunch"], dinner=done["dinner"], fuel_mile=end.fuel_mile)
    if b.type == "overnight":
        if req.meals.dinner.on and not dinner and end.clock <= window_at(req, "dinner", day, zone)[1]:
            b.events["hotel_dinner"] = True
        fuel = b.mile if req.fuel.fill_at_overnight else end.fuel_mile
        return stops.Start(clock=clock.next_morning(end.clock, zone, b.nights, req.day_start), fuel_mile=fuel)
    return stops.Start(clock=end.clock, lunch=lunch, dinner=dinner, fuel_mile=end.fuel_mile)


# ---------- rows ----------

ROW_KEYS = ("key", "stop_key", "id", "name", "kind", "stop_kind", "near", "ref", "road", "lat", "lon", "population", "toilets", "picnic",
            "food", "food_fast", "food_sitdown", "food_cafe", "fuel", "lodging", "detail", "detour_min", "detour_status", "also", "members",
            "pinned", "spread", "prefer", "zones", "lodging_brand")


def place_row(p: Place) -> dict:
    row = {"type": p.type, "id": p.id, "name": p.name, "letter": letter(p.index) if p.index >= 0 else "", "mile": round(p.mile, 1),
           "minute": round(p.minute, 1), "stay_minutes": p.stay_minutes, "nights": p.nights, "auto": bool(p.auto), "events": p.events,
           "lat": p.lat, "lon": p.lon}
    if p.auto:
        c = p.auto
        row.update({k: c.get(k) for k in ROW_KEYS})
        row.update(id=p.id, name=p.name, type="overnight", mile=round(p.mile, 1), minute=round(p.minute, 1), auto=True)
    return row


def stop_row(lab: stops.Label, node: Node, setup: stops.Setup, req: PlanRequest, fuel_before: float) -> dict:
    """A row for a break, a meal or a fuel stop, from the label that made it."""
    c = node.ref
    place = c["meal"] if lab.visit in ("lunch", "dinner") else c
    row = {k: place.get(k) for k in ROW_KEYS}
    detour = node.meal_detour if lab.visit in ("lunch", "dinner") else node.detour
    minutes = {"break": setup.break_minutes, "fuel": setup.fuel_minutes}.get(lab.visit) or next(m.minutes for m in setup.meals if m.name == lab.visit)
    row.update(type=lab.visit, mile=round(c["mile"], 1), minute=round(c["minute"], 1), stay_minutes=minutes,
               dwell=round(minutes + detour, 1), over_limit=not place.get("detour_ok", True), refuel=lab.refuel,
               pinned=node.pin == lab.visit or (lab.visit == "break" and node.pin == "break"))
    if lab.refuel and setup.fuel_due is not None:
        due = fuel_before + setup.fuel_due
        row["fuel_note"] = f"fuel was due by mile {due:.0f}" if lab.visit == "fuel" else f"merged: fuel was due by mile {due:.0f}"
    return row


def clock_rows(rows: list[dict], depart_utc: float, day_start: str, tl: Timeline) -> None:
    """Fill arrive, depart, tz and day on rows that are in route order.

    Between two rows the clock moves by the driving minutes between them. At
    a stop it then moves by the stop's dwell; at an overnight to the
    day-start time after its nights, in the overnight's own zone. Every time
    is shown in the zone of the row's place.
    """
    now, last_minute, day = depart_utc, 0.0, 1
    for row in rows:
        now += row["minute"] - last_minute
        last_minute = row["minute"]
        zone = clock.zone_at_mile(tl, row["mile"])
        row["tz"] = clock.short_name(now, zone)
        row["arrive"] = None if row["type"] == "start" else iso(clock.naive(now, zone))
        row["day"] = day
        row["_utc"] = now
        if row["type"] in STOP_TYPES:
            now += row["dwell"]
        elif row["type"] == "stop":
            row["dwell"] = row["stay_minutes"]
            now += row["dwell"]
        elif row["type"] == "overnight":
            now = clock.next_morning(now, zone, row["nights"], day_start)
            day += row["nights"]
        row["depart"] = None if row["type"] == "end" else iso(clock.naive(now, zone))
        row["depart_tz"] = clock.short_name(now, zone)
        row["depart_day"] = day


def clock_change_rows(rows: list[dict], tl: Timeline) -> list[dict]:
    """A row at every mile where the route enters another time zone."""
    out = []
    for a, b in zip(rows, rows[1:]):
        for mile, before, after in clock.crossings(tl, a["mile"], b["mile"]):
            out.append({"type": "clock", "id": f"clock:{mile}", "name": after.key.split("/")[-1].replace("_", " "), "mile": mile,
                        "minute": round(tl.minute_at_mile(mile), 1), "from_zone": before.key, "to_zone": after.key, "stay_minutes": 0})
    return out


def finish_clock_rows(rows: list[dict]) -> None:
    """Say what a clock change does: the time just before, and how far the clock jumps."""
    for i, row in enumerate(rows):
        if row["type"] != "clock":
            continue
        t = row["_utc"]
        before, after = clock.ZoneInfo(row["from_zone"]), clock.ZoneInfo(row["to_zone"])
        shift = clock.offset_minutes(t, after) - clock.offset_minutes(t, before)
        row.update(before=iso(clock.naive(t, before)), before_tz=clock.short_name(t, before), shift_minutes=round(shift))


def iso(t: datetime) -> str:
    return t.isoformat(timespec="minutes")


def start_utc(req: PlanRequest, tl: Timeline) -> float:
    """The departure as UTC minutes. Without a date, today at the day-start time. Local at the start."""
    zone = clock.zone_at_mile(tl, 0.0)
    if req.depart:
        return clock.utc_minutes(datetime.fromisoformat(req.depart), zone)
    return clock.window_utc(date.today(), req.day_start, zone)


# ---------- break windows and due times ----------


def reach(row: dict, s: float, rules: Rules, tl: Timeline) -> float:
    """Driving minute at which share `s` of the interval is used up, counting from `row`.
    Past the end of the route only the minutes count (there are no more miles to measure)."""
    by_minutes = row["minute"] + s * rules.every_minutes
    mile = row["mile"] + s * rules.every_miles
    if mile >= tl.miles[-1]:
        return by_minutes
    return min(by_minutes, tl.minute_at_mile(mile))


def at_minute(row: dict, minute: float) -> str:
    """Clock time when the driving clock, counting from `row`'s departure, reaches `minute`."""
    return iso(datetime.fromisoformat(row["depart"]) + timedelta(minutes=minute - row["minute"]))


def window(prev: dict, rules: Rules, tl: Timeline) -> dict:
    """Where the break after `prev` was meant to land: earliest and latest minute (the 75-100 % window),
    the hard maximum, and the same as miles and clock times."""
    out = {}
    for name, s in (("earliest", rules.window_start), ("latest", rules.window_end), ("hard", rules.hard_max)):
        minute = reach(prev, s, rules, tl)
        out[f"{name}_minute"] = round(minute, 1)
        out[f"{name}_mile"] = round(tl.mile_at_minute(minute), 1)
        out[f"{name}_clock"] = at_minute(prev, minute)
    return out


def meal_window(prev: dict, row: dict, req: PlanRequest, tl: Timeline) -> dict:
    """Where a meal can happen on this stretch: the meal's clock window laid onto
    the road at the planned pace, counting from `prev`'s departure, as miles too."""
    meal = getattr(req.meals, row["type"])
    day = datetime.fromisoformat(row["arrive"]).date()
    leave = datetime.fromisoformat(prev["depart"])
    out = {"meal": row["type"]}
    for name, hhmm in (("earliest", meal.start), ("latest", meal.end)):
        t = datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time())
        minute = prev["minute"] + (t - leave).total_seconds() / 60
        minute = min(max(minute, prev["minute"]), tl.minutes[-1])
        out[f"{name}_minute"] = round(minute, 1)
        out[f"{name}_mile"] = round(tl.mile_at_minute(minute), 1)
        out[f"{name}_clock"] = iso(t)
    out["hard_minute"], out["hard_mile"], out["hard_clock"] = out["latest_minute"], out["latest_mile"], out["latest_clock"]
    return out


def due(prev: dict, rules: Rules, tl: Timeline) -> dict:
    """When the next break falls due after `prev` (a full interval of driving)."""
    minute = reach(prev, 1.0, rules, tl)
    return {"after": prev["name"], "minute": round(minute, 1), "mile": round(tl.mile_at_minute(minute), 1),
            "clock": at_minute(prev, minute), "day": prev["depart_day"]}


# ---------- days ----------


def days(rows: list[dict], dues: list[dict]) -> list[dict]:
    """One entry per calendar day: where it starts and ends, miles and driving, and the
    note about the next break due at its end. Days with no driving are listed too."""
    out = []
    last_day = rows[-1]["day"]
    first_date = datetime.fromisoformat(rows[0]["depart"]).date()
    for d in range(1, last_day + 1):
        start = next((r for r in rows if r["depart_day"] == d and r["type"] in ("start", "overnight")), None)
        end = next((r for r in rows if r["day"] == d and r["type"] in ("overnight", "end") and r is not start), None)
        entry = {"day": d, "date": (first_date + timedelta(days=d - 1)).isoformat()}
        if start is None or end is None:
            stay = next((r for r in rows if r["type"] == "overnight" and r["day"] < d < r["depart_day"]), None)
            entry.update(driving=False, at=stay["name"] if stay else "")
        else:
            entry.update(
                driving=True, start=start["name"], end=end["name"], depart=start["depart"], arrive=end["arrive"],
                depart_tz=start.get("depart_tz"), arrive_tz=end.get("tz"),
                miles=round(end["mile"] - start["mile"], 1), driving_minutes=round(end["minute"] - start["minute"], 1),
                start_mile=start["mile"], end_mile=end["mile"], end_id=end["id"],
            )
            todays = [x for x in dues if x["day"] == d]
            if todays:  # the clock's last reset of the day: when the next break would fall due
                entry["next_due"] = max(todays, key=lambda x: x["minute"])
        out.append(entry)
    return out


def day_notes(day_list: list[dict], rows: list[dict], req: PlanRequest, tl: Timeline, over: days_mod.Overnights) -> list[dict]:
    """Sunset, chips and warnings for each driving day."""
    warnings = []
    limit, arrive_by = req.days.driving_minutes, req.days.arrive_by
    for d in day_list:
        if not d["driving"]:
            continue
        end = next(r for r in rows if r["id"] == d["end_id"] and r["day"] == d["day"])
        lat, lon = tl.at_mile(end["mile"])
        zone = clock.zone_at(lat, lon)
        arrive = datetime.fromisoformat(d["arrive"])
        sun = clock.sunset(lat, lon, arrive.date(), zone)
        chips = []
        d["sunset"] = iso(sun) if sun else None
        if sun:
            spare = (sun - arrive).total_seconds() / 60
            d["daylight_spare_minutes"] = round(spare)
            end["sunset"] = d["sunset"]
            if spare < 0:
                chips.append({"code": "after_dark", "text": f"arrive after dark (sunset {sun:%H:%M})", "tone": "warn"})
                end["after_dark"] = True
                soft = " (stop driving at sunset is on)" if req.days.stop_at_sunset else ""
                warnings.append({"code": "after_dark", "day": d["day"], "mile": end["mile"],
                                 "message": f"Day {d['day']} arrives at {arrive:%H:%M}, {hm(-spare)} after sunset ({sun:%H:%M}){soft}."})
        if d["driving_minutes"] > limit + 0.5:
            why = over.why_long(d["day"], d["start_mile"], d["end_mile"], limit, d["start"])
            chips.append({"code": "over_limit", "text": f"over the {hm(limit)} limit", "tone": "bad"})
            warnings.append({"code": "day_over_limit", "day": d["day"], "mile": d["start_mile"],
                             "message": f"Day {d['day']} has {hm(d['driving_minutes'])} of driving, over the {hm(limit)} limit: {why}."})
        if arrive.strftime("%H:%M") > arrive_by:
            stopped = (arrive - datetime.fromisoformat(d["depart"])).total_seconds() / 60 - d["driving_minutes"]
            chips.append({"code": "late", "text": f"arrives after {arrive_by}", "tone": "warn"})
            warnings.append({"code": "day_late", "day": d["day"], "mile": d["end_mile"],
                             "message": f"Day {d['day']} arrives at {arrive:%H:%M}, after {arrive_by}: {hm(d['driving_minutes'])} of driving and {hm(stopped)} of stops from {d['start']} at {d['depart'][11:16]}."})
        if end.get("auto") and end.get("prefer"):
            short = d["driving_minutes"] < 0.75 * limit  # under 6 h of an 8 h limit
            chips.append({"code": "prefer", "text": "short day: prefer zone" if short else "⭐ prefer zone", "tone": "ok"})
        d["chips"] = chips
    return warnings


# ---------- warnings ----------


def leg_warnings(leg: Leg, rows_by_label: dict[int, dict], rules: Rules, req: PlanRequest) -> list[dict]:
    """Long gaps, over-limit detours, missed meals and late fuel in one segment."""
    out = []
    labs = leg.labels
    resets = [lab for lab in labs if lab.visit != "fuel"]
    for a, b in zip(resets, resets[1:]):
        na, nb = leg.nodes[a.node], leg.nodes[b.node]
        if share(na, nb, rules) > rules.hard_max:
            minutes, miles = nb.minute - na.minute, nb.mile - na.mile
            if minutes / rules.every_minutes >= miles / rules.every_miles:
                limit, gap = hm(rules.every_minutes * rules.hard_max), hm(minutes)
            else:
                limit, gap = f"{rules.every_miles * rules.hard_max:.0f} mi", f"{miles:.0f} mi"
            out.append({"code": "long_gap", "mile": round(na.mile, 1),
                        "message": f"No stop between {picker.label(na)} and {picker.label(nb)} within {limit}; longest gap {gap}."})
    for lab in labs[1:-1]:
        n = leg.nodes[lab.node]
        if n.over_limit and not n.pinned:
            c = n.ref
            out.append({"code": "over_detour", "mile": c["mile"],
                        "message": f"The {lab.visit} at {c['name']} is a {c['detour_min']:g} min detour, over the limit: nothing nearer fits there."})
    for prev, lab in zip(labs, labs[1:]):
        for meal in lab.missed:
            m = getattr(req.meals, meal)
            out.append({"code": f"no_{meal}", "mile": round(leg.nodes[prev.node].mile, 1),
                        "message": f"No {meal} stop between {picker.label(leg.nodes[prev.node])} and {picker.label(leg.nodes[lab.node])}: "
                                   f"nowhere to eat fits {m.start}–{m.end} on this stretch."})
        if lab.fuel_late > 0:
            out.append({"code": "fuel_late", "mile": round(leg.nodes[lab.node].mile, 1),
                        "message": f"Fuel {lab.fuel_late:.0f} mi later than due (every {req.fuel.due_miles:.0f} mi): nothing that sells fuel fits "
                                   f"before {picker.label(leg.nodes[lab.node])}."})
    return out


# ---------- zones ----------


def zone_effects(req: PlanRequest, rows: list[dict], plain: list[dict], day_list: list[dict], tl: Timeline) -> dict[str, list[str]]:
    """What each zone did to this trip, in a few words per zone, and a `moved`
    note on every stop a zone moved. `plain` is the same plan without the stop zones.

    A stop counts as moved when the plain plan has the same kind of stop on
    the same day, in the same order, at another place, and that place is in
    a zone that rules this kind of stop out. A stop that lands in a prefer
    zone where the plain plan had another place counts as drawn there.
    """
    effects: dict[str, list[str]] = {z.id: [] for z in req.zones}
    kinds = ("break", "lunch", "dinner", "fuel", "overnight")

    def by_slot(rs):
        out, count = {}, {}
        for r in rs:
            kind = "overnight" if r["type"] == "overnight" and r.get("auto") else r["type"]
            if kind not in kinds:
                continue
            k = (kind, r["day"], count.setdefault((kind, r["day"]), 0))
            count[(kind, r["day"])] += 1
            out[k] = r
        return out

    mine, theirs = by_slot(rows), by_slot(plain)
    zones = {z.id: z for z in stop_zones(req.zones)}
    for slot, r in mine.items():
        other = theirs.get(slot)
        if not other or other.get("stop_key") == r.get("stop_key"):
            continue
        kind, day, _ = slot
        purpose = "break" if kind == "fuel" else kind
        # The plain plan knows nothing of zones, so look its place up in them here.
        moved_by = [z for z in zones.values() if purpose in RULES_OUT[z.type] and ring_contains(z.ring, other["lat"], other["lon"])]
        word = "night" if kind == "overnight" else kind
        if moved_by:
            z = moved_by[0]
            r["moved"] = f"moved from {other['name']}: {TYPE_WORDS[z.type]}"
            effects[z.id].append(f"{word} on day {day} moved from {other['name']} to {r['name']}")
        elif r.get("prefer"):
            zid = next((z for z in r.get("zones") or [] if z in zones and zones[z].type == "prefer"), None)
            if zid:
                r["moved"] = f"⭐ prefer zone: instead of {other['name']}"
                effects[zid].append(f"chosen for the {word} on day {day} (instead of {other['name']})")
    for r in rows:  # a prefer zone that holds a stop the plain plan had too
        for zid in r.get("zones") or []:
            z = zones.get(zid)
            if z and z.type == "prefer" and r["type"] in kinds and not r.get("moved"):
                word = "night" if r["type"] == "overnight" else r["type"]
                effects[zid].append(f"{word} on day {r['day']} at {r['name']}")
    for z in stop_zones(req.zones):
        if not effects[z.id]:
            through = sorted({d["day"] for d in day_list if d["driving"] and passes(z, tl, d["start_mile"], d["end_mile"])})
            if through:
                what = "no stops planned" if z.type == "no_stops" else "nothing changed"
                effects[z.id].append(f"driven through on day{'s' if len(through) > 1 else ''} {' and '.join(map(str, through))}, {what}")
            else:
                effects[z.id].append("not on this route")
    return effects


def passes(zone, tl: Timeline, mile_a: float, mile_b: float) -> bool:
    """Does the route between two miles go through the zone? Checked every mile."""
    m = mile_a
    while m <= mile_b:
        if ring_contains(zone.ring, *tl.at_mile(m)):
            return True
        m += 1.0
    return False


# ---------- all of it ----------


def plan(req: PlanRequest, analysis: dict, tl: Timeline, explain: bool = True) -> dict:
    """Days, breaks, meals and fuel with local clock times, windows, alternatives and due times, plus warnings."""
    started = time.perf_counter()
    rules = Rules.from_settings(req.breaks)
    limit = 2 * req.breaks.max_detour_each_way
    depart_utc = start_utc(req, tl)
    pl = places(req, analysis)

    def prepare(stop_places):
        return choices.prepare(analysis["candidates"], [p.mile for p in stop_places if p.type != "through"], req.breaks, req.pins, req.skips,
                               req.zones, req.meals.food, req.days.min_lodging, req.lodging)

    first = prepare(pl)
    over = days_mod.Overnights(pl, first, req, tl, depart_utc)
    pl = with_nights(pl, over.nights())
    prepared = prepare(pl)
    legs = walk(pl, prepared, req, tl, depart_utc, rules)

    rows = [place_row(p) for p in pl]
    stop_rows: dict[tuple[int, int], dict] = {}
    for li, leg in enumerate(legs):
        for k in range(1, len(leg.labels) - 1):
            lab = leg.labels[k]
            fuel_before = leg.labels[k - 1].fuel_mile
            row = stop_row(lab, leg.nodes[lab.node], leg.setup, req, fuel_before)
            stop_rows[(li, k)] = row
            rows.append(row)
    order = {"start": 0, "through": 1, "clock": 1, "break": 1, "lunch": 1, "dinner": 1, "fuel": 1, "stop": 2, "overnight": 2, "end": 3}
    rows.sort(key=lambda r: (r["minute"], order[r["type"]]))
    rows += clock_change_rows(rows, tl)
    rows.sort(key=lambda r: (r["minute"], order[r["type"]]))
    clock_rows(rows, depart_utc, req.day_start, tl)
    finish_clock_rows(rows)

    dues, warnings = [], []
    place_rows = {r["id"]: r for r in rows if r["type"] not in STOP_TYPES}
    for li, leg in enumerate(legs):
        warnings += leg_warnings(leg, stop_rows, rules, req)
        resets = [k for k, lab in enumerate(leg.labels) if lab.visit != "fuel" and (lab.visit not in ("lunch", "dinner") or req.meals.resets_break_clock)]
        row_at = lambda k: place_rows[leg.a.id] if k == 0 else place_rows[leg.b.id] if k == len(leg.labels) - 1 else stop_rows[(li, k)]  # noqa: E731
        path = [lab.node for lab in leg.labels]
        for n, k in enumerate(resets[1:], start=1):
            prev_row = row_at(resets[n - 1])
            dues.append(due(prev_row, rules, tl))
        for k in range(1, len(leg.labels) - 1):
            lab, row = leg.labels[k], stop_rows[(li, k)]
            prev_k = max(x for x in resets if x < k)
            prev_row = row_at(prev_k)
            row["gap_minutes"] = round(row["minute"] - prev_row["minute"], 1)
            row["gap_miles"] = round(row["mile"] - prev_row["mile"], 1)
            row["level"] = stops.LEVELS[leg.level]
            arrive = datetime.fromisoformat(row["arrive"])
            if lab.visit == "fuel":
                row["window"] = window(prev_row, rules, tl)
                row["alternatives"], row["reason"] = [], f"fuel only: {row.get('fuel_note', '')}; no break or meal with fuel fits nearby"
                continue
            purpose = lab.visit
            if purpose == "break":
                row["window"] = window(prev_row, rules, tl)
                win = None
            else:
                row["window"] = meal_window(prev_row, row, req, tl)
                win = (datetime.fromisoformat(row["window"]["earliest_clock"]), datetime.fromisoformat(row["window"]["latest_clock"]))
            row["alternatives"], row["reason"] = picker.alternatives(
                leg.nodes, path, k, rules, prepared.skipped, arrive, limit, purpose, win, prepared.zoned
            )
    for r in rows:
        if r["type"] == "overnight" and r.get("auto"):
            r["alternatives"] = over.alternatives(r["stop_key"], r["day"])
            others = [a for a in r["alternatives"] if a["status"] == "ok"]
            r["reason"] = "pinned by you" if r["stop_key"] in over.pin_keys else (
                f"{r['lodging']} lodging · day {r['day']}: {hm(r['minute'] - prev_night_minute(rows, r))}" + (" · best of " + str(len(others) + 1) if others else " · the only place to stay that fits"))
            if others:
                best = others[0]
                r["best_other"] = f"{best['name']}: {hm(best['drive_minutes'])}"
            r["pinned"] = r["stop_key"] in over.pin_keys
        if r["type"] == "overnight":
            r["fill_up"] = req.fuel.on and req.fuel.fill_at_overnight
            r["hotel_dinner"] = bool(r["events"].get("hotel_dinner"))
    for r in rows:
        for meal in r.get("events", {}).get("missed", []):
            m = getattr(req.meals, meal)
            warnings.append({"code": f"no_{meal}", "mile": r["mile"], "message": f"No {meal}: the stop at {r['name']} covers part of {m.start}–{m.end} but not {hm(m.minutes)} of it."})
        r.pop("_utc", None)

    day_list = days(rows, dues)
    warnings += day_notes(day_list, rows, req, tl, over)
    warnings += [
        {"code": f"dropped_{d['what']}", "message": f"{'Pinned' if d['what'] == 'pin' else 'Skipped'} stop {d['name'] or d['key']} {d['reason']}; dropped."}
        for d in prepared.dropped
    ]
    effects = {z: [e["text"]] for z, e in analysis.get("avoid_effects", {}).items()}
    if explain and stop_zones(req.zones):
        plain = plan(req.model_copy(update={"zones": [z for z in req.zones if z.type == "avoid"]}), analysis, tl, explain=False)
        effects.update(zone_effects(req, rows, plain["rows"], day_list, tl))
        for z in req.zones:  # avoid zones again: zone_effects starts every zone empty
            if z.id in analysis.get("avoid_effects", {}):
                effects[z.id] = [analysis["avoid_effects"][z.id]["text"]]

    counts = {t: sum(r["type"] == t for r in rows) for t in ("break", "lunch", "dinner", "fuel")}
    return {
        "rows": rows,
        "days": day_list,
        "due": dues,
        "warnings": warnings,
        "dropped": prepared.dropped,
        "zone_effects": effects,
        "settings": req.breaks.model_dump(),
        "meals": req.meals.model_dump(),
        "fuel": req.fuel.model_dump(),
        "day_settings": {**req.days.model_dump(), "start": req.day_start},
        "summary": {
            "breaks": counts["break"],
            "meals": counts["lunch"] + counts["dinner"],
            "fuel_stops": counts["fuel"] + sum(1 for r in rows if r.get("refuel") and r["type"] != "fuel"),
            "nights": sum(r["nights"] for r in rows if r["type"] == "overnight"),
            "auto_nights": sum(1 for r in rows if r["type"] == "overnight" and r.get("auto")),
            "stopped_minutes": round(sum(r.get("dwell", 0) for r in rows if r["type"] in (*STOP_TYPES, "stop")), 1),
            "driving_minutes": round(rows[-1]["minute"], 1),
            "arrive": rows[-1]["arrive"],
            "arrive_tz": rows[-1].get("tz"),
            "choices": len(prepared.choices),
        },
        "plan_ms": round((time.perf_counter() - started) * 1000, 1),
    }


def prev_night_minute(rows: list[dict], night: dict) -> float:
    """Driving minute where the day that ends at `night` started."""
    starts = [r["minute"] for r in rows if r["type"] in ("start", "overnight") and r["minute"] < night["minute"]]
    return max(starts) if starts else 0.0
