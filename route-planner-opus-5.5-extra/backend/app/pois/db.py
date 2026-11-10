"""The stop-data database: one SQLite file, written by the importer, read by the API.

Tables:

    pois           every kept thing: rest areas, exits, fuel, food, lodging, places
    clusters       what the planner works with (see clusters.py), counts included
    poi_rtree      R*Tree over pois      (min_lat, max_lat, min_lon, max_lon)
    cluster_rtree  R*Tree over clusters
    seasonal_ways  roads with seasonal / conditional access tags, by OSM way id
    search_items   things you can search for by name, and search_fts (FTS5) over them
    meta           when and from what the file was built, with counts

Readers use `connect()`; the importer uses `write_all()`.
"""

import json
import os
import sqlite3
import time
from pathlib import Path

from .clusters import Cluster
from .extract import Extract, Poi

DB_PATH = Path(os.environ.get("POIS_DB", "/data/pois.sqlite"))

SCHEMA = """
CREATE TABLE pois (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL, subkind TEXT NOT NULL, name TEXT NOT NULL,
    brand TEXT NOT NULL, cuisine TEXT NOT NULL,
    lat REAL NOT NULL, lon REAL NOT NULL,
    osm_type TEXT NOT NULL, osm_id INTEGER NOT NULL,
    ref TEXT NOT NULL, road TEXT NOT NULL,
    toilets INTEGER, picnic INTEGER, population INTEGER,
    cluster_id INTEGER
);
CREATE INDEX pois_kind ON pois(kind);
CREATE INDEX pois_cluster ON pois(cluster_id);
CREATE VIRTUAL TABLE poi_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);

CREATE TABLE clusters (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL, name TEXT NOT NULL, near TEXT NOT NULL,
    lat REAL NOT NULL, lon REAL NOT NULL,
    ref TEXT NOT NULL, road TEXT NOT NULL, population INTEGER,
    toilets INTEGER, picnic INTEGER,
    food INTEGER NOT NULL, food_fast INTEGER NOT NULL, food_sitdown INTEGER NOT NULL, food_cafe INTEGER NOT NULL,
    fuel INTEGER NOT NULL, lodging INTEGER NOT NULL,
    detail TEXT NOT NULL
);
CREATE VIRTUAL TABLE cluster_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);

CREATE TABLE seasonal_ways (
    way_id INTEGER PRIMARY KEY,
    highway TEXT NOT NULL, name TEXT NOT NULL, ref TEXT NOT NULL, tags TEXT NOT NULL,
    lat REAL NOT NULL, lon REAL NOT NULL
);

CREATE TABLE search_items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,        -- city, town, village, hamlet, rest_area, service_plaza, exit, other
    name TEXT NOT NULL, detail TEXT NOT NULL,
    lat REAL NOT NULL, lon REAL NOT NULL, population INTEGER
);
CREATE VIRTUAL TABLE search_fts USING fts5(name, content='search_items', content_rowid='id', tokenize='unicode61 remove_diacritics 2');

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# Lower comes first in search results: towns before everything else.
SEARCH_RANK = {"city": 0, "town": 1, "village": 2, "hamlet": 3, "service_plaza": 4, "rest_area": 4, "exit": 5, "other": 6}


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open the database read-only. Raises FileNotFoundError if `make import` has not run."""
    path = Path(path or DB_PATH)
    if not path.exists():
        raise FileNotFoundError(f"{path} does not exist; run `make import` first")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


_shared: tuple[float, sqlite3.Connection] | None = None


def shared() -> sqlite3.Connection:
    """One read-only connection for the API, reopened when `make import` replaces the file."""
    global _shared
    mtime = DB_PATH.stat().st_mtime if DB_PATH.exists() else -1
    if _shared is None or _shared[0] != mtime:
        _shared = (mtime, connect())
    return _shared[1]


def info(con: sqlite3.Connection) -> dict:
    """When the file was built, from what, and the row counts (for /api/status)."""
    meta = {k: v for k, v in con.execute("SELECT key, value FROM meta")}
    return {"built_at": meta.get("built_at"), "source": meta.get("source"), "counts": json.loads(meta.get("counts", "{}"))}


def flag(value: bool | None) -> int | None:
    return None if value is None else int(value)


