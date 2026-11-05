#!/usr/bin/env python3
"""Build data.js from ERCOT's "Fuel Mix Report" (IntGenbyFuel) spreadsheets.

Source page: https://www.ercot.com/gridinfo/generation
Each yearly workbook holds one sheet per month with a row per day and fuel,
giving 15-minute generation (MWh) plus a daily "Total". We sum the daily
totals into monthly GWh per fuel.

Usage: python3 build_data.py [cache_dir]
Requires pandas, openpyxl and xlrd.
"""
import collections
import datetime as dt
import glob
import json
import os
import re
import sys
import urllib.request
import zipfile

import pandas as pd

PAGE = "https://www.ercot.com/gridinfo/generation"
UA = {"User-Agent": "Mozilla/5.0"}
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, ".cache")
MONTH_SHEET = r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"

# ERCOT renamed fuels over the years; map every spelling to one key.
FUEL_MAP = {
    "Wind": "wind", "Wnd": "wind",
    "Solar": "solar", "Sun": "solar",
    "Hydro": "hydro",
    "Biomass": "biomass",
    "Nuclear": "nuclear",
    "Coal": "coal",
    "Gas-CC": "gasCC", "Gas_CC": "gasCC",
    "Gas_GT": "gasOther",
    "Other": "other", "Oth": "other",
    "WSL": "storageCharge",  # wholesale storage load (battery charging), negative
}


def fetch(url, dest):
    if not os.path.exists(dest):
        print("downloading", url, file=sys.stderr)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
            f.write(r.read())
    return dest


def download():
    os.makedirs(CACHE, exist_ok=True)
    html = urllib.request.urlopen(urllib.request.Request(PAGE, headers=UA)).read().decode()
    links = sorted(set(re.findall(r'href="(https://www\.ercot\.com/files/docs/[^"]+?(?:IntGenbyFuel\d{4}\.xlsx|FuelMixReport_PreviousYears\.zip))"', html)))
    for url in links:
        dest = fetch(url, os.path.join(CACHE, url.rsplit("/", 1)[1]))
        if dest.endswith(".zip"):
            with zipfile.ZipFile(dest) as z:
                z.extractall(os.path.join(CACHE, "prev"))
    files = {}
    for f in glob.glob(os.path.join(CACHE, "**", "*.xls*"), recursive=True):
        year = re.search(r"(\d{4})\.xlsx?$", f).group(1)
        # the current-year workbook on the page wins over any copy in the zip
        if year not in files or "prev" in files[year]:
            files[year] = f
    return [files[y] for y in sorted(files)]


def read_sheet(d):
    norm = {re.sub(r"[^a-z]", "", str(c).lower()): c for c in d.columns}
    total = norm.get("total") or norm.get("dailymwh")
    fuel = norm.get("fuel") or norm.get("fueltype")
    if fuel is not None:
        df = pd.DataFrame({"date": pd.to_datetime(d[norm["date"]], errors="coerce"),
                           "fuel": d[fuel].astype(str).str.strip()})
    else:  # older sheets combine both as "12/01/10-Coal" or "01/01/16_Coal"
        m = d.iloc[:, 0].astype(str).str.strip().str.extract(r"^(\d{1,2}/\d{1,2}/\d{2,4})\s*[-_ ]?\s*(.+)$")
        df = pd.DataFrame({"date": pd.to_datetime(m[0], format="mixed", errors="coerce"),
                           "fuel": m[1].str.strip()})
    df["total"] = pd.to_numeric(d[total], errors="coerce")
    st = next((c for k, c in norm.items() if k.startswith("settlement")), None)
    df["rank"] = (d[st].astype(str).str.strip().map({"FINAL": 0, "INITIAL": 1}).fillna(2)
                  if st is not None else 0)
    df = df.dropna(subset=["date", "total"])
    # one row per day and fuel, preferring the most final settlement
    return df.sort_values("rank").drop_duplicates(["date", "fuel"])


def main():
    months = collections.defaultdict(lambda: collections.defaultdict(float))
    days = collections.defaultdict(set)
    for f in download():
        x = pd.ExcelFile(f)
        for s in x.sheet_names:
            if not re.match(MONTH_SHEET, s):
                continue
            d = x.parse(s, header=0)
            if d.empty:
                continue
            for r in read_sheet(d).itertuples():
                if r.fuel == "Gas":
                    # "Gas" meant all gas until ERCOT split out combined cycle in 2009
                    key = "gasUnsplit" if r.date.year < 2009 else "gasOther"
                else:
                    key = FUEL_MAP[r.fuel]
                m = r.date.strftime("%Y-%m")
                months[m][key] += r.total
                days[m].add(r.date.day)

    keys = sorted(months)
    # drop a trailing partial month
    last = keys[-1]
    y, mo = map(int, last.split("-"))
    if len(days[last]) < (dt.date(y + mo // 12, mo % 12 + 1, 1) - dt.timedelta(days=1)).day:
        keys = keys[:-1]

    fuels = ["wind", "solar", "hydro", "biomass", "nuclear", "gasCC", "gasOther", "gasUnsplit", "coal", "other", "storageCharge"]
    out = {
        "source": PAGE,
        "built": dt.date.today().isoformat(),
        "unit": "GWh",
        "months": keys,
        "fuels": {k: [round(months[m].get(k, 0) / 1000, 1) for m in keys] for k in fuels},
    }
    with open(os.path.join(HERE, "data.js"), "w") as f:
        f.write("// Generated by build_data.py from ERCOT Fuel Mix Reports. Do not edit.\n")
        f.write("window.ERCOT = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print(f"{len(keys)} months, {keys[0]} to {keys[-1]}", file=sys.stderr)


if __name__ == "__main__":
    main()
