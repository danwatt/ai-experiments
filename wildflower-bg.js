// Landing-page background: a low-fidelity field of Texas wildflowers (bluebonnets, Indian paintbrush,
// Indian blanket, winecup) over rolling Hill Country, swaying in a wind that gusts across the field.
// Colors come from the Bluebonnet tokens, so it follows the light/dark theme.
// Registers itself in window.BACKDROPS; index.html starts and stops it.
(() => {
  const cv = document.getElementById("field-bg");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  const TAU = Math.PI * 2;
  let active = false, w, h, hz, pal, flowers, blades, hills, oaks, clouds, stars;

  // Seeded PRNG so the field keeps its layout across resizes and reloads.
  const rng = seed => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function palette() {
    const forced = document.documentElement.dataset.theme;
    const dark = forced ? forced === "dark" : darkMq.matches;
    return dark ? {
      dark, skyTop: "#080a18", skyLow: css("--surface"),
      hills: ["#1b2140", "#18233a", "#152033"], oak: "#101a28", field: "#132030", grass: "#2c4340", stem: "#2f4a42",
      blue: css("--bluebonnet"), tip: "#e8eaf5", red: css("--paintbrush"), gold: css("--firewheel"), wine: css("--winecup"), eye: "#3a2418",
      veil: css("--surface"), cloud: "rgba(166,172,201,.10)",
    } : {
      dark, skyTop: "#cdd8f2", skyLow: css("--surface"),
      hills: ["#c3cbe0", "#aebf9c", "#94ad7e"], oak: "#7a9466", field: "#9fb68a", grass: "#7a9862", stem: "#5f7f4b",
      blue: "#3d58c4", tip: "#ffffff", red: css("--paintbrush"), gold: css("--firewheel"), wine: css("--winecup"), eye: "#5a2b1a",
      veil: css("--surface"), cloud: "rgba(255,255,255,.75)",
    };
  }

  // Low hill silhouette at a given baseline: a sum of a few sines with random phases.
  const ridge = (r, base, amp) => { const k = [0.8 + r(), 1.9 + r() * 2, 4 + r() * 3], p = k.map(() => r() * TAU); return x => base - amp * (Math.sin(x / w * TAU * k[0] / 2 + p[0]) * 0.6 + Math.sin(x / w * TAU * k[1] / 2 + p[1]) * 0.3 + Math.sin(x / w * TAU * k[2] / 2 + p[2]) * 0.1); };

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hz = h * 0.56;
    const r = rng(1901); // the year the bluebonnet became the Texas state flower
    hills = [ridge(r, hz - h * 0.11, h * 0.04), ridge(r, hz - h * 0.05, h * 0.035), ridge(r, hz, h * 0.02)];
    oaks = Array.from({ length: Math.round(w / 90) }, () => { const x = r() * w; return { x, s: 0.6 + r() * 0.8, y: hills[1](x) }; });
    clouds = Array.from({ length: 4 }, () => ({ x: r() * w, y: h * (0.06 + r() * 0.24), s: 0.6 + r() * 0.9, v: 3 + r() * 4 }));
    stars = Array.from({ length: 90 }, () => ({ x: r() * w, y: r() * (hz - h * 0.12), a: 0.2 + r() * 0.6, p: r() * TAU }));

    const area = w * (h - hz), n = Math.min(2200, Math.round(area / 420));
    flowers = []; blades = [];
    for (let i = 0; i < n; i++) {
      const x = r() * (w + 40) - 20, y = hz + 4 + (h - hz) * r() ** 0.85, d = (y - hz) / (h - hz), s = 0.22 + 1.05 * d ** 1.4;
      // Drifts: paintbrush and Indian blanket come in patches through a sea of bluebonnets.
      const patch = 0.5 + 0.5 * Math.sin(x * 0.0055 + 1.3) * Math.sin(y * 0.018 + x * 0.0016);
      const q = r();
      const type = q < 0.08 + 0.3 * patch ** 3 ? "paintbrush" : q < 0.16 + 0.32 * patch ** 3 ? "blanket" : q < 0.21 + 0.32 * patch ** 3 ? "winecup" : "bluebonnet";
      flowers.push({ x, y, d, s, type, L: s * (20 + r() * 26), flex: 0.7 + r() * 0.6, ph: r() * TAU });
    }
    for (let i = 0; i < n * 0.9; i++) {
      const x = r() * (w + 40) - 20, y = hz + 2 + (h - hz) * r() ** 0.85, d = (y - hz) / (h - hz), s = 0.22 + 1.05 * d ** 1.4;
      blades.push({ x, y, d, L: s * (10 + r() * 22), lean: (r() - 0.5) * 0.5, flex: 0.8 + r() * 0.6, ph: r() * TAU });
    }
    flowers.sort((a, b) => a.y - b.y);
  }

  // Wind: slow gust fronts rolling left to right, a faster ripple on top, and a per-plant flutter.
  const wind = (x, y, t, ph) => 0.1 + 0.16 * (Math.sin(x * 0.0042 - t * 0.75) * 0.65 + Math.sin(x * 0.011 + y * 0.012 - t * 1.6) * 0.35) + 0.035 * Math.sin(t * 2.6 + ph);

  function stem(x, y, L, a) {
    const tx = x + Math.sin(a) * L, ty = y - Math.cos(a) * L, cx = x + Math.sin(a) * L * 0.2, cy = y - L * 0.55;
    return [tx, ty, cx, cy];
  }

  function frame(t) {
    pal = pal || palette();
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, pal.skyTop); sky.addColorStop(1, pal.skyLow);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    if (pal.dark) for (const s of stars) { ctx.fillStyle = `rgba(232,234,245,${s.a * (0.75 + 0.25 * Math.sin(t * 0.8 + s.p))})`; ctx.fillRect(s.x, s.y, 1.4, 1.4); }
    ctx.fillStyle = pal.cloud;
    for (const c of clouds) {
      const x = ((c.x + t * c.v) % (w + 300)) - 150, k = c.s * 26;
      ctx.beginPath();
      for (const [dx, dy, rr] of [[0, 0, 1.6], [1.4, 0.3, 1.2], [-1.4, 0.35, 1.1], [0.7, -0.6, 1.1], [2.5, 0.5, 0.8]]) { ctx.moveTo(x + dx * k + rr * k, c.y + dy * k); ctx.ellipse(x + dx * k, c.y + dy * k, rr * k, rr * k * 0.62, 0, 0, TAU); }
      ctx.fill();
    }

    // Hills, far to near; live oaks sit on the middle ridge.
    hills.forEach((f, i) => {
      ctx.fillStyle = i === 2 ? pal.field : pal.hills[i];
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, f(x));
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      if (i === 1) {
        ctx.fillStyle = pal.oak; ctx.beginPath();
        for (const o of oaks) { const r = 9 * o.s; for (const [dx, dy, k] of [[-0.9, 0, 0.8], [0, -0.45, 1], [0.95, 0.05, 0.75]]) { ctx.moveTo(o.x + dx * r + k * r, o.y - r * 0.6 + dy * r); ctx.ellipse(o.x + dx * r, o.y - r * 0.6 + dy * r, k * r, k * r * 0.7, 0, 0, TAU); } }
        ctx.fill();
      }
      if (i === 2) { // a blue haze where the far bluebonnets blur together
        const g = ctx.createLinearGradient(0, hz - h * 0.03, 0, hz + (h - hz) * 0.7);
        g.addColorStop(0, pal.blue + "38"); g.addColorStop(0.12, pal.blue + "70"); g.addColorStop(0.45, pal.blue + "30"); g.addColorStop(1, pal.blue + "00");
        ctx.fillStyle = g; ctx.fill();
      }
    });

    // Grass in three depth bands so each band strokes as one path.
    ctx.strokeStyle = pal.grass; ctx.lineCap = "round";
    for (const [lo, hi, lw] of [[0, 0.33, 0.7], [0.33, 0.66, 1.1], [0.66, 1.01, 1.6]]) {
      ctx.lineWidth = lw; ctx.beginPath();
      for (const b of blades) {
        if (b.d < lo || b.d >= hi) continue;
        const [tx, ty, cx, cy] = stem(b.x, b.y, b.L, b.lean + wind(b.x, b.y, t, b.ph) * b.flex * 1.3);
        ctx.moveTo(b.x, b.y); ctx.quadraticCurveTo(cx, cy, tx, ty);
      }
      ctx.stroke();
    }

    for (const f of flowers) {
      const a = wind(f.x, f.y, t, f.ph) * f.flex, r = 3 * f.s;
      const [tx, ty, cx, cy] = stem(f.x, f.y, f.L, a);
      if (f.d < 0.1) { // far: just a fleck of color
        ctx.fillStyle = f.type === "bluebonnet" ? pal.blue : f.type === "paintbrush" ? pal.red : f.type === "blanket" ? pal.gold : pal.wine;
        ctx.fillRect(tx - r * 0.7, ty - r * 1.2, r * 1.4, r * 2.2);
        continue;
      }
      ctx.strokeStyle = pal.stem; ctx.lineWidth = Math.max(0.6, f.s * 1.3);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.quadraticCurveTo(cx, cy, tx, ty); ctx.stroke();
      let ux = tx - cx, uy = ty - cy; const m = Math.hypot(ux, uy) || 1; ux /= m; uy /= m;
      if (f.type === "bluebonnet") {
        // A raceme: stacked blue florets, widest at the bottom, with the white tip on top.
        for (let k = 4; k >= 0; k--) {
          const px = tx - ux * k * r * 1.15, py = ty - uy * k * r * 1.15, rr = r * (0.65 + 0.16 * k);
          ctx.fillStyle = k === 0 ? pal.tip : pal.blue;
          ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
        }
      } else if (f.type === "paintbrush") {
        ctx.fillStyle = pal.red; ctx.beginPath();
        ctx.ellipse(tx - ux * r * 0.8, ty - uy * r * 0.8, r * 1.9, r * 0.95, Math.atan2(uy, ux), 0, TAU); ctx.fill();
      } else if (f.type === "blanket") {
        ctx.fillStyle = pal.gold; ctx.beginPath(); ctx.arc(tx, ty, r * 1.45, 0, TAU); ctx.fill();
        ctx.fillStyle = pal.red; ctx.beginPath(); ctx.arc(tx, ty, r * 1.0, 0, TAU); ctx.fill();
        ctx.fillStyle = pal.eye; ctx.beginPath(); ctx.arc(tx, ty, r * 0.4, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = pal.wine; ctx.beginPath(); ctx.arc(tx, ty, r * 1.15, 0, TAU); ctx.fill();
        ctx.fillStyle = pal.tip; ctx.beginPath(); ctx.arc(tx, ty, r * 0.35, 0, TAU); ctx.fill();
      }
    }
  }

  let raf = 0, last = 0;
  const t0 = performance.now();
  const loop = now => { raf = requestAnimationFrame(loop); if (now - last < 32) return; last = now; frame((now - t0) / 1000); };
  const start = () => { active = true; cancelAnimationFrame(raf); pal = palette(); if (reduce.matches) frame(0); else raf = requestAnimationFrame(loop); };
  const stop = () => { active = false; cancelAnimationFrame(raf); };
  addEventListener("resize", () => { layout(); if (active && reduce.matches) frame(0); });
  darkMq.addEventListener("change", () => { pal = palette(); if (active && reduce.matches) frame(0); });
  reduce.addEventListener("change", () => active && start());
  layout();
  (window.BACKDROPS ||= {}).flowers = { canvas: cv, start, stop };
})();
