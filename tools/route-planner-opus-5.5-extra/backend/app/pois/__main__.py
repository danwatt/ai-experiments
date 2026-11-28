"""`python -m app.pois`: build the stop-data database from the OSM file.

    POIS_PBF   the OSM file (default: the first .osm.pbf in /data/valhalla)
    POIS_DB    where to write (default /data/pois.sqlite)
"""

import os
import sys
import time
from pathlib import Path

from . import db
from .clusters import build_clusters, dedupe_places
from .extract import extract


def main() -> int:
    pbf = os.environ.get("POIS_PBF")
    if not pbf:
        found = sorted(Path("/data/valhalla").glob("*.osm.pbf"))
        if not found:
            print("No .osm.pbf in /data/valhalla. Start valhalla first (make up): it downloads the file.", file=sys.stderr)
            return 1
        pbf = str(found[0])
    print(f"reading {pbf}")
    t0 = time.perf_counter()
    result = extract(pbf)
    t1 = time.perf_counter()
    print(f"  {len(result.pois)} pois and {len(result.seasonal_ways)} seasonal ways in {t1 - t0:.0f} s")
    result.pois = dedupe_places(result.pois)
    clusters = build_clusters(result.pois)
    t2 = time.perf_counter()
    print(f"  {len(clusters)} clusters in {t2 - t1:.1f} s")
    counts = db.write_all(db.DB_PATH, result, clusters, source=Path(pbf).name)
    print(f"wrote {db.DB_PATH} in {time.perf_counter() - t2:.1f} s")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
