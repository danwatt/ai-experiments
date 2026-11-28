#!/usr/bin/env python3
"""Build the school-level dataset for Fort Worth, Eagle Mountain-Saginaw, Lake Worth and Castleberry ISDs
and inline it into index.html.

Inputs (downloaded by fetch.sh, not committed):
  RAW/tea/a20XX.csv              TEA PEIMS district actual financial data for the four districts. FIN_UNIT is the
                                 campus number; 7xx-999 are district-wide units.
  RAW/tda/snpYYYY.json           TDA school-meal claims, one row per school per month (site id = campus number)
  RAW/nces/dir_YYYY_LEAID.json   NCES CCD school directory via the Urban Institute Education Data API
                                 (seasch links NCES schools to TEA campus numbers)
  RAW/nces/edge_2425.json        NCES EDGE 2024-25 school administrative data
  RAW/geo/districts.json         Census TIGERweb district boundaries

Spending amounts are stored in thousands of dollars.
Usage: python3 build_data.py RAW_DIR ../index.html
"""
import csv, glob, json, os, re, sys
from collections import defaultdict

RAW, OUT = sys.argv[1], sys.argv[2]
DIST = {  # TEA id: (name, NCES LEAID, TDA contracting entity)
    "220905": ("Fort Worth ISD", "4819700", "01020"),
    "220918": ("Eagle Mountain-Saginaw ISD", "4817700", "01030"),
    "220910": ("Lake Worth ISD", "4826490", "01024"),
    "220917": ("Castleberry ISD", "4813170", "01029"),
}
CE2D = {v[2]: k for k, v in DIST.items()}
LEA2D = {v[1]: k for k, v in DIST.items()}
YEARS = list(range(2011, 2026))
MY = list(range(2016, 2027))

# ---------------------------------------------------------------- spending by campus
COVID = {"266", "277", "279", "281", "282", "283", "284", "285"}
CN_FUNDS = {"701", "240", "101", "242"}
def fund_kind(f, yr):
    """None = excluded (debt service, capital projects, internal service, fiduciary)."""
    if f in CN_FUNDS: return "cn"
    if f in ("599", "699") or f[0] in "789": return None
    if f[0] in "23":
        if f in ("211", "276"): return "t1"
        if f in ("224", "225", "226", "313", "314", "315"): return "sped"
        if yr >= 2020 and f in COVID: return "covid"
        return "fedoth"
    return "sl"                                          # General Fund and state/local grants
FUNC = {"11": "instr", "95": "instr", "12": "supp", "13": "supp", "21": "supp", "23": "supp",
        "31": "stud", "32": "stud", "33": "stud", "35": "food"}
SKEYS = ["instr", "supp", "stud", "food", "other", "sl", "t1", "sped", "covid", "fedoth", "cn"]

spend = defaultdict(lambda: defaultdict(lambda: [0.0] * len(SKEYS)))   # campus -> year -> values
dwide = defaultdict(lambda: defaultdict(float))                         # district -> year -> district-wide spending
for path in sorted(glob.glob(f"{RAW}/tea/a20*.csv")):
    yr = int(os.path.basename(path)[1:5])
    for r in csv.DictReader(open(path, encoding="latin-1")):
        if r["OBJECT"][:1] != "6": continue
        k = fund_kind(r["FUND"], yr)
        if not k: continue
        try: a = float(r["ACTAMT"])
        except ValueError: continue
        d, u = r["DISTRICT"], r["FIN_UNIT"]
        if not re.fullmatch(r"\d{3}", u) or u >= "700" or u == "000":
            dwide[d][yr] += a; continue
        v = spend[d + u][yr]
        v[SKEYS.index(FUNC.get(r["FUNCTION"], "other"))] += a
        v[SKEYS.index(k)] += a

# ---------------------------------------------------------------- NCES directory
LEVEL = {1: "Elementary", 2: "Middle", 3: "High", 4: "Other"}
def grade(g):
    return {-1: "PK", 0: "K"}.get(g, str(g)) if isinstance(g, int) and g >= -1 else None
nces = defaultdict(dict)       # campus -> FY -> record
for path in glob.glob(f"{RAW}/nces/dir_*.json"):
    d = json.load(open(path))
    for r in d.get("results", []):
        m = re.match(r"(?:\d{6}-)?(\d{9})$", r.get("seasch") or "")   # "220917101" before 2016-17, "220917-220917101" after
        if not m or r["leaid"] not in LEA2D: continue
        nces[m.group(1)][r["year"] + 1] = r
ncessch2campus = {r["ncessch"]: c for c, by in nces.items() for r in by.values()}
edge = json.load(open(f"{RAW}/nces/edge_2425.json")).get("features", [])
unmatched_edge = []
for f in edge:
    a = f["attributes"]
    c = ncessch2campus.get(a["NCESSCH"])
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

