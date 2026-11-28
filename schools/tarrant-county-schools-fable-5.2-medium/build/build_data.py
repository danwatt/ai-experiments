#!/usr/bin/env python3
"""Build the dataset for the Tarrant County schools explorer and inline it into index.html.

One pass over the same raw files gives three levels of detail for the 16 Tarrant County ISDs:
  county    every district side by side (revenue sources, spending by function, meal claims)
  district  one district's money flow (source -> fund -> function), plus Fort Worth ISD's adopted budgets
  school    spending coded to each campus, NCES enrollment and staffing, meal claims by school

Inputs (downloaded by fetch.sh, not committed):
  RAW/tea/a20XX.csv              TEA PEIMS district actual financial data, districts 2209xx. FIN_UNIT is the campus
                                 number; 7xx-999 are district-wide units.
  RAW/tea/summ.json              TEA "Summarized PEIMS Actual Financial Data" rows (names, fall enrollment)
  RAW/tda/snpYYYY.json           TDA school-meal claims, one row per school per month (site id = campus number)
  RAW/tda/ssoYYYY.json, cacfpYYYY.json   TDA Seamless Summer Option and after-school supper claims
  RAW/nces/dir_YYYY_LEAID.json   NCES CCD school directory via the Urban Institute Education Data API
  RAW/nces/edge_2425.json        NCES EDGE 2024-25 school administrative data
  RAW/geo/districts.json         Census TIGERweb district boundaries

Fort Worth ISD adopted-budget figures (FY2023-FY2027) are transcribed below from the district's PDFs.
District amounts are in dollars; school amounts are in thousands of dollars.

Usage: python3 build_data.py RAW_DIR ../index.html
"""
import csv, datetime, glob, json, os, re, sys
from collections import defaultdict

RAW, OUT = sys.argv[1], sys.argv[2]

# TEA district number -> (short name, TDA contracting-entity id, NCES/Census district id)
DISTRICTS = {
    "220901": ("Arlington", "01017", "4808700"), "220902": ("Birdville", "01018", "4810230"),
    "220904": ("Everman", "01019", "4818810"), "220905": ("Fort Worth", "01020", "4819700"),
    "220906": ("Grapevine-Colleyville", "01021", "4821660"), "220907": ("Keller", "01022", "4825260"),
    "220908": ("Mansfield", "01023", "4828920"), "220910": ("Lake Worth", "01024", "4826490"),
    "220912": ("Crowley", "01025", "4815910"), "220914": ("Kennedale", "01026", "4825500"),
    "220915": ("Azle", "01027", "4809200"), "220916": ("Hurst-Euless-Bedford", "01028", "4824060"),
    "220917": ("Castleberry", "01029", "4813170"), "220918": ("Eagle Mountain-Saginaw", "01030", "4817700"),
    "220919": ("Carroll", "01031", "4813020"), "220920": ("White Settlement", "01032", "4845540"),
}
CE2D = {v[1]: k for k, v in DISTRICTS.items()}
LEA2D = {v[2]: k for k, v in DISTRICTS.items()}
YEARS = list(range(2011, 2026))
MY = list(range(2016, 2027))

# ================================================================ categories
FUNDS = {
    "GF": "General Fund",
    "CN": "Child Nutrition Fund",
    "FG": "Federal grant funds",
    "SL": "State & local grant funds",
    "DS": "Debt Service Fund",
    "CP": "Capital Projects (bonds)",
}
# food service: enterprise fund 701, special revenue 240, General Fund-group 101 (Everman), 242 summer feeding
# (pandemic meals in Arlington and Hurst-Euless-Bedford)
CN_FUNDS = {"701", "240", "101", "242"}

def fund_group(f):
    if f == "199": return "GF"
    if f in CN_FUNDS: return "CN"
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
COVID_FUNDS = {"281", "282", "283", "284", "285", "279", "277"}   # from FY2020
ARRA_FUNDS = {"283", "284", "285", "286", "287"}                  # through FY2013
T1_FUNDS = {"211", "276"}
SPED_FUNDS = {"224", "225", "226", "313", "314", "315"}

