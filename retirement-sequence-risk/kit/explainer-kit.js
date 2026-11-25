// Explainer kit: the player and drawing toolkit shared by the narrated explainers.
//
// An explainer calls ExplainerKit(setup). setup receives the toolkit (drawing helpers, easing, formatting,
// hover details) and returns { scenes, forkAfter, forkShow }:
//   scenes     scene id -> function (t, q, dur) that draws one frame at t seconds into the scene.
//              q(i) is when narration line i starts; q.span / q.lin / q.at time things relative to one
//              line, q.sweep / q.spanTo run from one line to another, q.window fades in and back out.
//              A scene can set .ownEntrance = true to skip the standard fade-and-rise entrance.
//   forkAfter  id of the scene that ends with the "how should we count the dollars?" choice; leave it
//              out for an explainer with one track (no choice markup needed, and the end screen
//              offers "Watch again" from the start)
//   forkShow   (scene) -> seconds into that scene when the choice buttons appear
// The page provides the canvas, captions, controls, choice and end-screen markup, window.NARRATION
// (from build_voice.py) and window.HIST (data.js).
(function () {
  "use strict";
  window.ExplainerKit = function (setup) {
    const W = 1600, Hh = 900;
    const TAIL = 1.4; // seconds of picture after the last word of a scene

    // ---------- theme ----------
    const root = document.documentElement;
    try { const t = localStorage.getItem("retire-theme"); if (t === "light" || t === "dark") root.dataset.theme = t; } catch (e) {}
    const C = {};
    function readColors() {
      const cs = getComputedStyle(root);
      const v = (n) => cs.getPropertyValue("--" + n).trim();
      Object.assign(C, {
        surface: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken"), line: v("line"), lineStrong: v("line-strong"),
        ink: v("ink"), muted: v("ink-muted"), blue: v("bluebonnet"), blueDeep: v("bluebonnet-deep"), blueSoft: v("bluebonnet-soft"),
        fire: v("firewheel"), danger: v("danger"), dangerSoft: v("danger-soft"), success: v("success"), successSoft: v("success-soft"),
        onBlue: v("on-bluebonnet"), paintbrush: v("paintbrush"), winecup: v("winecup"),
      });
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

    // ---------- chart helpers ----------
    // a standout return on a bar chart: the percentage, with the year under it (or above, for a loss)
    function extremeLabel(cx, endY, v, year) {
      const up = v >= 0;
      text(`${up ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`, cx, up ? endY - 24 : endY + 18, { size: 16, weight: 700, align: "center", color: up ? C.ink : C.danger });
      text(String(year), cx, up ? endY - 8 : endY + 34, { size: 14, color: C.muted, align: "center" });
    }
    // how bright a mark is while the narration points elsewhere: 1 in focus, easing down to DIM otherwise.
    // Combine two with Math.min when a chart steps back twice.
    const DIM = 0.3;
    const spotlight = (progress, inFocus) => (inFocus ? 1 : lerp(1, DIM, progress));
    // a label tied to a point by a leader line: the line starts at y = from and runs toward the label at
    // labelY, `grow` of the way (0..1), stopping `gap` px short. o also takes text options, dx (label
    // offset) and fade (0..1). Red and bold unless told otherwise.
    function callout(x, from, labelY, label, o = {}) {
      alpha(o.fade == null ? 1 : o.fade, () => {
        const gap = o.gap == null ? 10 : o.gap, toward = labelY + (from > labelY ? gap : -gap);
        line(x, from, x, lerp(from, toward, o.grow == null ? 1 : o.grow), o.color || C.danger, 2);
        text(label, x + (o.dx || 0), labelY, Object.assign({ size: 21, weight: 700, color: C.danger }, o));
      });
    }
    // a number counting up from zero over d seconds from t0, then formatted
    const countTo = (t, t0, value, fmt = (v) => Math.round(v), d = 1.1) => fmt(value * tally(t, t0, d));
    // a formatter for counts like "31 of 52"
    const ofN = (n) => (v) => `${Math.round(v)} of ${n}`;
    // a full dollar amount, for hover details
    const dollars = (v) => "$" + Math.round(v).toLocaleString("en-US");
    // gridline values from 0 up to top
    const ticksTo = (top, step) => { const out = []; for (let v = 0; v <= top + 1; v += step) out.push(v); return out; };

    // A chart's frame: axes, gridlines, year labels, the small title above and the axis title below.
    // Takes the axes() settings plus yTicks/yFmt, xTicks/xFmt/xLabelY, title/titleGap, xTitle, and
    // fade (0..1, for frames that fade in). under(A) draws first, behind the gridlines (eras, watermarks).
    function chartFrame(o) {
      const A = axes(o);
      if (o.under) o.under(A);
      alpha(o.fade == null ? 1 : o.fade, () => {
        if (o.yTicks) yGrid(A, o.yTicks, o.yFmt || moneyTick);
        if (o.xTicks) xLabels(A, o.xTicks, o.xFmt || ((v) => v), o.xLabelY);
        if (o.xTitle) text(o.xTitle, (A.x0 + A.x1) / 2, A.y1 + 66, { size: 20, color: C.muted, align: "center" });
        if (o.title) text(o.title, A.x0 - 60, A.y0 - (o.titleGap || 34), { size: 20, color: C.muted });
      });
      return A;
    }

    // One bar per item, each growing in turn with a small overshoot.
    //   x(item, i)        where on the x axis (domain units; may be fractional while bars move)
    //   value(item, i)    the bar's height (domain units); clamp: [lo, hi] keeps tall ones on the chart
    //   color(item, i, v)
    //   grow + stagger    a 0..1 sweep across the items, each taking `stagger` item-widths to grow
    //   progress(item, i) or each bar's own 0..1 progress instead
    //   pad, radius       px inside each band (default 2), corner radius (default 3)
    //   alpha(item, i, v) fade for this bar and whatever before/after draw with it
    //   shift(item, i)    { x, y } px offsets (bars hopping while they move)
    //   dx/dw(item, i)    extra px offset and width (a pulse)
    //   extremes(v)       true for values that get a standout label (needs year(item, i))
    //   before/after(item, i, g)  extra drawing under/over the bar; g = { x, w, cx, base, end, v, p }
    //   hover(item, i, g) html for the bar's hover region (the chart's full height, plus hoverAbove,
    //                     hoverBelow and hoverPad px)
    function barSeries(A, items, o) {
      const band = A.X(1) - A.X(0), pad = o.pad == null ? 2 : o.pad, w0 = band - 2 * pad;
      items.forEach((it, i) => {
        const p = o.progress ? o.progress(it, i) : o.grow == null ? 1 : stag(o.grow, i, items.length, o.stagger || 4);
        if (p <= 0) return;
        const v = o.value(it, i), sh = o.shift ? o.shift(it, i) : null;
        const x = A.X(o.x(it, i)) + pad + (sh ? sh.x || 0 : 0) + (o.dx ? o.dx(it, i) : 0), w = w0 + (o.dw ? o.dw(it, i) : 0);
        const sy = sh ? sh.y || 0 : 0, base = A.Y(0) + sy, end = A.Y(o.clamp ? clamp(v, o.clamp[0], o.clamp[1]) : v) + sy;
        const g = { x, w, cx: x + w / 2, base, end, v, p };
        const draw = () => {
          if (o.before) o.before(it, i, g);
          growBar(x, base, end, w, o.color(it, i, v), o.radius == null ? 3 : o.radius, p);
          if (o.after) o.after(it, i, g);
        };
        if (o.alpha) alpha(o.alpha(it, i, v), draw); else draw();
        if (o.extremes && o.extremes(v)) alpha(span(p, 0.6, 1), () => extremeLabel(g.cx, end, v, o.year(it, i)));
        if (o.hover) {
          const hp = o.hoverPad || 0, ha = o.hoverAbove || 0;
          hot(x - hp, A.y0 - ha, w + 2 * hp, A.y1 - A.y0 + ha + (o.hoverBelow || 0), o.hover(it, i, g));
        }
      });
      return { w: w0, band };
    }

    // A line that draws itself in. pts are [x, value] in domain units; progress 0..1 runs along them.
    //   color, width   line style (width default 4)
    //   glow + t       a pulsing dot at the moving end
    //   tipLabel(v, progress)  { text, dx, dy, ...text options } for a value beside the tip, or null
    // Returns the tip's pixel position.
    function lineSeries(A, pts, o) {
      const P = pts.map(([x, v]) => [A.X(x), A.Y(v)]);
      const prog = o.progress == null ? 1 : o.progress;
      const tip = partial(P, prog, o.color, o.width || 4);
      if (o.glow) glow(tip[0], tip[1], o.color, o.t);
      if (o.tipLabel && prog > 0) {
        const f = clamp(prog) * (pts.length - 1), k = Math.min(Math.floor(f), pts.length - 2);
        const lab = o.tipLabel(lerp(pts[k][1], pts[k + 1][1], f - k), prog);
        if (lab) text(lab.text, tip[0] + (lab.dx || 0), tip[1] + (lab.dy || 0), lab);
      }
      return tip;
    }

    // A hover region for each x (domain units), a column the width of one step on the x axis.
    // align "center" (default) centers it on x, as for points on a line; "start" begins it at x, as for
    // a year drawn as a bar. y0/y1 default to the chart's own; mark "line" shows a guide line on hover.
    function columnHovers(A, xs, html, o = {}) {
      const band = A.X(1) - A.X(0), y0 = o.y0 == null ? A.y0 : o.y0, y1 = o.y1 == null ? A.y1 : o.y1;
      xs.forEach((x) => hot(o.align === "start" ? A.X(x) : A.X(x) - band / 2, y0, band, y1 - y0, html(x), o.mark));
    }

    // ---------- cards ----------
    // A centered title with a few lines under it, each easing in after the last (track intro cards).
    function titleCard(t, o) {
      alpha(span(t, 0.2, 0.9), () => text(o.title, 800, 230, { size: o.size || 64, weight: 700, fam: "display", align: "center", color: o.color }));
      const step = o.step || 1.4;
      o.lines.forEach((l, i) => alpha(span(t, 0.9 + i * step, 1.6 + i * step), () => text(l, 800, 330 + i * 46, { size: 28, color: C.muted, align: "center" })));
    }
    // A card with a big number: it lands with a small bounce, a colored bar grows along its top edge and
    // the number counts up. value is a string or a function of the count's progress (0..1).
    function statCard(o) {
      const a = o.progress, x = o.cx, top = o.top == null ? 190 : o.top, w = o.w || 540, h = o.h || 240;
      if (a <= 0) return;
      zoomAt(x, top + h / 2, lerp(0.85, 1, backOut(a)), () => alpha(a, () => {
        ctx.fillStyle = C.raised; ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x - w / 2, top, w, h, 18); ctx.fill(); ctx.stroke();
        ctx.fillStyle = o.color; ctx.beginPath(); ctx.roundRect(x - w / 2, top, w * easeOut(a), 6, [18, 18, 0, 0]); ctx.fill();
        text(o.title, x, top + 60, { size: 26, weight: 600, color: C.muted, align: "center" });
        text(typeof o.value === "function" ? o.value(easeOut(a)) : o.value, x, top + 150, { size: 68, weight: 700, fam: "display", align: "center", color: o.color });
        text(o.sub, x, top + 205, { size: 22, color: C.muted, align: "center" });
      }));
    }
    // A worked example that builds a row at a time, as the narrator reads it.
    //   x, y, w     the panel (its height follows the rows)
    //   rows        { label, value, color, strong } — value in the color on the right; strong colors the label too
    //   appear      0..1 for the panel itself (it lands with a small bounce), fade 0..1 to clear it
    //   reveal(i)   0..1 for each row (it rises into place)
    function ledger(o) {
      const fade = o.fade == null ? 1 : o.fade;
      if (o.appear <= 0 || fade <= 0) return;
      zoomAt(o.x + o.w / 2, o.y, lerp(0.92, 1, backOut(o.appear)), () => alpha(ease(o.appear) * fade, () => {
        ctx.fillStyle = rgba(C.raised, 0.96); ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, 64 + o.rows.length * 54, 16); ctx.fill(); ctx.stroke();
        o.rows.forEach((r, i) => alpha(o.reveal(i), () => {
          const y = o.y + 56 + i * 54 + (1 - o.reveal(i)) * 14;
          text(r.label, o.x + 28, y, { size: 24, weight: 600, color: r.strong ? r.color : C.muted });
          if (r.value) text(r.value, o.x + o.w - 28, y, { size: 30, weight: 700, fam: "display", align: "right", color: r.color });
        }));
      }));
    }

    // ---------- scenes on both tracks ----------
    // twoTracks(SCENES, SETS) returns both(id, draw): draw(t, q, D) becomes scene `id` for today's
    // dollars (D = SETS.real) and `id-nominal` for plain dollars. Pass [realId, plainId] for other names.
    const twoTracks = (scenes, sets) => (id, draw) => {
      const [r, n] = Array.isArray(id) ? id : [id, id + "-nominal"];
      scenes[r] = (t, q, dur) => draw(t, q, sets.real, dur);
      scenes[n] = (t, q, dur) => draw(t, q, sets.nominal, dur);
    };

    // ---------- the explainer's own scenes ----------
    const cfg = setup({ W, Hh, C, ctx, rgba, clamp, ease, span, lin, lerp, easeOut, backOut, stag, tally, pct, spct, money, moneyTick, dollars, FONT, font, text, alpha, dot, line, partial, bar, growBar, zoomAt, glow, words, shake, flash, pill, eyebrow, counter, axes, yGrid, xLabels, legend, hot, hvBox, extremeLabel, spotlight, callout, countTo, ofN, ticksTo, chartFrame, barSeries, lineSeries, columnHovers, titleCard, statCard, ledger, twoTracks, isStarted: () => started });

    // ---------- timeline ----------
    const N = window.NARRATION;
    const DATA = N ? N.scenes : [];
    if (N && N.draft) {
      document.getElementById("startHint").textContent = "Draft timing, no voiceover yet. Captions show the script. Space pauses, arrow keys skip.";
    }
    const SCENES = cfg.scenes;
    const ALL = DATA.map((s) => ({
      id: s.id, title: s.title, cues: s.cues, track: s.track || null,
      dur: s.duration + TAIL,
      audio: s.audio ? (() => { const a = new Audio(s.audio); a.preload = "auto"; return a; })() : null,
    }));
    // The story forks after the shared scenes: one track per way of counting dollars.
    // Until the viewer picks, the timeline shows the default track and playback stops at the fork.
    const FORK_AFTER = cfg.forkAfter;
    let track = "real", chosen = false;
    let TIMES = [], total = 0;

    let cur = 0, tIn = 0, playing = false, started = false, last = 0, muted = false, captions = true;
    const caption = document.getElementById("caption");
    const scrub = document.getElementById("scrub");
    const timeEl = document.getElementById("time");
    const ticks = document.getElementById("ticks"), scrubTip = document.getElementById("scrubTip");
    const playLabel = document.getElementById("playLabel"), playIcon = document.getElementById("playIcon");
    const choice = document.getElementById("choice");
    const trackBtns = [...document.querySelectorAll("[data-track]")];

    function buildTimeline() {
      TIMES = ALL.filter((s) => !s.track || s.track === track);
      total = 0; TIMES.forEach((s) => { s.start = total; total += s.dur; });
      // a marker on the scrub bar where each chapter starts (the first starts at 0, so it gets none)
      ticks.innerHTML = TIMES.slice(1).map((s) => `<i style="left: ${(100 * s.start) / total}%"></i>`).join("");
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
    function showChoice(on) { if (choice && choice.hidden === on) choice.hidden = !on; }
    // the buttons come up when the narrator offers the choice; playback waits at the end of the scene
    const FORK_SHOW = cfg.forkShow;
    const forkOpen = (s, t) => !!FORK_AFTER && s.id === FORK_AFTER && !chosen && started && t >= FORK_SHOW(s);
    const endEl = document.getElementById("end"), endBtn = document.getElementById("endOther");
    const otherTrack = () => (track === "real" ? "nominal" : "real");
    function showEnd(on) {
      if (on && FORK_AFTER) {
        // borrow the wording from the fork's own buttons
        const src = choice.querySelector(`[data-pick="${otherTrack()}"]`);
        endBtn.querySelector("b").textContent = `Watch again in ${src.querySelector("b").textContent.toLowerCase()}`;
        endBtn.querySelector("span").textContent = src.querySelector("span").textContent;
        endBtn.classList.toggle("choice__btn--fire", otherTrack() === "nominal");
      }
      if (endEl.hidden === on) endEl.hidden = !on;
    }
    if (!FORK_AFTER) { endBtn.querySelector("b").textContent = "Watch again"; endBtn.querySelector("span").textContent = "From the start"; }
    endBtn.addEventListener("click", () => {
      showEnd(false);
      if (!FORK_AFTER) return seek(0.001, true);
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
    if (choice) choice.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pick(b.dataset.pick)));
    // nobody picks: start plain dollars after a short wait
    const AUTO_PICK = 15, timerEl = document.getElementById("choiceTimer");
    let waitFrom = null;
    setInterval(() => {
      const s = TIMES[cur];
      const waiting = s && !!FORK_AFTER && s.id === FORK_AFTER && !chosen && !playing && started && tIn >= s.dur - 0.01;
      if (!waiting) { waitFrom = null; if (timerEl && timerEl.textContent) timerEl.textContent = ""; return; }
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
      scrub.setAttribute("aria-valuetext", `${mmss(gt)}, chapter ${cur + 1}: ${s.title}`);
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
      // timing relative to a line of narration: q.span(2, 1.5, 2.1) eases in from 1.5 s to 2.1 s after line 2 starts
      q.at = (i, a = 0) => q(i) + a;
      q.span = (i, a, b) => span(t, q(i) + a, q(i) + b);
      q.lin = (i, a, b) => lin(t, q(i) + a, q(i) + b);
      // across lines: q.sweep(1, 0.4, 2, -0.3) runs 0..1 from 0.4 s after line 1 to 0.3 s before line 2
      q.sweep = (i, a, j, b) => lin(t, q(i) + a, q(j) + b);
      q.spanTo = (i, a, j, b) => span(t, q(i) + a, q(j) + b);
      // in, then out: eases in after line i, then back out after line j
      q.window = (i, a, b, j, c, d) => span(t, q(i) + a, q(i) + b) * (1 - span(t, q(j) + c, q(j) + d));
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
    // the scrub bar: hovering shows the chapter under the pointer; letting go near a marker snaps to that chapter's start
    const THUMB = 8; // half the range thumb: the track runs from THUMB px in from each end
    const scrubAt = (e) => { const r = scrub.getBoundingClientRect(); return { x: e.clientX - r.left, p: clamp((e.clientX - r.left - THUMB) / (r.width - 2 * THUMB)), w: r.width - 2 * THUMB }; };
    const chapterAt = (gt) => { let i = 0; TIMES.forEach((s, k) => { if (gt >= s.start) i = k; }); return i; };
    scrub.addEventListener("input", () => {
      let gt = (scrub.value / 1000) * total;
      const w = scrub.getBoundingClientRect().width - 2 * THUMB, near = TIMES.find((s) => Math.abs(((s.start - gt) / total) * w) < 6);
      if (near) gt = near.start + 0.001;
      seek(gt, false);
    });
    scrub.addEventListener("mousemove", (e) => {
      const { x, p } = scrubAt(e), gt = p * total, i = chapterAt(gt);
      scrubTip.innerHTML = `<b>${i + 1}. ${TIMES[i].title}</b><span>${mmss(gt)}</span>`;
      scrubTip.hidden = false;
      const half = scrubTip.offsetWidth / 2, w = scrub.getBoundingClientRect().width; // keep it over the bar
      scrubTip.style.left = `${clamp(x, Math.min(half, w / 2), Math.max(w - half, w / 2))}px`;
    });
    scrub.addEventListener("mouseleave", () => { scrubTip.hidden = true; });
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
  };
})();