# ---------------------------------------------------------------- TDA meal claims by school
def num(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0
meals = defaultdict(dict)
names_tda = {}
for y in MY:
    p = f"{RAW}/tda/snp{y}.json"
    rows = json.load(open(p)) if os.path.exists(p) else []
    agg = defaultdict(lambda: {"e": 0, "f": 0, "r": 0, "l": 0, "b": 0, "reimb": 0, "ladp": [], "badp": [], "mon": defaultdict(float)})
    for r in rows:
        d = CE2D.get(r["ceid"])
        if not d: continue
        c = d + r["siteid"][-3:]
        names_tda[c] = r["sitename"]
        a = agg[c]
        if r["claimdate"][5:7] == "10" and num(r.get("enrollmentqty")) > 0:
            a["e"] += num(r.get("enrollmentqty")); a["f"] += num(r.get("freeeligqty")) + num(r.get("freeeligibleqty"))
            a["r"] += num(r.get("redceligqty")) + num(r.get("reducedeligibleqty"))
        a["l"] += num(r.get("lunchtotal")); a["b"] += num(r.get("breakfasttotal")); a["reimb"] += num(r.get("totalreimbursement"))
        if num(r.get("lunchdays")) >= 10:
            a["ladp"].append(num(r.get("lunchadp"))); a["badp"].append(num(r.get("breakfastadp")))
        a["mon"][r["claimdate"][:7]] += num(r.get("totalreimbursement"))
    for c, a in agg.items():
        meals[c][y] = {"e": round(a["e"]), "f": round(a["f"]), "r": round(a["r"]), "l": round(a["l"]), "b": round(a["b"]),
                       "reimb": round(a["reimb"]),
                       "ladp": round(sum(a["ladp"]) / len(a["ladp"])) if a["ladp"] else None,
                       "badp": round(sum(a["badp"]) / len(a["badp"])) if a["badp"] else None,
                       "mon": dict(a["mon"]) if y >= 2025 else None}

# ---------------------------------------------------------------- assemble schools
def title(n):
    n = " ".join(w if re.fullmatch(r"(H|J|EL|MS|HS|II|III|IV|STEM|TCC|ECC|DAEP|JJAEP|AEC|ECHS|CTE|K-8)", w) else w.capitalize()
                 for w in re.split(r"\s+", n.strip()))
    n = re.sub(r"\bEl\b|\bEL\b", "Elementary", n)
    n = re.sub(r"\bH S\b", "High School", n)
    n = re.sub(r"\bJ H\b", "Junior High", n)
    n = re.sub(r"\bMs\b|\bMS\b", "Middle School", n)
    n = re.sub(r"(?<=[-/])([a-z])", lambda m: m.group(1).upper(), n)
    n = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), n)
    return n.replace(" Of ", " of ").replace(" And ", " and ").replace(" At ", " at ")

campuses = set(spend) | set(meals) | set(nces)
schools = []
for c in sorted(campuses):
    d = c[:6]
    if d not in DIST: continue
    by = nces.get(c, {})
    latest = by[max(by)] if by else {}
    loc = next((by[y] for y in sorted(by, reverse=True) if pos(by[y].get("latitude") or -1) is not None or (by[y].get("latitude") or 0) > 0), {})
    sp = spend.get(c, {})
    m = meals.get(c, {})
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
        "lat": loc.get("latitude"), "lon": loc.get("longitude"),
        "addr": f"{title(loc.get('street_location') or '')}, {title(loc.get('city_location') or '')}" if loc.get("street_location") else None,
        "open": open25 or (bool(sp.get(2025)) and sum(sp[2025][:5]) > 5e5),
        "enr": [pos(by[y].get("enrollment")) if y in by else None for y in YEARS],
        "frl": [pos(by[y].get("free_or_reduced_price_lunch")) if y in by else None for y in YEARS],
        "tch": [pos(by[y].get("teachers_fte")) if y in by else None for y in YEARS],
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

CPI = {2011: 221.09, 2012: 227.56, 2013: 231.35, 2014: 234.97, 2015: 236.68, 2016: 238.27, 2017: 242.66,
       2018: 248.13, 2019: 253.27, 2020: 257.23, 2021: 263.15, 2022: 282.03, 2023: 299.69, 2024: 309.57,
       2025: 317.73, 2026: 327.67}
data = {
    "built": "2026-11-07", "cpi": CPI, "years": YEARS, "mealYears": MY, "skeys": SKEYS,
    "districts": [{"id": k, "n": v[0]} for k, v in DIST.items()],
    "dwide": {d: [round(dwide[d].get(y, 0) / 1000) for y in YEARS] for d in DIST},
    "schools": schools, "bounds": bounds,
}
blob = "window.SCH=" + json.dumps(data, separators=(",", ":")) + ";"
page = open(OUT).read()
a, b = "/*DATA*/", "/*/DATA*/"
i, j = page.index(a) + len(a), page.index(b)
open(OUT, "w").write(page[:i] + blob + page[j:])
openS = [s for s in schools if s["open"]]
print(f"{len(schools)} campuses ({len(openS)} open in FY2025, {sum(1 for s in openS if s['lat'])} with coordinates), "
      f"{len(bounds)} boundaries; {len(blob) / 1e6:.2f} MB inlined")
print("EDGE schools not matched to a TEA campus:", unmatched_edge)
print("open without coordinates:", [s["n"] for s in openS if not s["lat"]])
