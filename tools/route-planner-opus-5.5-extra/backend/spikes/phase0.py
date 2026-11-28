"""Phase 0 spike: does the routing stack do what the plan needs?

Run with `make spike` (inside the api container). Prints plain text.
"""

import sys
import time
from collections import Counter

import osmium

from app import valhalla
from app.valhalla import Point

PBF = "/data/valhalla/colorado-latest.osm.pbf"

DENVER = Point(39.7392, -104.9903)
DURANGO = Point(37.2753, -107.8801)
OURAY = Point(38.0228, -107.6714, type="through")
MONTROSE = (38.4783, -107.8762)  # lat, lon; on US-50, where the plain route goes
ESTES_PARK = Point(40.3772, -105.5217)
GRAND_LAKE = Point(40.2503, -105.8231)
SAGUACHE = Point(38.0861, -106.1397, type="through")  # on US-285
LEADVILLE = Point(39.2508, -106.2925)
ASPEN = Point(39.1911, -106.8175)


# ---------- printing helpers ----------


def hmm(seconds: float) -> str:
    minutes = round(seconds / 60)
    return f"{minutes // 60}:{minutes % 60:02d}"


def roads(trip: dict, min_miles: float = 8.0) -> list[tuple[str, float, float]]:
    """Main roads in order, as (name, miles, seconds), from the maneuvers.

    Each maneuver has street_names (a list; the first is its main name), a
    length in miles and a time in seconds. Consecutive maneuvers on the same
    road are merged, and roads shorter than min_miles are dropped, so the
    output is the backbone of the route.
    """
    merged: list[list] = []
    for leg in trip["legs"]:
        for m in leg["maneuvers"]:
            names = m.get("street_names") or m.get("begin_street_names") or ["(unnamed)"]
            if merged and merged[-1][0] == names[0]:
                merged[-1][1] += m["length"]
                merged[-1][2] += m["time"]
            else:
                merged.append([names[0], m["length"], m["time"]])
    # Merge again after dropping the short ones, so a road interrupted by a
    # short ramp is still one entry.
    out: list[list] = []
    for n, mi, sec in merged:
        if mi < min_miles:
            continue
        if out and out[-1][0] == n:
            out[-1][1] += mi
            out[-1][2] += sec
        else:
            out.append([n, mi, sec])
    return [(n, mi, sec) for n, mi, sec in out]


def chain(trip: dict, min_miles: float = 8.0) -> str:
    return " > ".join(f"{n} {mi:.0f}mi@{mi / (sec / 3600):.0f}mph" for n, mi, sec in roads(trip, min_miles) if sec)


def describe(label: str, trip: dict) -> None:
    s = trip["summary"]
    print(f"  {label}: {s['length']:.1f} mi, {hmm(s['time'])}")
    print("    " + chain(trip))


def uses(trip: dict, needle: str) -> float:
    """Miles of the route on maneuvers whose names include `needle`."""
    total = 0.0
    for leg in trip["legs"]:
        for m in leg["maneuvers"]:
            if any(needle.lower() in n.lower() for n in m.get("street_names", [])):
                total += m["length"]
    return total


def timed_route(*args, **kwargs):
    t0 = time.perf_counter()
    result = valhalla.route(*args, **kwargs)
    return result, time.perf_counter() - t0


def box(lat: float, lon: float, half: float = 0.05) -> list[tuple[float, float]]:
    """A closed square ring of (lon, lat) around a point; Valhalla wants lon, lat."""
    return [
        (lon - half, lat - half),
        (lon + half, lat - half),
        (lon + half, lat + half),
        (lon - half, lat + half),
        (lon - half, lat - half),
    ]


def nearest_shape_point(trip: dict, lat: float, lon: float) -> tuple[float, float, float]:
    """The route's shape point closest to (lat, lon): (lat, lon, degrees away)."""
    best = None
    for leg in trip["legs"]:
        for plat, plon in valhalla.decode_polyline6(leg["shape"]):
            d = ((plat - lat) ** 2 + (plon - lon) ** 2) ** 0.5
            if best is None or d < best[2]:
                best = (plat, plon, d)
    return best


