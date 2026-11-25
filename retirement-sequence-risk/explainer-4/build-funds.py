#!/usr/bin/env python3
"""Build funds.js: calendar-year total returns for the four American Funds Class A shares that stand in for
Ramsey Solutions' four-fund mix, and for an S&P 500 index fund to compare with, kept apart from the main data.js.

  growth and income  AIVSX  The Investment Company of America (launched 1934)
  growth             AGTHX  The Growth Fund of America        (launched 1973)
  international      CWGIX  Capital World Growth and Income   (launched March 1993; full years from 1994)
  aggressive growth  ANWPX  New Perspective Fund              (launched 1973)
  comparison         VFINX  Vanguard 500 Index Fund

All returns are total returns at NAV: fund expenses taken out, sales charges not (a $1 million balance pays
none), every dividend and capital gain reinvested.

Two sources, because Yahoo's price history understates these funds until the mid-1990s (it misses capital-gain
distributions; by 1 to 13 points a year):
  - Before YAHOO_FROM: the published calendar-year returns in PUBLISHED below, from the funds' own SEC filings
    (prospectus bar charts and ICA's year-by-year summary) and, for the earliest years of AGTHX, ANWPX and
    VFINX, Morningstar's annual total return table, which agrees with the filings to within a few tenths
    wherever they overlap.
  - From YAHOO_FROM on: Yahoo Finance daily closing NAVs plus every distribution, reinvested on its ex-date.
    Checked two ways, and the script prints both: against Capital Group's 1/3/5/10/15/20-year returns at NAV
    as of 10/31/2026, and against the published calendar years where the two overlap.

CWGIX did not exist before 1994 (as a full year). For 1981-1993 its slot uses New Perspective's return, a
global stock fund from the same family, and funds.js marks those years as a stand-in.

Usage: python3 build-funds.py
"""
import datetime, json, urllib.request

# in the order The Total Money Makeover lists the four kinds of funds
FUNDS = [("AIVSX", "The Investment Company of America", "growth and income", 1934),
         ("AGTHX", "The Growth Fund of America", "growth", 1973),
         ("CWGIX", "Capital World Growth and Income Fund", "international", 1993),
         ("ANWPX", "New Perspective Fund", "aggressive growth", 1973)]
COMPARE = {"SP": "VFINX"}      # the comparison scene's S&P 500 index fund
STAND_IN = {"CWGIX": "ANWPX"}  # whose returns fill the years before a fund's first full year
FIRST, LAST = 1981, 2025
YAHOO_FROM = {"AGTHX": 1996, "AIVSX": 1996, "ANWPX": 1995, "CWGIX": 1998, "VFINX": 1996}

