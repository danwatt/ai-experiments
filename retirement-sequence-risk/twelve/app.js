// Did stocks make 12%? Every rolling 5, 10, 20 and 30-year window, for Ramsey's four American Funds, an S&P 500
// index fund (1981-2025) and the S&P 500 itself (1872-2025), colored by whether it reached a target: 12% a year,
// Ramsey's figure, unless the slider moves it (10% to 13%).
// Also each fund's lifetime (since-inception) return at every year-end from 1998, five before the book.
// Reads HIST (../data.js) and FUNDS (../explainer-4/funds.js).
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS, WINDOWS = [5, 10, 20, 30];
  const state = { measure: "avg", target: 0.12 };

  // ---------- data: each series is { name, sub, first, r: [yearly returns] }
  const byYear = (first, r) => ({ first, r });
  const T = F.funds.map((f) => f.ticker);
  const FUND_ROWS = [
    { name: "Four funds · 25% each", sub: "the four averaged each year, as if rebalanced every January", ...byYear(F.first, F.returns[T[0]].map((_, i) => T.reduce((a, t) => a + F.returns[t][i], 0) / T.length)) },
    ...F.funds.map((f) => ({ name: `${f.ticker} · ${f.role}`, sub: f.name, ...byYear(F.first, F.returns[f.ticker]) })),
    { name: "VFINX · S&P 500 index fund", sub: "Vanguard 500 Index Fund", ...byYear(F.first, F.compare.SP) },
  ];
  const SP = { name: "S&P 500", sub: "index, dividends reinvested", ...byYear(H.first, H.stocks) };

  // one window: the years' returns, averaged and compounded
  function windowOf(s, i, w) {
    const r = s.r.slice(i, i + w), grow = r.reduce((g, v) => g * (1 + v), 1);
    const avg = r.reduce((a, v) => a + v, 0) / w, cagr = Math.pow(grow, 1 / w) - 1;
    return { y0: s.first + i, y1: s.first + i + w - 1, w, r, avg, cagr, grow, best: Math.max(...r), worst: Math.min(...r), v: state.measure === "avg" ? avg : cagr };
  }
  function windows(s, w, from) {
    const out = [], start = from == null ? 0 : from - s.first;
    for (let i = Math.max(0, start); i + w <= s.r.length; i++) out.push(windowOf(s, i, w));
    return out;
  }

  // ---------- color: below the target toward danger, at or above toward bluebonnet, both from the card surface
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (c1, c2, u) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`; };
  let PAL;
  const readPalette = () => (PAL = { surface: css("surface-raised"), hit: css("bluebonnet"), miss: css("danger"), ink: css("ink") });
  // ±12 points from the line spans the full ramp; a floor of 0.4 keeps squares near the target clearly one side or the other
  function color(v) {
    const T = state.target;
    if (v >= T) return mix(PAL.surface, PAL.hit, 0.4 + 0.6 * Math.min(1, (v - T) / 0.12));
    return mix(PAL.surface, PAL.miss, 0.4 + 0.6 * Math.min(1, (T - v) / 0.12));
  }

  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const spct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  // the target as people would say it: 12%, 11.5%
  const fmt = (v) => `${+(v * 100).toFixed(1)}%`.replace("-", "−"), tgt = () => fmt(state.target);
  const label = () => (state.measure === "avg" ? "simple average" : "compound (CAGR)");
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };

  // The Total Money Makeover came out in September 2003. The line sits at the start of 2003's column: every
  // window to its left had already ended, the record a reader of the book could have checked.
  const BOOK = 2003;
  function bookMark(svg, X, y1, y2, label) {
    svg.appendChild(el("line", { x1: X, x2: X, y1, y2, stroke: PAL.ink, "stroke-width": 1.75, "stroke-dasharray": "4 3", "pointer-events": "none" }));
    svg.appendChild(el("text", { x: X + 5, y: 12, "font-size": 11.5, "font-weight": 700, style: "fill: var(--text-primary)" }, label));
  }

  // ---------- tooltip
  const tip = document.getElementById("tip");
  function showTip(e, s, win) {
    const rows = [["Simple average", pct(win.avg), state.measure === "avg"], ["Compound (CAGR)", pct(win.cagr), state.measure === "cagr"],
      ["$10,000 became", money(10000 * win.grow)], ["Best year", `${spct(win.best)} (${win.y0 + win.r.indexOf(win.best)})`], ["Worst year", `${spct(win.worst)} (${win.y0 + win.r.indexOf(win.worst)})`]];
    tip.innerHTML = `<b>${s.name}, ${win.y0}–${win.y1}</b> (${win.w} years)<br><span style="color:${win.v >= state.target ? "var(--bluebonnet)" : "var(--danger)"};font-weight:600">${win.v >= state.target ? "Reached " + tgt() : "Short of " + tgt()}</span>` +
      rows.map(([k, v, b]) => `<div class="t-row"><span>${k}</span><span>${b ? `<b>${v}</b>` : v}</span></div>`).join("");
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => (tip.hidden = true);

  // one row of squares: x(year) places each window by its first year
  function drawRow(svg, s, w, from, y, h, x, cw, dot) {
    const ws = windows(s, w, from);
    ws.forEach((win) => {
      const g = cw < 8 ? 0.25 : 0.75; // narrow squares (the S&P since 1872) keep only a hairline between them
      const r = el("rect", { class: "cell", x: x(win.y1) + g, y, width: Math.max(1, cw - 2 * g), height: h, rx: Math.min(2, cw / 4), fill: color(win.v) });
      r.addEventListener("mousemove", (e) => showTip(e, s, win));
      r.addEventListener("mouseleave", hideTip);
      svg.appendChild(r);
      // a mark on squares that reached the target, so it doesn't rest on color alone
      if (dot && win.v >= state.target) svg.appendChild(el("circle", { cx: x(win.y1) + cw / 2, cy: y + h / 2, r: 1.8, fill: PAL.surface, "pointer-events": "none" }));
    });
    return { hits: ws.filter((win) => win.v >= state.target).length, n: ws.length };
  }
  const hitText = (c) => `${c.hits} of ${c.n} · ${Math.round((100 * c.hits) / c.n)}%`;

  // ---------- the funds, 1981-2025: a block per window length, a row per fund
  function drawFunds() {
    const svg = document.getElementById("funds"); svg.innerHTML = "";
    const L = 250, R = 120, W = 1040, n = F.last - F.first + 1, cw = (W - L - R) / n, h = 15, gap = 3, rowH = h + gap;
    const x = (y) => L + (y - F.first) * cw;
    let y = 22;
    const axis = (yy) => [1981, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025].forEach((yr) => svg.appendChild(el("text", { x: x(yr) + cw / 2, y: yy, "text-anchor": "middle" }, String(yr))));
    svg.appendChild(el("text", { x: L, y: 12 }, "Last year of the window"));
    axis(y + 4); y += 18;
    WINDOWS.forEach((w) => {
      svg.appendChild(el("text", { class: "group", x: 0, y: y + 14 }, `${w}-year windows`));
      svg.appendChild(el("text", { x: W - R + 12, y: y + 14 }, `reached ${tgt()}`));
      y += 22;
      FUND_ROWS.forEach((s) => {
        const name = el("text", { class: "fund", x: 0, y: y + h - 3 }, s.name);
        name.appendChild(el("title", {}, s.sub)); svg.appendChild(name);
        const c = drawRow(svg, s, w, null, y, h, x, cw, true);
        svg.appendChild(el("text", { class: "hits", x: W - R + 12, y: y + h - 3 }, hitText(c)));
        y += rowH;
      });
      y += 14;
    });
    bookMark(svg, x(BOOK), 16, y - 12, "The Total Money Makeover, Sept 2003");
    axis(y + 2);
    svg.setAttribute("viewBox", `0 0 ${W} ${y + 10}`);
  }

  // ---------- the S&P 500 since 1872: a row per window length
  function drawSP() {
    const svg = document.getElementById("sp"); svg.innerHTML = "";
    const L = 130, R = 250, W = 1040, n = H.last - H.first + 1, cw = (W - L - R) / n, h = 22, rowH = h + 8;
    const x = (y) => L + (y - H.first) * cw;
    let y = 34; // room above for the markers' labels, then the count header
    svg.appendChild(el("text", { x: W - R + 14, y: y - 6 }, `reached ${tgt()}: from 1872 · 1928 · 1981`));
    WINDOWS.forEach((w) => {
      svg.appendChild(el("text", { class: "fund", x: 0, y: y + h / 2 + 4 }, `${w}-year windows`));
      drawRow(svg, SP, w, null, y, h, x, cw, false);
      const pctOf = (from) => { const ws = windows(SP, w, from); return Math.round((100 * ws.filter((v) => v.v >= state.target).length) / ws.length) + "%"; };
      svg.appendChild(el("text", { class: "hits", x: W - R + 14, y: y + h / 2 + 4 }, `${pctOf(1872)} · ${pctOf(1928)} · ${pctOf(1981)}`));
      y += rowH;
    });
    bookMark(svg, x(BOOK), 6, y - 4, "TMMO, Sept 2003");
    for (let yr = 1880; yr <= 2020; yr += 20) svg.appendChild(el("text", { x: x(yr) + cw / 2, y: y + 12, "text-anchor": "middle" }, String(yr)));
    svg.appendChild(el("text", { x: L, y: y + 30 }, "Last year of the window"));
    svg.setAttribute("viewBox", `0 0 ${W} ${y + 36}`);
  }

  // ---------- lifetime returns: since each fund began, through the end of each year either side of the book.
  // Each fund's growth since it began comes from one figure it published (at net asset value, no sales charge),
  // then rolls forward or back a year at a time with the yearly returns above. Spans are in years to Dec 31.
  const SEC = "https://www.sec.gov/Archives/edgar/data/";
  const LIFE = [
    { t: "AIVSX", since: "Jan 1, 1934", span: (Y) => Y - 1933, y: 2001, grow: 45258581 / 9425, src: SEC + "51931/0000051931-02-000003.txt", srcLabel: "ICA annual report for 2001: $10,000 became $45,258,581 after the 5.75% sales charge" },
    { t: "AGTHX", since: "Dec 1, 1973", span: (Y) => Y - 1973 + 31 / 365, y: 1999, cagr: 0.1847, src: SEC + "44201/0000044201-00-000010.txt", srcLabel: "Growth Fund of America prospectus, Oct 2000: 18.47% a year, lifetime to Dec 31, 1999" },
    { t: "CWGIX", since: "Mar 26, 1993", span: (Y) => Y - 1993 + 281 / 365, y: 2000, cagr: 0.1629, src: SEC + "894005/0000894005-01-000005.txt", srcLabel: "Capital World Growth and Income prospectus, Mar 2001: 16.29% a year, lifetime to Dec 31, 2000" },
    { t: "ANWPX", since: "Mar 13, 1973", span: (Y) => Y - 1973 + 294 / 365, y: 1999, cagr: 0.161, src: SEC + "71516/0000823620-00-000035.txt", srcLabel: "New Perspective prospectus, Nov 2000: 16.10% a year, lifetime to Dec 31, 1999" },
    { t: "VFINX", since: "Dec 31, 1976", span: (Y) => Y - 1976, y: 2001, grow: 234257 / 10000, src: SEC + "36405/0000932471-02-000460.txt", srcLabel: "Vanguard 500 Index annual report for 2001: $10,000 at the end of 1976 became $234,257" },
  ];
  // The fund's own lifetime figure for each year-end, where one was published: [file under SEC, filed, figure, with
  // sales charge?]. Each American Funds prospectus prints the lifetime figure to the previous Dec 31: with and without
  // the sales charge until 2009 (ICA's 1998 table only with it), then with it. Vanguard published one 25-year figure.
  const PUB = {
    AIVSX: { doc: "prospectus", y: {
      1998: ["51931/0000051931-99-000002.txt", "Feb 1999", "13.57", 1], 1999: ["51931/0000051931-00-000003.txt", "Mar 2000", "13.72"], 2000: ["51931/0000925950-01-000002.txt", "Mar 2001", "13.57"],
      2001: ["51931/0000051931-02-000001.txt", "Feb 2002", "13.28"], 2002: ["51931/0000051931-03-000003.txt", "Feb 2003", "12.82"], 2003: ["51931/0000051931-04-000002.txt", "Feb 2004", "13.00"],
      2004: ["51931/0000051931-05-000001.txt", "Feb 2005", "12.95"], 2005: ["51931/0000051931-06-000006.txt", "Feb 2006", "12.87"], 2006: ["51931/0000051931-07-000091.txt", "Feb 2007", "12.91"],
      2007: ["51931/0000051931-08-000099.txt", "Feb 2008", "12.81"], 2008: ["51931/000005193109000076/ica485b.htm", "Feb 2009", "11.90", 1], 2009: ["51931/000005193110000144/ica485b.htm", "Feb 2010", "12.09", 1],
      2010: ["51931/000001728311000005/ica485b.htm", "Feb 2011", "12.16"], 2011: ["51931/000005193112000144/ica485bpos.htm", "Feb 2012", "11.88", 1], 2012: ["51931/000005193113000212/ica485b.htm", "Feb 2013", "11.93", 1],
      2013: ["51931/000005193114000255/ica485b.htm", "Feb 2014", "12.17", 1], 2014: ["51931/000005193115000217/ica485b.htm", "Feb 2015", "12.17", 1], 2015: ["51931/000005193116002034/ica485b.htm", "Feb 2016", "11.99", 1],
      2016: ["51931/000005193117000349/ica485b.htm", "Feb 2017", "12.02", 1], 2017: ["51931/000005193118000215/ica485bpos.htm", "Feb 2018", "12.11", 1], 2018: ["51931/000005193119000200/ica485bpos.htm", "Feb 2019", "11.87", 1],
      2019: ["51931/000005193120000180/ica485bpos.htm", "Feb 2020", "12.01", 1], 2020: ["51931/000005193121000203/ck0000051931-20210217.htm", "Feb 2021", "12.04", 1], 2021: ["51931/000005193122000236/ck0000051931-20220216.htm", "Feb 2022", "12.18", 1],
      2022: ["51931/000005193123000195/ck0000051931-20230216.htm", "Feb 2023", "11.82", 1], 2023: ["51931/000005193124000257/ck0000051931-20240215.htm", "Feb 2024", "11.99", 1], 2024: ["51931/000005193125000243/ck0000051931-20250228.htm", "Feb 2025", "12.13", 1],
      2025: ["51931/000005193126000227/ck0000051931-20260227.htm", "Feb 2026", "12.22", 1],
    } },
    AGTHX: { doc: "prospectus", y: {
      1998: ["44201/0000044201-99-000007.txt", "Oct 1999", "17.50"], 1999: ["44201/0000044201-00-000010.txt", "Oct 2000", "18.47"], 2000: ["44201/0000044201-01-000001.txt", "Mar 2001", "18.05"],
      2001: ["44201/0000044201-02-000008.txt", "Oct 2002", "16.81"], 2002: ["44201/0000044201-03-000005.txt", "Oct 2003", "15.19"], 2003: ["44201/0000044201-04-000010.txt", "Nov 2004", "15.74"],
      2004: ["44201/0000044201-05-000016.txt", "Oct 2005", "15.62"], 2005: ["44201/0000044201-06-000006.txt", "Oct 2006", "15.58"], 2006: ["44201/0000044201-07-000003.txt", "Oct 2007", "15.43"],
      2007: ["44201/0000044201-08-000030.txt", "Oct 2008", "15.30"], 2008: ["44201/000004420109000025/gfa485b.htm", "Apr 2009", "13.03", 1], 2009: ["44201/000004420110000054/gfa485b.htm", "Oct 2010", "13.57", 1],
      2010: ["44201/000004420111000038/gfa485b.htm", "Oct 2011", "13.54", 1], 2011: ["44201/000004420112000030/gfa485b.htm", "Oct 2012", "13.01", 1], 2012: ["44201/000005193113000347/gfa485b.htm", "Apr 2013", "13.20", 1],
      2013: ["44201/000005193114000877/gfa485b.htm", "Aug 2014", "13.67", 1], 2014: ["44201/000005193115001117/gfa485b.htm", "Oct 2015", "13.56", 1], 2015: ["44201/000005193116003075/gfa485b.htm", "Oct 2016", "13.36", 1],
      2016: ["44201/000005193117000694/gfa485b.htm", "Apr 2017", "13.40"], 2017: ["44201/000005193118001154/gfa485b.htm", "Oct 2018", "13.52", 1], 2018: ["44201/000005193119000776/gfa485b.htm", "Oct 2019", "13.13", 1],
      2019: ["44201/000110465920119423/tm2034207-2_485bpos.htm", "Oct 2020", "13.44", 1], 2020: ["44201/000005193121000921/ck0000044201-20211101.htm", "Oct 2021", "13.91", 1], 2021: ["44201/000005193122001040/ck0000044201-20221014.htm", "Oct 2022", "14.02", 1],
      2022: ["44201/000005193123001170/ck0000044201-20231016.htm", "Oct 2023", "12.86", 1], 2023: ["44201/000005193124000996/ck0000044201-20240831.htm", "Oct 2024", "13.31", 1], 2024: ["44201/000005193125001201/ck0000044201-20251031.htm", "Oct 2025", "13.58", 1],
      2025: ["44201/000005193126001095/ck0000044201-20261030.htm", "Oct 2026", "13.70", 1],
    } },
    CWGIX: { doc: "prospectus", y: {
      1998: ["894005/0000894005-99-000002.txt", "Jan 1999", "17.24"], 1999: ["894005/0000894005-00-000003.txt", "Mar 2000", "18.68"], 2000: ["894005/0000894005-01-000005.txt", "Mar 2001", "16.29"],
      2001: ["894005/0000894005-02-000003.txt", "Feb 2002", "13.65"], 2002: ["894005/0000894005-03-000004.txt", "Jan 2003", "11.32"], 2003: ["894005/0000894005-04-000005.txt", "Jan 2004", "13.65"],
      2004: ["894005/0000894005-05-000001.txt", "Jan 2005", "14.12"], 2005: ["894005/0000894005-06-000002.txt", "Jan 2006", "14.17"], 2006: ["894005/0000894005-07-000002.txt", "Jan 2007", "14.75"],
      2007: ["894005/0000051931-08-000033.txt", "Jan 2008", "14.93"], 2008: ["894005/000089400509000002/wgi485b.htm", "Jan 2009", "10.06", 1], 2009: ["894005/000089400510000004/wgi485b.htm", "Jan 2010", "11.28", 1],
      2010: ["894005/000089400511000002/wgi485b.htm", "Jan 2011", "11.07", 1], 2011: ["894005/000005193112000059/wgi485bpos.htm", "Jan 2012", "9.99", 1], 2012: ["894005/000092595013000012/wgi485b.htm", "Jan 2013", "10.44", 1],
      2013: ["894005/000081196814000003/wgi485b.htm", "Jan 2014", "11.09", 1], 2014: ["894005/000081196815000012/wgi485b.htm", "Jan 2015", "10.76", 1], 2015: ["894005/000005193116001876/wgi485b.htm", "Jan 2016", "10.15", 1],
      2016: ["894005/000005193117000287/wgi485b.htm", "Jan 2017", "10.00", 1], 2017: ["894005/000005193118000124/wgi485b.htm", "Jan 2018", "10.55", 1], 2018: ["894005/000005193119000108/wgi485b.htm", "Jan 2019", "9.66", 1],
      2019: ["894005/000005193120000126/wgi485b.htm", "Jan 2020", "10.21", 1], 2020: ["894005/000005193121000116/ck0000894005-20210113.htm", "Jan 2021", "10.39", 1], 2021: ["894005/000005193122000113/ck0000894005-20220117.htm", "Jan 2022", "10.54", 1],
      2022: ["894005/000005193123000094/ck0000894005-20230118.htm", "Jan 2023", "9.47", 1], 2023: ["894005/000005193124000118/ck0000894005-20240117.htm", "Jan 2024", "9.82", 1], 2024: ["894005/000005193125000136/ck0000894005-20250131.htm", "Jan 2025", "9.95", 1],
      2025: ["894005/000005193126000093/ck0000894005-20260130.htm", "Jan 2026", "10.37", 1],
    } },
    ANWPX: { doc: "prospectus", y: {
      1998: ["71516/0000071516-99-000008.txt", "Dec 1999", "15.26"], 1999: ["71516/0000071516-00-000001.txt", "Mar 2000", "16.10"], 2000: ["71516/0000823620-01-500012.txt", "Nov 2001", "15.16"],
      2001: ["71516/0000071516-02-000007.txt", "Nov 2002", "14.26"], 2002: ["71516/0000071516-03-000007.txt", "Nov 2003", "13.08"], 2003: ["71516/0000071516-04-000009.txt", "Nov 2004", "13.78"],
      2004: ["71516/0000071516-05-000015.txt", "Dec 2005", "13.80"], 2005: ["71516/0000071516-06-000005.txt", "Nov 2006", "13.72"], 2006: ["71516/0000051931-07-000664.txt", "Nov 2007", "13.90"],
      2007: ["71516/0000071516-08-000007.txt", "Nov 2008", "13.96"], 2008: ["71516/000007151609000002/npf485b.htm", "Apr 2009", "11.86", 1], 2009: ["71516/000007151610000004/npf485b.htm", "Nov 2010", "12.49", 1],
      2010: ["71516/000005193111000862/npf485bpos.htm", "Nov 2011", "12.49", 1], 2011: ["71516/000007151612000007/npf485b.htm", "Nov 2012", "11.92", 1], 2012: ["71516/000005193113001180/npf485b.htm", "Nov 2013", "12.14", 1],
      2013: ["71516/000005193114000831/npf485b.htm", "Aug 2014", "12.48", 1], 2014: ["71516/000005193115001123/npf485b.htm", "Oct 2015", "12.24", 1], 2015: ["71516/000005193116003179/npf485b.htm", "Nov 2016", "12.08", 1],
      2016: ["71516/000005193117000696/npf485b.htm", "Apr 2017", "11.83", 1], 2017: ["71516/000005193118001224/npf485b.htm", "Nov 2018", "12.19", 1], 2018: ["71516/000005193119000886/npf485b.htm", "Nov 2019", "11.76", 1],
      2019: ["71516/000110465920119434/tm2034207-7_485bpos.htm", "Oct 2020", "12.12", 1], 2020: ["71516/000005193121001014/ck0000071516-20211115.htm", "Nov 2021", "12.53", 1], 2021: ["71516/000005193122001114/ck0000071516-20221115.htm", "Nov 2022", "12.64", 1],
      2022: ["71516/000005193123001244/ck0000071516-20231113.htm", "Nov 2023", "11.69", 1], 2023: ["71516/000005193124001066/ck0000071516-20240930.htm", "Nov 2024", "11.93", 1], 2024: ["71516/000005193125001321/ck0000071516-20251128.htm", "Nov 2025", "12.03", 1],
    } },
    VFINX: { doc: "annual report", y: {
      2001: ["36405/0000932471-02-000460.txt", "Mar 2002", "13.45"],
    } },
  };
  // the filing, opened at the figure where the browser supports text fragments
  const pubOf = (t, Y) => {
    const P = PUB[t], e = P.y[Y];
    return e && { url: `${SEC}${e[0]}#:~:text=${encodeURIComponent(e[2] + "%")}`, filed: e[1], fig: e[2], load: !!e[3], doc: P.doc };
  };
  const LIFE_YEARS = Array.from({ length: F.last - 1998 + 1 }, (_, i) => 1998 + i);
  function lifetime(L, Y) {
    const r = L.t === "VFINX" ? F.compare.SP : F.returns[L.t];
    let g = L.grow || Math.pow(1 + L.cagr, L.span(L.y));
    if (Y > L.y) for (let y = L.y + 1; y <= Y; y++) g *= 1 + r[y - F.first];
    else for (let y = Y + 1; y <= L.y; y++) g /= 1 + r[y - F.first];
    return { g, yrs: L.span(Y), v: Math.pow(g, 1 / L.span(Y)) - 1, vLoad: Math.pow(g * 0.9425, 1 / L.span(Y)) - 1 };
  }
  function drawLife() {
    const svg = document.getElementById("life"); svg.innerHTML = "";
    const role = (t) => (t === "VFINX" ? "S&P 500 index fund" : F.funds.find((f) => f.ticker === t).role);
    const L0 = 250, R = 120, W = 1040, n = LIFE_YEARS.length, cw = (W - L0 - R) / n, h = 22, gap = 5, g = 1;
    const x = (Y) => L0 + (Y - LIFE_YEARS[0]) * cw;
    let y = 46;
    svg.appendChild(el("text", { x: 0, y: y - 8 }, "Lifetime through the end of"));
    const axis = (yy) => [1998, 2000, 2005, 2010, 2015, 2020, 2025].forEach((Y) => svg.appendChild(el("text", { x: x(Y) + cw / 2, y: yy, "text-anchor": "middle" }, String(Y))));
    axis(y - 6);
    svg.appendChild(el("text", { x: W - R + 12, y: y - 6 }, `at ${tgt()} or more`));
    LIFE.forEach((L) => {
      svg.appendChild(el("text", { class: "fund", x: 0, y: y + h / 2 + 4 }, `${L.t} · ${role(L.t)}`));
      svg.appendChild(el("text", { x: L0 - 8, y: y + h / 2 + 4, "font-size": 11.5, "text-anchor": "end" }, `since ${L.since.slice(-4)}`));
      let hits = 0;
      LIFE_YEARS.forEach((Y) => {
        const o = lifetime(L, Y), hit = o.v >= state.target, fill = color(o.v);
        if (hit) hits++;
        const pub = pubOf(L.t, Y), host = pub ? el("a", { href: pub.url, target: "_blank", rel: "noopener", "aria-label": `${L.t} lifetime to ${Y}: ${pct(o.v, 2)}. Open the fund's ${pub.doc}, ${pub.filed}` }) : svg;
        if (pub) svg.appendChild(host);
        const r = el("rect", { class: "cell" + (pub ? " linked" : ""), x: x(Y) + g, y, width: cw - 2 * g, height: h, rx: 2, fill });
        r.addEventListener("mousemove", (e) => {
          tip.innerHTML = `<b>${L.t}, ${L.since} – Dec 31, ${Y}</b> (${o.yrs.toFixed(1)} years)<br><span style="color:${hit ? "var(--bluebonnet)" : "var(--danger)"};font-weight:600">${hit ? "At or above " + tgt() : "Below " + tgt()}</span>` +
            `<div class="t-row"><span>Lifetime, compound</span><span><b>${pct(o.v, 2)}</b></span></div><div class="t-row"><span>$10,000 became</span><span>${money(10000 * o.g)}</span></div>` +
            (L.t !== "VFINX" ? `<div class="t-row"><span>With the 5.75% sales charge</span><span>${pct(o.vLoad, 2)}</span></div>` : "") +
            (pub ? `<div class="t-row"><span>${pub.doc[0].toUpperCase() + pub.doc.slice(1)}, ${pub.filed}</span><span>${pub.fig}%${pub.load ? "*" : ""}</span></div><div style="margin-top:4px;color:var(--muted)">${pub.load ? "*With the sales charge, the only lifetime figure it printed for this year. " : ""}Click to open the filing.</div>`
              : `<div style="margin-top:4px;color:var(--muted)">${L.t === "VFINX" ? "Vanguard published no lifetime figure for this year-end; worked out from its 2001 figure and the yearly returns." : "No prospectus with this year-end's figure yet."}</div>`);
          tip.hidden = false;
          const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
          tip.style.left = tx + "px"; tip.style.top = ty + "px";
        });
        r.addEventListener("mouseleave", hideTip);
        host.appendChild(r);
        if (hit) host.appendChild(el("circle", { cx: x(Y) + cw / 2, cy: y + h / 2, r: 2, fill: PAL.surface, "pointer-events": "none" }));
      });
      svg.appendChild(el("text", { class: "hits", x: W - R + 12, y: y + h / 2 + 4 }, `${hits} of ${n}`));
      y += h + gap;
    });
    axis(y + 12);
    svg.appendChild(el("line", { x1: x(BOOK), x2: x(BOOK), y1: 16, y2: y + 20, stroke: PAL.ink, "stroke-width": 1.75, "stroke-dasharray": "4 3", "pointer-events": "none" }));
    svg.appendChild(el("text", { x: x(BOOK) + 5, y: 12, "font-size": 11.5, "font-weight": 700, style: "fill: var(--text-primary)" }, "The Total Money Makeover, Sept 2003"));
    svg.appendChild(el("text", { x: x(BOOK) - 5, y: y + 32, "text-anchor": "end" }, "← before the book"));
    svg.appendChild(el("text", { x: x(BOOK) + 5, y: y + 32 }, "after it came out →"));
    svg.setAttribute("viewBox", `0 0 ${W} ${y + 40}`);
    document.getElementById("life-src").innerHTML = LIFE.map((L) => `<a href="${L.src}">${L.srcLabel}</a>`).join("; ") + ".";
  }

  // ---------- the summary table
  function drawRates() {
    const rows = [...FUND_ROWS.map((s) => [s, null, s.name]),
      [SP, 1981, "S&P 500 index, 1981–2025"], [SP, 1928, "S&P 500 index, 1928–2025"], [SP, 1872, "S&P 500 index, 1872–2025"]];
    const cell = (s, from, w) => { const ws = windows(s, w, from), k = ws.filter((v) => v.v >= state.target).length; return `${Math.round((100 * k) / ws.length)}%<small>${k}/${ws.length}</small>`; };
    document.getElementById("rates").innerHTML = `<thead><tr><th>Reached ${tgt()} a year, ${label()}</th>${WINDOWS.map((w) => `<th>${w} years</th>`).join("")}</tr></thead><tbody>` +
      rows.map(([s, from, name]) => `<tr><td>${name}</td>${WINDOWS.map((w) => `<td>${cell(s, from, w)}</td>`).join("")}</tr>`).join("") + "</tbody>";
    const whole = (s, from) => windows(s, s.r.length - (from - s.first), from)[0];
    const sp28 = whole(SP, 1928), sp81 = whole(SP, 1981), four = whole(FUND_ROWS[0], F.first);
    document.getElementById("rates-note").textContent = `Over each whole stretch, the S&P 500 averaged ${pct(sp28.avg)} a year from 1928 (compound ${pct(sp28.cagr)}) and ${pct(sp81.avg)} from 1981 (compound ${pct(sp81.cagr)}); the four funds averaged ${pct(four.avg)} from 1981 (compound ${pct(four.cagr)}).`;
  }

  function drawRamp() {
    const T = state.target, lo = T - 0.12, stops = [lo, T - 0.06, T - 0.0001, T, T + 0.06, T + 0.12].map((v) => `${color(v)} ${((v - lo) / 0.24) * 100}%`).join(", ");
    document.getElementById("ramp").innerHTML =
      `<span class="sw"><i style="background:${color(T - 0.06)}"></i>Short of ${tgt()}</span>` +
      `<span class="scale"><span class="bar" style="background:linear-gradient(90deg, ${stops})"></span><span class="ticks">${[-0.12, -0.06, 0, 0.06, 0.12].map((d, i) => `<span>${fmt(T + d)}${i === 4 ? "+" : ""}</span>`).join("")}</span></span>` +
      `<span class="sw"><i style="background:${color(T + 0.06)}"></i>${tgt()} or more (dotted in the fund rows)</span>`;
    document.getElementById("measure-note").innerHTML = state.measure === "avg"
      ? "<b>Simple average:</b> the years' returns added up and divided by the number of years. This is how Ramsey states the 12%."
      : "<b>Compound (CAGR):</b> the steady rate that turns the starting money into the ending money, what a balance actually grew at.";
  }

  function render() {
    readPalette();
    document.querySelectorAll("[data-measure]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.measure === state.measure)));
    const slider = document.getElementById("target");
    slider.value = (state.target * 100).toFixed(1); document.getElementById("o-target").textContent = tgt();
    document.querySelectorAll(".tgt").forEach((e) => (e.textContent = tgt()));
    drawRamp(); drawFunds(); drawLife(); drawSP(); drawRates();
    history.replaceState(null, "", `#m=${state.measure}` + (state.target !== 0.12 ? `&t=${(state.target * 100).toFixed(1)}` : ""));
  }
  // settings from the address, so a view can be shared
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("m") === "cagr") state.measure = "cagr";
  const t = +p.get("t");
  if (t >= 10 && t <= 13) state.target = Math.round(t * 10) / 1000;
  document.getElementById("target").addEventListener("input", (e) => { state.target = Math.round(+e.target.value * 10) / 1000; render(); });
  document.querySelectorAll("[data-measure]").forEach((b) => b.addEventListener("click", () => { state.measure = b.dataset.measure; render(); }));
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  render();
})();
