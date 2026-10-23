"""Parse House and Senate journal HTML for the floor proceedings on one bill.

Journals are the official record of floor action. Each paragraph is a
<div class="textpara">, and record votes are written out in full:

House:   Amendment No. 1 was adopted by (Record 1845):  91 Yeas, 0 Nays, 54 Present, not voting.
         Yeas — Alders; Ashby; Bell, C.; ...
Senate:  The motion prevailed by the following vote:  Yeas 24, Nays 7.
         Yeas:  Bettencourt, Birdwell, A. Hinojosa, ...
"""

from __future__ import annotations

import html as htmllib
import re
from dataclasses import dataclass, field

PARA_RE = re.compile(r'<div class="textpara"([^>]*)>(.*?)</div>', re.S)

VOTE_CODES = {
    "yeas": "Y",
    "nays": "N",
    "present, not voting": "PNV",
    "present-not voting": "PNV",
    "absent, excused": "EXC",
    "absent-excused": "EXC",
    "absent": "ABS",
}

HOUSE_TALLY = re.compile(
    r"\(Record\s+(\d+)\):\s*(\d+)\s+Yeas?,\s*(\d+)\s+Nays?,\s*(\d+)\s+Present,\s*not voting", re.I
)
HOUSE_LIST = re.compile(r"^(Yeas|Nays|Present, not voting|Absent, Excused(?:,[^—]*)?|Absent)\s*—\s*(.*)$")
SENATE_TALLY = re.compile(
    r"by the following vote:\s*Yeas\s+(\d+),\s*Nays\s+(\d+)(?:,\s*Present-not voting\s+(\d+))?", re.I
)
SENATE_LIST = re.compile(r"^(Yeas|Nays|Present-not voting|Absent-excused|Absent):\s*(.*)$", re.I)
DEEMED = re.compile(r"All Members are deemed to have voted \"(Yea|Nay)\" on (?:the )?(.*?)(?: except as follows|\.\s*$)", re.I)
RECORDED_AS = re.compile(r'^Senators? (.+?) asked to be recorded as voting "(Yea|Nay)" (?:on|in) (.*)$', re.I)
CAL_ITEM = re.compile(r"^(?:CS)?(HJR|SJR|HCR|SCR|HB|SB)\s+(\d+)\s+\(([^)]+)\)$")
CAL_TALLY = re.compile(r'\((\d+)-(\d+)(?:-(\d+))?\)((?:\s*"[^"]+"\s*[^("]*)*)')
SAME_AS_PREVIOUS = re.compile(r"\(Same as previous roll call\)", re.I)
STATEMENT_RE = re.compile(r"^When Record No\.\s*(\d+) was taken,\s*(.*)$")

# Bill references as they appear in headers and text: "CSSB 17", "SB 17",
# "COMMITTEE SUBSTITUTE SENATE BILL 17", "HOUSE JOINT RESOLUTION 4".
SHORT_REF = re.compile(r"\b(?:CS)?(HJR|SJR|HCR|SCR|HB|SB|HR|SR)\s*(\d+)\b")
LONG_REF = re.compile(r"(HOUSE|SENATE)\s*(JOINT\s*RESOLUTION|CONCURRENT\s*RESOLUTION|BILL|RESOLUTION)\s*(\d+)\b")
LONG_PREFIX = {
    ("HOUSE", "BILL"): "HB",
    ("SENATE", "BILL"): "SB",
    ("HOUSE", "JOINTRESOLUTION"): "HJR",
    ("SENATE", "JOINTRESOLUTION"): "SJR",
    ("HOUSE", "CONCURRENTRESOLUTION"): "HCR",
    ("SENATE", "CONCURRENTRESOLUTION"): "SCR",
    ("HOUSE", "RESOLUTION"): "HR",
    ("SENATE", "RESOLUTION"): "SR",
}

# Centered headers that start a new item of business. A header naming another
# bill also ends the current one. Anything else (STATEMENTS OF VOTE, MIDNIGHT,
# AT EASE, headings inside amendment text) is part of the ongoing consideration.
STOP_HEADER = re.compile(
    r"RECESS|ADJOURN|MESSAGES? FROM|CALENDAR|RESOLUTIONS?\b|LEAVES? OF ABSENCE|SIGNED|ENROLLED|ENGROSSED"
    r"|COMMITTEE (REPORTS?|MEETING|SUBSTITUTE)|GUESTS? PRESENTED|PHYSICIAN|IN MEMORY|PRAYER|MOTIONS? IN WRITING"
    r"|INTRODUCTION|PROVIDING FOR|CONGRATULATORY|MEMORIAL|POSTING|NOMINATIONS|SENT TO"
    r"|LAID ON THE TABLE|MORNING CALL|APPENDIX|WELCOME|RECOGNITION|BILLS? (ON|AND|REFERRED|REMOVED)|REPORTS? OF"
    r"|^HOUSE CHAMBER$|^SENATE CHAMBER$|CAPITOL|LOCAL AND UNCONTESTED|CONSENT CALENDAR|ANNOUNCEMENT",
    re.I,
)


