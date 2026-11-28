#!/usr/bin/env python3
"""Download every source file the build reads into .sources/ (git-ignored) and write .sources/manifest.json.

Usage: python3 -I fetch_sources.py [--refresh]

- CMS Hospital Provider Cost Report: the yearly CSVs and each year's data-API dataset id, found in
  the data.cms.gov catalog (https://data.cms.gov/data.json). The ids let the page link to one report row.
- Texas Comptroller "Special District Rates and Levies" spreadsheets, tax year 2013 on. Years still
  linked from comptroller.texas.gov come from there; older ones from the Internet Archive.
- Audited financial statements: every PDF listed under "sources" in audited/*.json, converted to text
  with pdftotext -layout (poppler) for audited/locate_pages.py.
- US Census county outlines (us-atlas TopoJSON) for build_counties.py.

Files already in .sources/ are kept unless --refresh is given (the catalog is always re-read).
"""
import glob, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, ".sources")
REFRESH = "--refresh" in sys.argv
UA = {"User-Agent": "texas-public-hospitals-build/1.0 (data download script)"}
FIRST_TAX_YEAR = 2013
COMPTROLLER = "https://comptroller.texas.gov/taxes/property-tax/"
ATLAS = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json"
MAGIC = {".pdf": b"%PDF", ".xlsx": b"PK", ".xls": b"\xd0\xcf\x11\xe0"}

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:
            if getattr(e, "code", None) == 404 or i == tries - 1: raise
            time.sleep(2 * (i + 1))

def save(url, path, check=None, quiet404=False):
    """Download url to path unless it is already there. Returns True when the file exists afterwards."""
    if os.path.exists(path) and not REFRESH: return True
    try: data = get(url)
    except Exception as e:
        if not (quiet404 and getattr(e, "code", None) == 404): print("  failed", url, "-", e)
        return False
    magic = MAGIC.get(os.path.splitext(path)[1])
    if magic and not data.startswith(magic) or check and not check(data):
        print("  not the expected file type:", url); return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "wb") as f: f.write(data)
    os.replace(path + ".part", path)
    print("  saved", os.path.relpath(path, HERE), len(data) // 1024, "KB")
    return True

manifest = {"cmsApi": {}, "levyUrls": {}, "audits": {}}

# ---------- CMS cost reports ----------
print("CMS catalog")
cat = json.loads(get("https://data.cms.gov/data.json"))
for ds in cat["dataset"]:
    if not ds["title"].startswith("Hospital Provider Cost Report"): continue
    csvs = [x for x in ds["distribution"] if x.get("format") == "CSV"]
    apis = [x for x in ds["distribution"] if x.get("format") == "API"]
    for c in csvs:
        url = c.get("downloadURL") or c.get("accessURL")
        m = re.search(r"CostReport_(\d{4})_Final\.csv$", url)
        if not m: continue
        year = m.group(1)
        if not save(url, os.path.join(OUT, "hcris", f"CostReport_{year}_Final.csv"),
                    check=lambda d: d[:200].lstrip(b"\xef\xbb\xbf").startswith(b'"rpt_rec_num"')): continue
        if apis:  # some years list two API ids for the same data; the last one is the current one
            manifest["cmsApi"][year] = re.search(r"dataset/([0-9a-f-]{36})/", apis[-1]["accessURL"]).group(1)

# ---------- Comptroller levies ----------
print("Comptroller levies")
page = get(COMPTROLLER + "rates/").decode("utf-8", "replace")
live = {int(m.group(1)): m.group(0) for m in re.finditer(r"(\d{4})-special-district-rates-levies\.xlsx?", page)}
for ty in range(FIRST_TAX_YEAR, max(live) + 1):
    if ty in live:
        name = live[ty]; url = link = COMPTROLLER + "docs/" + name
        save(url, os.path.join(OUT, "levy", name)) and manifest["levyUrls"].__setitem__(name, link)
        continue
    # no longer posted: the file names changed over the years, so try each spelling on the Internet Archive
    for name in (f"{ty}-special-district-rates-levies.xlsx", f"{ty}-special-district-rates-levies.xls", f"{ty}_Special_District_Rates_Levies.xls"):
        path = os.path.join(OUT, "levy", name)
        orig = COMPTROLLER + "docs/" + name
        if save("https://web.archive.org/web/2021id_/" + orig, path, quiet404=True):
            manifest["levyUrls"][name] = "https://web.archive.org/web/2021/" + orig
            break
    else:
        print("  no levy file found for tax year", ty)

# ---------- audited statements ----------
print("Audited statements")
for f in sorted(glob.glob(os.path.join(HERE, "audited", "*.json"))):
    a = json.load(open(f))
    for key, url in a["sources"].items():
        name = url.rstrip("/").split("/")[-1].removesuffix(".pdf")
        pdf = os.path.join(OUT, "audits", a["ccn"], name + ".pdf")
        if not save(url, pdf): continue
        txt = pdf[:-4] + ".txt"
        if REFRESH or not os.path.exists(txt):
            subprocess.run(["pdftotext", "-layout", pdf, txt], check=True)
        manifest["audits"][url] = os.path.relpath(txt, OUT)

# ---------- county outlines ----------
print("County outlines")
save(ATLAS, os.path.join(OUT, "geo", "counties-10m.json"), check=lambda d: d.startswith(b'{"type":"Topology"'))

with open(os.path.join(OUT, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=1, sort_keys=True)
print(len(manifest["cmsApi"]), "cost report years,", len(manifest["levyUrls"]), "levy files,", len(manifest["audits"]), "audit PDFs")
