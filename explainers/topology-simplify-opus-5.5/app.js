(function () {
  "use strict";
  const G = window.Geo;
  const W = 1600, H = 900;
  const TAIL = 1.4; // seconds of picture after the last word of a scene

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem("topo-theme"); if (t === "light" || t === "dark") root.dataset.theme = t; } catch (e) {}
  let C = {};
  function readColors() {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue("--" + n).trim();
    C = {
      surface: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken"), line: v("line"), lineStrong: v("line-strong"),
      ink: v("ink"), muted: v("ink-muted"), blue: v("bluebonnet"), blueDeep: v("bluebonnet-deep"), blueSoft: v("bluebonnet-soft"),
      paint: v("paintbrush"), fire: v("firewheel"), wine: v("winecup"), success: v("success"), successSoft: v("success-soft"),
      warning: v("warning"), danger: v("danger"), dangerSoft: v("danger-soft"), onBlue: v("on-bluebonnet"),
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
    try { localStorage.setItem("topo-theme", root.dataset.theme); } catch (e) {}
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
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  let scale = 1;
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = off.width = Math.round(r.width * dpr);
    cv.height = off.height = Math.round(r.height * dpr);
    scale = (r.width * dpr) / W;
    draw();
  }
  window.addEventListener("resize", resize);

  // ---------- easing ----------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const span = (t, a, b) => ease((t - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpP = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

  // ---------- drawing helpers ----------
  const FONT = { display: '"Bricolage Grotesque", "Avenir Next", system-ui, sans-serif', body: '"Public Sans", "Segoe UI", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace' };
  function font(c, size, weight, fam) { c.font = `${weight || 400} ${size}px ${FONT[fam || "body"]}`; }
  function path(c, pts, closed) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    if (closed) c.closePath();
  }
  function dot(c, p, r, fill, stroke, lw) {
    c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.stroke(); }
  }
  function text(c, s, x, y, o) {
    o = o || {};
    font(c, o.size || 22, o.weight || 400, o.fam);
    c.fillStyle = o.color || C.ink;
    c.textAlign = o.align || "left";
    c.textBaseline = o.base || "alphabetic";
    if (o.spacing) c.letterSpacing = o.spacing + "px";
    c.fillText(s, x, y);
    if (o.spacing) c.letterSpacing = "0px";
  }
  function pill(c, x, y, label, kind, a) {
    // a status badge: dot + word, on its soft ground
    const colors = { danger: [C.dangerSoft, C.danger], success: [C.successSoft, C.success], neutral: [C.raised, C.muted], blue: [C.blueSoft, C.blue] }[kind];
    c.save(); c.globalAlpha *= a == null ? 1 : a;
    font(c, 20, 600);
    const w = c.measureText(label).width + 50, h = 36;
    c.fillStyle = colors[0];
    c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 18); c.fill();
    c.strokeStyle = rgba(colors[1], 0.5); c.lineWidth = 1.5; c.stroke();
    dot(c, [x - w / 2 + 20, y], 5, colors[1]);
    text(c, label, x - w / 2 + 34, y + 1, { size: 20, weight: 600, color: colors[1], base: "middle" });
    c.restore();
  }
  function eyebrow(c, num, title) {
    text(c, `${String(num).padStart(2, "0")}  ·  ${title.toUpperCase()}`, 56, 70, { size: 18, weight: 600, color: C.blue, spacing: 1.6 });
  }
  function cross(c, p, r, color, lw) {
    c.strokeStyle = color; c.lineWidth = lw || 4; c.lineCap = "round";
    c.beginPath(); c.moveTo(p[0] - r, p[1] - r); c.lineTo(p[0] + r, p[1] + r); c.moveTo(p[0] + r, p[1] - r); c.lineTo(p[0] - r, p[1] + r); c.stroke();
  }

  // ---------- data ----------
  const MAP = G.buildMap();
  const RINGS = MAP.polys.map((p) => G.ringOf(MAP, p));
  const INTERIOR = MAP.arcs.map((a, i) => (a.coast ? -1 : i)).filter((i) => i >= 0);
  // the landmass outline: coast arcs 0..3 run all the way round
  const COAST = [0, 1, 2, 3].flatMap((i) => MAP.arcs[i].pts.slice(0, -1));
  const TOL = 14; // map units, used for the map scenes
  const STORED_ALL = RINGS.reduce((s, r) => s + r.length, 0);
  const UNIQUE_ALL = MAP.arcs.reduce((s, a) => s + a.pts.length - 2, 0) + Object.keys(MAP.nodes).length;

  const cacheN = new Map(), cacheT = new Map();
  function naiveAt(tol) {
    if (!cacheN.has(tol)) {
      cacheN.set(tol, G.naiveMap(MAP, tol).map((r) => ({ keep: r.keep, out: r.out, targets: G.chordTargets(r.ring, r.keep, true) })));
    }
    return cacheN.get(tol);
  }
  function topoAt(tol) {
    if (!cacheT.has(tol)) {
      const t = G.topoMap(MAP, tol);
      t.targets = MAP.arcs.map((a, i) => G.chordTargets(a.pts, t.arcKeeps[i], false));
      t.unique = t.arcOut.reduce((s, a) => s + a.length - 2, 0) + Object.keys(MAP.nodes).length;
      t.rings = MAP.polys.map((p) => G.ringOf(MAP, p, t.arcOut));
      cacheT.set(tol, t);
    }
    return cacheT.get(tol);
  }
  const COMPARE_TOLS = []; for (let t = 1; t <= 40; t++) COMPARE_TOLS.push(t);
  // warm the caches in idle time so the comparison scene never stalls
  (function warm(i) {
    if (i >= COMPARE_TOLS.length) return;
    naiveAt(COMPARE_TOLS[i]); topoAt(COMPARE_TOLS[i]);
    (window.requestIdleCallback || setTimeout)(() => warm(i + 1));
  })(0);

  // map → stage transform
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }
  const MB = bbox(MAP.arcs.flatMap((a) => a.pts));
  function fit(b, x0, y0, x1, y1) { return { cx: b.cx, cy: b.cy, s: Math.min((x1 - x0) / b.w, (y1 - y0) / b.h), ox: (x0 + x1) / 2, oy: (y0 + y1) / 2 }; }
  const CAM_FULL = fit(MB, 120, 110, 1480, 870);
  const ZB = bbox(MAP.arcs[4].pts);
  const CAM_ZOOM = { cx: ZB.cx, cy: ZB.cy, s: Math.min(2.5, 640 / ZB.h), ox: 900, oy: 490 };
  function camLerp(a, b, t) { return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), s: lerp(a.s, b.s, t), ox: lerp(a.ox, b.ox, t), oy: lerp(a.oy, b.oy, t) }; }
  const xf = (cam) => (p) => [cam.ox + (p[0] - cam.cx) * cam.s, cam.oy + (p[1] - cam.cy) * cam.s];

  function centroid(r) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
    }
    return [x / (3 * a), y / (3 * a)];
  }
  const fillA = [0.20, 0.32, 0.44, 0.26];
  function countyFill(i, a) { return rgba(C.blue, fillA[i] * (a == null ? 1 : a)); }

  // Rings mid-morph: dropped vertices slide onto their replacement chord.
  function morphRing(ring, targets, u) { return ring.map((p, k) => lerpP(p, targets[k], u)); }
  function morphArcs(t, u, perArc) {
    return MAP.arcs.map((a, i) => { const uu = perArc ? perArc(i) : u; return a.pts.map((p, k) => lerpP(p, t.targets[i][k], uu)); });
  }

  // Gold gaps and red overlaps, drawn with canvas compositing on an offscreen layer.
  function drawGapsOverlaps(rings, cam, alphaGap, alphaOver, tolForBand) {
    const T = xf(cam);
    const sr = rings.map((r) => r.map(T));
    const s = scale;
    if (alphaOver > 0) {
      for (let i = 0; i < sr.length; i++) for (let j = i + 1; j < sr.length; j++) {
        octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalCompositeOperation = "source-over";
        octx.clearRect(0, 0, off.width, off.height);
        octx.setTransform(s, 0, 0, s, 0, 0);
        path(octx, sr[i], true); octx.fillStyle = "#000"; octx.fill();
        octx.globalCompositeOperation = "source-in";
        path(octx, sr[j], true); octx.fillStyle = C.danger; octx.fill();
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alphaOver * 0.9; ctx.drawImage(off, 0, 0); ctx.restore();
      }
    }
    if (alphaGap > 0) {
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalCompositeOperation = "source-over";
      octx.clearRect(0, 0, off.width, off.height);
      octx.setTransform(s, 0, 0, s, 0, 0);
      octx.strokeStyle = C.fire; octx.lineJoin = "round"; octx.lineCap = "round";
      octx.lineWidth = (tolForBand * 2 + 6) * cam.s;
      for (const ai of INTERIOR) { path(octx, MAP.arcs[ai].pts.map(T), false); octx.stroke(); }
      octx.globalCompositeOperation = "destination-in";
      octx.fillStyle = "#000";
      path(octx, COAST.map(T), true); octx.fill();
      octx.globalCompositeOperation = "destination-out";
      for (const r of sr) { path(octx, r, true); octx.fill(); }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alphaGap; ctx.drawImage(off, 0, 0); ctx.restore();
    }
    octx.globalCompositeOperation = "source-over";
  }

  function drawCounties(rings, cam, o) {
    o = o || {};
    const T = xf(cam);
    rings.forEach((r, i) => {
      const a = o.alpha ? o.alpha(i) : 1;
      if (a <= 0) return;
      const sr = r.map(T);
      ctx.save(); ctx.globalAlpha = a;
      path(ctx, sr, true); ctx.fillStyle = countyFill(i, o.fillA == null ? 1 : o.fillA); ctx.fill();
      ctx.restore();
    });
    rings.forEach((r, i) => {
      const a = o.alpha ? o.alpha(i) : 1;
      if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a;
      path(ctx, r.map(T), true);
      ctx.strokeStyle = o.stroke ? o.stroke(i) : C.ink; ctx.lineWidth = o.lw ? o.lw(i) : 1.6; ctx.lineJoin = "round"; ctx.stroke();
      ctx.restore();
    });
  }

  function counter(x, y, label, value, o) {
    o = o || {};
    text(ctx, label.toUpperCase(), x, y, { size: 15, weight: 600, color: C.muted, spacing: 1.2, align: o.align });
    text(ctx, value, x, y + 44, { size: 40, weight: 700, fam: "display", color: o.color || C.ink, align: o.align });
  }
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  // ---------- scenes ----------
  // Each scene draws itself from t (seconds into the scene) and q(i), the time line i starts.
  const scenes = [];

  // 1. Too many points
  scenes.push(function intro(t, q, dur) {
    const cam = CAM_FULL, T = xf(cam);
    const reveal = span(t, 0.2, 2.6);
    // borders draw on
    MAP.arcs.forEach((a) => {
      const n = Math.max(2, Math.floor(a.pts.length * reveal));
      path(ctx, a.pts.slice(0, n).map(T), false);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
    });
    const fa = span(t, 1.6, 3.2);
    if (fa > 0) drawCounties(RINGS, cam, { alpha: () => fa, stroke: () => "transparent" });
    // names
    const names = RINGS.map(centroid);
    MAP.polys.forEach((p, i) => { const c = T(names[i]); text(ctx, p.name, c[0], c[1], { size: 24, weight: 600, fam: "display", color: rgba(C.ink, 0.8 * fa), align: "center" }); });
    // every vertex
    const vp = span(t, q(1), q(1) + 3.2);
    const simp = span(t, q(2) + 0.6, q(2) + 3.6);
    const topo = topoAt(6);
    let shown = 0;
    if (vp > 0) {
      const allArcs = simp > 0 ? morphArcs(topo, simp) : MAP.arcs.map((a) => a.pts);
      allArcs.forEach((pts, ai) => {
        const keep = topo.arcKeeps[ai];
        pts.forEach((p, k) => {
          const order = (ai * 129 + k) / (9 * 129);
          if (order > vp) return;
          if (simp > 0 && !keep[k]) { ctx.globalAlpha = 1 - simp; }
          dot(ctx, T(p), 2.6, C.fire);
          ctx.globalAlpha = 1;
        });
      });
      shown = Math.round(STORED_ALL * vp);
    }
    if (simp > 0) {
      const topoRings = MAP.polys.map((p) => G.ringOf(MAP, p, morphArcs(topo, simp)));
      ctx.save(); ctx.globalAlpha = simp;
      topoRings.forEach((r) => { path(ctx, r.map(T), true); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.stroke(); });
      ctx.restore();
      shown = lerp(STORED_ALL, topo.rings.reduce((s, r) => s + r.length, 0), simp);
    }
    if (vp > 0) {
      ctx.save(); ctx.globalAlpha = span(t, q(1), q(1) + 0.6);
      counter(1544, 780, "Points", fmt(shown), { align: "right", color: C.fire });
      ctx.restore();
    }
    const qa = span(t, q(3), q(3) + 0.8);
    if (qa > 0) {
      ctx.save(); ctx.globalAlpha = qa;
      text(ctx, "What else gets thrown away?", 56, 820, { size: 30, weight: 600, fam: "display" });
      ctx.restore();
    }
  });

  // 2. Douglas–Peucker
  const DPL = (function () {
    let pts = G.fractalLine([170, 0], [1430, 0], { depth: 5, rough: 0.32, bend: 0, seed: 12 });
    const ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
    pts = pts.map((p) => [p[0], 360 + ((p[1] - lo) / (hi - lo)) * 380]);
    pts[0][1] = pts[pts.length - 1][1] = 560;
    return pts;
  })();
  const DP_TOL = 42;
  const DP_STEPS = G.dpSteps(DPL, DP_TOL);
  scenes.push(function dp(t, q, dur) {
    const tA = q(1), tB = q(4) + 1.2;
    // schedule: step 0 over line 1, the steps before the first drop over line 2,
    // the first drop over line 3, everything else quickly after
    const fd = Math.max(1, DP_STEPS.findIndex((s) => !s.keep));
    const sched = [];
    const lay = (from, to, a, b) => { const n = to - from; for (let i = from; i < to; i++) sched[i] = [a + ((i - from) / n) * (b - a), a + ((i - from + 1) / n) * (b - a)]; };
    lay(0, 1, tA, q(2));
    lay(1, fd, q(2), q(3));
    lay(fd, fd + 1, q(3), q(3) + 2.4);
    lay(fd + 1, DP_STEPS.length, q(3) + 2.4, tB);
    let cur = -1, ph = 0;
    sched.forEach(([a, b], i) => { if (t >= a && t < b) { cur = i; ph = (t - a) / (b - a); } });
    const acc = tB;
    const done = t >= acc ? DP_STEPS.length : cur < 0 ? 0 : cur;
    const kept = new Uint8Array(DPL.length); kept[0] = kept[DPL.length - 1] = 1;
    const dropped = new Uint8Array(DPL.length);
    const decidedChords = [];
    for (let i = 0; i < done; i++) {
      const s = DP_STEPS[i];
      if (s.keep) kept[s.k] = 1; else { for (let k = s.i + 1; k < s.j; k++) dropped[k] = 1; decidedChords.push([s.i, s.j]); }
    }
    let sweep = null;
    if (t > tB + 0.3) sweep = lerp(DP_TOL, 150, span(t, tB + 0.5, dur - 0.6));

    // original line
    path(ctx, DPL, false); ctx.strokeStyle = rgba(C.ink, sweep ? 0.25 : 0.55); ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();

    if (sweep) {
      const keep = G.dp(DPL, sweep);
      const out = DPL.filter((_, k) => keep[k]);
      path(ctx, out, false); ctx.strokeStyle = C.blue; ctx.lineWidth = 4; ctx.stroke();
      out.forEach((p) => dot(ctx, p, 7, C.blue));
      DPL.forEach((p, k) => { if (!keep[k]) dot(ctx, p, 3.5, rgba(C.muted, 0.6)); });
      // tolerance bar
      text(ctx, "TOLERANCE", 56, 806, { size: 15, weight: 600, color: C.muted, spacing: 1.2 });
      ctx.fillStyle = C.blueSoft; ctx.fillRect(56, 822, sweep * 2, 18);
      ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.strokeRect(56, 822, sweep * 2, 18);
      counter(1544, 780, "Points kept", `${out.length} of ${DPL.length}`, { align: "right", color: C.blue });
      return;
    }

    // finished shortcuts
    decidedChords.forEach(([i, j]) => { path(ctx, [DPL[i], DPL[j]], false); ctx.strokeStyle = C.blue; ctx.lineWidth = 4; ctx.stroke(); });
    // points
    DPL.forEach((p, k) => {
      if (kept[k]) dot(ctx, p, 7, C.blue);
      else if (dropped[k]) dot(ctx, p, 3.5, rgba(C.muted, 0.5));
      else dot(ctx, p, 4.5, C.ink);
    });

    if (cur >= 0) {
      const s = DP_STEPS[cur];
      const a = DPL[s.i], b = DPL[s.j], p = DPL[s.k];
      const p1 = ease(ph / 0.25), p2 = ease((ph - 0.25) / 0.3), p3 = ease((ph - 0.6) / 0.25);
      // tolerance corridor
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
      ctx.save(); ctx.globalAlpha = p1 * (1 - 0.4 * p3);
      path(ctx, [[a[0] + nx * DP_TOL, a[1] + ny * DP_TOL], [b[0] + nx * DP_TOL, b[1] + ny * DP_TOL], [b[0] - nx * DP_TOL, b[1] - ny * DP_TOL], [a[0] - nx * DP_TOL, a[1] - ny * DP_TOL]], true);
      ctx.fillStyle = rgba(C.blue, 0.14); ctx.fill();
      ctx.setLineDash([8, 8]); ctx.strokeStyle = rgba(C.blue, 0.7); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      // shortcut
      const e = lerpP(a, b, p1);
      path(ctx, [a, e], false); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.setLineDash([12, 8]); ctx.stroke(); ctx.setLineDash([]);
      dot(ctx, a, 9, null, C.ink, 2.5); dot(ctx, b, 9, null, C.ink, 2.5);
      // farthest point
      if (p2 > 0) {
        const tt = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L);
        const foot = [a[0] + tt * dx, a[1] + tt * dy];
        const mid = lerpP(foot, p, p2);
        path(ctx, [foot, mid], false); ctx.strokeStyle = C.fire; ctx.lineWidth = 3; ctx.stroke();
        dot(ctx, p, 11 + 4 * Math.sin(ph * 12) * (1 - p3), null, C.fire, 3);
        const lab = [p[0] + 18, p[1] + (p[1] < foot[1] ? -14 : 30)];
        ctx.save(); ctx.globalAlpha = p2;
        text(ctx, `farthest: ${Math.round(s.d)}`, lab[0], lab[1], { size: 20, weight: 600, color: C.fire, fam: "mono" });
        ctx.restore();
        if (p3 > 0) {
          ctx.save(); ctx.globalAlpha = p3;
          pill(ctx, p[0], p[1] + (p[1] < foot[1] ? -64 : 72), s.keep ? `${Math.round(s.d)} > ${DP_TOL}: keep` : `${Math.round(s.d)} ≤ ${DP_TOL}: drop the rest`, s.keep ? "blue" : "neutral");
          ctx.restore();
        }
      }
    }
    // legend
    ctx.save(); ctx.globalAlpha = span(t, tA, tA + 0.8);
    text(ctx, "TOLERANCE", 56, 806, { size: 15, weight: 600, color: C.muted, spacing: 1.2 });
    ctx.fillStyle = rgba(C.blue, 0.14); ctx.fillRect(56, 822, DP_TOL * 2, 18);
    ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.strokeRect(56, 822, DP_TOL * 2, 18);
    ctx.restore();
    const nk = kept.reduce((s, v) => s + v, 0), nd = dropped.reduce((s, v) => s + v, 0);
    if (t > tA) counter(1544, 780, "Kept · dropped · open", `${nk} · ${nd} · ${DPL.length - nk - nd}`, { align: "right" });
    if (t < tA) {
      ctx.save(); ctx.globalAlpha = span(t, 0.3, 1.2);
      text(ctx, "Douglas–Peucker", 56, 160, { size: 44, weight: 700, fam: "display" });
      text(ctx, "Keep a point only if leaving it out would move the line more than the tolerance.", 56, 204, { size: 22, color: C.muted });
      ctx.restore();
    }
  });

  // 3. One shape at a time
  const PAIR = [0, 1]; // Bluff and Cedar share arc 4
  scenes.push(function naive(t, q, dur) {
    const z = span(t, q(1), q(1) + 2.2);
    const cam = camLerp(CAM_FULL, CAM_ZOOM, z), T = xf(cam);
    const nv = naiveAt(TOL);
    const u = span(t, q(2) - 0.2, q(2) + 2.6);
    const rings = RINGS.map((r, i) => morphRing(r, nv[i].targets, u));
    // "one at a time": the pieces lift apart and settle back
    const ex = Math.sin(Math.PI * span(t, 0.4, q(1) + 0.4)) * 34;
    const center = [MB.cx, MB.cy];
    const shifted = rings.map((r, i) => {
      const c = RINGS[i].reduce((s, p) => [s[0] + p[0] / RINGS[i].length, s[1] + p[1] / RINGS[i].length], [0, 0]);
      const dx = c[0] - center[0], dy = c[1] - center[1], L = Math.hypot(dx, dy);
      return r.map((p) => [p[0] + (dx / L) * ex / cam.s * 1.36, p[1] + (dy / L) * ex / cam.s * 1.36]);
    });
    const dim = (i) => (PAIR.includes(i) ? 1 : 1 - 0.75 * z);
    const pairColor = [C.blue, C.paint];
    drawCounties(shifted, cam, {
      alpha: dim,
      stroke: (i) => (PAIR.includes(i) && z > 0 ? pairColor[PAIR.indexOf(i)] : C.ink),
      lw: (i) => (PAIR.includes(i) ? lerp(1.6, 3, z) : 1.6),
    });
    if (ex > 0.5) {
      ctx.save(); ctx.globalAlpha = Math.min(1, ex / 20);
      text(ctx, "Each county simplifies its own ring", 56, 820, { size: 26, weight: 600, fam: "display" });
      ctx.restore();
    }
    // vertices kept by each county on the shared border
    if (u > 0.6 && z > 0.5) {
      PAIR.forEach((pi, n) => {
        nv[pi].out.forEach((p) => {
          // only points near the shared arc
          const near = MAP.arcs[4].pts.some((a) => Math.abs(a[0] - p[0]) < 0.01 && Math.abs(a[1] - p[1]) < 0.01);
          if (near) dot(ctx, T(p), 6, n ? C.paint : C.blue, C.sunken, 2);
        });
      });
    }
    const ga = span(t, q(3), q(3) + 0.8), oa = span(t, q(4), q(4) + 0.8);
    if (ga > 0 || oa > 0) drawGapsOverlaps(rings, cam, ga, oa, TOL);
    // legend
    if (z > 0) {
      ctx.save(); ctx.globalAlpha = z;
      const L = [[C.blue, `${MAP.polys[0].name}'s copy`, 1], [C.paint, `${MAP.polys[1].name}'s copy`, 1], [C.fire, "Gap: no county", ga], [C.danger, "Overlap: both counties", oa]];
      L.forEach(([col, lab, a], i) => {
        if (a <= 0) return;
        ctx.globalAlpha = z * a;
        const y = 150 + i * 44;
        ctx.fillStyle = col; ctx.fillRect(56, y - 14, 28, 18);
        text(ctx, lab, 100, y, { size: 22, weight: 500 });
      });
      ctx.restore();
    }
  });

  // 4 + 6. Single shapes
  const CASES = [
    { c: G.lakeCase(), title: "Lake in a headland" },
    { c: G.inletCase(), title: "Narrow inlet" },
    { c: G.isletCase(), title: "Small islet" },
  ];
  CASES.forEach((k) => {
    k.r = G.caseResults(k.c);
    k.nT = G.chordTargets(k.c.ring, k.r.naive, true);
    k.tT = G.chordTargets(k.c.ring, k.r.topo, true);
    k.extra = []; // points the careful version keeps that the plain one drops
    k.c.ring.forEach((p, i) => { if (k.r.topo[i] && !k.r.naive[i]) k.extra.push(i); });
  });
  const PANEL_X = [290, 800, 1310], PANEL_S = 1.32;
  function caseXf(i) {
    const k = CASES[i].c;
    const xs = k.ring.map((p) => p[0]), ys = k.ring.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = i === 2 ? 120 : (Math.min(...ys) + Math.max(...ys)) / 2;
    return (p) => [PANEL_X[i] + (p[0] - cx) * PANEL_S, 500 + (p[1] - cy) * PANEL_S];
  }
  function drawCase(i, ring, opts) {
    const T = caseXf(i), k = CASES[i];
    if (opts.ghost) {
      ctx.save(); ctx.globalAlpha *= opts.ghost;
      path(ctx, k.c.ring.map(T), true);
      ctx.setLineDash([6, 6]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    const sr = ring.map(T);
    path(ctx, sr, true);
    ctx.fillStyle = rgba(C.blue, 0.28); ctx.fill("evenodd");
    ctx.strokeStyle = opts.stroke || C.ink; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.stroke();
    k.c.holes.forEach((h) => {
      const sh = h.map(T);
      path(ctx, sh, true);
      ctx.fillStyle = opts.holeBad ? rgba(C.danger, 0.55) : C.sunken; ctx.fill();
      ctx.strokeStyle = opts.holeBad ? C.danger : C.ink; ctx.lineWidth = 2; ctx.stroke();
    });
    return T;
  }
  function panelFrame(i, a, title) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(PANEL_X[i] - 235, 150, 470, 690, 8); ctx.stroke();
    text(ctx, title, PANEL_X[i], 196, { size: 24, weight: 600, fam: "display", align: "center" });
    // tolerance bar for scale
    const tol = CASES[i].c.tol * PANEL_S;
    text(ctx, "TOLERANCE", PANEL_X[i] - 205, 812, { size: 13, weight: 600, color: C.muted, spacing: 1.1 });
    ctx.fillStyle = rgba(C.blue, 0.2); ctx.fillRect(PANEL_X[i] - 205 + 100, 800, tol, 14);
    ctx.strokeStyle = C.blue; ctx.lineWidth = 1.5; ctx.strokeRect(PANEL_X[i] - 205 + 100, 800, tol, 14);
    ctx.restore();
  }

  scenes.push(function invalid(t, q, dur) {
    const starts = [q(1), q(2), q(3)];
    CASES.forEach((k, i) => {
      const a = span(t, 0.2 + i * 0.35, 1.0 + i * 0.35);
      if (a <= 0) return;
      panelFrame(i, a, k.title);
      const u = span(t, starts[i] + 0.3, starts[i] + 2.4);
      const ring = morphRing(k.c.ring, k.nT, u);
      ctx.save(); ctx.globalAlpha = a;
      const bad = u >= 1;
      const T = drawCase(i, ring, { holeBad: bad && i === 0, ghost: u > 0 ? 0.8 : 0 });
      if (u > 0 && u < 1) k.c.ring.forEach((p, j) => { if (k.r.naive[j]) dot(ctx, T(p), 5, C.fire); });
      if (bad) {
        const b = span(t, starts[i] + 2.4, starts[i] + 3.0);
        ctx.globalAlpha = b;
        if (i === 1) k.r.nCross.forEach((p) => { dot(ctx, T(p), 16, rgba(C.danger, 0.25)); cross(ctx, T(p), 9, C.danger, 4); });
        if (i === 2) { k.r.nOut.forEach((p) => dot(ctx, T(p), 6, C.danger)); }
        const label = ["Lake outside its island", "Shore crosses itself", "No area left"][i];
        pill(ctx, PANEL_X[i], 740, label, "danger", b);
      }
      ctx.restore();
    });
    const z = span(t, q(4), q(4) + 0.8);
    if (z > 0) {
      ctx.save(); ctx.globalAlpha = z;
      text(ctx, "Invalid geometry", 800, 120, { size: 34, weight: 700, fam: "display", align: "center", color: C.danger });
      ctx.restore();
    }
  });

  // 5. Topology first
  // neighbors at a node never share a color
  const ARC_COLORS = () => [C.blue, C.paint, C.blue, C.paint, C.wine, C.fire, C.fire, C.blue, C.wine];
  scenes.push(function arcs(t, q, dur) {
    const z = span(t, q(5), q(5) + 2.0);
    const cam = camLerp(CAM_FULL, CAM_ZOOM, z), T = xf(cam);
    const topo = topoAt(TOL);
    const arcStart = q(4) + 0.3, arcEach = (q(5) - q(4) - 0.6) / MAP.arcs.length;
    const morph = morphArcs(topo, 0, (i) => span(t, arcStart + i * arcEach, arcStart + (i + 1.6) * arcEach));
    const rings = MAP.polys.map((p) => G.ringOf(MAP, p, morph));
    const colorize = span(t, q(2), q(2) + 1.2);
    const fillBack = span(t, q(5) - 0.2, q(5) + 1);
    drawCounties(rings, cam, { fillA: lerp(1, 0.35, colorize) * (1 - fillBack) + fillBack, stroke: () => (colorize > 0 ? "transparent" : C.ink) });
    // topology: adjacency pulse on shared borders
    const adj = span(t, q(1), q(1) + 0.6) * (1 - colorize);
    if (adj > 0) {
      ctx.save(); ctx.globalAlpha = adj * (0.6 + 0.4 * Math.sin(t * 5));
      INTERIOR.forEach((ai) => { path(ctx, morph[ai].map(T), false); ctx.strokeStyle = C.fire; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.stroke(); });
      ctx.restore();
    }
    // arcs, one color each, drawn on in turn
    if (colorize > 0) {
      const cols = ARC_COLORS();
      MAP.arcs.forEach((a, i) => {
        const r = clamp((t - q(2) - i * 0.28) / 0.6);
        if (r <= 0) return;
        const pts = morph[i].map(T);
        const n = Math.max(2, Math.ceil(pts.length * r));
        path(ctx, pts.slice(0, n), false);
        ctx.strokeStyle = cols[i % cols.length]; ctx.lineWidth = lerp(5, 3, z); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
      });
      // vertices of each arc while it simplifies
      MAP.arcs.forEach((a, i) => {
        const s0 = arcStart + i * arcEach, s1 = arcStart + (i + 1.6) * arcEach;
        if (t < s0 || t > s1 + 0.6) return;
        const fade = t > s1 ? 1 - (t - s1) / 0.6 : 1;
        ctx.save(); ctx.globalAlpha = fade;
        morph[i].forEach((p, k) => { if (topo.arcKeeps[i][k]) dot(ctx, T(p), 4, cols[i % cols.length], C.sunken, 1.5); });
        ctx.restore();
      });
    }
    // nodes
    const na = span(t, q(3), q(3) + 0.5);
    if (na > 0) {
      Object.values(MAP.nodes).forEach((p, i) => {
        const pop = easeOut((t - q(3) - i * 0.12) / 0.4);
        if (pop <= 0) return;
        dot(ctx, T(p), 10 * pop, C.ink, C.sunken, 3);
        dot(ctx, T(p), 15 * pop, null, rgba(C.ink, 0.35), 2);
      });
    }
    // counters
    if (colorize > 0 && z < 1) {
      ctx.save(); ctx.globalAlpha = colorize * (1 - z);
      const simp = span(t, arcStart, q(5));
      counter(1544, 600, "Arcs", "9", { align: "right" });
      counter(1544, 700, "Nodes", na > 0 ? "6" : "–", { align: "right" });
      counter(1544, 800, "Points stored", fmt(lerp(UNIQUE_ALL, topo.unique, simp)), { align: "right", color: C.blue });
      ctx.restore();
    }
    if (t < q(2)) {
      ctx.save(); ctx.globalAlpha = span(t, 0.3, 1.0) * (1 - span(t, q(2) - 0.5, q(2)));
      text(ctx, "Topology", 56, 160, { size: 44, weight: 700, fam: "display" });
      text(ctx, "Who touches whom, which borders are shared, what sits inside what.", 56, 204, { size: 22, color: C.muted });
      ctx.restore();
    }
    if (z > 0) {
      ctx.save(); ctx.globalAlpha = z;
      pill(ctx, 1400, 150, "0 gaps · 0 overlaps", "success");
      ctx.restore();
    }
  });

  // 6. Checking every shortcut
  scenes.push(function checks(t, q, dur) {
    CASES.forEach((k, i) => {
      const a = span(t, 0.1 + i * 0.25, 0.8 + i * 0.25);
      panelFrame(i, a, k.title);
      const u = span(t, q(3) + i * 0.4, q(3) + 1.8 + i * 0.4);
      const ring = morphRing(k.c.ring, k.tT, u);
      ctx.save(); ctx.globalAlpha = a;
      const T = drawCase(i, ring, { ghost: u > 0 ? 0.8 : 0 });
      // the rejected shortcut
      const ch = span(t, q(1) + i * 0.9, q(1) + i * 0.9 + 0.8) * (1 - span(t, q(3), q(3) + 0.6));
      if (ch > 0 && k.extra.length) {
        const ei = k.extra[0];
        const n = k.c.ring.length;
        let p = ei, nn = ei;
        do { p = (p - 1 + n) % n; } while (!k.r.naive[p]);
        do { nn = (nn + 1) % n; } while (!k.r.naive[nn]);
        const A = T(k.c.ring[p]), B = T(k.c.ring[nn]);
        ctx.save(); ctx.globalAlpha = ch;
        path(ctx, [A, lerpP(A, B, ch)], false);
        ctx.strokeStyle = C.danger; ctx.lineWidth = 3.5; ctx.setLineDash([12, 9]); ctx.stroke(); ctx.setLineDash([]);
        const m = lerpP(A, B, 0.5);
        if (ch > 0.95) { dot(ctx, m, 18, C.dangerSoft, C.danger, 2.5); cross(ctx, m, 7, C.danger, 3.5); }
        ctx.restore();
      }
      if (i === 2 && ch > 0) {
        ctx.save(); ctx.globalAlpha = ch;
        text(ctx, "needs 3 corners", PANEL_X[i], 640, { size: 20, color: C.danger, align: "center", weight: 600 });
        ctx.restore();
      }
      // the point that stays
      const st = span(t, q(2), q(2) + 0.5);
      if (st > 0) {
        k.extra.forEach((ei) => {
          const P = T(ring[ei]);
          dot(ctx, P, 8, C.blue, C.sunken, 2);
          dot(ctx, P, 16 + 5 * Math.sin(t * 6), null, rgba(C.blue, 0.6 * st), 2.5);
        });
      }
      if (u >= 1) pill(ctx, PANEL_X[i], 740, ["Lake stays inside", "Inlet stays open", "Still a triangle"][i], "success", span(t, q(3) + 1.8 + i * 0.4, q(3) + 2.3 + i * 0.4));
      ctx.restore();
    });
  });

  // 7. Side by side
  scenes.push(function compare(t, q, dur) {
    const tolF = lerp(2, 40, span(t, 0.8, dur - 2.2));
    const tol = Math.max(1, Math.round(tolF));
    const nv = naiveAt(tol), tp = topoAt(tol);
    const camL = fit(MB, 50, 190, 770, 720);
    const camR = fit(MB, 830, 190, 1550, 720);
    const nr = nv.map((r) => r.out);
    drawCounties(nr, camL, {});
    drawGapsOverlaps(nr, camL, 1, 1, tol);
    drawCounties(tp.rings, camR, {});
    // divider
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(800, 120); ctx.lineTo(800, 860); ctx.stroke();
    text(ctx, "One shape at a time", 410, 150, { size: 28, weight: 700, fam: "display", align: "center" });
    text(ctx, "Topology-preserving", 1190, 150, { size: 28, weight: 700, fam: "display", align: "center" });
    const hi = span(t, q(3), q(3) + 0.6);
    const drawnL = nr.reduce((s, r) => s + r.length, 0);
    const drawnR = tp.rings.reduce((s, r) => s + r.length, 0);
    counter(250, 770, "Points drawn", fmt(drawnL), { align: "center" });
    counter(1030, 770, "Points drawn", fmt(drawnR), { align: "center", color: hi > 0.5 ? C.blue : C.ink });
    text(ctx, `${fmt(drawnL)} stored: every county keeps its own`, 250, 846, { size: 17, color: C.muted, align: "center" });
    text(ctx, `${fmt(tp.unique)} stored: each border once`, 1030, 846, { size: 17, color: hi > 0.5 ? C.blue : C.muted, align: "center" });
    pill(ctx, 570, 794, "gaps + overlaps", "danger", span(t, q(1), q(1) + 0.6));
    pill(ctx, 1350, 794, "seamless", "success", span(t, q(2), q(2) + 0.6));
    // tolerance readout
    text(ctx, `TOLERANCE  ${tol}`, 800, 100, { size: 16, weight: 600, color: C.muted, align: "center", spacing: 1.4 });
    ctx.fillStyle = rgba(C.blue, 0.18); ctx.fillRect(700, 112, 200, 8);
    ctx.fillStyle = C.blue; ctx.fillRect(700, 112, 200 * (tol / 40), 8);
  });

  // 8. Where to find it
  scenes.push(function tools(t, q, dur) {
    const cards = [
      { name: "ST_Simplify", by: "PostGIS", valid: false, shared: false, at: 0.4 },
      { name: "ST_SimplifyPreserveTopology", by: "PostGIS", valid: true, shared: false, at: q(1) },
      { name: "ST_CoverageSimplify", by: "PostGIS 3.4+ · also mapshaper, TopoJSON", valid: true, shared: true, at: q(2) },
    ];
    const end = span(t, q(3), q(3) + 1.0);
    cards.forEach((c, i) => {
      const a = span(t, c.at, c.at + 0.7);
      if (a <= 0) return;
      const x = 80 + i * 490, y = 170 - end * 40, w = 460, h = 400;
      ctx.save(); ctx.globalAlpha = a * (1 - end * 0.55);
      ctx.fillStyle = C.raised; ctx.strokeStyle = i === 2 ? C.blue : C.line; ctx.lineWidth = i === 2 ? 2.5 : 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
      let fs = 26; font(ctx, fs, 500, "mono"); while (ctx.measureText(c.name).width > w - 56 && fs > 14) { fs--; font(ctx, fs, 500, "mono"); }
      text(ctx, c.name, x + 28, y + 62, { size: fs, weight: 500, fam: "mono", color: i === 2 ? C.blue : C.ink });
      text(ctx, c.by, x + 28, y + 96, { size: 18, color: C.muted });
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 28, y + 124); ctx.lineTo(x + w - 28, y + 124); ctx.stroke();
      [["Each shape stays valid", c.valid], ["Neighbors stay matched", c.shared]].forEach(([lab, ok], r) => {
        const yy = y + 182 + r * 70;
        const col = ok ? C.success : C.danger;
        dot(ctx, [x + 46, yy - 7], 17, ok ? C.successSoft : C.dangerSoft, col, 2);
        if (ok) {
          ctx.strokeStyle = col; ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(x + 38, yy - 7); ctx.lineTo(x + 44, yy - 1); ctx.lineTo(x + 55, yy - 14); ctx.stroke();
        } else cross(ctx, [x + 46, yy - 7], 6, col, 3.2);
        text(ctx, lab, x + 80, yy, { size: 22, weight: 500 });
        text(ctx, ok ? "yes" : "no", x + w - 28, yy, { size: 20, weight: 600, color: col, align: "right" });
      });
      // tiny icon: two shapes and their border
      const ix = x + 28, iy = y + h - 88;
      const sep = c.shared ? 0 : 7;
      ctx.fillStyle = rgba(C.blue, 0.3); ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ix + 120, iy); ctx.lineTo(ix + 140 - sep, iy + 30); ctx.lineTo(ix + 110 - sep, iy + 60); ctx.lineTo(ix, iy + 60); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(C.blue, 0.5);
      ctx.beginPath(); ctx.moveTo(ix + 120 + sep, iy); ctx.lineTo(ix + 260, iy); ctx.lineTo(ix + 260, iy + 60); ctx.lineTo(ix + 110 + sep, iy + 60); ctx.lineTo(ix + 150 + sep, iy + 30); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (!c.shared) { ctx.fillStyle = rgba(C.fire, 0.9); ctx.beginPath(); ctx.moveTo(ix + 120, iy); ctx.lineTo(ix + 127, iy); ctx.lineTo(ix + 157, iy + 30); ctx.lineTo(ix + 140 - 7, iy + 30); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    });
    if (end > 0) {
      ctx.save(); ctx.globalAlpha = end;
      text(ctx, "Simplify the borders,", 800, 690, { size: 64, weight: 700, fam: "display", align: "center" });
      text(ctx, "not the shapes.", 800, 768, { size: 64, weight: 700, fam: "display", align: "center", color: C.blue });
      ctx.restore();
    }
  });

  // ---------- timeline ----------
  const N = window.NARRATION;
  const DATA = N ? N.scenes : [];
  const TIMES = DATA.map((s) => ({
    id: s.id, title: s.title, cues: s.cues,
    dur: s.duration + TAIL,
    audio: (() => { const a = new Audio(s.audio); a.preload = "auto"; return a; })(),
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

  function stopAudio() { TIMES.forEach((s) => { s.audio.pause(); }); }
  function syncAudio() {
    const s = TIMES[cur];
    TIMES.forEach((o, i) => { if (i !== cur) o.audio.pause(); });
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
    if (!s.audio.paused && !s.audio.ended && s.audio.currentTime > 0) tIn = s.audio.currentTime;
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
    if (cue !== lastCue) { caption.textContent = cue || " "; lastCue = cue; }
  }

  function draw() {
    if (!C.ink) readColors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = C.sunken; ctx.fillRect(0, 0, W, H);
    const s = TIMES[cur];
    if (!s) return;
    const q = (i) => (s.cues[i] ? s.cues[i].start : s.dur);
    eyebrow(ctx, cur + 1, s.title);
    ctx.save();
    scenes[cur](started ? tIn : 3.0, q, s.dur);
    ctx.restore();
    // progress through this scene
    ctx.fillStyle = rgba(C.blue, 0.8);
    ctx.fillRect(0, H - 4, W * (started ? tIn / s.dur : 0), 4);
  }

  // ---------- controls ----------
  document.getElementById("start").addEventListener("click", () => { seek(0); setPlaying(true); });
  document.getElementById("play").addEventListener("click", () => setPlaying(!playing));
  scrub.addEventListener("input", () => seek((scrub.value / 1000) * total, false));
  const muteBtn = document.getElementById("mute");
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    TIMES.forEach((s) => (s.audio.muted = muted));
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

  // dev hook: ?t=seconds jumps there paused
  const qs = new URLSearchParams(location.search);
  readColors();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    resize();
    if (qs.has("t")) seek(parseFloat(qs.get("t")), false);
    ui();
  });
  resize();
  window.__topo = { seek, scenes: TIMES.map((s) => [s.id, s.start]) };
})();
