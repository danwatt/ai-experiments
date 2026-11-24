(function () {
  "use strict";
  const H = window.HIST;
  const W = 1600, Hh = 900;
  const TAIL = 1.4; // seconds of picture after the last word of a scene

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem("retire-theme"); if (t === "light" || t === "dark") root.dataset.theme = t; } catch (e) {}
  let C = {};
  function readColors() {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue("--" + n).trim();
    C = {
      surface: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken"), line: v("line"), lineStrong: v("line-strong"),
      ink: v("ink"), muted: v("ink-muted"), blue: v("bluebonnet"), blueDeep: v("bluebonnet-deep"), blueSoft: v("bluebonnet-soft"),
      fire: v("firewheel"), danger: v("danger"), dangerSoft: v("danger-soft"), success: v("success"), successSoft: v("success-soft"),
      onBlue: v("on-bluebonnet"),
    };
  }
  const themeBtn = document.getElementById("theme");
  function syncThemeBtn() {
    const dark = root.dataset.theme === "dark";
    themeBtn.querySelector("span").textContent = dark ? "Light" : "Dark";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  themeBtn.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("retire-theme", root.dataset.theme); } catch (e) {}
    syncThemeBtn(); readColors(); draw();
  });
  syncThemeBtn();
  function rgba(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- canvas ----------
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  let scale = 1;
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    scale = (r.width * dpr) / W;
    draw();
  }
  window.addEventListener("resize", resize);

  // ---------- easing ----------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const span = (t, a, b) => ease((t - a) / (b - a));
  const lin = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- formatting ----------
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const spct = (v, d = 1) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%";
  function money(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return "$" + Math.round(v / 1e3) + "K";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }
  const moneyTick = (v) => (v === 0 ? "$0" : v >= 1e6 ? "$" + +(v / 1e6).toFixed(2) + "M" : "$" + Math.round(v / 1e3) + "K");

  // ---------- drawing helpers ----------
  const FONT = { display: '"Bricolage Grotesque", "Avenir Next", system-ui, sans-serif', body: '"Public Sans", "Segoe UI", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace' };
  function font(c, size, weight, fam) { c.font = `${weight || 400} ${size}px ${FONT[fam || "body"]}`; }
  function text(s, x, y, o) {
    o = o || {};
    font(ctx, o.size || 22, o.weight || 400, o.fam);
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || "left";
    ctx.textBaseline = o.base || "alphabetic";
    if (o.spacing) ctx.letterSpacing = o.spacing + "px";
    ctx.fillText(s, x, y);
    if (o.spacing) ctx.letterSpacing = "0px";
  }
  function alpha(a, fn) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= clamp(a); fn(); ctx.restore(); }
  function dot(x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function line(x0, y0, x1, y1, color, lw, dash) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = color; ctx.lineWidth = lw || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  // draw the first `frac` (0..1) of a polyline, interpolating the last segment; returns the tip
  function partial(pts, frac, color, lw) {
    if (pts.length < 2 || frac <= 0) return pts[0];
    const f = clamp(frac) * (pts.length - 1), n = Math.floor(f), u = f - n;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    let tip = pts[n];
    if (n < pts.length - 1) { tip = [lerp(pts[n][0], pts[n + 1][0], u), lerp(pts[n][1], pts[n + 1][1], u)]; ctx.lineTo(tip[0], tip[1]); }
    ctx.strokeStyle = color; ctx.lineWidth = lw || 3; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
    return tip;
  }
  // bar with rounded data end, square at the baseline
  function bar(x, base, end, w, color, r = 4) {
    const h = Math.abs(base - end);
    if (h < 0.5) return;
    r = Math.min(r, w / 2, h);
    const up = end < base;
    ctx.beginPath();
    if (up) { ctx.moveTo(x, base); ctx.lineTo(x, end + r); ctx.quadraticCurveTo(x, end, x + r, end); ctx.lineTo(x + w - r, end); ctx.quadraticCurveTo(x + w, end, x + w, end + r); ctx.lineTo(x + w, base); }
    else { ctx.moveTo(x, base); ctx.lineTo(x, end - r); ctx.quadraticCurveTo(x, end, x + r, end); ctx.lineTo(x + w - r, end); ctx.quadraticCurveTo(x + w, end, x + w, end - r); ctx.lineTo(x + w, base); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function pill(x, y, label, kind, a) {
    const colors = { danger: [C.dangerSoft, C.danger], blue: [C.blueSoft, C.blue], neutral: [C.raised, C.muted], fire: [C.raised, C.fire] }[kind];
    alpha(a == null ? 1 : a, () => {
      font(ctx, 22, 600);
      const w = ctx.measureText(label).width + 54, h = 40;
      ctx.fillStyle = colors[0];
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 20); ctx.fill();
      ctx.strokeStyle = rgba(colors[1], 0.5); ctx.lineWidth = 1.5; ctx.stroke();
      dot(x - w / 2 + 21, y, 5.5, colors[1]);
      text(label, x - w / 2 + 36, y + 1, { size: 22, weight: 600, color: colors[1], base: "middle" });
    });
  }
  function eyebrow(num, title) {
    text(`${String(num).padStart(2, "0")}  ·  ${title.toUpperCase()}`, 56, 70, { size: 18, weight: 600, color: C.blue, spacing: 1.6 });
  }
  function counter(x, y, label, value, o) {
    o = o || {};
    text(label, x, y - 46, { size: 18, weight: 600, color: C.muted, align: o.align || "left", spacing: 1.2 });
    text(value, x, y, { size: o.size || 46, weight: 700, fam: "display", color: o.color || C.ink, align: o.align || "left" });
  }
  // chart frame
  function axes(o) {
    const X = (v) => o.x0 + ((v - o.dx[0]) / (o.dx[1] - o.dx[0])) * (o.x1 - o.x0);
    const Y = (v) => o.y1 - ((v - o.dy[0]) / (o.dy[1] - o.dy[0])) * (o.y1 - o.y0);
    return Object.assign({ X, Y }, o);
  }
  function yGrid(A, ticks, fmt) {
    ticks.forEach((t) => {
      line(A.x0, A.Y(t), A.x1, A.Y(t), t === 0 ? C.lineStrong : C.line, 1);
      text(fmt(t), A.x0 - 14, A.Y(t) + 6, { size: 18, color: C.muted, align: "right" });
    });
  }
  function xLabels(A, ticks, fmt, y) {
    ticks.forEach((t) => text(fmt(t), A.X(t), y || A.y1 + 32, { size: 18, color: C.muted, align: "center" }));
  }
  function legend(x, y, items) {
    let cx = x;
    items.forEach(([color, label, kind]) => {
      if (kind === "dot") dot(cx + 13, y - 6, 8, color); else line(cx, y - 6, cx + 26, y - 6, color, 4);
      text(label, cx + 36, y, { size: 19, color: C.muted });
      font(ctx, 19, 400); cx += 36 + ctx.measureText(label).width + 30;
    });
  }

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
  const dollars = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const ERAS = [[1966, 1982, "flat"], [1983, 1999, "boom"], [2000, 2008, "flat"], [2009, 2021, "boom"]];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function avatar(x, y, r, letter, color, a) {
    alpha(a, () => {
      dot(x, y, r, color);
      text(letter, x, y + r * 0.36, { size: r * 1.05, weight: 700, fam: "display", align: "center", color: C.sunken });
    });
  }
  const rateText = (r) => (Math.abs(r) < 0.0005 ? "0.0%" : spct(r));
  // calendar eras behind a chart; plain-dollar charts also show what prices did
  function eras(A, a, D) {
    alpha(a, () => ERAS.forEach(([s, e, kind]) => {
      if (e + 1 < A.dx[0] || s > A.dx[1]) return;
      const x0 = A.X(Math.max(s, A.dx[0])), x1 = A.X(Math.min(e + 1, A.dx[1]));
      ctx.fillStyle = kind === "flat" ? rgba(C.muted, 0.12) : rgba(C.blue, 0.10);
      ctx.fillRect(x0, A.y0, x1 - x0, A.y1 - A.y0);
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

  // 1. Ben and Arthur
  SCENES.family = function (t, q) {
    const people = [[520, 250, 70, "B", "Ben", "the father", C.blue], [1080, 262, 56, "A", "Arthur", "his son", C.fire]];
    people.forEach(([x, y, r, l, name, tag, col], i) => {
      const a = span(t, 0.4 + i * 0.5, 1.0 + i * 0.5);
      avatar(x, y, r, l, col, a);
      alpha(a, () => text(name, x, 375, { size: 40, weight: 700, fam: "display", align: "center" }));
      alpha(span(t, q(1) + 0.4 + i * 1.2, q(1) + 1.0 + i * 1.2), () => text(tag, x, 412, { size: 24, color: C.muted, align: "center" }));
    });
    const x0 = 170, cell = 20, gapY = 80;
    const fill = lin(t, q(2) + 0.2, q(2) + 4.0);
    const shift = span(t, q(3) + 1.6, q(3) + 4.0);
    alpha(span(t, q(2), q(2) + 0.5), () => {
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
        if (k / YEARS > fill) break;
        ctx.beginPath(); ctx.roundRect(x0 + off + k * cell + 2, y + 8, cell - 4, 30, 3); ctx.fillStyle = col; ctx.fill();
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
    const A = axes({ x0: 200, x1: 1440, y0: 200, y1: 660, dx: [0, GEN + YEARS], dy: [0, 2e6] });
    yGrid(A, [0, 500e3, 1e6, 1.5e6, 2e6], moneyTick);
    xLabels(A, [0, 10, 20, 30, 40, 50, 60], (v) => `year ${v + 1}`);
    legend(A.x0, 150, [[C.blue, "Ben"], [C.fire, `Arthur, ${GEN} years later`]]);
    const f = lin(t, 0.6, q(1) + 1.0), now = f * (GEN + YEARS);
    const tb = partial(steady.map((v, k) => [A.X(k), A.Y(v)]), clamp(now / YEARS), C.blue, 4);
    const ta = partial(steady.map((v, k) => [A.X(k + GEN), A.Y(v)]), clamp((now - GEN) / YEARS), C.fire, 4);
    if (now > 0) dot(tb[0], tb[1], 7, C.blue, C.sunken, 3);
    if (now > GEN) dot(ta[0], ta[1], 7, C.fire, C.sunken, 3);
    alpha(span(t, q(1) + 0.6, q(1) + 1.4), () => {
      text(`Both retire with ${money(steady[YEARS])}`, A.X(GEN + YEARS) - 10, A.Y(steady[YEARS]) - 30, { size: 28, weight: 700, fam: "display", align: "right" });
      text("+12% every year, $2,000 a year", A.X(1), A.Y(1.8e6), { size: 22, color: C.muted });
    });
    const fork = span(t, q(2) + 7.0, q(2) + 7.8);
    pill(560, 790, "Plain dollars, like Ramsey's chart", "fire", fork);
    pill(1040, 790, "Today's dollars, after inflation", "blue", span(t, q(2) + 9.6, q(2) + 10.4));
  };

  // track intros: how this track counts, and Ramsey's target in those terms
  function introCard(t, q, D, lines) {
    alpha(span(t, 0.2, 0.9), () => text(D.mode === "real" ? `Today's dollars: ${TODAY}` : "Plain dollars", 800, 230, { size: 64, weight: 700, fam: "display", align: "center", color: D.mode === "real" ? C.blue : C.fire }));
    lines.forEach((l, i) => alpha(span(t, 0.9 + i * 1.4, 1.6 + i * 1.4), () => text(l, 800, 330 + i * 46, { size: 28, color: C.muted, align: "center" })));
    alpha(span(t, q(1), q(1) + 0.8), () => {
      text(D.projLabel, 800, 560, { size: 30, weight: 600, align: "center", color: C.muted });
      text(money(D.proj), 800, 660, { size: 104, weight: 700, fam: "display", align: "center", color: C.fire });
      text(`after ${YEARS} years of $2,000 a year, like Arthur in Ramsey's chart`, 800, 720, { size: 24, color: C.muted, align: "center" });
    });
  }
  SCENES["real-intro"] = (t, q) => introCard(t, q, SETS.real, [`“Today” means ${TODAY} prices.`, `Each deposit buys what $2,000 bought in ${TODAY}.`, "Every balance is shown in those same dollars."]);
  SCENES["nominal-intro"] = (t, q) => introCard(t, q, SETS.nominal, ["Exactly $2,000 a year, every year.", "Every balance is what the statement said."]);

  // a father and son, drawn by calendar year
  function familyChart(t, D, y0, o) {
    const ben = D.win(y0), art = D.win(y0 + GEN), end = y0 + GEN + YEARS;
    const raw = Math.max(Math.max(...ben.p, ...art.p) * 1.12, o.projAt != null ? D.proj * 1.3 : 0);
    const step = tickStep(raw), top = niceMax(raw, step);
    const A = axes({ x0: 200, x1: 1330, y0: 200, y1: 720, dx: [y0, end], dy: [0, top] });
    const ticks = []; for (let v = 0; v <= top + 1; v += step) ticks.push(v);
    eras(A, span(t, o.erasAt, o.erasAt + 0.8), D);
    yGrid(A, ticks, moneyTick);
    const xt = []; for (let y = Math.ceil(y0 / 10) * 10; y <= end; y += 10) xt.push(y);
    xLabels(A, xt, (v) => v);
    legend(A.x0, 150, [[C.blue, `Ben: ${y0}–${y0 + YEARS - 1}`], [C.fire, `Arthur: ${y0 + GEN}–${end - 1}`]]);
    if (o.projAt != null) ramseyLine(A, D, span(t, o.projAt, o.projAt + 0.8), `Ramsey: ${money(D.proj)}`);
    const now = lerp(y0, y0 + YEARS, lin(t, o.benFrom, o.benTo)) + lin(t, o.artFrom, o.artTo) * GEN;
    const pts = (p, s) => p.map((v, k) => [A.X(s + k), A.Y(v)]);
    const tb = partial(pts(ben.p, y0), clamp((now - y0) / YEARS), C.blue, 4);
    const ta = partial(pts(art.p, y0 + GEN), clamp((now - y0 - GEN) / YEARS), C.fire, 4);
    if (now > y0) dot(tb[0], tb[1], 7, C.blue, C.sunken, 3);
    if (now > y0 + GEN) dot(ta[0], ta[1], 7, C.fire, C.sunken, 3);
    const benY = A.Y(ben.v) - 16 < A.y0 + 90 ? A.Y(ben.v) + 34 : A.Y(ben.v) - 16;
    alpha(span(t, o.benLabelAt, o.benLabelAt + 0.6), () => text(`Ben: ${money(ben.v)}`, A.X(y0 + YEARS) + 12, benY, { size: 26, weight: 700, fam: "display" }));
    alpha(span(t, o.artLabelAt, o.artLabelAt + 0.6), () => text(`Arthur: ${money(art.v)}`, A.X(end) + 12, A.Y(art.v) + 8, { size: 26, weight: 700, fam: "display" }));
    if (o.depAt != null) alpha(span(t, o.depAt, o.depAt + 0.8), () => {
      const bEnd = y0 + YEARS - 1, aStart = y0 + GEN, aEnd = end - 1;
      text("Each year's deposit in the dollars of the time", 1560, 104, { size: 18, color: C.muted, align: "right" });
      text(`Ben: ${dollars(deposit(y0))} in ${y0} → ${dollars(deposit(bEnd))} in ${bEnd}`, 1560, 134, { size: 21, weight: 700, color: C.blue, align: "right" });
      text(`Arthur: ${dollars(deposit(aStart))} in ${aStart} → ${dollars(deposit(aEnd))} in ${aEnd}`, 1560, 162, { size: 21, weight: 700, color: C.fire, align: "right" });
    });
    const sonWins = art.v >= ben.v, more = sonWins ? art.v / ben.v - 1 : ben.v / art.v - 1;
    const who = sonWins ? "Arthur" : "Ben";
    const label = more >= 0.95 && more < 1.05 ? `${who} has twice as much` : more >= 1.05 && more < 2 ? `${who} has more than twice as much` : `${who} has ${pct(more, 0)} more`;
    pill(800, 805, `${D.mode === "real" ? "Same plan" : "On paper"}: ${label}`, sonWins ? "fire" : "blue", span(t, o.pillAt, o.pillAt + 0.6));
  }
  SCENES["pair-1957"] = (t, q) => familyChart(t, SETS.real, 1957, { benFrom: 0.6, benTo: q(2) + 5.0, artFrom: q(3) + 0.2, artTo: q(3) + 6.0, erasAt: q(2) + 0.4,
    benLabelAt: q(2) + 5.4, artLabelAt: q(3) + 6.5, pillAt: q(3) + 10.0, depAt: q(1) });
  SCENES["pair-1961"] = (t, q) => familyChart(t, SETS.real, 1961, { benFrom: 0.6, benTo: q(2) + 2.0, artFrom: q(3) + 0.2, artTo: q(3) + 5.5, erasAt: 0.4,
    benLabelAt: q(2) + 2.4, artLabelAt: q(3) + 7.0, pillAt: q(3) + 9.8, depAt: q(1) });
  SCENES["pair-1957-nominal"] = (t, q) => familyChart(t, SETS.nominal, 1957, { benFrom: 0.6, benTo: q(1) + 1.0, artFrom: q(1) + 1.2, artTo: q(2) + 0.6, erasAt: 0.4,
    benLabelAt: q(1) + 1.2, artLabelAt: q(2) + 0.8, pillAt: q(2) + 3.2, projAt: q(2) + 6.0 });
  SCENES["pair-1961-nominal"] = (t, q) => familyChart(t, SETS.nominal, 1961, { benFrom: 0.6, benTo: q(1) + 2.0, artFrom: q(2) + 0.2, artTo: q(2) + 4.0, erasAt: 0.4,
    benLabelAt: q(1) + 2.4, artLabelAt: q(2) + 5.6, pillAt: q(2) + 8.0, projAt: q(1) + 4.5 });

  // 5. Every 39-year window since 1945
  function windowsChart(t, q, D) {
    const raw = D.best.v * 1.12, step = tickStep(raw) * 2, top = niceMax(raw, step);
    const A = axes({ x0: 200, x1: 1440, y0: 200, y1: 720, dx: [D.WINDOWS[0].y, D.WINDOWS[D.WINDOWS.length - 1].y + 1], dy: [0, top] });
    const ticks = []; for (let v = 0; v <= top + 1; v += step) ticks.push(v);
    yGrid(A, ticks, moneyTick);
    xLabels(A, [1945, 1955, 1965, 1975, 1985], (v) => v);
    text(`First year of the ${YEARS}`, (A.x0 + A.x1) / 2, A.y1 + 66, { size: 20, color: C.muted, align: "center" });
    text(`What $2,000 a year for ${YEARS} years grew to, in ${D.unit}`, A.x0 - 60, A.y0 - 30, { size: 20, color: C.muted });
    const bw = A.X(1) - A.X(0) - 4;
    const grow = lin(t, 0.4, q(1) - 0.4);
    // the one-year contrast named at the end of the narration's second line
    const ext = span(t, q(1), q(1) + 0.8), oneYear = span(t, q(2) - (D.mode === "real" ? 7.5 : 3.5), q(2) - (D.mode === "real" ? 6.7 : 2.7));
    const ONE = [1969, 1970];
    const ram = span(t, q(2), q(2) + 0.8), pairs = span(t, q(3), q(3) + 0.8);
    D.WINDOWS.forEach((w, i) => {
      if (i / D.WINDOWS.length > grow) return;
      const hl = w === D.worst || w === D.best || (ONE.includes(w.y) && oneYear > 0);
      let a = 1;
      if (ext > 0 && ram === 0) a = lerp(1, hl ? 1 : 0.35, ext);
      if (ram > 0 && pairs === 0) a = lerp(1, w.v >= D.proj ? 1 : 0.35, ram);
      alpha(a, () => bar(A.X(w.y) + 2, A.Y(0), A.Y(w.v), bw, C.blue, 3));
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
      counter(1440, 150, "REACHED RAMSEY'S NUMBER", `${D.reached} of ${D.WINDOWS.length}`, { align: "right", size: 40, color: C.fire });
    });
    alpha(pairs, () => {
      if (D.sonAhead >= D.fatherAhead) {
        counter(1440, 150, "SON AHEAD OF FATHER", `${D.sonAhead} of ${D.PAIRS.length}`, { align: "right", size: 40, color: C.fire });
        text(`One at least 25% ahead: ${D.quarter}`, 1440, 186, { size: 22, weight: 600, color: C.muted, align: "right" });
      } else {
        counter(1440, 150, "FATHER AHEAD OF SON", `${D.fatherAhead} of ${D.PAIRS.length}`, { align: "right", size: 40, color: C.blue });
        text(`in ${D.unit}`, 1440, 186, { size: 22, weight: 600, color: C.muted, align: "right" });
      }
    });
  }
  SCENES.windows = (t, q) => windowsChart(t, q, SETS.real);
  SCENES["windows-nominal"] = (t, q) => windowsChart(t, q, SETS.nominal);

  // 6. Why: money at stake each year, over each year's return
  function whyChart(t, q, D, y0, o) {
    const sb = D.stake(y0), sa = D.stake(y0 + GEN);
    const raw = Math.max(...sb, ...sa) * 1.1, step = tickStep(raw) * 2, top = niceMax(raw, step);
    const A = axes({ x0: 200, x1: 1440, y0: 220, y1: 640, dx: [y0, y0 + GEN + YEARS], dy: [0, top] });
    eras(A, span(t, o.erasAt, o.erasAt + 0.8), D);
    const ticks = []; for (let v = 0; v <= top + 1; v += step) ticks.push(v);
    yGrid(A, ticks, moneyTick);
    text(`Money invested during each year, ${D.unit}`, A.x0 - 60, A.y0 - 30, { size: 20, color: C.muted });
    legend(A.x1 - 360, A.y0 - 30, [[C.blue, `Ben (${y0}–${y0 + YEARS - 1})`], [C.fire, `Arthur (${y0 + GEN}–${y0 + GEN + YEARS - 1})`]]);
    const w = A.X(1) - A.X(0) - 2;
    const grow = lin(t, 0.3, o.growTo);
    const late = span(t, o.lateAt, o.lateAt + 0.8);
    for (let k = 0; k < YEARS; k++) {
      if (k / YEARS > grow) break;
      const a = lerp(1, k >= YEARS - 20 ? 1 : 0.3, late);
      alpha(a, () => bar(A.X(y0 + k) + 1, A.Y(0), A.Y(sb[k]), w, C.blue, 2));
      alpha(a * 0.9, () => bar(A.X(y0 + GEN + k) + 1, A.Y(0), A.Y(sa[k]), w, C.fire, 2));
    }
    alpha(span(t, 0.8, 1.6) * (1 - late), () => text("First deposits: $2,000", A.X(y0) + 4, A.Y(0) - 40, { size: 22, weight: 700, color: C.blue }));
    // yearly return strip; in plain dollars, inflation rides on top as dots
    const rA = axes({ x0: A.x0, x1: A.x1, y0: 720, y1: 850, dx: A.dx, dy: [-0.4, 0.4] });
    alpha(span(t, 0.4, 1.0), () => {
      line(rA.x0, rA.Y(0), rA.x1, rA.Y(0), C.lineStrong, 1);
      text(D.mode === "real" ? "Stock return each year, after inflation" : "Stock return each year, plain dollars", rA.x0, rA.y0 - 6, { size: 18, color: C.muted });
      for (let y = y0; y < y0 + GEN + YEARS; y++) { const r = D.rets[idx(y)]; bar(rA.X(y) + 1, rA.Y(0), rA.Y(clamp(r, -0.4, 0.4)), w, r >= 0 ? rgba(C.ink, 0.45) : C.danger, 2); }
      xLabels(rA, [1960, 1970, 1980, 1990, 2000, 2010, 2020], (v) => v, rA.y1 + 28);
    });
    if (D.mode === "nominal") alpha(span(t, o.inflAt, o.inflAt + 0.8), () => {
      for (let y = y0; y < y0 + GEN + YEARS; y++) dot(rA.X(y) + 1 + w / 2, rA.Y(clamp(H.infl[idx(y)], -0.4, 0.4)), 4, C.fire);
      legend(rA.x1 - 230, rA.y0 - 6, [[C.fire, "Inflation that year", "dot"]]);
    });
    if (o.note) alpha(span(t, o.noteAt, o.noteAt + 0.8), () => text(o.note, 1440, 150, { size: 30, weight: 700, fam: "display", align: "right" }));
  }
  SCENES.why = (t, q) => whyChart(t, q, SETS.real, 1961, { growTo: q(1), lateAt: q(1), erasAt: q(2), note: "Sequence risk, at the end of saving", noteAt: q(3) });
  SCENES["why-nominal"] = (t, q) => {
    whyChart(t, q, SETS.nominal, 1957, { growTo: q(1) - 0.4, lateAt: q(3), erasAt: q(1), inflAt: q(1) + 6.5 });
    const bEnd = 1957 + YEARS - 1, aEnd = bEnd + GEN;
    const f = H.infl.slice(idx(bEnd + 1), idx(aEnd) + 1).reduce((a, r) => a * (1 + r), 1);
    alpha(span(t, q(2) + 4.5, q(2) + 5.3), () => text(`$1 in ${bEnd} bought what $${f.toFixed(2)} bought in ${aEnd}`, 1440, 150, { size: 30, weight: 700, fam: "display", align: "right" }));
  };

  // 7. Same plan, different decades
  function takeawayCard(t, q, D) {
    avatar(640, 240, 62, "B", C.blue, span(t, 0.3, 0.9));
    avatar(960, 250, 50, "A", C.fire, span(t, 0.5, 1.1));
    alpha(span(t, 0.8, 1.6), () => text(`Started at ${AGE0}. Never missed a year.`, 800, 390, { size: 32, weight: 600, align: "center", color: C.muted }));
    alpha(span(t, q(1), q(1) + 0.8), () => {
      text("Same plan. Different decades.", 800, 480, { size: 56, weight: 700, fam: "display", align: "center" });
      if (D.mode === "real") {
        const b = D.biggest, w = b.gap > 0 ? "son" : "father";
        text(`Since 1945, a generation apart, the ${w} ended with up to ${pct(Math.abs(b.gap), 0)} more (father from ${b.y}, son from ${b.y + GEN}).`, 800, 540, { size: 24, color: C.muted, align: "center" });
      } else {
        text(`Since 1945, only ${D.reached} of ${D.WINDOWS.length} windows reached Ramsey's ${money(D.proj)}, in plain dollars.`, 800, 540, { size: 24, color: C.muted, align: "center" });
      }
    });
    alpha(span(t, q(2), q(2) + 0.8), () => {
      if (D.mode === "real") {
        text("12% every year assumes every stretch is the same.", 800, 690, { size: 40, weight: 700, fam: "display", align: "center" });
        text("History says otherwise.", 800, 750, { size: 40, weight: 700, fam: "display", align: "center", color: C.blue });
      } else {
        text("Plain dollars or today's dollars,", 800, 690, { size: 40, weight: 700, fam: "display", align: "center" });
        text("the lesson is the same.", 800, 750, { size: 40, weight: 700, fam: "display", align: "center", color: C.blue });
      }
    });
  }
  SCENES.takeaway = (t, q) => takeawayCard(t, q, SETS.real);
  SCENES["takeaway-nominal"] = (t, q) => takeawayCard(t, q, SETS.nominal);

  // ---------- timeline ----------
  const N = window.NARRATION;
  const DATA = N ? N.scenes : [];
  if (N && N.draft) {
    document.getElementById("startHint").textContent = "Draft timing, no voiceover yet. Captions show the script. Space pauses, arrow keys skip.";
  }
  const ALL = DATA.map((s) => ({
    id: s.id, title: s.title, cues: s.cues, track: s.track || null,
    dur: s.duration + TAIL,
    audio: s.audio ? (() => { const a = new Audio(s.audio); a.preload = "auto"; return a; })() : null,
  }));
  // The story forks after the shared scenes: one track per way of counting dollars.
  // Until the viewer picks, the timeline shows the default track and playback stops at the fork.
  const FORK_AFTER = "steady";
  let track = "real", chosen = false;
  let TIMES = [], total = 0;

  let cur = 0, tIn = 0, playing = false, started = false, last = 0, muted = false, captions = true;
  const caption = document.getElementById("caption");
  const scrub = document.getElementById("scrub");
  const timeEl = document.getElementById("time");
  const chapters = document.getElementById("chapters");
  const playLabel = document.getElementById("playLabel"), playIcon = document.getElementById("playIcon");
  const choice = document.getElementById("choice");
  const trackBtns = [...document.querySelectorAll("[data-track]")];

  function buildTimeline() {
    TIMES = ALL.filter((s) => !s.track || s.track === track);
    total = 0; TIMES.forEach((s) => { s.start = total; total += s.dur; });
    chapters.innerHTML = "";
    TIMES.forEach((s, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="n">${i + 1}</span>${s.title}`;
      b.addEventListener("click", () => { if (s.track) chosen = true; seek(s.start + 0.001, true); });
      li.appendChild(b); chapters.appendChild(li);
    });
    trackBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.track === track)));
  }
  // switch tracks, keeping the place: the tracks line up scene for scene after the fork
  function setTrack(tr) {
    if (tr === track) { chosen = true; buildTimeline(); ui(); return; }
    ALL.forEach((s) => { if (s.audio) s.audio.pause(); });
    track = tr; chosen = true;
    const keep = tIn, inTrack = TIMES[cur] && TIMES[cur].track;
    buildTimeline();
    tIn = inTrack ? 0 : keep;
    syncAudio(); draw(); ui();
  }
  function showChoice(on) { choice.hidden = !on; }
  choice.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    showChoice(false);
    setTrack(b.dataset.pick);
    const fi = TIMES.findIndex((s) => s.id === FORK_AFTER);
    if (cur <= fi) { cur = fi + 1; tIn = 0; }
    setPlaying(true);
  }));
  trackBtns.forEach((b) => b.addEventListener("click", () => { showChoice(false); setTrack(b.dataset.track); }));
  buildTimeline();

  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function syncAudio() {
    const s = TIMES[cur];
    TIMES.forEach((o, i) => { if (i !== cur && o.audio) o.audio.pause(); });
    if (!s.audio) return;
    if (!playing) { s.audio.pause(); return; }
    s.audio.muted = muted;
    if (tIn < s.audio.duration - 0.05 || isNaN(s.audio.duration)) {
      if (Math.abs(s.audio.currentTime - tIn) > 0.25) { try { s.audio.currentTime = tIn; } catch (e) {} }
      if (s.audio.paused) s.audio.play().catch(() => {});
    }
  }
  function seek(gt, keepPlaying) {
    gt = clamp(gt, 0, total - 0.001);
    let i = TIMES.findIndex((s) => gt >= s.start && gt < s.start + s.dur);
    if (i < 0) i = TIMES.length - 1;
    cur = i; tIn = gt - TIMES[i].start;
    if (TIMES[i].track) chosen = true;
    showChoice(false);
    if (!started) { started = true; document.getElementById("start").hidden = true; }
    if (keepPlaying && !playing) setPlaying(true);
    syncAudio(); draw(); ui();
  }
  function setPlaying(p) {
    playing = p;
    if (p && !started) { started = true; document.getElementById("start").hidden = true; }
    if (p && cur === TIMES.length - 1 && tIn >= TIMES[cur].dur - 0.05) { cur = 0; tIn = 0; }
    playLabel.textContent = p ? "Pause" : "Play";
    playIcon.innerHTML = p ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 5v14l12-7z"/>';
    last = performance.now();
    syncAudio(); ui();
    if (p) requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const s = TIMES[cur];
    // the audio is the clock while it plays; the picture runs on after it ends
    if (s.audio && !s.audio.paused && !s.audio.ended && s.audio.currentTime > 0) tIn = s.audio.currentTime;
    else tIn += dt;
    if (tIn >= s.dur) {
      if (s.id === FORK_AFTER && !chosen) { tIn = s.dur - 0.001; setPlaying(false); showChoice(true); }
      else if (cur < TIMES.length - 1) { cur++; tIn = 0; syncAudio(); }
      else { tIn = s.dur; setPlaying(false); }
    }
    draw(); ui();
    requestAnimationFrame(tick);
  }
  let lastCue = "";
  function ui() {
    const s = TIMES[cur]; if (!s) return;
    const gt = s.start + tIn;
    scrub.value = Math.round((gt / total) * 1000);
    timeEl.textContent = `${mmss(gt)} / ${mmss(total)}`;
    [...chapters.querySelectorAll("button")].forEach((b, i) => b.setAttribute("aria-current", i === cur ? "true" : "false"));
    let cue = "";
    if (started) for (const c of s.cues) if (tIn >= c.start - 0.05) cue = c.text;
    if (cue !== lastCue) { caption.textContent = cue || " "; lastCue = cue; }
  }

  function draw() {
    if (!C.ink) readColors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = C.sunken; ctx.fillRect(0, 0, W, Hh);
    const s = TIMES[cur];
    if (!s) return;
    const q = (i) => (s.cues[i] ? s.cues[i].start : s.dur);
    eyebrow(cur + 1, s.title);
    ctx.save();
    SCENES[s.id](started ? tIn : 4.0, q, s.dur);
    ctx.restore();
    ctx.fillStyle = rgba(C.blue, 0.8);
    ctx.fillRect(0, Hh - 4, W * (started ? tIn / s.dur : 0), 4);
  }

  // ---------- controls ----------
  document.getElementById("start").addEventListener("click", () => { seek(0); setPlaying(true); });
  document.getElementById("play").addEventListener("click", () => setPlaying(!playing));
  scrub.addEventListener("input", () => seek((scrub.value / 1000) * total, false));
  const muteBtn = document.getElementById("mute");
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    ALL.forEach((s) => { if (s.audio) s.audio.muted = muted; });
    muteBtn.setAttribute("aria-pressed", String(muted));
    document.getElementById("muteLabel").textContent = muted ? "Unmute" : "Mute";
    document.getElementById("waves").style.display = muted ? "none" : "";
  });
  const ccBtn = document.getElementById("cc");
  ccBtn.addEventListener("click", () => {
    captions = !captions;
    caption.hidden = !captions;
    ccBtn.setAttribute("aria-pressed", String(captions));
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seek(TIMES[Math.min(cur + 1, TIMES.length - 1)].start + 0.001, playing); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek(tIn > 1.5 ? TIMES[cur].start : TIMES[Math.max(cur - 1, 0)].start, playing); }
  });

  // dev hook: ?t=seconds jumps there paused; ?s=scene-id&at=seconds jumps into a scene
  const qs = new URLSearchParams(location.search);
  readColors();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    resize();
    if (qs.has("t")) seek(parseFloat(qs.get("t")), false);
    if (qs.has("s")) {
      const target = ALL.find((x) => x.id === qs.get("s"));
      if (target && target.track && target.track !== track) setTrack(target.track);
      const s = TIMES.find((x) => x.id === qs.get("s")); if (s) seek(s.start + parseFloat(qs.get("at") || "0"), false);
    }
    ui();
  });
  resize();
  window.__ret = { seek, setTrack, scenes: () => TIMES.map((s) => [s.id, s.start, s.dur]) };
})();
