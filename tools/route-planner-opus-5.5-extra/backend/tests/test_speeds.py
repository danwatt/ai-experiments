"""The curve correction on top of Valhalla's times."""

import math

import pytest

from app import speeds


def arc(radius_m, degrees, step_deg=1.0):
    """Points (x, y) in metres along a circular arc."""
    n = int(degrees / step_deg)
    return [(radius_m * math.sin(math.radians(i * step_deg)), radius_m * (1 - math.cos(math.radians(i * step_deg)))) for i in range(n + 1)]


def test_curve_speed():
    assert speeds.curve_speed(100) == pytest.approx(math.sqrt(150))  # 12.2 m/s, 27 mph


def test_radius_of_a_circle_is_found():
    radii = [r for r in speeds.curve_radii(arc(200, 90)) if math.isfinite(r)]
    middle = radii[len(radii) // 4 : -len(radii) // 4]
    assert middle and all(r == pytest.approx(200, rel=0.05) for r in middle)


def test_straight_road_keeps_valhalla_time():
    straight = [(0, i * 100.0) for i in range(51)]  # 5 km
    assert speeds.maneuver_seconds(straight, 200) == pytest.approx(200, rel=0.01)


def test_tight_curves_take_longer():
    # 50 m hairpins: 19 mph at most, where Valhalla assumed 25 m/s (56 mph).
    hairpin = arc(50, 180)
    length = math.pi * 50
    valhalla_s = length / 25
    corrected = speeds.maneuver_seconds(hairpin, valhalla_s)
    assert corrected > 2.5 * valhalla_s
    assert corrected == pytest.approx(length / speeds.curve_speed(50), rel=0.25)


def test_gentle_curve_is_not_slowed():
    # A 2 km radius curve allows 55 m/s, faster than the road's 25 m/s.
    sweep = arc(2000, 20, 0.2)
    length = 2000 * math.radians(20)
    assert speeds.maneuver_seconds(sweep, length / 25) == pytest.approx(length / 25, rel=0.02)
