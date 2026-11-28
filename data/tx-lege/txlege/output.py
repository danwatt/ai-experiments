"""Write the assembled bill record to disk: JSON, CSVs, plain-text documents, timeline, HTML report."""

from __future__ import annotations

import csv
import difflib
import json
import re
from pathlib import Path

from .report import render_html, render_timeline_md


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()


def write_all(rec: dict, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    # Bill text versions + diffs between consecutive versions.
    text_dir = out / "text"
    text_dir.mkdir(exist_ok=True)
    prev = None
    for i, t in enumerate(rec["texts"]):
        if not t["text"]:
            continue
        name = f"{i + 1:02d}-{_slug(t['version'])}"
        t["file"] = f"text/{name}.txt"
        (out / t["file"]).write_text(t["text"])
        if prev:
            diff = difflib.unified_diff(
                prev["text"].splitlines(), t["text"].splitlines(),
                fromfile=prev["version"], tofile=t["version"], lineterm="", n=2,
            )
            t["diff_file"] = f"text/{name}.diff"
            (out / t["diff_file"]).write_text("\n".join(diff) + "\n")
        prev = t

    am_dir = out / "amendments"
    am_dir.mkdir(exist_ok=True)
    for a in rec["amendments"]:
        if a["text"]:
            a["file"] = f"amendments/{a['key']}-{_slug(a['author'])[:30]}.txt"
            (out / a["file"]).write_text(
                f"{a['label']} by {a['author']} ({a['type']}) - {a['action']} {a['date']}\n{a['html_url']}\n\n{a['text']}"
            )

    members = rec["members"]

    with (out / "rollcalls.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "chamber", "date", "kind", "amendment", "result", "yeas", "nays", "pnv",
                    "R_yea", "R_nay", "D_yea", "D_nay", "yea_means", "text", "journal"])
        for rc in rec["rollcalls"]:
            ps = rc.get("party_split", {})
            w.writerow([rc["id"], rc["chamber"], rc["date"], rc["kind"], rc["amendment_key"] or "", rc["result"],
                        rc["yeas"], rc["nays"], rc["pnv"],
                        ps.get("R", {}).get("Y", 0), ps.get("R", {}).get("N", 0),
                        ps.get("D", {}).get("Y", 0), ps.get("D", {}).get("N", 0),
                        rc["yea_means"], rc["text"], rc["journal_url"]])
    written.append(out / "rollcalls.csv")

    with (out / "votes.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["rollcall", "chamber", "date", "kind", "amendment", "member", "party", "district", "vote",
                    "statement_intended"])
        for rc in rec["rollcalls"]:
            intended = {s["member_id"]: s["intended"] for s in rc["statements"] if s.get("member_id")}
            for mid, code in sorted(rc["members"].items()):
                m = members[mid]
                w.writerow([rc["id"], rc["chamber"], rc["date"], rc["kind"], rc["amendment_key"] or "",
                            m["name"], m["party"], m["district"], code, intended.get(mid, "")])
    written.append(out / "votes.csv")

    for chamber, data in rec["analysis"]["chambers"].items():
        rcs = {rc["id"]: rc for rc in rec["rollcalls"]}
        path = out / f"vote_matrix_{'house' if chamber == 'H' else 'senate'}.csv"
        with path.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["member", "party", "district", "pct_with_sponsor", "pct_with_party"] + data["rollcalls"])
            w.writerow(["", "", "", "", "(yea means)"] + [rcs[i]["yea_means"] for i in data["rollcalls"]])
            for s in data["members"]:
                m = members[s["id"]]
                w.writerow([m["name"], m["party"], m["district"], s["sponsor_pct"], s["party_pct"]]
                           + [rcs[i]["members"].get(s["id"], "") for i in data["rollcalls"]])
        written.append(path)

    (out / "timeline.md").write_text(render_timeline_md(rec))
    written.append(out / "timeline.md")
    (out / "bill.json").write_text(json.dumps(rec, indent=1, ensure_ascii=False))
    written.append(out / "bill.json")
    (out / "report.html").write_text(render_html(rec))
    written.append(out / "report.html")
    return written