def fed_cat(fund, obj, yr):
    if fund in CN_FUNDS or obj in ("5921", "5922", "5923"): return "fed_cn"
    if fund == "266": return "fed_covid" if yr >= 2020 else "fed_arra"
    if yr >= 2020 and fund in COVID_FUNDS: return "fed_covid"
    if yr <= 2013 and fund in ARRA_FUNDS: return "fed_arra"
    if fund in T1_FUNDS: return "fed_t1"
    if fund in SPED_FUNDS: return "fed_sped"
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

CN_OBJ = {"7952": "breakfast", "7953": "lunch", "7954": "commodities", "7955": "other",
          "5921": "breakfast", "5922": "lunch", "5923": "commodities"}

# ---- school level: which fund pays (None = debt service, capital projects, internal service, fiduciary)
def campus_fund(f, yr):
    if f in CN_FUNDS: return "cn"
    if f in ("599", "699") or f[0] in "789": return None
    if f[0] in "23":
        if f in T1_FUNDS: return "t1"
        if f in SPED_FUNDS: return "sped"
        if yr >= 2020 and (f in COVID_FUNDS or f == "266"): return "covid"
        return "fedoth"
    return "sl"                                          # General Fund and state/local grants
CAMPUS_FUNC = {"11": "instr", "95": "instr", "12": "supp", "13": "supp", "21": "supp", "23": "supp",
               "31": "stud", "32": "stud", "33": "stud", "35": "food"}
SKEYS = ["instr", "supp", "stud", "food", "other", "sl", "t1", "sped", "covid", "fedoth", "cn"]
SI = {k: i for i, k in enumerate(SKEYS)}

def r0(x): return int(round(x))

# ================================================================ TEA actuals: districts and campuses in one pass
summ = json.load(open(f"{RAW}/tea/summ.json"))
enroll = defaultdict(dict)
names = {}
for r in summ:
    d = str(r["DISTRICT NUMBER"]).strip("'")
    names[d] = r["DISTRICT NAME"]
    if d in DISTRICTS and r.get("FALL SURVEY ENROLLMENT"):
        enroll[d][int(r["YEAR"])] = int(float(r["FALL SURVEY ENROLLMENT"]))

fin = defaultdict(dict)                                                 # district -> year -> record
spend = defaultdict(lambda: defaultdict(lambda: [0.0] * len(SKEYS)))    # campus -> year -> values
dwide = defaultdict(lambda: defaultdict(float))                         # district -> year -> district-wide spending
for path in sorted(glob.glob(f"{RAW}/tea/a20*.csv")):
    yr = int(os.path.basename(path)[1:5])
    src = defaultdict(lambda: defaultdict(float))
    fund_src = defaultdict(lambda: defaultdict(float))       # district -> (source, fund group)
    fund_use = defaultdict(lambda: defaultdict(float))       # district -> (fund group, use)
    cn = defaultdict(lambda: defaultdict(float))
    for r in csv.DictReader(open(path, encoding="latin-1")):
        d = r["DISTRICT"]
        if d not in DISTRICTS: continue
        fund, obj, fn = r["FUND"], r["OBJECT"], r["FUNCTION"]
        try: a = float(r["ACTAMT"])
        except ValueError: continue
        # --- district level
        g = fund_group(fund)
        if g:
            s = src_of(fund, obj, yr)
            if s:
                src[d][s] += a; fund_src[d][(s, g)] += a
                if g == "CN":
                    if s == "fed_cn": cn[d][CN_OBJ.get(obj, "other")] += a
                    elif obj == "5751": cn[d]["sales"] += a
                    else: cn[d]["otherLocalState"] += a
            elif obj[:1] == "6":
                u = FUNC2USE.get(fn) or ("admin" if fn == "41" else "ops")
                fund_use[d][(g, u)] += a
                if g == "CN": cn[d]["spent"] += a
        # --- school level
        if obj[:1] == "6":
            k = campus_fund(fund, yr)
            if k:
                u = r["FIN_UNIT"]
                if not re.fullmatch(r"\d{3}", u) or u >= "700" or u == "000":
                    dwide[d][yr] += a
                else:
                    v = spend[d + u][yr]
                    v[SI[CAMPUS_FUNC.get(fn, "other")]] += a
                    v[SI[k]] += a
    for d in DISTRICTS:
        if d not in src: continue
        links = []                                   # Sankey: source -> fund -> use, each fund balanced
        for g in FUNDS:
            rin = sum(v for (s, f), v in fund_src[d].items() if f == g)
            rout = sum(v for (f, u), v in fund_use[d].items() if f == g)
            links += [[s, g, r0(v)] for (s, f), v in fund_src[d].items() if f == g and v >= 500]
            links += [[g, u, r0(v)] for (f, u), v in fund_use[d].items() if f == g and v >= 500]
            gap = rout - rin
            if gap > 5e5: links.append(["bal_in", g, r0(gap)])
            elif gap < -5e5: links.append([g, "bal_out", r0(-gap)])
        uses = defaultdict(float)
        for (f, u), v in fund_use[d].items(): uses[u] += v
        fin[d][yr] = {
            "e": enroll[d].get(yr),
            "s": {k: r0(v) for k, v in src[d].items() if abs(v) >= 500},
            "u": {k: r0(v) for k, v in uses.items() if abs(v) >= 500},
            "cn": {k: r0(v) for k, v in cn[d].items()},
            "links": links,
        }

