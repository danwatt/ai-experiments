#!/usr/bin/env python3
"""Build the dataset for the Tarrant County ISD comparison and inline it into index.html.

Inputs (downloaded by fetch.sh, not committed; they are large):
  RAW/tea/a20XX.csv  TEA PEIMS district actual financial data, Tarrant ISD rows only (districts 2209xx)
  RAW/tea/summ.json  Tarrant ISD rows of TEA "Summarized PEIMS Actual Financial Data" (names, fall enrollment)
  RAW/tda/snpYYYY.json  Texas Dept. of Agriculture school meal claims, contracting entities 01017-01032

Categories match the Fort Worth ISD explorer (../fwisd-budget-opus-5.5-high/build/build_data.py).

Usage: python3 build_data.py RAW_DIR ../index.html
"""
import csv, glob, json, os, sys
from collections import defaultdict

RAW, OUT = sys.argv[1], sys.argv[2]

# TEA district number -> (short name, TDA contracting-entity id; None = not in the school lunch program)
DISTRICTS = {
    "220901": ("Arlington", "01017"), "220902": ("Birdville", "01018"), "220904": ("Everman", "01019"),
    "220905": ("Fort Worth", "01020"), "220906": ("Grapevine-Colleyville", "01021"), "220907": ("Keller", "01022"),
    "220908": ("Mansfield", "01023"), "220910": ("Lake Worth", "01024"), "220912": ("Crowley", "01025"),
    "220914": ("Kennedale", "01026"), "220915": ("Azle", "01027"), "220916": ("Hurst-Euless-Bedford", "01028"),
    "220917": ("Castleberry", "01029"), "220918": ("Eagle Mountain-Saginaw", "01030"), "220919": ("Carroll", "01031"),
    "220920": ("White Settlement", "01032"),
}
CE2D = {ce: d for d, (_, ce) in DISTRICTS.items()}

# ---------------------------------------------------------------- categories (same as the FWISD explorer)
def fund_group(f):
    if f == "199": return "GF"
    if f in ("701", "240", "101", "242"): return "CN"   # food service: enterprise 701, special revenue 240, GF-group 101
                                                        # (Everman), and 242 summer feeding (pandemic meals in Arlington, HEB)
    if f[0] in "23": return "FG"
    if f[0] == "4": return "SL"
    if f == "599": return "DS"
    if f == "699": return "CP"
    return None                                  # internal service, fiduciary: excluded (would double count)

USES = [
    ("instr", "Instruction", ("11", "95")),
    ("isup", "Libraries & curriculum", ("12", "13")),
    ("lead", "Campus & instructional leadership", ("21", "23")),
    ("stud", "Counseling, health & social work", ("31", "32", "33")),
    ("trans", "Transportation", ("34",)),
    ("food", "Food service", ("35",)),
    ("extra", "Extracurricular", ("36",)),
    ("admin", "Central administration", ("41", "92")),
    ("ops", "Facilities, security & IT", ("51", "52", "53")),
    ("comm", "Community services", ("61",)),
    ("debt", "Debt payments", ("71",)),
    ("build", "Construction", ("81",)),
    ("inter", "Recapture & intergovernmental", ("91", "93", "94", "96", "97", "99")),
]
FUNC2USE = {fn: k for k, _, fns in USES for fn in fns}

SOURCES = [
    ("tax_mo", "Property tax: operations", "local"),
    ("tax_is", "Property tax: debt (I&S)", "local"),
    ("loc_oth", "Other local (interest, fees, sales)", "local"),
    ("st_fsp", "State: Foundation School Program", "state"),
    ("st_trs", "State: TRS pension on-behalf", "state"),
    ("st_oth", "State: other", "state"),
    ("fed_cn", "Federal: USDA child nutrition", "federal"),
    ("fed_t1", "Federal: Title I", "federal"),
    ("fed_sped", "Federal: special ed (IDEA)", "federal"),
    ("fed_covid", "Federal: COVID relief (ESSER)", "federal"),
    ("fed_arra", "Federal: 2009 stimulus (ARRA)", "federal"),
    ("fed_med", "Federal: Medicaid (SHARS)", "federal"),
    ("fed_oth", "Federal: other grants", "federal"),
]
COVID_FUNDS = {"281", "282", "283", "284", "285", "279", "277"}
ARRA_FUNDS = {"283", "284", "285", "286", "287"}

def fed_cat(fund, obj, yr):
    if fund in ("701", "240", "101", "242") or obj in ("5921", "5922", "5923"): return "fed_cn"
    if fund == "266": return "fed_covid" if yr >= 2020 else "fed_arra"
    if yr >= 2020 and fund in COVID_FUNDS: return "fed_covid"
    if yr <= 2013 and fund in ARRA_FUNDS: return "fed_arra"
    if fund in ("211", "276"): return "fed_t1"
    if fund in ("224", "225", "226", "313", "314", "315"): return "fed_sped"
    if fund == "199" and obj in ("5931", "5932"): return "fed_med"
    return "fed_oth"

def src_of(fund, obj, yr):
    p = obj[:2]
    if p == "57":
        if obj in ("5711", "5712", "5719"): return "tax_is" if fund == "599" else "tax_mo"
        return "loc_oth"
    if p == "58":
        if obj in ("5811", "5812"): return "st_fsp"
        if obj == "5831": return "st_trs"
        return "st_oth"
    if p == "59": return fed_cat(fund, obj, yr)
    if fund == "701" and obj in ("7952", "7953", "7954", "7955"): return "fed_cn"
    return None

def r0(x): return int(round(x))

