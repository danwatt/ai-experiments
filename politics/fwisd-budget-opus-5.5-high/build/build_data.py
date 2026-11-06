#!/usr/bin/env python3
"""Build the dataset for the FWISD budget explorer and inline it into index.html.

Inputs (downloaded by fetch.sh, not committed — they are large):
  RAW/tea/a20XX.csv   TEA PEIMS district actual financial data, FWISD rows only (district 220905)
  RAW/tea/b2026.csv   TEA PEIMS district budget data FY2026, FWISD rows only
  RAW/tea/summ_fw.json FWISD rows of TEA "2009-2025 Summarized PEIMS Actual Financial Data" (fall enrollment)
  RAW/tda/*.json      Texas Dept. of Agriculture meal-reimbursement claims for CE 01020 (Fort Worth ISD)

FWISD adopted-budget figures (FY2023-FY2027) are transcribed below from the district's PDFs.

Usage: python3 build_data.py RAW_DIR ../index.html
"""
import csv, glob, json, os, sys
from collections import defaultdict

RAW, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- categories
FUNDS = {
    "GF": "General Fund",
    "CN": "Child Nutrition Fund",
    "FG": "Federal grant funds",
    "SL": "State & local grant funds",
    "DS": "Debt Service Fund",
    "CP": "Capital Projects (bonds)",
}

def fund_group(f):
    if f == "199": return "GF"
    if f in ("701", "240"): return "CN"          # food service: enterprise 701 until FY2025, special revenue 240 from FY2026
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

COVID_FUNDS = {"281", "282", "283", "284", "285", "279", "277"}   # from FY2021
ARRA_FUNDS = {"283", "284", "285", "286", "287"}                  # through FY2013

def fed_cat(fund, obj, yr):
    if fund in ("701", "240") or obj in ("5921", "5922", "5923"):
        return "fed_cn"
    if fund == "266":
        return "fed_covid" if yr >= 2020 else "fed_arra"
    if yr >= 2020 and fund in COVID_FUNDS: return "fed_covid"
    if yr <= 2013 and fund in ARRA_FUNDS: return "fed_arra"
    if fund in ("211", "276"): return "fed_t1"
    if fund in ("224", "225", "226", "313", "314", "315"): return "fed_sped"
    if fund == "199" and obj in ("5931", "5932"): return "fed_med"
    return "fed_oth"

FED_PROGRAMS = {   # finer list for the federal table
    "211": "Title I, Part A (low-income schools)", "276": "Title I school improvement",
    "224": "IDEA-B special education", "225": "IDEA-B preschool",
    "255": "Title II-A (teacher training)", "263": "Title III-A (English learners)",
    "265": "Title IV-B 21st Century after-school", "244": "Perkins career & technical",
    "220": "Adult education", "206": "Homeless children (McKinney-Vento)", "258": "Charter school program",
    "266": "ESSER I (CARES) / SFSF stimulus", "281": "ESSER II (CRRSA)", "282": "ESSER III (ARP)",
    "283": "ARP / ARRA supplemental", "284": "IDEA-B ARP / ARRA", "285": "Title I ARRA / IDEA preschool ARP",
    "286": "Title I school improvement (ARRA)", "287": "Education Jobs Fund (2010)",
    "289": "Other federal (locally defined)", "279": "ESSER III TCLAS",
}

def src_of(fund, obj, yr):
    p = obj[:2]
    if p == "57":
        if obj in ("5711", "5712", "5719"):
            return "tax_is" if fund == "599" else "tax_mo"
        return "loc_oth"
    if p == "58":
        if obj in ("5811", "5812"): return "st_fsp"
        if obj == "5831": return "st_trs"
        return "st_oth"
    if p == "59":
        return fed_cat(fund, obj, yr)
    if fund == "701" and obj in ("7952", "7953", "7954", "7955"):
        return "fed_cn"
    return None

CN_OBJ = {"7952": "breakfast", "7953": "lunch", "7954": "commodities", "7955": "other",
          "5921": "breakfast", "5922": "lunch", "5923": "commodities"}

def r0(x): return int(round(x))

# ---------------------------------------------------------------- actuals
enroll = {int(r["YEAR"]): int(r["FALL SURVEY ENROLLMENT"]) for r in json.load(open(f"{RAW}/tea/summ_fw.json"))}