@dataclass
class Para:
    idx: int
    text: str
    centered: bool
    right: bool


def html_url_for(url: str) -> str | None:
    """Map a journal PDF link from the bill history to its HTML twin."""
    m = re.match(
        r"https?://journals\.(house|senate)\.texas\.gov/([hs]jrnl)/([^/]+)/pdf/([^/#?]+)\.PDF", url, re.I
    )
    if not m:
        return None
    chamber, kind, sess, name = m.groups()
    return f"https://journals.{chamber.lower()}.texas.gov/{kind}/{sess}/html/{name}.HTM"


OLD_PARA_RE = re.compile(r"<p\b([^>]*)>(.*?)</p>", re.S | re.I)
HIDDEN_RE = re.compile(r"<font[^>]*color=\"?white\"?[^>]*>.*?</font>", re.S | re.I)


def parse_paras(html: str) -> list[Para]:
    matches = PARA_RE.findall(html)
    if not matches:
        # Journals before the 83rd Legislature (2013) use bare <P> tags, with
        # white-on-white filler characters standing in for spaces.
        html = HIDDEN_RE.sub(" ", html)
        matches = OLD_PARA_RE.findall(html)
    out = []
    for style, body in matches:
        style = style.lower().replace("align=center", "text-align:center").replace('align="center"', "text-align:center")
        style = style.replace("align=right", "text-align:right").replace('align="right"', "text-align:right")
        text = htmllib.unescape(re.sub(r"<[^>]+>", "", body)).replace("\xa0", " ")
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        out.append(Para(len(out), text, "text-align:center" in style, "text-align:right" in style))
    return out


def bill_refs(text: str) -> set[tuple[str, int]]:
    refs = {(p, int(n)) for p, n in SHORT_REF.findall(text)}
    for chamber, kind, num in LONG_REF.findall(text):
        prefix = LONG_PREFIX.get((chamber, re.sub(r"\s+", "", kind)))
        if prefix:
            refs.add((prefix, int(num)))
    return refs


@dataclass
class Section:
    start: int
    end: int  # exclusive
    header: str
    reading: str  # "2", "3", or ""


def bill_sections(paras: list[Para], prefix: str, number: int) -> list[Section]:
    """Find the stretches of the journal where the bill is the business at hand."""
    target = (prefix, number)
    sections: list[Section] = []
    cur: Section | None = None
    reading = ""
    for p in paras:
        if not p.centered:
            continue
        refs = bill_refs(p.text)
        if target in refs:
            m = re.search(r"ON (SECOND|THIRD) READING", p.text, re.I)
            if m:
                reading = "2" if m.group(1).upper() == "SECOND" else "3"
            elif re.search(r"(HOUSE|SENATE) AMENDMENTS|CONCUR|CONFERENCE|VETO|ADOPTED", p.text, re.I):
                # A new stage (taking up the other chamber's amendments, a
                # conference report). "REMARKS", "(consideration continued)" etc.
                # keep the current reading.
                reading = ""
            if cur is not None and cur.reading == reading:
                continue
            if cur is not None:
                cur.end = p.idx
                sections.append(cur)
            cur = Section(p.idx, len(paras), p.text, reading)
            continue
        if cur is None:
            continue
        if refs or STOP_HEADER.search(p.text):
            cur.end = p.idx
            sections.append(cur)
            cur = None
    if cur:
        sections.append(cur)
    return sections


def split_names(chamber: str, raw: str) -> list[str]:
    raw = raw.strip().rstrip(".")
    sep = ";" if chamber == "H" else ","
    out = []
    for name in raw.split(sep):
        # "(C)" marks the member presiding at the time; same person either way.
        name = re.sub(r"\(C\)$", "", name.strip().rstrip(".")).strip()
        name = re.sub(r",\s*([A-Z])$", r", \1.", name)  # "Bell, C" -> "Bell, C." wherever it sat in the list
        if name and name.lower() != "none":
            out.append(name)
    return out


