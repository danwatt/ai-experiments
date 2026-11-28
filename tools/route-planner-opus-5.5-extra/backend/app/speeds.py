"""Drive times: Valhalla's, slowed down in tight curves, times the user's pace.

Valhalla's speeds come from OSM `maxspeed` tags (see notes/phase-1.md). Those
match real drives well on highways and two-lane roads, but on mountain roads
like US-550 nobody takes a hairpin at the posted 40 mph. So for every 25 m of
the route the planner estimates the curve radius from the bend in the line and
caps the speed at what is comfortable in a curve that tight:

    v = sqrt(lateral_acceleration * radius)

With 1.5 m/s^2 that is 27 mph in a 100 m curve and 19 mph in a 50 m hairpin.
The value is lower than the physical comfort limit (about 3 m/s^2) because it
also has to stand in for braking into curves and climbing out of them. It was
picked with `make calibrate` against nine Colorado drives.

The correction only changes times. The route itself is still Valhalla's
choice, made with its own (uncorrected) speeds.

On top of that, one pace multiplier, the user's own: 1.05 means "I drive 5 %
slower than the estimate".
"""

import math

from .geometry import LocalProjection, resample
from .valhalla import decode_polyline6

DEFAULT_PACE = 1.05

LATERAL_ACCEL = 1.5  # m/s^2
STEP_M = 25.0  # sample spacing along the route
WINDOW = 2  # samples each side used to measure the bend (so +-50 m)


def curve_speed(radius_m: float) -> float:
    """Comfortable speed in m/s through a curve of the given radius."""
    return math.sqrt(LATERAL_ACCEL * radius_m)


def curve_radii(xy: list[tuple[float, float]]) -> list[float]:
    """Radius in metres at each resampled point; math.inf where it is straight.

    The bend is the change of heading between the line WINDOW samples back and
    WINDOW samples ahead; the radius is the arc length divided by that angle.
    """
    pts = resample(xy, STEP_M)
    radii = []
    for i in range(len(pts) - 1):
        a, b, c = pts[max(0, i - WINDOW)], pts[i], pts[min(len(pts) - 1, i + WINDOW)]
        if a == b or b == c:  # first or last sample: no bend to measure
            radii.append(math.inf)
            continue
        h1 = math.atan2(b[1] - a[1], b[0] - a[0])
        h2 = math.atan2(c[1] - b[1], c[0] - b[0])
        turn = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        arc = math.hypot(c[0] - a[0], c[1] - a[1]) / 2
        radii.append(arc / turn if turn > 1e-3 and arc > 0 else math.inf)
    return radii


def maneuver_seconds(xy: list[tuple[float, float]], valhalla_seconds: float) -> float:
    """Time for one maneuver's stretch of road, curves included.

    Valhalla gives one time per maneuver. Its average speed is kept on the
    straight parts and capped in the curves.
    """
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy, xy[1:]))
    if length < 1 or valhalla_seconds <= 0:
        return valhalla_seconds
    speed = length / valhalla_seconds
    radii = curve_radii(xy)
    if not radii:
        return valhalla_seconds
    piece = length / len(radii)  # resampled pieces are STEP_M long, except the last
    return sum(piece / min(speed, curve_speed(r)) for r in radii)


def leg_seconds(leg: dict) -> float:
    """Corrected driving time for one Valhalla leg, without the pace."""
    shape = decode_polyline6(leg["shape"])
    if not shape:
        return leg["summary"]["time"]
    proj = LocalProjection(shape[0][0])
    xy = [proj.xy(lat, lon) for lat, lon in shape]
    total = 0.0
    for m in leg["maneuvers"]:
        stretch = xy[m["begin_shape_index"] : m["end_shape_index"] + 1]
        total += maneuver_seconds(stretch, m["time"])
    return total


def corrected_trip_seconds(trip: dict) -> float:
    """Corrected driving time for a whole Valhalla trip, without the pace."""
    return sum(leg_seconds(leg) for leg in trip["legs"])