actual = {}
for path in sorted(glob.glob(f"{RAW}/tea/a20*.csv")):
    yr = int(os.path.basename(path)[1:5])
    src = defaultdict(float)
    fund_src = defaultdict(float)            # (src, fund)
    fund_use = defaultdict(float)            # (fund, use)
    fed_prog = defaultdict(float)
    cn = defaultdict(float)
    for r in csv.DictReader(open(path)):
        fund, obj, fn = r["FUND"], r["OBJECT"], r["FUNCTION"]
        g = fund_group(fund)
        if not g: continue
        a = float(r["ACTAMT"])
        s = src_of(fund, obj, yr)
        if s:
            src[s] += a; fund_src[(s, g)] += a
            if s.startswith("fed_"):
                key = fund if fund not in ("199",) else "199/" + obj
                if s == "fed_cn": key = "CN"
                fed_prog[key] += a
            if g == "CN":
                if s == "fed_cn": cn[CN_OBJ.get(obj, "other")] += a
                elif obj == "5751": cn["sales"] += a
                else: cn["otherLocalState"] += a
        elif obj[0] == "6":
            u = FUNC2USE.get(fn)
            if u is None: u = "admin" if fn == "41" else "ops"
            fund_use[(g, u)] += a
            if g == "CN": cn["spent"] += a
    # balance each fund
    links = []
    for g in FUNDS:
        rin = sum(v for (s, f), v in fund_src.items() if f == g)
        rout = sum(v for (f, u), v in fund_use.items() if f == g)
        for (s, f), v in fund_src.items():
            if f == g and v > 0: links.append([s, g, r0(v)])
        for (f, u), v in fund_use.items():
            if f == g and v > 0: links.append([g, u, r0(v)])
        gap = rout - rin
        if gap > 5e5: links.append(["bal_in", g, r0(gap)])
        elif gap < -5e5: links.append([g, "bal_out", r0(-gap)])
    uses = defaultdict(float)
    for (f, u), v in fund_use.items(): uses[u] += v
    actual[yr] = {
        "enroll": enroll.get(yr),
        "src": {k: r0(v) for k, v in src.items()},
        "use": {k: r0(v) for k, v in uses.items()},
        "links": links,
        "fed": {k: r0(v) for k, v in sorted(fed_prog.items(), key=lambda kv: -kv[1]) if abs(v) >= 5e4},
        "cn": {k: r0(v) for k, v in cn.items()},
    }

