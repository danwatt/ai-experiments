(function () {
  "use strict";
  const M = window.Model, H = M.H;
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
  const moneyTick = (v) => (v === 0 ? "$0" : v >= 1e6 ? "$" + +(v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K");

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
  const BASE = { wr: 0.08, stocks: 1, fee: 0, load: 0, save: 30, contrib: 10000, ret: 30, from: 1872 };
  const C8 = M.cohorts(BASE), S8 = M.summary(C8);
  const C4 = M.cohorts({ ...BASE, wr: 0.04, stocks: 0.5 }), S4 = M.summary(C4);
  const CF = M.cohorts({ ...BASE, fee: 0.0065, load: true }), SF = M.summary(CF);
  const CP = M.cohorts({ ...BASE, pct: true }), SP = M.summary(CP);
  const ALL = M.stockStats(1872), SINCE28 = M.stockStats(1928);
  const R66 = C8.find((c) => c.r === 1966);
  const REV66 = M.drawdown(R66.nest, 0.08, [...R66.rets].reverse(), 30);
  const sweepFor = (stocks) => {
    const cs = M.cohorts({ ...BASE, stocks }).filter((c) => c.complete);
    const out = [];
    for (let w = 2; w <= 10.001; w += 0.25) out.push([w, cs.filter((c) => M.drawdown(1, w / 100, c.rets, 30).status === "ok").length / cs.length]);
    return out;
  };
  const SWEEP100 = sweepFor(1), SWEEP50 = sweepFor(0.5);
  const RAMSEY = (() => {
    let B = 1e6; const p = [B];
    for (let k = 0; k < 60 && B > 0; k++) {
      const next = B * (1 + M.RAMSEY_REAL) - 80000;
      if (next <= 0) { p.push(0); p.lastFrac = k + (B * (1 + M.RAMSEY_REAL)) / 80000; break; }
      B = next; p.push(B);
    }
    return p;
  })();
  const statusColor = (s) => (s === "ok" ? C.blue : s === "fail" ? C.danger : C.muted);

  // Each scene draws itself from t (seconds into the scene) and q(i), the time line i starts.
  const scenes = [];

  // 1. The 8% promise
  scenes.push(function promise(t, q) {
    alpha(span(t, 0.2, 1.0), () => {
      text("Spend 8% of your savings,", 800, 230, { size: 60, weight: 700, fam: "display", align: "center" });
      text("every year, forever?", 800, 302, { size: 60, weight: 700, fam: "display", align: "center", color: C.blue });
    });
    const parts = [
      [420, "12%", "stocks' average year", C.ink, q(1) + 1.8],
      [800, "4%", "inflation", C.ink, q(1) + 3.4],
      [1180, "8%", "left to spend", C.fire, q(1) + 5.0],
    ];
    parts.forEach(([x, big, label, color, at], i) => {
      const a = span(t, at, at + 0.6);
      alpha(a, () => {
        text(big, x, 500 + (1 - a) * 20, { size: 112, weight: 700, fam: "display", align: "center", color });
        text(label, x, 550, { size: 24, color: C.muted, align: "center" });
      });
      if (i < 2) alpha(span(t, parts[i + 1][4] - 0.3, parts[i + 1][4] + 0.3), () => text(i === 0 ? "−" : "=", (x + parts[i + 1][0]) / 2, 486, { size: 80, weight: 600, fam: "display", align: "center", color: C.muted }));
    });
    pill(640, 660, "Ramsey: 8%", "fire", span(t, q(2), q(2) + 0.6));
    pill(960, 660, "Research: about 4%", "blue", span(t, q(2) + 1.2, q(2) + 1.8));
    alpha(span(t, q(3) + 0.4, q(3) + 1.2), () => {
      text(`${H.first}–${H.last}  ·  ${ALL.n} years of S&P 500 returns`, 800, 790, { size: 28, weight: 600, align: "center", color: C.muted });
    });
  });

  // 2. Ramsey's world
  scenes.push(function ramseyWorld(t, q) {
    const A = axes({ x0: 170, x1: 1480, y0: 170, y1: 700, dx: [0, 45], dy: [0, 1.2e6] });
    alpha(span(t, 0, 0.6), () => {
      yGrid(A, [0, 400e3, 800e3, 1.2e6], moneyTick);
      xLabels(A, [0, 10, 20, 30, 40], (v) => (v === 0 ? "Retire" : `year ${v}`));
    });
    // twelve percent every year: identical bars
    const bA = axes({ x0: 170, x1: 1480, y0: 780, y1: 850, dx: [0, 45], dy: [0, 0.2] });
    const barsOn = lin(t, 0.6, q(1));
    alpha(span(t, 0.4, 1), () => text("Return each year", bA.x0, bA.y0 - 10, { size: 18, color: C.muted }));
    for (let k = 0; k < 44; k++) {
      if (k / 44 > barsOn * 1.6) break;
      bar(bA.X(k) + 4, bA.y1, bA.Y(0.12), (bA.X(1) - bA.X(0)) - 8, rgba(C.blue, 0.7), 3);
    }
    alpha(barsOn, () => text("+12%, every year", bA.x1, bA.y0 - 10, { size: 18, weight: 600, color: C.muted, align: "right" }));
    // the balance
    const pts = RAMSEY.map((v, k) => [A.X(k === RAMSEY.length - 1 && v === 0 ? RAMSEY.lastFrac : k), A.Y(v)]);
    const to30 = 30 / (RAMSEY.length - 1);
    const frac = lerp(0, to30, lin(t, q(1), q(1) + 5)) + (1 - to30) * lin(t, q(3) + 0.5, q(3) + 4);
    const tip = partial(pts, frac, C.ink, 4);
    if (frac > 0) dot(tip[0], tip[1], 7, C.ink, C.sunken, 3);
    alpha(span(t, q(1) + 0.6, q(1) + 1.4), () => {
      text("$1M, take $80,000 a year,", A.X(1), A.Y(1.1e6), { size: 26, weight: 600 });
      text("raised with inflation", A.X(1), A.Y(1.1e6) + 34, { size: 26, color: C.muted });
    });
    const at30 = span(t, q(2), q(2) + 0.8);
    alpha(at30, () => {
      dot(A.X(30), A.Y(RAMSEY[30]), 8, C.fire, C.sunken, 3);
      text(`${money(RAMSEY[30])} left after 30 years`, A.X(30) - 16, A.Y(RAMSEY[30]) + 40, { size: 22, weight: 600, align: "right" });
      text("1.12 ÷ 1.04 = 7.7% real growth, not 8%", A.X(16), A.Y(0.25e6), { size: 30, weight: 600, fam: "display", color: C.fire, align: "center" });
    });
    alpha(span(t, q(3) + 3.6, q(3) + 4.4), () => text(`Runs out in year ${Math.ceil(RAMSEY.lastFrac)}`, A.X(RAMSEY.lastFrac) - 30, A.Y(0) - 30, { size: 22, weight: 600, align: "right" }));
  });

  // 3. Real years aren't average
  scenes.push(function realYears(t, q) {
    const n = H.stocks.length;
    const A = axes({ x0: 150, x1: 1500, y0: 160, y1: 760, dx: [H.first, H.last + 1], dy: [-0.5, 0.6] });
    const bw = (A.X(1) - A.X(0)) - 2;
    alpha(span(t, 0, 0.6), () => {
      yGrid(A, [-0.4, -0.2, 0, 0.2, 0.4, 0.6], (v) => Math.round(v * 100) + "%");
      xLabels(A, [1880, 1900, 1920, 1940, 1960, 1980, 2000, 2020], (v) => v, A.y1 + 34);
    });
    const grow = lin(t, 0.3, Math.max(1.5, q(1) - 0.3));
    const band = span(t, q(1), q(1) + 0.8), neg = span(t, q(2), q(2) + 0.8), calm = span(t, q(3), q(3) + 0.8);
    if (band > 0) {
      alpha(band * (1 - neg), () => {
        ctx.fillStyle = rgba(C.fire, 0.16); ctx.fillRect(A.x0, A.Y(0.14), A.x1 - A.x0, A.Y(0.10) - A.Y(0.14));
        line(A.x0, A.Y(0.12), A.x1, A.Y(0.12), C.fire, 2, [8, 6]);
        text("12%", A.x1 + 10, A.Y(0.12) + 6, { size: 20, weight: 600, color: C.fire });
      });
    }
    for (let i = 0; i < n; i++) {
      if (i / n > grow) break;
      const v = H.stocks[i], near = v >= 0.10 && v <= 0.14;
      let col = v >= 0 ? C.blue : C.danger, a = 1;
      if (band > 0 && neg === 0) { if (near) col = C.fire; else a = lerp(1, 0.25, band); }
      if (neg > 0) { a = v < 0 ? 1 : lerp(0.25, 0.25, neg); col = v < 0 ? C.danger : near ? lerp(1, 0, neg) > 0.5 ? C.fire : C.blue : C.blue; }
      if (calm > 0) a = lerp(a, 0.35, calm);
      alpha(a, () => bar(A.X(H.first + i) + 1, A.Y(0), A.Y(clamp(v, -0.5, 0.6)), bw, col, 2));
    }
    alpha(band * (1 - neg), () => counter(1500, 230, "NEAR 12% (10 TO 14)", `${ALL.near} of ${ALL.n} years`, { align: "right", color: C.fire }));
    alpha(neg * (1 - calm), () => {
      counter(1500, 230, "LOST MONEY", `${ALL.neg} of ${ALL.n} years`, { align: "right", color: C.danger });
      [[1931, "right", -8], [1937, "left", bw + 8], [2008, "left", bw + 8]].forEach(([y, align, dx]) => {
        const v = H.stocks[M.idx(y)];
        text(`${y}: ${Math.round(v * 100)}%`, A.X(y) + 1 + dx, A.Y(v) + 6, { size: 19, weight: 600, align, color: C.danger });
      });
    });
    // rolling 10-year compound return
    if (calm > 0) {
      const roll = [];
      for (let i = 9; i < n; i++) roll.push([A.X(H.first + i + 0.5), A.Y(M.cagr(H.stocks.slice(i - 9, i + 1)))]);
      partial(roll, lin(t, q(3) + 0.3, q(3) + 4), C.ink, 3);
      alpha(span(t, q(3) + 1, q(3) + 1.8), () => legend(A.x0, 132, [[C.ink, "Compound return over the previous 10 years"]]));
    }
  });

  // 4. The average isn't what you earn
  scenes.push(function average(t, q) {
    const base = 720, k = 2.5;
    const steps = [[200, 100, "Start", 0.3], [400, 150, "+50%", 1.6], [600, 75, "−50%", 3.2]];
    steps.forEach(([x, v, lab, at], i) => {
      const a = span(t, at, at + 0.7);
      alpha(Math.min(1, a * 3), () => {
        bar(x - 50, base, base - v * k * a, 100, i === 2 ? C.danger : C.blue, 6);
        text("$" + v, x, base - v * k * a - 16, { size: 30, weight: 700, fam: "display", align: "center" });
        text(lab, x, base + 40, { size: 22, weight: 600, color: i === 2 ? C.danger : i === 1 ? C.blue : C.muted, align: "center" });
      });
    });
    line(110, base, 690, base, C.lineStrong, 1.5);
    alpha(span(t, q(1), q(1) + 0.7), () => {
      text("Average return: 0%", 400, 160, { size: 36, weight: 700, fam: "display", align: "center" });
      text("Your money: −25%", 400, 210, { size: 36, weight: 700, fam: "display", align: "center", color: C.danger });
    });
    // right: since 1928
    const rows = [
      ["Average year since 1928", SINCE28.mean, C.fire, q(2) + 0.4],
      ["Compound growth", SINCE28.cagr, C.blue, q(3) + 0.3],
      ["After inflation", SINCE28.real, C.blueDeep, q(3) + 2.4],
    ];
    const x0 = 860, x1 = 1480, sx = (v) => x0 + (v / 0.13) * (x1 - x0);
    alpha(span(t, q(2), q(2) + 0.6), () => line(x0, 240, x0, 690, C.lineStrong, 1.5));
    rows.forEach(([lab, v, col, at], i) => {
      const a = span(t, at, at + 1.0), y = 300 + i * 150;
      alpha(Math.min(1, a * 3), () => {
        text(lab, x0, y - 22, { size: 22, weight: 600, color: C.muted });
        const w = (sx(v) - x0) * a; // horizontal bar, rounded at the data end
        ctx.beginPath(); ctx.roundRect(x0, y, Math.max(1, w), 50, [0, 6, 6, 0]); ctx.fillStyle = col; ctx.fill();
        text(pct(v), x0 + w + 14, y + 37, { size: 32, weight: 700, fam: "display" });
      });
    });
    alpha(span(t, q(2) + 1.5, q(2) + 2.2), () => {
      line(sx(0.12), 250, sx(0.12), 690, C.fire, 2, [6, 6]);
      text("Ramsey's 12%", sx(0.12), 240, { size: 18, weight: 600, color: C.fire, align: "center" });
    });
  });

  // 5. One retiree: 1966
  scenes.push(function retiree(t, q) {
    const c = R66;
    const A = axes({ x0: 170, x1: 1480, y0: 160, y1: 660, dx: [1936, 1996], dy: [0, 2.2e6] });
    alpha(span(t, 0, 0.6), () => {
      yGrid(A, [0, 0.5e6, 1e6, 1.5e6, 2e6], moneyTick);
      xLabels(A, [1940, 1950, 1960, 1970, 1980, 1990], (v) => v);
    });
    const save = c.save.map((v, k) => [A.X(c.s0 + k), A.Y(v)]);
    const sf = lin(t, 0.4, q(1) - 0.2);
    const tip = partial(save, sf, C.blue, 4);
    if (sf > 0 && sf < 1) {
      dot(tip[0], tip[1], 7, C.blue, C.sunken, 3);
      text(String(Math.round(A.dx[0] + ((tip[0] - A.x0) / (A.x1 - A.x0)) * 60)), tip[0], tip[1] - 22, { size: 20, weight: 600, align: "center" });
    }
    alpha(span(t, 0.6, 1.4), () => text("Saving $10,000 a year (today's dollars)", A.X(1937), A.Y(1.9e6), { size: 26, weight: 600 }));
    const ret = span(t, q(1), q(1) + 0.8);
    alpha(ret, () => {
      line(A.X(1966), A.y0, A.X(1966), A.y1, C.lineStrong, 1.5);
      text("Retires, January 1966", A.X(1966) + 14, A.y0 + 26, { size: 22, weight: 600 });
      dot(A.X(1966), A.Y(c.nest), 8, C.blue, C.sunken, 3);
      text(money(c.nest), A.X(1966) - 16, A.Y(c.nest) + 8, { size: 26, weight: 700, fam: "display", align: "right" });
    });
    pill(A.X(1966) + 190, A.y0 + 76, `8% = ${money(c.W0)} a year`, "fire", span(t, q(1) + 5.5, q(1) + 6.1));
    // the drawdown and its returns
    const df = lin(t, q(2) + 0.3, q(3) + 0.6);
    const dpts = c.path.map((v, k) => [A.X(1966 + (k === c.path.length - 1 ? c.lasted : k)), A.Y(v)]);
    const dtip = partial(dpts, df, C.danger, 4);
    const bA = axes({ x0: A.x0, x1: A.x1, y0: 745, y1: 865, dx: A.dx, dy: [-0.4, 0.4] });
    alpha(span(t, q(2), q(2) + 0.6), () => {
      line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1);
      text("Return after inflation", bA.x0, bA.y0 - 8, { size: 18, color: C.muted });
    });
    const shown = Math.min(12, Math.floor(df * c.lasted + 1e-9) + (df > 0 ? 1 : 0));
    for (let k = 0; k < shown; k++) {
      const v = c.rets[k], y = 1966 + k, hot = y === 1973 || y === 1974;
      bar(bA.X(y) + 2, bA.Y(0), bA.Y(clamp(v, -0.4, 0.4)), bA.X(1) - bA.X(0) - 4, v >= 0 ? C.blue : C.danger, 2);
      if (hot) text(`${y}: ${Math.round(v * 100)}%`, y === 1973 ? bA.X(y) - 4 : bA.X(y + 1) + 4, bA.Y(v) + 4, { size: 17, weight: 600, align: y === 1973 ? "right" : "left", color: C.danger });
    }
    if (df >= 1) {
      alpha(span(t, q(3) + 0.6, q(3) + 1.2), () => {
        const x = dpts[dpts.length - 1][0], y = dpts[dpts.length - 1][1];
        ctx.strokeStyle = C.danger; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x - 12, y - 12); ctx.lineTo(x + 12, y + 12); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x - 12, y + 12); ctx.stroke();
        text("Broke in 1977", x + 22, y - 18, { size: 28, weight: 700, fam: "display", color: C.danger });
      });
    } else if (df > 0) dot(dtip[0], dtip[1], 7, C.danger, C.sunken, 3);
  });

  // 6. Same returns, backwards
  scenes.push(function reverse(t, q) {
    const c = R66, N = 30;
    const A = axes({ x0: 170, x1: 1440, y0: 170, y1: 560, dx: [0, N], dy: [0, 5e6] });
    yGrid(A, [0, 1e6, 2e6, 3e6, 4e6, 5e6], moneyTick);
    xLabels(A, [0, 5, 10, 15, 20, 25, 30], (v) => (v === 0 ? "Retire" : `year ${v}`));
    const act = c.path.map((v, k) => [A.X(k === c.path.length - 1 ? c.lasted : k), A.Y(v)]);
    partial(act, 1, C.danger, 4);
    alpha(1, () => text("Real order: broke in year 12", A.X(c.lasted) + 16, A.Y(0) - 18, { size: 21, weight: 600, color: C.danger }));
    // return bars that swap places
    const bA = axes({ x0: A.x0, x1: A.x1, y0: 640, y1: 840, dx: [0, N], dy: [-0.35, 0.35] });
    line(bA.x0, bA.Y(0), bA.x1, bA.Y(0), C.lineStrong, 1);
    const flip = span(t, q(0) + 2.6, q(1) - 0.2);
    const bw = bA.X(1) - bA.X(0) - 6;
    c.rets.forEach((v, i) => {
      const pos = lerp(i, N - 1 - i, flip);
      bar(bA.X(pos) + 3, bA.Y(0), bA.Y(clamp(v, -0.35, 0.35)), bw, v >= 0 ? C.blue : C.danger, 3);
    });
    text(flip < 0.5 ? "Each year's return after inflation, in the real order" : "The same 30 returns, last year first", bA.x0, bA.y0 - 16, { size: 19, weight: 600, color: C.muted });
    pill(1230, 630, `Same average: ${spct(M.cagr(c.rets))} a year`, "neutral", span(t, q(1) + 0.6, q(1) + 1.2));
    // reversed balance
    const rv = REV66.path.map((v, k) => [A.X(k), A.Y(v)]);
    const rf = lin(t, q(2) + 0.2, q(2) + 4.5);
    const tip = partial(rv, rf, C.fire, 4);
    if (rf > 0 && rf < 1) dot(tip[0], tip[1], 7, C.fire, C.sunken, 3);
    if (rf >= 1) {
      dot(tip[0], tip[1], 8, C.fire, C.sunken, 3);
      text(money(REV66.end), tip[0] + 16, tip[1] + 8, { size: 26, weight: 700, fam: "display" });
    }
    alpha(span(t, q(2), q(2) + 0.6), () => legend(A.x0, 132, [[C.danger, "Real order"], [C.fire, "Reversed order"]]));
    alpha(span(t, q(3) + 0.6, q(3) + 1.4), () => {
      text("Only the order changed.", 1440, 136, { size: 40, weight: 700, fam: "display", align: "right" });
    });
  });

  // 7. Everyone, every year
  scenes.push(function everyone(t, q) {
    const A = axes({ x0: 170, x1: 1480, y0: 190, y1: 720, dx: [-30, 30], dy: [0, 3.2e6] });
    yGrid(A, [0, 1e6, 2e6, 3e6], moneyTick);
    xLabels(A, [-30, -20, -10, 0, 10, 20, 30], (v) => (v === 0 ? "Retire" : v < 0 ? `${-v} yrs before` : `${v} yrs after`));
    line(A.X(0), A.y0, A.X(0), A.y1, C.lineStrong, 1.2);
    ctx.save(); ctx.beginPath(); ctx.rect(A.x0, A.y0 - 4, A.x1 - A.x0, A.y1 - A.y0 + 6); ctx.clip();
    const colorsOn = span(t, q(1), q(1) + 0.8);
    const hi = span(t, q(3), q(3) + 0.8);
    const n = C8.length, start = 0.3, per = Math.max(0.02, (q(1) + 1.5 - start) / n);
    C8.forEach((c, i) => {
      const f = lin(t, start + i * per, start + i * per + 1.6);
      if (f <= 0) return;
      const pts = c.save.concat(c.path.slice(1)).map((v, k) => {
        const x = k <= 30 ? k - 30 : k === 30 + c.path.length - 1 && c.status === "fail" ? c.lasted : k - 30;
        return [A.X(x), A.Y(Math.min(v, 3.4e6))];
      });
      const col = colorsOn > 0.5 ? statusColor(c.status) : C.muted;
      ctx.globalAlpha = c.r === 1929 && hi > 0 ? 1 : lerp(0.45, 0.14, hi);
      partial(pts, f, col, c.r === 1929 && hi > 0 ? 4 : 1.6);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    alpha(colorsOn, () => legend(A.x0, 140, [[C.blue, "Lasted 30 years"], [C.danger, "Ran out"], [C.muted, "Retired too recently to finish"]]));
    const done = S8.done.length, failed = done - S8.ok.length;
    alpha(span(t, q(2), q(2) + 0.6), () => counter(1480, 150, "RAN OUT AT 8%", `${failed} of ${done}`, { align: "right", color: C.danger, size: 52 }));
    alpha(hi, () => {
      const c = S8.worst, pk = c.save[30];
      text(`Retired ${c.r}: broke in ${c.lasted.toFixed(1)} years`, A.X(c.lasted) + 16, A.Y(pk * 0.5), { size: 24, weight: 700, color: C.danger });
      text(`${S8.recentFails.length} who retired ${S8.recentFails[0].r}–${S8.recentFails[S8.recentFails.length - 1].r} are already out`, A.x0, 820, { size: 24, weight: 600, color: C.muted });
    });
  });

  // 8. At four percent
  scenes.push(function four(t, q) {
    const morph = span(t, q(1) + 1.6, q(1) + 4.2);
    const toCurve = span(t, q(3), q(3) + 1.0);
    // skyline
    alpha(1 - toCurve, () => {
      const A = axes({ x0: 170, x1: 1480, y0: 200, y1: 700, dx: [0, C8.length], dy: [0, 30] });
      yGrid(A, [0, 10, 20, 30], (v) => v + " yrs");
      const bw = A.X(1) - A.X(0) - 2;
      C8.forEach((c, i) => {
        const d = C4[i];
        const h = lerp(Math.min(c.lasted, 30), Math.min(d.lasted, 30), morph);
        const st = morph < 0.5 ? c.status : d.status;
        const focus = span(t, q(2) + 0.5, q(2) + 1.2) * (d.status === "fail" && d.complete ? 1 : 0);
        bar(A.X(i) + 1, A.Y(0), A.Y(h), bw, statusColor(st), 2);
        if (focus > 0) alpha(focus, () => dot(A.X(i) + bw / 2, A.Y(h) - 14, 5, C.ink));
        if (c.r % 20 === 0) text(c.r, A.X(i) + bw / 2, A.y1 + 30, { size: 18, color: C.muted, align: "center" });
      });
      const lasted = Math.round(lerp(S8.ok.length, S4.ok.length, morph));
      counter(1480, 160, morph < 0.5 ? "8%, ALL STOCKS" : "4%, HALF STOCKS, HALF BONDS", `${lasted} of ${S8.done.length} lasted`, { align: "right", color: morph < 0.5 ? C.danger : C.blue });
      legend(A.x0, 150, [[C.blue, "Lasted"], [C.danger, "Ran out"], [C.muted, "Not finished yet"]]);
      alpha(span(t, q(2) + 0.5, q(2) + 1.2), () => {
        const fails = S4.done.filter((c) => c.status === "fail");
        const i0 = C4.indexOf(fails[0]), i1 = C4.indexOf(fails[fails.length - 1]);
        text(`${fails.map((c) => c.r).join(", ")}: out after ${Math.floor(Math.min(...fails.map((c) => c.lasted)))}+ years`, (A.X(i0) + A.X(i1)) / 2, A.Y(30) - 50, { size: 22, weight: 600, align: "center" });
      });
    });
    // success curves
    alpha(toCurve, () => {
      const A = axes({ x0: 200, x1: 1440, y0: 190, y1: 720, dx: [2, 10], dy: [0, 1] });
      yGrid(A, [0, 0.25, 0.5, 0.75, 1], (v) => v * 100 + "%");
      xLabels(A, [2, 3, 4, 5, 6, 7, 8, 9, 10], (v) => v + "%");
      text("First-year withdrawal rate", (A.x0 + A.x1) / 2, A.y1 + 72, { size: 20, color: C.muted, align: "center" });
      text("Share of 30-year retirements that lasted", A.x0 - 60, A.y0 - 24, { size: 20, color: C.muted });
      const f = lin(t, q(3) + 0.6, q(3) + 3.6);
      partial(SWEEP100.map(([w, r]) => [A.X(w), A.Y(r)]), f, C.blue, 4);
      partial(SWEEP50.map(([w, r]) => [A.X(w), A.Y(r)]), lin(t, q(3) + 4, q(3) + 7), C.fire, 4);
      legend(A.x1 - 470, A.y0 - 22, [[C.blue, "All stocks"], [C.fire, "Half bonds"]]);
      const mark = (arr, w, col, a, dy) => alpha(a, () => {
        const r = arr.find((p) => p[0] === w)[1];
        dot(A.X(w), A.Y(r), 8, col, C.sunken, 3);
        text(`${w}%: ${Math.round(r * 100)}%`, A.X(w) + 14, A.Y(r) + dy, { size: 22, weight: 700 });
      });
      mark(SWEEP100, 4, C.blue, span(t, q(3) + 2, q(3) + 2.6), -14);
      mark(SWEEP100, 8, C.blue, span(t, q(3) + 3.2, q(3) + 3.8), -14);
      mark(SWEEP50, 8, C.fire, span(t, q(3) + 6.6, q(3) + 7.2), 40);
    });
  });

  // 9. The first decade decides
  scenes.push(function decade(t, q) {
    const pts = S8.done;
    const A = axes({ x0: 200, x1: 1460, y0: 180, y1: 720, dx: [-0.06, 0.18], dy: [0.02, 0.10] });
    yGrid(A, [0.02, 0.04, 0.06, 0.08, 0.1], (v) => Math.round(v * 100) + "%");
    xLabels(A, [-0.05, 0, 0.05, 0.1, 0.15], (v) => Math.round(v * 100) + "%");
    text("Real return per year, all 30 years", A.x0 - 60, A.y0 - 24, { size: 20, color: C.muted });
    const xa = span(t, q(2), q(2) + 0.8);
    text("Real return per year, first 10 years", (A.x0 + A.x1) / 2, A.y1 + 70, { size: 20 + 4 * xa, weight: xa > 0.5 ? 700 : 400, color: xa > 0.5 ? C.ink : C.muted, align: "center" });
    const okMin = Math.min(...pts.filter((c) => c.status === "ok").map((c) => c.first10));
    const failMax = Math.max(...pts.filter((c) => c.status === "fail").map((c) => c.first10));
    const zones = span(t, q(3), q(3) + 0.8);
    alpha(zones, () => {
      ctx.fillStyle = rgba(C.danger, 0.10); ctx.fillRect(A.x0, A.y0, A.X(okMin) - A.x0, A.y1 - A.y0);
      ctx.fillStyle = rgba(C.blue, 0.10); ctx.fillRect(A.X(failMax), A.y0, A.x1 - A.X(failMax), A.y1 - A.y0);
      text(`Under ${spct(okMin)}: none survived`, A.x0 + 12, A.y0 + 30, { size: 21, weight: 700, color: C.danger });
      text(`Over ${spct(failMax)}: none ran out`, A.x1 - 12, A.y0 + 30, { size: 21, weight: 700, color: C.blue, align: "right" });
    });
    const pick = span(t, q(1), q(1) + 0.8);
    const a35 = pts.find((c) => c.r === 1935), a55 = pts.find((c) => c.r === 1955);
    pts.forEach((c, i) => {
      const a = span(t, 0.3 + i * 0.035, 0.6 + i * 0.035);
      const dim = pick > 0 && c !== a35 && c !== a55 ? lerp(1, 0.35, pick) : 1;
      alpha(a * dim, () => dot(A.X(c.first10), A.Y(clamp(c.full, 0.02, 0.1)), 7, statusColor(c.status), C.sunken, 2));
    });
    alpha(pick, () => {
      [[a35, "1935: ran out", -18], [a55, "1955: lasted", 34]].forEach(([c, lab, dy]) => {
        dot(A.X(c.first10), A.Y(c.full), 11, null, C.ink, 3);
        line(A.x0, A.Y(c.full), A.X(c.first10) - 14, A.Y(c.full), rgba(C.ink, 0.5), 1.5, [5, 5]);
        text(`${lab}, ${spct(c.full)}/yr over 30 years`, A.X(c.first10) + 18, A.Y(c.full) + dy, { size: 21, weight: 700, color: statusColor(c.status) });
      });
    });
    legend(A.x1 - 330, 132, [[C.blue, "Lasted"], [C.danger, "Ran out"]]);
  });

  // 10. Expensive markets, smaller paychecks
  scenes.push(function valuation(t, q) {
    const pts = S8.done.filter((c) => c.cape != null);
    const now = H.capeNow;
    const A = axes({ x0: 200, x1: 1460, y0: 180, y1: 720, dx: [0, 44], dy: [0, 0.14] });
    alpha(span(t, 0, 0.6), () => {
      yGrid(A, [0, 0.04, 0.08, 0.12], (v) => Math.round(v * 100) + "%");
      xLabels(A, [0, 10, 20, 30, 40], (v) => v);
    });
    const lab = span(t, q(1), q(1) + 0.8);
    alpha(Math.max(0.35, lab), () => {
      text("CAPE on retirement day: price ÷ 10 years of real earnings", (A.x0 + A.x1) / 2, A.y1 + 70, { size: 20 + 2 * lab, weight: lab > 0.5 ? 600 : 400, color: lab > 0.5 ? C.ink : C.muted, align: "center" });
      text("Highest fixed withdrawal rate that lasted 30 years", A.x0 - 60, A.y0 - 24, { size: 20 + 2 * lab, weight: lab > 0.5 ? 600 : 400, color: lab > 0.5 ? C.ink : C.muted });
    });
    [[0.08, "8%", C.fire], [0.04, "4%", C.muted]].forEach(([v, s, col]) => {
      line(A.x0, A.Y(v), A.x1, A.Y(v), col, 2, [8, 6]);
      text(s, A.x1 + 10, A.Y(v) + 6, { size: 20, weight: 700, color: col });
    });
    const ok8 = pts.filter((c) => c.safe >= 0.08), maxOk = ok8.reduce((a, c) => (c.cape > a.cape ? c : a));
    const cut = span(t, q(2), q(2) + 0.8);
    alpha(cut, () => {
      ctx.fillStyle = rgba(C.danger, 0.08); ctx.fillRect(A.X(maxOk.cape), A.y0, A.x1 - A.X(maxOk.cape), A.y1 - A.y0);
      line(A.X(maxOk.cape), A.y0, A.X(maxOk.cape), A.y1, C.danger, 2);
      text(`Above ${maxOk.cape.toFixed(1)}: none could sustain 8%`, A.X(maxOk.cape) + 14, A.y0 + 30, { size: 22, weight: 700, color: C.danger });
    });
    pts.forEach((c, i) => {
      const a = span(t, 0.4 + i * 0.04, 0.7 + i * 0.04);
      alpha(a, () => dot(A.X(c.cape), A.Y(clamp(c.safe, 0, 0.14)), 7, c.safe >= 0.08 ? C.blue : C.danger, C.sunken, 2));
    });
    const today = span(t, q(3), q(3) + 1.6);
    alpha(today, () => {
      const x = A.X(lerp(maxOk.cape, now.cape, today));
      line(x, A.y0 + 50, x, A.y1, C.ink, 3);
      text(`${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.month - 1]} ${now.year}: ${now.cape}`, x - 12, A.y0 + 80, { size: 24, weight: 700, align: "right" });
      [1999, 2000].forEach((y, i) => {
        const v = H.cape[M.idx(y)];
        ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(A.X(v), A.y1 - 2); ctx.lineTo(A.X(v) - 7, A.y1 - 14); ctx.lineTo(A.X(v) + 7, A.y1 - 14); ctx.fill();
        text(String(y), A.X(v), A.y1 - 22 - i * 22, { size: 17, weight: 600, color: C.muted, align: "center" });
      });
    });
  });

  // 11. Fees come first
  scenes.push(function fees(t, q) {
    const grid = (cs, x0, y0, title, sub, a, flipAt) => {
      const done = cs.filter((c) => c.complete);
      alpha(a, () => {
        text(title, x0, y0 - 70, { size: 30, weight: 700, fam: "display" });
        text(sub, x0, y0 - 36, { size: 20, color: C.muted });
        done.forEach((c, i) => {
          const col = i % 19, row = Math.floor(i / 19);
          const was = C8.find((k) => k.r === c.r).status;
          const st = flipAt == null ? c.status : (t >= flipAt ? c.status : was);
          const pulse = flipAt != null && was !== c.status ? span(t, flipAt, flipAt + 0.4) * (1 - span(t, flipAt + 0.6, flipAt + 1.6)) : 0;
          dot(x0 + 15 + col * 34, y0 + 15 + row * 34, 12 + pulse * 5, statusColor(st));
        });
        const ok = done.filter((c) => c.status === "ok").length;
        const shownFail = flipAt != null && t < flipAt ? done.length - S8.ok.length : done.length - ok;
        text(`${shownFail} of ${done.length} ran out`, x0, y0 + 5 * 34 + 50, { size: 30, weight: 700, fam: "display", color: C.danger });
      });
    };
    grid(C8, 100, 360, "Index funds", "8%, all stocks, no fees", span(t, 0.3, 1.0));
    grid(CF, 900, 360, "Ramsey with A-share fees", "5.75% sales charge on deposits + 0.65% a year", span(t, q(1), q(1) + 0.8), q(2) + 0.5);
    alpha(span(t, q(1) + 1.6, q(1) + 2.4), () => text(`Median sales charges paid while saving: ${money(M.median(CF.map((c) => c.loads)))}`, 900, 650, { size: 21, color: C.muted }));
    legend(100, 740, [[C.blue, "Lasted 30 years", "dot"], [C.danger, "Ran out", "dot"]]);
  });

  // 12. Flexible spending
  scenes.push(function flex(t, q) {
    const done = SP.done;
    const A = axes({ x0: 200, x1: 1460, y0: 250, y1: 760, dx: [1, 30], dy: [0, 2] });
    alpha(span(t, 0.2, 0.8), () => text("Spend 8% of whatever is left:", 800, 150, { size: 32, weight: 700, fam: "display", align: "center" }));
    pill(1190, 140, "never runs out", "blue", span(t, 1.2, 1.8));
    const ch = span(t, q(1), q(1) + 0.6);
    alpha(ch, () => {
      yGrid(A, [0, 0.5, 1, 1.5, 2], (v) => v * 100 + "%");
      xLabels(A, [1, 5, 10, 15, 20, 25, 30], (v) => `year ${v}`);
      text("Income compared with the first year", A.x0 - 60, A.y0 - 24, { size: 20, color: C.muted });
      line(A.x0, A.Y(1), A.x1, A.Y(1), C.lineStrong, 2);
    });
    const draw = lin(t, q(1) + 0.4, q(2) - 0.2);
    const med = M.median(done.map((c) => c.minInc));
    const lows = span(t, q(2), q(2) + 0.8);
    ctx.save(); ctx.beginPath(); ctx.rect(A.x0, A.y0 - 2, A.x1 - A.x0, A.y1 - A.y0 + 4); ctx.clip();
    done.forEach((c, i) => {
      const f = lin(draw * done.length, i, i + 6);
      if (f <= 0) return;
      ctx.globalAlpha = lerp(0.35, 0.18, lows);
      partial(c.inc.map((v, k) => [A.X(k + 1), A.Y(Math.min(2.1, v / c.W0))]), f, C.blue, 1.6);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    alpha(lows, () => {
      done.forEach((c) => {
        const k = c.inc.indexOf(Math.min(...c.inc));
        dot(A.X(k + 1), A.Y(c.minInc), 5, C.danger);
      });
      line(A.x0, A.Y(med), A.x1, A.Y(med), C.danger, 2.5, [8, 6]);
      text(`Typical leanest year: ${pct(med, 0)} of the first`, A.x1, A.y1 + 66, { size: 24, weight: 700, color: C.danger, align: "right" });
    });
  });

  // 13. Plan for the sequence
  scenes.push(function close(t, q) {
    alpha(span(t, 0.2, 1.0), () => text("12% is an average.", 800, 250, { size: 64, weight: 700, fam: "display", align: "center" }));
    alpha(span(t, 3.0, 3.8), () => text("A retirement gets one sequence.", 800, 330, { size: 64, weight: 700, fam: "display", align: "center", color: C.blue }));
    const card = (x, title, n, of, col, a) => alpha(a, () => {
      ctx.fillStyle = C.raised; ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 260, 420, 520, 230, 18); ctx.fill(); ctx.stroke();
      text(title, x, 480, { size: 26, weight: 600, color: C.muted, align: "center" });
      text(`${n} of ${of}`, x, 565, { size: 72, weight: 700, fam: "display", align: "center", color: col });
      text("30-year retirements lasted", x, 615, { size: 22, color: C.muted, align: "center" });
    });
    card(520, "4%, half bonds", S4.ok.length, S4.done.length, C.blue, span(t, q(1), q(1) + 0.7));
    card(1080, "8%, all stocks", S8.ok.length, S8.done.length, C.danger, span(t, q(1) + 2.6, q(1) + 3.3));
    alpha(span(t, q(2), q(2) + 0.7), () => {
      text("Try your own numbers in the simulator", 800, 760, { size: 30, weight: 700, fam: "display", align: "center", color: C.blue });
      text("Historical simulation, not financial advice", 800, 810, { size: 20, color: C.muted, align: "center" });
    });
  });

  // ---------- timeline ----------
  const N = window.NARRATION;
  const DATA = N ? N.scenes : [];
  if (N && N.draft) {
    document.getElementById("startHint").textContent = "Draft timing, no voiceover yet. Captions show the script. Space pauses, arrow keys skip.";
  }
  const TIMES = DATA.map((s) => ({
    id: s.id, title: s.title, cues: s.cues,
    dur: s.duration + TAIL,
    audio: s.audio ? (() => { const a = new Audio(s.audio); a.preload = "auto"; return a; })() : null,
  }));
  let total = 0; TIMES.forEach((s) => { s.start = total; total += s.dur; });

  let cur = 0, tIn = 0, playing = false, started = false, last = 0, muted = false, captions = true;
  const caption = document.getElementById("caption");
  const scrub = document.getElementById("scrub");
  const timeEl = document.getElementById("time");
  const chapters = document.getElementById("chapters");
  const playLabel = document.getElementById("playLabel"), playIcon = document.getElementById("playIcon");

  TIMES.forEach((s, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="n">${i + 1}</span>${s.title}`;
    b.addEventListener("click", () => seek(s.start + 0.001, true));
    li.appendChild(b); chapters.appendChild(li);
  });

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
      if (cur < TIMES.length - 1) { cur++; tIn = 0; syncAudio(); }
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
    scenes[cur](started ? tIn : 4.0, q, s.dur);
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
    TIMES.forEach((s) => { if (s.audio) s.audio.muted = muted; });
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
    if (qs.has("s")) { const s = TIMES.find((x) => x.id === qs.get("s")); if (s) seek(s.start + parseFloat(qs.get("at") || "0"), false); }
    ui();
  });
  resize();
  window.__ret = { seek, scenes: TIMES.map((s) => [s.id, s.start, s.dur]) };
})();
