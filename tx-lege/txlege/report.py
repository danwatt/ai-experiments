"""Render the assembled bill record as a self-contained HTML report and a Markdown timeline."""

from __future__ import annotations

from collections import defaultdict
from html import escape

from .diff import DIFF_CSS, DIFF_JS, render_diff, render_law_text

CHAMBER = {"H": "House", "S": "Senate", "E": "Executive"}
CODE_LABEL = {"Y": "Yea", "N": "Nay", "PNV": "Present, not voting", "EXC": "Absent, excused", "ABS": "Absent"}
MINOR = ("statement(s) of vote", "reason for vote", "co-author authorized", "coauthor authorized",
         "additional sponsor", "cosponsor authorized", "placed on", "considered in calendars",
         "committee report distributed", "committee report sent", "comte report filed", "scheduled for",
         "committee report printed", "reported enrolled", "-reported", "received by the secretary")


def short_label(rc: dict) -> str:
    n = rc.get("amendment_number")
    r = {"2": "2nd", "3": "3rd"}.get(rc.get("reading") or "", "")
    match rc["kind"]:
        case "table":
            return f"Table Amd {n}" + (f" ({r})" if r else "")
        case "amendment":
            return f"Amd {n}" + (f" ({r})" if r else "")
        case "passage":
            return f"Pass {r} rdg" if r else "Passage"
        case "conference":
            return "Conf. report"
        case "concur":
            return "Concur"
        case "procedural":
            return f"Take up {r} rdg" if r else "Procedural"
    return "Vote"


def tally(rc: dict) -> str:
    s = f"{rc['yeas']}–{rc['nays']}"
    s += f", {rc['pnv']} PNV" if rc["pnv"] else ""
    return s + (" (voice, deemed)" if rc.get("deemed") else "")


def party_line(rc: dict) -> str:
    ps = rc.get("party_split", {})
    parts = []
    for p in ("R", "D", "I", "?"):
        if p in ps:
            parts.append(f"{p} {ps[p].get('Y', 0)}–{ps[p].get('N', 0)}")
    return " · ".join(parts)


def support_split(rc: dict, members: dict) -> dict[str, tuple[int, int]]:
    """For amendment votes: (for, against) the amendment by party, flipping tabling motions."""
    flip = rc["kind"] == "table"
    out: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for mid, code in rc["members"].items():
        if code not in ("Y", "N"):
            continue
        supports = (code == "Y") != flip
        out[members[mid]["party"]][0 if supports else 1] += 1
    return {p: (v[0], v[1]) for p, v in out.items()}


# ---------------------------------------------------------------- markdown


def render_timeline_md(rec: dict) -> str:
    b = rec["bill"]
    rcs = {rc["id"]: rc for rc in rec["rollcalls"]}
    amds = {a["key"]: a for a in rec["amendments"]}
    lines = [
        f"# {b['session_label']} {b['label']}",
        "",
        b["fields"].get("Caption Text", ""),
        "",
        f"- Author: {b['fields'].get('Author', '')}",
        f"- Sponsor: {b['fields'].get('Sponsor', '')}",
        f"- Last action: {b['fields'].get('Last Action', '')}",
        f"- Source: {b['history_url']}",
        "",
        "## Timeline",
        "",
    ]
    day = None
    for a in rec["actions"]:
        if a["date"] != day:
            day = a["date"]
            lines += ["", f"### {day}", ""]
        text = f"- **{a['chamber']}** {a['description']}"
        if a["comment"]:
            text += f" — {a['comment']}"
        if a.get("amendment") and a["amendment"] in amds:
            am = amds[a["amendment"]]
            text += f" _(amendment by {am['author']}: {am['action']})_"
        for rc_id in [a.get("rollcall"), *a.get("extra_rollcalls", [])]:
            if rc_id and rc_id in rcs:
                rc = rcs[rc_id]
                text += f"\n  - `{rc_id}` {short_label(rc)}: **{rc['result']}** {tally(rc)} ({party_line(rc)}). {rc['yea_means']}"
        lines.append(text)

    lines += ["", "## Amendments", "", "| Reading | No. | Author | Type | Outcome | Vote | For amd (R) | For amd (D) |",
              "|---|---|---|---|---|---|---|---|"]
    for am in rec["amendments"]:
        vote, r_split, d_split = "voice", "", ""
        for rc_id in am["rollcalls"]:
            rc = rcs[rc_id]
            vote = f"{short_label(rc)} {tally(rc)}"
            sp = support_split(rc, rec["members"])
            r_split = "{}–{}".format(*sp.get("R", (0, 0)))
            d_split = "{}–{}".format(*sp.get("D", (0, 0)))
        lines.append(f"| {am['reading']} | {am['number']} | {am['author']} | {am['type']} | {am['action']} | {vote} | {r_split} | {d_split} |")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- html

