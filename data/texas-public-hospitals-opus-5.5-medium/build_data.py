#!/usr/bin/env python3
"""Build data.js from CMS Hospital Provider Cost Report CSVs (data.cms.gov).

Usage: python3 -I fetch_sources.py && python3 -I build_data.py   (or ./build.sh for every step)

Reads .sources/ as filled by fetch_sources.py: hcris/ holds the cost report CSVs, levy/ holds the Texas Comptroller's "Special District Rates and Levies"
spreadsheets (YYYY-special-district-rates-levies.xls[x]), tax years 2013 on. Older ones
are no longer linked from comptroller.texas.gov and come from the Internet Archive.
Hospital districts are taxing-unit class 11.

Audited results for the six large systems come from audited/<ccn>-*.json, hand-entered from each
district's audited financial statements (sources listed in each file; check with audited/check.py). Tax year Y's levy is billed in October Y and
due January 31 of Y+1, so it is attached to the cost report period that contains that date.

Keeps Texas hospitals whose CMS "Type of Control" is local government
(8 city-county, 9 county, 11 hospital district/authority, 12 city, 13 other),
labels each report by the calendar year its period midpoint falls in, and folds
CCN changes (critical access conversions etc.) into one entity.
"""
import csv, glob, json, os, re, statistics, sys
from datetime import date, datetime

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, ".sources")
SRC, LEVY_SRC = os.path.join(SOURCES, "hcris"), os.path.join(SOURCES, "levy")
MANIFEST = json.load(open(os.path.join(SOURCES, "manifest.json")))
# data.cms.gov API dataset id per cost report file, so the page can link to one report row
CMS_API = {int(k): v for k, v in MANIFEST["cmsApi"].items()}
FIRST, LAST = 2015, 2024
CONTROL = {"8": "City-county", "9": "County", "11": "Hospital district", "12": "City", "13": "Other government"}

# Not local-government hospitals in practice, or duplicate reports.
EXCLUDE = {
    "450124": "Dell Seton Medical Center: owned and run by Ascension Seton; Central Health (Travis County) funds care there",
    "670116": "Wise Health System Parkway: same cost report as Decatur, would double count",
    "454076": "UTHealth Houston psychiatric center: University of Texas (state) facility",
    "454084": "Austin State Hospital: state psychiatric hospital",
    "453308": "Our Children's House: one partial report",
    "450670": "Tomball Regional: sold to a private system in 2011",
}
# old CCN -> current CCN for the same hospital
ALIAS = {
    "450177": "451387", "450221": "451386", "450754": "451392", "450073": "451384",
    "450085": "671300", "450578": "671301", "450586": "451399", "450620": "451390",
    "450746": "451394", "450078": "670781", "450234": "451382", "451321": "450352",
}
# Display names and ownership for the large urban systems.
SYSTEMS = {
    "450015": ("Parkland Health", "Dallas County Hospital District", "Dallas"),
    "450289": ("Harris Health", "Harris County Hospital District (Ben Taub, LBJ)", "Harris"),
    "450213": ("University Health", "Bexar County Hospital District", "Bexar"),
    "450039": ("JPS Health Network", "Tarrant County Hospital District", "Tarrant"),
    "450686": ("UMC Health System", "Lubbock County Hospital District", "Lubbock"),
    "450024": ("University Medical Center of El Paso", "El Paso County Hospital District", "El Paso"),
    "450133": ("Midland Health", "Midland County Hospital District", "Midland"),
    "450132": ("Medical Center Health System", "Ector County Hospital District", "Ector"),
    "450271": ("Wise Health System", "Decatur and Fort Worth campuses", "Wise"),
    "450330": ("OakBend Medical Center", "Fort Bend County", "Fort Bend"),
    "450352": ("Hunt Regional Healthcare", "Hunt Memorial Hospital District", "Hunt"),
    "450023": ("Citizens Medical Center", "Victoria County", "Victoria"),
}

