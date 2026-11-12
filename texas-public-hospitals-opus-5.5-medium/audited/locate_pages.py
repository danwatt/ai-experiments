#!/usr/bin/env python3
"""Find the PDF page (and line) each audited figure comes from, and store it in each JSON as "pages".

Usage: python3 -I locate_pages.py   (after fetch_sources.py has downloaded and converted the PDFs)

Reads ../.sources/manifest.json, which maps each source URL to the pdftotext -layout text of its PDF (pages split by form feeds). A figure is matched when a
number on the page equals it in thousands, or rounds to it from dollars. For each year the script
picks the report and page whose statement of revenues, expenses and changes in net position holds
that year's operating result and change in net position, preferring the report with the most matches
(newest on ties). Figures that are sums of several lines (supplemental Medicaid, for example) are not
found as one number; they point at the statement page with "derived": true.
Result: pages[year][field] = [source key, pdf page (1-based), line label, derived].
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, "..", ".sources")
TXT = json.load(open(os.path.join(SOURCES, "manifest.json")))["audits"]
FIELDS = ["npsr", "supp", "oopOther", "opRev", "opExp", "opInc", "tax", "invest", "interest", "relief",
          "otherNonop", "cap", "transfer", "chg", "capex"]
NUM = re.compile(r"\(?\$?\s?(\d{1,3}(?:,\s?\d{3})+|\d+)\s?\)?")

def numbers(line):
    return {int(m.group(1).replace(",", "").replace(" ", "")) for m in NUM.finditer(line)}

def matches(line_nums, v):
    v = abs(round(v))
    if v < 10: return False  # too small to tell apart from footnote marks and dates
    return any(t == v or (t >= 100000 and round(t / 1000) == v) for t in line_nums)

def label(line):
    t = re.split(r"\s{2,}[$(\d-]|\s\$", line.strip())[0]
    return re.sub(r"[\s.]+$", "", re.sub(r"\s+", " ", t))[:90]

def find(page, v):
    for i, ln in enumerate(page):
        if matches(numbers(ln), v):
            lb = label(ln)
            # a label that wraps onto the number's line: join it to the line above
            if not lb or not lb[0].isupper():
                prev = next((label(x) for x in reversed(page[max(0, i - 3):i]) if x.strip()), "")
                lb = (prev + " " + (lb if lb[:1].isalpha() else "")).strip()
            return re.sub(r"[;,]\s*20\d\d\s*[–-]\s*$", "", lb)[:90]
    return None

for f in sorted(glob.glob(os.path.join(HERE, "*.json"))):
    a = json.load(open(f))
    reports = []
    for k, url in a["sources"].items():
        if url not in TXT: print("not downloaded:", url); continue
        t = os.path.join(SOURCES, TXT[url])
        pages = [p.split("\n") for p in open(t, encoding="utf-8", errors="replace").read().split("\f")]
        reports.append((k, pages))
    # newest report first: sort by the last year in the source key
    reports.sort(key=lambda r: max(map(int, re.findall(r"20\d\d", r[0]))), reverse=True)
    out, missing = {}, 0
    for fy, y in a["years"].items():
        best = None
        for k, pages in reports:
            for i, p in enumerate(pages):
                if y.get("chg") is None: continue
                # the statement page; restated years may only tie on tax and the bottom line
                if not (find(p, y["chg"]) and (find(p, y.get("opInc") or 0) or find(p, y.get("tax") or 0))): continue
                hits = {fld: find(p, y[fld]) for fld in FIELDS if y.get(fld)}
                score = sum(1 for v in hits.values() if v)
                if not best or score > best[0]: best = (score, k, i, pages, hits)
        if not best: print(a["ccn"], fy, "no statement page"); continue
        _, k, i, pages, hits = best
        res = {}
        for fld in FIELDS:
            v = y.get(fld)
            if v is None: continue
            if v == 0: res[fld] = [k, i + 1, None, True]; continue
            if hits.get(fld): res[fld] = [k, i + 1, hits[fld], False]; continue
            # elsewhere in the same report: cash flows for capital spending, notes for the rest
            alt = next(((j, lb) for j, p in enumerate(pages) if j != i and (lb := find(p, v))
                        and (fld != "capex" or any("capital" in ln.lower() for ln in p))), None)
            if alt and fld in ("capex", "relief", "transfer", "interest"):
                res[fld] = [k, alt[0] + 1, alt[1], False]
            else:
                res[fld] = [k, i + 1, None, True]; missing += 1
        out[fy] = res
    a["pages"] = out
    pages = a.pop("pages")
    body = json.dumps(a, indent=1)
    rows = ",\n".join(f'  "{fy}": ' + json.dumps(v, separators=(",", ":")) for fy, v in pages.items())
    with open(f, "w") as fh:
        fh.write(body[:-2] + ',\n "pages": {\n' + rows + "\n }\n}\n")
    n = sum(len(v) for v in out.values())
    print(os.path.basename(f), "years", len(out), "figures", n, "derived (not one printed number)", missing)