CSS = """
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e1d8;--card:#fff;--accent:#7a4b13;
--yea:#2f7d4f;--nay:#b23a3a;--na:#c9c5ba;--with:#cfe8d6;--against:#f3cccc;--other:#eeebe3;
--R:#b23a3a;--D:#2c5fa8;--I:#7a6a1f;--U:#777}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171715;--fg:#ecebe6;--muted:#a19f97;--line:#34332f;
--card:#1f1f1c;--accent:#e0a35c;--yea:#6cc08f;--nay:#ee7b7b;--na:#55534c;--with:#24452f;--against:#562a2a;--other:#2a2926}}
:root[data-theme=dark]{--bg:#171715;--fg:#ecebe6;--muted:#a19f97;--line:#34332f;--card:#1f1f1c;--accent:#e0a35c;
--yea:#6cc08f;--nay:#ee7b7b;--na:#55534c;--with:#24452f;--against:#562a2a;--other:#2a2926}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 80px}
h1{font:600 28px/1.2 Georgia,serif;margin:0 0 6px}h2{font:600 21px/1.3 Georgia,serif;margin:44px 0 12px;
padding-top:12px;border-top:1px solid var(--line)}h3{font-size:16px;margin:24px 0 8px}
a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:13px}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);z-index:5;padding:8px 16px;
display:flex;gap:16px;flex-wrap:wrap;font-size:14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.tile b{display:block;font-size:22px}.meta{display:grid;grid-template-columns:120px 1fr;gap:4px 12px;font-size:14px}
.meta dt{color:var(--muted)}.meta dd{margin:0}
.badge{display:inline-block;min-width:22px;text-align:center;border-radius:4px;padding:0 5px;font-size:12px;
font-weight:600;color:#fff;background:var(--U)}.b-H{background:#5b6b3a}.b-S{background:#6a4c8c}.b-E{background:#555}
.p-R{color:var(--R)}.p-D{color:var(--D)}.p-I{color:var(--I)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600}
.timeline td{font-size:14px}.timeline tr.minor td{color:var(--muted);font-size:13px}
.timeline tr.day td{border-bottom:none;padding-top:16px;font-weight:600}
.vote{display:inline-block;margin-top:3px;padding:2px 8px;border-radius:5px;background:var(--other);font-size:13px}
.pass{color:var(--yea);font-weight:600}.fail{color:var(--nay);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}
.card h3{margin:0 0 4px}.names{font-size:13px;margin:4px 0}.names b{display:inline-block;min-width:150px}
details summary{cursor:pointer;color:var(--accent)}pre{white-space:pre-wrap;font:12.5px/1.45 ui-monospace,Menlo,monospace;
background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;max-height:560px;overflow:auto}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.matrix{width:auto;font-size:12px}.matrix th,.matrix td{padding:2px 4px;border-bottom:1px solid var(--line);white-space:nowrap}
.matrix td.v{text-align:center;width:26px;font-weight:600}
.matrix th.rc{writing-mode:vertical-rl;transform:rotate(180deg);height:150px;vertical-align:bottom;font-weight:500}
.matrix th.rc a{text-decoration:none;color:var(--fg)}
.matrix .name{position:sticky;left:0;background:var(--card);z-index:1}
.matrix .num{text-align:right}
[data-color=sponsor] .s-with,[data-color=party] .p-with{background:var(--with)}
[data-color=sponsor] .s-against,[data-color=party] .p-against{background:var(--against)}
[data-color=vote] .v-Y{color:var(--yea)}[data-color=vote] .v-N{color:var(--nay)}
.v-PNV,.v-EXC,.v-ABS,.v-{color:var(--muted);font-weight:400}
.controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;font-size:13px}
.controls button{font:inherit;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--fg);cursor:pointer}
.controls button.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.journal p{margin:4px 0;font-size:13.5px}.journal p.h{font-weight:600;text-align:center;margin-top:12px}
"""

