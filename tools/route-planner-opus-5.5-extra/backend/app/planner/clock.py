"""Local time along the route: time zones, daylight saving and sunset.

Every clock time in the plan is local time where it happens. Inside the
planner the clock runs in UTC minutes (minutes since 1970, as a float), so
adding driving minutes never trips over a time zone line or a DST change.
Each row is then shown in its own place's zone.

    zone = zone_at(lat, lon)                   America/Denver (offline lookup)
    t = utc_minutes(datetime(...), zone)       a local time as UTC minutes
    local(t, zone)                             back to a local datetime
    crossings(tl, mile_a, mile_b)              where the route changes zone
    sunset(lat, lon, day, zone)                that day's sunset, local

The time zone of a place on the route is the zone of the route at that mile
(Timeline.at_mile), so a stop just across a zone line from the road gets the
road's zone. Candidates are within 2 mi of the road, so this only matters
right at a boundary.
"""

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import sunset as astral_sunset
from timezonefinder import TimezoneFinder

from ..timeline import Timeline

_finder: TimezoneFinder | None = None
STEP_MILES = 5.0  # how finely crossings() looks for a zone change before narrowing it down


def finder() -> TimezoneFinder:
    """One TimezoneFinder for the process (it loads its boundary data once)."""
    global _finder
    if _finder is None:
        _finder = TimezoneFinder()
    return _finder


@lru_cache(maxsize=50_000)
def _zone_name(lat: float, lon: float) -> str:
    return finder().timezone_at(lat=lat, lng=lon) or "UTC"


def zone_at(lat: float, lon: float) -> ZoneInfo:
    """The time zone at a point. Rounded to about 100 m, so nearby points share a lookup."""
    return ZoneInfo(_zone_name(round(lat, 3), round(lon, 3)))


def zone_at_mile(tl: Timeline, mile: float) -> ZoneInfo:
    return zone_at(*tl.at_mile(mile))


def utc_minutes(local_time: datetime, zone: ZoneInfo) -> float:
    """A naive local time in `zone` as UTC minutes."""
    return local_time.replace(tzinfo=zone).timestamp() / 60


def local(t: float, zone: ZoneInfo) -> datetime:
    """UTC minutes as a local time in `zone` (aware)."""
    return datetime.fromtimestamp(t * 60, tz=timezone.utc).astimezone(zone)


def naive(t: float, zone: ZoneInfo) -> datetime:
    """UTC minutes as a naive local time in `zone`: what the itinerary shows."""
    return local(t, zone).replace(tzinfo=None)


def offset_minutes(t: float, zone: ZoneInfo) -> float:
    """How far `zone` is ahead of UTC at UTC minute `t` (negative in America)."""
    return local(t, zone).utcoffset().total_seconds() / 60


def short_name(t: float, zone: ZoneInfo) -> str:
    """'MDT', 'CST': the zone's abbreviation at that moment."""
    return local(t, zone).tzname() or str(zone)


def window_utc(day: date, hhmm: str, zone: ZoneInfo) -> float:
    """'11:30' on `day` in `zone`, as UTC minutes."""
    hh, mm = (int(x) for x in hhmm.split(":"))
    return utc_minutes(datetime(day.year, day.month, day.day, hh, mm), zone)


def crossings(tl: Timeline, mile_a: float, mile_b: float) -> list[tuple[float, ZoneInfo, ZoneInfo]]:
    """Every place between two miles where the route enters another time zone:
    (mile, zone before, zone after), the mile found to within 0.1 mi.

    Looks every STEP_MILES, then halves the step where the zone changed. A
    zone sliver narrower than STEP_MILES can be missed; the US has none on
    roads that matter.
    """
    out = []
    here, here_zone = mile_a, zone_at_mile(tl, mile_a)
    while here < mile_b:
        nxt = min(here + STEP_MILES, mile_b)
        nxt_zone = zone_at_mile(tl, nxt)
        if nxt_zone.key != here_zone.key:
            lo, hi = here, nxt
            while hi - lo > 0.1:
                mid = (lo + hi) / 2
                if zone_at_mile(tl, mid).key == here_zone.key:
                    lo = mid
                else:
                    hi = mid
            out.append((round(hi, 1), here_zone, nxt_zone))
        here, here_zone = nxt, nxt_zone
    return out


def sunset(lat: float, lon: float, day: date, zone: ZoneInfo) -> datetime | None:
    """Sunset on `day` at a place, as a naive local time. None where the sun
    does not set that day (far north in summer)."""
    try:
        return astral_sunset(Observer(latitude=lat, longitude=lon), date=day, tzinfo=zone).replace(tzinfo=None, microsecond=0)
    except ValueError:
        return None


def next_morning(t: float, zone: ZoneInfo, nights: int, day_start: str) -> float:
    """When you leave after `nights` nights: that many days after arriving at
    UTC minute `t`, at the day-start time in the overnight's own zone."""
    arrived = local(t, zone).date()
    return window_utc(arrived + timedelta(days=nights), day_start, zone)
