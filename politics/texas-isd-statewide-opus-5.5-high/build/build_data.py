#!/usr/bin/env python3
"""Build the dataset for the statewide Texas ISD explorer and inline it into index.html.

Inputs (downloaded by fetch.sh, not committed; they are large):
  RAW/zip/a20XX.zip        TEA PEIMS district actual financial data, every district (streamed, not unpacked)
  RAW/zip/summarized.xlsx  TEA "Summarized PEIMS Actual Financial Data" (names, fall enrollment)
  RAW/tda/octYYYY.json     TDA school-meal claims, October site rows for educational institutions
  RAW/tda/monYYYY.json     TDA school-meal claims, monthly totals per contracting entity
  RAW/geo/counties.json    US county outlines (Census), Texas kept

Revenue and spending categories match the Fort Worth and Tarrant County explorers.
Dollar amounts are stored in thousands (rounded) to keep the page small.

Usage: python3 build_data.py RAW_DIR ../index.html
"""
import csv, glob, io, json, math, os, re, sys, zipfile
from collections import Counter, defaultdict
from multiprocessing import Pool

RAW, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- categories
def fund_group(f):
    if f == "199": return "GF"
    if f in ("701", "240", "101", "242"): return "CN"   # food service: enterprise 701, special revenue 240,
    if f[0] in "23": return "FG"                          # GF-group 101, summer feeding 242
    if f[0] == "4": return "SL"
    if f == "599": return "DS"
    if f == "699": return "CP"
    return None                                           # internal service, fiduciary: excluded (would double count)

COVID_FUNDS = {"281", "282", "283", "284", "285", "279", "277"}
ARRA_FUNDS = {"283", "284", "285", "286", "287"}
REV = ["local", "state", "fed_cn", "fed_t1", "fed_sped", "fed_covid", "fed_arra", "fed_med", "fed_oth"]
SPEND = [("instr", ("11", "95")), ("supp", ("12", "13", "21", "23")), ("stud", ("31", "32", "33")), ("trans", ("34",)),
         ("food", ("35",)), ("extra", ("36",)), ("admin", ("41", "92")), ("ops", ("51", "52", "53")), ("comm", ("61",)),
         ("cap", ("71", "81")), ("inter", ("91", "93", "94", "96", "97", "99"))]
FUNC2S = {fn: k for k, fns in SPEND for fn in fns}
# Extra key, overlapping "state" (not added into totals):
#   fsp  Foundation School Program state aid (objects 5811, 5812), used to apportion the recapture pool.
# Recapture paid comes from TEA's own recapture-paid-by-district file (FY1994-FY2027), which matches the
# General Fund function 91 payments in these books to within about 1% statewide.
EXTRA = ["fsp"]
KEYS = REV + [k for k, _ in SPEND] + EXTRA
KI = {k: i for i, k in enumerate(KEYS)}

def fed_cat(fund, obj, yr):
    if fund in ("701", "240", "101", "242") or obj in ("5921", "5922", "5923"): return "fed_cn"
    if fund == "266": return "fed_covid" if yr >= 2020 else "fed_arra"
    if yr >= 2020 and fund in COVID_FUNDS: return "fed_covid"
    if yr <= 2013 and fund in ARRA_FUNDS: return "fed_arra"
    if fund in ("211", "276"): return "fed_t1"
    if fund in ("224", "225", "226", "313", "314", "315"): return "fed_sped"
    if fund == "199" and obj in ("5931", "5932"): return "fed_med"
    return "fed_oth"

def rev_of(fund, obj, yr):
    p = obj[:2]
    if p == "57": return "local"
    if p == "58": return "state"
    if p == "59": return fed_cat(fund, obj, yr)
    if fund == "701" and obj in ("7952", "7953", "7954", "7955"): return "fed_cn"
    return None

def read_year(path):
    yr = int(os.path.basename(path)[1:5])
    acc = defaultdict(lambda: [0.0] * len(KEYS))
    with zipfile.ZipFile(path) as z:
        name = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
        with z.open(name) as f:
            rd = csv.reader(io.TextIOWrapper(f, encoding="latin-1"))
            hdr = next(rd); ix = {h.strip(): i for i, h in enumerate(hdr)}
            iD, iF, iFn, iO, iA = ix["DISTRICT"], ix["FUND"], ix["FUNCTION"], ix["OBJECT"], ix["ACTAMT"]
            for r in rd:
                fund, obj = r[iF], r[iO]
                if not fund_group(fund): continue
                k = rev_of(fund, obj, yr)
                extra = None
                if k is None:
                    if obj[:1] != "6": continue
                    fn = r[iFn]
                    k = FUNC2S.get(fn) or ("admin" if fn == "41" else "ops")
                elif obj in ("5811", "5812"): extra = "fsp"
                try: a = float(r[iA])
                except ValueError: continue
                row = acc[r[iD]]
                row[KI[k]] += a
                if extra: row[KI[extra]] += a
    return yr, {d: [round(v / 1000) for v in vals] for d, vals in acc.items()}