JS = """
document.querySelectorAll('[data-matrix]').forEach(function(box){
  box.querySelectorAll('.controls button').forEach(function(b){
    b.addEventListener('click',function(){
      box.dataset.color=b.dataset.mode;
      box.querySelectorAll('.controls button').forEach(function(x){x.classList.toggle('on',x===b)});
    });
  });
});
"""


def _e(s) -> str:
    return escape(str(s) if s is not None else "")


def _party(m: dict) -> str:
    return f'<span class="p-{_e(m["party"])}">{_e(m["party"])}</span>'


def _member_link(m: dict) -> str:
    title = f"{m['name']} ({m['party']}-{m['district']})" if m["district"] else m["name"]
    return f'<span title="{_e(title)}">{_e(m["short"])}</span>'


def render_html(rec: dict) -> str:
    b = rec["bill"]
    f = b["fields"]
    members = rec["members"]
    rcs = {rc["id"]: rc for rc in rec["rollcalls"]}
    amds = {a["key"]: a for a in rec["amendments"]}
    title = f"{b['session_label']} {b['label']}"
    out: list[str] = []
    w = out.append

    w(f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
      f"<title>{_e(title)} history</title><style>{CSS}{DIFF_CSS}</style></head><body>")
    w("<nav><b>" + _e(title) + "</b><a href=#timeline>Timeline</a><a href=#amendments>Amendments</a>"
      "<a href=#votes>Record votes</a><a href=#matrix>Vote matrix</a><a href=#members>Members</a>"
      "<a href=#text>Bill text</a><a href=#changes>Changes</a><a href=#journal>Journal</a></nav><main>")

    # ---- header
    w(f"<h1>{_e(title)}</h1><p>{_e(f.get('Caption Text', ''))}</p>")
    w("<dl class=meta>")
    for key in ("Author", "Coauthor", "Sponsor", "Cosponsor", "Last Action", "Companion", "Senate Committee",
                "Senate Committee Vote", "House Committee", "House Committee Vote", "Subjects"):
        if f.get(key):
            val = f[key] if len(f[key]) < 400 else f[key][:400] + " …"
            w(f"<dt>{_e(key)}</dt><dd>{_e(val)}</dd>")
    w(f"<dt>Source</dt><dd><a href='{_e(b['history_url'])}'>Texas Legislature Online</a> · House &amp; Senate journals</dd></dl>")

    by_action = defaultdict(int)
    for a in rec["amendments"]:
        by_action[a["action"]] += 1
    finals = [rc for rc in rec["rollcalls"] if rc["kind"] in ("passage", "conference")]
    w("<div class=tiles>")
    w(f"<div class=tile><b>{len(rec['actions'])}</b><span class=muted>actions</span></div>")
    w(f"<div class=tile><b>{len(rec['amendments'])}</b><span class=muted>floor amendments: "
      + _e(", ".join(f"{v} {k.lower()}" for k, v in sorted(by_action.items(), key=lambda kv: -kv[1]))) + "</span></div>")
    w(f"<div class=tile><b>{len(rec['rollcalls'])}</b><span class=muted>record votes</span></div>")
    for rc in finals[-2:]:
        w(f"<div class=tile><b>{tally(rc)}</b><span class=muted>{_e(CHAMBER[rc['chamber']])} {_e(short_label(rc))} · {_e(party_line(rc))}</span></div>")
    w("</div>")
    if rec.get("missing_journals"):
        w(f"<p class='small muted'>{len(rec['missing_journals'])} journal(s) had no HTML version, so votes recorded only there are missing.</p>")

    # ---- timeline
    w("<h2 id=timeline>Timeline</h2><p class='small muted'>Every action from the bill history, oldest first. "
      "Record votes and amendments link to their details below.</p><table class=timeline>")
    day = None
    for a in rec["actions"]:
        if a["date"] != day:
            day = a["date"]
            w(f"<tr class=day><td colspan=3>{_e(day)}</td></tr>")
        minor = any(k in a["description"].lower() for k in MINOR)
        desc = _e(a["description"])
        if a["url"]:
            desc = f"<a href='{_e(a['url'])}' title='Journal page {_e(a['journal_page'])}'>{desc}</a>"
        extra = ""
        if a["comment"]:
            extra += f" <span class=muted>— {_e(a['comment'])}</span>"
        if a.get("amendment") and a["amendment"] in amds:
            am = amds[a["amendment"]]
            extra += f" · <a href='#amd-{_e(am['key'])}'>{_e(am['label'])} by {_e(am['author'])}</a>"
        for rc_id in [a.get("rollcall"), *a.get("extra_rollcalls", [])]:
            if rc_id and rc_id in rcs:
                rc = rcs[rc_id]
                cls = "pass" if rc["result"] == "passed" else "fail"
                extra += (f"<br><a class=vote href='#rc-{_e(rc_id)}'><span class={cls}>{_e(rc['result'])}</span> "
                          f"{_e(short_label(rc))} {_e(tally(rc))} · {_e(party_line(rc))}</a>")
        w(f"<tr class='{'minor' if minor else ''}'><td><span class='badge b-{_e(a['chamber'])}'>{_e(a['chamber'])}</span></td>"
          f"<td>{desc}{extra}</td><td class='small muted'>{_e(a['time'])}</td></tr>")
    w("</table>")

    # ---- amendments
    w("<h2 id=amendments>Amendments</h2><p class='small muted'>Support counts are for the amendment itself: "
      "on a motion to table, a Nay is a vote to keep the amendment alive.</p>")
    if not rec["amendments"]:
        w("<p>No floor amendments recorded.</p>")
    for reading in dict.fromkeys(a["reading"] for a in rec["amendments"]):
        group = [a for a in rec["amendments"] if a["reading"] == reading]
        ch, rd = (reading.split() + [""])[:2]
        w(f"<h3>{_e(CHAMBER.get(ch, ch))} — {_e({'2': 'second', '3': 'third'}.get(rd, rd))} reading</h3>")
        w("<table><tr><th>No.</th><th>Author</th><th>Outcome</th><th>Vote</th><th>For / against the amendment</th><th>Crossed party lines</th></tr>")
        for am in group:
            rc = rcs.get(am["rollcalls"][-1]) if am["rollcalls"] else None
            applied = not rc and am.get("applied_rollcall") in rcs
            if applied:
                rc = rcs[am["applied_rollcall"]]
            vote = f"<a href='#rc-{_e(rc['id'])}'>{_e(short_label(rc))} {_e(tally(rc))}</a>" if rc else "<span class=muted>voice / no record vote</span>"
            if applied:
                vote = (f"<a href='#rc-{_e(rc['id'])}'>Record {rc['record']} applied</a>"
                        f"<br><span class='small muted'>by rule suspension; same votes as {_e(short_label(rc))}</span>")
            split, cross = "", ""
            if rc:
                sp = support_split(rc, members)
                split = " · ".join(f"<span class=p-{p}>{p}</span> {a}–{b_}" for p, (a, b_) in sorted(sp.items()))
                cross = _crossovers(rc, members, rec)
            typ = "" if am["type"] == "Amendment" else f"<br><span class='small muted'>{_e(am['type'])}</span>"
            body = ""
            if am["text"]:
                body = f"<details><summary class=small>text</summary>{render_law_text(am['text'])}</details>"
            w(f"<tr id='amd-{_e(am['key'])}'><td>{am['number']}</td><td>{_e(am['author'])}{typ}{body}</td>"
              f"<td>{_e(am['action'])}</td><td>{vote}</td><td>{split}</td><td class=small>{cross}</td></tr>")
        w("</table>")

    # ---- record votes
    w("<h2 id=votes>Record votes</h2>")
    for rc in rec["rollcalls"]:
        cls = "pass" if rc["result"] == "passed" else "fail"
        w(f"<div class=card id='rc-{_e(rc['id'])}'><h3>{_e(rc['id'])} · {_e(CHAMBER[rc['chamber']])} · {_e(rc['date'])} · "
          f"{_e(short_label(rc))} — <span class={cls}>{_e(rc['result'])}</span> {_e(tally(rc))}</h3>")
        if rc["amendment_key"] in amds:
            am = amds[rc["amendment_key"]]
            w(f"<p class=small>On <a href='#amd-{_e(am['key'])}'>{_e(am['label'])}</a> by {_e(am['author'])} ({_e(am['action'].lower())}).</p>")
        if rc.get("applied_to"):
            w(f"<p class=small>By rule suspension this record vote was also applied to {len(rc['applied_to'])} other amendments: "
              + ", ".join(f"<a href='#amd-{_e(k)}'>{_e(amds[k]['label'] if k in amds else k)}</a>" for k in rc["applied_to"]) + ".</p>")
        if rc["motion"]:
            w(f"<p class='small muted'>{_e(rc['motion'])}</p>")
        w(f"<p class=small>{_e(rc['text'])}<br><b>{_e(rc['yea_means'])}</b> · {_e(party_line(rc))}"
          f" · <a href='{_e(rc['journal_url'])}'>journal</a></p>")
        if rc.get("deemed"):
            w("<p class='small muted'>Voice vote. Under Senate practice every member present is deemed to have voted "
              "the stated way except those the journal lists; the names below follow that rule.</p>")
        elif rc["inferred"]:
            w("<p class='small muted'>The journal listed only the dissenters; Yeas were filled in from the day's roll call.</p>")
        by_code = defaultdict(list)
        for mid, code in rc["members"].items():
            by_code[code].append(members[mid])
        for code in ("Y", "N", "PNV", "EXC", "ABS"):
            ms = sorted(by_code.get(code, []), key=lambda m: (m["party"], m["short"]))
            if ms:
                names = ", ".join(f"<span class=p-{_e(m['party'])}>{_member_link(m)}</span>" for m in ms)
                w(f"<p class=names><b>{_e(CODE_LABEL[code])} ({len(ms)})</b> {names}</p>")
        if rc["statements"]:
            w("<p class=small><b>Statements of vote:</b></p><ul class=small>")
            for s in rc["statements"]:
                w(f"<li>{_e(s['member'])}: {_e(s['text'])}</li>")
            w("</ul>")
        w("</div>")

    # ---- matrix + members
    w("<h2 id=matrix>Vote matrix</h2><p class='small muted'>One row per member, one column per record vote "
      "(click a column header for the vote). Color by the member's own vote, by whether they voted with the bill's "
      "sponsor in that chamber, or by whether they voted with their party's majority.</p>")
    for chamber, data in rec["analysis"]["chambers"].items():
        _matrix(w, rec, chamber, data)

    w("<h2 id=members>Members: who stuck with whom</h2>")
    for chamber, data in rec["analysis"]["chambers"].items():
        _member_section(w, rec, chamber, data)

    # ---- text
    w("<h2 id=text>Bill text</h2><p class='small muted'>In the full text, <ins>underlined</ins> is language the bill adds "
      "to current law and <del>struck</del> is language it removes (in the .txt copies: {+added+}, [-struck-]).</p><table><tr><th>Version</th><th>Official</th><th>Local copy</th><th>Other documents</th></tr>")
    for t in rec["texts"]:
        links = []
        if t["html_url"]:
            links.append(f"<a href='{_e(t['html_url'])}'>HTML</a>")
        if t["pdf_url"]:
            links.append(f"<a href='{_e(t['pdf_url'])}'>PDF</a>")
        local = []
        if t.get("file"):
            local.append(f"<a href='{_e(t['file'])}'>text</a>")
        if t.get("diff_file"):
            local.append(f"<a href='{_e(t['diff_file'])}'>diff vs previous</a>")
        docs = " · ".join(f"<a href='{_e(u)}'>{_e(k)}</a>" for k, u in t["docs"].items())
        w(f"<tr><td>{_e(t['version'])}</td><td>{' · '.join(links)}</td><td>{' · '.join(local)}</td><td class=small>{docs}</td></tr>")
    w("</table>")
    with_text = [t for t in rec["texts"] if t["text"]]
    no_text = [t["version"] for t in rec["texts"] if not t["text"]]
    if len(with_text) > 1:
        w("<h3 id=changes>How the text changed</h3><p class='small muted'>Each version compared with the one before it, "
          "paragraph by paragraph, like a code review. Changed words are highlighted; unchanged stretches are folded "
          "(click to expand). <span class=mk>{+ +}</span> and <span class=mk>[- -]</span> are the bill's own marks for "
          "language it adds to or strikes from current law.</p>")
        if no_text:
            w(f"<p class='small muted'>No HTML text for: {_e(', '.join(no_text))} (scanned PDF only), so it's skipped below.</p>")
        first, last = with_text[0], with_text[-1]
        if len(with_text) > 2:
            w(render_diff(first["text"], last["text"], f"{first['version']} (as filed)", f"{last['version']} (final)", open_=True))
        for i, (a, b_) in enumerate(zip(with_text, with_text[1:])):
            w(render_diff(a["text"], b_["text"], a["version"], b_["version"], open_=len(with_text) == 2))
    for t in (with_text[:1] + with_text[-1:]) if len(with_text) > 1 else with_text:
        label = " (as filed)" if t is with_text[0] else " (final)"
        w(f"<details><summary>{_e(t['version'])}{label} — full text</summary>{render_law_text(t['text'])}</details>")

    # ---- journal
    w("<h2 id=journal>Journal excerpts</h2><p class='small muted'>The floor proceedings on this bill as printed in each "
      "chamber's journal, including debate motions and voice votes that have no record vote.</p>")
    for s in rec["sections"]:
        paras = s["paragraphs"]
        w(f"<details class=journal><summary>{_e(s['date'])} · {_e(CHAMBER[s['chamber']])} · {_e(s['header'])} "
          f"<span class=muted>({len(paras)} paragraphs)</span></summary>")
        for p in paras[:600]:
            w(f"<p>{_e(p[:1500])}{'…' if len(p) > 1500 else ''}</p>")
        if len(paras) > 600:
            w(f"<p class=muted>… {len(paras) - 600} more paragraphs in the <a href='{_e(s['journal_url'])}'>journal</a>.</p>")
        w(f"<p class=small><a href='{_e(s['journal_url'])}'>Full journal</a></p></details>")

    w(f"</main><script>{JS}{DIFF_JS}</script></body></html>")
    return "\n".join(out)