# ================================================================ Fort Worth ISD adopted budgets (district PDFs)
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
        sp_ = dict(b["spend"]); sp_["GF"] = tot - sp_["CN"] - sp_["DS"]
        for g, parts in b["rev"].items():
            for k, v in parts.items():
                key = "b_fedcn" if (g == "CN" and k == "fed") else srcmap[k]
                rev[key] += v
                links.append([key, g, v])
        # fund -> uses: CN = food(+ops), DS = debt, GF = rest
        cn_food = min(sp_["CN"], uses["food"])
        links.append(["CN", "food", cn_food])
        if sp_["CN"] - cn_food > 0: links.append(["CN", "ops", sp_["CN"] - cn_food])
        links.append(["DS", "debt", sp_["DS"]])
        for u, v in uses.items():
            v2 = v - (cn_food if u == "food" else 0) - (sp_["CN"] - cn_food if u == "ops" else 0) - (sp_["DS"] if u == "debt" else 0)
            if v2 > 0: links.append(["GF", u, v2])
        for g in ("GF", "CN", "DS"):
            gap = sp_[g] - sum(v for s, f, v in links if f == g)
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

# ================================================================ TDA meal claims: by district and by school
def num(r, *ks):
    t = 0.0
    for k in ks:
        try: t += float(r.get(k) or 0)
        except (TypeError, ValueError): pass
    return t
free_of = lambda r: num(r, "freeeligqty", "freeeligibleqty")
red_of = lambda r: num(r, "redceligqty", "reducedeligibleqty")

def load(kind, y):
    p = f"{RAW}/tda/{kind}{y}.json"
    if not os.path.exists(p): return []
    try: d = json.load(open(p))
    except ValueError: return []
    return d if isinstance(d, list) else []

