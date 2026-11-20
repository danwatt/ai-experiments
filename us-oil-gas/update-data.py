#!/usr/bin/env python3
"""Fetch monthly US oil and gas data from the EIA API v2 and write data.js.

    EIA_API_KEY=... python3 update-data.py

Series pulled (all monthly):
  - crude oil field production by state + federal offshore (petroleum/crd/crpdn), 1920+ US, 1981+ states
  - natural gas marketed production by state (natural-gas/prod/sum, process VGM)
  - crude / total petroleum exports and imports (petroleum/move/exp, imp)
  - crude and product exports by destination country (petroleum/move/expc), grouped into regions
  - LNG and pipeline gas exports by destination country (natural-gas/move/expc), grouped into regions
  - shale region oil, gas and active rigs from STEO (history only, forecast months dropped)
  - WTI spot (RWTC) and Henry Hub spot (RNGWHHD)
"""
import calendar
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / "data.js"
API = "https://api.eia.gov/v2/"
KEY = os.environ.get("EIA_API_KEY") or sys.exit("Set EIA_API_KEY (free key: https://www.eia.gov/opendata/)")

STATES = {
    "AK", "AL", "AR", "AZ", "CA", "CO", "FL", "ID", "IL", "IN", "KS", "KY", "LA", "MD", "MI", "MO", "MS",
    "MT", "ND", "NE", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "SD", "TN", "TX", "UT", "VA", "WV", "WY",
}
# federal offshore areas get their own tiles
OFFSHORE = {"R3FM": "GOM", "R5F": "PAC"}

# ISO3 -> export region
REGIONS = {
    "Canada": "CAN",
    "Mexico": "MEX",
    "Latin America": "ARG ATG BHS BLZ BOL BRA BRB CHL COL CRI CUB CYM DOM ECU GTM GUY HND HTI JAM NIC PAN PER PRI "
                     "PRY SLV SUR TTO URY VEN ABW CUW KNA LCA VCT GRD DMA TCA VGB BMU AIA MSR VIR ANT GLP GUF MTQ",
    "Europe": "ALB AND AUT BEL BGR BIH BLR CHE CYP CZE DEU DNK ESP EST FIN FRA GBR GIB GRC HRV HUN IRL ISL ITA LTU "
              "LUX LVA MKD MLT MNE NLD NOR POL PRT ROU RUS SRB SVK SVN SWE UKR YUG GEO TUR MCO MDA SMR SCG GRL SPM",
    "Asia and Pacific": "AUS BGD BRN CHN HKG IDN IND JPN KHM KOR LKA MAC MDV MMR MNG MYS NPL NZL PAK PHL PNG PRK SGP "
                        "THA TWN VNM FJI FSM MHL NCL PLW TON WSM CXR KAZ UZB GUM ASM BUR AFG ARM AZE KGZ TKM NIU PYF SLB VUT",
    "Middle East and Africa": "AGO ARE BHR CMR COD COG DZA EGY ERI ETH GAB GHA GNQ IRN IRQ ISR JOR KEN KWT LBN LBR "
                              "LBY MAR MOZ MRT NAM NGA OMN QAT SAU SDN SEN SLE SYC SYR TCD TGO TUN TZA YEM ZAF CIV DJI "
                              "MUS MDG BEN GIN MLI NER SWZ UGA",
}
ISO_REGION = {iso: reg for reg, isos in REGIONS.items() for iso in isos.split()}

BASINS = {"PM": "Permian", "BK": "Bakken", "EF": "Eagle Ford", "AP": "Appalachia", "HA": "Haynesville",
          "R48": "Rest of Lower 48"}


def get(route, params):
    """All rows for a route, paging 5000 at a time."""
    rows, offset = [], 0
    while True:
        q = dict(params, api_key=KEY, length=5000, offset=offset)
        q.setdefault("frequency", "monthly")
        q["data[]"] = "value"
        url = API + route + "/data/?" + urllib.parse.urlencode(q, doseq=True)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=90) as r:
                    resp = json.load(r)["response"]
                break
            except Exception as e:  # noqa: BLE001 - retry any network hiccup
                if attempt == 3:
                    raise
                print(f"  retry {route}: {e}", file=sys.stderr)
                time.sleep(2 + attempt * 3)
        rows += resp["data"]
        total = int(resp["total"])
        offset += 5000
        if offset >= total:
            break
    print(f"  {route}: {len(rows)} rows", file=sys.stderr)
    return rows


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def days(period):
    y, m = map(int, period.split("-"))
    return calendar.monthrange(y, m)[1]


