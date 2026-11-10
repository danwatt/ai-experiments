"""Miles and minutes at every point of a route.

Valhalla gives a time and a length for each maneuver ("Merge onto I 70, 45 mi").
speeds.py turns the time into the one the sidebar shows (curves slowed, then
the pace). Here that time is spread over the maneuver's shape points by
distance, so any point on the route has a mile and a minute, and the last
point's minute equals the sum of the legs the sidebar adds up.

    tl = build(trip, pace)
    tl.at_mile(120.0)         -> (lat, lon)
    tl.interpolate(s_m)       -> (mile, minute) at s_m metres along the line
"""

from bisect import bisect_right
from dataclasses import dataclass

from . import speeds
from .geometry import LocalProjection
from .routing import trip_points


@dataclass
class Timeline:
    points: list[tuple[float, float]]  # (lat, lon), same list as the /api/route geometry
    miles: list[float]  # cumulative, at each point
    minutes: list[float]  # cumulative driving minutes, pace included
    proj: LocalProjection
    xy: list[tuple[float, float]]  # points in flat metres
    cum_m: list[float]  # cumulative flat metres along the line

    def interpolate(self, s_m: float) -> tuple[float, float]:
        """(mile, minute) at `s_m` flat metres along the line."""
        i = min(max(bisect_right(self.cum_m, s_m) - 1, 0), len(self.points) - 2)
        span = self.cum_m[i + 1] - self.cum_m[i]
        t = 0.0 if span <= 0 else min(max((s_m - self.cum_m[i]) / span, 0.0), 1.0)
        return (
            self.miles[i] + t * (self.miles[i + 1] - self.miles[i]),
            self.minutes[i] + t * (self.minutes[i + 1] - self.minutes[i]),
        )

    def minute_at_mile(self, mile: float) -> float:
        """Driving minute at this mile, clamped to the ends."""
        return _lookup(self.miles, self.minutes, mile)

    def mile_at_minute(self, minute: float) -> float:
        """Mile reached after this many driving minutes, clamped to the ends."""
        return _lookup(self.minutes, self.miles, minute)

    def at_mile(self, mile: float) -> tuple[float, float]:
        """(lat, lon) of the route at this mile, clamped to the ends."""
        mile = min(max(mile, 0.0), self.miles[-1])
        i = min(max(bisect_right(self.miles, mile) - 1, 0), len(self.points) - 2)
        span = self.miles[i + 1] - self.miles[i]
        t = 0.0 if span <= 0 else (mile - self.miles[i]) / span
        (lat1, lon1), (lat2, lon2) = self.points[i], self.points[i + 1]
        return lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)


def _lookup(xs: list[float], ys: list[float], x: float) -> float:
    """y at x, interpolated between the two neighbouring points. xs never decreases."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = min(max(bisect_right(xs, x) - 1, 0), len(xs) - 2)
    span = xs[i + 1] - xs[i]
    t = 0.0 if span <= 0 else (x - xs[i]) / span
    return ys[i] + t * (ys[i + 1] - ys[i])


def build(trip: dict, pace: float) -> Timeline:
    """Timeline for a Valhalla trip (the `trip` object of a /route answer)."""
    points, spans = trip_points(trip)
    proj = LocalProjection(points[0][0])
    xy = [proj.xy(lat, lon) for lat, lon in points]
    cum_m = [0.0]
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        cum_m.append(cum_m[-1] + ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5)

    miles = [0.0] * len(points)
    minutes = [0.0] * len(points)
    base_miles = base_minutes = 0.0
    for leg, (start, _end) in zip(trip["legs"], spans):
        for m in leg["maneuvers"]:
            a, b = start + m["begin_shape_index"], start + m["end_shape_index"]
            seconds = speeds.maneuver_seconds(xy[a : b + 1], m["time"])
            length = cum_m[b] - cum_m[a]
            for i in range(a, b + 1):
                f = 0.0 if length <= 0 else (cum_m[i] - cum_m[a]) / length
                miles[i] = base_miles + f * m["length"]
                minutes[i] = base_minutes + f * seconds * pace / 60
            base_miles += m["length"]
            base_minutes += seconds * pace / 60
    return Timeline(points, miles, minutes, proj, xy, cum_m)
