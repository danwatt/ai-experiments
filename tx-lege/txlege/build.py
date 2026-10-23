"""Pull every source for one bill and assemble a single JSON-friendly record."""

from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict

from . import journal as J
from .fetch import Fetcher
from .people import Person, Resolver, is_speaker, load_people
from .tlo import (
    BillId,
    fetch_amendments,
    fetch_history,
    fetch_text_versions,
    html_to_text,
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------- classify


def classify(text: str, motion: str) -> str:
    t = f"{motion} {text}".lower()
    if "motion to table" in t or "moved to table" in t or re.search(r"\bwas tabled\b", t):
        return "table"
    if "conference committee report" in t:
        return "conference"
    if "concur" in t:
        return "concur"
    if re.search(r"amendment", text, re.I) and re.search(r"adopted|adoption", text, re.I):
        return "amendment"
    if re.search(r"passed to (third reading|engrossment)|was passed|finally passed|read (second|third) time and was passed", t):
        return "passage"
    if "suspend" in t or "regular order of business" in t:
        return "procedural"
    return "other"


def result_of(text: str, yeas: int, nays: int) -> str:
    t = text.lower()
    if re.search(r"\b(lost|failed|not adopted|was refused)\b", t):
        return "failed"
    if re.search(r"\b(prevailed|adopted|passed|granted|concurred)\b", t):
        return "passed"
    return "passed" if yeas > nays else "failed"


def amendment_number(text: str, motion: str, context: list[str]) -> int | None:
    m = re.search(r'deemed to have voted "\w+" on the adoption of (?:Floor )?Amendment No\.\s*(\d+)', text)
    if m:
        return int(m.group(1))
    for t in (text, motion):
        m = re.search(r"Amendment No\.\s*(\d+)", t)
        if m:
            # "Amendment No. 7 was adopted" beats the "Amend Amendment No. 6" it modifies.
            nums = re.findall(r"Amendment No\.\s*(\d+)", t)
            return int(nums[0])
    for t in reversed(context):
        m = re.search(r"(?:Floor )?Amendment No\.\s*(\d+)", t)
        if m:
            return int(m.group(1))
    return None


YEA_MEANS = {
    "table": "Yea = table (kill) amendment",
    "amendment": "Yea = adopt amendment",
    "passage": "Yea = pass bill",
    "conference": "Yea = adopt conference report",
    "concur": "Yea = concur",
    "procedural": "Yea = suspend rules / take up",
    "other": "",
}


# ---------------------------------------------------------------- assemble


def assemble(f: Fetcher, bill: BillId, people_override=None) -> dict:
    log(f"Fetching {bill.session_label} {bill.label} from Texas Legislature Online")
    info = fetch_history(f, bill)
    texts = fetch_text_versions(f, bill)
    amendments = fetch_amendments(f, bill)

    for t in texts:
        t_html = f.get(t.html_url, optional=True) if t.html_url else None
        t.__dict__["text"] = html_to_text(t_html) if t_html else ""
    for a in amendments:
        a_html = f.get(a.html_url, optional=True) if a.html_url else None
        a.text = html_to_text(a_html) if a_html else ""

    people = load_people(f, int(bill.session[:2]), people_override)
    if not people:
        log("  warning: couldn't load the member roster; party breakdowns will be empty")
    resolver = Resolver(people)

    # ---- journals referenced by the history
    # Order journals by the last action they record: a stray earlier entry
    # (a coauthor added that morning) shouldn't put the day's later journal first.
    journal_dates: dict[str, str] = {}
    journal_last: dict[str, int] = {}
    for a in info.actions:
        hu = J.html_url_for(a.url) if a.url else None
        if hu:
            journal_dates.setdefault(hu, a.date)
            journal_last[hu] = a.seq

    wanted_rv = {a.record_vote for a in info.actions if a.record_vote}
    rollcalls: list[dict] = []
    sections_out: list[dict] = []
    missing_journals: list[str] = []
    senate_roster: list[str] = []
    for url, date in sorted(journal_dates.items(), key=lambda kv: (kv[1], journal_last[kv[0]])):
        chamber = "H" if ".house." in url else "S"
        html = f.get(url, optional=True)
        if not html:
            missing_journals.append(url)
            continue
        paras = J.parse_paras(html)
        sections = J.bill_sections(paras, bill.prefix, bill.number)
        statements = J.parse_statements(paras) if chamber == "H" else {}
        for s in sections:
            sections_out.append(
                {
                    "journal_url": url,
                    "chamber": chamber,
                    "date": date,
                    "header": s.header,
                    "reading": s.reading,
                    "paragraphs": [p.text for p in paras[s.start : s.end]],
                }
            )
        if chamber == "S":
            senate_roster = J.senate_roster(paras) or senate_roster
        for v in J.parse_votes(paras, chamber, url, senate_roster if chamber == "S" else None):
            sec = J.section_for(sections, v.para)
            # House votes count if the history cites them or they sit in the
            # bill's part of the journal (the history sometimes repeats one RV#
            # for a run of different votes). Senate votes have no numbers, so
            # only position in the journal ties them to the bill.
            if not (sec or (chamber == "H" and v.record in wanted_rv)):
                continue
            if sec and not _about_bill(v, paras, bill):
                continue
            # Look back for "Amendment No. N" from the start of this stretch of
            # consideration; a LEAVE OF ABSENCE header can split it in two.
            ctx_start = max(0, v.para - 60)
            if sec:
                k = sections.index(sec)
                ctx_start = sections[k - 1].start if k and sections[k - 1].reading == sec.reading else sec.start
            context = [p.text for p in paras[ctx_start : v.para]]
            v.header = sec.header if sec else ""
            v.reading = sec.reading if sec else ""
            v.statements = statements.get(v.record, []) if v.record else []
            rollcalls.append(_rollcall(v, date, context, resolver))
        if chamber == "S":
            roster = J.senate_roster(paras) or senate_roster
            for v in J.parse_calendar_votes(paras, bill.prefix, bill.number, url, roster):
                rollcalls.append(_rollcall(v, date, [], resolver))

    if missing_journals:
        log(f"  {len(missing_journals)} journal(s) have no HTML version; votes from them are missing:")
        for u in missing_journals:
            log(f"    {u}")

    found_rv = {rc["record"] for rc in rollcalls if rc["record"]}
    for rv in sorted(wanted_rv - found_rv):
        log(f"  warning: House RV#{rv} listed in history but not found in the journal")

    for i, rc in enumerate(rollcalls):
        if not rc["id"]:
            rc["id"] = f"S-tmp-{i}"
    actions = _link_actions(info, rollcalls, amendments)

    # Put roll calls in the order the history lists them (a day can have two
    # journals, e.g. 89RSJ03-19-F and -F1), then number Senate ones per day.
    order: dict[str, int] = {}
    for a in actions:
        for rc_id in [a["rollcall"], *a.get("extra_rollcalls", [])]:
            if rc_id:
                order.setdefault(rc_id, a["seq"])
    rollcalls.sort(key=lambda rc: (rc["date"], order.get(rc["id"], 10**6)))
    rename, per_day = {}, Counter()
    for rc in rollcalls:
        if rc["chamber"] == "S":
            per_day[rc["date"]] += 1
            rename[rc["id"]] = rc["id"] = f"S-{rc['date']}-{per_day[rc['date']]}"
    for a in actions:
        if a["rollcall"] in rename:
            a["rollcall"] = rename[a["rollcall"]]
        if "extra_rollcalls" in a:
            a["extra_rollcalls"] = [rename.get(x, x) for x in a["extra_rollcalls"]]

    members = _members(rollcalls, resolver)
    amend_out = []
    for a in amendments:
        d = asdict(a)
        d["key"], d["label"], d["chamber"] = a.key, a.label, a.chamber
        d["rollcalls"] = [rc["id"] for rc in rollcalls if rc.get("amendment_key") == a.key]
        d["applied_rollcall"] = next((rc["id"] for rc in rollcalls if a.key in rc.get("applied_to", [])), None)
        amend_out.append(d)

    sponsors = _sponsors(info, resolver)
    record = {
        "bill": {
            "label": bill.label,
            "tlo": bill.tlo,
            "session": bill.session,
            "session_label": bill.session_label,
            "origin": bill.origin,
            "history_url": bill.page("History"),
            "fields": info.fields,
        },
        "sponsors": sponsors,
        "actions": actions,
        "texts": [
            {"version": t.version, "html_url": t.html_url, "pdf_url": t.pdf_url, "docs": t.docs, "text": t.__dict__.get("text", "")}
            for t in texts
        ],
        "amendments": amend_out,
        "rollcalls": rollcalls,
        "members": members,
        "sections": sections_out,
        "missing_journals": missing_journals,
    }
    record["analysis"] = analyze(record)
    return record


def _rollcall(v: J.JournalVote, date: str, context: list[str], resolver: Resolver) -> dict:
    kind = classify(v.text, v.motion)
    num = amendment_number(v.text, v.motion, context) if kind in ("table", "amendment") else None
    amendment_key = f"{v.chamber}{v.reading}-{num}" if num and v.reading else None
    rc_id = f"H-RV{v.record}" if v.record else ""
    return {
        "id": rc_id,
        "chamber": v.chamber,
        "date": date,
        "record": v.record,
        "journal_url": v.journal_url,
        "header": v.header,
        "reading": v.reading,
        "text": v.text,
        "motion": v.motion,
        "kind": kind,
        "yea_means": YEA_MEANS[kind],
        "amendment_number": num,
        "amendment_key": amendment_key,
        "result": result_of(v.text, v.yeas, v.nays),
        "yeas": v.yeas,
        "nays": v.nays,
        "pnv": v.pnv,
        "inferred": v.inferred,
        "deemed": v.deemed,
        "same_as_previous": v.same_as_previous,
        "raw_members": v.members,
        "statements": [asdict(s) for s in v.statements],
    }


def _member_id(chamber: str, raw: str, p: Person | None) -> str:
    if p:
        return p.key
    return chamber + ":" + re.sub(r"\(C\)$", "", raw).strip()


def _members(rollcalls: list[dict], resolver: Resolver) -> dict[str, dict]:
    members: dict[str, dict] = {}
    resolved: dict[tuple[str, str], Person | None] = {}
    for chamber in ("H", "S"):
        names = {raw for rc in rollcalls if rc["chamber"] == chamber for raw in rc["raw_members"]}
        for raw, p in resolver.assign(chamber, names).items():
            resolved[(chamber, raw)] = p

    def mid(chamber: str, raw: str) -> str:
        p = resolved[(chamber, raw)]
        key = _member_id(chamber, raw, p)
        if key not in members:
            short = re.sub(r"\(C\)$", "", raw).strip()
            if is_speaker(raw) and p:
                short = f"{p.name.split()[-1]} (Speaker)"
            members[key] = {
                "id": key,
                "chamber": chamber,
                "short": short,
                "name": p.name if p else short,
                "party": p.party if p else "?",
                "district": p.district if p else "",
                "matched": bool(p),
            }
        return key

    for rc in rollcalls:
        rc["members"] = {mid(rc["chamber"], raw): code for raw, code in rc.pop("raw_members").items()}
        for s in rc["statements"]:
            p = resolver.resolve("H", s["member"]) if s["member"] else None
            s["member_id"] = _member_id("H", s["member"], p) if s["member"] else ""
    unmatched = sorted(m["short"] for m in members.values() if not m["matched"])
    if unmatched:
        log(f"  {len(unmatched)} name(s) without party data: {', '.join(unmatched)}")
    return members


def _sponsors(info, resolver: Resolver) -> dict[str, str | None]:
    """Lead author in the origin chamber, lead sponsor in the other one."""
    origin = info.bill.origin
    other = "S" if origin == "H" else "H"
    out = {}
    for chamber, names in ((origin, info.names("Author")), (other, info.names("Sponsor"))):
        if not names:
            out[chamber] = None
            continue
        p = resolver.resolve(chamber, names[0])
        out[chamber] = _member_id(chamber, names[0], p)
    return out


def _about_bill(v: J.JournalVote, paras: list[J.Para], bill: BillId) -> bool:
    """Drop votes inside the bill's stretch of journal that are plainly about
    something else (another bill, Senate confirmation of nominees)."""
    text = f"{v.motion} {v.text}"
    if re.search(r"nominee|confirm", text, re.I):
        return False
    refs = J.bill_refs(text)
    return not refs or (bill.prefix, bill.number) in refs


def _link_actions(info, rollcalls: list[dict], amendments) -> list[dict]:
    by_rv = {rc["record"]: rc["id"] for rc in rollcalls if rc["record"]}
    queue: dict[str, list[str]] = defaultdict(list)  # journal -> roll calls in journal order
    for rc in rollcalls:
        queue[rc["journal_url"]].append(rc["id"])
    used: set[str] = set()
    pos: dict[str, int] = defaultdict(lambda: -1)  # last linked position per journal

    def take(rc_id: str, journal: str | None) -> str:
        used.add(rc_id)
        if journal and rc_id in queue.get(journal, []):
            pos[journal] = max(pos[journal], queue[journal].index(rc_id))
        return rc_id

    out = []
    applied: list[tuple[str, str]] = []  # (amendment key, roll call) for reused record votes
    last_amendment = None
    for a in info.actions:
        d = asdict(a)
        d["record_vote"] = a.record_vote
        d["journal_html"] = J.html_url_for(a.url) if a.url else None
        d["rollcall"] = None
        if a.description.lower().startswith(("record vote", "vote recorded in journal")):
            j = d["journal_html"]
            rv_id = by_rv.get(a.record_vote) if a.record_vote else None
            if rv_id:
                # The House can suspend rules to apply one record vote to many
                # amendments ("use Record No. 456 for all amendments"), so the
                # same RV# legitimately appears on many actions.
                if rv_id in used and last_amendment:
                    applied.append((last_amendment, rv_id))
                d["rollcall"] = take(rv_id, rc_journal(rollcalls, rv_id))
            elif j:
                # Unnumbered (Senate) votes: the next unclaimed vote in that
                # journal after the last one we linked.
                nxt = next((x for i, x in enumerate(queue.get(j, [])) if i > pos[j] and x not in used), None)
                if nxt:
                    d["rollcall"] = take(nxt, j)
        d["amendment"] = None
        # House: "3-Toth, Olcott"; Senate: "FA1 Creighton" (floor), "CA1 ..." (committee)
        m = re.match(r"^(?:[FC]A)?(\d+)[- ](.+)$", a.comment)
        if m and "amend" in a.description.lower():
            n = int(m.group(1))
            # First author's surname: "S. Thompson and Dukes" -> "thompson"
            first = m.group(2).split(",")[0].split(" and ")[0].lower()
            who = max(re.findall(r"[^\W\d_]+", first), key=len, default="")
            for am in amendments:
                if am.number == n and am.date == a.date and who in am.author.lower():
                    d["amendment"] = am.key
                    break
        if d["amendment"]:
            last_amendment = d["amendment"]
        out.append(d)

    # Votes the history doesn't list still belong in the timeline: hang each
    # off the nearest preceding action that links a vote from the same journal.
    for url, ids in queue.items():
        for rc_id in ids:
            if rc_id in used:
                continue
            i = ids.index(rc_id)
            before = {x for x in ids[:i] if x in used}
            anchor = max((d for d in out if d["rollcall"] in before), key=lambda d: d["seq"], default=None)
            anchor = anchor or max((d for d in out if d["journal_html"] == url), key=lambda d: d["seq"], default=None)
            if anchor is not None:
                anchor.setdefault("extra_rollcalls", []).append(rc_id)
                used.add(rc_id)
    for key, rc_id in applied:
        rc = next(rc for rc in rollcalls if rc["id"] == rc_id)
        rc.setdefault("applied_to", [])
        if key not in rc["applied_to"] and key != rc["amendment_key"]:
            rc["applied_to"].append(key)
    return out


def rc_journal(rollcalls: list[dict], rc_id: str) -> str | None:
    return next((rc["journal_url"] for rc in rollcalls if rc["id"] == rc_id), None)


# ---------------------------------------------------------------- analysis


def analyze(rec: dict) -> dict:
    members = rec["members"]
    out: dict = {"chambers": {}}
    for chamber in ("S", "H"):
        rcs = [rc for rc in rec["rollcalls"] if rc["chamber"] == chamber]
        if not rcs:
            continue
        sponsor = rec["sponsors"].get(chamber)

        # Party majority position on each roll call.
        party_pos: dict[str, dict[str, str]] = {}
        splits: dict[str, dict] = {}
        for rc in rcs:
            tally: dict[str, Counter] = defaultdict(Counter)
            for mid, code in rc["members"].items():
                tally[members[mid]["party"]][code] += 1
            splits[rc["id"]] = {p: dict(c) for p, c in tally.items()}
            party_pos[rc["id"]] = {
                p: ("Y" if c["Y"] > c["N"] else "N" if c["N"] > c["Y"] else "")
                for p, c in tally.items()
            }
            rc["party_split"] = splits[rc["id"]]

        summary = []
        chamber_members = sorted({mid for rc in rcs for mid in rc["members"]})
        for mid in chamber_members:
            m = members[mid]
            counts = Counter(rc["members"].get(mid, "—") for rc in rcs)
            with_sp = against_sp = with_party = against_party = 0
            defections, broke_with_sponsor = [], []
            for rc in rcs:
                code = rc["members"].get(mid)
                if code not in ("Y", "N"):
                    continue
                sp = rc["members"].get(sponsor) if sponsor else None
                if sp in ("Y", "N") and mid != sponsor:
                    if sp == code:
                        with_sp += 1
                    else:
                        against_sp += 1
                        broke_with_sponsor.append(rc["id"])
                pp = party_pos[rc["id"]].get(m["party"])
                if pp and m["party"] != "?":
                    if pp == code:
                        with_party += 1
                    else:
                        against_party += 1
                        defections.append(rc["id"])
            summary.append(
                {
                    "id": mid,
                    "counts": dict(counts),
                    "with_sponsor": with_sp,
                    "against_sponsor": against_sp,
                    "sponsor_pct": round(100 * with_sp / (with_sp + against_sp), 1) if with_sp + against_sp else None,
                    "with_party": with_party,
                    "against_party": against_party,
                    "party_pct": round(100 * with_party / (with_party + against_party), 1)
                    if with_party + against_party
                    else None,
                    "defections": defections,
                    "broke_with_sponsor": broke_with_sponsor,
                }
            )

        # Blocs: members whose Yea/Nay record on every roll call is identical
        # (absences and present-not-voting count as their own value).
        patterns: dict[str, list[str]] = defaultdict(list)
        for mid in chamber_members:
            pat = "".join({"Y": "Y", "N": "N"}.get(rc["members"].get(mid, ""), "-") for rc in rcs)
            patterns[pat].append(mid)
        blocs = sorted(
            ({"pattern": p, "members": ms} for p, ms in patterns.items() if len(ms) > 1),
            key=lambda b: -len(b["members"]),
        )

        out["chambers"][chamber] = {
            "sponsor": sponsor,
            "rollcalls": [rc["id"] for rc in rcs],
            "party_position": party_pos,
            "members": summary,
            "blocs": blocs,
        }
    return out
