"""Scrapers for Texas Legislature Online (capitol.texas.gov) bill pages."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup

from .fetch import Fetcher

BASE = "https://capitol.texas.gov/BillLookup/"

BILL_RE = re.compile(r"^(HB|SB|HJR|SJR|HCR|SCR|HR|SR)\s*0*(\d+)$", re.I)


@dataclass
class BillId:
    session: str  # TLO LegSess code, e.g. "89R" or "892"
    prefix: str  # "SB"
    number: int

    @property
    def tlo(self) -> str:
        return f"{self.prefix}{self.number}"

    @property
    def label(self) -> str:
        return f"{self.prefix} {self.number}"

    @property
    def origin(self) -> str:
        return "H" if self.prefix.startswith("H") else "S"

    @property
    def session_label(self) -> str:
        leg, kind = self.session[:-1], self.session[-1]
        return f"{leg}({kind})"

    @property
    def slug(self) -> str:
        return f"{self.session}-{self.tlo}"

    def page(self, name: str) -> str:
        return f"{BASE}{name}.aspx?LegSess={self.session}&Bill={self.tlo}"


def year_to_session(year: int) -> str:
    """Legislature number for a calendar year; regular sessions sit in odd years."""
    return f"{(year - 1847) // 2}R"


def parse_bill_arg(arg: str, session: str | None = None) -> BillId:
    """Accept 'SB17', 'SB 17', a LegiScan URL, or a capitol.texas.gov URL."""
    arg = arg.strip()
    if arg.startswith("http"):
        url = urlparse(arg)
        if "legiscan.com" in url.netloc:
            # https://legiscan.com/TX/drafts/SB17/2025, /TX/bill/SB17/2025, /TX/votes/...
            parts = [p for p in url.path.split("/") if p]
            bill = next((p for p in parts if BILL_RE.match(p)), None)
            year = next((p for p in parts if re.fullmatch(r"\d{4}", p)), None)
            if not bill:
                raise ValueError(f"Can't find a bill number in {arg}")
            if not session and year:
                session = year_to_session(int(year))
            arg = bill
        elif "texas.gov" in url.netloc:
            qs = parse_qs(url.query)
            arg = qs.get("Bill", [""])[0]
            session = session or qs.get("LegSess", [None])[0]
    m = BILL_RE.match(arg.replace(".", ""))
    if not m:
        raise ValueError(f"Unrecognized bill '{arg}' (expected e.g. SB17, HB 2, HJR4)")
    if not session:
        raise ValueError("Session required, e.g. --session 89R (89th Legislature, regular session)")
    session = session.upper().replace("(", "").replace(")", "")
    if not re.fullmatch(r"\d{2}[R1-9]", session):
        raise ValueError(f"Bad session '{session}': use e.g. 89R, 891, 892")
    return BillId(session, m.group(1).upper(), int(m.group(2)))


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


@dataclass
class Action:
    seq: int  # chronological order, 0 = first
    chamber: str  # H, S, E (executive)
    description: str
    comment: str
    date: str  # ISO
    time: str
    journal_page: str
    url: str  # journal PDF link, possibly with #page=

    @property
    def record_vote(self) -> int | None:
        m = re.search(r"RV#\s*(\d+)", self.comment)
        return int(m.group(1)) if m else None


@dataclass
class BillInfo:
    bill: BillId
    fields: dict[str, str] = field(default_factory=dict)
    actions: list[Action] = field(default_factory=list)

    def names(self, key: str) -> list[str]:
        return [n.strip() for n in self.fields.get(key, "").split("|") if n.strip()]


def fetch_history(f: Fetcher, bill: BillId) -> BillInfo:
    html = f.get(bill.page("History"))
    soup = _soup(html)
    info = BillInfo(bill)

    hist = soup.find("div", class_="history")
    if hist:
        for label in hist.find_all("div", class_="label"):
            data = label.find_next_sibling("div", class_="data")
            if not data:
                continue
            key = _clean(label.get_text()).rstrip(":")
            for br in data.find_all("br"):
                br.replace_with(" | ")
            info.fields[key] = _clean(data.get_text()).strip(" |")
    if not info.fields:
        raise ValueError(f"No bill found at {bill.page('History')}")

    rows = soup.select("table.actions tr")
    actions = []
    for tr in rows:
        cells = {td.get("data-label"): td for td in tr.find_all("td")}
        if "Action Description" not in cells:
            continue
        link = cells["Action Description"].find("a", href=True)
        actions.append(
            Action(
                seq=0,
                chamber=_clean(cells["Action Chamber"].get_text()),
                description=_clean(cells["Action Description"].get_text()),
                comment=_clean(cells.get("Action Comment").get_text()) if cells.get("Action Comment") else "",
                date=datetime.strptime(_clean(cells["Action Date"].get_text()), "%m/%d/%Y").date().isoformat(),
                time=_clean(cells["Action Time"].get_text()) if cells.get("Action Time") else "",
                journal_page=_clean(cells["Journal Page Number"].get_text()) if cells.get("Journal Page Number") else "",
                url=link["href"] if link and link["href"].startswith("http") else "",
            )
        )
    # TLO lists newest first (same-day actions in reverse journal order), so
    # reversing gives the true chronological sequence.
    actions.reverse()
    for i, a in enumerate(actions):
        a.seq = i
    info.actions = actions
    return info


@dataclass
class TextVersion:
    version: str
    html_url: str
    pdf_url: str
    docs: dict[str, str] = field(default_factory=dict)  # fiscal note, analysis, ...


def fetch_text_versions(f: Fetcher, bill: BillId) -> list[TextVersion]:
    soup = _soup(f.get(bill.page("Text")))
    out = []
    for table in soup.find_all("table"):
        header = _clean(table.find("tr").get_text()) if table.find("tr") else ""
        if not header.startswith("Version"):
            continue
        for tr in table.find_all("tr")[1:]:
            tds = tr.find_all("td")
            if not tds:
                continue
            version = _clean(tds[0].get_text())
            links = [a["href"] for a in tr.find_all("a", href=True)]
            html_url = next((u for u in links if "/billtext/html/" in u), "")
            pdf_url = next((u for u in links if "/billtext/pdf/" in u or "/scanned/" in u), "")
            docs = {}
            for u in links:
                m = re.search(r"/tlodocs/[^/]+/(\w+)/html/", u)
                if m and m.group(1) != "billtext":
                    docs[m.group(1)] = u
            if version and (html_url or pdf_url):
                out.append(TextVersion(version, html_url, pdf_url, docs))
        break
    return out


@dataclass
class Amendment:
    reading: str  # "H 2" = House second reading, "S 3" = Senate third reading
    number: int
    author: str
    type: str  # Amendment / Amendment to Amendment / Floor Substitute ...
    action: str  # Adopted / Tabled / Failed / Withdrawn ...
    date: str
    html_url: str
    pdf_url: str
    text: str = ""

    @property
    def chamber(self) -> str:
        return self.reading.split()[0] if self.reading else ""

    @property
    def key(self) -> str:
        return f"{self.reading.replace(' ', '')}-{self.number}"

    @property
    def label(self) -> str:
        reading = {"2": "2nd rdg", "3": "3rd rdg"}.get(self.reading[-1:], self.reading)
        return f"{self.chamber} {reading} Amd {self.number}"


def fetch_amendments(f: Fetcher, bill: BillId) -> list[Amendment]:
    soup = _soup(f.get(bill.page("Amendments")))
    out = []
    for table in soup.find_all("table"):
        first = table.find("tr")
        if not first or not _clean(first.get_text()).startswith("Reading"):
            continue
        for tr in table.find_all("tr")[1:]:
            tds = [_clean(td.get_text()) for td in tr.find_all("td")]
            if len(tds) < 6:
                continue
            links = [urljoin(BASE, a["href"]) for a in tr.find_all("a", href=True)]
            try:
                number = int(re.sub(r"\D", "", tds[1]) or 0)
            except ValueError:
                number = 0
            date = tds[5]
            try:
                date = datetime.strptime(date, "%m/%d/%Y").date().isoformat()
            except ValueError:
                pass
            out.append(
                Amendment(
                    reading=tds[0],
                    number=number,
                    author=tds[2].replace(" | ", ", "),
                    type=tds[3],
                    action=tds[4],
                    date=date,
                    html_url=next((u for u in links if "/html/" in u.lower()), ""),
                    pdf_url=next((u for u in links if "/pdf/" in u.lower()), ""),
                )
            )
        break
    return out


def html_to_text(html: str) -> str:
    """Flatten TLO bill/amendment HTML to text.

    Texas bills underline new language and strike deleted language. Those are
    kept as {+added+} and [-deleted-] so the plain text still says what changes.
    """
    soup = _soup(html)
    for tag in soup(["script", "style", "head"]):
        tag.decompose()
    for u in soup.find_all("u"):
        u.insert_before("{+")
        u.insert_after("+}")
        u.unwrap()
    for s in soup.find_all(["s", "strike", "del"]):
        s.insert_before("[-")
        s.insert_after("-]")
        s.unwrap()

    def clean(t: str) -> str:
        t = re.sub(r"\s+", " ", t.replace("\xa0", " ")).strip()
        # Markup split across tags or rows leaves "}{+" seams; close them up.
        t = re.sub(r"\+\}\s*\{\+", " ", t.replace("+}{+", ""))
        t = re.sub(r"-\]\s*\[-", " ", t.replace("-][-", ""))
        # Bills print deletions as "[<s>text</s>]"; don't double the brackets.
        t = t.replace("[[-", "[-").replace("-]]", "-]")
        t = re.sub(r"\{\+\s*\+\}|\[-\s*-\]", "", t)
        return re.sub(r"\s+", " ", t).strip()

    blocks = soup.find_all(["tr", "div", "p"])
    leaf_blocks = [b for b in blocks if not b.find(["tr", "div", "p"])] or [soup]

    # Bill text is laid out one printed line per table row. Rebuild paragraphs:
    # a row starts a new paragraph when it is indented, follows a blank row, or
    # switches between centered (headings) and body text.
    paras: list[str] = []
    cur: list[str] = []
    prev_center = False

    def flush():
        if cur:
            text = clean(" ".join(cur))
            if text:
                paras.append(text)
            cur.clear()

    for b in leaf_blocks:
        if b.name != "tr":
            flush()
            paras.append(clean(b.get_text()))
            continue
        tds = [td for td in b.find_all("td") if not td.find("meta")] or b.find_all("td")
        raw = " ".join(td.get_text() for td in tds) if tds else b.get_text()
        center = any((td.get("align") or "").lower() == "center" or td.find("center") for td in tds)
        lead = raw.lstrip(" \t\r\n")
        if not lead.strip(" \t\r\n\xa0"):
            flush()
            continue
        if lead.startswith("\xa0") or center != prev_center:
            flush()
        cur.append(raw)
        prev_center = center
    flush()
    return "\n".join(p for p in paras if p) + "\n"
