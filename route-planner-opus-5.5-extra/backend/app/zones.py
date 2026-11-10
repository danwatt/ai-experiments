"""Zones: which ones Valhalla must avoid, and the checks before it is asked.

Valhalla is told about avoid zones through `exclude_polygons`. Two things go
wrong there with nothing but an error code to show for it:

- A waypoint inside an avoid zone makes the whole request fail with
  "442: No path could be found". check_waypoints() finds the zone and the
  waypoint first, so the user is told which ones.
- Zones beyond Valhalla's size limits are rejected. The limits are raised in
  valhalla/start.sh, and are summed over all zones of a request. check_sizes()
  applies the same numbers and names the zone that broke them.
"""

from .geometry import ring_contains, ring_perimeter_m
from .models import Waypoint, Zone

# Keep in step with valhalla/start.sh.
MAX_TOTAL_PERIMETER_M = 3_000_000
MAX_TOTAL_VERTICES = 500


class ZoneError(Exception):
    """A problem with the trip's zones that the user can fix."""

    def __init__(self, code: str, message: str, zone_id: str, waypoint_id: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.zone_id = zone_id
        self.waypoint_id = waypoint_id

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "zone_id": self.zone_id, "waypoint_id": self.waypoint_id}


def avoid_zones(zones: list[Zone]) -> list[Zone]:
    """The zones that change the route: avoid zones that are switched on."""
    return [z for z in zones if z.enabled and z.type == "avoid"]


def closed(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return ring if ring[0] == ring[-1] else [*ring, ring[0]]


def label(zone: Zone) -> str:
    return f"“{zone.name}”" if zone.name else "an unnamed zone"


def waypoint_label(index: int, wp: Waypoint) -> str:
    letter = chr(ord("A") + index) if index < 26 else str(index + 1)
    return f"{letter} ({wp.name})" if wp.name else letter


def check_waypoints(waypoints: list[Waypoint], zones: list[Zone]) -> None:
    """Raise ZoneError if any waypoint sits inside an avoid zone."""
    for zone in avoid_zones(zones):
        for i, wp in enumerate(waypoints):
            if ring_contains(zone.ring, wp.lat, wp.lon):
                raise ZoneError(
                    "waypoint_in_avoid_zone",
                    f"Waypoint {waypoint_label(i, wp)} is inside the avoid zone {label(zone)}. "
                    "Move the waypoint, or turn the zone off or redraw it.",
                    zone.id,
                    wp.id,
                )


def check_sizes(zones: list[Zone]) -> None:
    """Raise ZoneError if the avoid zones together exceed Valhalla's limits."""
    total_m, total_vertices = 0.0, 0
    for zone in avoid_zones(zones):
        ring = closed(zone.ring)
        total_m += ring_perimeter_m(ring)
        total_vertices += len(ring)
        if total_m > MAX_TOTAL_PERIMETER_M:
            raise ZoneError(
                "zone_too_large",
                f"The avoid zone {label(zone)} is too large: avoid zones may have "
                f"{MAX_TOTAL_PERIMETER_M // 1000:,} km of outline in total, and this one "
                f"brings the total to {total_m / 1000:,.0f} km. Draw it smaller or split it.",
                zone.id,
            )
        if total_vertices > MAX_TOTAL_VERTICES:
            raise ZoneError(
                "zone_too_many_points",
                f"The avoid zone {label(zone)} has too many corners: avoid zones may have "
                f"{MAX_TOTAL_VERTICES} in total, and this one brings the total to {total_vertices}. "
                "Simplify it.",
                zone.id,
            )


def exclude_polygons(zones: list[Zone]) -> list[list[list[float]]]:
    """Avoid zones as Valhalla's exclude_polygons: rings of [lon, lat]."""
    return [[list(pt) for pt in closed(z.ring)] for z in avoid_zones(zones)]


# ---------- phase 4: zones that change where stops go ----------
#
# These never change the route. Each candidate stop is tested with its own
# lat/lon (choices.prepare):
#
#   no_stops      no break, meal, fuel or overnight here
#   no_meals      no lunch or dinner here (breaks and fuel are fine)
#   no_overnight  no automatic overnight here
#   prefer        any stop here gets a bonus, so it wins close calls

STOP_ZONE_TYPES = ("no_stops", "no_meals", "no_overnight", "prefer")
# What each zone type rules out, by stop purpose.
RULES_OUT = {
    "no_stops": {"break", "lunch", "dinner", "fuel", "overnight"},
    "no_meals": {"lunch", "dinner"},
    "no_overnight": {"overnight"},
    "prefer": set(),
}
TYPE_WORDS = {"no_stops": "no-stops zone", "no_meals": "no-meals zone", "no_overnight": "no-overnight zone", "prefer": "prefer zone"}


def stop_zones(zones: list[Zone]) -> list[Zone]:
    """The zones that change where stops go: switched on, and not avoid zones."""
    return [z for z in zones if z.enabled and z.type in STOP_ZONE_TYPES]


def zones_at(lat: float, lon: float, zones: list[Zone]) -> list[Zone]:
    """The stop zones that contain this point, in the order given."""
    return [z for z in stop_zones(zones) if ring_contains(z.ring, lat, lon)]


def ruled_out_by(purpose: str, inside: list[Zone]) -> Zone | None:
    """The first zone among `inside` that forbids a stop for `purpose`
    ("break", "lunch", "dinner", "fuel", "overnight"), or None."""
    return next((z for z in inside if purpose in RULES_OUT[z.type]), None)


def zone_words(zone: Zone) -> str:
    """'no-meals zone “Montrose”', for the reasons the itinerary gives."""
    return f"{TYPE_WORDS[zone.type]} {label(zone)}" if zone.name else TYPE_WORDS[zone.type]