@dataclass
class Statement:
    member: str
    text: str
    intended: str  # Y / N / PNV / "" if unclear


@dataclass
class JournalVote:
    chamber: str
    journal_url: str
    para: int
    record: int | None
    text: str
    motion: str
    yeas: int
    nays: int
    pnv: int
    members: dict[str, str] = field(default_factory=dict)  # journal name -> Y/N/PNV/EXC/ABS
    same_as_previous: bool = False
    inferred: bool = False  # names filled from the day's roll call (Senate unanimous votes)
    deemed: bool = False  # Senate voice vote where members are "deemed" to vote one way
    header: str = ""
    reading: str = ""
    statements: list[Statement] = field(default_factory=list)


def _motion_before(paras: list[Para], idx: int, floor: int) -> str:
    """The motion a vote paragraph disposes of, if it was stated just before it."""
    for j in range(idx - 1, max(floor, idx - 8) - 1, -1):
        t = paras[j].text
        if re.search(r"\bmoved\b|\boffered the following\b|\brequested\b", t):
            return t
        if HOUSE_TALLY.search(t) or SENATE_TALLY.search(t):
            break
    return ""


def _read_lists(paras: list[Para], start: int, chamber: str) -> tuple[dict[str, str], int]:
    pattern = HOUSE_LIST if chamber == "H" else SENATE_LIST
    members: dict[str, str] = {}
    j = start
    while j < len(paras):
        m = pattern.match(paras[j].text)
        if not m:
            break
        label = m.group(1).lower()
        code = VOTE_CODES.get(label) or ("EXC" if label.startswith("absent, excused") else "ABS")
        for name in split_names(chamber, m.group(2)):
            members[name] = code
        j += 1
    return members, j


def senate_roster(paras: list[Para]) -> list[str]:
    for p in paras[:80]:
        m = re.search(r"following Senators were present:\s*(.*)$", p.text)
        if m:
            return split_names("S", m.group(1))
    return []


def parse_votes(paras: list[Para], chamber: str, journal_url: str, roster_hint: list[str] | None = None) -> list[JournalVote]:
    """Every record vote in the journal, in order.

    roster_hint: Senate names (journal spelling) to assume present when the
    journal has no roll call of its own, e.g. a second journal for the same day.
    """
    votes: list[JournalVote] = []
    roster = (senate_roster(paras) or roster_hint or []) if chamber == "S" else []
    for p in paras:
        if chamber == "H":
            m = HOUSE_TALLY.search(p.text)
            if not m:
                continue
            members, _ = _read_lists(paras, p.idx + 1, "H")
            votes.append(
                JournalVote(
                    "H", journal_url, p.idx, int(m.group(1)), p.text, _motion_before(paras, p.idx, 0),
                    int(m.group(2)), int(m.group(3)), int(m.group(4)), members,
                )
            )
            continue

        r = RECORDED_AS.match(p.text)
        if r and not (p.idx and RECORDED_AS.match(paras[p.idx - 1].text)):
            # Voice vote where members ask to be recorded the other way:
            # "Senator Cook asked to be recorded as voting "Nay" on ...". Take
            # the run of such requests; everyone else present goes the other way.
            listed: dict[str, str] = {}
            texts = []
            j = p.idx
            while j < len(paras) and (rm := RECORDED_AS.match(paras[j].text)):
                code = "Y" if rm.group(2).lower() == "yea" else "N"
                for name in re.split(r",\s*(?:and\s+)?|\s+and\s+", rm.group(1)):
                    if name.strip():
                        listed[name.strip()] = code
                texts.append(paras[j].text)
                j += 1
            codes = set(listed.values())
            default = "N" if codes == {"Y"} else "Y"
            members = {n: default for n in roster}
            members.update(listed)
            prev = paras[p.idx - 1].text if p.idx else ""
            v = JournalVote(
                "S", journal_url, p.idx, None, " ".join([prev, *texts]).strip(), _motion_before(paras, p.idx - 1, 0),
                sum(1 for c in members.values() if c == "Y"), sum(1 for c in members.values() if c == "N"), 0, members,
            )
            v.deemed = True
            v.inferred = not roster
            votes.append(v)
            continue

        d = DEEMED.search(p.text)
        if d:
            # Senate voice vote with the dissenters printed: everyone present
            # is deemed to have voted the stated way except those listed.
            listed, _ = _read_lists(paras, p.idx + 1, "S")
            default = "Y" if d.group(1).lower() == "yea" else "N"
            members = {n: default for n in roster}
            members.update(listed)
            prev = paras[p.idx - 1].text if p.idx else ""
            v = JournalVote(
                "S", journal_url, p.idx, None, f"{prev} {p.text}".strip(), _motion_before(paras, p.idx - 1, 0),
                sum(1 for c in members.values() if c == "Y"), sum(1 for c in members.values() if c == "N"),
                sum(1 for c in members.values() if c == "PNV"), members,
            )
            v.deemed = True
            v.inferred = not roster
            votes.append(v)
            continue

        m = SENATE_TALLY.search(p.text)
        if not m:
            continue
        yeas, nays, pnv = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        v = JournalVote("S", journal_url, p.idx, None, p.text, _motion_before(paras, p.idx, 0), yeas, nays, pnv)
        if SAME_AS_PREVIOUS.search(p.text) and votes:
            v.members = dict(votes[-1].members)
            v.same_as_previous = True
            v.inferred = votes[-1].inferred
        else:
            v.members, _ = _read_lists(paras, p.idx + 1, "S")
            listed_yeas = sum(1 for c in v.members.values() if c == "Y")
            if listed_yeas == 0 and yeas and roster:
                # Lopsided Senate votes often list only the nays/absences.
                for name in roster:
                    v.members.setdefault(name, "Y")
                v.inferred = True
        if len(v.members) >= 25 and not v.inferred:
            roster = [n for n, c in v.members.items() if c in ("Y", "N", "PNV")]
        votes.append(v)
    return votes


