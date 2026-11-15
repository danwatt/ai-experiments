#!/usr/bin/env python3
"""Refresh the BLS data embedded in index.html.

Fetches the six BLS series the page uses (public API v1, no key needed),
rewrites the `const DATA = {...};` line and `META.retrieved` in index.html,
and prints a summary of what changed.

    python3 update-data.py            # fetch + rewrite index.html
    python3 update-data.py --dry-run  # fetch + report, don't write

API v1 limits: 25 requests/day, 10 years per request, 25 series per request.
We need ~5 requests per run. Set BLS_API_KEY to use API v2 (higher limits).
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HTML = Path(__file__).resolve().parent / "index.html"
START_YEAR = 1978
# key in DATA.series -> BLS series id
SERIES = {
    "gas": "APUS37A74714",         # DFW regular gasoline, $/gal (monthly avg)
    "cpiUS": "CUUR0000SA0",        # US city average CPI-U, NSA
    "cpiDFW": "CUURS37ASA0",       # DFW CPI-U, NSA (bimonthly)
    "wageProd": "CES0500000008",   # US avg hourly earnings, production & nonsupervisory
    "wageAll": "CES0500000003",    # US avg hourly earnings, all private employees
    "wageDFW": "SMU48191000500000003",  # DFW avg hourly earnings, all private employees
}
DATA_RE = re.compile(r"^const DATA = \{.*\};$", re.M)
META_RE = re.compile(r"(const META = \{ retrieved: ')[^']*(' \};)")


def post(body):
    key = os.environ.get("BLS_API_KEY")
    version = "v2" if key else "v1"
    if key:
        body = dict(body, registrationkey=key)
    req = urllib.request.Request(
        f"https://api.bls.gov/publicAPI/{version}/timeseries/data/",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    if out.get("status") != "REQUEST_SUCCEEDED":
        sys.exit(f"BLS request failed: {out.get('status')} {out.get('message')}")
    return out


def fetch():
    this_year = datetime.date.today().year
    series = {k: {} for k in SERIES}
    prelim = {k: [] for k in SERIES}
    by_id = {v: k for k, v in SERIES.items()}
    for y0 in range(START_YEAR, this_year + 1, 10):
        y1 = min(y0 + 9, this_year)
        print(f"  fetching {y0}-{y1} ...", file=sys.stderr)
        out = post({"seriesid": list(SERIES.values()),
                    "startyear": str(y0), "endyear": str(y1)})
        for msg in out.get("message", []):
            # series that start later than START_YEAR are expected; hide that noise
            if not msg.startswith("No Data Available"):
                print(f"  BLS: {msg}", file=sys.stderr)
        for s in out["Results"]["series"]:
            k = by_id[s["seriesID"]]
            for d in s["data"]:
                m = re.fullmatch(r"M(\d\d)", d["period"])
                if not m or m.group(1) == "13":  # skip annual averages / non-monthly
                    continue
                try:
                    v = float(d["value"])
                except ValueError:  # "-" = not available
                    continue
                ym = f"{d['year']}-{m.group(1)}"
                series[k][ym] = v
                if any(f.get("code") == "P" for f in d.get("footnotes", [])):
                    prelim[k].append(ym)
    for k in SERIES:
        if not series[k]:
            sys.exit(f"No data returned for {k} ({SERIES[k]}); aborting.")
        series[k] = dict(sorted(series[k].items()))
        prelim[k].sort()
    return {"series": series, "prelim": prelim}


def summarize(old, new):
    for k in SERIES:
        o, n = old["series"].get(k, {}), new["series"][k]
        added = sorted(set(n) - set(o))
        removed = sorted(set(o) - set(n))
        revised = sorted(m for m in set(o) & set(n) if o[m] != n[m])
        last = max(n)
        print(f"{k:9} {len(n):4} pts, latest {last} = {n[last]}"
              f" | +{len(added)} new{' (' + ', '.join(added) + ')' if added else ''}"
              f", {len(revised)} revised{' (' + ', '.join(revised[:6]) + ('…' if len(revised) > 6 else '') + ')' if revised else ''}"
              f", {len(removed)} dropped")
        if old["prelim"].get(k) != new["prelim"][k]:
            print(f"          prelim: {old['prelim'].get(k)} -> {new['prelim'][k]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="report only, don't write index.html")
    args = ap.parse_args()

    html = HTML.read_text()
    m = DATA_RE.search(html)
    if not m or not META_RE.search(html):
        sys.exit("Could not find `const DATA = ...;` / `const META` in index.html")
    old = json.loads(m.group(0)[len("const DATA = "):-1])

    new = fetch()
    summarize(old, new)
    if new == old:
        print("No changes.")
        return
    if args.dry_run:
        print("Dry run: index.html not modified.")
        return

    blob = "const DATA = " + json.dumps(new, separators=(",", ":")) + ";"
    html = DATA_RE.sub(lambda _: blob, html, count=1)
    today = datetime.date.today().isoformat()
    html = META_RE.sub(lambda mm: mm.group(1) + today + mm.group(2), html, count=1)
    HTML.write_text(html)
    print(f"Updated {HTML.name} (retrieved {today}).")


if __name__ == "__main__":
    main()
