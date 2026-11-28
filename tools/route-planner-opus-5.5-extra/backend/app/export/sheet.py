"""Printable day sheets: one page per driving day, as a stand-alone HTML page.

The page is laid out with print CSS (`@page`, a page break after each sheet),
so the browser's own Print gives a page per day. On screen it shows the
sheets as paper on a dark desk, like the design mockup (screen 7).

A sheet has the day's title and summary line, a mile strip with a tick for
every stop, and a table: local time, kind of stop, where (with the road and
exit), mile and notes. Clock changes and road notes get a shaded row.
"""

from datetime import date
from html import escape

from .common import day_rows, hm, selected_days

TITLES = {"break": "Break", "lunch": "Lunch", "dinner": "Dinner", "fuel": "Fuel", "stop": "Stop", "through": "Pass through",
          "overnight": "Overnight", "end": "Arrive", "start": "Depart", "clock": "Clock change"}

CSS = """
:root { --paper: #f6f5f1; --ink: #1c1c1c; --dim: #5b5b5b; --rule: #d8d6cf; --band: #e9e7e0; }
* { box-sizing: border-box; }
body { margin: 0; background: #0d0d0d; font: 11px/15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
.bar { position: sticky; top: 0; z-index: 2; background: #2d2d2d; color: #ddd; padding: 8px 16px; display: flex; gap: 12px; align-items: center; font-size: 12px; border-bottom: 1px solid #333; }
.bar button { font: inherit; background: #2a4a6e; color: #cfe6ff; border: 1px solid #4a90d9; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
.bar span { color: #aaa; }
.sheet { width: min(7.5in, calc(100vw - 32px)); min-height: 10in; margin: 18px auto; background: var(--paper); padding: 0.45in 0.5in; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6); display: flex; flex-direction: column; }
h1 { margin: 0; font-size: 18px; line-height: 22px; }
.pm { color: var(--dim); margin-top: 3px; }
.strip { margin: 14px 8px 10px; position: relative; height: 38px; flex-shrink: 0; }
.strip .ln { position: absolute; left: 0; right: 0; top: 13px; border-top: 3px solid var(--ink); }
.strip .tk { position: absolute; top: 6px; width: 14px; height: 14px; border-radius: 50%; background: var(--paper); border: 2px solid var(--ink); transform: translateX(-50%); font-size: 8px; line-height: 10px; text-align: center; font-weight: 700; }
.strip .tk.th { border-radius: 2px; transform: translateX(-50%) rotate(45deg); width: 10px; height: 10px; top: 9px; }
.strip .tk.night { background: var(--ink); color: var(--paper); }
.strip .mi { position: absolute; top: 23px; transform: translateX(-50%); font-size: 9px; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 9px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--dim); border-bottom: 1.5px solid var(--ink); padding: 3px 6px 3px 0; }
td { border-bottom: 1px solid var(--rule); padding: 5px 6px 5px 0; vertical-align: top; }
td:first-child { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
td small { display: block; color: var(--dim); }
td .tz { font-weight: 400; font-size: 9px; color: var(--dim); margin-left: 3px; }
tr { break-inside: avoid; }
tr.band td { background: var(--band); }
tr.hard td:nth-child(2) { font-weight: 700; }
.warn { margin-top: 10px; padding: 6px 8px; border: 1px solid var(--dim); border-radius: 3px; }
.warn b { display: block; margin-bottom: 2px; }
.foot { margin-top: auto; padding-top: 12px; color: var(--dim); display: flex; justify-content: space-between; }
@page { size: letter; margin: 0.4in; }
@media print {
  body { background: none; }
  .bar { display: none; }
  .sheet { width: auto; min-height: 9.9in; margin: 0; padding: 0; box-shadow: none; background: none; break-after: page; }
  .sheet:last-of-type { break-after: auto; }
}
"""