def parse_calendar_votes(
    paras: list[Para], prefix: str, number: int, journal_url: str, roster: list[str]
) -> list[JournalVote]:
    """Senate Local and Uncontested Calendar entries, which pass bills in bulk:

        HB 128 (Kolkhorst)
        Relating to certain sister-city agreements ...
        (viva voce vote) (29-2) "Nays" Cook, Eckhardt (29-2) "Nays" Cook, Eckhardt

    The first tally is passage to third reading (or engrossment), the second final passage.
    """
    votes = []
    for p in paras:
        m = CAL_ITEM.match(p.text)
        if not m or (m.group(1), int(m.group(2))) != (prefix, number):
            continue
        line = next((q.text for q in paras[p.idx + 1 : p.idx + 4] if q.text.startswith("(viva voce vote)")), None)
        if not line:
            continue
        for k, t in enumerate(CAL_TALLY.finditer(line)):
            members = {n: "Y" for n in roster}
            for label, names in re.findall(r'"([^"]+)"\s*([^"]*)', t.group(4) or ""):
                code = "N" if label.lower().startswith("nay") else "PNV" if "present" in label.lower() else "Y"
                for name in split_names("S", names):
                    members[name] = code
            stage = ("passed to third reading" if prefix.startswith("H") else "passed to engrossment") if k == 0 else "finally passed"
            v = JournalVote(
                "S", journal_url, p.idx, None,
                f"{p.text} was {stage} by a viva voce vote on the Local and Uncontested Calendar {t.group(0).strip()}.",
                "", sum(1 for c in members.values() if c == "Y"), sum(1 for c in members.values() if c == "N"),
                sum(1 for c in members.values() if c == "PNV"), members,
            )
            v.deemed = True
            v.inferred = not roster
            v.header = "LOCAL AND UNCONTESTED CALENDAR"
            v.reading = "2" if k == 0 else "3"
            votes.append(v)
    return votes


def parse_statements(paras: list[Para]) -> dict[int, list[Statement]]:
    """House 'statements of vote': members correcting or explaining a record vote."""
    out: dict[int, list[Statement]] = {}
    for p in paras:
        m = STATEMENT_RE.match(p.text)
        if not m:
            continue
        rv, body = int(m.group(1)), m.group(2)
        signer = ""
        nxt = paras[p.idx + 1] if p.idx + 1 < len(paras) else None
        if nxt and nxt.right:
            signer = nxt.text
        intended = ""
        im = re.search(r"(?:would have voted|intended to vote|meant to vote)\s+(yes|no|present)", body, re.I)
        if im:
            intended = {"yes": "Y", "no": "N", "present": "PNV"}[im.group(1).lower()]
        out.setdefault(rv, []).append(Statement(signer, body, intended))
    return out


def section_for(sections: list[Section], idx: int) -> Section | None:
    for s in sections:
        if s.start <= idx < s.end:
            return s
    return None