# ---------------------------------------------------------------- TEA
enroll = defaultdict(dict)
for r in json.load(open(f"{RAW}/tea/summ.json")):
    d = str(r["DISTRICT NUMBER"]).strip("'")
    if d in DISTRICTS and r.get("FALL SURVEY ENROLLMENT"):
        enroll[d][int(r["YEAR"])] = int(float(r["FALL SURVEY ENROLLMENT"]))
names = {str(r["DISTRICT NUMBER"]).strip("'"): r["DISTRICT NAME"] for r in json.load(open(f"{RAW}/tea/summ.json"))}

fin = defaultdict(dict)
years = []
for path in sorted(glob.glob(f"{RAW}/tea/a20*.csv")):
    yr = int(os.path.basename(path)[1:5]); years.append(yr)
    src = defaultdict(lambda: defaultdict(float))
    use = defaultdict(lambda: defaultdict(float))
    cn = defaultdict(lambda: defaultdict(float))
    for r in csv.DictReader(open(path)):
        d = r["DISTRICT"]
        if d not in DISTRICTS: continue
        fund, obj, fn = r["FUND"], r["OBJECT"], r["FUNCTION"]
        g = fund_group(fund)
        if not g: continue
        a = float(r["ACTAMT"])
        s = src_of(fund, obj, yr)
        if s:
            src[d][s] += a
            if g == "CN" and s != "fed_cn": cn[d]["local"] += a     # meal sales and state matching money
        elif obj[0] == "6":
            u = FUNC2USE.get(fn) or ("admin" if fn == "41" else "ops")
            use[d][u] += a
            if g == "CN": cn[d]["spent"] += a
    for d in DISTRICTS:
        if d not in src: continue
        fin[d][yr] = {
            "e": enroll[d].get(yr),
            "s": {k: r0(v) for k, v in src[d].items() if abs(v) >= 500},
            "u": {k: r0(v) for k, v in use[d].items() if abs(v) >= 500},
            "cn": {k: r0(v) for k, v in cn[d].items()},
        }

# ---------------------------------------------------------------- TDA school meal claims
def num(r, *ks): return sum(float(r.get(k) or 0) for k in ks)

meals = defaultdict(dict)
for y in range(2016, 2027):
    p = f"{RAW}/tda/snp{y}.json"
    rows = json.load(open(p)) if os.path.exists(p) else []
    by = defaultdict(list)
    for r in rows:
        if r.get("ceid") in CE2D: by[CE2D[r["ceid"]]].append(r)
    for d, rs in by.items():
        octo = [r for r in rs if r["claimdate"][5:7] == "10" and num(r, "enrollmentqty") > 0]
        free = lambda r: num(r, "freeeligqty", "freeeligibleqty")
        red = lambda r: num(r, "redceligqty", "reducedeligibleqty")
        m = {
            "sites": len(octo),
            "enroll": r0(sum(num(r, "enrollmentqty") for r in octo)),
            "free": r0(sum(free(r) for r in octo)),
            "red": r0(sum(red(r) for r in octo)),
            # CEP schools claim no reduced-price students; every non-CEP school of any size has some
            "cepEnroll": r0(sum(num(r, "enrollmentqty") for r in octo if red(r) == 0)),
            "allFreeEnroll": r0(sum(num(r, "enrollmentqty") for r in octo if red(r) == 0 and free(r) >= num(r, "enrollmentqty") - 0.5)),
            "breakfasts": r0(sum(num(r, "breakfasttotal") for r in rs)),
            "lunches": r0(sum(num(r, "lunchtotal") for r in rs)),
            "reimb": r0(sum(num(r, "totalreimbursement") for r in rs)),
            "months": len({r["claimdate"][:7] for r in rs if num(r, "totalreimbursement") > 0}),
        }
        # CEP claiming rate: the free share at CEP schools that are not at 100%; one rate per grouping, so take the
        # enrollment-weighted mean and the spread
        cep = [(free(r) / num(r, "enrollmentqty"), num(r, "enrollmentqty")) for r in octo if red(r) == 0]
        if cep:
            m["cepRate"] = round(sum(f * e for f, e in cep) / sum(e for _, e in cep), 4)
        if y >= 2025:
            mon = defaultdict(float)
            for r in rs: mon[r["claimdate"][:7]] += num(r, "totalreimbursement")
            m["monthly"] = {k: r0(v) for k, v in sorted(mon.items()) if v > 0}
        meals[d][y] = m

CPI = {2011: 221.09, 2012: 227.56, 2013: 231.35, 2014: 234.97, 2015: 236.68, 2016: 238.27, 2017: 242.66,
       2018: 248.13, 2019: 253.27, 2020: 257.23, 2021: 263.15, 2022: 282.03, 2023: 299.69, 2024: 309.57,
       2025: 317.73, 2026: 327.67}

data = {
    "built": "2026-11-06",
    "cpi": CPI,
    "years": years,
    "districts": [{"id": d, "short": s, "name": names.get(d, s + " ISD").title().replace("Isd", "ISD").replace("Mt-", "Mountain-"),
                   "ce": ce, "nslp": d in meals} for d, (s, ce) in DISTRICTS.items()],
    "uses": [[k, n] for k, n, _ in USES],
    "sources": SOURCES,
    "fin": fin,
    "meals": meals,
}
blob = "window.TARRANT=" + json.dumps(data, separators=(",", ":")) + ";"
page = open(OUT).read()
a, b = "/*DATA*/", "/*/DATA*/"
i, j = page.index(a) + len(a), page.index(b)
open(OUT, "w").write(page[:i] + blob + page[j:])
print("inlined", len(blob), "bytes of data into", OUT)