# CCN -> Comptroller taxing unit (first 7 characters of the TU id) of the hospital district that owns it.
TAX_UNIT = {
    "450213": "015-201", "450015": "057-201", "450289": "101-202", "450039": "220-203", "450686": "152-201",
    "450024": "071-202", "450133": "165-201", "450132": "068-201", "450352": "116-201", "451303": "147-201",
    "450508": "174-201", "450565": "182-201", "450241": "119-201", "450080": "225-201", "450236": "112-201",
    "451377": "195-201", "451330": "163-201", "450154": "233-201", "451392": "097-201", "450465": "158-201",
    "450235": "089-201", "451386": "171-201", "451333": "156-201", "450144": "002-201", "451394": "138-201",
    "450498": "215-201", "451358": "083-201", "450654": "214-201", "450597": "062-201", "450090": "049-201",
    "451384": "208-201", "451389": "186-202", "450108": "247-201", "450369": "038-201", "450055": "177-201",
    "451329": "231-202", "451385": "018-201", "451310": "200-202", "451364": "128-201", "450306": "127-202",
    "450155": "059-201", "450451": "213-201", "451359": "179-201", "450411": "067-204", "451343": "243-201",
    "671301": "106-201", "451331": "056-201", "451314": "248-201", "451320": "036-201", "450584": "244-201",
    "451363": "120-202", "671300": "252-202", "451375": "146-201", "451315": "200-201", "451346": "062-202",
    "451376": "143-201", "451354": "252-201", "451344": "098-201", "451348": "160-201", "451382": "047-203",
    "451399": "012-201", "450489": "058-201", "451342": "168-202", "451351": "153-201", "450253": "008-201",
    "450658": "081-201", "451390": "064-201", "451350": "035-201", "451301": "192-201", "450399": "223-201",
    "450641": "169-201", "451312": "045-202", "451317": "196-201", "451311": "020-202", "451309": "231-201",
    "450460": "229-201", "451324": "218-201", "451353": "052-201", "451349": "219-201", "451300": "185-202",
    "451334": "242-201", "451340": "242-202", "451313": "076-201", "451341": "104-201", "451335": "049-202",
    "451307": "186-201", "451352": "099-202", "451318": "217-201", "451337": "077-201", "450580": "113-202",
    "670781": "127-203", "451325": "048-201", "451372": "009-201", "451366": "040-201", "450243": "127-201",
    "451326": "099-201",
}

def load_levies(folder):
    """{tu7: {tax_year: {levy, taxable, rate}}} and {tu7: name} for hospital districts (class 11)."""
    norm = lambda c: re.sub(r"[^A-Z#]", "", str(c).upper())
    fnum = lambda v: float(v) if str(v).strip() not in ("", "nan", "None") else 0.0
    out, names, counties, where = {}, {}, {}, {}
    for f in sorted(glob.glob(os.path.join(folder, "*"))):
        m = re.match(r"(\d{4})", os.path.basename(f))
        if not m: continue
        ty = int(m.group(1))
        sheets = pd.read_excel(f, sheet_name=None, header=None)
        df = next((v for k, v in sheets.items() if k.upper().startswith("DETAIL")), list(sheets.values())[0])
        hi = next(i for i in range(8) if any("NAME" in str(c).upper() for c in df.iloc[i]))
        H = [norm(c) for c in df.iloc[hi]]
        col = lambda *o: next(i for i, h in enumerate(H) if h in o)
        iid, inm = col("TU#", "TAXINGUNIT#", "TAXINGUNITID"), col("TUNAM", "TUNAME", "TAXINGUNITNAME")
        ilv = next(i for i, h in enumerate(H) if "LEVY" in h)
        irt, itx = col("TOTALRATE", "TOTALTAXRATE"), col("TAXABLEVALUE")
        icl = H.index("CLASS") if "CLASS" in H else None
        icn = next((i for i, h in enumerate(H) if h in ("CADNAME", "COUNTYNAME")), None)
        sheet = next((k for k, v in sheets.items() if v is df), "")
        for rn, r in zip(range(hi + 2, len(df) + 1), df.iloc[hi + 1:].itertuples(index=False)):
            tid = str(r[iid]).strip()
            cls = str(r[icl]).split(".")[0] if icl is not None else (tid.split("-")[2] if tid.count("-") >= 2 else "")
            if cls != "11": continue
            k = tid[:7]
            d = out.setdefault(k, {}).setdefault(ty, {"levy": 0.0, "taxable": 0.0, "rate": 0.0})
            w = where.setdefault(k, {}).setdefault(ty, {"file": os.path.basename(f), "sheet": sheet, "col": str(df.iloc[hi][ilv]).strip(), "ci": ilv, "rows": [],
                                                               "url": MANIFEST["levyUrls"][os.path.basename(f)]})
            w["rows"].append(rn)
            for key, i in (("levy", ilv), ("taxable", itx)):
                try: d[key] += fnum(r[i])
                except ValueError: pass
            try: d["rate"] = max(d["rate"], fnum(r[irt]))
            except ValueError: pass
            names[k] = re.sub(r"[\s*]+$", "", str(r[inm]).strip())
            if icn is not None: counties.setdefault(k, set()).add(re.sub(r"^\d+-", "", str(r[icn]).strip()).title())
    # Drop rows that are clearly keying errors: no levy, or a rate off by 3x or more from the district's median.
    for k, yrs in out.items():
        med = statistics.median([v["rate"] for v in yrs.values() if v["rate"] > 0] or [0])
        for ty, v in list(yrs.items()):
            if v["levy"] <= 0 or not med or not (med / 3 <= v["rate"] <= med * 3):
                yrs[ty] = None
    return out, names, {k: sorted(v) for k, v in counties.items()}, where

