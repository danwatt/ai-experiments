"""Match journal vote names ("Bell, C.", "A. Hinojosa", "Mr. Speaker") to legislators with party.

The roster for each Legislature (name, chamber, district, party) comes from the
Legislative Reference Library's member search, which covers every session. A
members CSV (name,chamber,party,district) passed with --members is added on top.
"""

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from bs4 import BeautifulSoup

from .fetch import Fetcher

LRL_SEARCH = "https://lrl.texas.gov/legeLeaders/members/membersearch.cfm?leg={leg}&chamber={chamber}"
LRL_SPEAKER = LRL_SEARCH + "&leaderNote=Speaker%20of%20the%20House"
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z]+", " ", s.lower())
    return " ".join(t for t in s.split() if t not in SUFFIXES)


@dataclass
class Person:
    name: str
    party: str  # R / D / I / ?
    district: str
    chamber: str  # H / S
    speaker: bool = False

    @property
    def key(self) -> str:
        return f"{self.chamber}:{self.name}"


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def _rows(html: str | None):
    table = BeautifulSoup(html or "", "html.parser").find("table", id="tableToSort")
    return table.find("tbody").find_all("tr") if table and table.find("tbody") else []


def load_people(f: Fetcher, legislature: int, override: Path | None = None) -> list[Person]:
    people: list[Person] = []
    speakers = {
        _clean(tr.find("div", class_="mobileHide").get_text(" ", strip=True))
        for tr in _rows(f.get(LRL_SPEAKER.format(leg=legislature, chamber="H"), optional=True))
        if tr.find("div", class_="mobileHide")
    }
    for chamber in ("H", "S"):
        for tr in _rows(f.get(LRL_SEARCH.format(leg=legislature, chamber=chamber), optional=True)):
            name_div = tr.find("div", class_="mobileHide")
            tds = [td.get_text("\n", strip=True) for td in tr.find_all("td")]
            if not name_div or len(tds) < 6:
                continue
            # Members with several stints have one line per stint in each
            # column; take the one for this chamber.
            chambers = tds[2].split()
            parties = tds[5].split()
            i = chambers.index(chamber) if chamber in chambers else 0
            people.append(
                Person(
                    name=_clean(name_div.get_text(" ", strip=True)),
                    party=parties[i] if i < len(parties) else (parties[0] if parties else "?"),
                    district=tds[1].split()[0] if tds[1] else "",
                    chamber=chamber,
                    speaker=chamber == "H" and _clean(name_div.get_text(" ", strip=True)) in speakers,
                )
            )
    if override and override.exists():
        with override.open() as fh:
            for row in csv.DictReader(fh):
                people.append(
                    Person(row["name"].strip(), (row.get("party") or "?").strip()[:1].upper(),
                           (row.get("district") or "").strip(), row["chamber"].strip().upper()[:1])
                )
    return people


def split_name(raw: str) -> tuple[str, str]:
    """-> (surname as written, first initial or '')."""
    name = re.sub(r"\(C\)$", "", raw.strip()).strip()
    # House journal "Bell, C."; TLO author lists "Bell, Cecil", 'Hinojosa, Juan "Chuy"'
    m = re.match(r"^(.+?),\s*([A-Z])[\w.\"' ]*$", name)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^([A-Z])\.\s+(.+)$", name)  # Senate journal "A. Hinojosa"
    if m:
        return m.group(2), m.group(1)
    return name, ""


def is_speaker(raw: str) -> bool:
    return raw.strip().lower().startswith("mr. speaker")


def score(raw: str, p: Person) -> int:
    """How well a journal name fits a person; 0 means it can't be them."""
    last, initial = split_name(raw)
    want = norm(last).split()
    have = norm(p.name).split()
    if not want or not have:
        return 0
    if len(have) >= len(want) and have[-len(want):] == want:
        rest, base = have[: -len(want)], len(want) * 100
    else:
        # Names change between sessions ("Neave" -> "Neave Criado", "Ordaz Perez"
        # -> "Ordaz"): accept a surname token shared past the first name, weakly.
        shared = [i for i, t in enumerate(have) if i > 0 and t in want and len(t) >= 4]
        if not shared:
            return 0
        rest, base = have[: shared[0]], 30
    if initial and not any(t.startswith(initial.lower()) for t in rest):
        return 0
    # Longer surname matches win ("Leo Wilson" over "Wilson"); an initial
    # confirms; fewer leftover name parts breaks remaining ties.
    return base + (50 if initial else 0) - len(rest)


class Resolver:
    def __init__(self, people: list[Person]):
        self.people = people
        self.assigned: dict[tuple[str, str], Person | None] = {}

    def assign(self, chamber: str, names: set[str]) -> dict[str, Person | None]:
        """One-to-one match of every name seen in a chamber's votes to the roster.

        Matching all names together resolves "Wilson" vs "Leo Wilson" and
        "Harris" vs "Harris Davila": the longer match claims its person first.
        The Speaker (listed as "Mr. Speaker") gets the one member left over.
        """
        pool = [p for p in self.people if p.chamber == chamber]
        pairs = sorted(
            ((score(n, p), n, i) for n in names if not is_speaker(n) for i, p in enumerate(pool) if score(n, p)),
            reverse=True,
        )
        result: dict[str, Person | None] = {n: None for n in names}
        taken: set[int] = set()
        for _, n, i in pairs:
            if result[n] is None and i not in taken:
                result[n] = pool[i]
                taken.add(i)
        speakers = [n for n in names if is_speaker(n)]
        left = [p for i, p in enumerate(pool) if i not in taken]
        flagged = [p for p in left if p.speaker]
        if len(flagged) == 1:
            left = flagged
        if speakers and len(left) == 1:
            for n in speakers:
                result[n] = left[0]
        for n, p in result.items():
            self.assigned[(chamber, n)] = p
        # A second spelling of someone already matched: fall back to the best
        # unambiguous match regardless of who claimed it.
        for n in names:
            if result[n] is None and not is_speaker(n):
                del self.assigned[(chamber, n)]
                result[n] = self.resolve(chamber, n)
                self.assigned[(chamber, n)] = result[n]
        return result

    def resolve(self, chamber: str, raw: str) -> Person | None:
        """Match a single name (sponsor list, statement signer)."""
        if (chamber, raw) in self.assigned:
            return self.assigned[(chamber, raw)]
        scored = sorted(((score(raw, p), i) for i, p in enumerate(self.people) if p.chamber == chamber), reverse=True)
        scored = [s for s in scored if s[0]]
        if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]):
            return None
        return self.people[scored[0][1]]
