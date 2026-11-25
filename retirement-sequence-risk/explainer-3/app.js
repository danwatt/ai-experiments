// Explainer 3: the data and scenes. The player and drawing toolkit live in ../kit/explainer-kit.js.
(function () {
  "use strict";
  const H = window.HIST;
  ExplainerKit((K) => {
    const { C, ctx, rgba, clamp, ease, span, lin, lerp, easeOut, backOut, stag, tally, pct, spct, money, moneyTick, dollars, font, text, alpha, dot, line, bar, zoomAt, glow, words, shake, flash, pill, counter, axes, yGrid, xLabels, legend, hvBox, spotlight, callout, countTo, ofN, ticksTo, chartFrame, barSeries, lineSeries, columnHovers, titleCard, statCard, ledger, twoTracks, isStarted } = K;

    // ---------- data ----------
    const idx = (y) => y - H.first;
    const START = 1e6, WR = 0.08, HORIZON = 30, FROM = 1945;
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const TODAY = `${MONTH_NAMES[H.capeNow.month - 1]} ${H.capeNow.year}`;
    const cagr = (a) => Math.pow(a.reduce((p, x) => p * (1 + x), 1), 1 / a.length) - 1;
    const realOf = (y) => (1 + H.stocks[idx(y)]) / (1 + H.infl[idx(y)]) - 1;

    // Retire in January of y0 with $1M, 100% stocks, withdrawals at the end of each year.
    // "nominal": the same check every year, balances as the statement showed them.
    // "real": the same buying power every year (raised with inflation), balances in today's dollars.
    function retire(y0, mode, wr = WR, reverse = false) {
      const years = [];
      for (let y = y0; y < y0 + HORIZON && y <= H.last; y++) years.push(y);
      const seq = reverse ? [...years].reverse() : years;
      let B = START, prices = 1, lasted = null;
      const path = [B], rate = [];
      for (let k = 0; k < seq.length; k++) {
        const y = seq[k], r = H.stocks[idx(y)];
        prices *= 1 + H.infl[idx(y)];
        const w = mode === "real" ? wr * START * prices : wr * START;
        const pre = B * (1 + r);
        rate.push(w / pre);
        if (pre < w) { lasted = k + pre / w; B = 0; path.push(0); break; }
        B = pre - w;
        path.push(mode === "real" ? B / prices : B);
      }
      const n = years.length;
      const status = lasted != null ? "fail" : n < HORIZON ? "running" : "ok";
      return { y0, path, rate, lasted, status, n, seq, end: path[path.length - 1], years: lasted != null ? lasted : n };
    }
    function buildSet(mode) {
      const all = [];
      for (let y = FROM; y <= H.last; y++) all.push(retire(y, mode));
      const done = all.filter((r) => r.n === HORIZON);
      const recent = all.filter((r) => r.n < HORIZON);
      const four = [];
      for (let y = FROM; y <= H.last; y++) four.push(retire(y, mode, 0.04));
      return {
        mode, all, done, recent, four,
        // the today's-dollars or plain-dollars version of anything that differs between the two
        pick: (real, plain) => (mode === "real" ? real : plain),
        okCount: done.filter((r) => r.status === "ok").length,
        recentFails: recent.filter((r) => r.status === "fail"),
        fourOk: four.filter((r) => r.n === HORIZON && r.status === "ok").length,
        unit: mode === "real" ? `today's dollars (${TODAY})` : "plain dollars",
        rets: (y) => (mode === "real" ? realOf(y) : H.stocks[idx(y)]),
      };
    }
    const SETS = { real: buildSet("real"), nominal: buildSet("nominal") };
    const statusColor = (s) => (s === "ok" ? C.blue : s === "fail" ? C.danger : C.muted);
    function cross(x, y, r, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    }
    const tickStep = (top) => (top > 3e6 ? 1e6 : top > 1.5e6 ? 500e3 : 250e3);

    const SCENES = {};
    const both = twoTracks(SCENES, SETS); // one draw function, registered for both ways of counting

    // 1. The 8% promise
    SCENES.promise = function (t, q) {
      alpha(span(t, 0.3, 1.0), () => {
        text("Your nest egg on retirement day", 800, 190, { size: 26, color: C.muted, align: "center" });
        text(countTo(t, 0.3, START, dollars, 1.6), 800, 290, { size: 104, weight: 700, fam: "display", align: "center" });
      });
      alpha(q.span(1, 0.4, 1.1), () => {
        text("Ramsey: take about 8% a year", 800, 390, { size: 30, weight: 600, align: "center", color: C.muted });
        zoomAt(800, 440, lerp(0.8, 1, backOut(q.lin(1, 1.6, 2.3))), () =>
          text(countTo(t, q.at(1, 1.6), 80e3, dollars, 0.9) + " a year", 800, 460, { size: 64, weight: 700, fam: "display", align: "center", color: C.fire }));
      });
      const parts = [[440, "10–12%", "fund growth, long run", C.blue], [800, "8%", "what you spend", C.fire], [1160, "the rest", "covers inflation", C.ink]];
      parts.forEach(([x, big, small, col], i) => {
        const p = lin(t, q(2) + 2.5 + i * 3.0, q(2) + 3.1 + i * 3.0);
        alpha(ease(p), () => {
          zoomAt(x, 585, lerp(0.6, 1, backOut(p)), () => text(big, x, 600, { size: 52, weight: 700, fam: "display", align: "center", color: col }));
          text(small, x, 638 + (1 - ease(p)) * 12, { size: 22, color: C.muted, align: "center" });
          if (i) text(i === 1 ? "−" : "=", (x + parts[i - 1][0]) / 2, 596, { size: 52, weight: 600, fam: "display", align: "center", color: C.muted });
        });
      });
      pill(800, 760, "Retirement research: about 4%, or $40,000 a year", "blue", q.span(3, 0.4, 1.0));
    };

    // 2. In Ramsey's world, then the fork
    SCENES["ramsey-world"] = function (t, q) {
      const bal = [START], wd = [];
      let B = START;
      for (let k = 1; k <= HORIZON; k++) { const w = WR * START * Math.pow(1.04, k - 1); B = B * 1.12 - w; bal.push(B); wd.push(w); }
      const A = axes({ x0: 200, x1: 1440, y0: 190, y1: 600, dx: [0, HORIZON], dy: [0, 4.5e6] });
      // the nest egg from the last scene shrinks down onto the chart's starting point
      const land = isStarted() ? span(t, 0.1, 1.3) : 1;
      alpha(isStarted() ? span(t, 0.5, 1.2) : 1, () => {
        yGrid(A, [0, 1e6, 2e6, 3e6, 4e6], moneyTick);
        xLabels(A, [0, 5, 10, 15, 20, 25, 30], (v) => (v === 0 ? "Retire" : `year ${v}`));
        text("+12% every year, prices +4% every year", A.x0, 150, { size: 22, color: C.muted });
      });
      alpha(1 - q.span(1, 0, 1.0), () => text("$1,000,000", lerp(800, A.X(0) + 82, land), lerp(290, A.Y(START) - 22, land), { size: lerp(104, 26, land), weight: 700, fam: "display", align: "center" }));
      const f = q.sweep(1, 0, 2, 1.5);
      lineSeries(A, bal.map((v, k) => [k, v]), { progress: f, color: C.ink, glow: land >= 1, t,
        tipLabel: (v, p) => (p < 1 ? { text: money(v), dx: -14, dy: -22, size: 22, weight: 700, align: "right" } : null) });
      // the withdrawals, growing 4% a year: the first and every tenth labelled, each year's money on hover
      const bA = axes({ x0: A.x0, x1: A.x1, y0: 680, y1: 850, dx: A.dx, dy: [0, 300e3] });
      alpha(q.span(1, 0, 0.6), () => text("Withdrawal each year: $80,000, then a 4% raise every year", bA.x0, bA.y0 - 12, { size: 19, color: C.muted }));
      barSeries(bA, wd, {
        x: (w, k) => k, value: (w) => w, color: () => rgba(C.fire, 0.85), grow: f, stagger: 2, pad: 3,
        after: (w, k, g) => { if (k === 0 || (k + 1) % 10 === 0) alpha(span(g.p, 0.6, 1), () => text(`$${Math.round(w / 1000)}K`, g.cx, g.end - 10, { size: 18, weight: 700, align: "center" })); },
        hoverAbove: 30,
        hover: (w, k) => hvBox(`Year ${k + 1}`, "Ramsey's world: +12% a year, prices +4%", [
          ["Balance on January 1", dollars(bal[k])],
          ["Growth (+12%)", "+" + dollars(bal[k] * 0.12)],
          [k ? "Withdrawal (4% raise)" : "First withdrawal", "−" + dollars(w)],
          ["Balance at year end", dollars(bal[k + 1]), true],
        ]),
      });
      alpha(q.span(2, 1.6, 2.4), () => {
        text(`${money(bal[HORIZON])}`, A.X(HORIZON), A.Y(bal[HORIZON]) - 46, { size: 30, weight: 700, fam: "display", align: "right" });
        text("buys what $1M did on day one", A.X(HORIZON), A.Y(bal[HORIZON]) - 18, { size: 20, color: C.muted, align: "right" });
      });
    };
    SCENES["ramsey-world"].ownEntrance = true;

    // track intros
    both(["real-intro", "nominal-intro"], (t, q, D) => {
      titleCard(t, { title: D.pick(`Today's dollars: ${TODAY}`, "Plain dollars"), color: D.pick(C.blue, C.fire), size: 60, step: 1.6, lines: D.pick(
        [`$1,000,000 at ${TODAY} prices`, "$80,000 of that buying power, every year", "no matter what the market does"],
        ["The same $80,000 check every year", "Balances as the statement showed them", "No raises for inflation"]) });
      words(D.pick("$80,000 a year, forever?", "$80,000 every year"), 800, 600, t, q(1), { size: 80, align: "center", color: C.fire, gap: 0.16 });
      alpha(q.span(1, 1.0, 1.8), () => text(D.pick("the lifestyle Ramsey's math promises", "easier on the portfolio, but each check buys a little less"), 800, 660, { size: 26, color: C.muted, align: "center" }));
    });

    // 4. Retire in January 2000
    function retire2000(t, q, D) {
      const r = retire(2000, D.mode), y0 = 2000;
      const endYear = y0 + Math.ceil(r.lasted) - 1;
      // years drawn: first three by the end of line 1, the rest during line 2
      const a2 = q(2) + 0.2, b2 = q(2) + 3.6;
      const yearsShown = lerp(0, 3, q.lin(1, 0.4, 4.5)) + lin(t, a2, b2) * (r.lasted - 3);
      // the moment the line reaches the 2008 drop
      const tCrash = a2 + ((2008 - y0 + 0.5 - 3) / (r.lasted - 3)) * (b2 - a2);
      shake(t, tCrash, 14);
      const yr = Math.min(endYear, y0 + Math.floor(yearsShown));
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 600, dx: [y0, 2026], dy: [0, 1.2e6], yTicks: [0, 250e3, 500e3, 750e3, 1e6],
        xTicks: [2000, 2005, 2010, 2015, 2020, 2025], title: `Balance, ${D.unit}`, titleGap: 30,
        // the year, huge and faint, ticking behind the chart
        under: (A) => text(String(yr), A.x1, A.y1 - 30, { size: 260, weight: 800, fam: "display", align: "right", color: rgba(yr >= 2008 ? C.danger : C.ink, 0.07) }) });
      const broke = yearsShown >= r.lasted - 0.01;
      const path = r.path.map((v, k) => [k === r.path.length - 1 ? y0 + r.lasted : y0 + k, v]);
      lineSeries(A, path, { progress: clamp(yearsShown / r.lasted), color: C.danger, glow: true, t,
        tipLabel: (v) => (yearsShown > 0.15 && !broke ? { text: money(v), dx: 18, dy: -16, size: 24, weight: 700, fam: "display" } : null) });
      const pts = path.map(([x, v]) => [A.X(x), A.Y(v)]);
      alpha(span(t, 0.4, 1.0) * (1 - q.span(1, 0.4, 1.0)), () => text("$1M on January 1, 2000", A.X(y0) + 14, A.Y(START) - 16, { size: 22, weight: 700 }));
      pill(A.X(2013), A.Y(0.85e6), "Taking $80,000 a year", "fire", q.span(1, 0, 0.6));
      // each year's return
      const bA = axes({ x0: A.x0, x1: A.x1, y0: 690, y1: 860, dx: A.dx, dy: [-0.45, 0.45] });
      alpha(span(t, 0.3, 0.9), () => { line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1); text(D.pick("Stock return each year, after inflation", "Stock return each year"), bA.x0, bA.y0 - 8, { size: 18, color: C.muted }); });
      const years = []; for (let y = y0; y <= endYear; y++) years.push(y);
      const grown = (y) => clamp((yearsShown - (y - y0)) * 1.6);
      // the standout years carry their own label, as on the "backwards" slide
      barSeries(bA, years, { x: (y) => y, value: (y) => D.rets(y), clamp: [-0.45, 0.45], pad: 3, progress: grown,
        color: (y, i, v) => (v >= 0 ? C.blue : C.danger), extremes: (v) => v >= 0.25 || v <= -0.2, year: (y) => y });
      // the year's money movements on hover
      columnHovers(A, years.filter((y) => grown(y) > 0), (y) => {
        const k = y - y0, last = k + 1 >= r.path.length - 1 && r.status === "fail";
        return hvBox(`${y}`, `year ${k + 1} of retirement, ${D.unit}`, [
          ["Balance on January 1", dollars(r.path[k])],
          [D.pick("Stocks, after inflation", "Stocks"), spct(D.rets(y))],
          ["Withdrawal", last ? `wanted $80,000, only ${dollars(r.path[k] * (1 + D.rets(y)))} left` : "−$80,000"],
          ["Balance at year end", last ? "$0, broke" : dollars(r.path[k + 1]), true],
        ]);
      }, { align: "start", y1: bA.y1 });
      if (broke) alpha(q.span(2, 3.6, 4.2), () => {
        const [x, y] = pts[pts.length - 1];
        zoomAt(x, y, lerp(2.2, 1, backOut(q.lin(2, 3.6, 4.1))), () => cross(x, y, 12, C.danger));
        text(`Broke in ${endYear}`, x + 22, y - 18, { size: 30, weight: 700, fam: "display", color: C.danger });
      });
      flash(t, tCrash, C.danger);
    }
    both("retire-2000", retire2000);

    // 5. Same years, backwards
    function backwards(t, q, D) {
      const fwd = retire(2000, D.mode), rev = retire(2000, D.mode, WR, true), n = fwd.n;
      const top = Math.max(...rev.path) * 1.12, step = tickStep(top);
      const yTop = Math.ceil(top / step) * step;
      const A = chartFrame({ x0: 200, x1: 1400, y0: 200, y1: 580, dx: [0, n], dy: [0, yTop], yTicks: ticksTo(yTop, step),
        xTicks: [0, 5, 10, 15, 20, 25], xFmt: (v) => (v === 0 ? "Retire" : `year ${v}`) });
      legend(A.x0, 150, [[C.danger, "Real order, 2000 → 2025"], [C.fire, "Reversed, 2025 → 2000"]]);
      lineSeries(A, fwd.path.map((v, k) => [k === fwd.path.length - 1 ? fwd.lasted : k, v]), { color: C.danger });
      text(`Broke in year ${Math.ceil(fwd.lasted)}`, A.X(fwd.lasted) + 14, A.Y(0) - 16, { size: 21, weight: 700, color: C.danger });
      const avg = cagr(fwd.seq.map(D.rets));
      pill(1150, 160, `Same average: ${spct(avg)} a year`, "neutral", span(t, 1.0, 1.6));
      // the returns, sliding into reverse order
      const bA = axes({ x0: A.x0, x1: A.x1, y0: 670, y1: 860, dx: A.dx, dy: [-0.45, 0.45] });
      line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1);
      const flip = q.spanTo(1, 0.4, 2, -0.3);
      // the bars slide into reverse order, each hopping over its neighbors on the way; the standout
      // years carry their own label, which travels with the bar
      barSeries(bA, fwd.seq, {
        x: (y, i) => lerp(i, n - 1 - i, flip),
        shift: (y, i) => ({ y: Math.sin(Math.PI * flip) * (i % 2 ? 14 : -14) * Math.min(1, Math.abs(n - 1 - 2 * i) / 6) }),
        value: (y) => D.rets(y), clamp: [-0.45, 0.45], pad: 3, grow: lin(t, 0.3, 1.8), stagger: 4,
        color: (y, i, v) => (v >= 0 ? C.blue : C.danger), extremes: (v) => v >= 0.25 || v <= -0.2, year: (y) => y,
        hoverPad: 3, hoverBelow: 30,
        hover: (y, i) => hvBox(`${y}`, `year ${i + 1} of the real order, year ${n - i} reversed`, D.pick(
          [["Stocks", spct(H.stocks[idx(y)])], ["Prices", spct(H.infl[idx(y)])], ["After inflation", spct(D.rets(y)), true]],
          [["Stocks", spct(D.rets(y)), true], ["Prices (not counted in plain dollars)", spct(H.infl[idx(y)])]])),
      });
      text(flip < 0.5 ? "Each year's return, in the real order" : "The same returns, last year first", bA.x0, bA.y0 - 18, { size: 19, weight: 600, color: C.muted });
      const rf = q.lin(2, 0.2, 4.0);
      lineSeries(A, rev.path.map((v, k) => [k, v]), { progress: rf, color: C.fire, glow: rf > 0, t,
        tipLabel: (v, p) => ({ text: money(v), dx: 16, dy: 8, size: p >= 1 ? 28 : 22, weight: 700, fam: "display" }) });
      words("Only the order changed.", 1400, 236, t, q(3) + 0.4, { size: 40, align: "right", hi: ["order"] });
    }
    both("backwards", backwards);

    // 6. Every retirement since 1945
    function every(t, q, D) {
      const A = chartFrame({ x0: 200, x1: 1440, y0: 220, y1: 720, dx: [FROM, H.last + 1], dy: [0, HORIZON], yTicks: [0, 10, 20, 30], yFmt: (v) => `${v} yrs`,
        xTicks: [1945, 1955, 1965, 1975, 1985, 1995, 2005, 2015, 2025], xTitle: "Year of retirement", title: "How many years the money lasted" });
      legend(A.x1 - 560, A.y0 - 34, [[C.blue, "Lasted 30 years"], [C.danger, "Ran out"], [C.muted, "Still going"]]);
      const bw = A.X(1) - A.X(0) - 3;
      const recent = q.span(2, 0, 0.8), last = q.span(3, 0, 0.8);
      const morph = D.pick(q.span(3, 0.6, 3.0), 0);
      // the narrator names two recent retirees: point them out
      const named = D.pick(q.span(2, 5.2, 5.8) * (1 - last), 0);
      // a bar that changes color in the morph to 4% gets a quick pulse
      const flipped = (r, i) => (D.mode === "real" && D.four[i].status !== r.status ? Math.sin(Math.PI * clamp((morph - 0.35) / 0.3)) : 0);
      // kept short so each hover row fits on one line
      const outcome = (x) => (x.status === "fail" ? `out in ${x.y0 + Math.ceil(x.lasted) - 1}, ${x.lasted.toFixed(1)} yrs`
        : x.status === "running" ? `${x.n} yrs so far, ${money(x.end)} left` : `30 yrs, ${money(x.end)} left`);
      barSeries(A, D.all, {
        x: (r) => r.y0, value: (r, i) => lerp(Math.min(r.years, HORIZON), Math.min(D.four[i].years, HORIZON), morph),
        color: (r, i) => statusColor(morph > 0.5 ? D.four[i].status : r.status),
        grow: q.sweep(0, 0.4, 1, -0.3), stagger: 6, pad: 1.5, radius: 2,
        dx: (r, i) => -flipped(r, i) * 2, dw: (r, i) => flipped(r, i) * 4,
        alpha: (r) => {
          let a = 1;
          if (recent > 0 && last === 0) a = spotlight(recent, r.n < HORIZON);
          if (named > 0) a = Math.min(a, spotlight(named, r.y0 === 2000 || r.y0 === 2007));
          if (D.mode === "nominal" && last > 0) a = spotlight(last, r.n === HORIZON && r.status === "fail");
          return a;
        },
        hover: (r, i) => hvBox(`Retired ${r.y0}`, `${D.unit}; $80,000 is 8%, $40,000 is 4%`, [["At 8%", outcome(r)], ["At 4%", outcome(D.four[i])]]),
      });
      if (named > 0) [2000, 2007].forEach((y) => {
        const r = D.all[y - FROM], x = A.X(y) + bw / 2 + 1.5, top = A.Y(Math.min(r.years, HORIZON));
        callout(x, top - 8, top - 54 + (1 - named) * 16, `${y}: out by ${y + Math.ceil(r.years) - 1}`, { fade: named, align: "center" });
      });
      const c = (label, value, color) => counter(1440, 160, label, value, { align: "right", size: 40, color });
      alpha(q.span(1, 0, 0.8) * (1 - recent), () => c(`LASTED 30 YEARS AT 8%`, countTo(t, q(1), D.okCount, ofN(D.done.length)), C.blue));
      alpha(recent * (1 - last), () => c(`RETIRED ${D.recent[0].y0} OR LATER: ALREADY OUT`, countTo(t, q(2), D.recentFails.length, ofN(D.recent.length)), C.danger));
      // the count climbs with the bars as they morph to 4%
      if (D.mode === "real") alpha(last, () => c(morph > 0.5 ? "AT 4%: LASTED 30 YEARS" : "LASTED 30 YEARS AT 8%", ofN(D.done.length)(lerp(D.okCount, D.fourOk, morph)), C.blue));
      else alpha(last, () => {
        const f = D.done.filter((r) => r.status === "fail");
        c("FULL-LENGTH FAILURES", f.map((r) => r.y0).join(", "), C.danger);
      });
    }
    both("every", every);

    // 6b. An inheritance for the grandchildren? What each full 30-year retirement left behind
    function inheritance(t, q, D) {
      const ends = (wr) => D.done.map((r) => {
        const x = wr === WR ? r : retire(r.y0, D.mode, wr);
        return { y0: r.y0, end: x.status === "fail" ? 0 : x.end };
      });
      const at8 = ends(WR), at4 = ends(0.04);
      // plain dollars: what the leftover would buy at retirement-day prices
      const buys = at8.map((e) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(e.y0 + k)]; return { y0: e.y0, end: e.end / p }; });
      // the bars morph during line 3 (4%) or line 2 (retirement-day buying power)
      const morph = q.span(D.pick(3, 2), D.pick(0.4, 5.0), D.pick(2.8, 7.4));
      const target = D.pick(at4, buys);
      // plain dollars rescale when the bars shrink to retirement-day buying power
      const top = D.pick(8e6, lerp(25e6, 8e6, morph)), step = D.mode === "real" || morph > 0.5 ? 2e6 : 5e6;
      const A = chartFrame({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [D.done[0].y0, D.done[D.done.length - 1].y0 + 1], dy: [0, top], fade: q.span(1, 0, 0.6),
        yTicks: ticksTo(top, step).filter((v) => v <= top + 1), xTicks: [1945, 1955, 1965, 1975, 1985, 1995], xTitle: "Year of retirement",
        title: D.pick(`Left after 30 years, ${D.unit}`, morph > 0.5 ? "Left after 30 years, in retirement-day buying power" : "Left after 30 years, plain dollars") });
      // the verse, then the chart
      const verse = 1 - q.span(1, -0.2, 0.4);
      if (verse > 0) {
        words("“A good man leaves an inheritance", 800, 380, t, 2.8, { size: 52, align: "center", a: verse, hi: ["inheritance"], hiColor: C.blue, gap: 0.16 });
        words("to his children's children.”", 800, 450, t, 4.0, { size: 52, align: "center", a: verse, gap: 0.16 });
        alpha(span(t, 0.6, 1.2) * verse, () => text("Proverbs 13:22", 800, 520, { size: 26, color: C.muted, align: "center" }));
      }
      const grow = q.sweep(1, 0.4, 2, -0.4);
      const sort = q.span(2, 0, 0.8);
      const left = (v) => (v > 0 ? dollars(v) : "nothing");
      // a retirement that left nothing gets a red ✕ on the baseline instead of a bar
      barSeries(A, at8, {
        x: (e) => e.y0, value: (e, i) => lerp(e.end, target[i].end, morph), clamp: [-Infinity, top], grow, stagger: 5,
        color: (e, i, v) => (v <= 0 ? C.danger : v < START ? C.fire : C.blue),
        alpha: (e) => (D.mode === "real" && sort > 0 && morph === 0 ? spotlight(sort, e.end < START) : 1),
        after: (e, i, g) => {
          if (g.v > 0) return;
          zoomAt(g.cx, A.Y(0) - 10, backOut(g.p), () => { ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.lineCap = "round"; const cx = g.cx, cy = A.Y(0) - 10; ctx.beginPath(); ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6); ctx.stroke(); });
        },
        hover: (e, i) => hvBox(`Retired ${e.y0}`, "what was left after 30 years", D.pick(
          [["At 8%, today's dollars", left(e.end)], ["At 4%, today's dollars", left(target[i].end)]],
          [["At 8%, plain dollars", left(e.end)], ["In retirement-day dollars", e.end > 0 ? dollars(target[i].end) : "nothing"]])),
      });
      alpha(q.span(1, 0.6, 1.2), () => {
        line(A.x0, A.Y(START), A.x1, A.Y(START), C.ink, 2, [8, 6]);
        const lab = "What they started with: $1M";
        font(ctx, 19, 700);
        const w = ctx.measureText(lab).width + 14;
        ctx.fillStyle = rgba(C.sunken, 0.9); ctx.fillRect(A.x1 - w, A.Y(START) - 32, w, 26);
        text(lab, A.x1 - 7, A.Y(START) - 13, { size: 19, weight: 700, align: "right" });
      });
      alpha(q.span(1, 0, 0.6), () => legend(A.x0, 150, [[C.blue, "Left $1M or more", "dot"], [C.fire, "Left less than $1M", "dot"], [C.danger, "Left nothing", "dot"]]));
      // the biggest inheritance on screen gets a label once every bar is up
      if (grow >= 1) {
        const vals = at8.map((e, i) => lerp(e.end, target[i].end, morph)), mi = vals.indexOf(Math.max(...vals));
        const bwm = A.X(1) - A.X(0) - 4;
        text(`${at8[mi].y0}: ${money(vals[mi])}`, A.X(at8[mi].y0) + 2 + bwm / 2, A.Y(Math.min(vals[mi], top)) - 10, { size: 18, weight: 700, align: "center" });
      }
      const count = (arr) => [arr.filter((e) => e.end <= 0).length, arr.filter((e) => e.end > 0 && e.end < START).length];
      const [z8, u8] = count(at8), [zT, uT] = count(target);
      // the counts run with the bars as they morph
      const zero = countTo(t, q(2), lerp(z8, zT, morph)), under = countTo(t, q(2), lerp(u8, uT, morph));
      alpha(sort, () => {
        const label = morph > 0.5 ? (D.pick("AT 4%: LEFT NOTHING", "IN RETIREMENT-DAY BUYING POWER")) : "AT 8%: LEFT NOTHING";
        if (D.mode === "nominal" && morph > 0.5) counter(1440, 160, label, `${zero + under} of ${at8.length} below $1M`, { align: "right", size: 40, color: C.fire });
        else counter(1440, 160, label, `${zero} of ${at8.length}`, { align: "right", size: 40, color: C.danger });
        if (!(D.mode === "nominal" && morph > 0.5)) text(`Less than $1M: ${under}`, 1440, 196, { size: 22, weight: 600, color: C.muted, align: "right" });
      });
    }
    both("inheritance", inheritance);

    // 6c. Another way to read 8%: take 8% of whatever is there at the start of each year, so the
    // first check is exactly $80,000 and later checks move with the market
    function pctRun(y0, mode, wr = WR) {
      let B = START, prices = 1;
      const checks = [], bal = [B], rows = [];
      for (let k = 0; k < HORIZON && y0 + k <= H.last; k++) {
        const y = y0 + k, w = wr * B, unit = mode === "real" ? 1 / prices : 1;
        const start = B * unit, check = w * unit, invested = (B - w) * unit;
        checks.push(check);
        B = (B - w) * (1 + H.stocks[idx(y)]);
        prices *= 1 + H.infl[idx(y)];
        const end = mode === "real" ? B / prices : B;
        bal.push(end);
        rows.push({ y, start, check, invested, ret: H.stocks[idx(y)], infl: H.infl[idx(y)], end });
      }
      return { y0, checks, bal, rows };
    }
    function rowHtml(row, mode) {
      const unit = mode === "real" ? `today's dollars (${TODAY})` : "plain dollars";
      return `<b>${row.y}</b><span class="hv-unit">${unit}</span>` +
        `<div class="hv-row"><span>Balance on January 1</span><b>${dollars(row.start)}</b></div>` +
        `<div class="hv-row"><span>Check taken (8%)</span><b>−${dollars(row.check)}</b></div>` +
        `<div class="hv-row"><span>Left invested</span><b>${dollars(row.invested)}</b></div>` +
        `<div class="hv-row"><span>Stocks that year</span><b>${spct(row.ret)}</b></div>` +
        (mode === "real" ? `<div class="hv-row"><span>Prices that year</span><b>${spct(row.infl)}</b></div>` : "") +
        `<div class="hv-row hv-total"><span>Balance next January</span><b>${dollars(row.end)}</b></div>`;
    }
    function percent(t, q, D) {
      const r = pctRun(2000, D.mode), y0 = 2000, n = r.checks.length;
      const A = axes({ x0: 200, x1: 1440, y0: 230, y1: 700, dx: [y0, y0 + n], dy: [0, 100e3] });
      // the first two years, step by step (line 2), then the rest of the bars
      // one step per ledger row, timed to where the narrator says it
      const L = q(2), steps = D.pick([2.6, 4.6, 8.4, 10.2, 15.0, 20.4], [2.7, 4.6, 8.5, 10.6, 13.0, 17.9]);
      const at = (i) => span(t, L + steps[i], L + steps[i] + 0.5);
      const roll = (i, v) => v * tally(t, L + steps[i], 0.8);
      const r0 = r.rows[0], r1 = r.rows[1];
      const bw = A.X(1) - A.X(0) - 6;
      const first = r.checks[0], low = Math.min(...r.checks), lowI = r.checks.indexOf(low);
      // camera: push in on the first two bars while the ledger builds, pull back for the rest
      const cam = span(t, L + 1.4, L + 3.0) * (1 - q.span(3, -0.3, 1.4));
      // spotlight on the post-crash check while the narrator names it
      const spot = q.window(3, 3.5, 4.1, 4, -0.2, 0.6);
      const sweep = q.sweep(3, 0.2, 4, 2.0);
      const prog = (i) => (i === 0 ? lin(t, L + steps[1], L + steps[1] + 0.7) : i === 1 ? lin(t, L + steps[5], L + steps[5] + 0.7) : stag(sweep, i - 2, n - 2, 3));

      zoomAt(A.x0 - 30, A.y1 - 40, 1 + 0.5 * cam, () => {
        alpha(q.span(1, 0, 0.6), () => {
          yGrid(A, [0, 25e3, 50e3, 75e3], moneyTick);
          alpha(1 - cam, () => yGrid(A, [100e3], moneyTick)); // would run into the chapter label when zoomed
          xLabels(A, [2000, 2005, 2010, 2015, 2020, 2025], (v) => v);
          alpha(1 - cam, () => text(`Retired January 2000: each year's check, ${D.unit}`, A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted }));
          line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
          text("The plan: $80,000", A.X(2004), A.Y(80e3) - 10, { size: 19, weight: 700 });
        });
        barSeries(A, r.checks, { x: (c, i) => y0 + i, value: (c) => c, pad: 3, progress: (c, i) => prog(i),
          color: (c) => (c < 40e3 ? C.danger : c < 60e3 ? C.fire : C.blue), alpha: (c, i) => spotlight(spot, i === lowI),
          hover: (c, i) => rowHtml(r.rows[i], D.mode) });
        alpha(at(1), () => text(`2000: ${money(first)}`, A.X(y0) + 3, A.Y(first) - 12, { size: 21, weight: 700 }));
        alpha(span(t, L + steps[5] + 0.3, L + steps[5] + 0.8) * cam, () => text(`2001: ${money(r.checks[1])}`, A.X(y0 + 1) + 3, A.Y(r.checks[1]) - 12, { size: 21, weight: 700 }));
        callout(A.X(y0 + lowI) + bw / 2 + 3, A.Y(low) - 4, A.Y(66e3), `${y0 + lowI}, after the 2008 crash: ${money(low)}, down ${Math.round((1 - low / r.checks[lowI - 1]) * 100)}%`,
          { gap: 8, grow: q.span(3, 3.5, 4.0), dx: -6, fade: q.span(3, 3.5, 4.1) });
        alpha(q.span(4, 2.0, 2.6), () => {
          const after = r.checks.slice(lowI);
          text(D.pick(`${y0 + lowI}–${y0 + n - 1}: never above ${money(Math.max(...after))}`, `${y0 + n - 1}: only back to ${money(r.checks[n - 1])}`),
            A.X(y0 + n) - 4, A.Y(D.pick(Math.max(...after), r.checks[n - 1])) - 40, { size: 21, weight: 700, align: "right" });
        });
      });
      // the idea, before the chart
      const idea = 1 - q.span(1, -0.2, 0.4);
      if (idea > 0) {
        words("Take 8% of whatever is there,", 800, 400, t, 0.4, { size: 52, align: "center", a: idea, hi: ["8%"] });
        words("every year.", 800, 470, t, 1.4, { size: 52, align: "center", a: idea, color: C.fire });
      }
      const box = 1 - q.span(3, -0.2, 0.4);
      const boxIn = lin(t, L, L + 0.6);
      ledger({ x: 720, y: 250, w: 700, appear: boxIn, fade: box, reveal: at, rows: [
        { label: "January 2000: the nest egg", value: dollars(roll(0, r0.start)), color: C.ink },
        { label: "Take 8%: the first check", value: "−" + dollars(roll(1, r0.check)), color: C.fire },
        { label: "Left invested for the year", value: dollars(roll(2, r0.invested)), color: C.ink },
        { label: D.pick(`2000: stocks ${spct(r0.ret)}, prices ${spct(r0.infl)}`, `2000: stocks ${spct(r0.ret)}`), color: C.danger, strong: true },
        { label: D.pick("January 2001, in today's dollars", "January 2001"), value: dollars(roll(4, r0.end)), color: C.ink },
        { label: "Take 8%: the second check", value: "−" + dollars(roll(5, r1.check)), color: C.fire },
      ] });
      pill(800, 790, `Never runs out: ${money(r.bal[r.bal.length - 1])} left in ${y0 + n - 1}`, "neutral", q.window(1, 1.0, 1.6, 2, 0, 0.4) + q.span(3, 0, 0.6));
      alpha(q.span(3, 0.4, 1.0), () => text("Point at any bar for that year's money movements", A.x1, A.y0 - 34, { size: 18, color: C.muted, align: "right" }));
    }
    both("percent", percent);

    function percentEvery(t, q, D) {
      const runs = SETS[D.mode].done.map((r) => pctRun(r.y0, D.mode));
      const lean = runs.map((r) => ({ y0: r.y0, v: Math.min(...r.checks) }));
      const bar1 = D.pick(40e3, 60e3); // the threshold the narration counts
      const top = Math.ceil(Math.max(100e3, Math.max(...lean.map((e) => e.v)) * 1.05) / 25e3) * 25e3;
      const A = chartFrame({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [runs[0].y0, runs[runs.length - 1].y0 + 1], dy: [0, top], yTicks: ticksTo(top, 25e3),
        xTicks: [1945, 1955, 1965, 1975, 1985, 1995], xTitle: "Year of retirement", title: `Leanest year's check, taking 8% of what's left, ${D.unit}` });
      line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
      text("The plan: $80,000", A.x1, A.Y(80e3) - 10, { size: 19, weight: 700, align: "right" });
      const bw = A.X(1) - A.X(0) - 4;
      const grow = lin(t, 0.4, q(1) - 0.3);
      const thr = q.span(2, 0, 0.8);
      const worst = lean.reduce((a, e) => (e.v < a.v ? e : a));
      // spotlight on the worst retiree when the narrator names it
      const spot = q.window(2, 5.0, 5.6, 3, -0.2, 0.6);
      barSeries(A, lean, {
        x: (e) => e.y0, value: (e) => e.v, grow, stagger: 5, color: (e) => (e.v < bar1 ? C.danger : C.blue),
        alpha: (e) => Math.min(spotlight(thr, e.v < bar1), spotlight(spot, e === worst)),
        hover: (e, i) => {
          const run = runs[i], checks = run.checks, most = Math.max(...checks);
          return hvBox(`Retired January ${e.y0}`, D.unit, [
            [`First check (${e.y0})`, dollars(checks[0])],
            [`Leanest check (${e.y0 + checks.indexOf(e.v)})`, dollars(e.v)],
            [`Largest check (${e.y0 + checks.indexOf(most)})`, dollars(most)],
            [`Last check (${e.y0 + checks.length - 1})`, dollars(checks[checks.length - 1])],
            ["Left after 30 years", dollars(run.bal[run.bal.length - 1]), true],
          ]);
        },
      });
      const sorted = lean.map((e) => e.v).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      alpha(q.span(1, 0, 0.8) * (1 - thr), () => {
        line(A.x0, A.Y(med), A.x1, A.Y(med), C.fire, 2.5, [4, 6]);
        counter(1440, 160, "TYPICAL LEANEST YEAR", countTo(t, q(1), med, money), { align: "right", size: 40, color: C.fire });
      });
      alpha(thr, () => {
        line(A.x0, A.Y(bar1), A.x1, A.Y(bar1), C.danger, 2, [4, 6]);
        counter(1440, 160, `A YEAR BELOW ${money(bar1)}`, countTo(t, q(2), lean.filter((e) => e.v < bar1).length, ofN(lean.length)), { align: "right", size: 40, color: C.danger });
        text(`Worst: ${worst.y0}, ${money(worst.v)}`, 1440, 196, { size: 22, weight: 600, color: C.muted, align: "right" });
      });
      if (spot > 0) callout(A.X(worst.y0) + 2 + bw / 2, A.Y(worst.v) - 6, A.Y(bar1 + 22e3), `${worst.y0}: ${money(worst.v)}`,
        { grow: spot, fade: spot, size: 26, fam: "display", align: "center" });
      words(D.pick("The money lasts. The lifestyle doesn't.", "The money lasts. The paycheck swings."), 800, 160, t, q(3), { size: 34, align: "center", hi: ["doesn't.", "swings."], hiColor: C.danger });
    }
    both("percent-every", percentEvery);

    // 7a. Why the first years matter: the withdrawal as a share of what's left
    SCENES.why = function (t, q) {
      const r = retire(2000, "real"), yrs = r.rate.slice(0, 9);
      const A = chartFrame({ x0: 240, x1: 1360, y0: 200, y1: 700, dx: [2000, 2009], dy: [0, 0.8], yTicks: [0, 0.2, 0.4, 0.6, 0.8],
        yFmt: (v) => Math.round(v * 100) + "%", xTicks: [2000, 2002, 2004, 2006, 2008], title: "This year's $80,000 as a share of the balance" });
      // the last line is about the crash year: everything else steps back
      const spot = q.span(2, 0, 0.8);
      barSeries(A, yrs, {
        x: (v, i) => 2000 + i, value: (v) => v, clamp: [0, 0.8], pad: 12, radius: 6, grow: q.sweep(1, 0.2, 2, -0.4), stagger: 1.5,
        color: (v) => (v > 0.5 ? C.danger : v > 0.15 ? C.fire : C.blue), alpha: (v, i) => spotlight(spot, i === 8),
        // the share, counting up as its bar grows, on the years the narration names
        after: (v, i, g) => {
          if ([0, 2, 6, 8].includes(i)) text(`${Math.round(v * 100 * easeOut(g.p))}%`, g.cx, A.Y(Math.min(v, 0.8) * backOut(g.p)) - 12, { size: i === 8 ? 30 : 24, weight: 700, fam: i === 8 ? "display" : "body", align: "center", color: i === 8 ? C.danger : C.ink });
        },
        hover: (v, i) => hvBox(`${2000 + i}`, "retired January 2000, today's dollars", [
          ["Balance at year end, before the check", dollars(80e3 / v)],
          ["The check", "$80,000"],
          ["Share of the balance", pct(v, 0), true],
        ]),
      });
      const intro = 1 - q.span(1, 0, 0.4);
      if (intro > 0) words("A bigger bite out of a smaller pile", 800, 450, t, 0.4, { size: 44, align: "center", a: intro, hi: ["bigger", "smaller"] });
      words("Spent after a crash, it isn't there for the recovery.", 1360, 150, t, q(2), { size: 28, align: "right", gap: 0.08, hi: ["crash,"], hiColor: C.danger });
    };

    // 7b. The hidden cost of a flat check
    SCENES["hidden-cost"] = function (t, q) {
      const y0 = 1982, buys = [];
      let p = 1;
      for (let k = 0; k < HORIZON; k++) { p *= 1 + H.infl[idx(y0 + k)]; buys.push(WR * START / p); }
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 680, dx: [y0, y0 + HORIZON], dy: [0, 100e3], yTicks: [0, 25e3, 50e3, 75e3, 100e3],
        xTicks: [1985, 1990, 1995, 2000, 2005, 2010], title: "Retired in 1982: each year's $80,000 check, and what it bought in 1982 dollars" });
      const bw = A.X(1) - A.X(0) - 6;
      barSeries(A, buys, {
        x: (v, k) => y0 + k, value: (v) => v, color: () => C.blue, pad: 3, grow: lin(t, 0.4, q(1) + 8.0), stagger: 2,
        // the $80,000 check, outlined, behind what it bought
        before: (v, k, g) => alpha(ease(g.p), () => { ctx.strokeStyle = rgba(C.fire, 0.7); ctx.lineWidth = 2; ctx.strokeRect(g.x, A.Y(WR * START), g.w, A.Y(0) - A.Y(WR * START)); }),
        // what the check bought at the start and every ten years after (the 30th has its own label)
        after: (v, k, g) => { if (k === 0 || k === 9 || k === 19) alpha(span(g.p, 0.6, 1), () => text(`${y0 + k}: ${money(v)}`, k ? g.cx : g.x, g.end - 12, { size: 18, weight: 700, align: k ? "center" : "left" })); },
        hover: (v, k) => hvBox(`${y0 + k}`, `year ${k + 1} of retirement`, [
          ["The check", "$80,000"],
          ["Prices since January 1982", `+${Math.round((WR * START / v - 1) * 100)}%`],
          ["What it bought, in 1982 dollars", dollars(v), true],
        ]),
      });
      legend(A.x0, A.y1 + 70, [[C.fire, "The check: $80,000"], [C.blue, "What it bought, in 1982 dollars"]]);
      alpha(q.span(1, 8.0, 8.8), () => {
        const v = buys[HORIZON - 1];
        text(`${y0 + HORIZON - 1}: ${money(v)}`, A.X(y0 + HORIZON - 1) + bw / 2 + 3, A.Y(v) - 14, { size: 24, weight: 700, align: "center" });
      });
      alpha(q.span(2, 0, 0.8), () => {
        const lastBuys = SETS.nominal.done.map((r) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(r.y0 + k)]; return WR * START / p; });
        counter(1440, 160, "THE 30TH CHECK, EVERY RETIREMENT SINCE 1945", `${money(Math.min(...lastBuys))}–${money(Math.max(...lastBuys))}`, { align: "right", size: 40, color: C.blue });
      });
    };

    // 8. What history says
    function takeaway(t, q, D) {
      const card = (cx, title, value, sub, color, progress) => statCard({ cx, title, value, sub, color, progress });
      const of = (v, n) => (p) => `${Math.round(v * p)} of ${n}`;
      if (D.mode === "real") {
        card(520, "8%: $80,000 of buying power", of(D.okCount, D.done.length), "30-year retirements since 1945 that lasted", C.danger, lin(t, 0.4, 1.6));
        card(1080, "4%: $40,000 of buying power", of(D.fourOk, D.done.length), "30-year retirements since 1945 that lasted", C.blue, q.lin(1, 0, 1.2));
      } else {
        card(520, "8%: the same $80,000 check", of(D.okCount, D.done.length), "lasted 30 years, on paper", C.blue, lin(t, 0.4, 1.6));
        const lastBuys = D.done.map((r) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(r.y0 + k)]; return WR * START / p; });
        card(1080, "What the 30th check bought", (p) => `${money(80e3 - (80e3 - Math.min(...lastBuys)) * p)}–${money(80e3 - (80e3 - Math.max(...lastBuys)) * p)}`, "in retirement-day dollars", C.fire, q.lin(1, 0, 1.2));
      }
      words("The long-run average doesn't pay your bills.", 800, 600, t, q(2), { size: 44, align: "center", gap: 0.13 });
      words("The order of the years decides.", 800, 670, t, q(2) + 1.6, { size: 44, align: "center", color: C.blue, gap: 0.16 });
      alpha(q.span(2, 3.0, 3.8), () => text("Historical simulation, 100% stocks, no fees or taxes. Not financial advice.", 800, 780, { size: 20, color: C.muted, align: "center" }));
    }
    both("takeaway", takeaway);

    return { scenes: SCENES, forkAfter: "ramsey-world", forkShow: (s) => s.cues[3].start + 9.5 };
  });
})();