meals = defaultdict(dict)         # district -> program year -> summary
summer = defaultdict(dict)        # district -> program year -> SSO / CACFP totals
smeals = defaultdict(dict)        # campus -> program year -> summary
names_tda = {}
for y in MY:
    by = defaultdict(list)
    for r in load("snp", y):
        if r.get("ceid") in CE2D: by[CE2D[r["ceid"]]].append(r)
    for d, rs in by.items():
        octo = [r for r in rs if r["claimdate"][5:7] == "10" and num(r, "enrollmentqty") > 0]
        m = {
            "sites": len(octo),
            "allSites": len({r["siteid"] for r in rs}),
            "enroll": r0(sum(num(r, "enrollmentqty") for r in octo)),
            "free": r0(sum(free_of(r) for r in octo)),
            "red": r0(sum(red_of(r) for r in octo)),
            # CEP schools claim no reduced-price students; every non-CEP school of any size has some
            "cepEnroll": r0(sum(num(r, "enrollmentqty") for r in octo if red_of(r) == 0)),
            "allFreeEnroll": r0(sum(num(r, "enrollmentqty") for r in octo if red_of(r) == 0 and free_of(r) >= num(r, "enrollmentqty") - 0.5)),
            "breakfasts": r0(sum(num(r, "breakfasttotal") for r in rs)),
            "lunches": r0(sum(num(r, "lunchtotal") for r in rs)),
            "snacks": r0(sum(num(r, "snacktotal") for r in rs)),
            "paidLunches": r0(sum(num(r, "lunchservedpaid") for r in rs)),
            "reimb": r0(sum(num(r, "totalreimbursement") for r in rs)),
            "reimbB": r0(sum(num(r, "breakfastreimbursement") for r in rs)),
            "reimbL": r0(sum(num(r, "lunchreimbursement") for r in rs)),
            "reimbS": r0(sum(num(r, "snackreimbursement", "milkreimbursement") for r in rs)),
        }
        cep = [(free_of(r) / num(r, "enrollmentqty"), num(r, "enrollmentqty")) for r in octo if red_of(r) == 0]
        if cep: m["cepRate"] = round(sum(f * e for f, e in cep) / sum(e for _, e in cep), 4)
        if y >= 2025:
            mon = defaultdict(float)
            for r in rs: mon[r["claimdate"][:7]] += num(r, "totalreimbursement")
            m["monthly"] = {k: r0(v) for k, v in sorted(mon.items()) if v > 0}
        meals[d][y] = m
        # --- by school
        agg = defaultdict(lambda: {"e": 0, "f": 0, "r": 0, "l": 0, "b": 0, "reimb": 0, "ladp": [], "badp": [], "mon": defaultdict(float)})
        for r in rs:
            c = d + r["siteid"][-3:]
            names_tda[c] = r.get("sitename") or names_tda.get(c)
            a = agg[c]
            if r["claimdate"][5:7] == "10" and num(r, "enrollmentqty") > 0:
                a["e"] += num(r, "enrollmentqty"); a["f"] += free_of(r); a["r"] += red_of(r)
            a["l"] += num(r, "lunchtotal"); a["b"] += num(r, "breakfasttotal"); a["reimb"] += num(r, "totalreimbursement")
            if num(r, "lunchdays") >= 10:
                a["ladp"].append(num(r, "lunchadp")); a["badp"].append(num(r, "breakfastadp"))
            a["mon"][r["claimdate"][:7]] += num(r, "totalreimbursement")
        for c, a in agg.items():
            smeals[c][y] = {"e": round(a["e"]), "f": round(a["f"]), "r": round(a["r"]), "l": round(a["l"]), "b": round(a["b"]),
                            "reimb": round(a["reimb"]),
                            "ladp": round(sum(a["ladp"]) / len(a["ladp"])) if a["ladp"] else None,
                            "badp": round(sum(a["badp"]) / len(a["badp"])) if a["badp"] else None,
                            "mon": dict(a["mon"]) if y >= 2025 else None}
    sso = defaultdict(lambda: [0.0, 0.0]); cac = defaultdict(lambda: [0.0, 0.0])
    for r in load("sso", y):
        d = CE2D.get(r.get("ceid"))
        if d:
            sso[d][0] += num(r, "totalreimbursement")
            sso[d][1] += num(r, "breakfastmealsreimbursed", "lunchmealsreimbursed", "suppermealsreimbursed",
                             "amsnackmealsreimbursed", "pmsnackmealsreimbursed")
    for r in load("cacfp", y):
        d = CE2D.get(r.get("ceid"))
        if d:
            cac[d][0] += num(r, "totalreimbursement")
            cac[d][1] += num(r, "totalmeals_snacks", "totalmealssnacks")
    for d in set(sso) | set(cac):
        summer[d][y] = {"ssoReimb": r0(sso[d][0]), "ssoMeals": r0(sso[d][1]), "cacfpReimb": r0(cac[d][0]), "cacfpMeals": r0(cac[d][1])}

# ================================================================ NCES school directory
LEVEL = {1: "Elementary", 2: "Middle", 3: "High", 4: "Other"}
def grade(g):
    return {-1: "PK", 0: "K"}.get(g, str(g)) if isinstance(g, int) and g >= -1 else None
nces = defaultdict(dict)       # campus -> FY -> record
for path in glob.glob(f"{RAW}/nces/dir_*.json"):
    try: d = json.load(open(path))
    except ValueError: print("unreadable:", path); continue
    for r in d.get("results", []):
        m = re.match(r"(?:\d{6}-)?(\d{9})$", r.get("seasch") or "")   # "220917101" before 2016-17, "220917-220917101" after
        if not m or m.group(1)[:6] not in DISTRICTS: continue
        nces[m.group(1)][r["year"] + 1] = r
