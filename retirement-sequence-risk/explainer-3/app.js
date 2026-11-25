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
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  // overshoots a little past 1 before settling: things land instead of just appearing
  const backOut = (x) => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  // a sweep g (0..1) across n items, each taking k item-widths to finish: item i's own progress
  const stag = (g, i, n, k = 4) => clamp((g * (n + k) - i) / k);
  // a number counting up over `d` seconds from t0
  const tally = (t, t0, d = 1.1) => easeOut(lin(t, t0, t0 + d));

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
  // a bar that grows from its baseline with a small overshoot; p is its own progress 0..1
  function growBar(x, base, end, w, color, r, p) {
    if (p <= 0) return;
    bar(x, base, lerp(base, end, backOut(p)), w, color, r);
  }
  // scale about a point while drawing fn
  function zoomAt(x, y, s, fn) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); fn(); ctx.restore(); }
  // the moving end of a line: a soft pulsing halo behind the dot
  function glow(x, y, color, t) {
    const r = 24 + 4 * Math.sin(t * 5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, 0.45)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    dot(x, y, 7, color, C.sunken, 3);
  }
  // a line of type that arrives word by word from t0; o.hi colors the listed words
  function words(s, x, y, t, t0, o) {
    o = o || {};
    const size = o.size || 44, weight = o.weight || 700, fam = o.fam || "display", gap = o.gap || 0.11;
    font(ctx, size, weight, fam);
    const ws = s.split(" "), sp = ctx.measureText(" ").width, widths = ws.map((w) => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    let cx = o.align === "center" ? x - total / 2 : o.align === "right" ? x - total : x;
    ws.forEach((w, i) => {
      const p = span(t, t0 + i * gap, t0 + i * gap + 0.4);
      if (p > 0) alpha(p * (o.a == null ? 1 : o.a), () => text(w, cx, y + (1 - p) * 18, { size, weight, fam, color: o.hi && o.hi.includes(w) ? o.hiColor || C.fire : o.color || C.ink }));
      cx += widths[i] + sp;
    });
  }
  // a jolt that decays over `d` seconds after t0 (for crashes)
  function shake(t, t0, amp = 12, d = 0.7) {
    const k = t - t0;
    if (k <= 0 || k >= d) return;
    const e = Math.pow(1 - k / d, 2) * amp;
    ctx.translate(Math.sin(k * 71) * e, Math.cos(k * 53) * e * 0.6);
  }
  function flash(t, t0, color, d = 0.9) {
    const k = t - t0;
    if (k <= 0 || k >= d) return;
    ctx.fillStyle = rgba(color, 0.16 * Math.pow(1 - k / d, 2)); ctx.fillRect(-40, -40, W + 80, Hh + 80);
  }
  function pill(x, y, label, kind, a) {
    const colors = { danger: [C.dangerSoft, C.danger], blue: [C.blueSoft, C.blue], neutral: [C.raised, C.muted], fire: [C.raised, C.fire] }[kind];
    a = a == null ? 1 : a;
    if (a <= 0) return;
    zoomAt(x, y, lerp(0.85, 1, backOut(a)), () => alpha(a, () => {
      font(ctx, 22, 600);
      const w = ctx.measureText(label).width + 54, h = 40;
      ctx.fillStyle = colors[0];
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 20); ctx.fill();
      ctx.strokeStyle = rgba(colors[1], 0.5); ctx.lineWidth = 1.5; ctx.stroke();
      dot(x - w / 2 + 21, y, 5.5, colors[1]);
      text(label, x - w / 2 + 36, y + 1, { size: 22, weight: 600, color: colors[1], base: "middle" });
    }));
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

  // ---------- hover details ----------
  // Scenes register rectangles (canvas units) with an HTML summary; the stage shows it on mouseover.
  // mark "line" draws a thin guide through the middle of the region instead of an outline (for lines).
  let HOTS = [], mouse = null;
  const hot = (x, y, w, h, html, mark) => {
    const m = ctx.getTransform();
    HOTS.push({ x: (m.a * x + m.e) / scale, y: (m.d * y + m.f) / scale, w: (m.a * w) / scale, h: (m.d * h) / scale, html, mark });
  };
  // the summary itself: a title, a note under it, then label/value rows (a third item marks the total)
  const hvBox = (title, note, rows) => `<b>${title}</b>${note ? `<span class="hv-unit">${note}</span>` : ""}` +
    rows.filter(Boolean).map(([k, v, total]) => `<div class="hv-row${total ? " hv-total" : ""}"><span>${k}</span><b>${v}</b></div>`).join("");

  // ---------- data ----------
  const idx = (y) => y - H.first;
  const START = 1e6, WR = 0.08, HORIZON = 30, FROM = 1945;
  const dollars = (v) => "$" + Math.round(v).toLocaleString("en-US");
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
  const ticksTo = (top, step) => { const out = []; for (let v = 0; v <= top + 1; v += step) out.push(v); return out; };

  const SCENES = {};

  // 1. The 8% promise
  SCENES.promise = function (t, q) {
    alpha(span(t, 0.3, 1.0), () => {
      text("Your nest egg on retirement day", 800, 190, { size: 26, color: C.muted, align: "center" });
      text(dollars(START * tally(t, 0.3, 1.6)), 800, 290, { size: 104, weight: 700, fam: "display", align: "center" });
    });
    alpha(span(t, q(1) + 0.4, q(1) + 1.1), () => {
      text("Ramsey: take about 8% a year", 800, 390, { size: 30, weight: 600, align: "center", color: C.muted });
      zoomAt(800, 440, lerp(0.8, 1, backOut(lin(t, q(1) + 1.6, q(1) + 2.3))), () =>
        text(dollars(80e3 * tally(t, q(1) + 1.6, 0.9)) + " a year", 800, 460, { size: 64, weight: 700, fam: "display", align: "center", color: C.fire }));
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
    pill(800, 760, "Retirement research: about 4%, or $40,000 a year", "blue", span(t, q(3) + 0.4, q(3) + 1.0));
  };

  // 2. In Ramsey's world, then the fork
  SCENES["ramsey-world"] = function (t, q) {
    const bal = [START], wd = [];
    let B = START;
    for (let k = 1; k <= HORIZON; k++) { const w = WR * START * Math.pow(1.04, k - 1); B = B * 1.12 - w; bal.push(B); wd.push(w); }
    const A = axes({ x0: 200, x1: 1440, y0: 190, y1: 600, dx: [0, HORIZON], dy: [0, 4.5e6] });
    // the nest egg from the last scene shrinks down onto the chart's starting point
    const land = started ? span(t, 0.1, 1.3) : 1;
    alpha(started ? span(t, 0.5, 1.2) : 1, () => {
      yGrid(A, [0, 1e6, 2e6, 3e6, 4e6], moneyTick);
      xLabels(A, [0, 5, 10, 15, 20, 25, 30], (v) => (v === 0 ? "Retire" : `year ${v}`));
      text("+12% every year, prices +4% every year", A.x0, 150, { size: 22, color: C.muted });
    });
    alpha(1 - span(t, q(1), q(1) + 1.0), () => text("$1,000,000", lerp(800, A.X(0) + 82, land), lerp(290, A.Y(START) - 22, land), { size: lerp(104, 26, land), weight: 700, fam: "display", align: "center" }));
    const f = lin(t, q(1), q(2) + 1.5);
    const tip = partial(bal.map((v, k) => [A.X(k), A.Y(v)]), f, C.ink, 4);
    if (land >= 1) glow(tip[0], tip[1], C.ink, t);
    if (f > 0 && f < 1) text(money(lerp(bal[Math.floor(f * HORIZON)], bal[Math.ceil(f * HORIZON)], f * HORIZON % 1)), tip[0] - 14, tip[1] - 22, { size: 22, weight: 700, align: "right" });
    // the withdrawals, growing 4% a year
    const bA = axes({ x0: A.x0, x1: A.x1, y0: 680, y1: 850, dx: A.dx, dy: [0, 300e3] });
    alpha(span(t, q(1), q(1) + 0.6), () => text("Withdrawal each year: $80,000, then a 4% raise every year", bA.x0, bA.y0 - 12, { size: 19, color: C.muted }));
    const bw = bA.X(1) - bA.X(0) - 6;
    wd.forEach((w, k) => {
      const p = stag(f, k, HORIZON, 2);
      growBar(bA.X(k) + 3, bA.y1, bA.Y(w), bw, rgba(C.fire, 0.85), 3, p);
      if (p <= 0) return;
      // point at a bar for that year's money movements
      hot(bA.X(k) + 3, bA.y0 - 30, bw, bA.y1 - bA.y0 + 30,
        `<b>Year ${k + 1}</b><span class="hv-unit">Ramsey's world: +12% a year, prices +4%</span>` +
        `<div class="hv-row"><span>Balance on January 1</span><b>${dollars(bal[k])}</b></div>` +
        `<div class="hv-row"><span>Growth (+12%)</span><b>+${dollars(bal[k] * 0.12)}</b></div>` +
        `<div class="hv-row"><span>${k ? "Withdrawal (4% raise)" : "First withdrawal"}</span><b>−${dollars(w)}</b></div>` +
        `<div class="hv-row hv-total"><span>Balance at year end</span><b>${dollars(bal[k + 1])}</b></div>`);
      // label the first withdrawal and every tenth year, as each bar lands
      if (k === 0 || (k + 1) % 10 === 0) alpha(span(p, 0.6, 1), () => text(`$${Math.round(w / 1000)}K`, bA.X(k) + bw / 2 + 3, bA.Y(w) - 10, { size: 18, weight: 700, align: "center" }));
    });
    alpha(span(t, q(2) + 1.6, q(2) + 2.4), () => {
      text(`${money(bal[HORIZON])}`, A.X(HORIZON), A.Y(bal[HORIZON]) - 46, { size: 30, weight: 700, fam: "display", align: "right" });
      text("buys what $1M did on day one", A.X(HORIZON), A.Y(bal[HORIZON]) - 18, { size: 20, color: C.muted, align: "right" });
    });
  };
  SCENES["ramsey-world"].ownEntrance = true;

  // track intros
  function introCard(t, q, D, lines, big, sub) {
    alpha(span(t, 0.2, 0.9), () => text(D.mode === "real" ? `Today's dollars: ${TODAY}` : "Plain dollars", 800, 230, { size: 60, weight: 700, fam: "display", align: "center", color: D.mode === "real" ? C.blue : C.fire }));
    lines.forEach((l, i) => alpha(span(t, 0.9 + i * 1.6, 1.6 + i * 1.6), () => text(l, 800, 330 + i * 46, { size: 28, color: C.muted, align: "center" })));
    words(big, 800, 600, t, q(1), { size: 80, align: "center", color: C.fire, gap: 0.16 });
    alpha(span(t, q(1) + 1.0, q(1) + 1.8), () => text(sub, 800, 660, { size: 26, color: C.muted, align: "center" }));
  }
  SCENES["real-intro"] = (t, q) => introCard(t, q, SETS.real, [`$1,000,000 at ${TODAY} prices`, "$80,000 of that buying power, every year", "no matter what the market does"], "$80,000 a year, forever?", "the lifestyle Ramsey's math promises");
  SCENES["nominal-intro"] = (t, q) => introCard(t, q, SETS.nominal, ["The same $80,000 check every year", "Balances as the statement showed them", "No raises for inflation"], "$80,000 every year", "easier on the portfolio, but each check buys a little less");

  // 4. Retire in January 2000
  function retire2000(t, q, D) {
    const r = retire(2000, D.mode), y0 = 2000;
    const endYear = y0 + Math.ceil(r.lasted) - 1;
    const A = axes({ x0: 200, x1: 1440, y0: 200, y1: 600, dx: [y0, 2026], dy: [0, 1.2e6] });
    // years drawn: first three by the end of line 1, the rest during line 2
    const a2 = q(2) + 0.2, b2 = q(2) + 3.6;
    const yearsShown = lerp(0, 3, lin(t, q(1) + 0.4, q(1) + 4.5)) + lin(t, a2, b2) * (r.lasted - 3);
    // the moment the line reaches the 2008 drop
    const tCrash = a2 + ((2008 - y0 + 0.5 - 3) / (r.lasted - 3)) * (b2 - a2);
    shake(t, tCrash, 14);
    // the year, huge and faint, ticking behind the chart
    const yr = Math.min(endYear, y0 + Math.floor(yearsShown));
    text(String(yr), A.x1, A.y1 - 30, { size: 260, weight: 800, fam: "display", align: "right", color: rgba(yr >= 2008 ? C.danger : C.ink, 0.07) });
    yGrid(A, [0, 250e3, 500e3, 750e3, 1e6], moneyTick);
    xLabels(A, [2000, 2005, 2010, 2015, 2020, 2025], (v) => v);
    text(`Balance, ${D.unit}`, A.x0 - 60, A.y0 - 30, { size: 20, color: C.muted });
    const pts = r.path.map((v, k) => [A.X(k === r.path.length - 1 ? y0 + r.lasted : y0 + k), A.Y(v)]);
    const tip = partial(pts, clamp(yearsShown / r.lasted), C.danger, 4);
    glow(tip[0], tip[1], C.danger, t);
    const broke = yearsShown >= r.lasted - 0.01;
    if (yearsShown > 0.15 && !broke) {
      const v = ((A.y1 - tip[1]) / (A.y1 - A.y0)) * A.dy[1];
      text(money(v), tip[0] + 18, tip[1] - 16, { size: 24, weight: 700, fam: "display" });
    }
    alpha(span(t, 0.4, 1.0) * (1 - span(t, q(1) + 0.4, q(1) + 1.0)), () => text("$1M on January 1, 2000", A.X(y0) + 14, A.Y(START) - 16, { size: 22, weight: 700 }));
    pill(A.X(2013), A.Y(0.85e6), "Taking $80,000 a year", "fire", span(t, q(1), q(1) + 0.6));
    // each year's return
    const bA = axes({ x0: A.x0, x1: A.x1, y0: 690, y1: 860, dx: A.dx, dy: [-0.45, 0.45] });
    alpha(span(t, 0.3, 0.9), () => { line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1); text(D.mode === "real" ? "Stock return each year, after inflation" : "Stock return each year", bA.x0, bA.y0 - 8, { size: 18, color: C.muted }); });
    const bw = bA.X(1) - bA.X(0) - 6;
    for (let y = y0; y <= endYear; y++) {
      const p = clamp((yearsShown - (y - y0)) * 1.6);
      if (p <= 0) break;
      const v = D.rets(y);
      growBar(bA.X(y) + 3, bA.Y(0), bA.Y(clamp(v, -0.45, 0.45)), bw, v >= 0 ? C.blue : C.danger, 3, p);
      // the standout years carry their own label, as on the "backwards" slide
      if (v >= 0.25 || v <= -0.2) alpha(span(p, 0.6, 1), () => {
        const cx = bA.X(y) + 3 + bw / 2, ye = bA.Y(clamp(v, -0.45, 0.45)), up = v >= 0;
        text(`${up ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`, cx, up ? ye - 24 : ye + 18, { size: 16, weight: 700, align: "center", color: up ? C.ink : C.danger });
        text(String(y), cx, up ? ye - 8 : ye + 34, { size: 14, color: C.muted, align: "center" });
      });
      // the year's money movements on hover
      const k = y - y0, last = k + 1 >= r.path.length - 1 && r.status === "fail";
      hot(A.X(y), A.y0, A.X(1) - A.X(0), bA.y1 - A.y0, hvBox(`${y}`, `year ${k + 1} of retirement, ${D.unit}`, [
        ["Balance on January 1", dollars(r.path[k])],
        [D.mode === "real" ? "Stocks, after inflation" : "Stocks", spct(v)],
        ["Withdrawal", last ? `wanted $80,000, only ${dollars(r.path[k] * (1 + D.rets(y)))} left` : "−$80,000"],
        ["Balance at year end", last ? "$0, broke" : dollars(r.path[k + 1]), true],
      ]));
    }
    if (broke) alpha(span(t, q(2) + 3.6, q(2) + 4.2), () => {
      const [x, y] = pts[pts.length - 1];
      zoomAt(x, y, lerp(2.2, 1, backOut(lin(t, q(2) + 3.6, q(2) + 4.1))), () => cross(x, y, 12, C.danger));
      text(`Broke in ${endYear}`, x + 22, y - 18, { size: 30, weight: 700, fam: "display", color: C.danger });
    });
    flash(t, tCrash, C.danger);
  }
  SCENES["retire-2000"] = (t, q) => retire2000(t, q, SETS.real);
  SCENES["retire-2000-nominal"] = (t, q) => retire2000(t, q, SETS.nominal);

  // 5. Same years, backwards
  function backwards(t, q, D) {
    const fwd = retire(2000, D.mode), rev = retire(2000, D.mode, WR, true), n = fwd.n;
    const top = Math.max(...rev.path) * 1.12, step = tickStep(top);
    const A = axes({ x0: 200, x1: 1400, y0: 200, y1: 580, dx: [0, n], dy: [0, Math.ceil(top / step) * step] });
    yGrid(A, ticksTo(A.dy[1], step), moneyTick);
    xLabels(A, [0, 5, 10, 15, 20, 25], (v) => (v === 0 ? "Retire" : `year ${v}`));
    legend(A.x0, 150, [[C.danger, "Real order, 2000 → 2025"], [C.fire, "Reversed, 2025 → 2000"]]);
    partial(fwd.path.map((v, k) => [A.X(k === fwd.path.length - 1 ? fwd.lasted : k), A.Y(v)]), 1, C.danger, 4);
    text(`Broke in year ${Math.ceil(fwd.lasted)}`, A.X(fwd.lasted) + 14, A.Y(0) - 16, { size: 21, weight: 700, color: C.danger });
    const avg = cagr(fwd.seq.map(D.rets));
    pill(1150, 160, `Same average: ${spct(avg)} a year`, "neutral", span(t, 1.0, 1.6));
    // the returns, sliding into reverse order
    const bA = axes({ x0: A.x0, x1: A.x1, y0: 670, y1: 860, dx: A.dx, dy: [-0.45, 0.45] });
    line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1);
    const flip = span(t, q(1) + 0.4, q(2) - 0.3);
    const bw = bA.X(1) - bA.X(0) - 6;
    const g = lin(t, 0.3, 1.8);
    fwd.seq.forEach((y, i) => {
      const v = D.rets(y), pos = lerp(i, n - 1 - i, flip);
      // each bar hops over its neighbors on the way to its new place
      const hop = Math.sin(Math.PI * flip) * (i % 2 ? 14 : -14) * Math.min(1, Math.abs(n - 1 - 2 * i) / 6);
      const p = stag(g, i, n, 4), x = bA.X(pos) + 3, end = bA.Y(clamp(v, -0.45, 0.45)) + hop;
      growBar(x, bA.Y(0) + hop, end, bw, v >= 0 ? C.blue : C.danger, 3, p);
      if (p <= 0) return;
      // the standout years carry their own label, and travel with their bar
      if (v >= 0.25 || v <= -0.2) alpha(span(p, 0.6, 1), () => {
        const cx = x + bw / 2, up = v >= 0, pctTxt = `${up ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;
        text(pctTxt, cx, up ? end - 24 : end + 18, { size: 16, weight: 700, align: "center", color: up ? C.ink : C.danger });
        text(String(y), cx, up ? end - 8 : end + 34, { size: 14, color: C.muted, align: "center" });
      });
      // point at a bar for that year's numbers
      const di = idx(y);
      hot(x - 3, bA.y0, bw + 6, bA.y1 - bA.y0 + 30,
        `<b>${y}</b><span class="hv-unit">year ${i + 1} of the real order, year ${n - i} reversed</span>` +
        (D.mode === "real"
          ? `<div class="hv-row"><span>Stocks</span><b>${spct(H.stocks[di])}</b></div><div class="hv-row"><span>Prices</span><b>${spct(H.infl[di])}</b></div>` +
            `<div class="hv-row hv-total"><span>After inflation</span><b>${spct(v)}</b></div>`
          : `<div class="hv-row hv-total"><span>Stocks</span><b>${spct(v)}</b></div><div class="hv-row"><span>Prices (not counted in plain dollars)</span><b>${spct(H.infl[di])}</b></div>`));
    });
    text(flip < 0.5 ? "Each year's return, in the real order" : "The same returns, last year first", bA.x0, bA.y0 - 18, { size: 19, weight: 600, color: C.muted });
    const rf = lin(t, q(2) + 0.2, q(2) + 4.0);
    const rpts = rev.path.map((v, k) => [A.X(k), A.Y(v)]);
    const tip = partial(rpts, rf, C.fire, 4);
    if (rf > 0) glow(tip[0], tip[1], C.fire, t);
    if (rf > 0) {
      const f = rf * (rpts.length - 1), k = Math.min(Math.floor(f), rev.path.length - 2);
      text(money(lerp(rev.path[k], rev.path[k + 1], f - k)), tip[0] + 16, tip[1] + 8, { size: rf >= 1 ? 28 : 22, weight: 700, fam: "display" });
    }
    words("Only the order changed.", 1400, 236, t, q(3) + 0.4, { size: 40, align: "right", hi: ["order"] });
  }
  SCENES.backwards = (t, q) => backwards(t, q, SETS.real);
  SCENES["backwards-nominal"] = (t, q) => backwards(t, q, SETS.nominal);

  // 6. Every retirement since 1945
  function every(t, q, D) {
    const A = axes({ x0: 200, x1: 1440, y0: 220, y1: 720, dx: [FROM, H.last + 1], dy: [0, HORIZON] });
    yGrid(A, [0, 10, 20, 30], (v) => `${v} yrs`);
    xLabels(A, [1945, 1955, 1965, 1975, 1985, 1995, 2005, 2015, 2025], (v) => v);
    text("Year of retirement", (A.x0 + A.x1) / 2, A.y1 + 66, { size: 20, color: C.muted, align: "center" });
    text("How many years the money lasted", A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted });
    legend(A.x1 - 560, A.y0 - 34, [[C.blue, "Lasted 30 years"], [C.danger, "Ran out"], [C.muted, "Still going"]]);
    const bw = A.X(1) - A.X(0) - 3;
    const grow = lin(t, 0.4, q(1) - 0.3);
    const recent = span(t, q(2), q(2) + 0.8), last = span(t, q(3), q(3) + 0.8);
    const morph = D.mode === "real" ? span(t, q(3) + 0.6, q(3) + 3.0) : 0;
    // the narrator names two recent retirees: point them out
    const named = D.mode === "real" ? span(t, q(2) + 5.2, q(2) + 5.8) * (1 - last) : 0;
    D.all.forEach((r, i) => {
      const p = stag(grow, i, D.all.length, 6);
      if (p <= 0) return;
      const f = D.four[i];
      const h = lerp(Math.min(r.years, HORIZON), Math.min(f.years, HORIZON), morph);
      const st = morph > 0.5 ? f.status : r.status;
      let a = 1;
      if (recent > 0 && last === 0) a = lerp(1, r.n < HORIZON ? 1 : 0.35, recent);
      if (named > 0 && r.y0 !== 2000 && r.y0 !== 2007) a = lerp(a, 0.25, named);
      if (D.mode === "nominal" && last > 0) a = lerp(1, r.n === HORIZON && r.status === "fail" ? 1 : 0.3, last);
      // a bar that changes color in the morph gets a quick pulse
      const flipped = D.mode === "real" && f.status !== r.status ? Math.sin(Math.PI * clamp((morph - 0.35) / 0.3)) : 0;
      alpha(a, () => growBar(A.X(r.y0) + 1.5 - flipped * 2, A.Y(0), A.Y(h), bw + flipped * 4, statusColor(st), 2, p));
      // kept short so each row fits on one line
      const outcome = (x) => (x.status === "fail" ? `out in ${x.y0 + Math.ceil(x.lasted) - 1}, ${x.lasted.toFixed(1)} yrs`
        : x.status === "running" ? `${x.n} yrs so far, ${money(x.end)} left` : `30 yrs, ${money(x.end)} left`);
      hot(A.X(r.y0) + 1.5, A.y0, bw, A.y1 - A.y0, hvBox(`Retired ${r.y0}`, `${D.unit}; $80,000 is 8%, $40,000 is 4%`, [["At 8%", outcome(r)], ["At 4%", outcome(f)]]));
    });
    if (named > 0) [2000, 2007].forEach((y) => {
      const r = D.all[y - FROM], x = A.X(y) + bw / 2 + 1.5, top = A.Y(Math.min(r.years, HORIZON));
      alpha(named, () => {
        line(x, top - 8, x, top - 44 + (1 - named) * 16, C.danger, 2);
        text(`${y}: out by ${y + Math.ceil(r.years) - 1}`, x, top - 54 + (1 - named) * 16, { size: 21, weight: 700, color: C.danger, align: "center" });
      });
    });
    const c = (label, value, color) => counter(1440, 160, label, value, { align: "right", size: 40, color });
    const of = (v, n) => `${Math.round(v)} of ${n}`;
    alpha(span(t, q(1), q(1) + 0.8) * (1 - recent), () => c(`LASTED 30 YEARS AT 8%`, of(D.okCount * tally(t, q(1)), D.done.length), C.blue));
    alpha(recent * (1 - last), () => c(`RETIRED ${D.recent[0].y0} OR LATER: ALREADY OUT`, of(D.recentFails.length * tally(t, q(2)), D.recent.length), C.danger));
    // the count climbs with the bars as they morph to 4%
    if (D.mode === "real") alpha(last, () => c(morph > 0.5 ? "AT 4%: LASTED 30 YEARS" : "LASTED 30 YEARS AT 8%", of(lerp(D.okCount, D.fourOk, morph), D.done.length), C.blue));
    else alpha(last, () => {
      const f = D.done.filter((r) => r.status === "fail");
      c("FULL-LENGTH FAILURES", f.map((r) => r.y0).join(", "), C.danger);
    });
  }
  SCENES.every = (t, q) => every(t, q, SETS.real);
  SCENES["every-nominal"] = (t, q) => every(t, q, SETS.nominal);

  // 6b. An inheritance for the grandchildren? What each full 30-year retirement left behind
  function inheritance(t, q, D) {
    const ends = (wr) => D.done.map((r) => {
      const x = wr === WR ? r : retire(r.y0, D.mode, wr);
      return { y0: r.y0, end: x.status === "fail" ? 0 : x.end };
    });
    const at8 = ends(WR), at4 = ends(0.04);
    // plain dollars: what the leftover would buy at retirement-day prices
    const buys = at8.map((e) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(e.y0 + k)]; return { y0: e.y0, end: e.end / p }; });
    const morph = span(t, q(D.mode === "real" ? 3 : 2) + (D.mode === "real" ? 0.4 : 5.0), q(D.mode === "real" ? 3 : 2) + (D.mode === "real" ? 2.8 : 7.4));
    const target = D.mode === "real" ? at4 : buys;
    // plain dollars rescale when the bars shrink to retirement-day buying power
    const top = D.mode === "real" ? 8e6 : lerp(25e6, 8e6, morph), step = D.mode === "real" || morph > 0.5 ? 2e6 : 5e6;
    const A = axes({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [D.done[0].y0, D.done[D.done.length - 1].y0 + 1], dy: [0, top] });
    alpha(span(t, q(1), q(1) + 0.6), () => {
      yGrid(A, ticksTo(top, step).filter((v) => v <= top + 1), moneyTick);
      xLabels(A, [1945, 1955, 1965, 1975, 1985, 1995], (v) => v);
      text("Year of retirement", (A.x0 + A.x1) / 2, A.y1 + 66, { size: 20, color: C.muted, align: "center" });
      const what = D.mode === "real" ? `Left after 30 years, ${D.unit}` : morph > 0.5 ? "Left after 30 years, in retirement-day buying power" : "Left after 30 years, plain dollars";
      text(what, A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted });
    });
    // the verse, then the chart
    const verse = 1 - span(t, q(1) - 0.2, q(1) + 0.4);
    if (verse > 0) {
      words("“A good man leaves an inheritance", 800, 380, t, 2.8, { size: 52, align: "center", a: verse, hi: ["inheritance"], hiColor: C.blue, gap: 0.16 });
      words("to his children's children.”", 800, 450, t, 4.0, { size: 52, align: "center", a: verse, gap: 0.16 });
      alpha(span(t, 0.6, 1.2) * verse, () => text("Proverbs 13:22", 800, 520, { size: 26, color: C.muted, align: "center" }));
    }
    const grow = lin(t, q(1) + 0.4, q(2) - 0.4);
    const sort = span(t, q(2), q(2) + 0.8);
    const bw = A.X(1) - A.X(0) - 4;
    at8.forEach((e, i) => {
      const p = stag(grow, i, at8.length, 5);
      if (p <= 0) return;
      const v = lerp(e.end, target[i].end, morph);
      const x = A.X(e.y0) + 2;
      const col = v <= 0 ? C.danger : v < START ? C.fire : C.blue;
      let a = 1;
      if (D.mode === "real" && sort > 0 && morph === 0) a = lerp(1, e.end < START ? 1 : 0.35, sort);
      alpha(a, () => {
        if (v > 0) growBar(x, A.Y(0), A.Y(Math.min(v, top)), bw, col, 3, p);
        else zoomAt(x + bw / 2, A.Y(0) - 10, backOut(p), () => { ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.lineCap = "round"; const cx = x + bw / 2, cy = A.Y(0) - 10; ctx.beginPath(); ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6); ctx.stroke(); });
        hot(x, A.y0, bw, A.y1 - A.y0, hvBox(`Retired ${e.y0}`, `what was left after 30 years`, D.mode === "real"
          ? [["At 8%, today's dollars", e.end > 0 ? dollars(e.end) : "nothing"], ["At 4%, today's dollars", target[i].end > 0 ? dollars(target[i].end) : "nothing"]]
          : [["At 8%, plain dollars", e.end > 0 ? dollars(e.end) : "nothing"], ["In retirement-day dollars", e.end > 0 ? dollars(target[i].end) : "nothing"]]));
      });
    });
    alpha(span(t, q(1) + 0.6, q(1) + 1.2), () => {
      line(A.x0, A.Y(START), A.x1, A.Y(START), C.ink, 2, [8, 6]);
      const lab = "What they started with: $1M";
      font(ctx, 19, 700);
      const w = ctx.measureText(lab).width + 14;
      ctx.fillStyle = rgba(C.sunken, 0.9); ctx.fillRect(A.x1 - w, A.Y(START) - 32, w, 26);
      text(lab, A.x1 - 7, A.Y(START) - 13, { size: 19, weight: 700, align: "right" });
    });
    alpha(span(t, q(1), q(1) + 0.6), () => legend(A.x0, 150, [[C.blue, "Left $1M or more", "dot"], [C.fire, "Left less than $1M", "dot"], [C.danger, "Left nothing", "dot"]]));
    // the biggest inheritance on screen gets a label once every bar is up
    if (grow >= 1) {
      const vals = at8.map((e, i) => lerp(e.end, target[i].end, morph)), mi = vals.indexOf(Math.max(...vals));
      const bwm = A.X(1) - A.X(0) - 4;
      text(`${at8[mi].y0}: ${money(vals[mi])}`, A.X(at8[mi].y0) + 2 + bwm / 2, A.Y(Math.min(vals[mi], top)) - 10, { size: 18, weight: 700, align: "center" });
    }
    const count = (arr) => [arr.filter((e) => e.end <= 0).length, arr.filter((e) => e.end > 0 && e.end < START).length];
    const [z8, u8] = count(at8), [zT, uT] = count(target);
    // the counts run with the bars as they morph
    const zero = Math.round(lerp(z8, zT, morph) * tally(t, q(2))), under = Math.round(lerp(u8, uT, morph) * tally(t, q(2)));
    alpha(sort, () => {
      const label = morph > 0.5 ? (D.mode === "real" ? "AT 4%: LEFT NOTHING" : "IN RETIREMENT-DAY BUYING POWER") : "AT 8%: LEFT NOTHING";
      if (D.mode === "nominal" && morph > 0.5) counter(1440, 160, label, `${zero + under} of ${at8.length} below $1M`, { align: "right", size: 40, color: C.fire });
      else counter(1440, 160, label, `${zero} of ${at8.length}`, { align: "right", size: 40, color: C.danger });
      if (!(D.mode === "nominal" && morph > 0.5)) text(`Less than $1M: ${under}`, 1440, 196, { size: 22, weight: 600, color: C.muted, align: "right" });
    });
  }
  SCENES.inheritance = (t, q) => inheritance(t, q, SETS.real);
  SCENES["inheritance-nominal"] = (t, q) => inheritance(t, q, SETS.nominal);

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
    const L = q(2), steps = D.mode === "real" ? [2.6, 4.6, 8.4, 10.2, 15.0, 20.4] : [2.7, 4.6, 8.5, 10.6, 13.0, 17.9];
    const at = (i) => span(t, L + steps[i], L + steps[i] + 0.5);
    const roll = (i, v) => v * tally(t, L + steps[i], 0.8);
    const r0 = r.rows[0], r1 = r.rows[1];
    const bw = A.X(1) - A.X(0) - 6;
    const first = r.checks[0], low = Math.min(...r.checks), lowI = r.checks.indexOf(low);
    // camera: push in on the first two bars while the ledger builds, pull back for the rest
    const cam = span(t, L + 1.4, L + 3.0) * (1 - span(t, q(3) - 0.3, q(3) + 1.4));
    // spotlight on the post-crash check while the narrator names it
    const spot = span(t, q(3) + 3.5, q(3) + 4.1) * (1 - span(t, q(4) - 0.2, q(4) + 0.6));
    const sweep = lin(t, q(3) + 0.2, q(4) + 2.0);
    const prog = (i) => (i === 0 ? lin(t, L + steps[1], L + steps[1] + 0.7) : i === 1 ? lin(t, L + steps[5], L + steps[5] + 0.7) : stag(sweep, i - 2, n - 2, 3));

    zoomAt(A.x0 - 30, A.y1 - 40, 1 + 0.5 * cam, () => {
      alpha(span(t, q(1), q(1) + 0.6), () => {
        yGrid(A, [0, 25e3, 50e3, 75e3], moneyTick);
        alpha(1 - cam, () => yGrid(A, [100e3], moneyTick)); // would run into the chapter label when zoomed
        xLabels(A, [2000, 2005, 2010, 2015, 2020, 2025], (v) => v);
        alpha(1 - cam, () => text(`Retired January 2000: each year's check, ${D.unit}`, A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted }));
        line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
        text("The plan: $80,000", A.X(2004), A.Y(80e3) - 10, { size: 19, weight: 700 });
      });
      r.checks.forEach((c, i) => {
        const p = prog(i);
        if (p <= 0) return;
        const x = A.X(y0 + i) + 3;
        alpha(i === lowI ? 1 : lerp(1, 0.3, spot), () => growBar(x, A.Y(0), A.Y(c), bw, c < 40e3 ? C.danger : c < 60e3 ? C.fire : C.blue, 3, p));
        hot(x, A.y0, bw, A.y1 - A.y0, rowHtml(r.rows[i], D.mode));
      });
      alpha(at(1), () => text(`2000: ${money(first)}`, A.X(y0) + 3, A.Y(first) - 12, { size: 21, weight: 700 }));
      alpha(span(t, L + steps[5] + 0.3, L + steps[5] + 0.8) * cam, () => text(`2001: ${money(r.checks[1])}`, A.X(y0 + 1) + 3, A.Y(r.checks[1]) - 12, { size: 21, weight: 700 }));
      alpha(span(t, q(3) + 3.5, q(3) + 4.1), () => {
        const x = A.X(y0 + lowI) + bw / 2 + 3, yl = A.Y(66e3);
        line(x, A.Y(low) - 4, x, lerp(A.Y(low) - 4, yl + 8, span(t, q(3) + 3.5, q(3) + 4.0)), C.danger, 2);
        text(`${y0 + lowI}, after the 2008 crash: ${money(low)}, down ${Math.round((1 - low / r.checks[lowI - 1]) * 100)}%`, x - 6, yl, { size: 21, weight: 700, color: C.danger });
      });
      alpha(span(t, q(4) + 2.0, q(4) + 2.6), () => {
        const after = r.checks.slice(lowI);
        text(D.mode === "real" ? `${y0 + lowI}–${y0 + n - 1}: never above ${money(Math.max(...after))}` : `${y0 + n - 1}: only back to ${money(r.checks[n - 1])}`,
          A.X(y0 + n) - 4, A.Y(D.mode === "real" ? Math.max(...after) : r.checks[n - 1]) - 40, { size: 21, weight: 700, align: "right" });
      });
    });
    // the idea, before the chart
    const idea = 1 - span(t, q(1) - 0.2, q(1) + 0.4);
    if (idea > 0) {
      words("Take 8% of whatever is there,", 800, 400, t, 0.4, { size: 52, align: "center", a: idea, hi: ["8%"] });
      words("every year.", 800, 470, t, 1.4, { size: 52, align: "center", a: idea, color: C.fire });
    }
    const box = 1 - span(t, q(3) - 0.2, q(3) + 0.4);
    const boxIn = lin(t, L, L + 0.6);
    if (boxIn > 0 && box > 0) zoomAt(1070, 250, lerp(0.92, 1, backOut(boxIn)), () => alpha(ease(boxIn) * box, () => {
      const bx = 720, by = 250, bwid = 700, rows = [
        ["January 2000: the nest egg", dollars(roll(0, r0.start)), C.ink],
        ["Take 8%: the first check", "−" + dollars(roll(1, r0.check)), C.fire],
        ["Left invested for the year", dollars(roll(2, r0.invested)), C.ink],
        [D.mode === "real" ? `2000: stocks ${spct(r0.ret)}, prices ${spct(r0.infl)}` : `2000: stocks ${spct(r0.ret)}`, "", C.danger],
        [D.mode === "real" ? "January 2001, in today's dollars" : "January 2001", dollars(roll(4, r0.end)), C.ink],
        ["Take 8%: the second check", "−" + dollars(roll(5, r1.check)), C.fire],
      ];
      ctx.fillStyle = rgba(C.raised, 0.96); ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(bx, by, bwid, 64 + rows.length * 54, 16); ctx.fill(); ctx.stroke();
      rows.forEach(([label, value, col], i) => alpha(at(i), () => {
        const y = by + 56 + i * 54 + (1 - at(i)) * 14;
        text(label, bx + 28, y, { size: 24, weight: 600, color: i === 3 ? col : C.muted });
        if (value) text(value, bx + bwid - 28, y, { size: 30, weight: 700, fam: "display", align: "right", color: col });
      }));
    }));
    pill(800, 790, `Never runs out: ${money(r.bal[r.bal.length - 1])} left in ${y0 + n - 1}`, "neutral", span(t, q(1) + 1.0, q(1) + 1.6) * (1 - span(t, q(2), q(2) + 0.4)) + span(t, q(3), q(3) + 0.6));
    alpha(span(t, q(3) + 0.4, q(3) + 1.0), () => text("Point at any bar for that year's money movements", A.x1, A.y0 - 34, { size: 18, color: C.muted, align: "right" }));
  }
  SCENES.percent = (t, q) => percent(t, q, SETS.real);
  SCENES["percent-nominal"] = (t, q) => percent(t, q, SETS.nominal);

  function percentEvery(t, q, D) {
    const runs = SETS[D.mode].done.map((r) => pctRun(r.y0, D.mode));
    const lean = runs.map((r) => ({ y0: r.y0, v: Math.min(...r.checks) }));
    const bar1 = D.mode === "real" ? 40e3 : 60e3; // the threshold the narration counts
    const top = Math.ceil(Math.max(100e3, Math.max(...lean.map((e) => e.v)) * 1.05) / 25e3) * 25e3;
    const A = axes({ x0: 200, x1: 1440, y0: 230, y1: 720, dx: [runs[0].y0, runs[runs.length - 1].y0 + 1], dy: [0, top] });
    yGrid(A, ticksTo(top, 25e3), moneyTick);
    xLabels(A, [1945, 1955, 1965, 1975, 1985, 1995], (v) => v);
    text("Year of retirement", (A.x0 + A.x1) / 2, A.y1 + 66, { size: 20, color: C.muted, align: "center" });
    text(`Leanest year's check, taking 8% of what's left, ${D.unit}`, A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted });
    line(A.x0, A.Y(80e3), A.x1, A.Y(80e3), C.ink, 2, [8, 6]);
    text("The plan: $80,000", A.x1, A.Y(80e3) - 10, { size: 19, weight: 700, align: "right" });
    const bw = A.X(1) - A.X(0) - 4;
    const grow = lin(t, 0.4, q(1) - 0.3);
    const thr = span(t, q(2), q(2) + 0.8);
    const worst = lean.reduce((a, e) => (e.v < a.v ? e : a));
    // spotlight on the worst retiree when the narrator names it
    const spot = span(t, q(2) + 5.0, q(2) + 5.6) * (1 - span(t, q(3) - 0.2, q(3) + 0.6));
    lean.forEach((e, i) => {
      const p = stag(grow, i, lean.length, 5);
      if (p <= 0) return;
      let a = thr > 0 ? lerp(1, e.v < bar1 ? 1 : 0.35, thr) : 1;
      if (e !== worst) a = lerp(a, 0.2, spot);
      alpha(a, () => growBar(A.X(e.y0) + 2, A.Y(0), A.Y(e.v), bw, e.v < bar1 ? C.danger : C.blue, 3, p));
      const run = runs[i], li = run.checks.indexOf(e.v);
      hot(A.X(e.y0) + 2, A.y0, bw, A.y1 - A.y0,
        `<b>Retired January ${e.y0}</b><span class="hv-unit">${D.mode === "real" ? `today's dollars (${TODAY})` : "plain dollars"}</span>` +
        `<div class="hv-row"><span>First check (${e.y0})</span><b>${dollars(run.checks[0])}</b></div>` +
        `<div class="hv-row"><span>Leanest check (${e.y0 + li})</span><b>${dollars(e.v)}</b></div>` +
        `<div class="hv-row"><span>Largest check (${e.y0 + run.checks.indexOf(Math.max(...run.checks))})</span><b>${dollars(Math.max(...run.checks))}</b></div>` +
        `<div class="hv-row"><span>Last check (${e.y0 + run.checks.length - 1})</span><b>${dollars(run.checks[run.checks.length - 1])}</b></div>` +
        `<div class="hv-row hv-total"><span>Left after 30 years</span><b>${dollars(run.bal[run.bal.length - 1])}</b></div>`);
    });
    const sorted = lean.map((e) => e.v).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    alpha(span(t, q(1), q(1) + 0.8) * (1 - thr), () => {
      line(A.x0, A.Y(med), A.x1, A.Y(med), C.fire, 2.5, [4, 6]);
      counter(1440, 160, "TYPICAL LEANEST YEAR", money(med * tally(t, q(1))), { align: "right", size: 40, color: C.fire });
    });
    alpha(thr, () => {
      line(A.x0, A.Y(bar1), A.x1, A.Y(bar1), C.danger, 2, [4, 6]);
      counter(1440, 160, `A YEAR BELOW ${money(bar1)}`, `${Math.round(lean.filter((e) => e.v < bar1).length * tally(t, q(2)))} of ${lean.length}`, { align: "right", size: 40, color: C.danger });
      text(`Worst: ${worst.y0}, ${money(worst.v)}`, 1440, 196, { size: 22, weight: 600, color: C.muted, align: "right" });
    });
    if (spot > 0) alpha(spot, () => {
      const x = A.X(worst.y0) + 2 + bw / 2, y = A.Y(worst.v), yl = A.Y(bar1 + 22e3);
      line(x, y - 6, x, lerp(y - 6, yl + 10, spot), C.danger, 2);
      text(`${worst.y0}: ${money(worst.v)}`, x, yl, { size: 26, weight: 700, fam: "display", color: C.danger, align: "center" });
    });
    words(D.mode === "real" ? "The money lasts. The lifestyle doesn't." : "The money lasts. The paycheck swings.", 800, 160, t, q(3), { size: 34, align: "center", hi: ["doesn't.", "swings."], hiColor: C.danger });
  }
  SCENES["percent-every"] = (t, q) => percentEvery(t, q, SETS.real);
  SCENES["percent-every-nominal"] = (t, q) => percentEvery(t, q, SETS.nominal);

  // 7a. Why the first years matter: the withdrawal as a share of what's left
  SCENES.why = function (t, q) {
    const r = retire(2000, "real"), yrs = r.rate.slice(0, 9);
    const A = axes({ x0: 240, x1: 1360, y0: 200, y1: 700, dx: [2000, 2009], dy: [0, 0.8] });
    yGrid(A, [0, 0.2, 0.4, 0.6, 0.8], (v) => Math.round(v * 100) + "%");
    xLabels(A, [2000, 2002, 2004, 2006, 2008], (v) => v);
    text("This year's $80,000 as a share of the balance", A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted });
    const bw = A.X(1) - A.X(0) - 24;
    const grow = lin(t, q(1) + 0.2, q(2) - 0.4);
    // the last line is about the crash year: everything else steps back
    const spot = span(t, q(2), q(2) + 0.8);
    yrs.forEach((v, i) => {
      const p = stag(grow, i, yrs.length, 1.5);
      if (p <= 0) return;
      const h = Math.min(v, 0.8) * backOut(p);
      alpha(i === 8 ? 1 : lerp(1, 0.3, spot), () => {
        bar(A.X(2000 + i) + 12, A.Y(0), A.Y(h), bw, v > 0.5 ? C.danger : v > 0.15 ? C.fire : C.blue, 6);
        if ([0, 2, 6, 8].includes(i)) text(`${Math.round(v * 100 * easeOut(p))}%`, A.X(2000 + i) + 12 + bw / 2, A.Y(h) - 12, { size: i === 8 ? 30 : 24, weight: 700, fam: i === 8 ? "display" : "body", align: "center", color: i === 8 ? C.danger : C.ink });
      });
      hot(A.X(2000 + i) + 12, A.y0, bw, A.y1 - A.y0, hvBox(`${2000 + i}`, "retired January 2000, today's dollars", [
        ["Balance at year end, before the check", dollars(80e3 / v)],
        ["The check", "$80,000"],
        ["Share of the balance", pct(v, 0), true],
      ]));
    });
    const intro = 1 - span(t, q(1), q(1) + 0.4);
    if (intro > 0) words("A bigger bite out of a smaller pile", 800, 450, t, 0.4, { size: 44, align: "center", a: intro, hi: ["bigger", "smaller"] });
    words("Spent after a crash, it isn't there for the recovery.", 1360, 150, t, q(2), { size: 28, align: "right", gap: 0.08, hi: ["crash,"], hiColor: C.danger });
  };

  // 7b. The hidden cost of a flat check
  SCENES["hidden-cost"] = function (t, q) {
    const y0 = 1982, buys = [];
    let p = 1;
    for (let k = 0; k < HORIZON; k++) { p *= 1 + H.infl[idx(y0 + k)]; buys.push(WR * START / p); }
    const A = axes({ x0: 200, x1: 1440, y0: 200, y1: 680, dx: [y0, y0 + HORIZON], dy: [0, 100e3] });
    yGrid(A, [0, 25e3, 50e3, 75e3, 100e3], moneyTick);
    xLabels(A, [1985, 1990, 1995, 2000, 2005, 2010], (v) => v);
    text("Retired in 1982: each year's $80,000 check, and what it bought in 1982 dollars", A.x0 - 60, A.y0 - 34, { size: 20, color: C.muted });
    const bw = A.X(1) - A.X(0) - 6;
    const grow = lin(t, 0.4, q(1) + 8.0);
    buys.forEach((v, k) => {
      const p = stag(grow, k, HORIZON, 2);
      if (p <= 0) return;
      const x = A.X(y0 + k) + 3;
      alpha(ease(p), () => { ctx.strokeStyle = rgba(C.fire, 0.7); ctx.lineWidth = 2; ctx.strokeRect(x, A.Y(WR * START), bw, A.Y(0) - A.Y(WR * START)); });
      growBar(x, A.Y(0), A.Y(v), bw, C.blue, 3, p);
      // what the check bought at the start and every ten years after (the 30th has its own label)
      if (k === 0 || k === 9 || k === 19) alpha(span(p, 0.6, 1), () => text(`${y0 + k}: ${money(v)}`, k ? x + bw / 2 : x, A.Y(v) - 12, { size: 18, weight: 700, align: k ? "center" : "left" }));
      hot(x, A.y0, bw, A.y1 - A.y0, hvBox(`${y0 + k}`, `year ${k + 1} of retirement`, [
        ["The check", "$80,000"],
        ["Prices since January 1982", `+${Math.round((WR * START / v - 1) * 100)}%`],
        ["What it bought, in 1982 dollars", dollars(v), true],
      ]));
    });
    legend(A.x0, A.y1 + 70, [[C.fire, "The check: $80,000"], [C.blue, "What it bought, in 1982 dollars"]]);
    alpha(span(t, q(1) + 8.0, q(1) + 8.8), () => {
      const v = buys[HORIZON - 1];
      text(`${y0 + HORIZON - 1}: ${money(v)}`, A.X(y0 + HORIZON - 1) + bw / 2 + 3, A.Y(v) - 14, { size: 24, weight: 700, align: "center" });
    });
    alpha(span(t, q(2), q(2) + 0.8), () => {
      const lastBuys = SETS.nominal.done.map((r) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(r.y0 + k)]; return WR * START / p; });
      counter(1440, 160, "THE 30TH CHECK, EVERY RETIREMENT SINCE 1945", `${money(Math.min(...lastBuys))}–${money(Math.max(...lastBuys))}`, { align: "right", size: 40, color: C.blue });
    });
  };

  // 8. What history says
  function takeaway(t, q, D) {
    // cards land with a little bounce; `value` is a function of how far its count has run
    const card = (x, title, value, sub, col, a) => a > 0 && zoomAt(x, 310, lerp(0.85, 1, backOut(a)), () => alpha(a, () => {
      ctx.fillStyle = C.raised; ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 270, 190, 540, 240, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x - 270, 190, 540 * easeOut(a), 6, [18, 18, 0, 0]); ctx.fill();
      text(title, x, 250, { size: 26, weight: 600, color: C.muted, align: "center" });
      text(value(easeOut(lin(a, 0, 1))), x, 340, { size: 68, weight: 700, fam: "display", align: "center", color: col });
      text(sub, x, 395, { size: 22, color: C.muted, align: "center" });
    }));
    const of = (v, n) => (p) => `${Math.round(v * p)} of ${n}`;
    if (D.mode === "real") {
      card(520, "8%: $80,000 of buying power", of(D.okCount, D.done.length), "30-year retirements since 1945 that lasted", C.danger, lin(t, 0.4, 1.6));
      card(1080, "4%: $40,000 of buying power", of(D.fourOk, D.done.length), "30-year retirements since 1945 that lasted", C.blue, lin(t, q(1), q(1) + 1.2));
    } else {
      card(520, "8%: the same $80,000 check", of(D.okCount, D.done.length), "lasted 30 years, on paper", C.blue, lin(t, 0.4, 1.6));
      const lastBuys = D.done.map((r) => { let p = 1; for (let k = 0; k < HORIZON; k++) p *= 1 + H.infl[idx(r.y0 + k)]; return WR * START / p; });
      card(1080, "What the 30th check bought", (p) => `${money(80e3 - (80e3 - Math.min(...lastBuys)) * p)}–${money(80e3 - (80e3 - Math.max(...lastBuys)) * p)}`, "in retirement-day dollars", C.fire, lin(t, q(1), q(1) + 1.2));
    }
    words("The long-run average doesn't pay your bills.", 800, 600, t, q(2), { size: 44, align: "center", gap: 0.13 });
    words("The order of the years decides.", 800, 670, t, q(2) + 1.6, { size: 44, align: "center", color: C.blue, gap: 0.16 });
    alpha(span(t, q(2) + 3.0, q(2) + 3.8), () => text("Historical simulation, 100% stocks, no fees or taxes. Not financial advice.", 800, 780, { size: 20, color: C.muted, align: "center" }));
  }
  SCENES.takeaway = (t, q) => takeaway(t, q, SETS.real);
  SCENES["takeaway-nominal"] = (t, q) => takeaway(t, q, SETS.nominal);

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
  const FORK_AFTER = "ramsey-world";
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
  function showChoice(on) { if (choice.hidden === on) choice.hidden = !on; }
  // the buttons come up when the narrator offers the choice; playback waits at the end of the scene
  const FORK_SHOW = (s) => s.cues[3].start + 9.5;
  const forkOpen = (s, t) => s.id === FORK_AFTER && !chosen && started && t >= FORK_SHOW(s);
  const endEl = document.getElementById("end"), endBtn = document.getElementById("endOther");
  const otherTrack = () => (track === "real" ? "nominal" : "real");
  function showEnd(on) {
    if (on) {
      // borrow the wording from the fork's own buttons
      const src = choice.querySelector(`[data-pick="${otherTrack()}"]`);
      endBtn.querySelector("b").textContent = `Watch again in ${src.querySelector("b").textContent.toLowerCase()}`;
      endBtn.querySelector("span").textContent = src.querySelector("span").textContent;
      endBtn.classList.toggle("choice__btn--fire", otherTrack() === "nominal");
    }
    if (endEl.hidden === on) endEl.hidden = !on;
  }
  endBtn.addEventListener("click", () => {
    showEnd(false);
    setTrack(otherTrack());
    // skip the fork and the track's short intro card: start at the first chart
    const fi = TIMES.findIndex((x) => x.id === FORK_AFTER);
    seek(TIMES[Math.min(fi + 2, TIMES.length - 1)].start + 0.001, true);
  });
  function pick(tr) {
    showChoice(false);
    setTrack(tr);
    const fi = TIMES.findIndex((s) => s.id === FORK_AFTER);
    if (cur <= fi) { cur = fi + 1; tIn = 0; }
    setPlaying(true);
  }
  choice.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pick(b.dataset.pick)));
  // nobody picks: start plain dollars after a short wait
  const AUTO_PICK = 15, timerEl = document.getElementById("choiceTimer");
  let waitFrom = null;
  setInterval(() => {
    const s = TIMES[cur];
    const waiting = s && s.id === FORK_AFTER && !chosen && !playing && started && tIn >= s.dur - 0.01;
    if (!waiting) { waitFrom = null; if (timerEl.textContent) timerEl.textContent = ""; return; }
    if (waitFrom == null) waitFrom = performance.now();
    const left = Math.ceil(AUTO_PICK - (performance.now() - waitFrom) / 1000);
    if (left <= 0) { waitFrom = null; pick("nominal"); return; }
    timerEl.textContent = `Starting with plain dollars in ${left}…`;
  }, 200);
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
  let heldScene = -1, held = 0; // waiting on a scene's narration to start
  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const s = TIMES[cur];
    // the audio is the clock while it plays; the picture runs on after it ends.
    // A new scene's audio can take a moment to start. Hold the picture at the start until it does,
    // otherwise the scene plays ahead and then jumps back to 0 when the narration catches up.
    // If the audio never starts (blocked, or failed to load), give up after a couple of seconds.
    const a = s.audio;
    if (heldScene !== cur) { heldScene = cur; held = 0; }
    if (a && !a.paused && !a.ended && a.currentTime > 0) tIn = a.currentTime;
    else if (a && !a.ended && a.currentTime === 0 && tIn < 0.05 && held < 2.5) held += dt;
    else tIn += dt;
    if (tIn >= s.dur) {
      if (s.id === FORK_AFTER && !chosen) { tIn = s.dur - 0.001; setPlaying(false); }
      else if (cur < TIMES.length - 1) {
        cur++; tIn = 0; syncAudio();
        // start fetching the scene after this one, so its narration is ready when it comes up
        const nx = TIMES[cur + 1];
        if (nx && nx.audio && nx.audio.readyState < 2) nx.audio.load();
      }
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
    // each scene arrives: a quick fade and rise, the chapter label sliding in from the left
    const t = started ? tIn : 4.0, enter = span(t, 0, 0.6);
    alpha(enter, () => { ctx.save(); ctx.translate((1 - enter) * -40, 0); eyebrow(cur + 1, s.title); ctx.restore(); });
    HOTS = [];
    ctx.save();
    if (!SCENES[s.id].ownEntrance) { ctx.globalAlpha = enter; ctx.translate(0, (1 - enter) * 28); }
    SCENES[s.id](t, q, s.dur);
    ctx.restore();
    const h = hovered();
    markHover(h);
    showHover(h);
    ctx.fillStyle = rgba(C.blue, 0.8);
    ctx.fillRect(0, Hh - 4, W * (started ? tIn / s.dur : 0), 4);
    showChoice(forkOpen(s, tIn));
    showEnd(started && !playing && cur === TIMES.length - 1 && tIn >= s.dur - 0.05);
  }

  // ---------- hover ----------
  const hoverEl = document.getElementById("hover");
  function hovered() {
    if (!mouse) return null;
    for (let i = HOTS.length - 1; i >= 0; i--) {
      const h = HOTS[i];
      if (mouse.x >= h.x && mouse.x <= h.x + h.w && mouse.y >= h.y && mouse.y <= h.y + h.h) return h;
    }
    return null;
  }
  function markHover(h) {
    if (!h) return;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    if (h.mark === "line") { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(h.x + h.w / 2, h.y); ctx.lineTo(h.x + h.w / 2, h.y + h.h); ctx.stroke(); ctx.setLineDash([]); }
    else ctx.strokeRect(h.x - 2, h.y, h.w + 4, h.h);
  }
  function showHover(h) {
    if (!hoverEl) return;
    if (!h) { hoverEl.hidden = true; return; }
    if (hoverEl.dataset.html !== h.html) { hoverEl.innerHTML = h.html; hoverEl.dataset.html = h.html; }
    hoverEl.hidden = false;
    const r = cv.getBoundingClientRect();
    const px = mouse.cx - r.left, py = mouse.cy - r.top;
    const w = hoverEl.offsetWidth, hh = hoverEl.offsetHeight;
    hoverEl.style.left = Math.min(r.width - w - 8, Math.max(8, px + 16)) + "px";
    hoverEl.style.top = Math.max(8, Math.min(r.height - hh - 8, py - hh - 12 < 8 ? py + 18 : py - hh - 12)) + "px";
  }
  cv.addEventListener("mousemove", (e) => {
    const r = cv.getBoundingClientRect();
    mouse = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * Hh, cx: e.clientX, cy: e.clientY };
    if (!playing) draw();
  });
  cv.addEventListener("mouseleave", () => { mouse = null; if (!playing) draw(); else showHover(null); });

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
