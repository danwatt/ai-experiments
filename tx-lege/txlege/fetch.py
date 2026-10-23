"""HTTP fetching with an on-disk cache so re-runs don't hammer the state servers."""

from __future__ import annotations

import hashlib
import re
import sys
import time
from pathlib import Path

import requests

USER_AGENT = "tx-lege/0.1 (legislative history research script)"


class FetchError(RuntimeError):
    pass


class Fetcher:
    def __init__(self, cache_dir: Path, refresh: bool = False, delay: float = 0.4, verbose: bool = True):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.refresh = refresh
        self.delay = delay
        self.verbose = verbose
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last = 0.0

    def _path(self, url: str) -> Path:
        digest = hashlib.sha1(url.encode()).hexdigest()[:12]
        tail = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("//", 1)[-1])[-80:]
        return self.cache_dir / f"{digest}_{tail}"

    def get(self, url: str, optional: bool = False) -> str | None:
        path = self._path(url)
        if path.exists() and not self.refresh:
            return path.read_bytes().decode("utf-8", errors="replace")

        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        try:
            resp = self.session.get(url, timeout=60)
        except requests.RequestException as exc:
            if optional:
                return None
            raise FetchError(f"{url}: {exc}") from exc
        finally:
            self._last = time.monotonic()

        if resp.status_code != 200:
            if optional:
                return None
            raise FetchError(f"{url}: HTTP {resp.status_code}")
        path.write_bytes(resp.content)
        return resp.content.decode("utf-8", errors="replace")
