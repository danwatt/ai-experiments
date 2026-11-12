// Landing-page background: slow flight over an endless wireframe city grid.
(() => {
  const cv = document.getElementById("grid-bg");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const B = 40, S = 7, H = 85, NEAR = 1.5, FAR = 1100, COLS = 16, SPEED = 10;
  const RGB = "94,234,212", FILL = "#101318";
  let w, h, f, hz, dpr;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    f = Math.max(w, h) * 0.75; hz = h * 0.3;
  }
  addEventListener("resize", resize); resize();

  const hash = (i, j) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const fade = dz => Math.max(0, 1 - dz / FAR) ** 1.6;

  // Light streaks running up the streets, ahead of the camera.
  const streaks = Array.from({ length: 5 }, (_, k) => ({ x: 0, z: 0, v: 0, reset: true, k }));

  function frame(t) {
    const camZ = t * SPEED, camX = Math.sin(t * 0.07) * 3;
    const P = (x, y, z) => { const dz = Math.max(z - camZ, NEAR); return [w / 2 + f * (x - camX) / dz, hz + f * (H - y) / dz]; };

    ctx.fillStyle = FILL; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createLinearGradient(0, hz - h * 0.25, 0, hz + h * 0.08);
    glow.addColorStop(0, `rgba(${RGB},0)`); glow.addColorStop(0.75, `rgba(${RGB},.10)`); glow.addColorStop(1, `rgba(${RGB},0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, hz - h * 0.25, w, h * 0.33);

    // Ground grid: street lines along z, cross lines along x.
    ctx.lineWidth = 1;
    const g = ctx.createLinearGradient(0, hz, 0, h);
    g.addColorStop(0, `rgba(${RGB},0)`); g.addColorStop(1, `rgba(${RGB},.55)`);
    ctx.strokeStyle = g; ctx.beginPath();
    for (let i = -COLS; i <= COLS; i++) {
      for (const x of [i * B - S, i * B + S]) {
        const [x0, y0] = P(x, 0, camZ + NEAR), [x1, y1] = P(x, 0, camZ + FAR);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
    }
    ctx.stroke();
    for (let j = Math.ceil((camZ + NEAR) / B); j * B < camZ + FAR; j++) {
      ctx.strokeStyle = `rgba(${RGB},${0.5 * fade(j * B - camZ)})`;
      ctx.beginPath();
      for (const z of [j * B - S, j * B + S]) {
        const [x0, y0] = P(-COLS * B, 0, z), [x1, y1] = P(COLS * B, 0, z);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }

    if (!reduce) for (const s of streaks) {
      if (s.reset || s.z - camZ > FAR) {
        const side = s.k % 2 ? 1 : -1;
        s.x = side * (B * (1 + Math.floor(Math.random() * 5)));
        s.z = camZ + 20 + Math.random() * 200; s.v = 40 + Math.random() * 50; s.reset = false;
      }
      s.z += s.v / 60;
      const [ax, ay] = P(s.x, 0.2, s.z - 35), [bx, by] = P(s.x, 0.2, s.z);
      const sg = ctx.createLinearGradient(ax, ay, bx, by);
      const a = fade(s.z - camZ);
      sg.addColorStop(0, `rgba(${RGB},0)`); sg.addColorStop(1, `rgba(230,255,250,${a})`);
      ctx.strokeStyle = sg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // Buildings, far rows first, outer columns first within a row.
    const j0 = Math.floor(camZ / B), j1 = Math.floor((camZ + FAR) / B);
    const cols = []; for (let i = -COLS; i < COLS; i++) cols.push(i);
    cols.sort((a, b) => Math.abs(b + 0.5) - Math.abs(a + 0.5));
    for (let j = j1; j >= j0; j--) {
      const zb0 = j * B + S, z1 = (j + 1) * B - S;
      if (z1 <= camZ + NEAR) continue;
      const z0 = Math.max(zb0, camZ + NEAR), a = fade(z0 - camZ);
      if (a <= 0.01) continue;
      for (const i of cols) {
        const r = hash(i, j);
        if (r < 0.42) continue;
        const x0 = i * B + S, x1 = (i + 1) * B - S;
        const ht = 4 + (hash(j, i) ** 3) * 60 + (r - 0.42) * 25;
        const fbl = P(x0, 0, z0), fbr = P(x1, 0, z0), ftl = P(x0, ht, z0), ftr = P(x1, ht, z0);
        const btl = P(x0, ht, z1), btr = P(x1, ht, z1), bbl = P(x0, 0, z1), bbr = P(x1, 0, z1);
        const faces = [[fbl, fbr, ftr, ftl], [ftl, ftr, btr, btl]];
        if (x1 < camX) faces.push([fbr, bbr, btr, ftr]);
        else if (x0 > camX) faces.push([fbl, bbl, btl, ftl]);
        ctx.fillStyle = FILL; ctx.strokeStyle = `rgba(${RGB},${0.75 * a})`; ctx.lineWidth = 1;
        for (const q of faces) {
          ctx.beginPath(); ctx.moveTo(...q[0]); for (let k = 1; k < 4; k++) ctx.lineTo(...q[k]); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        // Brighter roofline.
        ctx.strokeStyle = `rgba(220,255,250,${0.6 * a})`;
        ctx.beginPath(); ctx.moveTo(...ftl); ctx.lineTo(...ftr); ctx.stroke();
      }
    }
  }

  if (reduce) { frame(40); addEventListener("resize", () => frame(40)); return; }
  const t0 = performance.now();
  const loop = now => { frame(40 + (now - t0) / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
