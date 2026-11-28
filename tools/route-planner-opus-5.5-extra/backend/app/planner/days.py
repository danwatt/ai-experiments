"""Where each driving day ends: the automatic overnights.

    nights = choose(places, prepared, req, tl, depart_utc)

This runs before the break pass (schedule.py). Its answers become overnight
places like the ones the user sets, so the breaks, meals and fuel are then
planned per day as usual.

## Stretches

The trip is cut at the start, the user's overnights and the end. Those stay
fixed. Inside each stretch the days are chosen from the places to stay:
candidates with at least 2 lodgings (choices.prepare), outside no-stops and
no-overnight zones, not skipped, and not within 2 mi of a waypoint the trip
stops at. Places within 2 mi of each other are one place to stay (the one
with the most lodging).

## Choosing

A cheapest path again, over: stretch start -> places to stay -> stretch end.
Each edge is one driving day, and costs:

    DAY_COST                         every day: fewest days first
    BALANCE x (hours of driving)^2   squares favour even days: 6 h + 6 h costs
                                     less than 8 h + 4 h
    OVER_COST per minute             of driving past the daily limit (8 h)
    OVER_COST per minute             of arriving after the arrive-by time (19:00)
    OVER_COST per minute             of arriving after sunset, when "stop
                                     driving at sunset" is on
    the place's own cost             fewer than 4 lodgings +5, its detour,
                                     a prefer zone -PREFER_BONUS

The arrival time is an estimate: the start of the day, plus the driving,
plus the timed stops on the way, plus about one break per interval and the
lunch or dinner the day drives through (stopped_minutes), plus half the
detour to the place to stay. It leaves out the detours of the breaks on the
way, which are not known until the stops are chosen. The real times come from
the stop planner afterwards, and the warnings use those.

All limits are soft, so there is always a path (the whole stretch in one day).
A pinned overnight ("stay here instead") must be on the path; a pinned place
with too little lodging is used anyway.

Sunset is taken on each day's own date (phase 5): a day edge knows which day
of the trip it is (Stretch.base_day plus the days before it in the path).
A lodging brand under the "prefer" rule takes BRAND_BONUS off a place's cost.
"""

import math
from dataclasses import dataclass, field
from datetime import timedelta
from functools import lru_cache

from ..models import PlanRequest
from ..timeline import Timeline
from . import clock
from .choices import MERGE_MILES, Prepared, place_name
from .picker import hm

DAY_COST = 100.0
BALANCE = 1.0
OVER_COST = 3.0
THIN_LODGING = 4
THIN_LODGING_COST = 5.0
PREFER_BONUS = 15.0
BRAND_BONUS = 8.0  # a place to stay with one of the chosen lodging brands, under the "prefer" rule


@dataclass
class Spot:
    """A node of the overnight graph: a stretch end or a place to stay."""

    mile: float
    minute: float
    offset: float  # minutes ahead of UTC (negative in America)
    sunset: object | None  # a function: day number (0 = the departure day) -> minute of the day, local, or None
    ref: object = None  # a candidate dict, or the schedule.Place of a stretch end
    cost: float = 0.0
    pinned: bool = False
    blocked: str | None = None  # a zone that rules it out (only in the alternatives)


@dataclass
class Day:
    """One estimated day between two spots."""

    drive: float  # minutes of driving
    day: int  # which day of the trip it is, counting from 0
    arrive: float  # estimated local minute of the day
    cost: float


@dataclass
class Stretch:
    """The days between two fixed places."""

    spots: list[Spot]  # start, places to stay, end
    start_minute: float  # local minute of the day when the stretch's first day starts
    path: list[int] = field(default_factory=list)
    others: list[Spot] = field(default_factory=list)  # places to stay a zone rules out
    base_day: int = 0  # the trip day (from 0) this stretch's first day falls on, so each day's own sunset is used


def minute_of_day(hhmm: str) -> float:
    hh, mm = (int(x) for x in hhmm.split(":"))
    return hh * 60 + mm