LEVY, LEVY_NAMES, LEVY_COUNTIES, LEVY_WHERE = load_levies(LEVY_SRC)

def tax_year_for(start, end):
    """The tax year whose January 31 due date falls inside this report period."""
    for z in range(start.year, end.year + 1):
        if start <= date(z, 1, 31) <= end: return z - 1
    return None


def num(v):
    try: return float(v) if v not in ("", None) else None
    except ValueError: return None

def d(s): return datetime.strptime(s, "%m/%d/%Y").date()

FIELDS = {
    "gross": "Total Patient Revenue", "npr": "Net Patient Revenue",
    "opex": "Less Total Operating Expense", "oinc": "Total Other Income",
    "oexp": "Total Other Expenses", "net": "Net Income",
    "uncomp": "Cost of Uncompensated Care", "charity": "Cost of Charity Care",
    "baddebt": "Total Bad Debt Expense", "medicaid": "Net Revenue from Medicaid",
    "salaries": "Total Salaries From Worksheet A", "assets": "Total Assets",
    # employee benefits (payroll taxes, insurance, retirement) are reported apart from wages
    "wrCore": "Wage-Related Costs (Core)", "wrRhc": "Wage-Related Costs (RHC/FQHC)",
    "wrTeach": "Wage Related Costs for Part - A Teaching Physicians", "wrIr": "Wage Related Costs for Interns and Residents",
    "fund": "Total Fund Balances", "beds": "Number of Beds",
    "fte": "FTE - Employees on Payroll", "dis": "Total Discharges (V + XVIII + XIX + Unknown)",
    "days": "Total Days (V + XVIII + XIX + Unknown)",
}
SUM = [k for k in FIELDS if k not in ("beds", "fte", "assets", "fund")]  # "tax" is never summed: one levy per year

ents = {}
for f in sorted(glob.glob(os.path.join(SRC, "CostReport_*_Final.csv"))):
    for x in csv.DictReader(open(f, encoding="latin-1")):
        if x["State Code"] != "TX" or x["Type of Control"] not in CONTROL: continue
        ccn = x["Provider CCN"]
        if ccn in EXCLUDE: continue
        key = ALIAS.get(ccn, ccn)
        b, e = d(x["Fiscal Year Begin Date"]), d(x["Fiscal Year End Date"])
        mid = b + (e - b) / 2
        fy = mid.year
        if not FIRST <= fy <= LAST: continue
        months = round(((e - b).days + 1) / 30.44)
        rec = {k: num(x[v]) for k, v in FIELDS.items()}
        rec.update(fy=fy, start=b.isoformat(), end=e.isoformat(), months=months)
        rec["src"] = [[int(re.search(r"(\d{4})", os.path.basename(f)).group(1)), x["rpt_rec_num"]]]
        rec["tax"] = None
        tu, ty = TAX_UNIT.get(key), tax_year_for(b, e)
        if tu and ty and LEVY.get(tu, {}).get(ty):
            rec["tax"], rec["taxyear"] = LEVY[tu][ty]["levy"], ty
        ent = ents.setdefault(key, {"ccn": key, "years": {}, "meta": None})
        if ccn == key or ent["meta"] is None:
            ent["meta"] = (x["Hospital Name"], x["City"], x["County"], x["Type of Control"])
        prev = ent["years"].get(fy)
        if prev and prev["start"] != rec["start"] and (prev["end"] < rec["start"] or rec["end"] < prev["start"]):
            # two partial periods in one year (e.g. CCN change mid-year): add them up
            for k in SUM:
                if rec[k] is not None or prev[k] is not None:
                    prev[k] = (prev[k] or 0) + (rec[k] or 0)
            for k in ("beds", "fte", "assets", "fund"):
                if rec["end"] > prev["end"] and rec[k] is not None: prev[k] = rec[k]
            prev["months"] += rec["months"]
            prev["src"] += rec["src"]
            prev["start"], prev["end"] = min(prev["start"], rec["start"]), max(prev["end"], rec["end"])
        elif not prev or rec["months"] > prev["months"]:
            ent["years"][fy] = rec

def r(v, nd=0):
    return None if v is None else round(v, nd)