ncessch2campus = {r["ncessch"]: c for c, by in nces.items() for r in by.values()}
edge = json.load(open(f"{RAW}/nces/edge_2425.json")).get("features", [])
unmatched_edge = []
for f in edge:
    a = f["attributes"]
    c = ncessch2campus.get(a["NCESSCH"])
    if not c:                                           # a school new in 2024-25: use the state id in the EDGE record
        m = re.search(r"(\d{9})$", str(a.get("ST_SCHID") or ""))
        c = m.group(1) if m and m.group(1)[:6] in DISTRICTS else None
    if not c:
        unmatched_edge.append(a["SCH_NAME"]); continue
    nces[c][2025] = {
        "school_name": a["SCH_NAME"], "latitude": a["LATCOD"], "longitude": a["LONCOD"], "enrollment": a["TOTAL"],
        "free_or_reduced_price_lunch": a["TOTFRL"], "teachers_fte": a["FTE"],
        "school_level": {"Elementary": 1, "Middle": 2, "High": 3}.get(a["SCHOOL_LEVEL"], 4),
        "street_location": a["LSTREET1"], "city_location": a["LCITY"], "school_status": 1 if a["SY_STATUS_TEXT"] != "Closed" else 2,
        "gslo": a["GSLO"], "gshi": a["GSHI"],
    }

def pos(x):
    return x if isinstance(x, (int, float)) and x >= 0 else None
def rnd1(x):
    return None if x is None else round(x, 1)

def title(n):
    n = " ".join(w if re.fullmatch(r"(H|J|EL|MS|HS|II|III|IV|STEM|TCC|ECC|DAEP|JJAEP|AEC|ECHS|CTE|K-8|ISD|YMLA|YWLA|TABS|VPA)", w) else w.capitalize()
                 for w in re.split(r"\s+", n.strip()))
    n = re.sub(r"\bEl\b|\bEL\b", "Elementary", n)
    n = re.sub(r"\bH S\b", "High School", n)
    n = re.sub(r"\bJ H\b", "Junior High", n)
    n = re.sub(r"\bMs\b|\bMS\b", "Middle School", n)
    n = re.sub(r"(?<=[-/])([a-z])", lambda m: m.group(1).upper(), n)
    n = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), n)
    return n.replace(" Of ", " of ").replace(" And ", " and ").replace(" At ", " at ")

schools = []
for c in sorted(set(spend) | set(smeals) | set(nces)):
    d = c[:6]
    if d not in DISTRICTS: continue
    by = nces.get(c, {})
    latest = by[max(by)] if by else {}
    loc = next((by[y] for y in sorted(by, reverse=True) if (by[y].get("latitude") or 0) > 0), {})
    sp = spend.get(c, {})
    m = smeals.get(c, {})
    tot = [round(sum(sp[y][:5]) / 1000) if y in sp else None for y in YEARS]
    if not any(tot) and not m: continue
    open25 = 2025 in by and by[2025].get("school_status", 1) != 2
    lvl = latest.get("school_level")
    gl = latest.get("gslo") or grade(latest.get("lowest_grade_offered"))
    gh = latest.get("gshi") or grade(latest.get("highest_grade_offered"))
    name = latest.get("school_name") or names_tda.get(c) or f"Unnamed campus {c[-3:]}"
    lv = LEVEL.get(lvl, "Other")
    if lv == "Other":                                     # newer schools sometimes lack a level code
        for word, l2 in (("High", "High"), ("Middle", "Middle"), ("Elementary", "Elementary"), (" El", "Elementary")):
            if re.search(rf"{word}\b", title(name)): lv = l2; break
    s = {
        "id": c, "d": d, "n": title(name), "lvl": lv,
        "gr": f"{str(gl).lstrip('0') or '0'}–{str(gh).lstrip('0') or '0'}".replace("0–", "K–") if gl and gh else None,
        "lat": round(loc["latitude"], 5) if loc.get("latitude") else None,
        "lon": round(loc["longitude"], 5) if loc.get("longitude") else None,
        "addr": f"{title(loc.get('street_location') or '')}, {title(loc.get('city_location') or '')}" if loc.get("street_location") else None,
        "open": open25 or (bool(sp.get(2025)) and sum(sp[2025][:5]) > 5e5),
        "enr": [pos(by[y].get("enrollment")) if y in by else None for y in YEARS],
        "frl": [pos(by[y].get("free_or_reduced_price_lunch")) if y in by else None for y in YEARS],
        "tch": [rnd1(pos(by[y].get("teachers_fte"))) if y in by else None for y in YEARS],
        "sp": {k: [round(sp[y][i] / 1000) if y in sp else None for y in YEARS] for i, k in enumerate(SKEYS)},
    }
    if m:
        s["m"] = {k: [m[y][k] if y in m else None for y in MY] for k in ("e", "f", "r", "l", "b", "reimb", "ladp", "badp")}
        a, b = (m.get(2025) or {}).get("mon") or {}, (m.get(2026) or {}).get("mon") or {}
        x = z = 0
        for k, v in a.items():
            k2 = f"{int(k[:4]) + 1}{k[4:]}"
            if b.get(k2): x += v; z += b[k2]
        s["m"]["match"] = [round(x), round(z)]
    schools.append(s)