def _crossovers(rc: dict, members: dict, rec: dict) -> str:
    pos = rec["analysis"]["chambers"][rc["chamber"]]["party_position"][rc["id"]]
    names = defaultdict(list)
    for mid, code in rc["members"].items():
        m = members[mid]
        p = pos.get(m["party"])
        if code in ("Y", "N") and p and code != p and m["party"] in ("R", "D"):
            names[m["party"]].append(m)
    parts = []
    for p, ms in sorted(names.items()):
        listed = ", ".join(_member_link(m) for m in sorted(ms, key=lambda m: m["short"]))
        parts.append(f"<span class=p-{p}>{p}</span> ({len(ms)}): {listed}")
    return "<br>".join(parts)


def _sorted_members(rec: dict, data: dict) -> list[dict]:
    members = rec["members"]
    order = {"R": 0, "D": 1}
    return sorted(
        data["members"],
        key=lambda s: (order.get(members[s["id"]]["party"], 2), -(s["sponsor_pct"] or -1), members[s["id"]]["short"]),
    )


def _matrix(w, rec: dict, chamber: str, data: dict) -> None:
    members = rec["members"]
    rcs = {rc["id"]: rc for rc in rec["rollcalls"]}
    sponsor = members.get(data["sponsor"]) if data["sponsor"] else None
    w(f"<h3>{_e(CHAMBER[chamber])}</h3>")
    if sponsor:
        w(f"<p class='small muted'>Sponsor here: {_e(sponsor['name'])}.</p>")
    w(f"<div data-matrix data-color=sponsor><div class=controls>Color by: "
      "<button data-mode=sponsor class=on>with sponsor</button><button data-mode=party>with party</button>"
      "<button data-mode=vote>vote</button></div><div class=scroll><table class=matrix><tr>"
      "<th class=name>Member</th><th>Pty</th><th>Dist</th><th class=num title='Share of Yea/Nay votes cast with the sponsor'>% spon</th>"
      "<th class=num title='Share of Yea/Nay votes cast with own party majority'>% pty</th>")
    for rc_id in data["rollcalls"]:
        rc = rcs[rc_id]
        w(f"<th class=rc title='{_e(rc['yea_means'])}: {_e(tally(rc))}'><a href='#rc-{_e(rc_id)}'>"
          f"{_e(rc['date'][5:])} {_e(short_label(rc))}</a></th>")
    w("</tr>")
    for s in _sorted_members(rec, data):
        m = members[s["id"]]
        w(f"<tr><td class=name>{_member_link(m)}</td><td>{_party(m)}</td><td class=num>{_e(m['district'])}</td>"
          f"<td class=num>{_e(s['sponsor_pct'] if s['sponsor_pct'] is not None else '')}</td>"
          f"<td class=num>{_e(s['party_pct'] if s['party_pct'] is not None else '')}</td>")
        for rc_id in data["rollcalls"]:
            rc = rcs[rc_id]
            code = rc["members"].get(s["id"], "")
            classes = [f"v v-{code}"]
            sp = rc["members"].get(data["sponsor"]) if data["sponsor"] else None
            if code in ("Y", "N") and sp in ("Y", "N") and s["id"] != data["sponsor"]:
                classes.append("s-with" if sp == code else "s-against")
            pp = rec["analysis"]["chambers"][chamber]["party_position"][rc_id].get(m["party"])
            if code in ("Y", "N") and pp:
                classes.append("p-with" if pp == code else "p-against")
            shown = {"Y": "Y", "N": "N", "PNV": "p", "EXC": "e", "ABS": "a"}.get(code, "·")
            tip = f"{m['short']}: {CODE_LABEL.get(code, 'not listed')} — {short_label(rc)}"
            said = next((st for st in rc["statements"] if st.get("member_id") == s["id"]), None)
            if said:
                shown += "*"
                tip += f". Statement of vote: {said['text']}"
            w(f"<td class='{' '.join(classes)}' title='{_e(tip)}'>{shown}</td>")
        w("</tr>")
    w("</table></div></div><p class='small muted'>Y yea · N nay · p present, not voting · e excused · a absent · · not listed · "
      "* member filed a statement of vote (e.g. \"I intended to vote no\"); hover for the text. The journal tally is the official vote.</p>")


