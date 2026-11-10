"""What map data the app is running on, for the settings page's "Map data" card.

Read-only. The api container has no way to rebuild anything (it does not get
the Docker socket), so the card names the `make` commands to run on the host.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

import osmium

VALHALLA_DIR = Path(os.environ.get("VALHALLA_DATA", "/data/valhalla"))

COMMANDS = [
    {"command": "make import", "does": "rebuild the places database (rest areas, exits, fuel, food, lodging, towns) from the OSM file already downloaded; about 15 s"},
    {"command": "make rebuild-tiles", "does": "rebuild Valhalla's routing tiles from the OSM file already downloaded; 1 to 2 minutes, routing is down meanwhile"},
    {"command": "make clean-data", "does": "delete ./data, to start over with a fresh download (asks first; trips are kept)"},
]


def osm_file() -> Path | None:
    files = sorted(VALHALLA_DIR.glob("*.osm.pbf")) if VALHALLA_DIR.is_dir() else []
    return files[0] if files else None


def osm_date(path: Path) -> str | None:
    """The date of the OpenStreetMap data in a PBF: the replication timestamp in its header, else the file's own date."""
    try:
        stamp = osmium.io.Reader(str(path)).header().get("osmosis_replication_timestamp")
        if stamp:
            return stamp[:10]
    except Exception:  # an odd file just falls back to its modification time
        pass
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d")


def info() -> dict:
    """{region, osm_date, pbf_mb, tiles_mb, commands}; missing pieces are None."""
    pbf = osm_file()
    tiles = VALHALLA_DIR / "valhalla_tiles.tar"
    return {
        "region": pbf.name.replace("-latest.osm.pbf", "").replace(".osm.pbf", "").replace("-", " ").title() if pbf else None,
        "file": pbf.name if pbf else None,
        "osm_date": osm_date(pbf) if pbf else None,
        "pbf_mb": round(pbf.stat().st_size / 1e6) if pbf else None,
        "tiles_mb": round(tiles.stat().st_size / 1e6) if tiles.exists() else None,
        "commands": COMMANDS,
    }