# ---------------------------------------------------------------- adopted budgets (FWISD PDFs)
# Official budget = General Fund + Food Service + Debt Service (Texas requires only these to be adopted).
# Food-service USDA revenue is booked as "7900 Other Resources" in FY2023-FY2024 books (enterprise fund); reclassed to federal here.
F = lambda **kw: kw
BUDGET = {
    2023: dict(doc="Budget Book 2022-2023 (Budget: All Funds, p.14)", adopted="June 2022",
               rev={"GF": F(local=485767032, state=260945145, fed=29419955, other=3000000),
                    "CN": F(local=2932084, state=274022, fed=43121426),
                    "DS": F(local=147846385, state=1581259)},
               spend={"CN": 46327532, "DS": 120472163},
               fn={"11": 451199513, "12": 12453876, "13": 11588543, "21": 15604617, "23": 52130748, "31": 48301359,
                   "32": 5160819, "33": 11801053, "34": 24581334, "35": 46771124, "36": 19090722, "41": 23664497,
                   "51": 93434899, "52": 12966454, "53": 25719627, "61": 5275169, "71": 123472163, "95": 97629, "99": 3000000}),
    2024: dict(doc="Budget Book 2023-2024 (Budget: All Funds, p.14) and 2023-24 Adopted Budget", adopted="June 27, 2023",
               rev={"GF": F(local=519067626, state=265550256, fed=16385807, other=500000),
                    "CN": F(local=2176933, state=69126, fed=50483205),
                    "DS": F(local=155564363, state=3693999)},
               spend={"CN": 52105472, "DS": 149228071},
               fn={"11": 452855627, "12": 12043156, "13": 12911081, "21": 16651180, "23": 52725631, "31": 46782032,
                   "32": 4924376, "33": 13018700, "34": 22731086, "35": 52496412, "36": 20321670, "41": 26130271,
                   "51": 97547014, "52": 15788569, "53": 30928534, "61": 5146066, "71": 152228071, "81": 1500000,
                   "91": 8422002, "95": 45000, "99": 2963095}),
    2025: dict(doc="Budget Book 2024-2025 (Budget: All Funds, p.14) and 2024-25 Adopted Budget", adopted="June 11, 2024",
               rev={"GF": F(local=462692852, state=347462185, fed=16403057),
                    "CN": F(local=2161260, state=176817, fed=45501350),
                    "DS": F(local=154978343, state=13475846)},
               spend={"CN": 47839427, "DS": 168454189},
               fn={"11": 459832354, "12": 10596117, "13": 9230997, "21": 15680681, "23": 50502537, "31": 43158592,
                   "32": 3059973, "33": 12532797, "34": 23488331, "35": 48188796, "36": 20757789, "41": 26765833,
                   "51": 105414225, "52": 17969059, "53": 26117249, "61": 4617764, "71": 170554189, "81": 1130000,
                   "91": 8154673, "95": 36000, "99": 2714103}),
    # FY2026: the posted adopted-budget PDF covers the General Fund only; Food Service (now fund 240) and Debt Service
    # come from the district's PEIMS budget submission to TEA (budget2026.csv).
    2026: dict(doc="2025-26 Adopted Budget (General Fund) + TEA PEIMS budget file for Food Service and Debt Service", adopted="June 10, 2025",
               rev={"GF": F(local=457911481, state=360143391, fed=7517250, other=600000),
                    "CN": F(local=2279864, state=170701, fed=44307974),
                    "DS": F(local=130091909, state=19630328)},
               spend={"CN": 58825772, "DS": 149722237},
               fn={"11": 486260339, "12": 10893509, "13": 10071313, "21": 13569206, "23": 51682352, "31": 43612794,
                   "32": 3643293, "33": 12194690, "34": 22462312, "35": 125385 + 58790645, "36": 21466336,
                   "41": 25019748 + 12700 + 15000, "51": 97181544 + 35127, "52": 18781032, "53": 29925515, "61": 4143198,
                   "71": 2100000 + 149722237, "81": 3365424, "91": 9987912, "95": 30960, "99": 3187301}),
    2027: dict(doc="2026-27 Adopted Budget (all official funds combined; no fund split published)", adopted="June 23, 2026",
               rev={"ALL": F(local=596480769, state=399475770, fed=52922449)},
               fn={"11": 510880224, "12": 10353509, "13": 10974457, "21": 21129905, "23": 54271487, "31": 45894044,
                   "32": 3095827, "33": 12374297, "34": 24405852, "35": 49444138, "36": 21608807, "41": 23281173 + 15000 + 10000,
                   "51": 93750216, "52": 17287110, "53": 34221491, "61": 4035237, "71": 147551976, "81": 3244891,
                   "91": 7662000, "95": 30960, "99": 3200000}),
}
CHECK = {2023: 986314146, 2024: 1048159574, 2025: 1060502059, 2027: 1098722601}
budget = {}
for yr, b in BUDGET.items():
    tot = sum(b["fn"].values())
    if yr in CHECK: assert abs(tot - CHECK[yr]) <= 5, (yr, tot, CHECK[yr])  # PDF rounding
    uses = defaultdict(int)
    for fn, v in b["fn"].items(): uses[FUNC2USE[fn]] += v
    rev = defaultdict(int)
    links = []
    srcmap = {"local": "b_local", "state": "b_state", "fed": "b_fed", "other": "b_other"}
    if "ALL" not in b["rev"]:
        spend = dict(b["spend"]); spend["GF"] = tot - spend["CN"] - spend["DS"]
        for g, parts in b["rev"].items():
            for k, v in parts.items():
                if g == "CN" and k == "fed": key = "b_fedcn"
                elif k == "fed": key = "b_fed"
                else: key = srcmap[k]
                rev[key] += v
                links.append([key, g, v])
        # fund -> uses: CN = food(+ops), DS = debt, GF = rest
        cn_food = min(spend["CN"], uses["food"])
        links.append(["CN", "food", cn_food])
        if spend["CN"] - cn_food > 0: links.append(["CN", "ops", spend["CN"] - cn_food])
        links.append(["DS", "debt", spend["DS"]])
        for u, v in uses.items():
            v2 = v - (cn_food if u == "food" else 0) - (spend["CN"] - cn_food if u == "ops" else 0) - (spend["DS"] if u == "debt" else 0)
            if v2 > 0: links.append(["GF", u, v2])
        for g in ("GF", "CN", "DS"):
            gap = spend[g] - sum(v for s, f, v in links if f == g)
            if gap > 5e5: links.append(["bal_in", g, gap])
            elif gap < -5e5: links.append([g, "bal_out", -gap])
    else:
        p = b["rev"]["ALL"]
        rev.update({"b_local": p["local"], "b_state": p["state"], "b_fed": p["fed"]})
        links = [["b_local", "OFF", p["local"]], ["b_state", "OFF", p["state"]], ["b_fed", "OFF", p["fed"]]]
        links += [["OFF", u, v] for u, v in uses.items() if v > 0]
        gap = tot - sum(p.values())
        if gap > 0: links.append(["bal_in", "OFF", gap])
    budget[yr] = {"doc": b["doc"], "adopted": b["adopted"], "total": tot, "rev": dict(rev), "use": dict(uses), "links": links}

