"""The zone pre-checks: a waypoint inside an avoid zone, and zone size limits."""

import pytest

from app import zones
from app.models import Zone
from tests.fakes import box, wp


def test_waypoint_inside_avoid_zone_is_named():
    trip = [wp("a", 39.74, -104.99, name="Denver"), wp("b", 37.28, -107.88, name="Durango")]
    with pytest.raises(zones.ZoneError) as err:
        zones.check_waypoints(trip, [box("z1", 37.2, -108.0, 37.4, -107.8, name="Durango box")])
    e = err.value
    assert e.code == "waypoint_in_avoid_zone"
    assert e.zone_id == "z1" and e.waypoint_id == "b"
    assert "B (Durango)" in e.message and "“Durango box”" in e.message


def test_unnamed_waypoint_is_named_by_letter():
    trip = [wp("a", 39.74, -104.99), wp("b", 38.5, -106.0), wp("c", 37.28, -107.88)]
    with pytest.raises(zones.ZoneError) as err:
        zones.check_waypoints(trip, [box("z", 38.4, -106.1, 38.6, -105.9)])
    assert err.value.message.startswith("Waypoint B ")


@pytest.mark.parametrize("kind, enabled", [("no_meals", True), ("prefer", True), ("avoid", False)])
def test_other_zones_do_not_block(kind, enabled):
    trip = [wp("a", 39.74, -104.99), wp("b", 37.28, -107.88)]
    zones.check_waypoints(trip, [box("z", 37.2, -108.0, 37.4, -107.8, type=kind, enabled=enabled)])


def test_waypoint_outside_is_fine():
    zones.check_waypoints([wp("a", 39.74, -104.99), wp("b", 37.28, -107.88)], [box("z", 38, -106, 38.5, -105.5)])


def test_polygon_zone():
    triangle = Zone(id="t", name="Triangle", ring=[(-106, 38), (-105, 38), (-105.5, 39)])
    with pytest.raises(zones.ZoneError):
        zones.check_waypoints([wp("a", 38.3, -105.5), wp("b", 37, -104)], [triangle])
    # Inside the bounding box but outside the triangle.
    zones.check_waypoints([wp("a", 38.9, -105.95), wp("b", 37, -104)], [triangle])


def test_zone_too_large():
    # About 9 by 9 degrees: well over 3,000 km of outline.
    big = box("big", 30, -110, 39, -101, name="Most of the West")
    with pytest.raises(zones.ZoneError) as err:
        zones.check_sizes([big])
    assert err.value.code == "zone_too_large" and err.value.zone_id == "big"
    assert "“Most of the West”" in err.value.message


def test_limits_are_summed_over_zones():
    # Each about 600 km square (2,400 km of outline): fine alone, not together.
    a, b = box("a", 36, -110, 41.4, -103), box("b", 30, -100, 35.4, -93)
    zones.check_sizes([a])
    with pytest.raises(zones.ZoneError) as err:
        zones.check_sizes([a, b])
    assert err.value.zone_id == "b"


def test_too_many_vertices():
    import math

    ring = [(-105 + 0.1 * math.cos(2 * math.pi * i / 600), 39 + 0.1 * math.sin(2 * math.pi * i / 600)) for i in range(600)]
    with pytest.raises(zones.ZoneError) as err:
        zones.check_sizes([Zone(id="round", ring=ring)])
    assert err.value.code == "zone_too_many_points"


def test_exclude_polygons_closes_rings():
    open_ring = Zone(id="t", ring=[(-106, 38), (-105, 38), (-105.5, 39)])
    assert zones.exclude_polygons([open_ring]) == [[[-106, 38], [-105, 38], [-105.5, 39], [-106, 38]]]