def _member_section(w, rec: dict, chamber: str, data: dict) -> None:
    members = rec["members"]
    rcs = {rc["id"]: rc for rc in rec["rollcalls"]}
    w(f"<h3>{_e(CHAMBER[chamber])}</h3>")
    rows = [s for s in data["members"] if s["against_party"]]
    rows.sort(key=lambda s: (-s["against_party"], members[s["id"]]["short"]))
    if rows:
        w("<p class=small><b>Broke with their party's majority</b> (Yea/Nay votes only):</p><table><tr><th>Member</th><th>Pty</th>"
          "<th>Times</th><th>On</th></tr>")
        for s in rows:
            m = members[s["id"]]
            on = ", ".join(f"<a href='#rc-{_e(i)}'>{_e(short_label(rcs[i]))}</a>" for i in s["defections"])
            w(f"<tr><td>{_member_link(m)}</td><td>{_party(m)}</td><td>{s['against_party']} of {s['with_party'] + s['against_party']}</td><td class=small>{on}</td></tr>")
        w("</table>")
    else:
        w("<p class=small>Every member voted with their party's majority on every record vote.</p>")

    # Distribution of agreement with the sponsor.
    buckets = defaultdict(lambda: defaultdict(list))
    for s in data["members"]:
        if s["sponsor_pct"] is None:
            continue
        pct = s["sponsor_pct"]
        b = "100%" if pct == 100 else "0%" if pct == 0 else "75–99%" if pct >= 75 else "25–74%" if pct >= 25 else "1–24%"
        buckets[b][members[s["id"]]["party"]].append(members[s["id"]])
    if buckets:
        w("<p class=small><b>How often each member voted with the sponsor</b>:</p><table><tr><th>With sponsor</th><th>Members</th></tr>")
        for b in ("100%", "75–99%", "25–74%", "1–24%", "0%"):
            if b not in buckets:
                continue
            cells = []
            for p, ms in sorted(buckets[b].items()):
                cells.append(f"<span class=p-{p}>{p} ({len(ms)})</span>: " + ", ".join(_member_link(m) for m in sorted(ms, key=lambda m: m["short"])))
            w(f"<tr><td>{b}</td><td class=small>{'<br>'.join(cells)}</td></tr>")
        w("</table>")

    if data["blocs"]:
        w("<p class=small><b>Identical voting records</b> (same vote, or same absence, on every record vote):</p><ul class=small>")
        for bloc in data["blocs"][:8]:
            ms = [members[i] for i in bloc["members"]]
            parties = defaultdict(int)
            for m in ms:
                parties[m["party"]] += 1
            mix = ", ".join(f"{v} {k}" for k, v in sorted(parties.items()))
            w(f"<li>{len(ms)} members ({mix}): " + ", ".join(_member_link(m) for m in sorted(ms, key=lambda m: m['short'])) + "</li>")
        w("</ul>")