# Calendar-year total returns at NAV, percent. Sources:
#   P97  Growth Fund of America prospectus, 10/31/1997 (EDGAR 0000044201-97-000011), "annual total returns"
#   P98  Investment Company of America prospectus, 2/27/1998 (0000051931-98-000002)
#   AR95 Investment Company of America annual report for 1995 (0000051931-96-000007), year-by-year summary
#   NP95 New Perspective prospectus, 11/30/1995 (0000071516-95-000010); NP97 the same, 11/26/1997 (-97-000015)
#   CW98 Capital World Growth and Income prospectus, 1/30/1998 (0000894005-98-000004)
#   MS   Morningstar annual total return history, as shown on finance.yahoo.com/quote/<ticker>/performance
PUBLISHED = {
    "AGTHX": {1981: 0.44, 1982: 25.69, 1983: 26.76, 1984: -5.51, 1985: 27.05,                      # MS
              1986: 16.16, 1987: 7.32, 1988: 18.46, 1989: 30.06, 1990: -4.12, 1991: 35.79,         # P97
              1992: 7.40, 1993: 14.50, 1994: 0.02, 1995: 29.80},
    "AIVSX": {1981: 0.9, 1982: 33.8, 1983: 20.2, 1984: 6.7, 1985: 33.4, 1986: 21.7, 1987: 5.4,      # AR95
              1988: 13.34, 1989: 29.41, 1990: 0.68, 1991: 26.54, 1992: 6.99, 1993: 11.62,          # P98
              1994: 0.16, 1995: 30.63},
    "ANWPX": {1981: 2.12, 1982: 21.54, 1983: 23.57, 1984: 0.13,                                     # MS
              1985: 34.29, 1986: 26.83,                                                             # NP95
              1987: 13.50, 1988: 10.39, 1989: 25.91, 1990: -2.08, 1991: 22.64, 1992: 3.98,         # NP97
              1993: 26.98, 1994: 2.97},
    "CWGIX": {1994: 1.22, 1995: 21.39, 1996: 21.55, 1997: 17.99},                                   # CW98
    "VFINX": {1981: -5.21, 1982: 20.97, 1983: 21.29, 1984: 6.21, 1985: 31.23, 1986: 18.06,         # MS
              1987: 4.71, 1988: 16.22, 1989: 31.36, 1990: -3.32, 1991: 30.22, 1992: 7.42,
              1993: 9.89, 1994: 1.18, 1995: 37.45},
}
# Where each year comes from, for the page's data table: (first year, source id) per fund, in order
SEC = "https://www.sec.gov/Archives/edgar/data/{}/{}.txt"
SOURCES = {
    "P97": ("Growth Fund of America prospectus, Oct 1997: annual total returns bar chart", SEC.format(44201, "0000044201-97-000011")),
    "P98": ("Investment Company of America prospectus, Feb 1998: annual total returns", SEC.format(51931, "0000051931-98-000002")),
    "AR95": ("Investment Company of America annual report for 1995: year-by-year summary of results", SEC.format(51931, "0000051931-96-000007")),
    "NP95": ("New Perspective Fund prospectus, Nov 1995: past results", SEC.format(71516, "0000071516-95-000010")),
    "NP97": ("New Perspective Fund prospectus, Nov 1997: annual total returns bar chart", SEC.format(71516, "0000071516-97-000015")),
    "CW98": ("Capital World Growth and Income Fund prospectus, Jan 1998: annual total returns bar chart", SEC.format(894005, "0000894005-98-000004")),
}
for t in ("AGTHX", "ANWPX", "VFINX"):
    SOURCES["MS:" + t] = (f"Morningstar annual total return history for {t}", f"https://finance.yahoo.com/quote/{t}/performance/")
for t in ("AGTHX", "AIVSX", "ANWPX", "CWGIX", "VFINX"):
    SOURCES["YF:" + t] = (f"Yahoo Finance daily prices and distributions for {t}, reinvested", f"https://finance.yahoo.com/quote/{t}/history/")
YEAR_SOURCE = {
    "AGTHX": [(1981, "MS:AGTHX"), (1986, "P97"), (1996, "YF:AGTHX")],
    "AIVSX": [(1981, "AR95"), (1988, "P98"), (1996, "YF:AIVSX")],
    "ANWPX": [(1981, "MS:ANWPX"), (1985, "NP95"), (1987, "NP97"), (1995, "YF:ANWPX")],
    "CWGIX": [(1994, "CW98"), (1998, "YF:CWGIX")],
    "VFINX": [(1981, "MS:VFINX"), (1996, "YF:VFINX")],
}
# Capital Group's own pages, for the trailing-return check
CAPITAL_GROUP = {"AGTHX": "gfa-a", "AIVSX": "ica-a", "ANWPX": "npf-a", "CWGIX": "wgi-a"}


def source_of(ticker, y):
    ids = [i for y0, i in YEAR_SOURCE[ticker] if y >= y0]
    return ids[-1] if ids else None


# Published years just after the switch to Yahoo, to show the two agree (same sources; GFA, ICA, NPF and CWGIX
# 2006-2007 prospectuses for the later ones)
OVERLAP = {"AGTHX": {1996: 14.84, 1997: 26.86, 1998: 31.78}, "AIVSX": {1996: 19.35, 1997: 29.81, 1998: 22.93},
           "ANWPX": {1995: 20.43, 1996: 17.28, 1997: 14.98}, "CWGIX": {1998: 16.20, 1999: 27.30, 2000: 1.37},
           "VFINX": {1996: 22.88, 1997: 33.19, 1998: 28.62}}
CHECK = {  # Capital Group, at NAV, annualized, as of 10/31/2026: 1, 3, 5, 10, 15, 20 years
    "AGTHX": [4.66, 24.22, 8.64, 15.23, 14.77, 10.96], "AIVSX": [7.90, 23.07, 12.54, 13.94, 13.63, 9.95],
    "ANWPX": [4.23, 19.14, 6.20, 12.93, 12.08, 9.55], "CWGIX": [12.57, 21.42, 9.74, 11.47, 10.69, 8.08]}


