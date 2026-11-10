import httpx
import pytest

from app import valhalla
from app.valhalla import Point, decode_polyline6


def encode_polyline6(points):
    """Test-only encoder: the reverse of decode_polyline6."""
    out, prev_lat, prev_lon = [], 0, 0
    for lat, lon in points:
        for value, prev in ((round(lat * 1e6), prev_lat), (round(lon * 1e6), prev_lon)):
            delta = value - prev
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1F)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
        prev_lat, prev_lon = round(lat * 1e6), round(lon * 1e6)
    return "".join(out)


def test_decode_polyline6_known_value():
    # Google's documented example, which uses 5 digits: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    # is (38.5,-120.2) (40.7,-120.95) (43.252,-126.453). Our decoder uses 6 digits,
    # so the same string decodes to those values divided by 10.
    pts = decode_polyline6("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert pts == [(3.85, -12.02), (4.07, -12.095), (4.3252, -12.6453)]


def test_decode_polyline6_round_trip():
    original = [(39.739236, -104.990251), (37.275, -107.88), (37.2753, -107.8801)]
    assert decode_polyline6(encode_polyline6(original)) == original


def test_decode_polyline6_empty():
    assert decode_polyline6("") == []


def _valhalla_up() -> bool:
    try:
        valhalla.status()
        return True
    except httpx.HTTPError:
        return False


@pytest.mark.skipif(not _valhalla_up(), reason="valhalla is not reachable")
def test_route_denver_to_golden_smoke():
    result = valhalla.route([Point(39.7392, -104.9903), Point(39.7555, -105.2211)])
    summary = result["trip"]["summary"]
    assert 10 < summary["length"] < 40  # miles
    assert 600 < summary["time"] < 3600  # seconds
    assert len(decode_polyline6(result["trip"]["legs"][0]["shape"])) > 50