def write_all(path: Path | str, extract: Extract, clusters: list[Cluster], source: str = "") -> dict:
    """Write a fresh database to `path` (replacing it) and return the counts.

    Written to a temporary name and moved into place, so a running API never
    sees a half-written file.
    """
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript(SCHEMA)

    # Which cluster each poi belongs to: members, and the anchor of its own cluster.
    cluster_ids: dict[int, int] = {}
    for cid, c in enumerate(clusters, start=1):
        con.execute(
            "INSERT INTO clusters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cid, c.kind, c.name, c.near, c.lat, c.lon, c.ref, c.road, c.population,
                flag(c.toilets), flag(c.picnic), c.food, c.food_fast, c.food_sitdown, c.food_cafe,
                c.fuel, c.lodging, json.dumps(c.detail, separators=(",", ":")),
            ),
        )
        con.execute("INSERT INTO cluster_rtree VALUES (?,?,?,?,?)", (cid, c.lat, c.lat, c.lon, c.lon))
        for m in c.members:
            cluster_ids[id(m)] = cid
        if c.anchor is not None:
            cluster_ids.setdefault(id(c.anchor), cid)

    for pid, p in enumerate(extract.pois, start=1):
        con.execute(
            "INSERT INTO pois VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                pid, p.kind, p.subkind, p.name, p.brand, p.cuisine, p.lat, p.lon, p.osm_type, p.osm_id,
                p.ref, p.road, flag(p.toilets), flag(p.picnic), p.population, cluster_ids.get(id(p)),
            ),
        )
        con.execute("INSERT INTO poi_rtree VALUES (?,?,?,?,?)", (pid, p.lat, p.lat, p.lon, p.lon))

    con.executemany(
        "INSERT INTO seasonal_ways VALUES (?,?,?,?,?,?,?)",
        [(w.way_id, w.highway, w.name, w.ref, w.tags, w.lat, w.lon) for w in extract.seasonal_ways],
    )
    write_search(con, extract.pois, clusters)

    counts = count_rows(con)
    con.executemany(
        "INSERT INTO meta VALUES (?,?)",
        [("source", source), ("built_at", time.strftime("%Y-%m-%d %H:%M:%S")), ("counts", json.dumps(counts))],
    )
    con.commit()
    con.close()
    tmp.replace(path)
    return counts


def write_search(con: sqlite3.Connection, pois: list[Poi], clusters: list[Cluster]) -> None:
    """Everything with a name worth searching for: places, rest areas, exits, loose groups."""
    rows = []
    for p in pois:
        if p.kind == "place" and p.name:
            pop = f" · pop. {p.population:,}" if p.population else ""
            rows.append((p.subkind, p.name, f"{p.subkind.title()}{pop}", p.lat, p.lon, p.population))
    for c in clusters:
        if c.kind == "town" or not c.name:
            continue  # towns are already there, as places
        if c.kind == "exit" and not c.ref:
            continue  # "Exit near Salt Creek" x 3 helps nobody
        if c.kind == "exit":
            where = f"Exit {c.ref}" if c.ref else "Exit"
            detail = f"{where} on {c.road}" if c.road else where
        else:
            detail = {"rest_area": "Rest area", "service_plaza": "Service plaza", "other": "Roadside stop"}[c.kind]
            if c.near and c.near != c.name:
                detail += f" near {c.near}"
        rows.append((c.kind, c.name, detail, c.lat, c.lon, None))
    for i, row in enumerate(rows, start=1):
        con.execute("INSERT INTO search_items VALUES (?,?,?,?,?,?,?)", (i, *row))
    con.execute("INSERT INTO search_fts(rowid, name) SELECT id, name FROM search_items")


def count_rows(con: sqlite3.Connection) -> dict:
    """Row counts for the notes and for /api/status."""
    one = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
    counts = {"pois": {k: n for k, n in con.execute("SELECT kind, COUNT(*) FROM pois GROUP BY kind ORDER BY 2 DESC")}}
    counts["places"] = {k: n for k, n in con.execute("SELECT subkind, COUNT(*) FROM pois WHERE kind='place' GROUP BY subkind")}
    counts["clusters"] = {k: n for k, n in con.execute("SELECT kind, COUNT(*) FROM clusters GROUP BY kind ORDER BY 2 DESC")}
    counts["clusters_with_amenities"] = one("SELECT COUNT(*) FROM clusters WHERE food + fuel + lodging > 0")
    counts["amenities_unclustered"] = one("SELECT COUNT(*) FROM pois WHERE kind IN ('fuel','food','lodging') AND cluster_id IS NULL")
    counts["seasonal_ways"] = one("SELECT COUNT(*) FROM seasonal_ways")
    counts["search_items"] = one("SELECT COUNT(*) FROM search_items")
    return counts


