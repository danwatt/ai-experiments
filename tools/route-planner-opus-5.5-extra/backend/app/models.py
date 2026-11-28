"""What the browser sends: a trip's waypoints, zones and road options.

These are pydantic models, so FastAPI checks every request against them and
answers 422 with the field that is wrong.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# What happens at a waypoint. The first and last waypoint are always the start
# and the end of the trip, whatever their type says.
WaypointType = Literal["through", "stop", "overnight"]

# Only "avoid" changes the route. The others change where stops go (phase 4):
# no_stops: no break, meal, fuel or overnight; no_meals: no lunch or dinner;
# no_overnight: no automatic overnight; prefer: stops here win close calls.
ZoneType = Literal["avoid", "no_stops", "no_meals", "no_overnight", "prefer"]


class Waypoint(BaseModel):
    id: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str = ""
    type: WaypointType = "stop"
    minutes: int = Field(default=30, ge=0)  # for a stop; only stored for now
    nights: int = Field(default=1, ge=1)  # for an overnight; only stored for now


class Zone(BaseModel):
    id: str
    name: str = ""
    type: ZoneType = "avoid"
    # One closed ring of [lon, lat] pairs, as in GeoJSON.
    ring: list[tuple[float, float]] = Field(min_length=3)
    shape: Literal["rectangle", "polygon"] = "polygon"  # how the map edits it
    enabled: bool = True


class RoadOptions(BaseModel):
    avoid_tolls: bool = False
    avoid_ferries: bool = False
    avoid_unpaved: bool = False
    alternates: int = Field(default=2, ge=0, le=2)


class RouteRequest(BaseModel):
    waypoints: list[Waypoint] = Field(min_length=2)
    zones: list[Zone] = []
    options: RoadOptions = RoadOptions()
    # Local departure time, "2027-09-25T08:00". Valhalla uses it for timed
    # road closures (Independence Pass); it does not change speeds.
    depart: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
    pace: float = Field(default=1.05, ge=0.5, le=2.0)
    # How far from the route a place may be to count as a candidate stop (phase 5).
    search_miles: float = Field(default=2.0, ge=0.5, le=10)


# ---------- phase 3: planning breaks ----------


class BreakSettings(BaseModel):
    """When to stop for a break. The defaults are the ones agreed in PLAN.md.

    A break is due every `every_minutes` of driving or `every_miles`, whichever
    comes first. The planner aims for the window between `window_start` and
    `window_end` of that interval (75-100 %), and never goes past `hard_max`
    (110 %) if any stop allows it.
    """

    every_minutes: float = Field(default=120, ge=20, le=600)
    every_miles: float = Field(default=150, ge=10, le=600)
    minutes: float = Field(default=15, ge=0, le=180)  # how long a break lasts
    window_start: float = Field(default=0.75, ge=0.1, le=1.0)
    window_end: float = Field(default=1.0, ge=0.1, le=1.5)
    hard_max: float = Field(default=1.10, ge=1.0, le=2.0)
    max_detour_each_way: float = Field(default=5, ge=0, le=60)  # minutes off the route, each way
    # The preference order of places for a break, best first (phase 5). The first
    # wins a close call over the second by 4, the second over the third by 4,
    # the third over the fourth by 8 (choices.KIND_COST).
    stop_order: list[Literal["rest_area", "service_plaza", "services", "any"]] = ["rest_area", "service_plaza", "services", "any"]

    @field_validator("stop_order")
    @classmethod
    def _each_kind_once(cls, order):
        if sorted(order) != sorted(["rest_area", "service_plaza", "services", "any"]):
            raise ValueError("stop_order must list rest_area, service_plaza, services and any once each")
        return order


# What a pinned stop is for. A pin made before phase 4 has no kind: a break.
StopKind = Literal["break", "lunch", "dinner", "overnight"]


class StopRef(BaseModel):
    """A pinned or skipped stop: the place's cluster id and which pass of the
    route it is ("1234#1"; a loop can pass a place twice), plus its name for
    the notice if it ever drops off the route. A pin also says what the stop
    is for: a break, lunch, dinner or the night ("stay here instead").
    Skips have no kind: a skipped place is never used for anything."""

    key: str = Field(pattern=r"^\d+#\d+$")
    name: str = ""
    kind: StopKind = "break"


# ---------- phase 4: meals, fuel and days ----------

HHMM = r"^\d{2}:\d{2}$"


class Meal(BaseModel):
    """One meal on the road: it happens on arrival inside [start, end] local time
    and lasts `minutes`. A meal is a stop, so it resets the break clock."""

    on: bool = True
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    minutes: float = Field(ge=0, le=240)


class MealSettings(BaseModel):
    """Lunch and dinner. Breakfast is at the hotel and is not planned.

    `food` filters the places a meal may happen at: "all" (any restaurant,
    fast food or café), "sitdown" (restaurants only) or "fast" (fast food only).
    Dinner at an overnight that is reached by the end of the dinner window
    happens there ("dinner near the hotel"), with no stop on the road."""

    lunch: Meal = Meal(start="11:30", end="13:30", minutes=45)
    dinner: Meal = Meal(start="17:30", end="19:30", minutes=60)
    food: Literal["all", "sitdown", "fast"] = "all"
    resets_break_clock: bool = True  # a meal counts as a break; off: the break clock keeps running through a meal


class FuelSettings(BaseModel):
    """A gas car's tank. Fuel is due after `refuel_after` of the range (75 % of
    400 mi = 300 mi), so there is always a reserve. Every overnight fills the
    tank. A fuel stop within `merge_minutes` of a break or meal is merged into it."""

    on: bool = True
    range_miles: float = Field(default=400, ge=50, le=1500)
    refuel_after: float = Field(default=0.75, ge=0.2, le=1.0)
    fill_at_overnight: bool = True
    minutes: float = Field(default=10, ge=0, le=60)  # a fuel stop on its own
    merge_minutes: float = Field(default=20, ge=0, le=120)

    @property
    def due_miles(self) -> float:
        return self.range_miles * self.refuel_after


class DaySettings(BaseModel):
    """How long a driving day is. Both limits are soft: a day may go over them
    when nothing else works, and the plan then warns and says why.

    `auto_overnights` lets the planner end days at places to stay (at least
    `min_lodging` lodgings). `stop_at_sunset` adds a third soft limit: arrive
    by sunset. The day starts at PlanRequest.day_start."""

    driving_minutes: float = Field(default=480, ge=60, le=1440)
    arrive_by: str = Field(default="19:00", pattern=HHMM)
    auto_overnights: bool = True
    min_lodging: int = Field(default=2, ge=1, le=50)
    stop_at_sunset: bool = False


class LodgingSettings(BaseModel):
    """Lodging brands (OSM `brand`, or `operator` when a place has no brand); a
    chosen name matches any brand that contains it ("Hampton" finds "Hampton Inn & Suites").
    "prefer" gives a place with one of them a bonus when the planner picks a
    night; "only" counts just those lodgings toward `min_lodging`. Only about
    45 % of Colorado's lodging has a brand tag, so "only" can leave a town
    with no place to stay."""

    brands: list[str] = []
    rule: Literal["prefer", "only"] = "prefer"


class PlanRequest(RouteRequest):
    """A trip plus what the break planner needs. The RouteRequest part decides
    the route and the candidates; the rest only changes the choice among them,
    so a re-plan after a pin or a skip never asks Valhalla again."""

    breaks: BreakSettings = BreakSettings()
    meals: MealSettings = MealSettings()
    fuel: FuelSettings = FuelSettings()
    days: DaySettings = DaySettings()
    lodging: LodgingSettings = LodgingSettings()
    warn_closures: bool = True  # list roads closed for the season (does not change the plan)
    pins: list[StopRef] = []
    skips: list[StopRef] = []
    day_start: str = Field(default="08:00", pattern=r"^\d{2}:\d{2}$")  # when a day starts after an overnight

    def route_request(self) -> RouteRequest:
        """Only the fields that decide the route (and the cached analysis)."""
        return RouteRequest(**self.model_dump(include=set(RouteRequest.model_fields)))

    def analysis_request(self) -> RouteRequest:
        """The route part, with only the zones that change the route (avoid zones
        that are on). Turning a no-meals zone on or changing a zone's type to
        "prefer" then finds the cached candidates and makes no Valhalla call."""
        req = self.route_request()
        return req.model_copy(update={"zones": [z for z in req.zones if z.enabled and z.type == "avoid"]})


# ---------- phase 5: exports, the zone library, start from here ----------


class ExportRequest(PlanRequest):
    """A trip to export, as the page has it (saved or not), plus what to export."""

    name: str = "Road trip"
    only_days: list[int] | None = None  # trip days to include (None: every driving day)
    parts: dict[str, bool] = {}  # day sheets: exits, strip, warnings (all on unless false)
    platform: Literal["mobile", "desktop"] = "mobile"  # Google Maps links: 3 or 9 waypoints per link
    include_stops: bool = True  # Google Maps links: also the planned breaks, meals and fuel


class WhatIfRequest(PlanRequest):
    """A trip, and the ids of its zones that are off, to ask what switching each on would do."""

    check: list[str] = Field(default=[], max_length=12)


class HereRequest(BaseModel):
    """Where the car is, and when (UTC or with a UTC offset), for "start from here"."""

    trip: PlanRequest
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    now: datetime
    mile: float | None = None  # which pass of the route, when the position is near more than one