def series(d, scale=1, digits=0):
    """{period: value} -> {start, v:[...]} with nulls for gaps."""
    d = {k: v for k, v in d.items() if v is not None}
    if not d:
        return None
    keys = sorted(d)
    y, m = map(int, keys[0].split("-"))
    y1, m1 = map(int, keys[-1].split("-"))
    out = []
    while (y, m) <= (y1, m1):
        v = d.get(f"{y:04d}-{m:02d}")
        out.append(None if v is None else round(v * scale, digits) if digits else round(v * scale))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return {"start": keys[0], "v": out}


def main():
    print("Fetching EIA data…", file=sys.stderr)

    # crude production, kb/d
    oil = {}
    for r in get("petroleum/crd/crpdn", {"facets[product][]": "EPC0", "facets[process][]": "FPF"}):
        if r["units"] != "MBBL/D":
            continue
        a = r["duoarea"]
        key = "US" if a == "NUS" else OFFSHORE.get(a) or (a[1:] if a.startswith("S") and a[1:] in STATES else None)
        if key:
            oil.setdefault(key, {})[r["period"]] = f(r["value"])

    # gas marketed production, MMcf/month -> MMcf/d
    gas = {}
    for r in get("natural-gas/prod/sum", {"facets[process][]": "VGM"}):
        if r["units"] != "MMCF":
            continue
        a = r["duoarea"]
        key = "US" if a == "NUS" else OFFSHORE.get(a) or (a[1:] if a.startswith("S") and a[1:] in STATES else None)
        v = f(r["value"])
        if key and v is not None:
            gas.setdefault(key, {})[r["period"]] = v / days(r["period"])

    # trade totals, kb/d
    trade = {}
    for route, proc, name in [("petroleum/move/exp", "EEX", "exp"), ("petroleum/move/imp", "IM0", "imp")]:
        for r in get(route, {"facets[duoarea][]": "NUS-Z00", "facets[product][]": ["EPC0", "EP00"],
                             "facets[process][]": proc}):
            if r["units"] != "MBBL/D":
                continue
            k = ("crude" if r["product"] == "EPC0" else "total") + name.capitalize()
            trade.setdefault(k, {})[r["period"]] = f(r["value"])

    # petroleum exports by country -> region, kb/d
    exp = {"crude": {}, "products": {}}
    unmapped = set()
    for r in get("petroleum/move/expc", {"facets[product][]": ["EPC0", "EPP0"], "start": "1990-01"}):
        if r["duoarea"] == "NUS-Z00" or r["units"] != "MBBL/D":
            continue
        iso = r["area-name"]
        reg = ISO_REGION.get(iso)
        if not reg:
            unmapped.add(iso)
            reg = "Other"
        v = f(r["value"])
        if v is None:
            continue
        bucket = exp["crude" if r["product"] == "EPC0" else "products"].setdefault(reg, {})
        bucket[r["period"]] = bucket.get(r["period"], 0) + v

    # gas exports by country -> region, MMcf/d
    # LNG by country is filed as "exports by vessel" (EVE); ENG/ENP carry the US totals
    for proc, name in [("EVE", "lng"), ("ENP", "pipeline")]:
        exp[name] = {}
        for r in get("natural-gas/move/expc", {"facets[process][]": [proc, "ENG"] if name == "lng" else proc}):
            if r["units"] != "MMCF":
                continue
            if r["duoarea"] == "NUS-Z00":
                if r["process"] == "EVE":
                    continue
                trade.setdefault(name + "Exp", {})[r["period"]] = (f(r["value"]) or 0) / days(r["period"])
                continue
            if r["process"] == "ENG":
                continue
            iso = r["area-name"]
            reg = ISO_REGION.get(iso)
            if not reg:
                unmapped.add(iso)
                reg = "Other"
            v = f(r["value"])
            if v is None:
                continue
            bucket = exp[name].setdefault(reg, {})
            bucket[r["period"]] = bucket.get(r["period"], 0) + v / days(r["period"])
    if unmapped:
        print(f"  unmapped export areas -> Other: {sorted(unmapped)}", file=sys.stderr)

    # imports by country of origin -> region. The import routes also carry aggregates
    # (OPEC, Persian Gulf, ...) that don't map to one country; those are skipped, not bucketed.
    imp = {"crude": {}, "products": {}, "lng": {}, "pipeline": {}}
    skipped = set()

    def add_imp(kind, iso, period, v):
        reg = ISO_REGION.get(iso)
        if not reg:
            skipped.add(iso)
            return
        bucket = imp[kind].setdefault(reg, {})
        bucket[period] = bucket.get(period, 0) + v

    for r in get("petroleum/move/impcus", {"facets[product][]": ["EPC0", "EPP0"], "start": "1990-01"}):
        v = f(r["value"])
        if r["duoarea"] == "NUS-Z00" or r["units"] != "MBBL/D" or v is None:
            continue
        add_imp("crude" if r["product"] == "EPC0" else "products", r["area-name"], r["period"], v)
    for proc, name in [("IML", "lng"), ("IRP", "pipeline")]:
        for r in get("natural-gas/move/impc", {"facets[process][]": proc}):
            v = f(r["value"])
            if r["units"] != "MMCF" or v is None:
                continue
            if r["duoarea"] == "NUS-Z00":
                trade.setdefault(name + "Imp", {})[r["period"]] = v / days(r["period"])
                continue
            add_imp(name, r["area-name"], r["period"], v / days(r["period"]))
    if skipped:
        print(f"  import areas skipped (aggregates/unknown): {sorted(skipped)}", file=sys.stderr)

    # last month with actual (survey) production data; STEO forecasts are cut here
    last = max(oil["US"])

    ids = [p + b for b in BASINS for p in ("COPR", "NGMP", "RIGS")]
    basins = {"oil": {}, "gas": {}, "rigs": {}}
    for r in get("steo", {"facets[seriesId][]": ids}):
        if r["period"] > last:
            continue
        sid = r["seriesId"]
        for pre, k in (("COPR", "oil"), ("NGMP", "gas"), ("RIGS", "rigs")):
            if sid.startswith(pre):
                basins[k].setdefault(sid[len(pre):], {})[r["period"]] = f(r["value"])

    prices = {}
    for route, sid, k in [("petroleum/pri/spt", "RWTC", "wti"), ("natural-gas/pri/fut", "RNGWHHD", "hh")]:
        for r in get(route, {"facets[series][]": sid}):
            prices.setdefault(k, {})[r["period"]] = f(r["value"])

    data = {
        "meta": {"retrieved": datetime.date.today().isoformat(), "last": last},
        # oil kb/d, gas MMcf/d
        "oil": {k: series(v) for k, v in sorted(oil.items())},
        "gas": {k: series(v) for k, v in sorted(gas.items())},
        "trade": {k: series(v) for k, v in trade.items()},
        # exports by region: crude/products kb/d, lng/pipeline MMcf/d
        "exports": {kind: {reg: series(v) for reg, v in regs.items()} for kind, regs in exp.items()},
        "imports": {kind: {reg: series(v) for reg, v in regs.items()} for kind, regs in imp.items()},
        # basins: oil kb/d (STEO is mb/d), gas MMcf/d (STEO is bcf/d), rigs count
        "basins": {
            "names": BASINS,
            "oil": {b: series(v, 1000) for b, v in basins["oil"].items()},
            "gas": {b: series(v, 1000) for b, v in basins["gas"].items()},
            "rigs": {b: series(v) for b, v in basins["rigs"].items()},
        },
        "prices": {k: series(v, 1, 2) for k, v in prices.items()},
    }
    js = "// Generated by update-data.py from the EIA API v2. Do not edit by hand.\nwindow.DATA = " + \
        json.dumps(data, separators=(",", ":")) + ";\n"
    OUT.write_text(js)
    print(f"Wrote {OUT.name}: {len(js) / 1024:.0f} KB, data through {last}", file=sys.stderr)
    print(f"  oil areas {len(oil)}, gas areas {len(gas)}, basins {sorted(basins['oil'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
