// Explainer 5: "What if I'm half wrong?" Dave Ramsey's retirement math from The Total Money Makeover, one round
// number at a time, against real history. The models are the ones on ../half-wrong/ (app.js, returns.js,
// saving.js, timing.js, realworld.js), rebuilt here so every number on screen matches that page.
// Data: ../data.js (HIST: S&P 500 total returns and CPI inflation, Dec to Dec) and ../explainer-4/funds.js
// (FUNDS: Ramsey's four American Funds, 1981 on). The player is ../kit/explainer-kit.js.
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS;
  ExplainerKit((K) => {
    const { C, ctx, alpha, axes, backOut, easeOut, font, dot, chartFrame, barSeries, lineSeries, columnHovers, counter, countTo, dollars,
      flash, glow, hot, hvBox, legend, lerp, lin, line, money, ofN, pct, pill, rgba, shake, span, spct, spotlight, stag, statCard, text,
      words, zoomAt, clamp, ease, partial, callout, yGrid, xLabels } = K;

    // ---------- data and the page's models ----------
    const T = F.funds.map((f) => f.ticker);
    const LAST = H.last, BOOK = 2003 + 8.5 / 12; // The Total Money Makeover, September 2003
    const inf = (y) => H.infl[y - H.first];
    const sp = (y) => H.stocks[y - H.first];
    const four = (y) => T.reduce((a, t) => a + F.returns[t][y - F.first], 0) / T.length;
    const vf = (y) => F.compare.SP[y - F.first];
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    // inflation compounded over a span (half-wrong/app.js)
    const cagrI = (a, b) => { let p = 1; for (let y = a; y <= b; y++) p *= 1 + inf(y); return Math.pow(p, 1 / (b - a + 1)) - 1; };
    // a stretch of yearly returns: simple average, compounded rate, growth of $1 (half-wrong/returns.js)
    const stretch = (f, a, b) => { let s = 0, g = 1; for (let y = a; y <= b; y++) { s += f(y); g *= 1 + f(y); } const n = b - a + 1; return { a, b, avg: s / n, cagr: Math.pow(g, 1 / n) - 1, g }; };
    // one saver: $625 at the start of every month for 40 years, each year's return spread over its months (half-wrong/saving.js)
    const MONTHLY = 625, BOOK_SUM = 7588545, SIXTH = BOOK_SUM / 6;
    function save(f, st, raise) {
      let B = 0, P = 1, D = MONTHLY, put = 0;
      const path = [0], deposits = [];
      for (let y = st; y < st + 40; y++) {
        const m = Math.pow(1 + f(y), 1 / 12) - 1;
        for (let j = 0; j < 12; j++) { B = (B + D) * (1 + m); put += D; }
        deposits.push(D); path.push(B);
        P *= 1 + inf(y);
        if (raise) D *= 1.04;
      }
      return { st, end: st + 39, B, real: B / P, P, put, deposits };
    }
    const SAVERS = [["four", four, "Four funds"], ["sp", sp, "S&P 500"], ["vf", vf, "VFINX"]];
    const SAVE_STARTS = range(F.first, LAST - 39); // 1981..1986
    const SAVE = {}, SAVE_UP = {};
    SAVERS.forEach(([k, f]) => { SAVE[k] = SAVE_STARTS.map((s) => save(f, s, false)); SAVE_UP[k] = SAVE_STARTS.map((s) => save(f, s, true)); });
    const steadyMonthly = (m, raise) => { let B = 0, D = MONTHLY; for (let y = 0; y < 40; y++) { for (let j = 0; j < 12; j++) B = (B + D) * (1 + m); if (raise) D *= 1.04; } return B; };
    const M12 = Math.pow(1.12, 1 / 12) - 1;
    const STEADY12 = steadyMonthly(M12, false), ONE_PCT = steadyMonthly(0.01, false);
    // the perfect world: 12% a year, 4% inflation, $500,000, the check raised 4% each January (half-wrong/timing.js)
    const START = 5e5, FAC = ((1 + M12) * (Math.pow(1 + M12, 12) - 1)) / (12 * M12);
    const monthlyStep = (B, W) => { for (let k = 0; k < 12; k++) B = (B - W / 12) * (1 + M12); return B; };
    const CASES = [
      { key: "m8", first: 0.08 * START, step: monthlyStep, name: "Monthly, 8%" },
      { key: "jan", first: 0.08 * START, step: (B, W) => (B - W) * 1.12, name: "All on January 1, 8%" },
      { key: "m769", first: (0.08 / 1.04) * START, step: monthlyStep, name: "Monthly, 7.69%" },
      { key: "m752", first: (0.08 / FAC) * START, step: monthlyStep, name: "Monthly, 7.52%" },
    ];
    CASES.forEach((c) => {
      let B = START, W = c.first;
      c.bal = [START]; c.real = [START]; c.gone = null;
      for (let y = 1; y <= 60 && c.gone == null; y++) {
        B = c.step(B, W);
        if (B <= 0) c.gone = y;
        B = Math.max(0, B);
        c.bal.push(B); c.real.push(B / Math.pow(1.04, y));
        W *= 1.04;
      }
    });
    const CASE = Object.fromEntries(CASES.map((c) => [c.key, c]));
    const NEED_40K = 40000 / (0.08 / FAC);
    // real history: $500,000, $40,000 the first year in monthly checks, raised each January by actual inflation (half-wrong/realworld.js)
    const LAST_START = 2013;
    function retire(f, st, len) {
      let B = START, W = 40000, P = 1, paid = 0, gone = null;
      const partial = st + len - 1 > LAST, run = Math.min(len, LAST - st + 1);
      for (let k = 0; k < run; k++) {
        const y = st + k, m = Math.pow(1 + f(y), 1 / 12) - 1;
        for (let j = 0; j < 12; j++) {
          if (B < W / 12) { paid += B; B = 0; gone = y; break; }
          B -= W / 12; paid += W / 12; B *= 1 + m;
        }
        if (gone) break;
        P *= 1 + inf(y); W *= 1 + inf(y);
      }
      const real = B / P;
      return { st, partial, gone, B, real, paid, yrs: gone ? gone - st : run, outcome: gone ? "out" : real >= START ? "kept" : "shrank" };
    }
    const RW_SP = range(1926, LAST_START).map((s) => retire(sp, s, 30));
    const RW_FOUR = range(F.first, LAST_START).map((s) => retire(four, s, 30));
    const done = (l) => l.filter((o) => !o.partial);
    const cnt = (l, k) => l.filter((o) => o.outcome === k).length;

    // ---------- narration timing: when the narrator reaches a phrase ----------
    // Estimated from the phrase's place among the line's characters, so it follows the real recording.
    const SCN = {};
    (window.NARRATION ? window.NARRATION.scenes : []).forEach((s) => (SCN[s.id] = s));
    const AT = (id) => (i, phrase, d = 0) => {
      const c = SCN[id].cues[i];
      if (!phrase) return c.start + d;
      const k = c.text.indexOf(phrase);
      if (k < 0) console.warn(`explainer-5: "${phrase}" not in ${id} line ${i}`);
      return c.start + ((c.end - c.start) * Math.max(0, k)) / c.text.length + d;
    };

    // ---------- colors beyond the kit's ----------
    const root = document.documentElement;
    let tokTheme = null, TOK = {};
    function tok(n) {
      if (tokTheme !== root.dataset.theme) { tokTheme = root.dataset.theme; TOK = {}; }
      if (!(n in TOK)) TOK[n] = getComputedStyle(root).getPropertyValue("--" + n).trim();
      return TOK[n];
    }
    const hex3 = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const mix = (a, b, u) => { const pa = hex3(a), pb = hex3(b); return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(u)).toString(16).padStart(2, "0")).join(""); };
    const VERDICT = { good: () => C.success, mixed: () => tok("warning"), bad: () => C.danger };
    const SAVE_COLOR = { four: () => C.blue, sp: () => C.success, vf: () => C.paintbrush };
    const HIGH = () => C.fire; // inflation above 4%
    // gold is for fills; text in that hue uses the darker warning ink so it reads on the light theme
    const ink = (c) => (c === C.fire ? tok("warning") : c);

    // ---------- drawing helpers of this explainer ----------
    // a rubber stamp that lands with a thump: the verdict on one of the book's numbers
    function stamp(x, y, label, kind, p, o = {}) {
      if (p <= 0) return;
      const col = VERDICT[kind](), size = o.size || 34;
      zoomAt(x, y, lerp(1.9, 1, backOut(p)), () => alpha(Math.min(1, p * 1.8), () => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot == null ? -0.06 : o.rot);
        font(ctx, size, 800, "display"); ctx.letterSpacing = "2px";
        const w = ctx.measureText(label).width + 52, h = size + 32;
        ctx.letterSpacing = "0px";
        ctx.fillStyle = rgba(col, 0.1); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 10); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke();
        ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14, 6); ctx.stroke();
        text(label, 0, 3, { size, weight: 800, fam: "display", color: col, align: "center", base: "middle", spacing: 2 });
        if (o.sub) text(o.sub, 0, h / 2 + 28, { size: 19, weight: 600, color: C.muted, align: "center" });
        ctx.restore();
      }));
    }
    // runs of [text, bold?, color?] wrapped to width w (from explainer 4); returns the height used
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
      lines.forEach((ln, li) => {
        const width = ln.reduce((s, t) => s + t.tw, 0);
        let lx = o.align === "center" ? x - width / 2 : x;
        ln.forEach((t) => {
          if (!t.space) text(t.tk, lx, y + li * lh, { size, weight: t.b ? 700 : 400, color: t.color || (t.b ? C.ink : C.muted) });
          lx += t.tw;
        });
      });
      return (lines.length - 1) * lh + lh * 0.3;
    }
    function card(x, y, w, h, o = {}) {
      ctx.fillStyle = o.fill || C.raised; ctx.strokeStyle = o.stroke || C.line; ctx.lineWidth = o.lw || 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, o.r || 16); ctx.fill(); ctx.stroke();
      if (o.top) { ctx.fillStyle = o.top; ctx.beginPath(); ctx.roundRect(x, y, w * (o.topP == null ? 1 : o.topP), 6, [o.r || 16, o.r || 16, 0, 0]); ctx.fill(); }
    }
    // a small tile: label, big value, a note under it
    function tile(x, y, w, label, value, sub, color, p) {
      if (p <= 0) return;
      zoomAt(x + w / 2, y + 60, lerp(0.88, 1, backOut(p)), () => alpha(p, () => {
        card(x, y, w, 132, { top: color, topP: easeOut(p) });
        text(label, x + 20, y + 38, { size: 18, weight: 600, color: C.muted });
        text(value, x + 20, y + 92, { size: 46, weight: 700, fam: "display", color: ink(color) });
        if (sub) text(sub, x + 20, y + 118, { size: 16, color: C.muted });
      }));
    }
    // a horizontal bracket under [x0, x1] with a label
    function bracket(x0, x1, y, label, color, p, o = {}) {
      if (p <= 0) return;
      alpha(p, () => {
        const xe = lerp(x0, x1, easeOut(p));
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x0, y - 10); ctx.lineTo(x0, y); ctx.lineTo(xe, y); if (p > 0.95) ctx.lineTo(x1, y - 10); ctx.stroke();
        if (label) text(label, o.align === "left" ? x0 : (x0 + x1) / 2, y + (o.dy || 30), { size: o.size || 20, weight: 700, color: ink(color), align: o.align || "center" });
      });
    }
    const cross = (x, y, r, color, lw = 3) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); };
    const mill = (v, d = 2) => "$" + (v / 1e6).toFixed(d) + "M";
    const p1 = (v) => (v * 100).toFixed(1) + "%";
    const p2 = (v) => (v * 100).toFixed(2) + "%";
    // the book's marker: a dotted line at September 2003
    function bookLine(X, y0, y1, a, label = "The Total Money Makeover, Sept 2003") {
      alpha(a, () => {
        line(X(BOOK), y0, X(BOOK), y1, C.ink, 1.5, [3, 5]);
        if (label) text(label, X(BOOK) - 8, y0 - 8, { size: 16, color: C.muted, align: "right" });
      });
    }

    const SCENES = {};

    // ================================================================= 1. The book's promise
    SCENES.promise = function (t, q) {
      const at = AT("promise");
      const up = span(t, at(1) - 0.4, at(1) + 0.4);
      alpha(span(t, 0.2, 0.9), () => {
        text("The Total Money Makeover", 800, lerp(320, 148, up), { size: lerp(70, 34, up), weight: 700, fam: "display", align: "center" });
        text("Dave Ramsey · first published 2003", 800, lerp(372, 180, up), { size: lerp(26, 18, up), color: C.muted, align: "center" });
      });
      alpha(1 - up, () => words("A retirement plan built on a few round numbers", 800, 480, t, at(0, "rests"), { size: 38, align: "center", color: C.muted, weight: 600 }));

      // twelve tiles, one per percentage point: 8 to live on, 4 left over to match inflation
      const tw = 62, gap = 10, x0 = 800 - (12 * tw + 11 * gap) / 2, ty = 286;
      const tIn = at(1, "twelve"), tInfl = at(1, "Inflation"), tLive = at(1, "live off"), tLeft = at(1, "left over"), tRaise = at(1, "raise");
      alpha(span(t, tIn, tIn + 0.5), () => text("EARN 12% A YEAR", x0, ty - 20, { size: 17, weight: 700, color: C.muted, spacing: 1.4 }));
      for (let k = 0; k < 12; k++) {
        const p = lin(t, tIn + k * 0.07, tIn + k * 0.07 + 0.45);
        if (p <= 0) continue;
        const infl = k >= 8, colorP = infl ? span(t, tInfl, tInfl + 0.5) : span(t, tLive, tLive + 0.5);
        const fill = mix(C.lineStrong, infl ? HIGH() : C.blue, colorP);
        const x = x0 + k * (tw + gap);
        // the four left over pulse when the narrator says they grow the nest egg
        const pulse = infl ? Math.max(0, Math.sin(clamp((t - tLeft) / 0.6) * Math.PI)) * 8 : 0;
        zoomAt(x + tw / 2, ty + tw / 2, lerp(0.4, 1, backOut(p)) + pulse / 60, () => alpha(p, () => {
          ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, ty, tw, tw, 10); ctx.fill();
          text("1%", x + tw / 2, ty + tw / 2 + 1, { size: 20, weight: 700, color: colorP > 0.5 ? (infl ? tok("on-firewheel") : C.onBlue) : C.ink, align: "center", base: "middle" });
        }));
      }
      const xs = (k) => x0 + k * (tw + gap);
      bracket(xs(0), xs(8) - gap, ty + tw + 22, "You live off 8%", C.blue, span(t, tLive, tLive + 0.6));
      bracket(xs(8), xs(12) - gap, ty + tw + 22, "Inflation takes 4%", HIGH(), span(t, tInfl, tInfl + 0.6));
      alpha(span(t, tLeft, tLeft + 0.6), () => text("The 4% left over grows the nest egg 4% a year, and your check with it.", 800, ty + tw + 92, { size: 22, color: C.muted, align: "center" }));

      // the book's example: $40,000 a year at 8% needs $500,000
      const e0 = at(2, "forty"), e1 = at(2, "five hundred");
      alpha(span(t, e0, e0 + 0.5), () => {
        text(countTo(t, e0, 40000, dollars, 0.9), 560, 560, { size: 54, weight: 700, fam: "display", align: "right" });
        text("a year", 576, 560, { size: 24, color: C.muted });
        text("÷ 8% =", 800, 560, { size: 44, weight: 700, fam: "display", align: "center", color: C.muted });
      });
      alpha(span(t, e1, e1 + 0.5), () => {
        text(countTo(t, e1, 5e5, dollars, 1.0), 900, 560, { size: 54, weight: 700, fam: "display", color: C.blue });
        text("nest egg", 1180, 560, { size: 24, color: C.muted });
      });

      // the plan's four numbers, as cards: they come back, stamped, at the end
      const CLAIMS = [["12%", "Stocks earn 12% a year", C.blue, tIn], ["4%", "Prices rise 4% a year", HIGH(), tInfl], ["8%", "You can spend 8% a year", C.blue, tLive], ["Every year", "You get a raise", C.success, tRaise]];
      CLAIMS.forEach(([v, sub, col, t0], i) => {
        const p = span(t, t0, t0 + 0.6), x = 110 + i * 352, y = 650;
        if (p <= 0) return;
        zoomAt(x + 160, y + 70, lerp(0.85, 1, backOut(p)), () => alpha(p, () => {
          card(x, y, 320, 140, { top: col });
          text(v, x + 24, y + 72, { size: 48, weight: 700, fam: "display", color: col === HIGH() ? tok("warning") : col });
          text(sub, x + 24, y + 112, { size: 21, weight: 600 });
        }));
        hot(x, y, 320, 140, hvBox(sub, "the book's claim, checked later in the explainer", [["Checked against", ["100 years of returns", "100 years of prices", "a perfect world, then history", "every real retirement"][i]]]));
      });
    };

    // ================================================================= 2. What if I'm half wrong?
    SCENES["joe-suzy"] = function (t, q) {
      const at = AT("joe-suzy");
      const tDep = at(0, "six hundred"), tSum = at(1, "seven million"), tHalf = at(2, "half wrong"), tFour = at(2, "four million"), tSix = at(2, "six times"), tSixth = at(3, "one point");
      // the book's words, lit up as the narrator reads them
      const lit = (t0, col) => (t >= t0 ? col : C.muted);
      alpha(span(t, 0.3, 1.0), () => {
        card(80, 150, 820, 330, { r: 18 });
        text("“", 96, 262, { size: 120, weight: 700, fam: "display", color: rgba(C.blue, 0.25) });
        const h = richText(130, 230, 730, [
          ["If Joe and Suzy invest "], ["$625 per month", true, lit(tDep, C.blue)], [" … from age thirty to age seventy, they will have "],
          ["$7,588,545", true, lit(tSum, C.blue)], [" … "], ["What if I’m half wrong?", true, lit(tHalf, tok("warning"))],
          [" What if you end up with only "], ["$4 million?", true, lit(tFour, tok("warning"))], [" "], ["What if I’m six times wrong?”", true, lit(tSix, C.danger)],
        ], { size: 30, lineHeight: 48 });
        text("Dave Ramsey, The Total Money Makeover (cuts marked …)", 130, 230 + h + 34, { size: 18, color: C.muted });
      });
      // what goes in: 480 deposits
      alpha(span(t, tDep + 1.0, tDep + 1.6), () => {
        text("$625 a month × 12 months × 40 years", 130, 560, { size: 24, color: C.muted });
        text(countTo(t, tDep + 1.0, 300000, dollars, 1.6) + " put in", 130, 614, { size: 46, weight: 700, fam: "display", color: tok("warning") });
      });

      // the meter: $0 to $8 million
      const mx = 1150, mw = 64, top = 150, bot = 800, Y = (v) => bot - (v / 8e6) * (bot - top);
      alpha(span(t, 0.6, 1.3), () => {
        card(mx, top - 6, mw, bot - top + 12, { r: 32, fill: C.sunken, stroke: C.lineStrong });
        [0, 2e6, 4e6, 6e6, 8e6].forEach((v) => text(v ? `$${v / 1e6}M` : "$0", mx - 16, Y(v) + 6, { size: 17, color: C.muted, align: "right" }));
      });
      // coins dropping in while the deposits are named, filling the first $300,000
      for (let k = 0; k < 14; k++) {
        const t0 = tDep + 0.2 + k * 0.12, u = lin(t, t0, t0 + 0.55);
        if (u > 0 && u < 1) dot(mx + mw / 2 + ((k % 3) - 1) * 12, lerp(top - 30, bot - 16, u * u), 7, C.fire, C.sunken, 2);
      }
      const putFill = lin(t, tDep + 0.3, tDep + 2.2) * 3e5;
      const sumFill = easeOut(lin(t, tSum, tSum + 2.4)) * BOOK_SUM;
      const fillTo = Math.max(putFill, sumFill);
      if (fillTo > 0) {
        ctx.save(); ctx.beginPath(); ctx.roundRect(mx + 6, top, mw - 12, bot - top, 26); ctx.clip();
        ctx.fillStyle = C.blue; ctx.fillRect(mx + 6, Y(fillTo), mw - 12, bot - Y(fillTo));
        ctx.fillStyle = C.fire; ctx.fillRect(mx + 6, Y(Math.min(fillTo, 3e5)), mw - 12, bot - Y(Math.min(fillTo, 3e5)));
        ctx.restore();
      }
      if (sumFill > 0) {
        const y = Y(sumFill);
        line(mx + mw + 6, y, mx + mw + 30, y, C.blue, 3);
        text(dollars(sumFill), mx + mw + 40, y + 16, { size: 44, weight: 700, fam: "display", color: C.blue });
        alpha(span(t, tSum + 2.4, tSum + 3.0), () => text("the book's figure", mx + mw + 40, y + 46, { size: 19, color: C.muted }));
      }
      // the book's own fallbacks
      const mark = (v, label, value, col, t0) => {
        const p = span(t, t0, t0 + 0.5);
        if (p <= 0) return;
        const y = Y(v), xe = lerp(mx - 4, mx + mw + 30, easeOut(p));
        line(mx - 4, y, xe, y, col, 4);
        alpha(p, () => { text(label, mx + mw + 40, y - 2, { size: 22, weight: 700, color: col }); text(value, mx + mw + 40, y + 26, { size: 20, color: C.muted }); });
      };
      mark(4e6, "Half wrong", "$4,000,000", tok("warning"), tHalf);
      mark(SIXTH, "Six times wrong", tSixth <= t ? `${dollars(SIXTH)}, a sixth` : "", C.danger, tSix);
      alpha(span(t, at(3, "check"), at(3, "check") + 0.6), () => text("Let's check each number against history.", 130, 720, { size: 26, weight: 700, color: C.blue }));
      hot(mx, top, mw, bot - top, hvBox("Joe and Suzy", "the book's saving example", [["Saved", "$625 a month, age 30 to 70"], ["Put in", "$300,000"], ["The book's figure", "$7,588,545"], ["Half wrong", "$4,000,000"], ["Six times wrong", dollars(SIXTH)]]));
    };

    // ================================================================= 3. Do prices rise 4% a year?
    SCENES.inflation = function (t, q) {
      const at = AT("inflation");
      const Y0 = 1926, years = range(Y0, LAST);
      const A = chartFrame({ x0: 190, x1: 1400, y0: 150, y1: 560, dx: [Y0, LAST + 1], dy: [-0.12, 0.2], yTicks: [-0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16], yFmt: (v) => `${Math.round(v * 100)}%`,
        xTicks: [1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020], xFmt: (v) => v, xLabelY: 590, title: "Prices, change each year (December to December)", titleGap: 22 });
      const P = [
        { a: 1926, b: LAST, label: `The last 100 years, 1926–${LAST}`, sub: "a year, compounded", t0: at(1, "whole") },
        { a: 1926, b: 2002, label: "Before the book, 1926–2002", sub: "the record a 2003 reader had", t0: at(1, "Before") },
        { a: 1973, b: 2002, label: "The 30 years before it", sub: "1973–2002, with the '70s inside", t0: at(2, "thirty") },
        { a: 2003, b: LAST, label: `Since the book, 2003–${LAST}`, sub: "3 of 23 years above 4%", t0: at(3, "Since") },
      ];
      P.forEach((p) => (p.v = cagrI(p.a, p.b)));
      const band = span(t, P[2].t0, P[2].t0 + 0.6) * (1 - span(t, P[3].t0, P[3].t0 + 0.6));
      // the 30 years before the book, shaded
      alpha(band, () => { ctx.fillStyle = rgba(HIGH(), 0.12); ctx.fillRect(A.X(1973), A.y0, A.X(2003) - A.X(1973), A.y1 - A.y0); });
      alpha(span(t, P[3].t0, P[3].t0 + 0.6), () => { ctx.fillStyle = rgba(C.blue, 0.1); ctx.fillRect(A.X(2003), A.y0, A.X(LAST + 1) - A.X(2003), A.y1 - A.y0); });
      const grow = lin(t, 0.6, at(1) - 0.2);
      const focus = (y) => (t < P[2].t0 ? 1 : t < P[3].t0 ? spotlight(band, y >= 1973 && y <= 2002) : spotlight(span(t, P[3].t0, P[3].t0 + 0.6), y >= 2003));
      barSeries(A, years, { x: (y) => y, value: inf, color: (y, i, v) => (v > 0.04 ? HIGH() : C.blue), grow, stagger: 6, pad: 1.5, radius: 2, alpha: (y) => Math.max(0.35, focus(y)),
        hover: (y) => hvBox(String(y), inf(y) > 0.04 ? "above Ramsey's 4%" : "at or below Ramsey's 4%", [["Prices that year", spct(inf(y))], y <= 2002 ? ["1926 to " + y + ", a year", p1(cagrI(1926, y))] : ["2003 to " + y + ", a year", p1(cagrI(2003, y))]]) });
      // Ramsey's 4%
      alpha(span(t, 0.4, 1.0), () => {
        line(A.x0, A.Y(0.04), A.x1, A.Y(0.04), C.ink, 2, [10, 7]);
        text("Ramsey's 4%", A.x1 + 12, A.Y(0.04) - 6, { size: 20, weight: 700 });
      });
      bookLine(A.X, A.y0 + 10, A.y1, span(t, 1.2, 1.8));
      // each span's compounded rate, drawn as a level line across its years
      P.forEach((p, i) => {
        const a = span(t, p.t0, p.t0 + 0.7), later = P.slice(i + 1).some((n) => t > n.t0 + 0.3);
        if (a <= 0) return;
        const xa = A.X(p.a), xb = lerp(xa, A.X(p.b + 1), easeOut(lin(t, p.t0, p.t0 + 1.0))), y = A.Y(p.v);
        alpha(later ? 0.35 : 1, () => {
          ctx.lineCap = "round"; line(xa, y, xb, y, i === 2 ? tok("warning") : C.ink, 5);
          if (!later) text(p1(p.v), xb + 10, y + (i === 3 ? 26 : i === 1 ? -10 : 7), { size: 24, weight: 700, fam: "display", color: i === 2 ? tok("warning") : C.ink });
        });
        tile(80 + i * 365, 660, 345, p.label, p1(p.v), p.sub, i === 2 ? HIGH() : i === 3 ? C.blue : C.ink, a);
      });
      stamp(1150, 220, "HOLDS UP", "good", lin(t, at(3, "holds up"), at(3, "holds up") + 0.5), { sub: "a little high, if anything" });
      flash(t, at(3, "holds up") + 0.15, C.success);
    };

    // ================================================================= 4. Two ways to average
    SCENES.averages = function (t, q) {
      const at = AT("averages");
      const R = [0.3, -0.1, 0.25, 0.03], bal = [1e4], steady = [1e4];
      R.forEach((r, i) => { bal.push(bal[i] * (1 + r)); steady.push(steady[i] * 1.12); });
      const avg = R.reduce((a, b) => a + b, 0) / 4, cg = Math.pow(bal[4] / 1e4, 1 / 4) - 1;
      const tR = [at(1, "up thirty"), at(1, "down ten"), at(1, "up twenty"), at(1, "up three")], tAvg = at(1, "averages"), tEnd = at(2, "fifteen"), tSt = at(2, "steady"), tCg = at(3, "ten point");
      alpha(span(t, 0.2, 0.9), () => {
        words("Simple average", 120, 160, t, 0.3, { size: 36, color: C.ink });
        text("add the returns, divide by the years", 120, 194, { size: 20, color: C.muted });
        words("Compounded", 860, 160, t, 0.9, { size: 36, color: C.ink });
        text("the steady rate the money actually grew at", 860, 194, { size: 20, color: C.muted });
      });
      // left: the four years' returns
      const A = chartFrame({ x0: 150, x1: 650, y0: 260, y1: 610, dx: [0, 4], dy: [-0.15, 0.35], yTicks: [-0.1, 0, 0.1, 0.2, 0.3], yFmt: (v) => `${Math.round(v * 100)}%`,
        fade: span(t, at(1) - 0.3, at(1) + 0.3) });
      barSeries(A, R, { x: (r, i) => i, value: (r) => r, pad: 22, radius: 5, progress: (r, i) => lin(t, tR[i], tR[i] + 0.6), color: (r) => (r >= 0 ? C.blue : C.danger),
        after: (r, i, g) => alpha(span(g.p, 0.5, 1), () => { text(spct(r, 0), g.cx, r >= 0 ? g.end - 14 : g.end + 30, { size: 26, weight: 700, fam: "display", align: "center", color: r >= 0 ? C.ink : C.danger }); text(`Year ${i + 1}`, g.cx, A.y1 + 30, { size: 18, color: C.muted, align: "center" }); }),
        hover: (r, i) => hvBox(`Year ${i + 1}`, "the example", [["Return", spct(r, 0)], ["Balance", dollars(bal[i + 1])], ["At a steady 12%", dollars(steady[i + 1])]]) });
      alpha(span(t, tAvg, tAvg + 0.5), () => {
        const xe = lerp(A.x0, A.x1, easeOut(lin(t, tAvg, tAvg + 0.8)));
        line(A.x0, A.Y(avg), xe, A.Y(avg), tok("warning"), 3, [10, 6]);
        text("(30 − 10 + 25 + 3) ÷ 4", A.x0 + 10, A.y0 - 20, { size: 20, color: C.muted });
        text(`= ${p1(avg)}`, A.x0 + 230, A.y0 - 20, { size: 24, weight: 700, color: tok("warning") });
      });
      // right: the money
      const B = chartFrame({ x0: 900, x1: 1380, y0: 260, y1: 610, dx: [0, 4], dy: [9000, 16500], yTicks: [10000, 12000, 14000, 16000], yFmt: (v) => "$" + v / 1000 + "K",
        xTicks: [0, 1, 2, 3, 4], xFmt: (v) => (v ? `Year ${v}` : "Start"), fade: span(t, at(1) - 0.3, at(1) + 0.3) });
      // the money follows the bars year by year
      const prog = (() => { let k = 0; for (let i = 0; i < 4; i++) k += lin(t, tR[i] + 0.1, tR[i] + 0.8); return k / 4; })();
      const sp2 = lin(t, tSt, tSt + 1.8);
      if (sp2 > 0) { ctx.setLineDash([10, 7]); lineSeries(B, steady.map((v, i) => [i, v]), { progress: sp2, color: C.muted, width: 3 }); ctx.setLineDash([]); }
      if (prog > 0) lineSeries(B, bal.map((v, i) => [i, v]), { progress: prog, color: C.blue, width: 4, glow: prog < 1, t });
      alpha(span(t, tEnd, tEnd + 0.5), () => text(countTo(t, tEnd, bal[4], dollars, 1.0), B.X(4) + 16, B.Y(bal[4]) + 34, { size: 30, weight: 700, fam: "display", color: C.blue }));
      alpha(span(t, tSt + 1.4, tSt + 2.0), () => { text(dollars(steady[4]), B.X(4) + 16, B.Y(steady[4]) - 6, { size: 30, weight: 700, fam: "display", color: C.muted }); text("steady 12%", B.X(4) + 16, B.Y(steady[4]) - 40, { size: 17, color: C.muted }); });
      columnHovers(B, [0, 1, 2, 3, 4], (i) => hvBox(i ? `End of year ${i}` : "Start", "the example", [["Balance", dollars(bal[i])], ["At a steady 12%", dollars(steady[i])]]), { mark: "line" });
      // the punchline
      const pc = span(t, tCg, tCg + 0.6);
      alpha(pc, () => {
        card(240, 700, 1120, 130, { r: 18 });
        text("Average", 290, 760, { size: 22, color: C.muted });
        text(p1(avg), 290, 806, { size: 44, weight: 700, fam: "display", color: tok("warning") });
        text("Compounded", 560, 760, { size: 22, color: C.muted });
        text(countTo(t, tCg, cg, (v) => p1(v), 1.0), 560, 806, { size: 44, weight: 700, fam: "display", color: C.blue });
        text("($15,064 ÷ $10,000) ^ ¼ − 1", 820, 766, { size: 20, color: C.muted });
        alpha(span(t, at(3, "Losses"), at(3, "Losses") + 0.5), () => text("Lose 10% and you need 11% just to get back.", 820, 806, { size: 22, weight: 700 }));
      });
    };

    // ================================================================= 5. Do stocks earn 12% a year?
    SCENES.twelve = function (t, q) {
      const at = AT("twelve");
      const pre = stretch(sp, 1926, 2002), post = stretch(sp, 2003, LAST);
      const L10 = (v) => Math.log10(v);
      const A = chartFrame({ x0: 200, x1: 1240, y0: 180, y1: 560, dx: [1925, 2002], dy: [4, 8], yTicks: [4, 5, 6, 7, 8], yFmt: (v) => ["$10K", "$100K", "$1M", "$10M", "$100M"][v - 4],
        xTicks: [1926, 1940, 1960, 1980, 2002], xLabelY: 592, title: "$10,000 in the S&P 500 at the end of 1925, on a ratio scale", titleGap: 36 });
      const act = [[1925, 4]], avg = [[1925, 4]];
      let g = 1e4, s = 1e4;
      range(1926, 2002).forEach((y) => { g *= 1 + sp(y); s *= 1 + pre.avg; act.push([y, L10(g)]); avg.push([y, L10(s)]); });
      const pa = lin(t, at(0, "From") , at(1, "fifteen")), pv = lin(t, at(1, "fifty"), at(1, "fifty") + 2.2);
      if (pv > 0) { ctx.setLineDash([10, 7]); lineSeries(A, avg, { progress: pv, color: tok("warning"), width: 3 }); ctx.setLineDash([]); }
      if (pa > 0) lineSeries(A, act, { progress: pa, color: C.blue, width: 4, glow: pa < 1, t, tipLabel: (v) => (pa < 1 ? { text: money(Math.pow(10, v)), dx: 16, dy: -14, size: 22, weight: 700, fam: "display" } : null) });
      alpha(span(t, at(1, "fifteen"), at(1, "fifteen") + 0.5), () => { text(mill(pre.g * 1e4, 1), A.x1 + 16, A.Y(L10(pre.g * 1e4)) + 8, { size: 34, weight: 700, fam: "display", color: C.blue }); text("what it became", A.x1 + 16, A.Y(L10(pre.g * 1e4)) + 34, { size: 18, color: C.muted }); });
      alpha(span(t, at(1, "fifty") + 1.8, at(1, "fifty") + 2.4), () => { text(mill(s, 1), A.x1 + 16, A.Y(L10(s)) + 8, { size: 34, weight: 700, fam: "display", color: tok("warning") }); text(`growing ${p1(pre.avg)} every year`, A.x1 + 16, A.Y(L10(s)) - 30, { size: 18, color: C.muted }); });
      columnHovers(A, range(1926, 2002), (y) => { const k = y - 1925; return hvBox(String(y), "S&P 500 with dividends, no costs", [["Return", spct(sp(y))], ["$10,000 had become", dollars(Math.pow(10, act[k][1]))], [`At ${p1(pre.avg)} every year`, dollars(Math.pow(10, avg[k][1]))]]); }, { mark: "line" });
      // the two rates, before and since the book
      const pair = (x, head, o, t0, t1) => {
        alpha(span(t, t0, t0 + 0.6), () => { text(head, x, 650, { size: 22, weight: 700 }); });
        tile(x, 670, 290, "Simple average", p1(o.avg), "how the 12% is quoted", tok("warning"), span(t, t0, t0 + 0.6));
        tile(x + 310, 670, 290, "Compounded", p1(o.cagr), "what the money grew at", C.blue, span(t, t1, t1 + 0.6));
      };
      pair(110, "S&P 500, 1926–2002", pre, at(0, "averaged"), at(0, "compounded"));
      pair(860, `S&P 500 since the book, 2003–${LAST}`, post, at(2, "average"), at(2, "compounded"));
    };

    // ================================================================= 6. Every 30-year stretch since 1981
    SCENES.windows = function (t, q) {
      const at = AT("windows");
      const starts = range(F.first, LAST - 29); // 16 stretches, 1981–2010 to 1996–2025
      const rows = [["S&P 500", "the index, no costs", sp], ["Four funds", "Ramsey's four, 25% each", four]];
      const W0 = stretch, x0 = 290, cw = (1400 - x0) / starts.length, sz = cw - 8, ry = [310, 450];
      const tFlip = at(1, "Compounded"), flip = lin(t, tFlip, tFlip + 1.4);
      alpha(span(t, 0.3, 0.9), () => {
        text("Each square: one 30-year stretch, by its first year", x0, 200, { size: 22, color: C.muted });
        legend(x0, 240, [[mix(C.raised, C.danger, 0.7), "Short of 12% a year", "dot"], [C.blue, "12% or more", "dot"]]);
      });
      // which measure the squares show: simple average, then (each square flipping in turn) compounded
      alpha(span(t, 0.6, 1.2), () => {
        const lab = flip < 0.5 ? "SIMPLE AVERAGE" : "COMPOUNDED";
        pill(1250, 230, lab === "COMPOUNDED" ? "Showing: compounded" : "Showing: simple average", lab === "COMPOUNDED" ? "blue" : "neutral", 1);
      });
      const color = (v) => (v >= 0.12 ? mix(C.raised, C.blue, 0.55 + 0.45 * clamp((v - 0.12) / 0.04)) : mix(C.raised, C.danger, 0.3 + 0.7 * clamp((0.12 - v) / 0.03)));
      rows.forEach(([name, sub, f], j) => {
        const y = ry[j];
        alpha(span(t, 0.4 + j * 0.4, 1.0 + j * 0.4), () => { text(name, x0 - 24, y + sz / 2 - 2, { size: 24, weight: 700, align: "right" }); text(sub, x0 - 24, y + sz / 2 + 24, { size: 16, color: C.muted, align: "right" }); });
        let hitsA = 0, hitsC = 0;
        starts.forEach((a, i) => {
          const o = W0(f, a, a + 29), p = lin(t, 0.8 + j * 0.5 + i * 0.07, 1.3 + j * 0.5 + i * 0.07);
          if (o.avg >= 0.12) hitsA++; if (o.cagr >= 0.12) hitsC++;
          if (p <= 0) return;
          // a flip: the square folds flat and opens on the compounded rate
          const fi = clamp((flip * (starts.length + 6) - i - j * 3) / 3), squash = Math.abs(Math.cos(fi * Math.PI)), showC = fi >= 0.5;
          const v = showC ? o.cagr : o.avg, cx = x0 + i * cw + cw / 2, cy = y + sz / 2;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(lerp(0.4, 1, backOut(p)), lerp(0.4, 1, backOut(p)) * Math.max(0.04, squash)); ctx.globalAlpha *= p;
          ctx.fillStyle = color(v); ctx.beginPath(); ctx.roundRect(-sz / 2, -sz / 2, sz, sz, 8); ctx.fill();
          const ink = v >= 0.12 ? C.onBlue : C.ink;
          text(p2(v).replace("%", ""), 0, 6, { size: 16, weight: 700, color: ink, align: "center" });
          ctx.restore();
          if (j === 1) alpha(span(t, 1.6, 2.2), () => text(String(a), cx, ry[1] + sz + 30, { size: 16, color: C.muted, align: "center" }));
          hot(cx - sz / 2, y, sz, sz, hvBox(`${name}, ${a}–${a + 29}`, v >= 0.12 ? "reached 12% a year" : "short of 12% a year", [["Average year", p2(o.avg)], ["Compounded", p2(o.cagr)], ["$10,000 became", dollars(1e4 * o.g)]]));
        });
        // the count, right of the row
        const c = flip < 0.6 ? hitsA : hitsC;
        alpha(span(t, 1.8 + j * 0.3, 2.4 + j * 0.3), () => {
          text(`${c} of ${starts.length}`, 1428, y + sz / 2 + 4, { size: 34, weight: 700, fam: "display", color: c ? (flip < 0.6 ? tok("warning") : C.blue) : C.danger });
          text("reached 12%", 1428, y + sz / 2 + 30, { size: 16, color: C.muted });
        });
      });
      alpha(span(t, 1.6, 2.2), () => text("First year of the 30-year stretch", 1400, ry[1] + sz + 62, { size: 18, color: C.muted, align: "right" }));
      // the near miss
      const c84 = x0 + (1984 - F.first) * cw + cw / 2;
      callout(c84, ry[1] + sz + 40, 700, "1984: 11.99%, a hair short", { fade: span(t, at(1, "three") + 0.8, at(1, "three") + 1.4), grow: span(t, at(1, "three") + 0.8, at(1, "three") + 1.3), size: 20, color: tok("warning"), align: "left", dx: -8, gap: 26 });
      stamp(1090, 760, "HALF RIGHT", "mixed", lin(t, at(2, "half right"), at(2, "half right") + 0.5), { sub: "12% average, about 10–11% compounded" });
    };

    // ================================================================= 7. Joe and Suzy, for real
    SCENES.saving = function (t, q) {
      const at = AT("saving");
      const tPut = at(0, "three hundred"), tGrow = at(1, "six real"), tRange = at(1, "three point"), tNone = at(2, "None"), tNear = at(2, "half wrong"), tReal = at(3, "In the money"), tSix = at(3, "closer");
      const A = chartFrame({ x0: 190, x1: 1060, y0: 150, y1: 700, dx: [0, 6], dy: [0, 8.4e6], yTicks: [0, 2e6, 4e6, 6e6, 8e6], yFmt: (v) => (v ? `$${v / 1e6}M` : "$0"),
        title: "What $625 a month for 40 years became", titleGap: 24 });
      const deflate = easeOut(lin(t, tReal, tReal + 1.8));
      alpha(span(t, 0.5, 1.1), () => legend(A.x0, 800, [...SAVERS.map(([k, , n]) => [SAVE_COLOR[k](), k === "four" ? "Ramsey's four funds" : k === "sp" ? "S&P 500 index" : "VFINX, an S&P 500 index fund", "dot"]), [C.fire, "$300,000 put in", "dot"]]));
      // the book's three goals
      const goals = [[BOOK_SUM, "The book", "$7,588,545", C.ink], [4e6, "Half wrong", "$4,000,000", tok("warning")], [SIXTH, "Six times wrong", dollars(SIXTH), C.danger]];
      goals.forEach(([v, lab, val, col], i) => alpha(span(t, 0.6 + i * 0.3, 1.2 + i * 0.3), () => {
        const hl = i === 0 ? span(t, tNone, tNone + 0.4) * (1 - span(t, tNear, tNear + 0.4)) : i === 1 ? span(t, tNear, tNear + 0.4) * (1 - span(t, tReal, tReal + 0.4)) : span(t, tSix, tSix + 0.4);
        line(A.x0, A.Y(v), A.x1, A.Y(v), col, 2 + 2 * hl, i === 0 ? [] : [10, 7]);
        text(lab, A.x1 + 18, A.Y(v) - 2, { size: 22 + 4 * hl, weight: 700, color: col });
        text(val, A.x1 + 18, A.Y(v) + 24, { size: 18, color: C.muted });
      }));
      // six stretches, three bars each
      const gw = A.X(1) - A.X(0), bw = (gw - 40) / 3;
      let lo = Infinity, hi = -Infinity, loR = Infinity, hiR = -Infinity;
      SAVE_STARTS.forEach((st, gi) => {
        alpha(span(t, 0.8, 1.4), () => text(`${st}–${st + 39}`, A.X(gi) + gw / 2, A.y1 + 30, { size: 18, color: C.muted, align: "center" }));
        SAVERS.forEach(([k, , n], si) => {
          const o = SAVE[k][gi], p = lin(t, tGrow + gi * 0.25 + si * 0.08, tGrow + gi * 0.25 + si * 0.08 + 0.9);
          lo = Math.min(lo, o.B); hi = Math.max(hi, o.B); loR = Math.min(loR, o.real); hiR = Math.max(hiR, o.real);
          const x = A.X(gi) + 20 + si * bw, v = lerp(o.B, o.real, deflate);
          // the $300,000 put in, at the foot of every bar
          alpha(span(t, tPut, tPut + 0.6), () => K.bar(x + 3, A.Y(0), A.Y(3e5), bw - 6, C.fire, 2));
          if (p > 0) {
            K.growBar(x + 3, A.Y(0), A.Y(v), bw - 6, SAVE_COLOR[k](), 4, p);
            alpha(span(t, tPut, tPut + 0.6), () => K.bar(x + 3, A.Y(0), A.Y(3e5), bw - 6, C.fire, 2));
          }
          hot(x, A.y0, bw, A.y1 - A.y0, hvBox(`${n}, saving ${st}–${st + 39}`, "$625 a month, $300,000 in all", [[`At the end of ${st + 39}`, dollars(o.B)], [`In ${st} dollars`, dollars(o.real)], ["Prices rose", `${o.P.toFixed(2)}×`], ["Reached", o.B >= BOOK_SUM ? "the book's figure" : o.B >= 4e6 ? "half wrong" : o.B >= SIXTH ? "six times wrong" : "none"]]));
        });
      });
      // the counters, top right of the chart's own space
      const cx = 1280, cy = 330;
      alpha(span(t, tPut, tPut + 0.5) * (1 - span(t, tRange - 0.2, tRange + 0.3)), () => counter(cx, cy, "PUT IN", countTo(t, tPut, 3e5, dollars, 1.0), { color: tok("warning"), size: 40 }));
      alpha(span(t, tRange, tRange + 0.5) * (1 - span(t, tReal, tReal + 0.4)), () => counter(cx, cy, "40 YEARS LATER", `${mill(lo, 1)}–${mill(hi, 1)}`, { color: C.blue, size: 40 }));
      alpha(span(t, tReal + 1.2, tReal + 1.8), () => counter(cx, cy, "IN START-YEAR DOLLARS", `${mill(loR, 1)}–${mill(hiR, 1)}`, { color: C.danger, size: 40 }));
      alpha(span(t, tNone, tNone + 0.5) * (1 - span(t, tReal, tReal + 0.4)), () => text("0 of 18 reached $7.59M", cx, cy + 44, { size: 20, weight: 700 }));
      alpha(span(t, tNear, tNear + 0.5) * (1 - span(t, tReal, tReal + 0.4)), () => {
        const n = SAVE.four.filter((o) => o.B >= 4e6).length;
        text(`Four funds: $4M+ in ${n} of 6`, cx, cy + 74, { size: 20, weight: 700, color: tok("warning") });
      });
      alpha(span(t, tReal, tReal + 0.6), () => text("prices roughly tripled", cx, cy + 44, { size: 20, weight: 700 }));
      stamp(1400, 720, "HALF WRONG", "mixed", lin(t, tSix + 0.6, tSix + 1.1), { sub: "as the book allows", size: 30 });
    };

    // ================================================================= 8. Where the $7.6 million comes from
    SCENES["fine-print"] = function (t, q) {
      const at = AT("fine-print");
      const tSteady = at(0, "steady"), tOne = at(1, "one percent"), tRaise = at(2, "raised"), tIn = at(2, "seven hundred"), tHit = at(3, "hit"), tReal = at(3, "after inflation");
      const partB = span(t, tRaise - 0.3, tRaise + 0.5);
      // part A: the book's figure against a steady 12%
      const X = (v) => 560 + (v / 8e6) * 820;
      alpha(lerp(1, 0.4, partB), () => {
        const rows = [["A steady 12% a year", "0.949% a month", STEADY12, C.blue, tSteady], ["1% a month", "12.7% a year, compounded", ONE_PCT, tok("warning"), tOne], ["The book", "Joe and Suzy", BOOK_SUM, C.ink, 0.4]];
        rows.forEach(([lab, sub, v, col, t0], i) => {
          const y = 150 + i * 92, p = lin(t, t0, t0 + 1.2);
          alpha(span(t, Math.min(t0, 0.4), Math.min(t0, 0.4) + 0.5), () => { text(lab, 530, y + 30, { size: 24, weight: 700, align: "right" }); text(sub, 530, y + 56, { size: 17, color: C.muted, align: "right" }); });
          if (p > 0) {
            ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(560, y + 10, (X(v) - 560) * easeOut(p), 46, [0, 8, 8, 0]); ctx.fill();
            text(i === 2 ? dollars(v) : mill(v * easeOut(p)), X(v * easeOut(p)) + 14, y + 44, { size: 28, weight: 700, fam: "display", color: col });
          }
          hot(560, y + 10, X(v) - 560, 46, hvBox(lab, "$625 at the start of every month for 40 years", [["Balance", dollars(v)], ["Put in", "$300,000"]]));
        });
        alpha(span(t, tSteady + 2.0, tSteady + 2.6), () => text(`short by ${mill(BOOK_SUM - STEADY12)}`, X(STEADY12) + 160, 150 + 44, { size: 20, weight: 700, color: C.danger }));
      });
      // part B: raising the deposit 4% a year
      const B = SAVE_UP.four, dep = B[0].deposits;
      alpha(partB, () => {
        line(110, 470, 1490, 470, C.line, 1);
        text("Raise the $625 by 4% every year", 110, 520, { size: 26, weight: 700 });
        text("the monthly deposit, year by year", 110, 548, { size: 17, color: C.muted });
      });
      const D = axes({ x0: 110, x1: 530, y0: 600, y1: 800, dx: [0, 40], dy: [0, 3000] });
      const grow = lin(t, tRaise + 0.3, tIn + 0.6);
      dep.forEach((d, k) => {
        const p = clamp(grow * 44 - k, 0, 4) / 4;
        if (p > 0) K.growBar(D.X(k) + 1, D.Y(0), D.Y(d), D.X(1) - D.X(0) - 2, C.fire, 2, p);
      });
      alpha(partB, () => {
        text("$625", D.x0, D.y1 + 28, { size: 17, color: C.muted });
        text(`$${Math.round(dep[39]).toLocaleString("en-US")} a month by year 40`, D.x1, D.Y(dep[39]) - 14, { size: 18, weight: 700, align: "right" });
      });
      columnHovers(D, range(0, 39).filter((k) => clamp(grow * 44 - k, 0, 4) > 0), (k) => hvBox(`Year ${k + 1}`, "saving, raised 4% a year", [["Each month", dollars(dep[k])], ["That year", dollars(dep[k] * 12)]]), { align: "start" });
      alpha(span(t, tIn, tIn + 0.5), () => counter(570, 700, "PUT IN", `${countTo(t, tIn, B[0].put, dollars, 1.2)}`, { color: tok("warning"), size: 40 }));
      alpha(span(t, tIn + 0.6, tIn + 1.2), () => text("instead of $300,000", 570, 734, { size: 18, color: C.muted }));
      // the four funds' six stretches, against the book's figure, then after inflation
      const E = axes({ x0: 900, x1: 1420, y0: 590, y1: 800, dx: [0, 6], dy: [0, 9e6] });
      const deflate = easeOut(lin(t, tReal, tReal + 1.6));
      alpha(partB * span(t, tHit - 0.3, tHit + 0.3), () => {
        text("Four funds, deposits raised 4% a year", 900, 548, { size: 17, color: C.muted });
        line(E.x0, E.Y(BOOK_SUM), E.x1, E.Y(BOOK_SUM), C.ink, 2);
        text("$7.59M", E.x1 + 10, E.Y(BOOK_SUM) + 6, { size: 18, weight: 700 });
        line(E.x0, E.Y(0), E.x1, E.Y(0), C.lineStrong, 1);
      });
      const bw = E.X(1) - E.X(0);
      B.forEach((o, i) => {
        const p = lin(t, tHit + i * 0.15, tHit + i * 0.15 + 0.8);
        if (p <= 0) return;
        const v = lerp(o.B, o.real, deflate), over = o.B >= BOOK_SUM && deflate < 0.5;
        K.growBar(E.X(i) + 12, E.Y(0), E.Y(v), bw - 24, over ? C.success : C.blue, 4, p);
        alpha(span(p, 0.7, 1), () => {
          text(mill(v, 1), E.X(i) + bw / 2, E.Y(v) - 10, { size: 17, weight: 700, align: "center", color: over ? C.success : C.ink });
          text(`’${String(o.st).slice(2)}`, E.X(i) + bw / 2, E.y1 + 24, { size: 16, color: C.muted, align: "center" });
        });
        hot(E.X(i), E.y0, bw, E.y1 - E.y0, hvBox(`Four funds, saving ${o.st}–${o.end}`, "deposits raised 4% a year", [["Put in", dollars(o.put)], [`At the end of ${o.end}`, dollars(o.B)], [`In ${o.st} dollars`, dollars(o.real)], ["Share of the book's figure", `${Math.round((o.real / BOOK_SUM) * 100)}% after inflation`]]));
      });
      const best = Math.max(...B.map((o) => o.real));
      alpha(span(t, tReal + 1.4, tReal + 2.0), () => text(`after inflation, the best: ${mill(best)}, ${Math.round((best / BOOK_SUM) * 100)}% of the book's figure`, 1420, 858, { size: 19, weight: 700, color: C.danger, align: "right" }));
    };

    // ================================================================= 9. Can you spend 8% a year?
    SCENES.spending = function (t, q) {
      const at = AT("spending");
      const tPaycheck = at(1, "Real retirees"), t38 = at(2, "runs out"), t31 = at(3, "gone"), t52 = at(4, "lasts"), t752 = at(5, "seven point"), tNeed = at(5, "Forty");
      const A = chartFrame({ x0: 200, x1: 1200, y0: 170, y1: 560, dx: [0, 55], dy: [0, 6.2e5], yTicks: [0, 1e5, 2e5, 3e5, 4e5, 5e5, 6e5],
        xTicks: [0, 10, 20, 30, 40, 50], xFmt: (v) => (v ? `Year ${v}` : "Start"), xLabelY: 586, title: "Balance in today's dollars: a perfect 12% every year, 4% inflation every year", titleGap: 22 });
      // keeping up: still worth $500,000 of today's money
      alpha(span(t, 0.6, 1.2), () => {
        line(A.x0, A.Y(START), A.x1, A.Y(START), C.ink, 1.5, [4, 6]);
        text("keeping up", A.x0 + 8, A.Y(START) - 10, { size: 17, color: C.muted });
        pill(1380, 210, "12% every year", "blue", span(t, at(0, "exactly"), at(0, "exactly") + 0.5));
        pill(1380, 262, "4% inflation", "neutral", span(t, at(0, "four percent"), at(0, "four percent") + 0.5));
      });
      // one line per way of spending, each drawn to where it runs out (or the chart's edge)
      const draw = (c, t0, d, col, dash, label, ly) => {
        const n = Math.min(c.gone || 55, 55), pts = c.real.slice(0, n + 1).map((v, y) => [y, v]), p = lin(t, t0, t0 + d);
        if (p <= 0) return;
        if (dash) ctx.setLineDash(dash);
        const tip = lineSeries(A, pts, { progress: p, color: col, width: 4 });
        ctx.setLineDash([]);
        if (p < 1) glow(tip[0], tip[1], col, t);
        if (c.gone && c.gone <= 55 && p >= 1) {
          const x = A.X(c.gone), y = A.Y(0);
          zoomAt(x, y, lerp(2, 1, backOut(lin(t, t0 + d, t0 + d + 0.4))), () => cross(x, y, 10, col, 4));
          text(`Year ${c.gone}`, x, y + 56, { size: 21, weight: 700, color: ink(col), align: "center" });
        }
        alpha(span(t, t0 + d * 0.3, t0 + d * 0.3 + 0.5), () => {
          line(1230, ly - 7, 1268, ly - 7, col, 4, dash ? dash.map((d) => d * 0.6) : null);
          text(label, 1280, ly, { size: 19, weight: 700, color: col });
        });
      };
      draw(CASE.m8, t38 - 2.4, 2.6, C.blue, null, "Monthly, 8%: $3,333 a month", 400);
      draw(CASE.jan, t31 - 0.4, 1.6, C.paintbrush, null, "All on January 1, 8%", 440);
      draw(CASE.m769, t52 - 1.2, 2.2, C.blue, [12, 7], "Monthly, 7.69% (1.12 ÷ 1.04)", 480);
      draw(CASE.m752, t752, 2.0, C.success, [3, 6], "Monthly, 7.52%: keeps up", 520);
      columnHovers(A, range(0, 55), (y) => hvBox(y ? `End of year ${y}` : "Start", "today's dollars, the perfect world", CASES.map((c) => [c.name, c.real[y] > 0 ? dollars(c.real[y]) : "gone"])), { mark: "line" });
      // the paycheck: twelve checks out, through the year, while the 12% comes in a month at a time
      const pc = span(t, tPaycheck - 0.2, tPaycheck + 0.4) * (1 - span(t, t752 - 0.4, t752 + 0.2));
      alpha(pc, () => {
        const y = 690, w = 74;
        text("The book's math: the year's 12% first, then 8% out", 200, y - 24, { size: 19, color: C.muted });
        text("Real life: a check every month", 200, y + 108, { size: 19, color: C.muted });
        ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].forEach((m, k) => {
          const x = 200 + k * (w + 6), p = lin(t, tPaycheck + 0.2 + k * 0.12, tPaycheck + 0.5 + k * 0.12);
          card(x, y, w, 64, { r: 8, fill: C.raised });
          text(m, x + 12, y + 26, { size: 16, weight: 700, color: C.muted });
          alpha(p, () => text("−$3,333", x + w / 2, y + 52 + (1 - p) * -12, { size: 16, weight: 700, color: C.blue, align: "center" }));
        });
        alpha(span(t, t38 - 2.6, t38 - 2.0), () => {
          text("Needed after year 1: $520,000", 1180, 712, { size: 19, weight: 700 });
          text(`Spent monthly: ${dollars(CASE.m8.bal[1])}`, 1180, 742, { size: 19, weight: 700, color: C.blue });
          text("a 3.5% gain, not 4%", 1180, 770, { size: 17, color: C.muted });
        });
      });
      // the answer
      alpha(span(t, tNeed, tNeed + 0.6), () => {
        card(200, 650, 1000, 150, { r: 18, top: C.success });
        text("To spend $40,000 a year, monthly, and keep up", 236, 702, { size: 22, color: C.muted });
        text(countTo(t, tNeed, NEED_40K, (v) => "$" + Math.round(v / 1000) + ",000", 1.0), 236, 770, { size: 54, weight: 700, fam: "display", color: C.success });
        text("not $500,000", 560, 770, { size: 28, weight: 700, color: C.muted });
      });
      stamp(1420, 720, "FALLS SHORT", "bad", lin(t, tNeed + 2.4, tNeed + 2.9), { sub: "even with perfect years", size: 30 });
    };

    // ================================================================= 10. What actually happened
    SCENES.history = function (t, q) {
      const at = AT("history");
      const t81 = at(1, "Since"), tKept = at(1, "eleven"), tOne = at(1, "one ran"), tBoom = at(2, "biggest"), tBack = at(2, "Back"), t29 = at(2, "twenty-nine"), t35 = at(2, "thirty-five"), tBook = at(3, "Everyone"), tOk = at(3, "Those"), tEnd = at(4, "biggest");
      // out to 1926 for the long record, back in for the years after the book
      const zoom = ease(lin(t, tBack - 0.2, tBack + 1.6)) * (1 - ease(lin(t, tBook - 0.6, tBook + 0.6)));
      const x0 = 260, x1 = 1250, dA = [F.first, LAST_START + 1], dB = [1926, LAST_START + 1];
      const X = (y) => x0 + ((y - lerp(dA[0], dB[0], zoom)) / (lerp(dA[1], dB[1], zoom) - lerp(dA[0], dB[0], zoom))) * (x1 - x0);
      const cw = X(1) - X(0), rowH = 86, ry = [300, 430];
      const col = { kept: C.blue, shrank: mix(C.raised, C.danger, 0.35), out: C.danger };
      // the rules
      alpha(span(t, 0.4, 1.0), () => {
        pill(390, 140, "$500,000 to start", "neutral", 1);
        pill(770, 140, "$40,000 the first year, monthly", "neutral", span(t, at(0, "forty"), at(0, "forty") + 0.5));
        pill(1250, 140, "a raise each January for actual inflation", "neutral", span(t, at(0, "raise"), at(0, "raise") + 0.5));
        legend(x0, 220, [[col.kept, "Kept up with inflation", "dot"], [col.shrank, "Lasted, but shrank", "dot"], [col.out, "Ran out", "dot"], [rgba(C.muted, 0.5), "Still underway (faded)", "dot"]]);
      });
      ctx.save(); ctx.beginPath(); ctx.rect(x0 - 2, 240, x1 - x0 + 4, 400); ctx.clip();
      const cell = (o, y, p, rowName) => {
        const x = X(o.st);
        if (x + cw < x0 - 4 || p <= 0) return;
        const pad = Math.min(3, cw * 0.12), w = cw - 2 * pad;
        zoomAt(x + cw / 2, y + rowH / 2, lerp(0.5, 1, backOut(p)), () => alpha(p * (o.partial ? 0.6 : 1), () => {
          ctx.fillStyle = col[o.outcome]; ctx.beginPath(); ctx.roundRect(x + pad, y, w, rowH, Math.min(6, w / 3)); ctx.fill();
          if (o.outcome === "out" && w > 9) cross(x + cw / 2, y + rowH / 2, Math.min(7, w / 3), C.raised, 2);
          if (o.outcome === "kept" && w > 9) dot(x + cw / 2, y + rowH / 2, Math.min(4, w / 5), C.raised);
        }));
        hot(x, y, cw, rowH, hvBox(`${rowName}, retired January ${o.st}`, o.partial ? `year ${o.yrs} of 30 at the end of ${LAST}` : "30 years", [
          ["Outcome", o.gone ? `ran out in ${o.gone}, year ${o.gone - o.st + 1}` : o.partial ? (o.outcome === "kept" ? "on track so far" : "falling behind so far") : o.outcome === "kept" ? "kept up with inflation" : "lasted, but shrank"],
          ["Paid out", dollars(o.paid)], o.gone ? null : ["Left, in " + o.st + " dollars", dollars(o.real)]]));
      };
      RW_SP.forEach((o, i) => {
        const p = o.st >= F.first ? lin(t, t81 + (o.st - F.first) * 0.06, t81 + (o.st - F.first) * 0.06 + 0.5) : lin(t, tBack + 0.6 + (F.first - o.st) * 0.03, tBack + 1.1 + (F.first - o.st) * 0.03);
        cell(o, ry[0], p, "S&P 500");
      });
      RW_FOUR.forEach((o) => cell(o, ry[1], lin(t, t81 + 1.0 + (o.st - F.first) * 0.05, t81 + 1.5 + (o.st - F.first) * 0.05), "Four funds"));
      ctx.restore();
      alpha(span(t, t81, t81 + 0.5), () => {
        text("S&P 500", x0 - 20, ry[0] + rowH / 2 + 8, { size: 24, weight: 700, align: "right" });
        text("Four funds", x0 - 20, ry[1] + rowH / 2 + 8, { size: 24, weight: 700, align: "right" });
        text("from 1981", x0 - 20, ry[1] + rowH / 2 + 32, { size: 16, color: C.muted, align: "right" });
        const ticks = zoom < 0.5 ? [1981, 1985, 1990, 1995, 2000, 2005, 2010, 2013] : [1926, 1940, 1960, 1981, 2000, 2013];
        ticks.filter((y) => X(y) >= x0 - 4).forEach((y) => text(String(y), X(y) + cw / 2, ry[1] + rowH + 30, { size: 17, color: C.muted, align: "center" }));
        text("Year retired · 30-year retirements", x0, ry[1] + rowH + 62, { size: 18, color: C.muted });
      });
      bookLine(X, ry[0] - 10, ry[1] + rowH + 8, span(t, t81 + 1.5, t81 + 2.1), "");
      // the counts
      const d81 = done(RW_SP.filter((o) => o.st >= F.first)), dAll = done(RW_SP), dF = done(RW_FOUR);
      const box = (y, head, a, b, color, p) => alpha(p, () => {
        text(head, 1290, y, { size: 16, weight: 700, color: C.muted, align: "left", spacing: 1 });
        text(a, 1290, y + 38, { size: 32, weight: 700, fam: "display", color });
        text(b, 1290, y + 64, { size: 18, color: C.muted });
      });
      const z0 = 1 - span(t, tBack, tBack + 0.5) + span(t, tBook, tBook + 0.6), z1 = 1 - span(t, tBook, tBook + 0.6);
      box(ry[0] + 6, "SINCE 1981", countTo(t, tKept, cnt(d81, "kept"), ofN(d81.length), 0.8), `kept up · ${cnt(d81, "out")} ran out`, C.blue, span(t, tKept, tKept + 0.5) * z0);
      box(ry[0] + 6, "SINCE 1926", countTo(t, t29, cnt(dAll, "kept"), ofN(dAll.length), 0.9), span(t, t35, t35 + 0.4) > 0 ? `kept up · ${cnt(dAll, "out")} ran out` : "kept up", C.danger, span(t, t29, t29 + 0.5) * z1);
      box(ry[1] + 6, "FINISHED", `${cnt(dF, "kept")} of ${dF.length}`, "kept up · all began 1981–96", C.blue, span(t, t81 + 2.0, t81 + 2.6));
      // 1981 came just before the boom
      alpha(span(t, tBoom, tBoom + 0.5) * (1 - span(t, tBack, tBack + 0.4)), () => text("1981: just before the biggest boom on record", X(F.first), ry[0] - 18, { size: 19, weight: 700 }));
      // after the book, and after the crash
      const xb = (a, b) => [X(a) + 1, X(b + 1) - 1];
      const [a1, b1] = xb(2004, 2008), [a2, b2] = xb(2009, 2013);
      const pB = span(t, tBook + 0.6, tBook + 1.2), pO = span(t, tOk, tOk + 0.6);
      alpha(pB, () => {
        ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(a1 - 4, ry[0] - 8, b1 - a1 + 8, ry[1] + rowH - ry[0] + 16, 8); ctx.stroke();
        text("2004–08: all ran out", (a1 + b1) / 2, ry[0] - 20, { size: 20, weight: 700, color: C.danger, align: "center" });
      });
      alpha(pO, () => {
        ctx.strokeStyle = C.blue; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(a2 - 4, ry[0] - 8, b2 - a2 + 8, ry[1] + rowH - ry[0] + 16, 8); ctx.stroke();
        text("2009–13: on track so far", (a2 + b2) / 2, ry[1] + rowH + 64, { size: 20, weight: 700, color: C.blue, align: "center" });
      });
      // 1926–1931 and 1956–1977, the eras that ran out
      alpha(span(t, t35, t35 + 0.5) * (1 - span(t, tBook, tBook + 0.4)), () => {
        bracket(X(1926), X(1932) - 1, ry[0] - 18, "1926–31", C.danger, 1, { dy: -14, size: 17 });
        bracket(X(1956), X(1978) - 1, ry[0] - 18, "nearly every start, 1956–77", C.danger, 1, { dy: -14, size: 17 });
      });
      words("The biggest difference: the year you started.", 660, 800, t, tEnd - 0.6, { size: 36, align: "center", color: C.ink, gap: 0.12 });
      stamp(1340, 790, "DEPENDS ON THE YEAR", "bad", lin(t, tEnd + 1.6, tEnd + 2.1), { size: 24, rot: -0.05 });
    };

    // ================================================================= 11. The scorecard
    SCENES.scorecard = function (t, q) {
      const at = AT("scorecard");
      const ROWS = [
        ["Prices rise 4% a year", `${p1(cagrI(1926, LAST))} over 100 years; ${p1(cagrI(2003, LAST))} since the book`, "HOLDS UP", "good", at(0, "Four percent")],
        ["Stocks earn 12% a year", "as an average, yes; compounded, about 10–11%", "HALF RIGHT", "mixed", at(0, "Twelve")],
        ["$625 a month becomes $7.6 million", `${mill(Math.min(...SAVERS.map(([k]) => Math.min(...SAVE[k].map((o) => o.B)))), 1)}–${mill(Math.max(...SAVERS.map(([k]) => Math.max(...SAVE[k].map((o) => o.B)))), 1)}; $1.2–2.0M after inflation`, "HALF WRONG", "mixed", at(0, "Seven point")],
        ["You can spend 8% a year", `runs out in year ${CASE.m8.gone}, even with perfect years`, "FALLS SHORT", "bad", at(0, "Spending")],
        ["A raise every year, for life", `S&P 500 since 1926: ${cnt(done(RW_SP), "kept")} of ${done(RW_SP).length} kept up`, "DEPENDS ON THE YEAR", "bad", at(0, "falls short") + 0.6],
      ];
      const fade = 1 - 0.88 * span(t, at(1) - 0.2, at(1) + 0.4) - 0.12 * span(t, at(2) - 0.2, at(2) + 0.3);
      ROWS.forEach(([claim, why, label, kind, t0], i) => {
        const y = 120 + i * 104, p = span(t, Math.min(0.3 + i * 0.25, t0), Math.min(0.3 + i * 0.25, t0) + 0.6);
        alpha(p * fade, () => {
          card(120, y, 1360, 88, { r: 14 });
          text(claim, 156, y + 40, { size: 27, weight: 700, fam: "display" });
          alpha(span(t, t0, t0 + 0.5), () => text(why, 156, y + 70, { size: 18, color: C.muted }));
        });
        alpha(fade, () => stamp(1270, y + 44, label, kind, lin(t, t0, t0 + 0.45), { size: 22, rot: -0.04 }));
        hot(120, y, 1360, 88, hvBox(claim, "the book's claim", [["Verdict", label.toLowerCase()], ["Why", why]]));
      });
      // saving still wins
      alpha(span(t, at(1), at(1) + 0.6) * (1 - span(t, at(2) - 0.2, at(2) + 0.3)), () => {
        card(300, 300, 1000, 230, { r: 20, top: C.success });
        text("Saving $625 a month for 40 years", 800, 370, { size: 26, color: C.muted, align: "center" });
        text(`$300,000 in → ${mill(Math.min(...SAVERS.map(([k]) => Math.min(...SAVE[k].map((o) => o.B)))), 1)} to ${mill(Math.max(...SAVERS.map(([k]) => Math.max(...SAVE[k].map((o) => o.B)))), 1)}`, 800, 448, { size: 50, weight: 700, fam: "display", align: "center", color: C.success });
        text("in every real 40-year stretch since 1981. Not saving: $0.", 800, 496, { size: 22, color: C.muted, align: "center" });
      });
      alpha(span(t, at(2) - 0.2, at(2) + 0.4), () => {
                words("The plan points the right way.", 800, 400, t, at(2), { size: 56, align: "center", color: C.blue, gap: 0.14 });
        words("Its numbers are just too tidy.", 800, 480, t, at(2, "Its"), { size: 56, align: "center", gap: 0.14 });
        const tl = [["Returns swing.", at(2, "Returns")], ["Retirees spend every month.", at(2, "retirees")], ["The start year matters most.", at(2, "and the year")]];
        tl.forEach(([s, t0], i) => alpha(span(t, t0, t0 + 0.5), () => text(s, 360 + i * 440, 600, { size: 26, weight: 700, color: C.muted, align: "center" })));
        alpha(span(t, at(2, "and the year") + 1.5, at(2, "and the year") + 2.2), () => text("Historical simulation, from the same data as the “What if I'm half wrong?” page. Not financial advice.", 800, 740, { size: 19, color: C.muted, align: "center" }));
      });
    };

    return { scenes: SCENES };
  });
})();
