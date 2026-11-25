// Explainer 2: the data and scenes. The player and drawing toolkit live in ../kit/explainer-kit.js.
(function () {
  "use strict";
  const H = window.HIST;
  ExplainerKit((K) => {
    const { C, ctx, rgba, clamp, span, lin, lerp, backOut, stag, pct, spct, money, dollars, font, text, alpha, dot, line, bar, zoomAt, glow, words, shake, flash, pill, counter, axes, xLabels, legend, hvBox, spotlight, countTo, ofN, ticksTo, chartFrame, barSeries, lineSeries, columnHovers, titleCard, twoTracks } = K;

    // ---------- data ----------
    const idx = (y) => y - H.first;
    const YEARS = 39, CONTRIB = 2000, GEN = 25, FROM = 1945; // Ramsey's Arthur: $2,000 a year, ages 27 through 65; windows from 1945 on
    const AGE0 = 27;
    const NOMINAL = H.stocks.slice();
    const REAL = H.stocks.map((s, i) => (1 + s) / (1 + H.infl[i]) - 1);
    const spanRate = (arr, a, b) => { let g = 1; for (let y = a; y <= b; y++) g *= 1 + arr[idx(y)]; return Math.pow(g, 1 / (b - a + 1)) - 1; };
    const niceMax = (v, step) => Math.ceil(v / step) * step;
    const tickStep = (top) => (top > 2e6 ? 500e3 : top > 1e6 ? 250e3 : top > 400e3 ? 100e3 : 50e3);

    // Two ways of counting. "real": deposits keep $2,000 of today's buying power and balances are in
    // today's dollars. "nominal": a flat $2,000 a year and balances as the statement showed them.
    function buildSet(mode) {
      const rets = mode === "real" ? REAL : NOMINAL;
      // p[k] = balance at the start of year y0+k (after k years); deposits at the start of each year
      const grow = (y0, rate) => {
        let B = 0; const p = [0];
        for (let k = 0; k < YEARS; k++) { B = (B + CONTRIB) * (1 + (rate == null ? rets[idx(y0 + k)] : rate)); p.push(B); }
        return p;
      };
      const WINDOWS = [];
      for (let y = FROM; y + YEARS - 1 <= H.last; y++) { const p = grow(y); WINDOWS.push({ y, p, v: p[YEARS] }); }
      const win = (y) => WINDOWS.find((w) => w.y === y);
      const PAIRS = WINDOWS.filter((w) => win(w.y + GEN)).map((w) => {
        const s = win(w.y + GEN);
        return { y: w.y, f: w.v, s: s.v, gap: s.v >= w.v ? s.v / w.v - 1 : -(w.v / s.v - 1) };
      });
      const proj = grow(0, mode === "real" ? 1.12 / 1.04 - 1 : 0.12)[YEARS];
      return {
        mode, rets, grow, WINDOWS, win, PAIRS, proj,
        // the today's-dollars or plain-dollars version of anything that differs between the two
        pick: (real, plain) => (mode === "real" ? real : plain),
        stake: (y0) => grow(y0).slice(0, YEARS).map((v) => v + CONTRIB),
        sonAhead: PAIRS.filter((p) => p.gap > 0).length,
        fatherAhead: PAIRS.filter((p) => p.gap < 0).length,
        quarter: PAIRS.filter((p) => Math.abs(p.gap) >= 0.25).length,
        worst: WINDOWS.reduce((a, w) => (w.v < a.v ? w : a)),
        best: WINDOWS.reduce((a, w) => (w.v > a.v ? w : a)),
        biggest: PAIRS.reduce((a, p) => (Math.abs(p.gap) > Math.abs(a.gap) ? p : a)),
        reached: WINDOWS.filter((w) => w.v >= proj).length,
        projLabel: mode === "real" ? "Ramsey's 12% − 4% inflation" : "Ramsey's 12% a year",
        unit: mode === "real" ? `today's dollars (${TODAY})` : "plain dollars",
      };
    }
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    // "today" for inflation-adjusted figures: the latest month of Shiller's price data
    const TODAY = `${MONTH_NAMES[H.capeNow.month - 1]} ${H.capeNow.year}`;
    const SETS = { real: buildSet("real"), nominal: buildSet("nominal") };
    // what a deposit worth $2,000 at today's prices was in the dollars of its own January
    const deposit = (y) => CONTRIB * H.cpiJan[idx(y)] / H.capeNow.cpi;
    // the last stretch (2022 on) is shaded but not labelled: too short to call an era
    const ERAS = [[1966, 1982, "flat"], [1983, 1999, "boom"], [2000, 2008, "flat"], [2009, 2021, "boom"], [2022, H.last, "rest"]];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function avatar(x, y, r, letter, color, a) {
      if (a <= 0) return;
      zoomAt(x, y, lerp(0.4, 1, backOut(a)), () => alpha(a, () => {
        dot(x, y, r, color);
        text(letter, x, y + r * 0.36, { size: r * 1.05, weight: 700, fam: "display", align: "center", color: C.sunken });
      }));
    }
    const rateText = (r) => (Math.abs(r) < 0.0005 ? "0.0%" : spct(r));
    // calendar eras behind a chart; plain-dollar charts also show what prices did
    function eras(A, a, D) {
      alpha(a, () => ERAS.forEach(([s, e, kind]) => {
        if (e + 1 < A.dx[0] || s > A.dx[1]) return;
        const x0 = A.X(Math.max(s, A.dx[0])), x1 = A.X(Math.min(e + 1, A.dx[1]));
        ctx.fillStyle = kind === "boom" ? rgba(C.blue, 0.10) : rgba(C.muted, 0.12);
        ctx.fillRect(x0, A.y0, x1 - x0, A.y1 - A.y0);
        if (kind === "rest") return;
        const cx = (x0 + x1) / 2;
        text(`${s}–${e}`, cx, A.y0 + 24, { size: 18, weight: 700, color: C.muted, align: "center" });
        text(`${rateText(spanRate(D.rets, s, e))} a year`, cx, A.y0 + 46, { size: 18, color: C.muted, align: "center" });
        if (D.mode === "nominal") text(`prices ${rateText(spanRate(H.infl, s, e))}`, cx, A.y0 + 68, { size: 16, color: C.muted, align: "center" });
      }));
    }
    function ramseyLine(A, D, a, label) {
      alpha(a, () => {
        line(A.x0, A.Y(D.proj), A.x1, A.Y(D.proj), C.fire, 2.5, [10, 6]);
        const lab = label || `${D.projLabel}: ${money(D.proj)}`;
        font(ctx, 22, 700);
        ctx.fillStyle = rgba(C.sunken, 0.85); ctx.fillRect(A.x0 + 4, A.Y(D.proj) - 36, ctx.measureText(lab).width + 14, 30);
        text(lab, A.x0 + 10, A.Y(D.proj) - 13, { size: 22, weight: 700, color: C.fire });
      });
    }

    const SCENES = {};
    const both = twoTracks(SCENES, SETS); // one draw function, registered for both ways of counting

    // 1. Ben and Arthur
    SCENES.family = function (t, q) {
      const people = [[520, 250, 70, "B", "Ben", "the father", C.blue], [1080, 262, 56, "A", "Arthur", "his son", C.fire]];
      people.forEach(([x, y, r, l, name, tag, col], i) => {
        const a = lin(t, 0.4 + i * 0.5, 1.1 + i * 0.5);
        avatar(x, y, r, l, col, a);
        alpha(a, () => text(name, x, 375, { size: 40, weight: 700, fam: "display", align: "center" }));
        alpha(span(t, q(1) + 0.4 + i * 1.2, q(1) + 1.0 + i * 1.2), () => text(tag, x, 412, { size: 24, color: C.muted, align: "center" }));
      });
      const x0 = 170, cell = 20, gapY = 80;
      const fill = q.lin(2, 0.2, 4.0);
      const shift = q.span(3, 1.6, 4.0);
      alpha(q.span(2, 0, 0.5), () => {
        alpha(1 - shift, () => {
          text(`Age ${AGE0}`, x0, 500, { size: 20, color: C.muted });
          text(`Age ${AGE0 + YEARS - 1}`, x0 + YEARS * cell, 500, { size: 20, color: C.muted, align: "right" });
          text("$2,000 a year each", x0 + YEARS / 2 * cell, 500, { size: 20, weight: 600, align: "center" });
        });
        alpha(shift, () => {
          text("Ben starts", x0, 500, { size: 20, color: C.muted });
          text("Arthur starts", x0 + GEN * cell, 500, { size: 20, color: C.muted });
          text("Arthur retires", x0 + (GEN + YEARS) * cell, 500, { size: 20, color: C.muted, align: "right" });
        });
      });
      [[0, C.blue, "Ben"], [1, C.fire, "Arthur"]].forEach(([r, col, name]) => {
        const off = r === 1 ? shift * GEN * cell : 0, y = 540 + r * gapY;
        if (fill > 0) text(name, x0 - 18, y + 28, { size: 22, weight: 600, align: "right" });
        for (let k = 0; k < YEARS; k++) {
          const p = stag(fill, k, YEARS, 3);
          if (p <= 0) break;
          const cx = x0 + off + k * cell + cell / 2;
          zoomAt(cx, y + 23, backOut(p), () => { ctx.beginPath(); ctx.roundRect(cx - cell / 2 + 2, y + 8, cell - 4, 30, 3); ctx.fillStyle = col; ctx.fill(); });
        }
      });
      alpha(shift, () => {
        ctx.fillStyle = rgba(C.ink, 0.07); ctx.fillRect(x0 + GEN * cell, 535, (YEARS - GEN) * cell, gapY + 52);
        text(`${YEARS - GEN} years in common`, x0 + (GEN + (YEARS - GEN) / 2) * cell, 790, { size: 22, weight: 600, align: "center" });
      });
    };

    // 2. In a twelve percent world (plain dollars, like Ramsey's chart), then the fork
    SCENES.steady = function (t, q) {
      const D = SETS.nominal, steady = D.grow(0, 0.12);
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 660, dx: [0, GEN + YEARS], dy: [0, 2e6],
        yTicks: [0, 500e3, 1e6, 1.5e6, 2e6], xTicks: [0, 10, 20, 30, 40, 50, 60], xFmt: (v) => `year ${v + 1}` });
      legend(A.x0, 150, [[C.blue, "Ben"], [C.fire, `Arthur, ${GEN} years later`]]);
      const f = lin(t, 0.6, q(1) + 1.0), now = f * (GEN + YEARS);
      lineSeries(A, steady.map((v, k) => [k, v]), { progress: clamp(now / YEARS), color: C.blue, glow: now > 0, t });
      lineSeries(A, steady.map((v, k) => [k + GEN, v]), { progress: clamp((now - GEN) / YEARS), color: C.fire, glow: now > GEN, t });
      // each one's balance every ten years, as his line passes: the curve is slow, then steep
      [[0, C.blue], [GEN, C.fire]].forEach(([start, color]) => [10, 20, 30].forEach((k) => alpha(span(now, start + k, start + k + 1.5), () => {
        dot(A.X(start + k), A.Y(steady[k]), 4, color);
        text(money(steady[k]), A.X(start + k) - 8, A.Y(steady[k]) - 12, { size: 18, weight: 700, align: "right" });
      })));
      // each year on hover: where both of them stand
      const reached = []; for (let k = 1; k <= Math.min(now, GEN + YEARS); k++) reached.push(k);
      columnHovers(A, reached, (k) => hvBox(`After ${k} year${k > 1 ? "s" : ""}`, "+12% every year, $2,000 deposited each January", [
        k <= YEARS && [`Ben, age ${AGE0 + k - 1}`, dollars(steady[k])],
        k > YEARS && ["Ben", "retired"],
        k > GEN && [`Arthur, age ${AGE0 + k - GEN - 1}`, dollars(steady[k - GEN])],
        k <= GEN && ["Arthur", "not started yet"],
      ]), { mark: "line" });
      alpha(q.span(1, 0.6, 1.4), () => {
        text(`Both retire with ${countTo(t, q.at(1, 0.6), steady[YEARS], money, 1.2)}`, A.X(GEN + YEARS) - 10, A.Y(steady[YEARS]) - 30, { size: 28, weight: 700, fam: "display", align: "right" });
        text("+12% every year, $2,000 a year", A.X(1), A.Y(1.8e6), { size: 22, color: C.muted });
      });
    };

    // track intros: how this track counts, and Ramsey's target in those terms
    both(["real-intro", "nominal-intro"], (t, q, D) => {
      titleCard(t, { title: D.pick(`Today's dollars: ${TODAY}`, "Plain dollars"), color: D.pick(C.blue, C.fire), lines: D.pick(
        [`“Today” means ${TODAY} prices.`, `Each deposit buys what $2,000 bought in ${TODAY}.`, "Every balance is shown in those same dollars."],
        ["Exactly $2,000 a year, every year.", "Every balance is what the statement said."]) });
      alpha(q.span(1, 0, 0.8), () => {
        text(D.projLabel, 800, 560, { size: 30, weight: 600, align: "center", color: C.muted });
        zoomAt(800, 625, lerp(0.7, 1, backOut(q.lin(1, 0.3, 1.1))), () =>
          text(countTo(t, q.at(1, 0.3), D.proj, money, 1.5), 800, 660, { size: 104, weight: 700, fam: "display", align: "center", color: C.fire }));
        text(`after ${YEARS} years of $2,000 a year, like Arthur in Ramsey's chart`, 800, 720, { size: 24, color: C.muted, align: "center" });
      });
    });

    // a father and son, drawn by calendar year
    function familyChart(t, D, y0, o) {
      const ben = D.win(y0), art = D.win(y0 + GEN), end = y0 + GEN + YEARS;
      const raw = Math.max(Math.max(...ben.p, ...art.p) * 1.12, o.projAt != null ? D.proj * 1.3 : 0);
      const step = tickStep(raw), top = niceMax(raw, step);
      const now = lerp(y0, y0 + YEARS, lin(t, o.benFrom, o.benTo)) + lin(t, o.artFrom, o.artTo) * GEN;
      // when the drawing reaches calendar year Y (Ben's pass covers his window, Arthur's the rest)
      const tAt = (Y) => (Y <= y0 + YEARS ? lerp(o.benFrom, o.benTo, (Y - y0) / YEARS) : lerp(o.artFrom, o.artTo, (Y - y0 - YEARS) / GEN));
      // the big crashes either of them lived through: the picture jolts as each line reaches one
      const crashes = [];
      for (let y = y0; y < end; y++) if (D.rets[idx(y)] < -0.25) crashes.push({ y, r: D.rets[idx(y)], t: tAt(y + 0.6) });
      crashes.forEach((c) => shake(t, c.t, 10));
      const xt = []; for (let y = Math.ceil(y0 / 10) * 10; y <= end; y += 10) xt.push(y);
      const A = chartFrame({ x0: 200, x1: 1330, y0: 200, y1: 720, dx: [y0, end], dy: [0, top], yTicks: ticksTo(top, step), xTicks: xt,
        under: (A) => {
          // the calendar year, huge and faint, ticking behind the chart, and the eras behind the lines
          if (now > y0 && now < end) text(String(Math.floor(now)), A.x1 - 10, A.y1 - 24, { size: 220, weight: 800, fam: "display", align: "right", color: rgba(C.ink, 0.06) });
          eras(A, span(t, o.erasAt, o.erasAt + 0.8), D);
        } });
      legend(A.x0, 150, [[C.blue, `Ben: ${y0}–${y0 + YEARS - 1}`], [C.fire, `Arthur: ${y0 + GEN}–${end - 1}`]]);
      if (o.projAt != null) ramseyLine(A, D, span(t, o.projAt, o.projAt + 0.8), `Ramsey: ${money(D.proj)}`);
      lineSeries(A, ben.p.map((v, k) => [y0 + k, v]), { progress: clamp((now - y0) / YEARS), color: C.blue, glow: now > y0, t });
      lineSeries(A, art.p.map((v, k) => [y0 + GEN + k, v]), { progress: clamp((now - y0 - GEN) / YEARS), color: C.fire, glow: now > y0 + GEN, t });
      // each crash gets a red tag where it hit, on every line that was invested then
      crashes.forEach((c) => {
        const a = span(t, c.t, c.t + 0.4);
        if (a <= 0) return;
        const hit = [[ben, y0], [art, y0 + GEN]].filter(([w, s]) => c.y >= s && c.y < s + YEARS).map(([w, s]) => w.p[c.y - s + 1]);
        const v = Math.max(...hit), x = A.X(c.y + 1), y = A.Y(v);
        alpha(a, () => {
          hit.forEach((h) => dot(A.X(c.y + 1), A.Y(h), 6, C.danger));
          // under the dip, unless that would land on the year labels
          const ly = y + 44 < A.y1 - 6 ? y + 40 : y - 16;
          zoomAt(x, ly - 6, lerp(1.4, 1, backOut(a)), () => text(`${c.y}: ${Math.round(c.r * 100)}%`, x, ly, { size: 20, weight: 700, color: C.danger, align: "center" }));
        });
      });
      // each calendar year on hover, once the lines have reached it (the column sits on the year-end point)
      const ends = []; for (let y = y0; y < end && y + 1 <= now; y++) ends.push(y + 1);
      columnHovers(A, ends, (ye) => {
        const y = ye - 1, bi = y - y0, ai = y - y0 - GEN, inBen = bi >= 0 && bi < YEARS, inArt = ai >= 0 && ai < YEARS;
        return hvBox(`${y}`, D.unit, [
          [D.pick("Stocks, after inflation", "Stocks"), spct(D.rets[idx(y)])],
          (inBen || inArt) && ["Each deposit", "$2,000"],
          (inBen || inArt) && D.mode === "real" && ["The same deposit, then", dollars(deposit(y))],
          inBen && [`Ben, age ${AGE0 + bi}, year end`, dollars(ben.p[bi + 1]), true],
          !inBen && y >= y0 + YEARS && ["Ben, retired", money(ben.v)],
          inArt && [`Arthur, age ${AGE0 + ai}, year end`, dollars(art.p[ai + 1]), !inBen],
          !inArt && ["Arthur", "not started yet"],
        ]);
      }, { mark: "line" });
      const benY = A.Y(ben.v) - 16 < A.y0 + 90 ? A.Y(ben.v) + 34 : A.Y(ben.v) - 16;
      alpha(span(t, o.benLabelAt, o.benLabelAt + 0.6), () => text(`Ben: ${countTo(t, o.benLabelAt, ben.v, money, 1.0)}`, A.X(y0 + YEARS) + 12, benY, { size: 26, weight: 700, fam: "display" }));
      alpha(span(t, o.artLabelAt, o.artLabelAt + 0.6), () => text(`Arthur: ${countTo(t, o.artLabelAt, art.v, money, 1.0)}`, A.X(end) + 12, A.Y(art.v) + 8, { size: 26, weight: 700, fam: "display" }));
      if (o.depAt != null) alpha(span(t, o.depAt, o.depAt + 0.8), () => {
        const bEnd = y0 + YEARS - 1, aStart = y0 + GEN, aEnd = end - 1;
        text("Each year's deposit in the dollars of the time", 1560, 104, { size: 18, color: C.muted, align: "right" });
        text(`Ben: ${dollars(deposit(y0))} in ${y0} → ${dollars(deposit(bEnd))} in ${bEnd}`, 1560, 134, { size: 21, weight: 700, color: C.blue, align: "right" });
        text(`Arthur: ${dollars(deposit(aStart))} in ${aStart} → ${dollars(deposit(aEnd))} in ${aEnd}`, 1560, 162, { size: 21, weight: 700, color: C.fire, align: "right" });
      });
      const sonWins = art.v >= ben.v, more = sonWins ? art.v / ben.v - 1 : ben.v / art.v - 1;
      const who = sonWins ? "Arthur" : "Ben";
      const label = more >= 0.95 && more < 1.05 ? `${who} has twice as much` : more >= 1.05 && more < 2 ? `${who} has more than twice as much` : `${who} has ${pct(more, 0)} more`;
      pill(800, 805, `${D.pick("Same plan", "On paper")}: ${label}`, sonWins ? "fire" : "blue", span(t, o.pillAt, o.pillAt + 0.6));
      crashes.forEach((c) => flash(t, c.t, C.danger, 0.7));
    }
    // the two tracks narrate these differently, so each has its own timings
    both("pair-1957", (t, q, D) => familyChart(t, D, 1957, D.pick(
      { benFrom: 0.6, benTo: q(2) + 5.0, artFrom: q(3) + 0.2, artTo: q(3) + 6.0, erasAt: q(2) + 0.4, benLabelAt: q(2) + 5.4, artLabelAt: q(3) + 6.5, pillAt: q(3) + 10.0, depAt: q(1) },
      { benFrom: 0.6, benTo: q(1) + 1.0, artFrom: q(1) + 1.2, artTo: q(2) + 0.6, erasAt: 0.4, benLabelAt: q(1) + 1.2, artLabelAt: q(2) + 0.8, pillAt: q(2) + 3.2, projAt: q(2) + 6.0 })));
    both("pair-1961", (t, q, D) => familyChart(t, D, 1961, D.pick(
      { benFrom: 0.6, benTo: q(2) + 2.0, artFrom: q(3) + 0.2, artTo: q(3) + 5.5, erasAt: 0.4, benLabelAt: q(2) + 2.4, artLabelAt: q(3) + 7.0, pillAt: q(3) + 9.8, depAt: q(1) },
      { benFrom: 0.6, benTo: q(1) + 2.0, artFrom: q(2) + 0.2, artTo: q(2) + 4.0, erasAt: 0.4, benLabelAt: q(1) + 2.4, artLabelAt: q(2) + 5.6, pillAt: q(2) + 8.0, projAt: q(1) + 4.5 })));

    // 5. Every 39-year window since 1945
    function windowsChart(t, q, D) {
      const raw = D.best.v * 1.12, step = tickStep(raw) * 2, top = niceMax(raw, step);
      const A = chartFrame({ x0: 200, x1: 1440, y0: 200, y1: 720, dx: [D.WINDOWS[0].y, D.WINDOWS[D.WINDOWS.length - 1].y + 1], dy: [0, top],
        yTicks: ticksTo(top, step), xTicks: [1945, 1955, 1965, 1975, 1985], xTitle: `First year of the ${YEARS}`,
        title: `What $2,000 a year for ${YEARS} years grew to, in ${D.unit}`, titleGap: 30 });
      const bw = A.X(1) - A.X(0) - 4;
      const grow = lin(t, 0.4, q(1) - 0.4);
      // the one-year contrast named at the end of the narration's second line
      const ext = q.span(1, 0, 0.8), oneYear = span(t, q(2) - (D.pick(7.5, 3.5)), q(2) - (D.pick(6.7, 2.7)));
      const ONE = [1969, 1970];
      const ram = q.span(2, 0, 0.8), pairs = q.span(3, 0, 0.8);
      barSeries(A, D.WINDOWS, {
        x: (w) => w.y, value: (w) => w.v, color: () => C.blue, grow, stagger: 5,
        alpha: (w) => {
          const hl = w === D.worst || w === D.best || (ONE.includes(w.y) && oneYear > 0);
          let a = 1;
          if (ext > 0 && ram === 0) a = spotlight(ext, hl);
          if (ram > 0 && pairs === 0) a = spotlight(ram, w.v >= D.proj);
          return a;
        },
        hover: (w) => {
          const son = D.win(w.y + GEN);
          return hvBox(`Started ${w.y}`, D.unit, [
            ["Saved", `${w.y}–${w.y + YEARS - 1}`],
            ["Grew to", dollars(w.v)],
            [D.pick("Ramsey's math (12% − 4%)", "Ramsey's math (12%)"), dollars(D.proj)],
            ["Share of Ramsey's number", pct(w.v / D.proj, 0)],
            son && [`Son, ${w.y + GEN}–${w.y + GEN + YEARS - 1}`, dollars(son.v), true],
          ]);
        },
      });
      alpha(ext * (1 - ram), () => {
        const b = D.best, w = D.worst;
        text(`${b.y}: ${money(b.v)}`, A.X(b.y) + bw / 2 + 2, A.Y(b.v) - 14, { size: 22, weight: 700, align: "center" });
        text(`ended ${b.y + YEARS - 1}`, A.X(b.y) + bw / 2 + 2, A.Y(b.v) - 40, { size: 18, color: C.muted, align: "center" });
        text(`${w.y}: ${money(w.v)}`, A.X(w.y) + bw + 10, A.Y(w.v) + 34, { size: 22, weight: 700 });
        text(`ended ${w.y + YEARS - 1}`, A.X(w.y) + bw + 10, A.Y(w.v) + 58, { size: 18, color: C.muted });
        alpha(oneYear, () => ONE.forEach((y, i) => {
          const x = D.win(y);
          if (x === D.worst || x === D.best) return;
          text(`${y}: ${money(x.v)}`, A.X(y) + (i ? bw + 10 : -8), A.Y(x.v) - 14, { size: 22, weight: 700, align: i ? "left" : "right" });
        }));
      });
      ramseyLine(A, D, ram); // stays on screen to the end of the scene
      alpha(ram * (1 - pairs), () => {
        line(A.x0, A.Y(D.proj / 2), A.x1, A.Y(D.proj / 2), C.muted, 1.5, [4, 6]);
        text(`Half of that: ${money(D.proj / 2)}`, A.x0 + 10, A.Y(D.proj / 2) - 10, { size: 18, weight: 600, color: C.muted });
        counter(1440, 150, "REACHED RAMSEY'S NUMBER", countTo(t, q.at(2, 0.4), D.reached, ofN(D.WINDOWS.length)), { align: "right", size: 40, color: C.fire });
      });
      alpha(pairs, () => {
        if (D.sonAhead >= D.fatherAhead) {
          counter(1440, 150, "SON AHEAD OF FATHER", countTo(t, q(3), D.sonAhead, ofN(D.PAIRS.length)), { align: "right", size: 40, color: C.fire });
          text(`One at least 25% ahead: ${D.quarter}`, 1440, 186, { size: 22, weight: 600, color: C.muted, align: "right" });
        } else {
          counter(1440, 150, "FATHER AHEAD OF SON", countTo(t, q(3), D.fatherAhead, ofN(D.PAIRS.length)), { align: "right", size: 40, color: C.blue });
          text(`in ${D.unit}`, 1440, 186, { size: 22, weight: 600, color: C.muted, align: "right" });
        }
      });
    }
    both("windows", windowsChart);

    // 6. Why: money at stake each year, over each year's return
    function whyChart(t, q, D, y0, o) {
      const sb = D.stake(y0), sa = D.stake(y0 + GEN);
      const raw = Math.max(...sb, ...sa) * 1.1, step = tickStep(raw) * 2, top = niceMax(raw, step);
      const A = chartFrame({ x0: 200, x1: 1440, y0: 220, y1: 640, dx: [y0, y0 + GEN + YEARS], dy: [0, top], yTicks: ticksTo(top, step),
        title: `Money invested during each year, ${D.unit}`, titleGap: 30, under: (A) => eras(A, span(t, o.erasAt, o.erasAt + 0.8), D) });
      legend(A.x1 - 360, A.y0 - 30, [[C.blue, `Ben (${y0}–${y0 + YEARS - 1})`], [C.fire, `Arthur (${y0 + GEN}–${y0 + GEN + YEARS - 1})`]]);
      const w = A.X(1) - A.X(0) - 2;
      const grow = lin(t, 0.3, o.growTo);
      const late = span(t, o.lateAt, o.lateAt + 0.8);
      // the last 20 years of each stay bright when the narration gets to them; Arthur's go first so that,
      // where the two overlap, Ben's bars sit on top
      const fade = (k) => spotlight(late, k >= YEARS - 20);
      const stakes = { grow, stagger: 4, pad: 1, radius: 2, x: (v, k) => k, value: (v) => v };
      barSeries(A, sa, { ...stakes, x: (v, k) => y0 + GEN + k, color: () => C.fire, alpha: (v, k) => fade(k) * 0.9 });
      barSeries(A, sb, { ...stakes, x: (v, k) => y0 + k, color: () => C.blue, alpha: (v, k) => fade(k) });
      alpha(span(t, 0.8, 1.6) * (1 - late), () => text("First deposits: $2,000", A.X(y0) + 4, A.Y(0) - 40, { size: 22, weight: 700, color: C.blue }));
      // yearly return strip; in plain dollars, inflation rides on top as dots
      const rA = axes({ x0: A.x0, x1: A.x1, y0: 720, y1: 850, dx: A.dx, dy: [-0.4, 0.4] });
      const yrs = []; for (let y = y0; y < y0 + GEN + YEARS; y++) yrs.push(y);
      alpha(span(t, 0.4, 1.0), () => {
        line(rA.x0, rA.Y(0), rA.x1, rA.Y(0), C.lineStrong, 1);
        text(D.pick("Stock return each year, after inflation", "Stock return each year, plain dollars"), rA.x0, rA.y0 - 6, { size: 18, color: C.muted });
        barSeries(rA, yrs, { x: (y) => y, value: (y) => D.rets[idx(y)], clamp: [-0.4, 0.4], pad: 1, radius: 2, color: (y, i, r) => (r >= 0 ? C.blue : C.danger) });
        xLabels(rA, [1960, 1970, 1980, 1990, 2000, 2010, 2020], (v) => v, rA.y1 + 28);
        // the best and worst years get a label beside their bar (the strip is too short for more)
        const byR = [...yrs].sort((a, b) => D.rets[idx(a)] - D.rets[idx(b)]);
        [byR[0], byR[byR.length - 1]].forEach((y) => {
          const r = D.rets[idx(y)], ye = rA.Y(clamp(r, -0.4, 0.4));
          text(`${y} ${r >= 0 ? "+" : "−"}${Math.abs(Math.round(r * 100))}%`, rA.X(y) + w + 6, r >= 0 ? ye + 12 : ye, { size: 14, weight: 700, color: r >= 0 ? C.ink : C.danger });
        });
      });
      columnHovers(A, yrs, (y) => {
        const bi = y - y0, ai = y - y0 - GEN;
        return hvBox(`${y}`, D.unit, [
          [D.pick("Stocks, after inflation", "Stocks"), spct(D.rets[idx(y)])],
          D.mode === "nominal" && ["Prices", spct(H.infl[idx(y)])],
          bi >= 0 && bi < YEARS && [`Ben's money invested (age ${AGE0 + bi})`, dollars(sb[bi])],
          ai >= 0 && ai < YEARS && [`Arthur's money invested (age ${AGE0 + ai})`, dollars(sa[ai])],
        ]);
      }, { align: "start", y1: rA.y1 });
      if (D.mode === "nominal") alpha(span(t, o.inflAt, o.inflAt + 0.8), () => {
        for (let y = y0; y < y0 + GEN + YEARS; y++) dot(rA.X(y) + 1 + w / 2, rA.Y(clamp(H.infl[idx(y)], -0.4, 0.4)), 4, C.fire);
        legend(rA.x1 - 230, rA.y0 - 6, [[C.fire, "Inflation that year", "dot"]]);
      });
      if (o.note) words(o.note, 1440, 150, t, o.noteAt, { size: 30, align: "right", hi: ["Sequence", "risk,"] });
    }
    // today's dollars follow the 1961 pair; plain dollars the 1957 pair, and what a 1995 dollar bought in 2020
    both("why", (t, q, D) => {
      if (D.mode === "real") return whyChart(t, q, D, 1961, { growTo: q(1), lateAt: q(1), erasAt: q(2), note: "Sequence risk, at the end of saving", noteAt: q(3) });
      whyChart(t, q, D, 1957, { growTo: q(1) - 0.4, lateAt: q(3), erasAt: q(1), inflAt: q(1) + 6.5 });
      const bEnd = 1957 + YEARS - 1, aEnd = bEnd + GEN;
      const f = H.infl.slice(idx(bEnd + 1), idx(aEnd) + 1).reduce((a, r) => a * (1 + r), 1);
      alpha(q.span(2, 4.5, 5.3), () => text(`$1 in ${bEnd} bought what $${f.toFixed(2)} bought in ${aEnd}`, 1440, 150, { size: 30, weight: 700, fam: "display", align: "right" }));
    });

    // 7. Same plan, different decades
    function takeawayCard(t, q, D) {
      avatar(640, 240, 62, "B", C.blue, span(t, 0.3, 0.9));
      avatar(960, 250, 50, "A", C.fire, span(t, 0.5, 1.1));
      alpha(span(t, 0.8, 1.6), () => text(`Started at ${AGE0}. Never missed a year.`, 800, 390, { size: 32, weight: 600, align: "center", color: C.muted }));
      words("Same plan. Different decades.", 800, 480, t, q(1), { size: 56, align: "center", gap: 0.16, hi: ["Different", "decades."] });
      alpha(q.span(1, 0.9, 1.7), () => {
        if (D.mode === "real") {
          const b = D.biggest, w = b.gap > 0 ? "son" : "father";
          text(`Since 1945, a generation apart, the ${w} ended with up to ${pct(Math.abs(b.gap), 0)} more (father from ${b.y}, son from ${b.y + GEN}).`, 800, 540, { size: 24, color: C.muted, align: "center" });
        } else {
          text(`Since 1945, only ${D.reached} of ${D.WINDOWS.length} windows reached Ramsey's ${money(D.proj)}, in plain dollars.`, 800, 540, { size: 24, color: C.muted, align: "center" });
        }
      });
      const [l1, l2] = D.pick(["12% every year assumes every stretch is the same.", "History says otherwise."], ["Plain dollars or today's dollars,", "the lesson is the same."]);
      words(l1, 800, 690, t, q(2), { size: 40, align: "center", gap: 0.1 });
      words(l2, 800, 750, t, q(2) + 1.4, { size: 40, align: "center", color: C.blue, gap: 0.16 });
    }
    both("takeaway", takeawayCard);

    return { scenes: SCENES, forkAfter: "steady", forkShow: (s) => s.cues[2].start + 7.0 };
  });
})();