out = []
for key, ent in ents.items():
    name, city, county, ctl = ent["meta"]
    sysinfo = SYSTEMS.get(key)
    yrs = []
    for fy in sorted(ent["years"]):
        y = ent["years"][fy]
        rev = (y["npr"] or 0) + (y["oinc"] or 0)
        exp = (y["opex"] or 0) + (y["oexp"] or 0)
        yrs.append({
            "fy": fy, "start": y["start"], "end": y["end"], "months": y["months"],
            "rev": r(rev), "exp": r(exp), "npr": r(y["npr"]), "oinc": r(y["oinc"]),
            "opex": r(y["opex"]), "oexp": r(y["oexp"]), "net": r(y["net"]),
            "gross": r(y["gross"]), "uncomp": r(y["uncomp"]), "charity": r(y["charity"]),
            "baddebt": r(y["baddebt"]), "medicaid": r(y["medicaid"]), "salaries": r(y["salaries"]),
            "benefits": None if all(y[k] is None for k in ("wrCore", "wrRhc", "wrTeach", "wrIr")) else r(sum(y[k] or 0 for k in ("wrCore", "wrRhc", "wrTeach", "wrIr"))),
            "assets": r(y["assets"]), "fund": r(y["fund"]), "beds": r(y["beds"]),
            "fte": r(y["fte"], 1), "dis": r(y["dis"]), "days": r(y["days"]),
            "tax": r(y.get("tax")), "src": y["src"],
        })
    if not yrs: continue
    out.append({
        "id": key,
        "name": sysinfo[0] if sysinfo else name.title(),
        "cmsName": name, "owner": sysinfo[1] if sysinfo else None,
        "city": city.title(), "county": (sysinfo[2] if sysinfo else county.title()) or None,
        "control": CONTROL[ctl], "major": bool(sysinfo), "years": yrs,
        "district": LEVY_NAMES.get(TAX_UNIT.get(key)), "tu": TAX_UNIT.get(key),
    })

out.sort(key=lambda e: -max(y["rev"] or 0 for y in e["years"]))

# County FIPS codes from counties.js (build_counties.py) so the page can map hospitals.
_cj = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "counties.js")).read()
_cn = json.loads(_cj[_cj.index("{"):_cj.rindex("}") + 1])["counties"]
FIPS = {re.sub(r"[^A-Z]", "", v["name"].upper()): k for k, v in _cn.items()}
COUNTY_FIX = {"451333": "Martin", "451331": "Dallam"}  # blank county on the cost report
for h in out:
    if h["id"] in COUNTY_FIX: h["county"] = COUNTY_FIX[h["id"]]
    h["fips"] = FIPS.get(re.sub(r"[^A-Z]", "", (h["county"] or "").upper()))
    if not h["fips"]: print("no county match:", h["id"], h["name"])

# Audited statements for the large systems, in dollars, keyed by the same fiscal-year labels.
here_dir = os.path.dirname(os.path.abspath(__file__))
for f in sorted(glob.glob(os.path.join(here_dir, "audited", "*.json"))):
    a = json.load(open(f))
    h = next((x for x in out if x["id"] == a["ccn"]), None)
    if not h: continue
    yrs = {}
    for fy, v in a["years"].items():
        yrs[fy] = {k: (None if val is None else (val * 1000 if k != "months" else val)) for k, val in v.items()}
    h["audit"] = {"pages": a.get("pages", {}), "entity": a["entity"], "scope": a["scope"], "notes": a["notes"], "sources": a["sources"], "fyEnd": a["fyEnd"], "years": yrs}

# Every hospital district's levy by tax year, including districts that run no hospital of their own.
linked = {h["tu"] for h in out if h["tu"]}
districts = []
for k, yrs in LEVY.items():
    ser = {str(ty): r(v["levy"]) for ty, v in sorted(yrs.items()) if v}
    rate = {str(ty): round(v["rate"], 6) for ty, v in sorted(yrs.items()) if v}
    if not ser: continue
    fips = sorted({FIPS[c] for c in (re.sub(r"[^A-Z]", "", x.upper()) for x in LEVY_COUNTIES.get(k, [])) if c in FIPS})
    src = {str(ty): LEVY_WHERE[k][ty] for ty, v in sorted(yrs.items()) if v}
    districts.append({"tu": k, "name": LEVY_NAMES[k], "counties": LEVY_COUNTIES.get(k, []), "fips": fips, "hospital": k in linked, "levy": ser, "rate": rate, "src": src})
districts.sort(key=lambda d: -max(d["levy"].values()))
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "data.js"), "w") as fh:
    fh.write("// Generated by build_data.py from CMS Hospital Provider Cost Reports. Dollars, not thousands.\n")
    fh.write("window.HOSP = " + json.dumps({"first": FIRST, "last": LAST, "excluded": EXCLUDE, "cmsApi": CMS_API, "hospitals": out, "districts": districts}, separators=(",", ":")) + ";\n")
print(len(out), "hospitals,", os.path.getsize(os.path.join(here, "data.js")) // 1024, "KB")
for e in out[:10]:
    print(e["name"][:30].ljust(30), [(y["fy"], round(y["rev"] / 1e6), round((y["tax"] or 0) / 1e6)) for y in e["years"]][-4:])
print(sum(1 for h in out if h["tu"]), "hospitals linked to a tax district;", len(districts), "districts with levies")