def daily_total_return(ticker):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&period1=0&period2=4000000000"
           "&events=div%2Csplit%2CcapitalGain")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    r = json.load(urllib.request.urlopen(req))["chart"]["result"][0]
    day = lambda ts: datetime.datetime.fromtimestamp(int(ts), datetime.UTC).date()
    dist = {}
    for kind in ("dividends", "capitalGains"):
        for k, e in (r.get("events", {}).get(kind) or {}).items():
            dist[day(k)] = dist.get(day(k), 0) + e["amount"]
    index, prev, out = 1.0, None, {}
    for ts, close in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
        if close is None:
            continue
        d = day(ts)
        if prev is not None:
            index *= (close + dist.get(d, 0)) / prev  # distributions reinvested at the ex-date close
        prev, out[d] = close, index
    return out


def at(series, d):
    return series[max(k for k in series if k <= d)]


def calendar_years(ticker):
    """Calendar-year returns (decimal), FIRST..LAST: published before YAHOO_FROM, Yahoo after."""
    s = daily_total_return(ticker)
    if ticker in CHECK:
        end = at(s, datetime.date(2026, 10, 31))
        got = [((end / at(s, datetime.date(2026 - n, 10, 31))) ** (1 / n) - 1) * 100 for n in (1, 3, 5, 10, 15, 20)]
        print(ticker, "vs Capital Group:", "  ".join(f"{g:.2f}/{w:.2f}" for g, w in zip(got, CHECK[ticker])))
    ends = {}
    for d, v in s.items():
        ends[d.year] = v  # last index value in each calendar year
    yahoo = {y: ends[y] / ends[y - 1] - 1 for y in ends if y - 1 in ends}
    print(ticker, "Yahoo vs published:", "  ".join(f"{y} {yahoo[y] * 100:.2f}/{v:.2f}" for y, v in OVERLAP[ticker].items()))
    out = {}
    for y in range(FIRST, LAST + 1):
        if y < YAHOO_FROM[ticker]:
            if y in PUBLISHED[ticker]:
                out[y] = PUBLISHED[ticker][y] / 100
        else:
            out[y] = yahoo[y]
    return out


def main():
    years = {t: calendar_years(t) for t, *_ in FUNDS}
    returns, standin = {}, {}
    for t, *_ in FUNDS:
        row, filled = [], []
        for y in range(FIRST, LAST + 1):
            if y in years[t]:
                row.append(round(years[t][y], 6))
            else:
                row.append(round(years[STAND_IN[t]][y], 6)); filled.append(y)
        returns[t] = row
        if filled:
            standin[t] = {"by": STAND_IN[t], "years": filled}
    compare = {}
    for slot, t in COMPARE.items():
        ys = calendar_years(t)
        compare[slot] = [round(ys[y], 6) for y in range(FIRST, LAST + 1)]
    out = {
        "first": FIRST, "last": LAST,
        "funds": [{"ticker": t, "name": n, "role": r, "launched": l, "firstYear": min(years[t])} for t, n, r, l in FUNDS],
        "returns": returns, "standIn": standin, "compare": compare,
        "publishedUntil": {t: y - 1 for t, y in YAHOO_FROM.items()},
        # for the data table: each year's source (CWGIX's stand-in years carry New Perspective's)
        "yearSource": {t: [source_of(STAND_IN.get(t, t) if t in standin and y in standin[t]["years"] else t, y)
                           for y in range(FIRST, LAST + 1)] for t in [*years, *COMPARE.values()]},
        "sources": {k: {"label": l, "url": u} for k, (l, u) in SOURCES.items()},
        "capitalGroup": {t: f"https://www.capitalgroup.com/individual/investments/mutual-funds/details/{c}" for t, c in CAPITAL_GROUP.items()},
        "source": "Published calendar-year returns at NAV (fund filings, Morningstar) to the mid-1990s; "
                  "Yahoo Finance daily NAV and distributions, reinvested, after",
    }
    with open("funds.js", "w") as f:
        f.write("// Generated by build-funds.py. Calendar-year total returns at NAV, " + f"{FIRST}-{LAST}.\n")
        f.write("window.FUNDS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote funds.js", FIRST, "-", LAST, "stand-in:", standin)


if __name__ == "__main__":
    main()
