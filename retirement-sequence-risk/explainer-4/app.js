// Explainer 4: Ramsey's four funds. $1 million split evenly across four American Funds, spent at 8% a year,
// in today's dollars. The fund returns come from this explainer's own funds.js (build-funds.py); the player
// and drawing toolkit live in ../kit/explainer-kit.js.
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS;
  ExplainerKit((K) => {
    const { C, alpha, axes, backOut, easeOut, font, dot, stag, callout, chartFrame, barSeries, lineSeries, columnHovers, counter, countTo, dollars, extremeLabel,
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
    // Never a pay cut: $80,000 of today's money every January 1, from the first day of retirement (the retiree
    // needs the year's money as it starts, like 8% of what's left), a quarter from each fund. path[k] is the
    // balance on January 1 of year y0 + k, before that year's check; when it can't cover the check, it ran out.
    function fixedRun(y0) {
      const bal = T.map(() => START / 4), path = [START], funds = T.map(() => [START / 4]), rows = [];
      let lasted = null;
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        const y = y0 + k, jan = sum(bal);
        if (jan < WR * START) { lasted = k + jan / (WR * START); rows.push({ y, jan, paid: jan, end: 0 }); bal.fill(0); path[path.length - 1] = jan; path.push(0); funds.forEach((f) => f.push(0)); break; }
        takeEvenly(bal, WR * START);
        T.forEach((t, i) => (bal[i] *= 1 + realRet(t, y)));
        rows.push({ y, jan, paid: WR * START, end: sum(bal) });
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
        if (B < WR * START) { lasted = k + B / (WR * START); path.push(0); break; }
        B = (B - WR * START) * (1 + spReal(y0 + k)); path.push(B);
      }
      const n = Math.min(HORIZON, F.last - y0 + 1);
      return { lasted, path, status: lasted != null ? "fail" : n < HORIZON ? "running" : "ok" };
    }
    const FIXED = STARTS.map(fixedRun), PCT = STARTS.map(pctRun);
    const DONE = FIXED.filter((r) => r.n === HORIZON);
    const BUBBLE = FIXED.filter((r) => r.y0 >= 1997 && r.y0 <= 2008); // the twelve that started near the 2000 peak
    // each fund keeps its color wherever it appears, whatever order the funds are listed in
    const FUND_COLOR = (ticker) => ({ AGTHX: C.blue, AIVSX: C.paintbrush, ANWPX: C.winecup, CWGIX: C.fire })[ticker];
    const FUND_COLORS = () => F.funds.map((f) => FUND_COLOR(f.ticker));
    const statusColor = (s) => (s === "ok" ? C.blue : s === "fail" ? C.danger : C.muted);
    const UNIT = "today's dollars (November 2026)";
    const outcome = (r) => (r.status === "fail" ? `out in ${r.y0 + Math.ceil(r.lasted) - 1}, ${r.lasted.toFixed(1)} yrs`
      : r.status === "running" ? `${r.n} yrs so far, ${money(r.end)} left` : `30 yrs, ${money(r.end)} left`);

    // The Total Money Makeover, chapter 9, on living off 8% (shown on the "8% of what's left" slide). Bold = b.
    const TMMO_QUOTE = [
      ["You are secure and will leave a nice inheritance when you can "], ["live off of 8 percent of your nest egg per year", "b"],
      [". If you make 12 percent on your money average and inflation steals 4 percent, "], ["8 percent is a dream number", "b"],
      [". If you make 12 percent and only pull out 8 percent, you "], ["grow your nest egg by 4 percent per year", "b"],
      [". That 4 percent keeps your nest egg, and therefore your income, "], ["ahead of inflation \u2019til death do you part", "b"],
      [". You get a "], ["cost-of-living raise from your nest egg every year", "b"],
      [". If you can live with dignity on $40,000, you need a nest egg of only $500,000.\u201D*"],
    ];
    const alphaZero = (fn) => { ctx.save(); ctx.globalAlpha = 0; const v = fn(); ctx.restore(); return v; };
    // Draw runs of [text, "b"?, color?] wrapped to width w from (x, y): bold runs in ink unless given a color.
    // o.align "center" centers each line on x. Returns the height used.
    function richText(x, y, w, runs, o) {
      const size = o.size || 20, lh = o.lineHeight || size * 1.5, lines = [[]];
      let cx = 0;
      runs.forEach(([s, b, color]) => s.split(/(\s+)/).forEach((tk) => {
        if (!tk) return;
        font(ctx, size, b ? 700 : 400);
        const tw = ctx.measureText(tk).width, space = /^\s+$/.test(tk);
        if (space) { if (cx > 0) { lines[lines.length - 1].push({ tk, tw, space }); cx += tw; } return; }
        if (cx + tw > w && cx > 0) { const last = lines[lines.length - 1]; while (last.length && last[last.length - 1].space) last.pop(); lines.push([]); cx = 0; }
        lines[lines.length - 1].push({ tk, tw, b: !!b, color }); cx += tw;
      }));
      lines.forEach((line, li) => {
        const width = line.reduce((s, t) => s + t.tw, 0);
        let lx = o.align === "center" ? x - width / 2 : x;
        line.forEach((t) => {
          if (!t.space) text(t.tk, lx, y + li * lh, { size, weight: t.b ? 700 : 400, color: t.color || (t.b ? C.ink : C.muted) });
          lx += t.tw;
        });
      });
      return (lines.length - 1) * lh + lh * 0.3;
    }


    const SCENES = {};

    // Ramsey's four funds
    SCENES["four-funds"] = function (t, q) {
      const cols = FUND_COLORS();
      // the book's own words (not narrated), each fund type in its card's color; it gives way to the headline
      alpha(span(t, 0.4, 1.2) * (1 - q.span(1, -0.4, 0.3)), () => {
        const [income, growth, intl, aggressive] = ["AIVSX", "AGTHX", "CWGIX", "ANWPX"].map(FUND_COLOR), by = 170;
        const h = richText(800, by, 1340, [
          ["\u201CI spread my retirement, investing evenly across four types of funds. "], ["Growth and Income", "b", income],
          [" funds get 25 percent of my investment\u2026 "], ["Growth", "b", growth], [" funds get 25 percent of my investment\u2026 "],
          ["International", "b", intl], [" funds get 25 percent of my investment\u2026 "], ["Aggressive Growth", "b", aggressive],
          [" funds get the last 25 percent of my investment.\u201D"],
        ], { size: 27, lineHeight: 42, align: "center" });
        text("Dave Ramsey, The Total Money Makeover, chapter 9 · first published September 2003", 800, by + h + 26, { size: 18, color: C.muted, align: "center" });
      });
      words("$1,000,000 on retirement day", 800, 250, t, q.at(1, 0.4), { size: 44, align: "center" });
      F.funds.forEach((f, i) => {
        const cx = 260 + i * 360;
        // each role and the fund that fills it arrive together, as the narrator names the role
        const role = q.span(0, 4.6 + i * 1.3, 5.2 + i * 1.3), fund = q.lin(0, 4.6 + i * 1.3, 5.4 + i * 1.3);
        alpha(role, () => text(f.role.toUpperCase(), cx, 350, { size: 18, weight: 700, color: cols[i], align: "center", spacing: 1.4 }));
        statCard({ cx, top: 370, w: 320, h: 252, title: f.ticker, value: "", sub: "", color: cols[i], progress: fund });
        alpha(fund, () => {
          const words2 = f.name.replace(/^The /, "").split(" "), mid = Math.ceil(words2.length / 2);
          text(words2.slice(0, mid).join(" "), cx, 500, { size: 24, weight: 700, fam: "display", align: "center" });
          text(words2.slice(mid).join(" "), cx, 532, { size: 24, weight: 700, fam: "display", align: "center" });
          // the fund that's younger than the data: say who fills in for it (not narrated)
          const st = F.standIn[f.ticker];
          if (st) {
            const by = F.funds.find((g) => g.ticker === st.by);
            text(`Started ${f.launched}. Before ${st.years[st.years.length - 1] + 1},`, cx, 574, { size: 15, color: C.muted, align: "center" });
            text(`${by.name.replace(/ Fund$/, "")} (${st.by}) stands in.`, cx, 594, { size: 15, color: C.muted, align: "center" });
          }
        });
        alpha(q.span(1, 4.2 + i * 0.3, 4.8 + i * 0.3), () => zoomAt(cx, 672, lerp(0.7, 1, backOut(q.lin(1, 4.2 + i * 0.3, 4.9 + i * 0.3))), () =>
          text("$250,000", cx, 687, { size: 40, weight: 700, fam: "display", align: "center", color: cols[i] })));
      });
      // an aside, not narrated (its sources are in the page notes)
      alpha(q.span(1, 5.2, 6.0), () => {
        line(560, 748, 1040, 748, C.line, 1);
        text("The Total Money Makeover, which lays out this four-fund mix, was first published in September 2003.", 800, 778, { size: 19, color: C.muted, align: "center" });
        text("Ramsey Solutions favors front-loaded funds bought through an advisor, and its SmartVestor Pros pay it fees.", 800, 806, { size: 19, color: C.muted, align: "center" });
        text("American Funds' Class A shares, used here, carry a sales charge of up to 5.75%.", 800, 834, { size: 19, color: C.muted, align: "center" });
        hot(300, 756, 1000, 90, hvBox("Aside", "sources in the notes below the player", [["The book's publication", "Bookreporter, Wikipedia"], ["Ramsey on front-loaded funds", "Ramsey Solutions articles"], ["SmartVestor Pro fees", "SmartVestor page"], ["Class A sales charge", "Capital Group pricing"]]));
      });
    };

    // Another way, never a pay cut: the 2000 retiree
    SCENES["retire-2000"] = function (t, q) {
      const r = FIXED[2000 - F.first], s = spRun(2000), y0 = 2000, cols = FUND_COLORS();
      const endYear = y0 + Math.ceil(r.lasted) - 1;
      const DRAW_FROM = 6.0; // seconds into line 0 where the narrator gets to taking $80,000 the first year
      const yearsShown = lerp(0, 3, q.lin(0, DRAW_FROM, q(1) - q(0) - 0.3)) + q.sweep(1, 0.2, 2, -0.2) * (r.lasted - 3);
      const tCrash = q.at(1, 0.2) + ((2008 - y0 + 0.5 - 3) / (r.lasted - 3)) * (q(2) - 0.2 - q.at(1, 0.2));
      shake(t, tCrash, 12);
      const yr = Math.min(endYear, y0 + Math.floor(yearsShown));
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 600, dx: [y0, 2026], dy: [0, 1.2e6], yTicks: [0, 250e3, 500e3, 750e3, 1e6],
        xTicks: [2000, 2005, 2010, 2015, 2020, 2025], title: `Balance, ${UNIT}`, titleGap: 30,
        under: (A) => text(String(yr), A.x1, A.y1 - 30, { size: 260, weight: 800, fam: "display", align: "right", color: rgba(yr >= 2008 ? C.danger : C.ink, 0.07) }) });
      legend(A.x1 - 640, A.y0 - 30, [[C.ink, "All four funds"], ...F.funds.map((f, i) => [cols[i], f.ticker])]);
      // the line from the book this way takes at its word (not narrated)
      alpha(span(t, 0.5, 1.2), () => {
        text("\u201CYou get a cost-of-living raise from your nest egg every year.\u201D", 800, 106, { size: 22, weight: 700, align: "center" });
        text("The Total Money Makeover, chapter 9", 800, 130, { size: 16, color: C.muted, align: "center" });
      });
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
      pill(A.X(2014), A.Y(0.92e6), "$80,000 a year, raised with inflation", "fire", q.span(0, DRAW_FROM - 1.0, DRAW_FROM - 0.4));
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
          ["Withdrawal, January 1", row.end > 0 ? "−$80,000" : `wanted $80,000, only ${dollars(row.paid)} left`],
          ...T.map((tk) => [`${tk}, after inflation`, spct(realRet(tk, y))]),
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

    // Every retirement since the first year of data
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

    // Retiring around the book: 2002 to 2005, one line each, drawn as the narrator gets to it
    SCENES["book-years"] = function (t, q) {
      const BOOK = 2003 + 8.5 / 12, YEARS = [2002, 2003, 2004, 2005];
      const look = { 2002: C.danger, 2003: C.blue, 2004: C.fire, 2005: C.winecup };
      // each line's own draw-in, and which lines the narration is on: 2003 (line 1), 2002 (line 2), 2004 and 2005 (line 3)
      const drawIn = { 2003: q.lin(1, 0.5, 9.0), 2002: q.lin(2, 0.3, 8.0), 2004: q.lin(3, 0.3, 6.5), 2005: q.lin(3, 0.3, 6.5) };
      const on = (y) => (t < q(1) ? true : t < q(2) ? y === 2003 : t < q(3) ? y === 2002 : t < q(3) + 9.5 ? y >= 2004 : true);
      const settle = q.span(3, 9.5, 10.2), dim = (y) => (on(y) ? 1 : lerp(0.25, 1, settle));
      const A = chartFrame({ x0: 200, x1: 1330, y0: 190, y1: 545, dx: [2002, 2026], dy: [0, 1.6e6], yTicks: [0, 500e3, 1e6, 1.5e6],
        xTicks: [2002, 2005, 2010, 2015, 2020, 2025], title: `Balance, ${UNIT}; $80,000 a year`, titleGap: 30 });
      // the 2008 crash and the book, for reference
      // each year's return underneath, for context: the four funds' average, after inflation
      const rA = axes({ x0: A.x0, x1: A.x1, y0: 670, y1: 840, dx: A.dx, dy: [-0.45, 0.45] }), bars = span(t, 0.4, 1.6);
      alpha(span(t, 0.4, 1.0), () => {
        ctx.fillStyle = rgba(C.danger, 0.08); ctx.fillRect(A.X(2008), A.y0, A.X(2009) - A.X(2008), rA.y1 - A.y0);
        line(rA.x0, rA.Y(0), rA.x1, rA.Y(0), C.lineStrong, 1);
        text("The four funds' average return each year, after inflation", rA.x0, 628, { size: 18, color: C.muted });
      });
      const retYears = []; for (let y = 2002; y <= F.last; y++) retYears.push(y);
      barSeries(rA, retYears, { x: (y) => y, value: blendRet, clamp: [-0.45, 0.45], pad: 4, grow: bars, stagger: 6,
        color: (y, i, v) => (v >= 0 ? C.blue : C.danger), extremes: (v) => v >= 0.2 || v <= -0.15, year: (y) => y }); // -0.15 so 2002's -17% gets a label
      alpha(q.span(0, 2.5, 3.2), () => {
        line(A.X(BOOK), A.y0 + 6, A.X(BOOK), A.y1, C.ink, 2, [3, 4]);
        text("The Total Money Makeover", A.X(BOOK) + 8, A.y0 + 4, { size: 16, weight: 700 });
        text("September 2003", A.X(BOOK) + 8, A.y0 + 22, { size: 15, color: C.muted });
      });
      YEARS.forEach((y0) => {
        const r = FIXED[y0 - F.first], p = drawIn[y0], col = look[y0];
        if (p <= 0) return;
        const pts = r.path.map((v, k) => [k === r.path.length - 1 && r.status === "fail" ? y0 + r.lasted : y0 + k, v]);
        alpha(dim(y0), () => {
          lineSeries(A, pts, { progress: p, color: col, width: on(y0) && p < 1 ? 5 : 4, glow: p < 1, t });
          if (p < 1) return;
          // where it stands now
          const fail = r.status === "fail", endX = fail ? A.X(y0 + r.lasted) : A.X(F.last + 1), endY = A.Y(r.end);
          if (fail) {
            ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath();
            ctx.moveTo(endX - 9, endY - 9); ctx.lineTo(endX + 9, endY + 9); ctx.moveTo(endX + 9, endY - 9); ctx.lineTo(endX - 9, endY + 9); ctx.stroke();
          }
          const label = fail ? `${y0}: out in ${y0 + Math.ceil(r.lasted) - 1}` : `${y0}: ${money(r.end)} left`;
          // all four in a column at the right edge, the three near zero stacked
          const ly = { 2002: A.Y(0) + 50, 2003: endY + 6, 2004: endY - 16, 2005: A.Y(0) + 22 }[y0];
          text(label, A.x1 + 14, ly, { size: 20, weight: 700, color: col });
        });
      });
      // the cushion each had going into 2008
      alpha(q.span(3, 1.6, 2.3) * (1 - q.span(3, 9.5, 10.2) * 0.4), () => {
        const px = A.X(2013.4), py = A.Y(1.58e6);
        text("END OF 2007, BEFORE THE CRASH", px, py, { size: 15, weight: 700, color: C.muted, spacing: 1 });
        YEARS.forEach((y0, i) => {
          const v = FIXED[y0 - F.first].path[2008 - y0];
          text(`${y0}`, px, py + 30 + i * 26, { size: 19, weight: 700, color: look[y0] });
          text(money(v), px + 150, py + 30 + i * 26, { size: 19, weight: 700, color: look[y0], align: "right" });
        });
      });
      const ys = []; for (let y = 2002; y <= F.last; y++) ys.push(y);
      columnHovers(A, ys, (y) => hvBox(`End of ${y}`, `${UNIT}; $80,000 a year`, [["Four funds' average, after inflation", spct(blendRet(y))],
        ...YEARS.filter((y0) => y0 <= y).map((y0) => {
          const r = FIXED[y0 - F.first], k = y - y0 + 1, v = r.path[k];
          return [`Retired ${y0}`, v == null ? (r.status === "fail" ? "out" : "") : v > 0 ? dollars(v) : "out"];
        })]), { align: "start", mark: "line", y1: rA.y1 });
    };

    // Where every retirement stood as the book was written: the balance on January 1, 2003 (returns through 2002),
    // $80,000 a year raised with inflation, then what happened next
    const AT = 2003, SEEN = FIXED.filter((r) => r.y0 < AT).map((r) => {
      const k = AT - r.y0, seen = r.path.slice(0, k + 1);
      return { r, k, bal: r.path[k], peak: Math.max(...seen), outBy: seen.some((v) => v <= 0) };
    });
    SCENES["in-2003"] = function (t, q) {
      const later = (s) => s.r.status === "fail", ABOVE = SEEN.filter((s) => s.bal > START);
      const DOWN = SEEN.filter((s) => s.r.y0 >= 1998); // the five that later ran out
      const A = chartFrame({ x0: 200, x1: 1440, y0: 220, y1: 660, dx: [F.first, AT], dy: [0, 3.2e6], yTicks: [0, 1e6, 2e6, 3e6],
        xTicks: [1981, 1985, 1990, 1995, 2000], title: `Balance on January 1, 2003, by year of retirement · ${UNIT}; $80,000 a year` });
      const up = q.span(1, 0, 0.8), down = q.span(2, 0, 0.8), next = q.span(2, 8.4, 9.2);
      alpha(q.span(0, 1.0, 1.6), () => {
        line(A.x0, A.Y(START), A.x1, A.Y(START), C.ink, 2, [8, 6]);
        text("Started with", A.x1 + 12, A.Y(START) - 4, { size: 17, color: C.muted });
        text("$1,000,000", A.x1 + 12, A.Y(START) + 18, { size: 18, weight: 700 });
      });
      const bars = barSeries(A, SEEN, {
        x: (s) => s.r.y0, value: (s) => s.bal, grow: q.sweep(0, 2.0, 0, 9.0), stagger: 5, pad: 3,
        color: (s) => (later(s) && down > 0.5 ? C.danger : C.blue),
        alpha: (s) => (down > 0 ? spotlight(down, s.r.y0 >= 1998) : spotlight(up * (1 - down), s.bal > START)),
        hover: (s) => hvBox(`Retired ${s.r.y0}`, `${UNIT}; $80,000 a year`, [["Year in 2003", `${s.k + 1} of 30`], ["Balance, January 1, 2003", dollars(s.bal)],
          ["Highest balance before 2003", dollars(s.peak)], ["What happened next", outcome(s.r)]]), hoverBelow: 150,
      });
      // the biggest, named
      const best = SEEN.reduce((a, s) => (s.bal > a.bal ? s : a));
      callout(A.X(best.r.y0) + bars.band / 2, A.Y(best.bal) - 6, A.Y(3.12e6), `${best.r.y0}: ${money(best.bal)}`,
        { fade: q.span(1, 2.4, 3.0) * (1 - down), grow: q.span(1, 2.4, 2.9), size: 19, align: "left", dx: -8, color: C.ink });
      // the five, as a range
      alpha(q.span(2, 3.0, 3.6), () => {
        const x0 = A.X(1998), x1 = A.X(AT), y = A.Y(START) - 18;
        line(x0 + 4, y, x1 - 4, y, C.danger, 2); line(x0 + 4, y, x0 + 4, y + 8, C.danger, 2); line(x1 - 4, y, x1 - 4, y + 8, C.danger, 2);
        const lo = Math.min(...DOWN.map((s) => s.bal)), hi = Math.max(...DOWN.map((s) => s.bal));
        text(`${money(lo)} to ${money(hi)}`, (x0 + x1) / 2, y - 12, { size: 19, weight: 700, color: C.danger, align: "center" });
      });
      // what happened next, under each bar: lasted (blue dot), still going (gray dot), ran out (red cross and year)
      alpha(next, () => {
        const ry = A.y1 + 104;
        text("WHAT HAPPENED NEXT", A.x0 - 60, ry - 34, { size: 15, weight: 700, color: C.muted, spacing: 1 });
        SEEN.forEach((s, i) => {
          const cx = A.X(s.r.y0) + bars.band / 2, p = stag(next, i, SEEN.length, 6);
          if (p <= 0) return;
          alpha(p, () => {
            if (s.r.status === "fail") {
              ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath();
              ctx.moveTo(cx - 7, ry - 7); ctx.lineTo(cx + 7, ry + 7); ctx.moveTo(cx + 7, ry - 7); ctx.lineTo(cx - 7, ry + 7); ctx.stroke();
              text(`${s.r.y0 + Math.ceil(s.r.lasted) - 1}`, cx, ry + 30, { size: 15, weight: 700, color: C.danger, align: "center" });
            } else dot(cx, ry, 7, statusColor(s.r.status));
          });
        });
        legend(A.x1 - 640, ry + 64, [[C.blue, "Lasted 30 years", "dot"], [C.muted, "Still going", "dot"], [C.danger, "Ran out (year)", "dot"]]);
      });
      const c = (label, value, color) => counter(1440, 160, label, value, { align: "right", size: 40, color });
      alpha(q.span(0, 9.6, 10.2) * (1 - up), () => c("RAN OUT BY 2003", countTo(t, q(0) + 9.6, SEEN.filter((s) => s.outBy).length, ofN(SEEN.length)), C.blue));
      alpha(up * (1 - down), () => c("ABOVE $1,000,000", countTo(t, q(1), ABOVE.length, ofN(SEEN.length)), C.blue));
      alpha(next, () => c("RETIRED 1998–2002: LATER RAN OUT", countTo(t, q(2) + 8.4, DOWN.filter(later).length, ofN(DOWN.length)), C.danger));
    };

    // 8% of what's left
    SCENES.percent = function (t, q) {
      const r = PCT[2000 - F.first], y0 = 2000, n = r.checks.length;
      const idea = 1 - q.span(1, -0.2, 0.4);
      if (idea > 0) {
        words("Take 8% of whatever is there,", 580, 400, t, 0.4, { size: 52, align: "center", a: idea, hi: ["8%"] });
        words("every January.", 580, 470, t, 1.4, { size: 52, align: "center", a: idea, color: C.fire });
      }
      const A = chartFrame({ x0: 170, x1: 1000, y0: 230, y1: 700, dx: [y0, y0 + n], dy: [0, 100e3], yTicks: [0, 25e3, 50e3, 75e3, 100e3], fade: q.span(1, 0, 0.6),
        xTicks: [2000, 2005, 2010, 2015, 2020, 2025], title: `Retired January 2000: each year's check, ${UNIT}` });
      // what the book says this plan does (not narrated)
      alpha(q.span(0, 0.8, 1.6), () => {
        const x = 1050, y = 150, w = 500, size = 21, lh = 31;
        // measure first (drawn invisibly), so the card fits the text
        const h = alphaZero(() => richText(0, 0, w - 64, TMMO_QUOTE, { size, lineHeight: lh })), H = 92 + h + 96;
        ctx.fillStyle = C.raised; ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x, y, w, H, 18); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.fire; ctx.fillRect(x, y + 18, 5, H - 36);
        text("\u201C", x + 22, y + 66, { size: 72, weight: 700, fam: "display", color: C.fire });
        richText(x + 34, y + 92, w - 64, TMMO_QUOTE, { size, lineHeight: lh });
        text("Dave Ramsey, The Total Money Makeover, chapter 9", x + 34, y + 92 + h + 22, { size: 17, color: C.muted });
        text("* The book's example; this explainer doubles it to", x + 34, y + 92 + h + 52, { size: 15, color: C.muted });
        text("$80,000 a year from $1,000,000.", x + 34, y + 92 + h + 72, { size: 15, color: C.muted });
      });
      alpha(q.span(1, 0, 0.6), () => { line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]); text("The plan: $80,000", A.X(2004), A.Y(80e3) - 10, { size: 19, weight: 700 }); });
      const low = Math.min(...r.checks), lowI = r.checks.indexOf(low), spot = q.window(2, 0, 0.6, 2, 3.5, 4.2);
      const bars = barSeries(A, r.checks, {
        x: (c, i) => y0 + i, value: (c) => c, pad: 3, grow: q.sweep(1, 2.5, 1, 9.5), stagger: 3,
        color: (c) => (c < 40e3 ? C.danger : c < 60e3 ? C.fire : C.blue), alpha: (c, i) => spotlight(spot, i === lowI),
        hover: (c, i) => { const row = r.rows[i]; return hvBox(`${row.y}`, UNIT, [["Balance on January 1", dollars(row.jan)], ["Check taken (8%)", "−" + dollars(row.check)], ["Four funds' average, after inflation", spct(row.ret)], ["Balance next January", dollars(row.end), true]]); },
      });
      const lab = (i, txt, a) => alpha(a, () => text(txt, A.X(y0 + i) + 3 + bars.w / 2, A.Y(r.checks[i]) - 12, { size: 20, weight: 700, align: "center" }));
      lab(0, `2000: ${money(r.checks[0])}`, q.span(1, 5.0, 5.6));
      callout(A.X(y0 + 3) + 3 + bars.w / 2, A.Y(r.checks[3]) - 4, A.Y(68e3), `2003: ${money(r.checks[3])}`,
        { fade: q.span(1, 8.3, 8.9), grow: q.span(1, 8.3, 8.8), align: "left", dx: 8, color: C.ink });
      // after 2008, the check never got back above this
      const after = Math.max(...r.checks.slice(9));
      alpha(q.span(1, 10.4, 11.2), () => { line(A.X(2009), A.Y(after), A.x1, A.Y(after), C.fire, 2, [4, 6]); text(`after 2008: never above ${money(after)}`, A.X(2009) + 4, A.Y(after) - 10, { size: 19, weight: 700, color: C.fire }); });
      callout(A.X(y0 + lowI) + 3 + bars.w / 2, A.Y(low) - 4, A.Y(66e3), `${y0 + lowI}: ${money(low)}, the leanest year`, { fade: q.span(2, 0, 0.6), grow: q.span(2, 0, 0.5), align: "right", dx: 14 });
      pill(585, 790, `Never runs out: ${money(r.end)} left in ${y0 + n - 1}`, "neutral", q.span(2, 2.0, 2.6));
    };

    // Ramsey's three numbers, checked retirement by retirement: a 12% return, 4% inflation, a nest egg growing 4% a year
    const nominalBlend = (y) => T.reduce((s, t) => s + F.returns[t][fi(y)], 0) / T.length;
    const geoMean = (f, a, b) => { let g = 1; for (let y = a; y <= b; y++) g *= 1 + f(y); return Math.pow(g, 1 / (b - a + 1)) - 1; };
    const CLAIMS = (() => {
      const per = STARTS.map((y0, k) => {
        const last = Math.min(y0 + HORIZON - 1, F.last), n = last - y0 + 1, infl = geoMean((y) => H.infl[hi(y)], y0, last);
        const realGrowth = Math.pow(PCT[k].end / START, 1 / n) - 1; // 8% of what's left, in today's dollars
        return { y0, n, done: n === HORIZON, ret: geoMean(nominalBlend, y0, last), infl, grow: (1 + realGrowth) * (1 + infl) - 1, real: realGrowth };
      });
      const done = per.filter((r) => r.done), med = (f) => done.map(f).sort((x, y) => x - y)[done.length >> 1];
      return { per, done, med, all: { ret: geoMean(nominalBlend, F.first, F.last), infl: geoMean((y) => H.infl[hi(y)], F.first, F.last) } };
    })();
    SCENES.claims = function (t, q) {
      const LAST_SHOWN = 2010; // later starts have had too few years to say much
      const rows = [
        { key: "ret", claim: 0.12, title: "A 12% return?", sub: "four funds, yearly, per retirement", dy: [0, 0.16], ticks: [0, 0.04, 0.08, 0.12], color: C.blue,
          stat: CLAIMS.med((r) => r.ret), hit: (r) => r.ret >= 0.12, extra: `1981–${F.last} overall: ${pct(CLAIMS.all.ret)}`, at: 1 },
        { key: "infl", claim: 0.04, title: "4% inflation?", sub: "consumer prices, yearly, per retirement", dy: [0, 0.05], ticks: [0, 0.02, 0.04], color: C.fire,
          stat: CLAIMS.med((r) => r.infl), hit: (r) => r.infl <= 0.04 /* a ceiling: at or under 4% means his number held */, extra: `1981–${F.last} overall: ${pct(CLAIMS.all.infl)}`, at: 2 },
        { key: "grow", claim: 0.04, title: "Nest egg grows 4%?", sub: "taking 8% of what's left, yearly", dy: [-0.01, 0.05], ticks: [0, 0.02, 0.04], color: C.winecup,
          stat: CLAIMS.med((r) => r.grow), hit: (r) => r.grow >= 0.04, extra: `after inflation: ${spct(CLAIMS.med((r) => r.real))} a year`, at: 3 },
      ];
      const shown = CLAIMS.per.filter((r) => r.y0 <= LAST_SHOWN), heads = q.span(1, 0, 0.6);
      alpha(heads, () => {
        text("TYPICAL FINISHED", 1240, 196, { size: 15, weight: 700, color: C.muted, align: "center", spacing: 1 });
        text("RAMSEY'S NUMBER HELD", 1440, 196, { size: 15, weight: 700, color: C.muted, align: "center", spacing: 1 });
      });
      rows.forEach((R, i) => {
        const top = 230 + i * 200, show = Math.max(q.span(0, 1.2 + i * 1.2, 1.8 + i * 1.2) * 0.35, q.span(R.at, 0, 0.6));
        const A = axes({ x0: 450, x1: 1100, y0: top, y1: top + 140, dx: [F.first, LAST_SHOWN + 1], dy: R.dy });
        alpha(show, () => {
          text(R.title, 370, top + 50, { size: 28, weight: 700, fam: "display", align: "right", color: R.color });
          text(R.sub, 370, top + 78, { size: 16, color: C.muted, align: "right" });
          R.ticks.forEach((v) => { line(A.x0, A.Y(v), A.x1, A.Y(v), v === 0 ? C.lineStrong : C.line, 1); text(pct(v, 0), A.x0 - 10, A.Y(v) + 5, { size: 14, color: C.muted, align: "right" }); });
          if (i === rows.length - 1) [1985, 1990, 1995, 2000, 2005, 2010].forEach((y) => text(String(y), A.X(y + 0.5), A.y1 + 24, { size: 15, color: C.muted, align: "center" }));
        });
        barSeries(A, shown, {
          x: (r) => r.y0, value: (r) => r[R.key], clamp: R.dy, pad: 2, radius: 2, grow: q.lin(R.at, 0.2, 2.2), stagger: 6,
          color: () => R.color, alpha: (r) => (r.done ? 1 : 0.45),
          hover: (r) => hvBox(`Retired ${r.y0}`, r.done ? "30 years" : `${r.n} years so far`, [["Four funds, yearly return", pct(r.ret)], ["Inflation, yearly", pct(r.infl)],
            ["Nest egg growth, 8% of what's left", spct(r.grow)], ["The same, after inflation", spct(r.real)]]),
        });
        // Ramsey's number, as a dashed line
        alpha(q.span(R.at, 0, 0.6), () => {
          line(A.x0, A.Y(R.claim), A.x1, A.Y(R.claim), C.ink, 2.5, [8, 6]);
          text(`Ramsey: ${pct(R.claim, 0)}`, A.x1 - 4, A.Y(R.claim) - 8, { size: 16, weight: 700, align: "right" });
        });
        alpha(q.span(R.at, 2.2, 2.8), () => {
          text(countTo(t, q.at(R.at, 2.2), R.stat, (v) => pct(v)), 1240, top + 72, { size: 40, weight: 700, fam: "display", align: "center", color: R.color });
          text(R.extra, 1240, top + 104, { size: 16, color: C.muted, align: "center" });
          text(`${CLAIMS.done.filter(R.hit).length} of ${CLAIMS.done.length}`, 1440, top + 72, { size: 40, weight: 700, fam: "display", align: "center", color: CLAIMS.done.some(R.hit) ? R.color : C.danger });
          text(`finished retirements`, 1440, top + 104, { size: 16, color: C.muted, align: "center" });
        });
      });
      alpha(q.span(1, 0, 0.6), () => text("Faded bars: retirements still under 30 years.", 450, 870, { size: 16, color: C.muted }));
    };

    // Every retiree's leanest year
    SCENES.leanest = function (t, q) {
      // each retirement's whole range of checks, leanest to biggest, opening out from the $80,000 first check
      const midOf = (xs) => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
      const lean = PCT.map((r) => ({ y0: r.y0, v: Math.min(...r.checks), hi: Math.max(...r.checks), mid: midOf(r.checks), done: r.done, r }));
      const fin = lean.filter((e) => e.done), sorted = fin.map((e) => e.v).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const worst = fin.reduce((a, e) => (e.v < a.v ? e : a));
      const top = Math.ceil(Math.max(...lean.map((e) => e.hi)) / 50e3) * 50e3;
      const A = chartFrame({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [F.first, F.last + 1], dy: [0, top], yTicks: ticksTo(top, 50e3),
        xTicks: [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025], xTitle: "Year of retirement", title: `Each retirement's checks so far, leanest to biggest, taking 8% of what's left, ${UNIT}` });
      line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
      text("First check", A.x1 + 12, A.Y(80e3) - 4, { size: 17, weight: 700 });
      text("$80,000", A.x1 + 12, A.Y(80e3) + 16, { size: 17, weight: 700 });
      legend(A.x0, A.y1 + 100, [[C.blue, "Finished 30 years"], [rgba(C.muted, 0.9), "Still going"], [C.ink, "dot: leanest year", "dot"], [C.ink, "bar: median year"]]);
      const typ = q.span(1, 0, 0.8), worstSpot = q.window(1, 6.0, 6.6, 2, -0.2, 0.4), bubble = q.span(2, 0, 0.8);
      const band = A.X(1) - A.X(0), grow = q.sweep(0, 0.4, 1, -0.3), inBubble = (e) => e.y0 >= 1999 && e.y0 <= 2001;
      lean.forEach((e, i) => {
        const p = backOut(stag(grow, i, lean.length, 5));
        if (p <= 0) return;
        const cx = A.X(e.y0) + band / 2, w = band * 0.42, y80 = A.Y(80e3);
        const lo = lerp(y80, A.Y(e.v), p), hiY = lerp(y80, A.Y(e.hi), p);
        const col = e.done ? C.blue : bubble > 0.3 && inBubble(e) ? C.danger : rgba(C.muted, 0.9);
        alpha(Math.min(spotlight(worstSpot, e === worst), spotlight(bubble, inBubble(e))), () => {
          ctx.fillStyle = e.done ? rgba(C.blue, 0.35) : bubble > 0.3 && inBubble(e) ? rgba(C.danger, 0.35) : rgba(C.muted, 0.3);
          ctx.beginPath(); ctx.roundRect(cx - w / 2, hiY, w, Math.max(1, lo - hiY), w / 2); ctx.fill();
          line(cx - w / 2, hiY, cx + w / 2, hiY, col, 2);
          // the median year's check: a bar across the range
          const midY = lerp(y80, A.Y(e.mid), p);
          ctx.fillStyle = C.ink; ctx.fillRect(cx - w / 2 - 3, midY - 1.5, w + 6, 3);
          dot(cx, lo, Math.max(4, band * 0.22), col);
        });
        hot(A.X(e.y0), A.y0, band, A.y1 - A.y0, hvBox(`Retired January ${e.y0}`, `${UNIT}; ${e.done ? "30 years" : `${e.r.checks.length} years so far`}`, [
          ["First check", dollars(e.r.checks[0])], [`Leanest check (${e.y0 + e.r.checks.indexOf(e.v)})`, dollars(e.v)],
          [`Biggest check (${e.y0 + e.r.checks.indexOf(e.hi)})`, dollars(e.hi)], ["Median year's check", dollars(e.mid)],
          [`Last check (${e.y0 + e.r.checks.length - 1})`, dollars(e.r.checks[e.r.checks.length - 1])], ["Left now", dollars(e.r.end), true]]));
      });
      alpha(typ * (1 - bubble), () => {
        line(A.x0, A.Y(med), A.X(F.first + DONE.length), A.Y(med), C.fire, 2.5, [4, 6]);
        counter(1440, 160, "TYPICAL LEANEST YEAR, FINISHED", countTo(t, q(1), med, money), { align: "right", size: 40, color: C.fire });
      });
      if (worstSpot > 0) callout(A.X(worst.y0) + band / 2, A.Y(worst.v) + 10, A.Y(worst.v) + 56, `${worst.y0}: ${money(worst.v)}`, { grow: worstSpot, fade: worstSpot, size: 24, fam: "display", align: "left", dx: -6 });
      alpha(bubble, () => {
        const b = lean.filter(inBubble);
        counter(1440, 160, "RETIRED 1999–2001: LEANEST SO FAR", `${money(Math.min(...b.map((e) => e.v)))}–${money(Math.max(...b.map((e) => e.v)))}`, { align: "right", size: 40, color: C.danger });
      });
    };

    // Thirty years or twenty: the same retirements judged over a shorter span. A retirement that ran out before
    // the span ended failed; one that reached it lasted; anything more recent is too soon to tell.
    const HORIZONS = [30, 20];
    const statusAt = (r, h) => (r.lasted != null && r.lasted < h ? "fail" : r.y0 + h - 1 <= F.last ? "ok" : "running");
    const outcomeAt = (r, h) => {
      const s = statusAt(r, h);
      return s === "fail" ? `ran out in ${r.y0 + Math.ceil(r.lasted) - 1}, after ${r.lasted.toFixed(1)} yrs`
        : s === "ok" ? `lasted ${h} yrs, ${money(r.path[h])} left` : `${F.last - r.y0 + 1} yrs so far`;
    };
    // $40,000 a year, raised with inflation: how long it lasted (null if it never ran out in 30 years)
    function lasted4(y0) {
      const bal = T.map(() => START / 4);
      for (let k = 0; k < HORIZON && y0 + k <= F.last; k++) {
        if (sum(bal) < 0.04 * START) return k + sum(bal) / (0.04 * START);
        takeEvenly(bal, 0.04 * START); T.forEach((t, i) => (bal[i] *= 1 + realRet(t, y0 + k)));
      }
      return null;
    }
    const HZ = HORIZONS.map((h) => {
      const st = FIXED.map((r) => statusAt(r, h)), count = (s) => st.filter((x) => x === s).length;
      const fin = FIXED.filter((r) => r.y0 + h - 1 <= F.last);
      const lean = PCT.filter((p) => p.checks.length >= h).map((p) => ({ y0: p.y0, v: Math.min(...p.checks.slice(0, h)) }));
      const worst = lean.reduce((a, e) => (e.v < a.v ? e : a));
      const ok4 = fin.filter((r) => { const l = lasted4(r.y0); return l == null || l >= h; }).length;
      return { h, st, ok: count("ok"), fail: count("fail"), open: count("running"), fin: fin.length,
        finOk: fin.filter((r) => statusAt(r, h) === "ok").length, worst, ok4 };
    });
    SCENES.horizon = function (t, q) {
      const x0 = 330, x1 = 1300, cw = (x1 - x0) / STARTS.length, rowY = [250, 410], rowH = 46;
      const X = (y) => x0 + (y - F.first) * cw;
      // when each kind of cell lands in each row, following the narration (seconds into lines 1 and 2)
      const at = [{ ok: q.at(1, 1.0), fail: q.at(1, 4.0), running: q.at(1, 6.8) }, { ok: q.at(2, 0.6), fail: q.at(2, 3.4), running: q.at(2, 3.4) }];
      const col = { ok: C.blue, fail: C.danger, running: C.muted };
      alpha(span(t, 0.3, 1.0), () => text("Every retirement since 1981, taking $80,000 a year, raised with inflation", x0, 180, { size: 20, color: C.muted }));
      HZ.forEach((z, j) => {
        const y = rowY[j];
        alpha(q.span(0, j === 0 ? 0.4 : 3.0, j === 0 ? 1.0 : 3.6), () => {
          text(`${z.h} years`, x0 - 24, y + 32, { size: 32, weight: 700, fam: "display", align: "right" });
          STARTS.forEach((y0) => { ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(X(y0) + 1.5, y, cw - 3, rowH, 3); ctx.stroke(); });
          // which retirements have had the whole span
          const fx = X(F.last - z.h + 2);
          line(x0 + 1.5, y - 10, fx - 1.5, y - 10, C.lineStrong, 1.5); line(x0 + 1.5, y - 10, x0 + 1.5, y - 4, C.lineStrong, 1.5); line(fx - 1.5, y - 10, fx - 1.5, y - 4, C.lineStrong, 1.5);
          text(`finished ${z.h} years: ${z.fin}`, x0 + 4, y - 18, { size: 15, color: C.muted });
        });
        // while the narrator names this row's worst leanest year, the other cells step back
        const focus = q.window(3, [4.2, 6.0][j], [4.8, 6.6][j], 3, 9.2, 9.8);
        STARTS.forEach((y0, i) => {
          const s = z.st[i], a = span(t, at[j][s] + (y0 - F.first) * 0.02, at[j][s] + (y0 - F.first) * 0.02 + 0.4) * spotlight(focus, y0 === z.worst.y0);
          if (a > 0) alpha(a, () => { ctx.fillStyle = s === "running" ? rgba(C.muted, 0.35) : col[s]; ctx.beginPath(); ctx.roundRect(X(y0) + 1.5, y, cw - 3, rowH, 3); ctx.fill(); });
        });
        // the counts, right of each row, as each kind lands
        [["ok", `${z.ok} lasted`], ["fail", `${z.fail} ran out`], ["running", `${z.open} too soon to tell`]].forEach(([s, label], k) =>
          alpha(span(t, at[j][s] + 0.3, at[j][s] + 0.9), () => text(label, x1 + 24, y + 10 + k * 20, { size: 18, weight: 700, color: s === "running" ? C.muted : col[s] })));
      });
      alpha(q.span(0, 3.0, 3.6), () => [1981, 1990, 2000, 2010, 2020, 2025].forEach((y) => text(String(y), X(y) + cw / 2, rowY[1] + rowH + 24, { size: 16, color: C.muted, align: "center" })));
      // the one that changes sides: 1998 ran out in its 25th year
      const r98 = FIXED[1998 - F.first];
      alpha(q.span(2, 6.0, 6.6), () => {
        const cx = X(1998) + cw / 2;
        line(cx, rowY[0] + rowH + 6, cx, rowY[1] - 30, C.ink, 1.5);
        text(`1998 ran out in its 25th year: failed at 30, lasted at 20`, cx + 8, rowY[0] + rowH + 40, { size: 17, weight: 700 });
      });
      // the worst leanest year at each length (8% of what's left), outlined as the narrator names it
      HZ.forEach((z, j) => {
        const a = q.span(3, [4.2, 6.0][j], [4.8, 6.6][j]);
        if (a > 0) alpha(a, () => {
          ctx.strokeStyle = C.fire; ctx.lineWidth = 4; ctx.beginPath();
          ctx.roundRect(X(z.worst.y0) - 3, rowY[j] - 6, cw + 6, rowH + 12, 6); ctx.stroke();
        });
      });
      // hover: each start year, both spans
      STARTS.forEach((y0, i) => hot(X(y0), rowY[0], cw, rowY[1] + rowH - rowY[0], hvBox(`Retired ${y0}`, `${UNIT}; $80,000 a year`,
        HORIZONS.map((h) => [`Over ${h} years`, outcomeAt(FIXED[i], h)]))));
      // the summary table
      const ty = 590, c30 = 1060, c20 = 1260, rows = [
        ["$80,000 a year, raised with inflation", "finished retirements that lasted", (z) => `${z.finOk} of ${z.fin}`, [q.at(1, 1.6), q.at(2, 3.6)], C.blue],
        ["8% of what's left", "worst leanest year, finished retirements", (z) => `${money(z.worst.v)} (${z.worst.y0})`, [q.at(3, 4.2), q.at(3, 6.0)], C.ink],
        ["$40,000 a year, raised with inflation", "finished retirements that lasted", (z) => `${z.ok4} of ${z.fin}`, [q.at(3, 9.6), q.at(3, 10.0)], C.blue],
      ];
      alpha(q.span(1, 1.4, 2.0), () => {
        text("30 YEARS", c30, ty, { size: 15, weight: 700, color: C.muted, align: "center", spacing: 1 });
        text("20 YEARS", c20, ty, { size: 15, weight: 700, color: C.muted, align: "center", spacing: 1 });
      });
      rows.forEach(([head, sub, val, when, color], k) => {
        const y = ty + 52 + k * 64;
        alpha(span(t, when[0], when[0] + 0.6), () => {
          line(x0, y - 36, x1 + 200, y - 36, C.line, 1);
          text(head, x0, y, { size: 22, weight: 700 });
          text(sub, x0, y + 22, { size: 16, color: C.muted });
          text(val(HZ[0]), c30, y + 8, { size: 28, weight: 700, fam: "display", align: "center", color });
        });
        alpha(span(t, when[1], when[1] + 0.6), () => text(val(HZ[1]), c20, y + 8, { size: 28, weight: 700, fam: "display", align: "center", color }));
      });
    };

    // What the four funds show
    SCENES.takeaway = function (t, q) {
      const ok = DONE.filter((r) => r.status === "ok").length, out = BUBBLE.filter((r) => r.status === "fail").length;
      const fin = PCT.filter((r) => r.done).map((r) => Math.min(...r.checks)).sort((a, b) => a - b), med = fin[fin.length >> 1];
      // the book's way first, then the never-a-pay-cut way, in the order the explainer took them
      statCard({ cx: 490, w: 580, title: "The book's way: 8% of what's left", value: (p) => money(med * p), sub: "typical leanest year, finished retirements", color: C.fire, progress: lin(t, 0.4, 1.6) });
      alpha(q.span(0, 6.0, 6.7), () => text("against the $80,000 planned", 490, 480, { size: 22, weight: 700, color: C.muted, align: "center" }));
      statCard({ cx: 1110, w: 580, title: "$80,000, raised with inflation", value: (p) => `${Math.round(ok * p)} of ${DONE.length}`, sub: "finished retirements lasted 30 years", color: C.blue, progress: q.lin(1, 0, 1.2) });
      alpha(q.span(1, 5.5, 6.2), () => text(`but ${out} of ${BUBBLE.length} that started 1997–2008 already ran out`, 1110, 480, { size: 22, weight: 700, color: C.danger, align: "center" }));
      words("At 8%, the order of the years decides,", 800, 600, t, q(2), { size: 44, align: "center", color: C.blue, gap: 0.16 });
      words("over 30 years or 20.", 800, 670, t, q(2) + 2.9, { size: 44, align: "center", gap: 0.16 });
      alpha(q.span(2, 3.0, 3.8), () => text("Historical simulation in today's dollars. Fund returns at NAV, with fees, no taxes. Not financial advice.", 800, 780, { size: 20, color: C.muted, align: "center" }));
    };

    return { scenes: SCENES };
  });
})();