# ---------------------------------------------------------------- TDA meals
def num(r, *ks):
    return sum(float(r.get(k) or 0) for k in ks)

meals = {}
for y in range(2016, 2027):
    m = {"sy": f"{y-1}-{str(y)[2:]}"}
    p = f"{RAW}/tda/snp{y}.json"
    d = json.load(open(p)) if os.path.exists(p) else []
    if d:
        octo = [r for r in d if r["claimdate"][5:7] == "10" and num(r, "enrollmentqty") > 0]
        enr = sum(num(r, "enrollmentqty") for r in octo)
        free = sum(num(r, "freeeligqty", "freeeligibleqty") for r in octo)
        red = sum(num(r, "redceligqty", "reducedeligibleqty") for r in octo)
        allfree = sum(1 for r in octo if abs(num(r, "freeeligqty", "freeeligibleqty") - num(r, "enrollmentqty")) < 1)
        m.update(
            sites=len({r["siteid"] for r in d}), octSites=len(octo), sitesAllFree=allfree,
            enroll=r0(enr), freeElig=r0(free), redElig=r0(red),
            breakfasts=r0(sum(num(r, "breakfasttotal") for r in d)),
            lunches=r0(sum(num(r, "lunchtotal") for r in d)),
            snacks=r0(sum(num(r, "snacktotal") for r in d)),
            paidLunches=r0(sum(num(r, "lunchservedpaid") for r in d)),
            reimbB=r0(sum(num(r, "breakfastreimbursement") for r in d)),
            reimbL=r0(sum(num(r, "lunchreimbursement") for r in d)),
            reimbS=r0(sum(num(r, "snackreimbursement", "milkreimbursement") for r in d)),
        )
        months = defaultdict(float)
        for r in d: months[r["claimdate"][:7]] += num(r, "totalreimbursement")
        m["monthly"] = {k: r0(v) for k, v in sorted(months.items()) if v > 0}
    for kind in ("sso", "cacfp"):
        p = f"{RAW}/tda/{kind}{y}.json"
        d = json.load(open(p)) if os.path.exists(p) else []
        if kind == "sso":
            m["ssoReimb"] = r0(sum(num(r, "totalreimbursement") for r in d))
            m["ssoMeals"] = r0(sum(num(r, "breakfastmealsreimbursed", "lunchmealsreimbursed", "suppermealsreimbursed",
                                       "amsnackmealsreimbursed", "pmsnackmealsreimbursed") for r in d))
        else:
            m["cacfpReimb"] = r0(sum(num(r, "totalreimbursement") for r in d))
            m["cacfpMeals"] = r0(sum(num(r, "totalmeals_snacks", "totalmealssnacks") for r in d))
    meals[y] = m

# CPI-U (CPIAUCNS, FRED), July-June fiscal-year averages. FY2027 = Jul-Sep 2026 only.
CPI = {2011: 221.09, 2012: 227.56, 2013: 231.35, 2014: 234.97, 2015: 236.68, 2016: 238.27, 2017: 242.66,
       2018: 248.13, 2019: 253.27, 2020: 257.23, 2021: 263.15, 2022: 282.03, 2023: 299.69, 2024: 309.57,
       2025: 317.73, 2026: 327.67, 2027: 335.28}

data = {
    "built": "2026-11-06",
    "cpi": CPI,
    "funds": FUNDS,
    "uses": [[k, n] for k, n, _ in USES],
    "sources": SOURCES,
    "fedPrograms": FED_PROGRAMS,
    "actual": actual,
    "budget": budget,
    "meals": meals,
}
# OUT is the page: the data is inlined between the DATA markers so the HTML stays a single self-contained file.
blob = "window.FWISD=" + json.dumps(data, separators=(",", ":")) + ";"
page = open(OUT).read()
a, b = "/*DATA*/", "/*/DATA*/"
i, j = page.index(a) + len(a), page.index(b)
page = page[:i] + blob + page[j:]
open(OUT, "w").write(page)
print("inlined", len(blob), "bytes of data into", OUT)
