"""Speed calibration: Valhalla's drive times against real-world times.

Run with `make calibrate` (inside the api container).

    python spikes/calibration.py                 # print the table
    python spikes/calibration.py --save-baseline # also store the times as "before"

The reference times are door-to-door estimates from route sites and visitor
bureaus (sources below), not measured drives. They disagree with each other by
10-20 %, so "within about 10 %" is as close as this check can honestly get.
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from app import speeds, valhalla
from app.valhalla import Point

BASELINE = Path(__file__).with_name("calibration_baseline.json")

# Town centres. Saguache is only a through point that keeps the Durango drive
# on US-285.
PLACES = {
    "Denver": (39.7392, -104.9903),
    "Durango": (37.2753, -107.8801),
    "Saguache": (38.0875, -106.1420),
    "Grand Junction": (39.0639, -108.5506),
    "Estes Park": (40.3772, -105.5217),
    "Glenwood Springs": (39.5505, -107.3248),
    "Ouray": (38.0228, -107.6714),
    "Alamosa": (37.4695, -105.8700),
    "Salida": (38.5347, -105.9989),
    "Pagosa Springs": (37.2695, -107.0098),
    "Gunnison": (38.5458, -106.9253),
    "Colorado Springs": (38.8339, -104.8214),
}


@dataclass
class Drive:
    name: str
    stops: list[str]  # place names; "~Name" is a through point
    miles: float  # reference distance
    minutes: int  # reference driving time
    source: str


REFERENCE = [
    Drive("Denver > Durango via US-285", ["Denver", "~Saguache", "Durango"], 338, 375,
          "Google Maps about 6:00 (planning-session estimate, not checked); durango.org 'six and a half hour drive'"),
    Drive("Denver > Grand Junction (I-70)", ["Denver", "Grand Junction"], 244, 240,
          "AAA TripCanvas 246.6 mi 4:11; Google Maps about 3:50"),
    Drive("Denver > Estes Park", ["Denver", "Estes Park"], 65, 90,
          "Google Maps 64 mi 1:30 (nationalparkstraveler.org); AAA 68.6 mi 1:43"),
    Drive("Glenwood Springs > Ouray", ["Glenwood Springs", "Ouray"], 185, 210,
          "visitouray.com: 185 mi, 3.5 h"),
    Drive("Ouray > Durango (US-550)", ["Ouray", "Durango"], 70, 120,
          "visitouray.com: 70 mi, 2 h; Fodor's forum 1.5-2 h"),
    Drive("Alamosa > Salida", ["Alamosa", "Salida"], 82, 92,
          "1map route site: 82.2 mi, 1:32"),
    Drive("Durango > Pagosa Springs", ["Durango", "Pagosa Springs"], 60, 71,
          "1map route site: 60.4 mi, 1:11; MapQuest 61 mi (pagosa.com)"),
    Drive("Salida > Gunnison (Monarch Pass)", ["Salida", "Gunnison"], 65, 75,
          "coloradotopia.com 1:15; wanderlog 65.3 mi 1:41"),
    Drive("Denver > Colorado Springs (I-25)", ["Denver", "Colorado Springs"], 70, 68,
          "route sites: 70 mi, 60-75 min without traffic"),
]


def points(drive: Drive) -> list[Point]:
    out = []
    for stop in drive.stops:
        through = stop.startswith("~")
        lat, lon = PLACES[stop.lstrip("~")]
        out.append(Point(lat, lon, "through" if through else "break"))
    return out


def hm(minutes: float) -> str:
    m = round(minutes)
    return f"{m // 60}:{m % 60:02d}"


def pct(value: float, ref: float) -> str:
    return f"{100 * (value / ref - 1):+.0f}%"


def measure(drive: Drive) -> dict:
    """Route one reference drive. Returns miles, Valhalla's minutes and ours."""
    result = valhalla.route(points(drive))
    trip = result["trip"]
    corrected = speeds.corrected_trip_seconds(trip)
    return {
        "miles": trip["summary"]["length"],
        "valhalla_min": trip["summary"]["time"] / 60,
        "corrected_min": corrected / 60,
    }


def main() -> None:
    save = "--save-baseline" in sys.argv
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() and not save else {}
    pace = speeds.DEFAULT_PACE

    print(f"Pace multiplier on top of the correction: {pace}")
    print()
    head = f"{'drive':34} {'reference':>12}  {'before':>12}  {'valhalla now':>18}  {'planner':>11}  {'x pace':>11}"
    print(head)
    print("-" * len(head))
    rows, within = {}, 0
    for d in REFERENCE:
        m = measure(d)
        rows[d.name] = m["valhalla_min"]
        before = baseline.get(d.name)
        before_s = f"{hm(before):>5} {pct(before, d.minutes):>5}" if before else f"{'-':>11}"
        paced = m["corrected_min"] * pace
        within += abs(paced / d.minutes - 1) <= 0.10
        print(
            f"{d.name:34} {d.miles:4.0f} mi {hm(d.minutes):>5}  {before_s:>12}  "
            f"{m['miles']:4.0f} mi {hm(m['valhalla_min']):>5} {pct(m['valhalla_min'], d.minutes):>5}  "
            f"{hm(m['corrected_min']):>5} {pct(m['corrected_min'], d.minutes):>5}  "
            f"{hm(paced):>5} {pct(paced, d.minutes):>5}"
        )
    print()
    print(f"{within} of {len(REFERENCE)} within 10 % after the planner correction and pace.")
    print()
    print("Sources:")
    for d in REFERENCE:
        print(f"  {d.name}: {d.source}")

    if save:
        BASELINE.write_text(json.dumps(rows, indent=2) + "\n")
        print(f"\nSaved Valhalla's times as the baseline in {BASELINE.name}")


if __name__ == "__main__":
    main()