def stopped_minutes(drive: float, start: float, req: PlanRequest) -> float:
    """Roughly how long a day of `drive` minutes that starts at local minute
    `start` spends stopped: a break each full interval, lunch if the day drives
    through the lunch window, dinner if it drives past the dinner window. A
    meal takes the place of a break."""
    b, m = req.breaks, req.meals
    breaks = max(0, math.ceil(drive / b.every_minutes - 1e-9) - 1)
    total = breaks * (b.minutes + 2)
    for meal in (m.lunch, m.dinner):
        if meal.on and start < minute_of_day(meal.end) < start + drive + total:
            total += meal.minutes - (b.minutes + 2 if breaks > 0 else 0)
            breaks = max(0, breaks - 1)
    return total


def day_between(a: Spot, b: Spot, start: float, timed: float, req: PlanRequest, day: int = 0) -> Day:
    """The estimated day from a to b, leaving a at local minute `start`, with
    `timed` minutes of timed stops on the way. `day` is the trip day (from 0),
    which decides the date of the sunset. Its cost is in the module docstring.

    The arrival counts the way off the route to where the night is spent: half
    of the place's there-and-back detour. It does not count the detours of the
    breaks on the way (they are not known until the stops are chosen)."""
    d = req.days
    drive = b.minute - a.minute
    arrive = start + drive + timed + stopped_minutes(drive, start, req) + (b.offset - a.offset) + hotel_detour(b)
    cost = DAY_COST + BALANCE * (drive / 60) ** 2 + b.cost
    cost += OVER_COST * max(0.0, drive - d.driving_minutes)
    cost += OVER_COST * max(0.0, arrive - minute_of_day(d.arrive_by))
    sunset = b.sunset(day) if d.stop_at_sunset and b.sunset is not None else None
    if sunset is not None:
        cost += OVER_COST * max(0.0, arrive - sunset)
    return Day(drive=drive, day=day, arrive=arrive, cost=cost)


def hotel_detour(b: Spot) -> float:
    """Minutes to get from the route to a place to stay: half its detour, which is there and back."""
    return (b.ref.get("detour_min") or 0.0) / 2 if isinstance(b.ref, dict) else 0.0


def spot_cost(c: dict) -> float:
    cost = (c.get("detour_min") or 0.0) + (THIN_LODGING_COST if c["lodging"] < THIN_LODGING else 0.0)
    return cost - (PREFER_BONUS if c["prefer"] else 0.0) - (BRAND_BONUS if c.get("brand_pref") else 0.0)


def places_to_stay(lodging: list[dict], pin_keys: set[str]) -> list[dict]:
    """One place to stay per run of places within MERGE_MILES: a pinned one, else the one with most lodging."""
    groups: list[list[dict]] = []
    for c in sorted(lodging, key=lambda c: c["mile"]):
        if groups and c["mile"] - groups[-1][0]["mile"] <= MERGE_MILES:
            groups[-1].append(c)
        else:
            groups.append([c])
    return [min(g, key=lambda c: (c["stop_key"] not in pin_keys, -c["lodging"], c.get("detour_min") or 0)) for g in groups]


