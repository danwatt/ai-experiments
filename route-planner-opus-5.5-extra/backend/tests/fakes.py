"""Hand-made Valhalla answers, so routing tests need no Valhalla."""

from app.models import RouteRequest, Waypoint, Zone


def encode_polyline6(points):
    """Test-only encoder: the reverse of valhalla.decode_polyline6."""
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


def line(start, end, n=11):
    """n points on a straight line from start to end, as (lat, lon)."""
    return [(start[0] + (end[0] - start[0]) * i / (n - 1), start[1] + (end[1] - start[1]) * i / (n - 1)) for i in range(n)]


def leg(points, seconds, miles):
    """One Valhalla leg: a single maneuver over the whole shape."""
    return {
        "shape": encode_polyline6(points),
        "summary": {"time": seconds, "length": miles},
        "maneuvers": [{"begin_shape_index": 0, "end_shape_index": len(points) - 1, "time": seconds, "length": miles}],
    }


def trip(*legs):
    return {
        "legs": list(legs),
        "summary": {"time": sum(x["summary"]["time"] for x in legs), "length": sum(x["summary"]["length"] for x in legs)},
    }


def wp(id, lat, lon, type="stop", name=""):
    return Waypoint(id=id, lat=lat, lon=lon, type=type, name=name)


def box(id, south, west, north, east, type="avoid", enabled=True, name=None):
    ring = [(west, south), (east, south), (east, north), (west, north), (west, south)]
    return Zone(id=id, name=name if name is not None else id, type=type, ring=ring, enabled=enabled, shape="rectangle")


def request(waypoints, zones=(), **kw):
    return RouteRequest(waypoints=list(waypoints), zones=list(zones), **kw)


# ---------- phase 3: hand-made candidates for the break planner ----------


def cand(id, mile, *, minute=None, kind="town", name=None, food=3, fuel=1, lodging=0, detour=0.5, status="ok"):
    """A candidate as /api/route/stops returns it. By default minute == mile (60 mph)."""
    minute = mile if minute is None else minute
    return {
        "id": id, "kind": kind, "name": name or f"place {id}", "near": "", "lat": 39.0, "lon": -105.0 + mile / 60,
        "ref": "", "road": "", "population": None, "toilets": None, "picnic": None,
        "food": food, "food_fast": 0, "food_sitdown": food, "food_cafe": 0, "fuel": fuel, "lodging": lodging, "detail": {},
        "key": f"{id}@{mile:.1f}", "mile": mile, "minute": minute, "off_route_m": 50,
        "detour_min": detour if status == "ok" else None, "over_limit": False, "detour_status": status,
    }