# ---------- queries ----------

CLUSTER_COLUMNS = (
    "c.id, c.kind, c.name, c.near, c.lat, c.lon, c.ref, c.road, c.population, c.toilets, c.picnic, "
    "c.food, c.food_fast, c.food_sitdown, c.food_cafe, c.fuel, c.lodging, c.detail"
)


def cluster_dict(row: sqlite3.Row) -> dict:
    """A cluster row as the API returns it."""
    d = dict(row)
    d["detail"] = json.loads(d["detail"])
    for key in ("toilets", "picnic"):
        d[key] = None if d[key] is None else bool(d[key])
    return d


def clusters_in_box(con: sqlite3.Connection, south: float, west: float, north: float, east: float) -> list[dict]:
    """Clusters whose position is inside the box, found with the R*Tree."""
    rows = con.execute(
        f"SELECT {CLUSTER_COLUMNS} FROM cluster_rtree r JOIN clusters c ON c.id = r.id "
        "WHERE r.min_lat >= ? AND r.max_lat <= ? AND r.min_lon >= ? AND r.max_lon <= ?",
        (south, north, west, east),
    ).fetchall()
    return [cluster_dict(r) for r in rows]


def cluster_members(con: sqlite3.Connection, cluster_id: int) -> list[Poi]:
    """The fuel, food and lodging rows attached to one cluster."""
    rows = con.execute(
        "SELECT kind, subkind, name, lat, lon, osm_type, osm_id, brand, cuisine, ref, road, toilets, picnic, population "
        "FROM pois WHERE cluster_id = ? AND kind IN ('fuel', 'food', 'lodging')",
        (cluster_id,),
    ).fetchall()
    return [Poi(**dict(r)) for r in rows]


def search(con: sqlite3.Connection, query: str, limit: int = 8) -> list[dict]:
    """Name search: words typed so far, the last one as a prefix. Towns first.

    Order: place size class (city, town, village, hamlet, then rest areas,
    exits), then FTS5's relevance, then population.
    """
    words = [w for w in "".join(ch if ch.isalnum() else " " for ch in query).split() if w]
    if not words:
        return []
    match = " ".join([f'"{w}"' for w in words[:-1]] + [f'"{words[-1]}"*'])
    rank_case = "CASE s.kind " + " ".join(f"WHEN '{k}' THEN {v}" for k, v in SEARCH_RANK.items()) + " ELSE 9 END"
    rows = con.execute(
        f"SELECT s.kind, s.name, s.detail, s.lat, s.lon, s.population FROM search_fts f JOIN search_items s ON s.id = f.rowid "
        f"WHERE search_fts MATCH ? ORDER BY {rank_case}, bm25(search_fts), COALESCE(s.population, 0) DESC LIMIT ?",
        (match, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def seasonal_by_ids(con: sqlite3.Connection, way_ids: list[int]) -> list[dict]:
    """The seasonal-way rows among these OSM way ids."""
    out = []
    for i in range(0, len(way_ids), 500):  # SQLite caps the number of ? in one query
        chunk = way_ids[i : i + 500]
        marks = ",".join("?" * len(chunk))
        out += [dict(r) for r in con.execute(f"SELECT * FROM seasonal_ways WHERE way_id IN ({marks})", chunk)]
    return out


def lodging_brands(con: sqlite3.Connection, limit: int = 40) -> dict:
    """The commonest lodging brands (OSM `brand`, else `operator`) and how patchy the tag is:
    {brands: [{brand, count}], lodging, branded, share}. For the settings page's brand picker."""
    total = con.execute("SELECT COUNT(*) FROM pois WHERE kind = 'lodging'").fetchone()[0]
    rows = con.execute(
        "SELECT brand, COUNT(*) FROM pois WHERE kind = 'lodging' AND brand != '' GROUP BY brand ORDER BY 2 DESC, 1 LIMIT ?", (limit,)
    ).fetchall()
    branded = con.execute("SELECT COUNT(*) FROM pois WHERE kind = 'lodging' AND brand != ''").fetchone()[0]
    return {"brands": [{"brand": b, "count": n} for b, n in rows], "lodging": total, "branded": branded, "share": round(branded / total, 3) if total else 0}
