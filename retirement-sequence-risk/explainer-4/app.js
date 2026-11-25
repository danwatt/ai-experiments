// Explainer 4: Ramsey's four funds. $1 million split evenly across four American Funds, spent at 8% a year,
// in today's dollars. The fund returns come from this explainer's own funds.js (build-funds.py); the player
// and drawing toolkit live in ../kit/explainer-kit.js.
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS;
  ExplainerKit((K) => {
    const { C, alpha, axes, backOut, easeOut, font, dot, callout, chartFrame, barSeries, lineSeries, columnHovers, counter, countTo, dollars, extremeLabel,
      flash, glow, hot, hvBox, isStarted, legend, lerp, lin, line, money, moneyTick, ofN, pct, pill, rgba, shake, span, spct, spotlight,
      statCard, text, ticksTo, words, zoomAt, clamp, ctx } = K;

    // ---------- data ----------
    const START = 1e6, WR = 0.08, HORIZON = 30;
    const T = F.funds.map((f) => f.ticker);
    const hi = (y) => y - H.first, fi = (y) => y - F.first;
    // each fund's return after inflation, and the S&P 500's, for comparison
    const realRet = (t, y) => (1 + F.returns[t][fi(y)]) / (1 + H.infl[hi(y)]) - 1;
    const spReal = (y) => (1 + F.compare.SP[fi(y)]) / (1 + H.infl[hi(y)]) - 1; // Vanguard 500 Index Fund (VFINX)
    const blendRet = (y) => T.reduce((a, t) => a + realRet(t, y), 0) / T.length; // equal weights, for the return bars
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const STARTS = []; for (let y = F.first; y <= F.last; y++) STARTS.push(y);

    // take `amount` evenly from the funds; a fund that can't cover its share passes the rest to the others
    function takeEvenly(bal, amount) {
      let need = amount, open = bal.map((b, i) => i).filter((i) => bal[i] > 0);
      while (need > 1e-6 && open.length) {
        const share = need / open.length;
        for (const i of [...open]) { const x = Math.min(share, bal[i]); bal[i] -= x; need -= x; if (bal[i] <= 1e-9) open = open.filter((j) => j !== i); }
      }
      return amount - need;
    }
    // 8% of the start: $80,000 of today's money at the end of every year, a quarter from each fund
    function fixedRun(y0) {
      const bal = T.map(() => START / 4), path = [START], funds = T.map(() => [START / 4]), rows = [];
      let lasted = null;
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        const y = y0 + k, jan = sum(bal);
        T.forEach((t, i) => (bal[i] *= 1 + realRet(t, y)));
        const pre = sum(bal);
        if (pre < WR * START) { lasted = k + pre / (WR * START); rows.push({ y, jan, pre, paid: pre, end: 0 }); bal.fill(0); path.push(0); funds.forEach((f) => f.push(0)); break; }
        takeEvenly(bal, WR * START);
        rows.push({ y, jan, pre, paid: WR * START, end: sum(bal) });
        path.push(sum(bal)); funds.forEach((f, i) => f.push(bal[i]));
      }
      const n = Math.min(HORIZON, F.last - y0 + 1);
      return { y0, n, lasted, path, funds, rows, end: sum(bal), years: lasted != null ? lasted : n,
        status: lasted != null ? "fail" : n < HORIZON ? "running" : "ok" };
    }
    // 8% of what's left: 8% of the balance every January, a quarter from each fund
    function pctRun(y0) {
      const bal = T.map(() => START / 4), checks = [], rows = [];
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        const y = y0 + k, jan = sum(bal), check = takeEvenly(bal, WR * jan);
        checks.push(check);
        T.forEach((t, i) => (bal[i] *= 1 + realRet(t, y)));
        rows.push({ y, jan, check, ret: blendRet(y), end: sum(bal) });
      }
      return { y0, checks, rows, end: sum(bal), done: checks.length === HORIZON };
    }
    // an S&P 500 index fund alone, same rule, for comparison
    function spRun(y0) {
      let B = START, lasted = null;
      const path = [B];
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        const pre = B * (1 + spReal(y0 + k));
        if (pre < WR * START) { lasted = k + pre / (WR * START); path.push(0); break; }
        B = pre - WR * START; path.push(B);
      }
      const n = Math.min(HORIZON, F.last - y0 + 1);
      return { lasted, path, status: lasted != null ? "fail" : n < HORIZON ? "running" : "ok" };
    }
    const FIXED = STARTS.map(fixedRun), PCT = STARTS.map(pctRun);
    const DONE = FIXED.filter((r) => r.n === HORIZON);
    const BUBBLE = FIXED.filter((r) => r.y0 >= 1997 && r.y0 <= 2008); // the twelve that started near the 2000 peak
    const FUND_COLORS = () => [C.blue, C.paintbrush, C.winecup, C.fire];
    const statusColor = (s) => (s === "ok" ? C.blue : s === "fail" ? C.danger : C.muted);
    const UNIT = "today's dollars (November 2026)";
    const outcome = (r) => (r.status === "fail" ? `out in ${r.y0 + Math.ceil(r.lasted) - 1}, ${r.lasted.toFixed(1)} yrs`
      : r.status === "running" ? `${r.n} yrs so far, ${money(r.end)} left` : `30 yrs, ${money(r.end)} left`);

    // Two ways to hold the million, for the comparison scene: each slot's return per year. The four funds draw
    // evenly and never rebalance (as above); a portfolio without `even` goes back to its weights after a withdrawal.
    const CP = F.compare;
    const PORTS = [
      { id: "four", name: "Ramsey's four funds", mix: ["25% each in AGTHX,", "AIVSX, ANWPX and CWGIX"], w: [0.25, 0.25, 0.25, 0.25], ret: (y) => T.map((t) => F.returns[t][fi(y)]), even: true },
      { id: "sp", name: "S&P 500 index fund", mix: ["100% VFINX"], w: [1], ret: (y) => [CP.SP[fi(y)]] },
    ];
    function portTake(p, bal, amount) {
      if (p.even) return takeEvenly(bal, amount);
      const tot = sum(bal), got = Math.min(amount, tot);
      p.w.forEach((w, i) => (bal[i] = (tot - got) * w));
      return got;
    }
    const grow = (p, bal, y) => { const r = p.ret(y); bal.forEach((b, i) => (bal[i] = (b * (1 + r[i])) / (1 + H.infl[hi(y)]))); };
    function portRun(p, y0, rate) { // rate of the start, raised with inflation, end of year
      const bal = p.w.map((w) => START * w);
      let lasted = null;
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        grow(p, bal, y0 + k);
        const pre = sum(bal);
        if (pre < rate * START) { lasted = k + pre / (rate * START); bal.fill(0); break; }
        portTake(p, bal, rate * START);
      }
      const n = Math.min(HORIZON, F.last - y0 + 1);
      return { y0, n, lasted, end: sum(bal), years: lasted != null ? lasted : n, status: lasted != null ? "fail" : n < HORIZON ? "running" : "ok" };
    }
    function portPct(p, y0, rate) { // rate of what's left each January
      const bal = p.w.map((w) => START * w), checks = [];
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) { checks.push(portTake(p, bal, rate * sum(bal))); grow(p, bal, y0 + k); }
      return { checks, min: Math.min(...checks), max: Math.max(...checks), done: checks.length === HORIZON };
    }
    const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    PORTS.forEach((p) => {
      p.fixed = STARTS.map((y) => portRun(p, y, WR));
      p.at4 = STARTS.map((y) => portRun(p, y, 0.04));
      p.pct = STARTS.map((y) => portPct(p, y, WR));
      p.pct4 = STARTS.map((y) => portPct(p, y, 0.04));
      const done = p.fixed.filter((r) => r.n === HORIZON);
      p.lastedDone = done.filter((r) => r.status === "ok").length;
      p.bubbleOut = p.fixed.filter((r) => r.y0 >= 1997 && r.y0 <= 2008 && r.status === "fail").length;
      p.leanTyp = median(p.pct.filter((r) => r.done).map((r) => r.min));
      p.leanTyp4 = median(p.pct4.filter((r) => r.done).map((r) => r.min));
      // and the typical biggest check, for the range
      p.highTyp = median(p.pct.filter((r) => r.done).map((r) => r.max));
      p.highTyp4 = median(p.pct4.filter((r) => r.done).map((r) => r.max));
      p.at4Out = p.at4.filter((r) => r.status === "fail").length;
    });

    const SCENES = {};

    // 1. Ramsey's four funds
    SCENES["four-funds"] = function (t, q) {
      const cols = FUND_COLORS();
      words("$1,000,000 on retirement day", 800, 250, t, q.at(1, 0.4), { size: 44, align: "center" });
      F.funds.forEach((f, i) => {
        const cx = 260 + i * 360;
        // each role and the fund that fills it arrive together, as the narrator names the role
        const role = q.span(0, 4.0 + i * 1.3, 4.6 + i * 1.3), fund = q.lin(0, 4.0 + i * 1.3, 4.8 + i * 1.3);
        alpha(role, () => text(f.role.toUpperCase(), cx, 350, { size: 18, weight: 700, color: cols[i], align: "center", spacing: 1.4 }));
        statCard({ cx, top: 370, w: 320, h: 230, title: f.ticker, value: "", sub: "", color: cols[i], progress: fund });
        alpha(fund, () => {
          const words2 = f.name.replace(/^The /, "").split(" "), mid = Math.ceil(words2.length / 2);
          text(words2.slice(0, mid).join(" "), cx, 500, { size: 24, weight: 700, fam: "display", align: "center" });
          text(words2.slice(mid).join(" "), cx, 532, { size: 24, weight: 700, fam: "display", align: "center" });
        });
        alpha(q.span(1, 4.2 + i * 0.3, 4.8 + i * 0.3), () => zoomAt(cx, 650, lerp(0.7, 1, backOut(q.lin(1, 4.2 + i * 0.3, 4.9 + i * 0.3))), () =>
          text("$250,000", cx, 665, { size: 40, weight: 700, fam: "display", align: "center", color: cols[i] })));
      });
      // an aside, not narrated (its sources are in the page notes)
      alpha(q.span(1, 5.2, 6.0), () => {
        line(560, 748, 1040, 748, C.line, 1);
        text("Ramsey Solutions favors front-loaded funds bought through an advisor, and its SmartVestor Pros pay it fees.", 800, 786, { size: 19, color: C.muted, align: "center" });
        text("American Funds' Class A shares, used here, carry a sales charge of up to 5.75%.", 800, 814, { size: 19, color: C.muted, align: "center" });
        hot(300, 760, 1000, 70, hvBox("Aside", "sources in the notes below the player", [["Ramsey on front-loaded funds", "Ramsey Solutions articles"], ["SmartVestor Pro fees", "SmartVestor page"], ["Class A sales charge", "Capital Group pricing"]]));
      });
    };

    // dark or light text, whichever reads better on a filled bar of this color
    const onColor = (hex) => {
      const n = parseInt(hex.replace("#", ""), 16), lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      return lum > 0.6 ? "#16161d" : "#ffffff";
    };
    // 2. How far back the funds go
    SCENES.history = function (t, q) {
      const cols = FUND_COLORS();
      const A = chartFrame({ x0: 330, x1: 1440, y0: 230, y1: 640, dx: [1980, 2026], dy: [0, 1], xTicks: [1980, 1990, 2000, 2010, 2020], title: "Calendar years of returns used here", titleGap: 40 });
      line(A.x0, A.y1, A.x1, A.y1, C.lineStrong, 1);
      const stand = F.standIn.CWGIX, grow = q.lin(0, 0.6, 4.0);
      F.funds.forEach((f, i) => {
        const y = A.y0 + 40 + i * 88, from = f.firstYear, x0 = A.X(from), x1 = A.X(2026), older = f.launched < F.first;
        text(f.ticker, A.x0 - 24, y + 8, { size: 24, weight: 700, fam: "display", align: "right", color: cols[i] });
        text(f.role, A.x0 - 24, y + 32, { size: 16, color: C.muted, align: "right" });
        const p = clamp(grow * 1.4 - i * 0.12);
        ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.roundRect(x0, y - 8, (x1 - x0) * easeOut(p), 30, 6); ctx.fill();
        alpha(span(p, 0.8, 1), () => {
          // a fund older than the chart: a small arrow on the left says its record runs back further
          if (older) { ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.moveTo(x0 - 6, y - 4); ctx.lineTo(x0 - 18, y + 7); ctx.lineTo(x0 - 6, y + 18); ctx.fill(); }
          text(`launched ${f.launched}`, x0 + 10, y + 13, { size: 17, weight: 700, color: onColor(cols[i]) });
        });
        hot(A.x0, y - 14, A.x1 - A.x0, 44, hvBox(`${f.ticker}: ${f.name}`, f.role, [["Launched", String(f.launched)], ["Its own returns here", `${from}–${F.last}`],
          F.standIn[f.ticker] ? [`${F.standIn[f.ticker].by} stands in`, `${F.first}–${from - 1}`] : null]));
      });
      // CWGIX's missing years, filled by New Perspective
      const yC = A.y0 + 40 + 3 * 88, s0 = A.X(stand.years[0]), s1 = A.X(stand.years[stand.years.length - 1] + 1), sp = q.span(0, 7.5, 8.3); // as the narrator gets to New Perspective standing in
      alpha(sp, () => {
        ctx.fillStyle = rgba(C.winecup, 0.45); ctx.beginPath(); ctx.roundRect(s0, yC - 8, s1 - s0, 30, 6); ctx.fill();
        ctx.strokeStyle = C.winecup; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        text("New Perspective stands in", s0 + 10, yC + 48, { size: 17, weight: 700, color: C.winecup });
      });
      // the retirements this allows
      const tl = q.span(1, 0.3, 1.0), done = q.span(1, 3.6, 4.4);
      alpha(tl, () => {
        line(A.X(F.first), A.y0 + 10, A.X(F.first), A.y1, C.ink, 2, [6, 5]);
        text(`Blend starts: ${F.first}`, A.X(F.first) + 8, A.y0 + 2, { size: 18, weight: 700 });
      });
      alpha(done, () => {
        const n = DONE.length, bx0 = A.X(F.first), bx1 = A.X(F.first + n), by = A.y1 + 70;
        ctx.fillStyle = rgba(C.blue, 0.25); ctx.fillRect(bx0, by - 18, bx1 - bx0, 24);
        text(`${n} full 30-year retirements (${F.first}–${String(F.first + n - 1).slice(2)})`, bx0, by + 32, { size: 18, weight: 700, color: C.blue });
        ctx.fillStyle = rgba(C.muted, 0.18); ctx.fillRect(bx1, by - 18, A.X(F.last + 1) - bx1, 24);
        text("still under 30 years", A.X(F.last + 1), by + 32, { size: 18, color: C.muted, align: "right" });
      });
      // when Ramsey's book laid out the four-fund mix: The Total Money Makeover, September 2003
      const book = q.span(2, 0.3, 1.0), bx = A.X(2003 + 8.5 / 12);
      alpha(book, () => {
        line(bx, lerp(A.y1, A.y0 + 10, easeOut(q.lin(2, 0.3, 1.2))), bx, A.y1, C.ink, 2.5, [3, 4]);
        dot(bx, A.y0 + 10, 6, C.ink);
        text("The Total Money Makeover", bx + 12, A.y0 + 4, { size: 18, weight: 700 });
        text("Ramsey's book, September 2003", bx + 12, A.y0 + 24, { size: 16, color: C.muted });
        hot(bx - 10, A.y0 - 12, 300, A.y1 - A.y0 + 12, hvBox("The Total Money Makeover", "Dave Ramsey, Thomas Nelson", [["Published", "September 2003"], ["Lays out", "25% in each of the four fund types"]]), "line");
      });
    };

    // 3. Retire in January 2000
    SCENES["retire-2000"] = function (t, q) {
      const r = FIXED[2000 - F.first], s = spRun(2000), y0 = 2000, cols = FUND_COLORS();
      const endYear = y0 + Math.ceil(r.lasted) - 1;
      const yearsShown = lerp(0, 3, q.lin(0, 1.0, 7.0)) + q.sweep(1, 0.2, 2, -0.2) * (r.lasted - 3);
      const tCrash = q.at(1, 0.2) + ((2008 - y0 + 0.5 - 3) / (r.lasted - 3)) * (q(2) - 0.2 - q.at(1, 0.2));
      shake(t, tCrash, 12);
      const yr = Math.min(endYear, y0 + Math.floor(yearsShown));
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 600, dx: [y0, 2026], dy: [0, 1.2e6], yTicks: [0, 250e3, 500e3, 750e3, 1e6],
        xTicks: [2000, 2005, 2010, 2015, 2020, 2025], title: `Balance, ${UNIT}`, titleGap: 30,
        under: (A) => text(String(yr), A.x1, A.y1 - 30, { size: 260, weight: 800, fam: "display", align: "right", color: rgba(yr >= 2008 ? C.danger : C.ink, 0.07) }) });
      legend(A.x1 - 640, A.y0 - 30, [[C.ink, "All four funds"], ...F.funds.map((f, i) => [cols[i], f.ticker])]);
      const prog = clamp(yearsShown / r.lasted), broke = yearsShown >= r.lasted - 0.01;
      const xs = (k, len) => (k === len - 1 && r.status === "fail" ? y0 + r.lasted : y0 + k);
      r.funds.forEach((fp, i) => alpha(0.75, () => lineSeries(A, fp.map((v, k) => [xs(k, fp.length), v]), { progress: prog, color: cols[i], width: 2 })));
      lineSeries(A, r.path.map((v, k) => [xs(k, r.path.length), v]), { progress: prog, color: C.ink, glow: true, t,
        tipLabel: (v) => (yearsShown > 0.15 && !broke ? { text: money(v), dx: 18, dy: -16, size: 24, weight: 700, fam: "display" } : null) });
      // the S&P 500 alone, for comparison, once the narrator gets to it
      alpha(q.span(2, 4.5, 5.3), () => {
        ctx.setLineDash([10, 8]);
        lineSeries(A, s.path.map((v, k) => [k === s.path.length - 1 ? y0 + s.lasted : y0 + k, v]), { color: C.muted, width: 3, progress: q.lin(2, 4.5, 6.0) });
        ctx.setLineDash([]);
        text(`S&P 500 alone: out in ${y0 + Math.ceil(s.lasted) - 1}`, A.X(2003.4), A.Y(0.455e6), { size: 20, weight: 700, color: C.muted });
      });
      pill(A.X(2014), A.Y(0.92e6), "$80,000 a year, a quarter from each fund", "fire", q.span(0, 0.6, 1.2));
      // each year's return for the blend
      const rA = axes({ x0: A.x0, x1: A.x1, y0: 715, y1: 860, dx: A.dx, dy: [-0.5, 0.5] });
      alpha(span(t, 0.3, 0.9), () => { line(rA.x0, rA.Y(0), rA.x1, rA.Y(0), C.lineStrong, 1); text("The four funds' average return each year, after inflation", rA.x0, 676, { size: 18, color: C.muted }); });
      const years = []; for (let y = y0; y <= endYear; y++) years.push(y);
      const grown = (y) => clamp((yearsShown - (y - y0)) * 1.6);
      barSeries(rA, years, { x: (y) => y, value: blendRet, clamp: [-0.5, 0.5], pad: 3, progress: grown,
        color: (y, i, v) => (v >= 0 ? C.blue : C.danger), extremes: (v) => v >= 0.2 || v <= -0.2, year: (y) => y });
      columnHovers(A, years.filter((y) => grown(y) > 0), (y) => {
        const row = r.rows[y - y0];
        return hvBox(`${y}`, `year ${y - y0 + 1} of retirement, ${UNIT}`, [
          ["Balance on January 1", dollars(row.jan)],
          ...T.map((tk) => [`${tk}, after inflation`, spct(realRet(tk, y))]),
          ["Withdrawal", row.end > 0 ? "−$80,000" : `wanted $80,000, only ${dollars(row.paid)} left`],
          ["Balance at year end", row.end > 0 ? dollars(row.end) : "$0, broke", true],
        ]);
      }, { align: "start", y1: rA.y1 });
      if (broke) alpha(q.span(2, 0, 0.6), () => {
        const x = A.X(y0 + r.lasted), y = A.Y(0);
        zoomAt(x, y, lerp(2.2, 1, backOut(q.lin(2, 0, 0.5))), () => { ctx.strokeStyle = C.danger; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x - 12, y - 12); ctx.lineTo(x + 12, y + 12); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x - 12, y + 12); ctx.stroke(); });
        text(`Broke in ${endYear}`, x + 22, y - 18, { size: 30, weight: 700, fam: "display", color: C.danger });
      });
      flash(t, tCrash, C.danger);
    };

    // 4. Every retirement since the first year of data
    SCENES.every = function (t, q) {
      const LEAST_AT = 3.5; // seconds into line 1 where the narrator says what they ended with
      const A = chartFrame({ x0: 200, x1: 1440, y0: 220, y1: 720, dx: [F.first, F.last + 1], dy: [0, 37], yTicks: [0, 10, 20, 30], yFmt: (v) => `${v} yrs`,
        xTicks: [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025], xTitle: "Year of retirement", title: "How many years the money lasted, at $80,000 a year" });
      legend(A.x1 - 560, A.y0 - 34, [[C.blue, "Lasted 30 years"], [C.danger, "Ran out"], [C.muted, "Still going"]]);
      const done = q.span(1, 0, 0.8), bubble = q.span(2, 0, 0.8);
      const bars = barSeries(A, FIXED, {
        x: (r) => r.y0, value: (r) => Math.min(r.years, HORIZON), color: (r) => statusColor(r.status), grow: q.sweep(0, 0.4, 1, -0.3), stagger: 5, pad: 2,
        alpha: (r) => (bubble > 0 ? spotlight(bubble, r.y0 >= 1997 && r.y0 <= 2008) : spotlight(done, r.n === HORIZON)),
        hover: (r) => hvBox(`Retired ${r.y0}`, `${UNIT}; $80,000 a year`, [["Four funds", outcome(r)], ["S&P 500 alone", ((s) => (s.status === "fail" ? `out in ${r.y0 + Math.ceil(s.lasted) - 1}, ${s.lasted.toFixed(1)} yrs` : s.status === "running" ? "still going" : "lasted 30 yrs"))(spRun(r.y0))]]),
      });
      // of the finished retirements that lasted, the one that ended with the least
      const fin = DONE.filter((r) => r.status === "ok");
      if (fin.length) {
        const least = fin.reduce((a, r) => (r.end < a.end ? r : a));
        callout(A.X(least.y0) + bars.band / 2, A.Y(HORIZON) - 6, A.Y(34), `Least left after 30 years: ${money(least.end)} (${least.y0})`,
          { fade: q.span(1, LEAST_AT, LEAST_AT + 0.6) * (1 - bubble), grow: q.span(1, LEAST_AT, LEAST_AT + 0.5), size: 18, align: "left", dx: -8, color: C.fire });
      }
      const c = (label, value, color) => counter(1440, 160, label, value, { align: "right", size: 40, color });
      alpha(done * (1 - bubble), () => c("FINISHED 30 YEARS: LASTED", countTo(t, q(1), DONE.filter((r) => r.status === "ok").length, ofN(DONE.length)), C.blue));
      alpha(bubble, () => c("RETIRED 1997–2008: ALREADY OUT", countTo(t, q(2), BUBBLE.filter((r) => r.status === "fail").length, ofN(BUBBLE.length)), C.danger));
    };

    // 5. 8% of what's left
    SCENES.percent = function (t, q) {
      const r = PCT[2000 - F.first], y0 = 2000, n = r.checks.length;
      const idea = 1 - q.span(1, -0.2, 0.4);
      if (idea > 0) {
        words("Take 8% of whatever is there,", 800, 400, t, 0.4, { size: 52, align: "center", a: idea, hi: ["8%"] });
        words("every January.", 800, 470, t, 1.4, { size: 52, align: "center", a: idea, color: C.fire });
      }
      const A = chartFrame({ x0: 200, x1: 1440, y0: 230, y1: 700, dx: [y0, y0 + n], dy: [0, 100e3], yTicks: [0, 25e3, 50e3, 75e3, 100e3], fade: q.span(1, 0, 0.6),
        xTicks: [2000, 2005, 2010, 2015, 2020, 2025], title: `Retired January 2000: each year's check, ${UNIT}` });
      alpha(q.span(1, 0, 0.6), () => { line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]); text("The plan: $80,000", A.X(2004), A.Y(80e3) - 10, { size: 19, weight: 700 }); });
      const low = Math.min(...r.checks), lowI = r.checks.indexOf(low), spot = q.window(2, 0, 0.6, 2, 3.5, 4.2);
      const bars = barSeries(A, r.checks, {
        x: (c, i) => y0 + i, value: (c) => c, pad: 3, grow: q.sweep(1, 0.2, 1, 7.0), stagger: 3,
        color: (c) => (c < 40e3 ? C.danger : c < 60e3 ? C.fire : C.blue), alpha: (c, i) => spotlight(spot, i === lowI),
        hover: (c, i) => { const row = r.rows[i]; return hvBox(`${row.y}`, UNIT, [["Balance on January 1", dollars(row.jan)], ["Check taken (8%)", "−" + dollars(row.check)], ["Four funds' average, after inflation", spct(row.ret)], ["Balance next January", dollars(row.end), true]]); },
      });
      const lab = (i, txt, a) => alpha(a, () => text(txt, A.X(y0 + i) + 3 + bars.w / 2, A.Y(r.checks[i]) - 12, { size: 20, weight: 700, align: "center" }));
      lab(0, `2000: ${money(r.checks[0])}`, q.span(1, 2.0, 2.6));
      callout(A.X(y0 + 3) + 3 + bars.w / 2, A.Y(r.checks[3]) - 4, A.Y(68e3), `2003: ${money(r.checks[3])}`,
        { fade: q.span(1, 4.5, 5.1), grow: q.span(1, 4.5, 5.0), align: "left", dx: 8, color: C.ink });
      // after 2008, the check never got back above this
      const after = Math.max(...r.checks.slice(9));
      alpha(q.span(1, 7.5, 8.3), () => { line(A.X(2009), A.Y(after), A.x1, A.Y(after), C.fire, 2, [4, 6]); text(`after 2008: never above ${money(after)}`, A.x1, A.Y(after) - 10, { size: 19, weight: 700, align: "right", color: C.fire }); });
      callout(A.X(y0 + lowI) + 3 + bars.w / 2, A.Y(low) - 4, A.Y(66e3), `${y0 + lowI}: ${money(low)}, the leanest year`, { fade: q.span(2, 0, 0.6), grow: q.span(2, 0, 0.5), align: "center" });
      pill(800, 790, `Never runs out: ${money(r.end)} left in ${y0 + n - 1}`, "neutral", q.span(2, 2.0, 2.6));
    };

    // 6. Every retiree's leanest year
    SCENES.leanest = function (t, q) {
      const lean = PCT.map((r) => ({ y0: r.y0, v: Math.min(...r.checks), done: r.done, r }));
      const fin = lean.filter((e) => e.done), sorted = fin.map((e) => e.v).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const worst = fin.reduce((a, e) => (e.v < a.v ? e : a));
      const A = chartFrame({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [F.first, F.last + 1], dy: [0, 100e3], yTicks: [0, 25e3, 50e3, 75e3, 100e3],
        xTicks: [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025], xTitle: "Year of retirement", title: `Leanest year's check so far, taking 8% of what's left, ${UNIT}` });
      line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
      text("The plan: $80,000", A.x1, A.Y(80e3) - 10, { size: 19, weight: 700, align: "right" });
      legend(A.x0, A.y1 + 100, [[C.blue, "Finished 30 years"], [rgba(C.muted, 0.9), "Still going (lean so far)"]]);
      const typ = q.span(1, 0, 0.8), worstSpot = q.window(1, 6.0, 6.6, 2, -0.2, 0.4), bubble = q.span(2, 0, 0.8);
      const bars = barSeries(A, lean, {
        x: (e) => e.y0, value: (e) => e.v, grow: q.sweep(0, 0.4, 1, -0.3), stagger: 5,
        color: (e) => (e.done ? (e.v < 40e3 ? C.danger : C.blue) : bubble > 0.3 && e.y0 >= 1999 && e.y0 <= 2001 ? C.danger : rgba(C.muted, 0.9)),
        alpha: (e) => Math.min(spotlight(worstSpot, e === worst), spotlight(bubble, e.y0 >= 1999 && e.y0 <= 2001)),
        hover: (e) => hvBox(`Retired January ${e.y0}`, `${UNIT}; ${e.done ? "30 years" : `${e.r.checks.length} years so far`}`, [
          ["First check", dollars(e.r.checks[0])], [`Leanest check (${e.y0 + e.r.checks.indexOf(e.v)})`, dollars(e.v)],
          [`Last check (${e.y0 + e.r.checks.length - 1})`, dollars(e.r.checks[e.r.checks.length - 1])], ["Left now", dollars(e.r.end), true]]),
      });
      alpha(typ * (1 - bubble), () => {
        line(A.x0, A.Y(med), A.X(F.first + DONE.length), A.Y(med), C.fire, 2.5, [4, 6]);
        counter(1440, 160, "TYPICAL LEANEST YEAR, FINISHED", countTo(t, q(1), med, money), { align: "right", size: 40, color: C.fire });
      });
      if (worstSpot > 0) callout(A.X(worst.y0) + bars.band / 2, A.Y(worst.v) - 6, A.Y(worst.v + 18e3), `${worst.y0}: ${money(worst.v)}`, { grow: worstSpot, fade: worstSpot, size: 24, fam: "display", align: "left", dx: -6 });
      alpha(bubble, () => {
        const b = lean.filter((e) => e.y0 >= 1999 && e.y0 <= 2001);
        counter(1440, 160, "RETIRED 1999–2001: LEANEST SO FAR", `${money(Math.min(...b.map((e) => e.v)))}–${money(Math.max(...b.map((e) => e.v)))}`, { align: "right", size: 40, color: C.danger });
      });
    };

    // 7. Against an S&P 500 index fund
    SCENES.compare = function (t, q) {
      const cols = [C.blue, C.fire], cx = [1010, 1170, 1330, 1490], spot = q.window(1, 0, 0.6, 3, -0.6, 0);
      const heads = [["Lasted 30 yrs", "finished ones"], ["Ran out", "1997–2008 starts"], ["Checks", "8% of what's left", WR * START], ["Checks", "4% of what's left", 0.04 * START]];
      // seconds into a line where the narrator reaches the S&P fund (line 0) and the 4% leanest years (line 3)
      const LAST_SHOWN = 2010, SP_AT = 3.0, LEAN4_AT = 4.0;
      heads.forEach(([a, b, first], j) => alpha(j < 2 ? q.span(1, 0, 0.6) : q.span(j, 0, 0.6), () => {
        text(a.toUpperCase(), cx[j], 166, { size: 15, weight: 700, color: C.muted, align: "center", spacing: 1 });
        text(b, cx[j], 188, { size: 16, color: C.muted, align: "center" });
        // the check columns start from the same first check for both portfolios
        if (first) text(`first ${money(first)}`, cx[j], 222, { size: 20, weight: 700, color: C.fire, align: "center" });
      }));
      PORTS.forEach((p, i) => {
        const top = 280 + i * 240, show = i === 0 ? span(t, 0.3, 1.0) : q.span(0, SP_AT, SP_AT + 0.6);
        if (show <= 0) return;
        // start years after 2010 are all still going, so the rows stop there
        const A = axes({ x0: 380, x1: 900, y0: top, y1: top + 130, dx: [F.first, LAST_SHOWN + 1], dy: [0, HORIZON] });
        alpha(show, () => {
          text(p.name, 340, top + 52, { size: 26, weight: 700, fam: "display", align: "right", color: cols[i] });
          p.mix.forEach((w, k) => text(w, 340, top + 80 + k * 22, { size: 17, color: C.muted, align: "right" }));
          line(A.x0, A.y1, A.x1, A.y1, C.lineStrong, 1);
          line(A.x0, A.Y(HORIZON), A.x1, A.Y(HORIZON), C.line, 1, [3, 5]);
          if (i === PORTS.length - 1) [1985, 1990, 1995, 2000, 2005, 2010].forEach((y) => text(String(y), A.X(y + 0.5), A.y1 + 24, { size: 16, color: C.muted, align: "center" }));
          if (i === 0) text("30 yrs", A.x0 - 8 + 2, A.Y(HORIZON) - 8, { size: 14, color: C.muted });
        });
        barSeries(A, p.fixed.filter((r) => r.y0 <= LAST_SHOWN), {
          x: (r) => r.y0, value: (r) => Math.min(r.years, HORIZON), color: (r) => statusColor(r.status), pad: 1.5, radius: 2,
          grow: lin(show, 0, 1), stagger: 6, alpha: (r) => spotlight(spot, r.n === HORIZON || (r.y0 >= 1997 && r.y0 <= 2008)),
          hover: (r) => hvBox(`${p.name}, retired ${r.y0}`, `${UNIT}; $80,000 a year`, [["8% of the start", outcome(r)],
            ["8% of what's left: leanest to biggest", `${dollars(p.pct[r.y0 - F.first].min)} to ${dollars(p.pct[r.y0 - F.first].max)}`], ["At 4% ($40,000 a year)", outcome(p.at4[r.y0 - F.first])],
            ["4% of what's left: leanest to biggest", `${dollars(p.pct4[r.y0 - F.first].min)} to ${dollars(p.pct4[r.y0 - F.first].max)}`]]),
        });
        // when each number lands, following the narration: line 1 gives the S&P fund's two counts, then the four
        // funds' 1997-2008 count at its end; line 2 gives the four funds' leanest year, then the S&P fund's
        const lastedAt = 0.3 + i * 0.3, outAt = [10.6, 5.8][i], d2 = [0.2, 6.6][i];
        const d3 = LEAN4_AT + i * 0.3;
        const vals = [countTo(t, q.at(1, lastedAt), p.lastedDone, ofN(DONE.length)), countTo(t, q.at(1, outAt), p.bubbleOut, ofN(BUBBLE.length)),
          countTo(t, q.at(2, d2), p.leanTyp, money), countTo(t, q.at(3, d3), p.leanTyp4, money)];
        const when = [q.span(1, lastedAt, lastedAt + 0.6), q.span(1, outAt, outAt + 0.6), q.span(2, d2, d2 + 0.6), q.span(3, d3, d3 + 0.6)];
        vals.forEach((v, j) => alpha(when[j] * show, () =>
          text(v, cx[j], top + (j < 2 ? 82 : 66), { size: j < 2 ? 36 : 38, weight: 700, fam: "display", align: "center", color: j === 1 ? C.danger : cols[i] })));
        // under each leanest year, the typical biggest check: the range a retiree lived with
        [[2, p.highTyp, q.span(2, d2 + 0.5, d2 + 1.1)], [3, p.highTyp4, q.span(3, d3 + 0.5, d3 + 1.1)]].forEach(([j, v, a]) => alpha(a * show, () =>
          text(`to ${money(v)}`, cx[j], top + 100, { size: 24, weight: 700, fam: "display", align: "center", color: cols[i] })));
        hot(920, top, 660, 130, hvBox(p.name, p.mix.join(" "), [["Finished 30-year retirements that lasted", `${p.lastedDone} of ${DONE.length}`],
          ["Retired 1997–2008: already ran out", `${p.bubbleOut} of ${BUBBLE.length}`], ["8% of what's left: typical leanest to biggest check", `${dollars(p.leanTyp)} to ${dollars(p.highTyp)}`],
          ["4% of what's left: typical leanest to biggest check", `${dollars(p.leanTyp4)} to ${dollars(p.highTyp4)}`],
          ["Ran out at 4% a year, any start", `${p.at4Out} of ${STARTS.length}`]]));
      });
      pill(800, 760, "At 4% a year instead of 8%, neither ever ran out", "blue", q.span(3, 0.3, 0.9));
    };

    // 8. What the four funds show
    SCENES.takeaway = function (t, q) {
      const ok = DONE.filter((r) => r.status === "ok").length, out = BUBBLE.filter((r) => r.status === "fail").length;
      const fin = PCT.filter((r) => r.done).map((r) => Math.min(...r.checks)).sort((a, b) => a - b), med = fin[fin.length >> 1];
      statCard({ cx: 490, w: 580, title: "8% of the start, raised with inflation", value: (p) => `${Math.round(ok * p)} of ${DONE.length}`, sub: "finished retirements lasted 30 years", color: C.blue, progress: lin(t, 0.4, 1.6) });
      alpha(q.span(0, 5.5, 6.2), () => text(`but ${out} of ${BUBBLE.length} that started 1997–2008 already ran out`, 490, 480, { size: 22, weight: 700, color: C.danger, align: "center" }));
      statCard({ cx: 1110, w: 580, title: "8% of what's left", value: (p) => money(med * p), sub: "typical leanest year, finished retirements", color: C.fire, progress: q.lin(1, 0, 1.2) });
      alpha(q.span(1, 4.5, 5.2), () => text("against the $80,000 planned", 1110, 480, { size: 22, weight: 700, color: C.muted, align: "center" }));
      words("Four funds or one index fund:", 800, 600, t, q(2), { size: 44, align: "center", gap: 0.13 });
      words("at 8%, the order of the years decides.", 800, 670, t, q(2) + 1.6, { size: 44, align: "center", color: C.blue, gap: 0.16 });
      alpha(q.span(2, 3.0, 3.8), () => text("Historical simulation in today's dollars. Fund returns at NAV, with fees, no taxes. Not financial advice.", 800, 780, { size: 20, color: C.muted, align: "center" }));
    };

    return { scenes: SCENES };
  });
})();
