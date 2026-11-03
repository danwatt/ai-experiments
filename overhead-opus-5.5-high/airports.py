"""Airports and runways from OurAirports (public domain), cached under data/.

https://ourairports.com/data/ — refreshed when the local copy is over 30 days old.
"""

import csv
import math
import os
import shutil
import threading
import time
import urllib.request

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
BASE = "https://davidmegginson.github.io/ourairports-data/"
MAX_AGE = 30 * 86400
KEEP_TYPES = {"large_airport", "medium_airport", "small_airport"}

_lock = threading.Lock()
_airports = None


def _fetch(name, ua):
    path = os.path.join(DATA_DIR, name)
    fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < MAX_AGE
    if not fresh:
        os.makedirs(DATA_DIR, exist_ok=True)
        try:
            req = urllib.request.Request(BASE + name, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=90) as r, open(path + ".tmp", "wb") as f:
                shutil.copyfileobj(r, f)
            os.replace(path + ".tmp", path)
        except Exception:
            if not os.path.exists(path):
                raise  # no stale copy to fall back on
    return path


def _num(v, cast=float):
    try:
        return cast(v) if v not in ("", None) else None
    except ValueError:
        return None


def _bearing(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _load(ua):
    airports = {}
    with open(_fetch("airports.csv", ua), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["type"] not in KEEP_TYPES:
                continue
            lat, lon = _num(r["latitude_deg"]), _num(r["longitude_deg"])
            if lat is None or lon is None:
                continue
            airports[r["id"]] = {
                "ident": r["ident"], "size": r["type"].split("_")[0], "name": r["name"],
                "city": r["municipality"] or None, "lat": lat, "lon": lon,
                "elevFt": _num(r["elevation_ft"], int), "iata": r["iata_code"] or None,
                "icao": r["icao_code"] or r["gps_code"] or None,
                "scheduled": r["scheduled_service"] == "yes", "runways": [],
            }
    with open(_fetch("runways.csv", ua), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            ap = airports.get(r["airport_ref"])
            if not ap or r["closed"] == "1":
                continue
            ends = []
            for p in ("le", "he"):
                lat, lon = _num(r[f"{p}_latitude_deg"]), _num(r[f"{p}_longitude_deg"])
                ends.append({"ident": r[f"{p}_ident"], "lat": lat, "lon": lon,
                             "elevFt": _num(r[f"{p}_elevation_ft"], int) or ap["elevFt"],
                             "hdg": _num(r[f"{p}_heading_degT"]),
                             "dispFt": _num(r[f"{p}_displaced_threshold_ft"], int) or 0})
            le, he = ends
            if None in (le["lat"], le["lon"], he["lat"], he["lon"]):
                continue  # small strips often lack surveyed ends; nothing to draw
            if le["hdg"] is None:
                le["hdg"] = _bearing(le["lat"], le["lon"], he["lat"], he["lon"])
            if he["hdg"] is None:
                he["hdg"] = _bearing(he["lat"], he["lon"], le["lat"], le["lon"])
            ap["runways"].append({"le": le, "he": he, "lengthFt": _num(r["length_ft"], int),
                                  "widthFt": _num(r["width_ft"], int), "surface": r["surface"] or None,
                                  "lighted": r["lighted"] == "1"})
    return list(airports.values())


def near(lat, lon, radius_nm, ua):
    """Airports within radius (plus a margin so approaches from outside show)."""
    global _airports
    with _lock:
        if _airports is None:
            _airports = _load(ua)
    r = radius_nm * 1.25 / 60.0
    rl = r / max(0.2, math.cos(math.radians(lat)))
    out = []
    for a in _airports:
        if abs(a["lat"] - lat) > r or abs(a["lon"] - lon) > rl:
            continue
        # small fields only matter if they have runways we can draw
        if a["size"] == "small" and not a["runways"]:
            continue
        out.append(a)
    return out
