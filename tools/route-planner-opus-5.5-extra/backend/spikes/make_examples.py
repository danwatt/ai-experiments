"""Write the committed example trips and the starting zone library to ./examples.

    docker compose run --rm -v "$PWD/examples:/out" api python spikes/make_examples.py /out

The files are plain JSON and are checked in; this script only exists so they
can be regenerated if a field changes. Run it, then look at the diff.
"""

import sys
from pathlib import Path

from app import trips

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/examples")


def box(west, south, east, north):
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


ZONES = [
    {"id": "boulder-downtown", "name": "Boulder downtown", "type": "avoid", "shape": "rectangle", "ring": box(-105.295, 40.005, -105.255, 40.03)},
    {"id": "denver-metro", "name": "Denver metro", "type": "no_stops", "shape": "rectangle", "ring": box(-105.15, 39.55, -104.75, 39.92)},
    {"id": "montrose", "name": "Montrose", "type": "no_meals", "shape": "rectangle", "ring": box(-107.93, 38.44, -107.83, 38.52)},
    {"id": "glenwood-springs", "name": "Glenwood Springs", "type": "prefer", "shape": "rectangle", "ring": box(-107.38, 39.5, -107.28, 39.58)},
    {"id": "aspen", "name": "Aspen", "type": "no_overnight", "shape": "rectangle", "ring": box(-106.9, 39.15, -106.75, 39.23)},
    {"id": "glenwood-canyon", "name": "I-70 Glenwood Canyon", "type": "avoid", "shape": "rectangle", "ring": box(-107.32, 39.55, -107.0, 39.62)},
    {"id": "dfw-core", "name": "DFW core", "type": "no_overnight", "shape": "polygon", "ring": [[-97.1, 32.6], [-96.6, 32.6], [-96.55, 33.0], [-96.95, 33.1], [-97.2, 32.9], [-97.1, 32.6]]},
]


def wp(id, name, lat, lon, type="stop", minutes=30, nights=1):
    return {"id": id, "name": name, "lat": lat, "lon": lon, "type": type, "minutes": minutes, "nights": nights}


LOOP = {
    "name": "Colorado loop",
    "depart": "2027-09-25T08:00",
    "waypoints": [
        wp("loop-a", "Denver, CO", 39.7392, -104.9903),
        wp("loop-b", "Trail Ridge Road", 40.4413, -105.7546, "through"),
        wp("loop-c", "Ouray", 38.0228, -107.6714, "through"),
        wp("loop-d", "Durango, CO", 37.2753, -107.8801, "overnight", nights=2),
        wp("loop-e", "Great Sand Dunes National Park", 37.7326, -105.5122, "stop", minutes=180),
        wp("loop-f", "Denver, CO", 39.7392, -104.9903),
    ],
    "library_on": ["boulder-downtown", "denver-metro", "montrose", "glenwood-springs"],
}
DURANGO = {
    "name": "Denver to Durango",
    "depart": "2027-09-24T08:00",
    "waypoints": [wp("dd-a", "Denver, CO", 39.7392, -104.9903), wp("dd-b", "Durango, CO", 37.2753, -107.8801)],
}

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    trips.write_json(OUT / "zones.json", {"version": 1, "zones": ZONES})
    for slug, doc in (("colorado-loop", LOOP), ("denver-to-durango", DURANGO)):
        out = trips.parse(doc).model_dump(mode="json")
        out["saved_at"] = None
        trips.write_json(OUT / f"{slug}.json", out)
    print("wrote", sorted(p.name for p in OUT.iterdir()))