geo = json.load(open(f"{RAW}/geo/districts.json"))
bounds = {LEA2D[f["properties"]["GEOID"]]: f["geometry"] for f in geo["features"] if f["properties"]["GEOID"] in LEA2D}

# CPI-U (CPIAUCNS, FRED), July-June fiscal-year averages. FY2027 = Jul-Sep 2026 only.
CPI = {2011: 221.09, 2012: 227.56, 2013: 231.35, 2014: 234.97, 2015: 236.68, 2016: 238.27, 2017: 242.66,
       2018: 248.13, 2019: 253.27, 2020: 257.23, 2021: 263.15, 2022: 282.03, 2023: 299.69, 2024: 309.57,
       2025: 317.73, 2026: 327.67, 2027: 335.28}

def full_name(d, short):
    return names.get(d, short + " ISD").title().replace("Isd", "ISD").replace("Mt-", "Mountain-")

data = {
    "built": datetime.date.today().isoformat(),
    "cpi": CPI, "years": YEARS, "mealYears": MY, "skeys": SKEYS,
    "districts": [{"id": d, "short": s, "name": full_name(d, s), "ce": ce, "nslp": d in meals} for d, (s, ce, _) in DISTRICTS.items()],
    "funds": FUNDS, "uses": [[k, n] for k, n, _ in USES], "sources": SOURCES,
    "fin": fin, "meals": meals, "summer": summer,
    # Fort Worth ISD only; FY2026-27 enrollment is what the district's own per-pupil budget figures imply
    "budget": {"220905": budget}, "budEnroll": {"220905": {2026: 67491, 2027: 63072}},
    "dwide": {d: [round(dwide[d].get(y, 0) / 1000) for y in YEARS] for d in DISTRICTS},
    "schools": schools, "bounds": bounds,
}
blob = "window.TC=" + json.dumps(data, separators=(",", ":")) + ";"
page = open(OUT).read()
a, b = "/*DATA*/", "/*/DATA*/"
i, j = page.index(a) + len(a), page.index(b)
open(OUT, "w").write(page[:i] + blob + page[j:])

openS = [s for s in schools if s["open"]]
print(f"{len(fin)} districts, {len(schools)} campuses ({len(openS)} open in FY2025, {sum(1 for s in openS if s['lat'])} with coordinates), "
      f"{len(bounds)} boundaries; {len(blob) / 1e6:.2f} MB inlined")
for d, (short, _, _) in DISTRICTS.items():
    n = [s for s in openS if s["d"] == d]
    print(f"  {short:24s} {len(n):4d} open campuses, {sum(1 for s in n if s['lat']):4d} mapped, {sum(1 for s in n if 'm' in s):4d} with meal claims, "
          f"FY2025 revenue ${sum(fin[d][2025]['s'].values()) / 1e6:,.0f}M")
print("EDGE schools not matched to a TEA campus:", unmatched_edge)
print("open without coordinates:", [s["n"] for s in openS if not s["lat"]])