def long_date(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return f"{d:%A}, {d:%B} {d.day}, {d.year}"


def time_cell(row: dict, first: bool, day_tz: str) -> str:
    when = row["depart"] if first else row.get("arrive") or row.get("depart")
    tz = row.get("depart_tz") if first else row.get("tz")
    shown = f'<span class="tz">{escape(tz)}</span>' if tz and tz != day_tz else ""
    return f"{when[11:16]}{shown}" if when else ""


def where(row: dict) -> str:
    name = escape(row["name"])
    detail = []
    if row.get("kind") == "exit" and row.get("ref") and row.get("road"):
        detail.append(f"{row['road']} Exit {row['ref']}")
    elif row.get("road"):
        detail.append(row["road"])
    if row.get("kind") == "rest_area":
        detail.append("rest area")
    elif row.get("kind") == "service_plaza":
        detail.append("service plaza")
    if row.get("near") and row.get("near") != row["name"] and row["type"] in ("break", "lunch", "dinner", "fuel"):
        detail.append(f"near {row['near']}")
    return name + (f"<small>{escape(' · '.join(detail))}</small>" if detail else "")


def kind_cell(row: dict, first: bool) -> str:
    title = "Depart" if first else TITLES[row["type"]]
    if row["type"] in ("break", "lunch", "dinner", "fuel", "stop") and row.get("stay_minutes"):
        title += f", {hm(row['stay_minutes'])}"
    if row["type"] == "overnight" and not first:
        title = "Overnight" + (" + fuel" if row.get("fill_up") else "")
    elif row.get("refuel") and row["type"] != "fuel":
        title += " + fuel"
    return escape(title)


def notes(row: dict, first: bool, exits: bool) -> list[str]:
    out = []
    if first:  # the row the day starts from: what happened there belongs to the day before
        return out
    if exits and row["type"] in ("break", "lunch", "dinner", "fuel", "overnight") and not first:
        have = [f"{row[k]} {k}" for k in ("food", "fuel", "lodging") if row.get(k)]
        if have:
            out.append(", ".join(have))
        if row.get("toilets"):
            out.append("restrooms")
    if row["type"] == "through" and not first:
        out.append("no stop")
    if row.get("fuel_note"):
        out.append(row["fuel_note"])
    if row.get("moved"):
        out.append(row["moved"])
    if row.get("pinned"):
        out.append("pinned")
    if row["type"] in ("overnight", "end") and not first and row.get("sunset"):
        out.append(f"sunset {row['sunset'][11:16]}" + (" · arrives after dark" if row.get("after_dark") else ""))
    if row.get("hotel_dinner") and not first:
        out.append("dinner at the hotel")
    ev = row.get("events") or {}
    for meal in ev.get("during", []):
        out.append(f"{meal} during this stop")
    for meal in ev.get("missed", []):
        out.append(f"no {meal}")
    return out


def clock_where(row: dict) -> str:
    shift = row.get("shift_minutes", 0)
    way = "back" if shift < 0 else "forward"
    return (f"Into {escape(row['to_zone'].split('/')[-1].replace('_', ' '))} time: clocks go {way} {hm(abs(shift))}"
            f"<small>it was {escape(row.get('before', '')[11:16])} {escape(row.get('before_tz', ''))}</small>")


def strip(rows: list[dict], first_mile: float, total: float) -> str:
    """The mile strip: a tick at every stop, the day's miles under it."""
    span = max(total, 0.1)
    out = ['<div class="strip"><div class="ln"></div>']
    last = len(rows) - 1
    labelled = -100.0  # where the last mile figure sits; one closer than 6 % is left out, the tick stays
    for i, r in enumerate(rows):
        if r["type"] == "clock":
            continue
        pos = (r["mile"] - first_mile) / span * 100
        label = "A" if i == 0 else "🛏" if i == last and r["type"] == "overnight" else "B" if i == last else ""
        cls = "th" if r["type"] == "through" else ("night" if label == "🛏" else "")
        out.append(f'<span class="tk {cls}" style="left:{pos:.1f}%">{label}</span>')
        if pos - labelled >= 6 or i == last:
            out.append(f'<span class="mi" style="left:{pos:.1f}%">{round(r["mile"] - first_mile)}</span>')
            labelled = pos
    out.append("</div>")
    return "".join(out)


def sheet(plan: dict, day: dict, rows: list[dict], closures: list[dict], warnings: list[dict], name: str, osm: str, page: int, pages: int, parts: dict) -> str:
    first_mile = rows[0]["mile"]
    day_tz = day.get("depart_tz") or ""
    same_tz = day.get("arrive_tz") == day_tz
    tz_note = f"all times {day_tz}" if same_tz else f"times local ({day_tz} → {day.get('arrive_tz')})"
    head = (f'<h1>Day {day["day"]} · {escape(long_date(day["date"]))}</h1>'
            f'<div class="pm">{escape(day["start"])} → {escape(day["end"])} · {day["miles"]:g} mi · {hm(day["driving_minutes"])} driving · '
            f'depart {day["depart"][11:16]} · arrive {day["arrive"][11:16]} · {escape(tz_note)}</div>')
    body = []
    notes_at = sorted((c for c in closures if c.get("miles") and rows[0]["mile"] <= c["miles"][0] <= rows[-1]["mile"]), key=lambda c: c["miles"][0])
    for i, r in enumerate(rows):
        while notes_at and notes_at[0]["miles"][0] <= r["mile"]:
            c = notes_at.pop(0)
            body.append(f'<tr class="band"><td></td><td>Road note</td><td>{escape(c["message"])}<small>{escape(c.get("tags", ""))}</small></td><td>{c["miles"][0] - first_mile:.0f}</td></tr>')
        first = i == 0
        if r["type"] == "clock":
            body.append(f'<tr class="band"><td>{escape(r["arrive"][11:16])}</td><td>Clock change</td><td>{clock_where(r)}</td><td>{r["mile"] - first_mile:.0f}</td></tr>')
            continue
        extra = notes(r, first, parts.get("exits", True))
        body.append(f'<tr><td>{time_cell(r, first, day_tz)}</td><td>{kind_cell(r, first)}</td><td>{where(r)}</td>'
                    f'<td>{round(r["mile"] - first_mile)}{" · " + escape(" · ".join(extra)) if extra else ""}</td></tr>')
    heads_up = ""
    if parts.get("warnings", True):
        mine = [w for w in warnings if w.get("day") == day["day"] or (w.get("mile") is not None and rows[0]["mile"] <= w["mile"] <= rows[-1]["mile"])]
        if mine:
            heads_up = '<div class="warn"><b>Heads-up</b>' + "".join(f"<div>{escape(w['message'])}</div>" for w in mine) + "</div>"
    return (f'<section class="sheet">{head}{strip(rows, first_mile, rows[-1]["mile"] - first_mile) if parts.get("strip", True) else ""}'
            f'<table><thead><tr><th>Time</th><th>Stop</th><th>Where</th><th>Mile · notes</th></tr></thead><tbody>{"".join(body)}</tbody></table>'
            f'{heads_up}<div class="foot"><span>{escape(name)} · page {page} of {pages}</span><span>Road trip planner · OSM {escape(osm)}</span></div></section>')


def build(plan: dict, closures: list[dict], name: str, osm: str, only: list[int] | None = None, parts: dict | None = None) -> str:
    """The whole HTML page. `parts` switches pieces on: exits, strip, warnings (all on by default)."""
    parts = parts or {}
    days = selected_days(plan, only)
    sheets = [sheet(plan, d, day_rows(plan, d), closures, plan["warnings"], name, osm, i, len(days), parts) for i, d in enumerate(days, start=1)]
    if not sheets:
        sheets = ['<section class="sheet"><h1>No driving days to print</h1><div class="pm">Pick at least one driving day.</div></section>']
    title = f"{name} · day sheets"
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{escape(title)}</title><style>{CSS}</style></head><body>'
            f'<div class="bar"><button onclick="window.print()">🖨 Print</button><span>{len(days)} sheet{"" if len(days) == 1 else "s"} · one page per driving day · '
            f'letter size, any printer margin works</span></div>{"".join(sheets)}</body></html>')