def main():
    # ---------------------------------------------------------------- names and enrollment
    import openpyxl
    ws = openpyxl.load_workbook(f"{RAW}/zip/summarized.xlsx", read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True); hdr = list(next(rows)); hx = {h: i for i, h in enumerate(hdr)}
    names, enroll = {}, defaultdict(dict)
    for r in rows:
        d = str(r[0]).strip("'")
        if not d or d[3] == "8": continue                    # charters aren't in the actual-financial files
        names[d] = r[1]
        try: enroll[d][int(r[2])] = int(float(r[hx["FALL SURVEY ENROLLMENT"]] or 0))
        except (TypeError, ValueError): pass

    def nice(n):
        n = " ".join(w.capitalize() if not re.fullmatch(r"(C?ISD|CSD|MSD|H\s?S|[IVX]+)", w) else w for w in re.split(r"\s+", n.strip()))
        n = re.sub(r"(?<=[-/])([a-z])", lambda m: m.group(1).upper(), n)
        return n.replace("Mt-", "Mount-").replace("Mt ", "Mount ").replace("Of ", "of ").replace("At ", "at ")

    # ---------------------------------------------------------------- TDA
    def num(x):
        try: return float(x)
        except (TypeError, ValueError): return 0.0

    ce2d, ce_esc, ce_name = {}, {}, {}
    oct_rows = {}
    for y in range(2016, 2027):
        d = json.load(open(f"{RAW}/tda/oct{y}.json"))
        assert isinstance(d, list), (y, d)
        oct_rows[y] = d
        for r in d:
            ce_name.setdefault(r["ceid"], r["cename"])
            if r.get("esc"): ce_esc.setdefault(r["ceid"], Counter())[r["esc"]] += 1
            cdc = (r.get("cdc") or "").replace("-", "")
            if len(cdc) == 6 and cdc in names: ce2d[r["ceid"]] = cdc
    # entities seen only before 2019 (no county-district code): match by name
    by_name = {re.sub(r"\W", "", v.upper()): k for k, v in names.items()}
    for ce, nm in ce_name.items():
        if ce not in ce2d:
            k = by_name.get(re.sub(r"\W", "", nm.upper()))
            if k: ce2d[ce] = k

    meals = defaultdict(dict)
    for y, d in oct_rows.items():
        agg = defaultdict(lambda: [0.0] * 5)                 # enroll, free, reduced, CEP-school enroll, CEP-school free
        for r in d:
            dist = ce2d.get(r["ceid"])
            e = num(r.get("e"))
            if not dist or e <= 0: continue
            f, rd = num(r.get("f")), num(r.get("r"))
            a = agg[dist]; a[0] += e; a[1] += f; a[2] += rd
            if rd == 0: a[3] += e; a[4] += f                   # CEP schools claim no reduced-price students
        mon = defaultdict(dict)
        for r in json.load(open(f"{RAW}/tda/mon{y}.json")):
            dist = ce2d.get(r["ceid"])
            if dist:
                m = r["m"][:7]
                p = mon[dist].setdefault(m, [0.0, 0.0])
                p[0] += num(r.get("reimb")); p[1] += num(r.get("l")) + num(r.get("b"))
        for dist in set(agg) | set(mon):
            a = agg.get(dist, [0] * 5)
            ms = mon.get(dist, {})
            meals[dist][y] = {"e": round(a[0]), "f": round(a[1]), "r": round(a[2]), "ce": round(a[3]), "cf": round(a[4]),
                              "reimb": round(sum(v[0] for v in ms.values())), "meals": round(sum(v[1] for v in ms.values())),
                              "mon": {k: round(v[0]) for k, v in ms.items()} if y >= 2025 else None}

    # ---------------------------------------------------------------- county outlines
    geo = json.load(open(f"{RAW}/geo/counties.json"))
    LAT0 = math.radians(31.0)
    def proj(lon, lat): return ((lon + 106.65) * math.cos(LAT0) * 52.0, (36.5 - lat) * 52.0)
    counties = {}
    for ft in geo["features"]:
        fips = ft["id"]
        if not fips.startswith("48"): continue
        code = f"{(int(fips[2:]) + 1) // 2:03d}"           # TEA county numbers are alphabetical; FIPS = 2 * TEA - 1
        polys = ft["geometry"]["coordinates"] if ft["geometry"]["type"] == "MultiPolygon" else [ft["geometry"]["coordinates"]]
        d = ""
        for poly in polys:
            for ring in poly:
                pts, last = [], None
                for lon, lat in ring:
                    x, y = proj(lon, lat)
                    p = (round(x, 1), round(y, 1))
                    if last and abs(p[0] - last[0]) + abs(p[1] - last[1]) < 0.9: continue
                    pts.append(p); last = p
                if len(pts) >= 3:
                    d += "M" + "L".join(f"{x:g},{y:g}" for x, y in pts) + "Z"
        counties[code] = {"n": ft["properties"]["NAME"], "d": d}

    # ---------------------------------------------------------------- TEA actuals (parallel over years)
    paths = sorted(glob.glob(f"{RAW}/zip/a20*.zip"))
    with Pool(min(8, len(paths))) as pool:
        res = dict(pool.map(read_year, paths))
    YEARS = sorted(res)

    dists = sorted({d for yr in res.values() for d in yr if d[3] != "8"})
    region = {}
    for ce, c in ce_esc.items():
        if ce in ce2d: region[ce2d[ce]] = int(c.most_common(1)[0][0])
    county_region = defaultdict(Counter)
    for d, rg in region.items(): county_region[d[:3]][rg] += 1
    region.update({"131001": 2, "135001": 17})            # Kenedy County Wide CSD, Guthrie CSD: only district in county, no meal claims
    for d in dists:
        if d not in region and county_region[d[:3]]: region[d] = county_region[d[:3]].most_common(1)[0][0]

    d2ce = {}
    for ce, d in ce2d.items(): d2ce.setdefault(d, ce)
    fin = {}
    for d in dists:
        e = [enroll[d].get(y) if d in res[y] else None for y in YEARS]
        cols = [[res[y][d][i] if d in res[y] else None for y in YEARS] for i in range(len(KEYS))]
        fin[d] = [e] + cols

    MY = list(range(2016, 2027))
    mealout = {}
    for d, by in meals.items():
        if d not in fin: continue
        row = {k: [by[y][k] if y in by else None for y in MY] for k in ("e", "f", "r", "ce", "cf", "reimb", "meals")}
        a, b = (by.get(2025) or {}).get("mon") or {}, (by.get(2026) or {}).get("mon") or {}
        x = z = 0
        for k, v in a.items():
            k2 = f"{int(k[:4]) + 1}{k[4:]}"
            if b.get(k2): x += v; z += b[k2]
        row["match"] = [x, z]
        mealout[d] = row

    # TEA recapture paid by district; FY2026 is near-final and FY2027 preliminary
    ws = openpyxl.load_workbook(f"{RAW}/zip/recapture-paid.xlsx", read_only=True).worksheets[0]
    rr = list(ws.iter_rows(values_only=True))
    hi = next(k for k, r in enumerate(rr) if r and r[0] == "CDN")
    ycol = {int(re.search(r"(\d{4})", c).group(1)): j for j, c in enumerate(rr[hi]) if isinstance(c, str) and "Total Recapture" in c}
    RY = [y for y in sorted(ycol) if y >= YEARS[0]]
    rcp = {}
    for r in rr[hi + 1:]:
        if not r or not r[0] or not str(r[0]).strip("'").isdigit(): continue
        d = str(r[0]).strip("'").zfill(6)
        vals = [round((r[ycol[y]] or 0) / 1000) if isinstance(r[ycol[y]], (int, float)) else 0 for y in RY]
        if any(vals): rcp[d] = vals

    CPI = {2011: 221.09, 2012: 227.56, 2013: 231.35, 2014: 234.97, 2015: 236.68, 2016: 238.27, 2017: 242.66,
           2018: 248.13, 2019: 253.27, 2020: 257.23, 2021: 263.15, 2022: 282.03, 2023: 299.69, 2024: 309.57,
           2025: 317.73, 2026: 327.67}

    data = {
        "built": "2026-11-07",
        "cpi": CPI, "years": YEARS, "mealYears": MY, "keys": KEYS,
        "dist": [[d, nice(names.get(d, d)), d[:3], region.get(d)] for d in dists],
        "fin": fin, "meals": mealout,
        "counties": counties,
        "rcp": rcp, "rcpYears": RY,
    }
    blob = "window.TX=" + json.dumps(data, separators=(",", ":")) + ";"
    page = open(OUT).read()
    a, b = "/*DATA*/", "/*/DATA*/"
    i, j = page.index(a) + len(a), page.index(b)
    open(OUT, "w").write(page[:i] + blob + page[j:])
    print(f"{len(dists)} districts, {len(mealout)} with meal claims, {len(counties)} counties; "
          f"{len(blob) / 1e6:.2f} MB inlined into {OUT}")
    missing = [d for d in dists if d not in mealout and fin[d][0][-1]]
    print("no meal claims:", len(missing), [names.get(d) for d in missing][:40])
    print("no region:", [d for d in dists if d not in region])


if __name__ == "__main__":   # worker processes import this file; only the parent builds
    main()
