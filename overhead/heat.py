"""Traffic density history in SQLite (data/heat.sqlite).

Every fresh position the proxy receives is counted into a ~500 m grid cell,
split by altitude band and 10-minute slot, so approach corridors and holding
areas build up over hours and days of running.
"""

import math
import os
import sqlite3
import threading
import time

GRID = 0.005           # degrees (~550 m north-south)
SLOT = 600             # seconds per time bucket
BANDS = ("ground", "low", "mid", "high", "cruise")  # ground, <3k, 3–10k, 10–20k, >20k ft


def band_of(a):
    if a.get("ground"):
        return 0
    alt = a.get("alt") or 0
    return 1 if alt < 3000 else 2 if alt < 10000 else 3 if alt < 20000 else 4


class Heat:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS heat (
            gy INTEGER, gx INTEGER, band INTEGER, slot INTEGER, n INTEGER,
            PRIMARY KEY (gy, gx, band, slot)) WITHOUT ROWID""")
        self.lock = threading.Lock()
        self.last = {}  # hex -> posTime already counted

    def record(self, aircraft):
        slot = int(time.time() // SLOT)
        rows = []
        for a in aircraft:
            t = a.get("posTime")
            if self.last.get(a["hex"]) == t:
                continue  # same fix served again (cache / overlapping areas)
            self.last[a["hex"]] = t
            rows.append((round(a["lat"] / GRID), round(a["lon"] / GRID), band_of(a), slot))
        if len(self.last) > 50000:
            self.last.clear()
        if not rows:
            return
        with self.lock:
            self.db.executemany(
                "INSERT INTO heat VALUES (?, ?, ?, ?, 1) ON CONFLICT (gy, gx, band, slot) DO UPDATE SET n = n + 1",
                rows)
            self.db.commit()

    def query(self, lat, lon, radius_nm, hours, bands):
        r = radius_nm * 1.15 / 60.0
        rl = r / max(0.2, math.cos(math.radians(lat)))
        since = int(time.time() // SLOT) - int(hours * 3600 / SLOT) if hours else 0
        marks = ",".join("?" * len(bands)) or "-1"
        with self.lock:
            rows = self.db.execute(
                f"""SELECT gy, gx, SUM(n) FROM heat
                    WHERE gy BETWEEN ? AND ? AND gx BETWEEN ? AND ? AND slot >= ? AND band IN ({marks})
                    GROUP BY gy, gx""",
                (round((lat - r) / GRID), round((lat + r) / GRID), round((lon - rl) / GRID),
                 round((lon + rl) / GRID), since, *bands)).fetchall()
            first = self.db.execute("SELECT MIN(slot) FROM heat").fetchone()[0]
        return {
            "cell": GRID,
            "bins": [[round(gx * GRID, 5), round(gy * GRID, 5), n] for gy, gx, n in rows],
            "recordingSince": first * SLOT if first else None,
        }