def heading(text: str) -> None:
    print(f"\n=== {text} ===")


# ---------- the experiments ----------


def spike_routes() -> dict:
    heading("1. Denver -> Durango, plain, with alternates")
    plain, secs = timed_route([DENVER, DURANGO], alternates=2)
    describe("main", plain["trip"])
    for i, alt in enumerate(plain.get("alternates", []), 1):
        describe(f"alternate {i}", alt["trip"])
    print(f"  ({len(plain.get('alternates', []))} alternates returned; {secs:.2f} s)")

    heading("2. Same, with a through point at Ouray")
    ouray, secs = timed_route([DENVER, OURAY, DURANGO])
    describe("via Ouray", ouray["trip"])
    print(f"  miles on US 550: plain {uses(plain['trip'], 'US 550'):.0f}, via Ouray {uses(ouray['trip'], 'US 550'):.0f}  ({secs:.2f} s)")
    plat, plon, d_plain = nearest_shape_point(plain["trip"], OURAY.lat, OURAY.lon)
    print(f"  plain route already passes {d_plain * 69:.2f} mi from Ouray, so this through point changes nothing")
    # Speed sanity: US 550 stretch average speed.
    mi = sec = 0.0
    for leg in ouray["trip"]["legs"]:
        for m in leg["maneuvers"]:
            if any("US 550" in n for n in m.get("street_names", [])):
                mi += m["length"]
                sec += m["time"]
    if sec:
        print(f"  US 550 average speed in Valhalla: {mi / (sec / 3600):.0f} mph over {mi:.0f} mi ({hmm(sec)})")
    # Per-segment view of the pass section, for the speed question.
    print("  US 550 maneuvers (mi, min, mph):")
    for leg in ouray["trip"]["legs"]:
        for m in leg["maneuvers"]:
            if any("US 550" in n for n in m.get("street_names", [])) and m["time"] > 0 and m["length"] >= 5:
                print(f"    {m['length']:5.1f} mi {m['time'] / 60:5.0f} min {m['length'] / (m['time'] / 3600):4.0f} mph  {m['instruction'][:60]}")

    heading("2b. Same, with a through point at Saguache (US-285): does a through point reshape the route?")
    sag, secs = timed_route([DENVER, SAGUACHE, DURANGO])
    describe("via Saguache", sag["trip"])
    print(f"  miles on US 285: plain {uses(plain['trip'], 'US 285'):.0f}, via Saguache {uses(sag['trip'], 'US 285'):.0f}  ({secs:.2f} s)")

    heading("3. Same as 1, with an excluded box on the plain route")
    plat, plon, dist = nearest_shape_point(plain["trip"], *MONTROSE)
    print(f"  plain route passes {dist * 69:.1f} mi from Montrose; box centered at {plat:.4f}, {plon:.4f}")
    if dist > 0.15:
        # Plain route avoids Montrose, so use its midpoint.
        shape = valhalla.decode_polyline6(plain["trip"]["legs"][0]["shape"])
        plat, plon = shape[len(shape) // 2]
        print(f"  using route midpoint instead: {plat:.4f}, {plon:.4f}")
    ring = box(plat, plon)
    excluded, secs = timed_route([DENVER, DURANGO], exclude_polygons=[ring])
    describe("with box", excluded["trip"])
    plain_len = plain["trip"]["summary"]["length"]
    print(f"  plain {plain_len:.1f} mi -> excluded {excluded['trip']['summary']['length']:.1f} mi  ({secs:.2f} s)")
    return {"ring": ring, "center": (plat, plon)}


def spike_waypoint_in_box(center: tuple[float, float], ring: list) -> None:
    heading("5b. Waypoint inside an excluded box")
    inside = Point(*center)  # the box center, so certainly inside
    for label, locs in [
        ("middle waypoint inside box", [DENVER, inside, DURANGO]),
        ("start inside box", [inside, DURANGO]),
        ("middle through-point inside box", [DENVER, Point(center[0], center[1], type="through"), DURANGO]),
    ]:
        try:
            result, _ = timed_route(locs, exclude_polygons=[ring])
            s = result["trip"]["summary"]
            print(f"  {label}: NO ERROR, {s['length']:.0f} mi, {hmm(s['time'])}")
        except valhalla.ValhallaError as exc:
            print(f"  {label}: ERROR {exc.code}: {exc}")


# ---------- seasonal closures ----------

SEASONAL_KEYS = ("seasonal", "access", "motor_vehicle", "vehicle", "motorcar", "hgv", "winter_road", "opening_hours", "description", "note")


def is_seasonal_key(k: str) -> bool:
    return k in SEASONAL_KEYS or ":conditional" in k or k.startswith("seasonal") or k.endswith(":seasonal")


class WayScan(osmium.SimpleHandler):
    """Find ways for the two named roads, plus statewide counts of closure-ish tags."""

    def __init__(self):
        super().__init__()
        self.trail: list[dict] = []
        self.indep: list[dict] = []
        self.counts: Counter = Counter()
        # way id -> (name, ref, closure-ish tags) for every highway way that
        # carries a seasonal or time-conditional access tag.
        self.closure_ways: dict[int, tuple] = {}

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if "highway" not in tags:
            return
        closure = {k: v for k, v in tags.items() if k == "seasonal" or (k in ("access:conditional", "motor_vehicle:conditional", "vehicle:conditional", "motorcar:conditional"))}
        if closure:
            self.closure_ways[w.id] = (tags.get("name", ""), tags.get("ref", ""), closure)
        for k in tags:
            if k == "seasonal" or k.endswith(":conditional") or k == "conditional":
                self.counts[k] += 1
        name = tags.get("name", "")
        ref = tags.get("ref", "")
        try:
            first = w.nodes[0].location
            lat, lon = first.lat, first.lon
        except osmium.InvalidLocationError:
            lat = lon = None
        if lat is None:
            return
        # Trail Ridge Road: US 34 inside Rocky Mountain National Park.
        if ("Trail Ridge" in name) or ("US 34" in ref and 40.25 < lat < 40.50 and -105.95 < lon < -105.55):
            self.trail.append({"id": w.id, "lat": lat, "lon": lon, "tags": tags})
        # Independence Pass: CO 82 east of Aspen / west of Twin Lakes.
        if ("Independence Pass" in name) or ("CO 82" in ref and 39.00 < lat < 39.20 and -106.75 < lon < -106.45):
            self.indep.append({"id": w.id, "lat": lat, "lon": lon, "tags": tags})


def report_ways(title: str, ways: list[dict]) -> None:
    print(f"  {title}: {len(ways)} ways")
    combos = Counter()
    for w in ways:
        t = w["tags"]
        key = (
            t.get("name", ""),
            t.get("ref", ""),
            t.get("highway", ""),
            tuple(sorted((k, v) for k, v in t.items() if is_seasonal_key(k))),
        )
        combos[key] += 1
    for (name, ref, hw, seas), n in combos.most_common(10):
        print(f"    x{n}  name={name!r} ref={ref!r} highway={hw}")
        print(f"        closure-ish tags: {dict(seas) if seas else '(none)'}")
    ex = ways[0] if ways else None
    if ex:
        print(f"    example way {ex['id']} at {ex['lat']:.4f},{ex['lon']:.4f}: all tags = {ex['tags']}")


def spike_seasonal() -> None:
    heading("4a. Seasonal tags in the Colorado PBF")
    t0 = time.perf_counter()
    scan = WayScan()
    scan.apply_file(PBF, locations=True, idx="flex_mem")
    print(f"  scanned {PBF} in {time.perf_counter() - t0:.0f} s")
    report_ways("Trail Ridge Road (US 34 in RMNP)", scan.trail)
    report_ways("Independence Pass (CO 82)", scan.indep)
    print("  statewide highway ways carrying these tags:")
    for k, n in scan.counts.most_common(15):
        print(f"    {k}: {n}")

    heading("4b. Estes Park -> Grand Lake (Trail Ridge Road) in September and in January")
    ta_ids = {}
    for label, when in [("mid-September", "2027-09-15T10:00"), ("mid-January", "2027-01-15T10:00"), ("no date_time", None)]:
        result, secs = timed_route([ESTES_PARK, GRAND_LAKE], date_time=when)
        trip = result["trip"]
        pts = valhalla.decode_polyline6(trip["legs"][0]["shape"])
        d_alpine = min(((la - 40.4329) ** 2 + (lo + 105.7527) ** 2) ** 0.5 * 69 for la, lo in pts)
        try:
            on_closure = route_closure_ways(trip, scan.closure_ways)
            tagged = f"{len(on_closure)} route ways carry closure tags"
        except valhalla.ValhallaError as exc:  # trace_attributes caps path length (default 200 km)
            on_closure = {}
            tagged = f"closure-tag check skipped: {exc}"
        print(f"  {label}: {trip['summary']['length']:.0f} mi, {hmm(trip['summary']['time'])}; "
              f"nearest approach to Alpine Visitor Center {d_alpine:.1f} mi; {tagged} ({secs:.2f} s)")
        for wid, (name, ref, tags) in list(on_closure.items())[:2]:
            print(f"      way {wid} {name or ref}: {tags}")
        print("    " + chain(trip, 3))

    heading("4c. Leadville -> Aspen over Independence Pass (CO 82), by date")
    for when in [None, "2027-07-15T10:00", "2027-10-20T10:00", "2027-11-10T10:00", "2027-11-20T10:00", "2027-01-15T10:00", "2027-05-10T10:00", "2027-05-20T10:00"]:
        result, _ = timed_route([LEADVILLE, ASPEN], date_time=when)
        trip = result["trip"]
        print(f"  {when or 'no date_time':18s}: {trip['summary']['length']:.0f} mi, {hmm(trip['summary']['time'])}, CO 82 {uses(trip, 'CO 82'):.0f} mi")


def route_closure_ways(trip: dict, closure_ways: dict) -> dict:
    """Which of the route's OSM ways carry closure tags?

    The /route response has no way ids, so we snap the route's shape with
    /trace_attributes, which lists the way id of every edge it passes.
    """
    pts = [{"lat": la, "lon": lo} for la, lo in valhalla.decode_polyline6(trip["legs"][0]["shape"])]
    ta = valhalla._post(
        "/trace_attributes",
        {"shape": pts, "costing": "auto", "shape_match": "map_snap",
         "filters": {"attributes": ["edge.way_id"], "action": "include"}},
        None,
    )
    return {e["way_id"]: closure_ways[e["way_id"]] for e in ta["edges"] if e["way_id"] in closure_ways}


def main() -> int:
    try:
        info = valhalla.status()
    except Exception as exc:  # noqa: BLE001 - a spike; report anything
        print(f"Valhalla not reachable: {exc}")
        return 1
    print(f"Valhalla {info.get('version')} up; tileset last modified {info.get('tileset_last_modified')}")
    ctx = spike_routes()
    spike_waypoint_in_box(ctx["center"], ctx["ring"])
    spike_seasonal()

    heading("5c. Request speed (five repeats, Denver -> Durango)")
    times = []
    for _ in range(5):
        _, secs = timed_route([DENVER, DURANGO])
        times.append(secs)
    print("  seconds: " + ", ".join(f"{t:.2f}" for t in times))
    return 0


if __name__ == "__main__":
    sys.exit(main())