class Overnights:
    """The chosen days of a whole trip, and what is needed to explain them."""

    def __init__(self, pl, prepared: Prepared, req: PlanRequest, tl: Timeline, depart_utc: float):
        self.req = req
        self.pin_keys = {p.key for p in req.pins if p.kind == "overnight"}
        first_day = clock.local(depart_utc, clock.zone_at_mile(tl, 0.0)).date()
        base = 0  # trip day (from 0) on which the next stretch's first day falls
        self._spot_cache: dict[float, tuple[float, float | None]] = {}

        def spot(mile, minute, ref, cost=0.0, pinned=False, blocked=None) -> Spot:
            lat, lon = tl.at_mile(mile)
            zone = clock.zone_at(lat, lon)
            offset = clock.offset_minutes(depart_utc, zone)

            @lru_cache(maxsize=None)
            def sunset(day: int) -> float | None:
                sun = clock.sunset(lat, lon, first_day + timedelta(days=day), zone)  # that day's own date
                return None if sun is None else sun.hour * 60 + sun.minute

            return Spot(mile, minute, offset, sunset, ref, cost, pinned, blocked)

        stay = places_to_stay(prepared.lodging, self.pin_keys)
        self.places = pl
        self.stretches: list[Stretch] = []
        fixed = [p for p in pl if p.type in ("start", "overnight", "end")]
        for a, b in zip(fixed, fixed[1:]):
            inside = [spot(c["mile"], c["minute"], c, spot_cost(c), c["stop_key"] in self.pin_keys) for c in stay if a.mile < c["mile"] < b.mile]
            others = [spot(c["mile"], c["minute"], c, blocked=c["blocked"]["overnight"]) for c in prepared.lodging_blocked if a.mile < c["mile"] < b.mile]
            start = clock.local(depart_utc, clock.zone_at_mile(tl, a.mile)) if a.type == "start" else None
            start_minute = start.hour * 60 + start.minute if start else minute_of_day(req.day_start)
            st = Stretch([spot(a.mile, a.minute, a), *inside, spot(b.mile, b.minute, b)], start_minute, others=others, base_day=base)
            st.path = self.cheapest(st) if req.days.auto_overnights else [0, len(st.spots) - 1]
            self.stretches.append(st)
            base += len(st.path) - 2 + (b.nights if b.type == "overnight" else 1)  # the days here, then the nights at b

    # ---------- the path ----------

    def timed(self, a: Spot, b: Spot) -> float:
        """Minutes of timed stops strictly between two spots."""
        return sum(p.stay_minutes for p in self.places if p.type == "stop" and a.mile < p.mile < b.mile)

    def day(self, st: Stretch, i: int, j: int, done: int = 0) -> Day:
        """Spot i to spot j as a day, when `done` days of this stretch came before it."""
        start = st.start_minute if i == 0 else minute_of_day(self.req.day_start)
        return day_between(st.spots[i], st.spots[j], start, self.timed(st.spots[i], st.spots[j]), self.req, st.base_day + done)

    def cheapest(self, st: Stretch) -> list[int]:
        """Indexes of the cheapest set of days through the stretch. No day jumps over a pinned spot."""
        n = len(st.spots)
        best = [math.inf] * n
        came = [-1] * n
        done = [0] * n  # days of the best way to each spot
        best[0] = 0.0
        for j in range(1, n):
            for i in range(j - 1, -1, -1):
                c = best[i] + self.day(st, i, j, done[i]).cost
                if c < best[j]:
                    best[j], came[j], done[j] = c, i, done[i] + 1
                if st.spots[i].pinned:
                    break
        path = [n - 1]
        while path[-1] != 0:
            path.append(came[path[-1]])
        return path[::-1]

    def nights(self) -> list[Spot]:
        """The chosen places to stay, in route order."""
        return [st.spots[i] for st in self.stretches for i in st.path[1:-1]]

    # ---------- explaining ----------

    def find(self, key: str) -> tuple[Stretch, int] | None:
        for st in self.stretches:
            for k in st.path[1:-1]:
                if st.spots[k].ref["stop_key"] == key:
                    return st, k
        return None

    def alternatives(self, key: str, day_number: int) -> list[dict]:
        """Every place that could take this night, judged with the nights
        before and after it fixed: the two days it would make, their score
        (the two day costs), and what rules a place out."""
        st, k = self.find(key)
        pos = st.path.index(k)
        p, n = st.path[pos - 1], st.path[pos + 1]
        out = []
        for i in range(p + 1, n):
            s = st.spots[i]
            one = self.day(st, p, i, pos - 1)
            two = day_between(s, st.spots[n], minute_of_day(self.req.day_start), self.timed(s, st.spots[n]), self.req, st.base_day + pos)
            status = "chosen" if i == k else "ok"
            reason = f"day {day_number}: {hm(one.drive)}, arrive ≈ {clock_text(one.arrive)} · day {day_number + 1}: {hm(two.drive)}"
            out.append(night_entry(s.ref, status, reason, one, round(one.cost + two.cost, 1)))
        for s in st.others:
            if st.spots[p].mile < s.mile < st.spots[n].mile:
                start = st.start_minute if p == 0 else minute_of_day(self.req.day_start)
                one = day_between(st.spots[p], s, start, self.timed(st.spots[p], s), self.req, st.base_day + pos - 1)
                out.append(night_entry(s.ref, "ruled_out", f"in the {s.blocked}", one, None))
        chosen = [e for e in out if e["status"] == "chosen"]
        ok = sorted((e for e in out if e["status"] == "ok"), key=lambda e: e["score"])
        ruled = sorted((e for e in out if e["status"] == "ruled_out"), key=lambda e: abs(e["mile"] - st.spots[k].mile))
        return chosen + ok[:8] + ruled[:4]

    def why_long(self, day_number: int, start_mile: float, end_mile: float, limit_minutes: float, start_name: str) -> str:
        """Why a day over the driving limit was not cut shorter: the place that
        would have kept it inside, and what that would have cost instead."""
        st = next((s for s in self.stretches if s.spots[0].mile <= start_mile + 0.01 and end_mile <= s.spots[-1].mile + 0.01), None)
        if st is None or not self.req.days.auto_overnights:
            return "automatic overnights are off"
        a = next(i for i, s in enumerate(st.spots) if abs(s.mile - start_mile) < 0.01)
        b = next(i for i, s in enumerate(st.spots) if abs(s.mile - end_mile) < 0.01)
        within = [i for i in range(a + 1, b) if st.spots[i].minute - st.spots[a].minute <= limit_minutes]
        blocked = [s for s in st.others if start_mile < s.mile < end_mile and s.minute - st.spots[a].minute <= limit_minutes]
        if not within:
            if blocked:
                s = max(blocked, key=lambda s: s.mile)
                return f"{place_name(s.ref)} would make it {hm(s.minute - st.spots[a].minute)}, but it is in the {s.blocked}"
            return f"no place to stay (2 or more lodgings) within {hm(limit_minutes)} of {start_name}"
        i = max(within, key=lambda i: st.spots[i].mile)
        s = st.spots[i]
        alt = self.cheapest_with(st, i)
        drives = [st.spots[y].minute - st.spots[x].minute for x, y in zip(alt, alt[1:])]
        text = f"{place_name(s.ref)} would make it {hm(s.minute - st.spots[a].minute)}"
        if len(alt) > len(st.path):
            return f"{text}, but the trip would need another day"
        worst = max(drives)
        return f"{text}, but another day would then be {hm(worst)}"

    def cheapest_with(self, st: Stretch, i: int) -> list[int]:
        """The cheapest days through the stretch with spot i forced in."""
        was = st.spots[i].pinned
        st.spots[i].pinned = True
        try:
            return self.cheapest(st)
        finally:
            st.spots[i].pinned = was


def clock_text(minute: float) -> str:
    m = round(minute) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def night_entry(c: dict, status: str, reason: str, day: Day, score: float | None) -> dict:
    """One line of the overnight picker."""
    return {
        "key": c["stop_key"], "cand_key": c["key"], "name": place_name(c), "kind": c["kind"], "stop_kind": c.get("stop_kind"),
        "ref": c["ref"], "road": c["road"], "lat": c["lat"], "lon": c["lon"], "mile": c["mile"], "minute": c["minute"],
        "detour_min": c.get("detour_min"), "food": c["food"], "fuel": c["fuel"], "lodging": c["lodging"], "also": [],
        "pinned": False, "drive_minutes": round(day.drive, 1), "arrive_estimate": clock_text(day.arrive),
        "status": status, "reason": reason, "score": score, "prefer": c.get("prefer"),
    }
