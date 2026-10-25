#!/usr/bin/env python3
"""Record a traffic sample for Overhead's demo mode (static hosting, no backend).

    python3 overhead/tools/record_demo.py --minutes 20

Polls the provider directly, then adds route lookups, nearby airports and a
heatmap built from the recording, and writes overhead/demo/traffic.json.

Published data is trimmed for privacy: aircraft flagged for limited display
(LADD) or using privacy addresses (PIA) are dropped, and owner names are not
stored.
"""

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import airports  # noqa: E402
import server  # noqa: E402  (reuses provider normalisation and route lookup)
from heat import GRID  # noqa: E402

STATIC = ("flight", "reg", "type", "desc", "year", "cat", "mil", "src", "squawk", "navAlt", "emergency")
AIRLINE = re.compile(r"^[A-Z]{3}\d")


def record(provider, lat, lon, radius, minutes, interval):
    tracks, start, end = {}, None, None
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        t0 = time.time()
        try:
            now, aircraft = server.upstream(provider, round(lat, 2), round(lon, 2), radius)
        except Exception as e:
            print(f"poll failed: {e}", file=sys.stderr)
            time.sleep(interval)
            continue
        start = start or now
        end = now
        for a in aircraft:
            if a.get("limited"):
                continue
            tr = tracks.setdefault(a["hex"], {"hex": a["hex"], "s": []})
            tr.update({k: a.get(k) for k in STATIC})
            t = round(a["posTime"] - start, 1)
            if tr["s"] and t <= tr["s"][-1][0]:
                continue  # same fix as last poll
            tr["s"].append([t, round(a["lat"], 5), round(a["lon"], 5), a.get("alt"), a.get("gs"),
                            round(a["track"], 1) if a.get("track") is not None else None,
                            a.get("vrate"), 1 if a.get("ground") else 0])
        left = int(deadline - time.time())
        print(f"\r{len(aircraft):3d} aircraft · {len(tracks):4d} tracked · {left // 60:2d}:{left % 60:02d} left",
              end="", flush=True)
        time.sleep(max(0.0, interval - (time.time() - t0)))
    print()
    return start, end, [t for t in tracks.values() if len(t["s"]) > 1]


def heat_bins(tracks):
    cells = {}
    for tr in tracks:
        for s in tr["s"]:
            key = (round(s[1] / GRID), round(s[2] / GRID))
            cells[key] = cells.get(key, 0) + 1
    return [[round(gx * GRID, 5), round(gy * GRID, 5), n] for (gy, gx), n in cells.items()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", default="adsbfi", choices=sorted(server.PROVIDERS))
    ap.add_argument("--lat", type=float, default=32.90)
    ap.add_argument("--lon", type=float, default=-97.04)
    ap.add_argument("--radius", type=int, default=40, help="nautical miles")
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--interval", type=float, default=3, help="seconds between polls")
    ap.add_argument("--name", default="Dallas–Fort Worth", help="place name shown in the app")
    ap.add_argument("--out", default=os.path.join(ROOT, "demo", "traffic.json"))
    args = ap.parse_args()

    start, end, tracks = record(args.provider, args.lat, args.lon, args.radius, args.minutes, args.interval)
    if not tracks:
        sys.exit("nothing recorded")

    callsigns = sorted({t["flight"] for t in tracks if t.get("flight") and AIRLINE.match(t["flight"])})
    print(f"looking up {len(callsigns)} routes…")
    with ThreadPoolExecutor(8) as pool:
        routes = dict(zip(callsigns, pool.map(server.lookup_route, callsigns)))
    print("airports…")
    near = airports.near(args.lat, args.lon, args.radius, server.UA)

    cfg = server.PROVIDERS[args.provider]
    doc = {
        "meta": {
            "name": args.name, "lat": args.lat, "lon": args.lon, "radius": args.radius,
            "provider": cfg["name"], "providerUrl": cfg["url"], "license": cfg["license"],
            "recorded": datetime.fromtimestamp(start, timezone.utc).isoformat(timespec="seconds"),
            "start": start, "duration": round(end - start, 1), "interval": args.interval,
        },
        # sample: [t since start (s), lat, lon, alt ft, gs kt, track °, vrate fpm, on ground]
        "aircraft": tracks,
        "routes": {k: v for k, v in routes.items() if v.get("status") == "ok"},
        "airports": near,
        "heat": heat_bins(tracks),
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {args.out}: {len(tracks)} aircraft, {sum(len(t['s']) for t in tracks)} samples, "
          f"{os.path.getsize(args.out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
