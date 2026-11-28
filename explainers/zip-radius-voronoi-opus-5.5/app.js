// Within 10 miles: narrated motion graphic on ZIP code radius search and Voronoi cells.
// Every frame is drawn from the clock alone (render(t)), so seeking and scrubbing just work.
// Scene timing comes from narration.js (sentence start/end times measured from the rendered audio).
(() => {
  'use strict';
  const N = window.NARRATION;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- world
  const W = 64, H = 36, R = 10;
  const SEARCH = [27, 19];
  const DOWNTOWN = [31, 17];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261112);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ZIP centroids: dart throwing with spacing that widens away from downtown
  const sites = [SEARCH.slice()];
  for (let k = 0; k < 9000; k++) {
    const p = [0.8 + rnd() * (W - 1.6), 0.8 + rnd() * (H - 1.6)];
    const minD = 2.7 + dist(p, DOWNTOWN) * 0.12;
    if (sites.every((s) => dist(s, p) > minD)) sites.push(p);
  }
  const NS = sites.length;

  // made-up but plausible ZIP codes
  const pool = [];
  for (let z = 76001; z <= 76299; z++) if (z !== 76104) pool.push(String(z));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const zips = sites.map((_, i) => (i === 0 ? '76104' : pool[i - 1]));

  // stores: clustered around downtown plus a scattering everywhere
  const stores = [];
  while (stores.length < 150) {
    let p;
    if (rnd() < 0.7) p = [DOWNTOWN[0] + gauss() * 11, DOWNTOWN[1] + gauss() * 7];
    else p = [rnd() * W, rnd() * H];
    if (p[0] > 1 && p[0] < W - 1 && p[1] > 1 && p[1] < H - 1) stores.push(p);
  }
  const storeOrder = stores.map((_, i) => i).sort(() => rnd() - 0.5);
  const storeRank = new Array(stores.length);
  storeOrder.forEach((s, k) => { storeRank[s] = k / stores.length; });

  // fake but self-consistent coordinates for labels
  const latOf = (y) => 32.725 - (y - SEARCH[1]) / 69;
  const lonOf = (x) => -97.321 + (x - SEARCH[0]) / 58.1;
  const fmtLat = (v) => v.toFixed(4);
  const fmtLon = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(4);

  // ---------------------------------------------------------------- geometry
  const delaunay = d3.Delaunay.from(sites);
  const vor = delaunay.voronoi([0, 0, W, H]);
  const cells = sites.map((_, i) => { const p = vor.cellPolygon(i); p.pop(); return p; });
  const nbrs = sites.map((_, i) => [...vor.neighbors(i)]);

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function pip(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  const polyArea = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  function touches(i, c, r) {
    const poly = cells[i];
    if (pip(c, poly)) return true;
    for (let k = 0; k < poly.length; k++) if (segDist(c, poly[k], poly[(k + 1) % poly.length]) <= r) return true;
    return false;
  }
  const insideAll = (i, c, r) => cells[i].every((v) => dist(v, c) <= r);

  const siteD = sites.map((s) => dist(s, SEARCH));
  const cls = sites.map((_, i) => (insideAll(i, SEARCH, R) ? 'in' : touches(i, SEARCH, R) ? 'edge' : 'out'));
  const centroidIn = sites.map((_, i) => siteD[i] <= R);
  const nCentroidIn = centroidIn.filter(Boolean).length;
  const nTouch = cls.filter((c) => c !== 'out').length;
  const nIn = cls.filter((c) => c === 'in').length;
  const nEdge = nTouch - nIn;
  const byDist = sites.map((_, i) => i).sort((a, b) => siteD[a] - siteD[b]);

  // overlap of each cell with the search circle, by sampling
  const overlap = new Array(NS).fill(0);
  { const st = 0.2; let last = 0;
    for (let x = SEARCH[0] - R; x <= SEARCH[0] + R; x += st)
      for (let y = SEARCH[1] - R; y <= SEARCH[1] + R; y += st)
        if (Math.hypot(x - SEARCH[0], y - SEARCH[1]) <= R) { last = delaunay.find(x, y, last); overlap[last] += st * st; } }

  // "real" ZIP outlines: Voronoi edges pushed around by a smooth vector field (shared edges stay shared)
  const field = (x, y) => [
    0.5 * (Math.sin(0.9 * x + 1.7 * y) + 0.6 * Math.sin(2.3 * x - 1.1 * y + 2) + 0.35 * Math.sin(4.1 * x + 3.3 * y)),
    0.5 * (Math.cos(1.3 * x - 0.8 * y + 1) + 0.6 * Math.sin(1.9 * x + 2.4 * y) + 0.35 * Math.cos(3.7 * x - 4.2 * y)),
  ];
  const warp = (p) => {
    const f = field(p[0], p[1]);
    const onX = p[0] < 1e-6 || p[0] > W - 1e-6, onY = p[1] < 1e-6 || p[1] > H - 1e-6;
    return [onX ? p[0] : p[0] + f[0], onY ? p[1] : p[1] + f[1]];
  };
  const jagged = cells.map((poly) => {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const n = Math.max(2, Math.ceil(dist(a, b) / 0.45));
      for (let s = 0; s < n; s++) { const t = s / n; out.push(warp([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])); }
    }
    return out;
  });

  // the ZIP the centroid test misses: centroid outside the circle, most of its (jagged) area inside
  function jagOverlap(i) {
    const st = 0.2; let inC = 0, all = 0;
    const xs = jagged[i].map((p) => p[0]), ys = jagged[i].map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += st)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += st)
        if (pip([x, y], jagged[i])) { all++; if (Math.hypot(x - SEARCH[0], y - SEARCH[1]) <= R) inC++; }
    return { inC: inC * st * st, frac: all ? inC / all : 0 };
  }
  let missed = -1, missedFrac = 0, best = 0;
  sites.forEach((_, i) => {
    if (centroidIn[i] || cls[i] === 'out') return;
    const o = jagOverlap(i);
    if (o.inC > best) { best = o.inC; missed = i; missedFrac = o.frac; }
  });

  // greedy coloring so neighboring cells get different tints
  const tint = new Array(NS).fill(-1);
  byDist.forEach((i) => { const used = new Set(nbrs[i].map((j) => tint[j])); let c = 0; while (used.has(c)) c++; tint[i] = c; });
  const TINTS = [0.10, 0.20, 0.14, 0.25, 0.17, 0.12];

  // Delaunay edges, nearest to the search point first
  const dEdges = [];
  { const { triangles, halfedges } = delaunay;
    for (let e = 0; e < triangles.length; e++) {
      if (e > halfedges[e]) {
        const i = triangles[e], j = triangles[e % 3 === 2 ? e - 2 : e + 1];
        dEdges.push([i, j]);
      }
    }
    const mid = (ed) => dist([(sites[ed[0]][0] + sites[ed[1]][0]) / 2, (sites[ed[0]][1] + sites[ed[1]][1]) / 2], SEARCH);
    dEdges.sort((a, b) => mid(a) - mid(b));
  }
  const nTriangles = delaunay.triangles.length / 3;

  // a neighbor of 76104 whose shared edge crosses the segment between them
  const pair = (() => {
    let best = null;
    for (const j of nbrs[0]) {
      const poly = cells[0];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const eq = (p) => Math.abs(dist(p, sites[0]) - dist(p, sites[j])) < 1e-6;
        if (!eq(a) || !eq(b)) continue;
        const m = [(sites[0][0] + sites[j][0]) / 2, (sites[0][1] + sites[j][1]) / 2];
        const crosses = segDist(m, a, b) < 1e-6;
        const score = dist(a, b) + 3 * dist(sites[0], sites[j]) + (crosses ? 100 : 0);
        if (!best || score > best.score) best = { j, a, b, m, score };
      }
    }
    return best;
  })();

  // breadth-first walk over Voronoi neighbors, expanding only cells that touch the circle
  const depth = new Array(NS).fill(-1), parent = new Array(NS).fill(-1);
  { depth[0] = 0; const q = [0];
    while (q.length) {
      const i = q.shift();
      if (cls[i] === 'out') continue;
      for (const j of nbrs[i]) if (depth[j] < 0) { depth[j] = depth[i] + 1; parent[j] = i; q.push(j); }
    } }
  const maxDepth = Math.max(...depth);
  const nVisited = depth.filter((d) => d >= 0).length;

  // precomputed rings
  const RINGS = [5, 10, 25];
  const ringOf = sites.map((_, i) => { for (let k = 0; k < RINGS.length; k++) if (touches(i, SEARCH, RINGS[k])) return k; return -1; });
  const ringCount = RINGS.map((_, k) => ringOf.filter((r) => r >= 0 && r <= k).length);
  const ringZips = RINGS.map((_, k) => byDist.filter((i) => ringOf[i] >= 0 && ringOf[i] <= k).map((i) => zips[i]));

  const gMax = Math.max(...cells.map((poly, i) => Math.max(...poly.map((v) => dist(v, sites[i])))));
  const storesInBox = stores.filter((p) => Math.abs(p[0] - SEARCH[0]) <= R && Math.abs(p[1] - SEARCH[1]) <= R).length;
  const storesInCircle = stores.filter((p) => dist(p, SEARCH) <= R).length;

  // ---------------------------------------------------------------- canvas, colors, helpers
  const cv = $('cv'), ctx = cv.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, sc = 1, ox = 0, oy = 0, u = 1;
  const X = (x) => ox + x * sc, Y = (y) => oy + y * sc;

  const C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue('--' + n).trim();
    Object.assign(C, {
      surface: g('surface'), raised: g('surface-raised'), sunken: g('surface-sunken'), line: g('line'), lineStrong: g('line-strong'),
      ink: g('ink'), muted: g('ink-muted'), blue: g('bluebonnet'), blueSoft: g('bluebonnet-soft'), paint: g('paintbrush'),
      fire: g('firewheel'), onFire: g('on-firewheel'), wine: g('winecup'), onBlue: g('on-bluebonnet'),
    });
    C.dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
  }
  function rgba(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ramp = (s, a, b) => clamp01((s - a) / (b - a));
  const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const ep = (s, a, b) => easeIO(ramp(s, a, b));
  const pop = (s, a, dur = 0.35) => { const t = ramp(s, a, a + dur); return t <= 0 ? 0 : 1 + 0.25 * Math.sin(t * Math.PI) * (1 - t) + (easeOut(t) - 1); };
  const lerp = (a, b, t) => a + (b - a) * t;

  const FAM = {
    body: '"Public Sans", "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
    display: '"Bricolage Grotesque", "Avenir Next", system-ui, sans-serif',
  };
  function font(size, weight = 400, fam = 'body') { ctx.font = `${weight} ${size * u}px ${FAM[fam]}`; }
  function text(s, x, y, o = {}) {
    font(o.size || 13, o.weight || 400, o.fam || 'body');
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.halo) { ctx.lineWidth = 4 * u; ctx.strokeStyle = o.halo; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillText(s, x, y);
  }
  function polyPath(poly) {
    ctx.beginPath();
    poly.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.closePath();
  }
  function circlePath(c, r) { ctx.beginPath(); ctx.arc(X(c[0]), Y(c[1]), Math.max(0, r * sc), 0, Math.PI * 2); }
  function line(a, b, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1]));
    ctx.strokeStyle = color; ctx.lineWidth = w * u; ctx.setLineDash(dash ? dash.map((d) => d * u) : []); ctx.stroke(); ctx.setLineDash([]);
  }

  // rounded panel with stacked rows; returns its height. rows: {t, size, weight, fam, color, lh, a}
  function panel(x, y, w, rows, alpha, opts = {}) {
    if (alpha <= 0.001) return 0;
    if (cw < 560 && !opts.always) return 0; // phones: captions carry the story, the map stays clear
    const pad = 14 * u;
    const h = pad * 2 + rows.reduce((s, r) => s + (r.lh || (r.size || 13) * 1.55) * u, 0);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = C.dark ? 'rgba(0,0,0,.45)' : 'rgba(27,33,64,.14)';
    ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 4 * u;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8 * u);
    ctx.fillStyle = C.raised; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = opts.border || C.line; ctx.lineWidth = 1 * u; ctx.stroke();
    let yy = y + pad;
    for (const r of rows) {
      const lh = (r.lh || (r.size || 13) * 1.55) * u;
      if (r.t && (r.a === undefined || r.a > 0)) {
        ctx.globalAlpha = alpha * (r.a === undefined ? 1 : r.a);
        text(r.t, x + pad + (r.indent || 0) * u, yy + lh * 0.72, { size: r.size || 13, weight: r.weight || 400, fam: r.fam || 'body', color: r.color || C.ink });
        if (r.right) text(r.right, x + w - pad, yy + lh * 0.72, { size: r.size || 13, weight: r.rweight || 600, fam: r.rfam || r.fam || 'body', color: r.rcolor || r.color || C.ink, align: 'right' });
      }
      yy += lh;
    }
    ctx.restore();
    return h;
  }
  const PW = () => Math.min(330 * u, cw * 0.4);
  const rightX = () => cw - PW() - 16 * u;

  // ---------------------------------------------------------------- layers
  function background(gridA = 1) {
    ctx.fillStyle = C.sunken; ctx.fillRect(0, 0, cw, ch);
    if (gridA <= 0) return;
    ctx.strokeStyle = rgba(C.line, 0.55 * gridA); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) { ctx.moveTo(Math.round(X(x)) + 0.5, Y(0)); ctx.lineTo(Math.round(X(x)) + 0.5, Y(H)); }
    for (let y = 0; y <= H; y += 4) { ctx.moveTo(X(0), Math.round(Y(y)) + 0.5); ctx.lineTo(X(W), Math.round(Y(y)) + 0.5); }
    ctx.stroke();
  }
  // style(i) -> {a, color, r} or null
  function drawStores(style) {
    stores.forEach((p, i) => {
      const s = style(i); if (!s || s.a <= 0.003) return;
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), (s.r || 2.2) * u, 0, Math.PI * 2);
      ctx.fillStyle = rgba(s.color || C.muted, s.a); ctx.fill();
    });
  }
  function siteDot(i, o = {}) {
    const p = sites[i], a = o.a === undefined ? 1 : o.a; if (a <= 0.003) return;
    const k = o.scale === undefined ? 1 : o.scale; if (k <= 0) return;
    ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), (o.r || 3.2) * u * k, 0, Math.PI * 2);
    if (o.fill) { ctx.fillStyle = rgba(o.fill, a); ctx.fill(); ctx.strokeStyle = rgba(C.sunken, a); ctx.lineWidth = 1.5 * u; ctx.stroke(); }
    else { ctx.fillStyle = rgba(C.sunken, a); ctx.fill(); ctx.strokeStyle = rgba(o.stroke || C.ink, a * 0.85); ctx.lineWidth = 1.4 * u; ctx.stroke(); }
  }
  function drawSites(style) { for (let i = 0; i < NS; i++) { const s = style(i); if (s) siteDot(i, s); } }
  function zipLabel(i, a, color) {
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    text(zips[i], X(sites[i][0]), Y(sites[i][1]) - 7 * u, { size: 10.5, fam: 'mono', color: color || C.ink, align: 'center', halo: C.sunken });
    ctx.globalAlpha = 1;
  }
  function pin(p, k = 1, a = 1) {
    if (k <= 0 || a <= 0) return;
    const x = X(p[0]), y = Y(p[1]);
    ctx.beginPath(); ctx.arc(x, y, 11 * u * k, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paint, 0.22 * a); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 5.5 * u * k, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paint, a); ctx.fill();
    ctx.strokeStyle = rgba(C.sunken, a); ctx.lineWidth = 2 * u; ctx.stroke();
  }
  function probePin(p, a = 1) {
    const x = X(p[0]), y = Y(p[1]);
    ctx.save(); ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 3 * u, y - 7 * u, x - 9 * u, y - 11 * u, x - 9 * u, y - 18 * u);
    ctx.arc(x, y - 18 * u, 9 * u, Math.PI, 0);
    ctx.bezierCurveTo(x + 9 * u, y - 11 * u, x + 3 * u, y - 7 * u, x, y);
    ctx.fillStyle = C.fire; ctx.fill(); ctx.strokeStyle = C.sunken; ctx.lineWidth = 1.5 * u; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 18 * u, 3.4 * u, 0, Math.PI * 2); ctx.fillStyle = C.onFire; ctx.fill();
    ctx.restore();
  }
  function searchCircle(r, prog = 1, a = 1, fillA = 0.07) {
    if (a <= 0 || prog <= 0) return;
    const x = X(SEARCH[0]), y = Y(SEARCH[1]);
    if (prog >= 1 && fillA > 0) { circlePath(SEARCH, r); ctx.fillStyle = rgba(C.blue, fillA * a); ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, r * sc, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.strokeStyle = rgba(C.blue, a); ctx.lineWidth = 2.2 * u; ctx.stroke();
  }
  function radiusLabel(r, a) {
    if (a <= 0) return;
    const ang = -Math.PI * 0.18;
    const e = [SEARCH[0] + Math.cos(ang) * r, SEARCH[1] + Math.sin(ang) * r];
    line(SEARCH, e, rgba(C.blue, 0.8 * a), 1.3, [4, 3]);
    ctx.globalAlpha = a;
    text(`${r} mi`, X((SEARCH[0] + e[0]) / 2), Y((SEARCH[1] + e[1]) / 2) - 6 * u, { size: 12, weight: 600, color: C.blue, align: 'center', halo: C.sunken });
    ctx.globalAlpha = 1;
  }
  function cellFill(i, color, a) { if (a <= 0.003) return; polyPath(cells[i]); ctx.fillStyle = rgba(color, a); ctx.fill(); }
  function cellStroke(i, color, a, w = 1, dash) {
    if (a <= 0.003) return;
    polyPath(cells[i]); ctx.strokeStyle = rgba(color, a); ctx.lineWidth = w * u;
    ctx.setLineDash(dash ? dash.map((d) => d * u) : []); ctx.stroke(); ctx.setLineDash([]);
  }
  function voronoiEdges(a, color) {
    if (a <= 0.003) return;
    ctx.beginPath(); vor.render({
      moveTo: (x, y) => ctx.moveTo(X(x), Y(y)), lineTo: (x, y) => ctx.lineTo(X(x), Y(y)), closePath: () => ctx.closePath(),
    });
    ctx.strokeStyle = rgba(color || C.blue, a); ctx.lineWidth = 1.1 * u; ctx.stroke();
  }
  function tintAll(k) { if (k > 0) for (let i = 0; i < NS; i++) cellFill(i, C.blue, TINTS[tint[i] % TINTS.length] * k); }
  function jaggedEdges(a, skip) {
    if (a <= 0.003) return;
    ctx.strokeStyle = rgba(C.muted, a); ctx.lineWidth = 1 * u; ctx.lineJoin = 'round';
    for (let i = 0; i < NS; i++) { if (i === skip) continue; polyPath(jagged[i]); ctx.stroke(); }
  }
  // part of a polygon inside the search circle
  function clipCircle(fn, r = R) { ctx.save(); circlePath(SEARCH, r); ctx.clip(); fn(); ctx.restore(); }

  // ---------------------------------------------------------------- scenes
  // each: (s = seconds into scene, d = scene length, L = sentence starts, E = sentence ends), all scene-relative
  const S = {};

  function searchUI(a, typed, pressed) {
    if (a <= 0) return;
    const x = 16 * u, y = 16 * u, w = 300 * u, h = 78 * u;
    ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = C.dark ? 'rgba(0,0,0,.45)' : 'rgba(27,33,64,.14)'; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 4 * u;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8 * u); ctx.fillStyle = C.raised; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = C.line; ctx.lineWidth = u; ctx.stroke();
    text('Find a store', x + 14 * u, y + 22 * u, { size: 12, weight: 600, color: C.muted });
    // field
    const fx = x + 14 * u, fy = y + 32 * u, fw = 104 * u, fh = 32 * u;
    ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 6 * u); ctx.fillStyle = C.sunken; ctx.fill();
    ctx.strokeStyle = typed.length ? C.blue : C.lineStrong; ctx.lineWidth = 1.2 * u; ctx.stroke();
    text(typed || 'ZIP code', fx + 10 * u, fy + 21 * u, { size: 15, fam: typed ? 'mono' : 'body', color: typed ? C.ink : C.muted });
    // radius chip
    const rx = fx + fw + 8 * u;
    ctx.beginPath(); ctx.roundRect(rx, fy, 74 * u, fh, 6 * u); ctx.fillStyle = C.sunken; ctx.fill(); ctx.strokeStyle = C.lineStrong; ctx.stroke();
    text('10 mi ▾', rx + 37 * u, fy + 21 * u, { size: 14, color: C.ink, align: 'center' });
    // button
    const bx = rx + 82 * u, bw = w - (bx - x) - 14 * u;
    ctx.beginPath(); ctx.roundRect(bx, fy, bw, fh, 6 * u);
    ctx.fillStyle = pressed ? C.blueSoft : C.blue; ctx.fill();
    text('Search', bx + bw / 2, fy + 21 * u, { size: 14, weight: 600, color: pressed ? C.blue : C.onBlue, align: 'center' });
    ctx.restore();
  }

  S.intro = (s, d, L) => {
    background(ep(s, 0, 1));
    drawStores((i) => { const k = pop(s, 0.3 + storeRank[i] * 2.4); return k > 0 ? { a: 0.9, r: 2.2 * k } : null; });
    const typeStart = L[0] + 0.9;
    const n = Math.max(0, Math.min(5, Math.floor((s - typeStart) / 0.16)));
    const pressed = s > L[1] + 0.6 && s < L[1] + 0.95;
    searchUI(ep(s, 0.4, 1.0), '76104'.slice(0, n), pressed);
    if (s > L[1] + 0.6) pin(SEARCH, pop(s, L[1] + 0.8), 1);
  };

  S.centroid = (s, d, L, E) => {
    background();
    const storeA = lerp(0.9, 0.3, ep(s, 0, 1));
    drawStores(() => ({ a: storeA }));
    searchUI(1 - ep(s, 0, 0.6), '76104', false);
    // ZIP outlines
    const outlinesA = 0.45 * ep(s, 0.3, 1.8) * (1 - 0.6 * ep(s, L[2] + 1.5, L[2] + 2.5));
    jaggedEdges(outlinesA, 0);
    const shapeA = ep(s, 0.2, 1.2) * (1 - 0.6 * ep(s, L[1] + 1, L[1] + 2.2));
    polyPath(jagged[0]); ctx.fillStyle = rgba(C.blue, 0.2 * shapeA); ctx.fill();
    ctx.strokeStyle = rgba(C.blue, shapeA); ctx.lineWidth = 2 * u; ctx.stroke();
    const top = jagged[0].reduce((m, p) => (p[1] < m[1] ? p : m));
    ctx.globalAlpha = shapeA;
    text('ZIP 76104', X(top[0]), Y(top[1]) - 8 * u, { size: 13, weight: 600, color: C.blue, align: 'center', halo: C.sunken });
    ctx.globalAlpha = 1;
    // other centroids, as rows of the lookup table arrive
    drawSites((i) => (i === 0 ? null : { scale: pop(s, L[2] + 0.4 + (siteD[i] / 40) * 1.6), a: 0.8 }));
    // the centroid itself
    if (s > L[1] + 0.3) {
      const k = pop(s, L[1] + 0.3);
      if (s < L[1] + 0.6) { ctx.globalAlpha = 1 - ramp(s, L[1] + 0.3, L[1] + 0.6); pin(SEARCH, 2.2 - k, 0.5); ctx.globalAlpha = 1; }
      pin(SEARCH, k, 1);
    } else pin(SEARCH, 1, 1 - ep(s, 0, 0.5));
    const coordA = ep(s, L[1] + 1.4, L[1] + 2);
    ctx.globalAlpha = coordA;
    text(`${fmtLat(latOf(SEARCH[1]))}, ${fmtLon(lonOf(SEARCH[0]))}`, X(SEARCH[0]) + 14 * u, Y(SEARCH[1]) + 18 * u, { size: 12, fam: 'mono', color: C.ink, halo: C.sunken });
    ctx.globalAlpha = 1;
    // lookup table
    const show = [0, ...byDist.slice(1, 6)].sort((a, b) => zips[a].localeCompare(zips[b]));
    const rows = [{ t: 'zip_centroids', size: 11, weight: 600, fam: 'mono', color: C.muted, lh: 20 },
      { t: 'zip      lat       lon', size: 12, fam: 'mono', color: C.muted, lh: 22 }];
    show.forEach((i, k) => rows.push({
      t: `${zips[i]}  ${fmtLat(latOf(sites[i][1]))}  ${fmtLon(lonOf(sites[i][0]))}`, size: 12, fam: 'mono', lh: 21,
      color: i === 0 ? C.blue : C.ink, a: ep(s, L[2] + 0.2 + k * 0.12, L[2] + 0.5 + k * 0.12),
    }));
    rows.push({ t: '… about 40,000 rows', size: 12, fam: 'mono', color: C.muted, lh: 22, a: ep(s, L[2] + 1.2, L[2] + 1.6) });
    panel(rightX(), 16 * u, PW(), rows, ep(s, L[2], L[2] + 0.4));
  };

  S.naive = (s, d, L, E) => {
    background();
    drawSites(() => ({ a: 0.25 }));
    const sweepEnd = L[1] - 0.4, fade = 1 - 0.6 * ep(s, E[1] - 0.5, d);
    let count = 0;
    stores.forEach((p, i) => {
      const ang = (Math.atan2(p[1] - SEARCH[1], p[0] - SEARCH[0]) + Math.PI) / (Math.PI * 2);
      const t0 = 0.5 + ang * (sweepEnd - 0.5);
      if (s < t0) return;
      count++;
      line(SEARCH, p, rgba(C.muted, 0.32 * ep(s, t0, t0 + 0.2) * fade), 0.9);
    });
    drawStores((i) => {
      const p = stores[i];
      const ang = (Math.atan2(p[1] - SEARCH[1], p[0] - SEARCH[0]) + Math.PI) / (Math.PI * 2);
      const t0 = 0.5 + ang * (sweepEnd - 0.5);
      const flash = s > t0 ? 1 - ramp(s, t0 + 0.1, t0 + 0.6) : 0;
      return flash > 0 ? { a: 1, color: C.blue, r: 2.2 + flash * 1.6 } : { a: 0.9 };
    });
    pin(SEARCH);
    const x = rightX();
    const h = panel(x, 16 * u, PW(), [
      { t: 'Distance checks', size: 12, weight: 600, color: C.muted, lh: 20 },
      { t: String(count), size: 34, weight: 700, fam: 'display', lh: 44 },
      { t: `one per store, ${stores.length} stores`, size: 12, color: C.muted, lh: 20 },
      { t: 'and again for every search', size: 13, weight: 600, color: C.paint, lh: 22, a: ep(s, L[1] + 0.8, L[1] + 1.3) },
    ], ep(s, 0.3, 0.7));
    panel(x, 16 * u + h + 10 * u, PW(), [
      { t: 'Haversine', size: 12, weight: 600, color: C.muted, lh: 20 },
      { t: 'a = sin²(Δφ/2) + cos φ₁·cos φ₂·sin²(Δλ/2)', size: 11, fam: 'mono', lh: 20 },
      { t: 'd = 2r · atan2(√a, √(1−a))', size: 11, fam: 'mono', lh: 20 },
    ], ep(s, L[0] + 2.6, L[0] + 3.1));
  };

  function boxRect(half) {
    ctx.beginPath(); ctx.rect(X(SEARCH[0] - half), Y(SEARCH[1] - half), half * 2 * sc, half * 2 * sc);
  }
  const minLat = latOf(SEARCH[1] + R), maxLat = latOf(SEARCH[1] - R), minLon = lonOf(SEARCH[0] - R), maxLon = lonOf(SEARCH[0] + R);
  const inBox = (p) => Math.abs(p[0] - SEARCH[0]) <= R && Math.abs(p[1] - SEARCH[1]) <= R;

  S.bbox = (s, d, L, E) => {
    background();
    drawSites(() => ({ a: 0.25 }));
    const half = ep(s, 0.3, 1.8) * R;
    if (half > 0) { boxRect(half); ctx.fillStyle = rgba(C.ink, 0.04); ctx.fill(); ctx.strokeStyle = rgba(C.ink, 0.75); ctx.lineWidth = 1.5 * u; ctx.stroke(); }
    const labA = ep(s, L[0] + 2.4, L[0] + 3);
    if (labA > 0) {
      ctx.globalAlpha = labA;
      const o = { size: 11, fam: 'mono', color: C.ink, halo: C.sunken, align: 'center' };
      text(`max lat ${maxLat.toFixed(3)}`, X(SEARCH[0]), Y(SEARCH[1] - R) - 7 * u, o);
      text(`min lat ${minLat.toFixed(3)}`, X(SEARCH[0]), Y(SEARCH[1] + R) + 16 * u, o);
      ctx.save(); ctx.translate(X(SEARCH[0] - R) - 8 * u, Y(SEARCH[1])); ctx.rotate(-Math.PI / 2); text(`min lon ${fmtLon(minLon).slice(0, 7)}`, 0, 0, o); ctx.restore();
      ctx.save(); ctx.translate(X(SEARCH[0] + R) + 8 * u, Y(SEARCH[1])); ctx.rotate(Math.PI / 2); text(`max lon ${fmtLon(maxLon).slice(0, 7)}`, 0, 0, o); ctx.restore();
      ctx.globalAlpha = 1;
    }
    const outFade = ep(s, L[1] + 0.3, L[1] + 1.3);
    const circP = ep(s, L[2], L[2] + 1.2);
    const lineT = L[2] + 0.2;
    const cornerT = L[2] + (E[2] - L[2]) * 0.55;
    // exact checks inside the box
    stores.forEach((p) => {
      if (!inBox(p)) return;
      const t0 = lineT + storeRank[stores.indexOf(p)] * 1.0;
      const a = ep(s, t0, t0 + 0.15) * (1 - ep(s, cornerT + 0.6, cornerT + 1.6));
      if (a > 0) line(SEARCH, p, rgba(C.muted, 0.35 * a), 0.9);
    });
    searchCircle(R, circP, 1, 0.05);
    drawStores((i) => {
      const p = stores[i];
      if (!inBox(p)) return { a: lerp(0.9, 0.12, outFade) };
      const din = dist(p, SEARCH) <= R;
      if (din) { const k = ep(s, cornerT + 0.2, cornerT + 0.7); return { a: 0.9, color: k > 0.5 ? C.blue : C.muted, r: 2.2 + k * 0.8 }; }
      return { a: lerp(0.9, 0.15, ep(s, cornerT + 0.8, cornerT + 1.6)), color: s > cornerT ? C.paint : C.muted };
    });
    // X marks on dropped corners
    const xa = ep(s, cornerT, cornerT + 0.3) * (1 - ep(s, cornerT + 1.2, cornerT + 2));
    if (xa > 0) stores.forEach((p) => {
      if (!inBox(p) || dist(p, SEARCH) <= R) return;
      const x = X(p[0]), y = Y(p[1]), k = 4 * u;
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
      ctx.strokeStyle = rgba(C.paint, xa); ctx.lineWidth = 1.6 * u; ctx.stroke();
    });
    pin(SEARCH);
    panel(rightX(), 16 * u, PW(), [
      { t: 'Index range scan', size: 12, weight: 600, color: C.muted, lh: 20 },
      { t: `WHERE lat BETWEEN ${minLat.toFixed(3)}`, size: 11.5, fam: 'mono', lh: 19 },
      { t: `            AND ${maxLat.toFixed(3)}`, size: 11.5, fam: 'mono', lh: 19 },
      { t: `  AND lon BETWEEN ${fmtLon(minLon).slice(0, 7)}`, size: 11.5, fam: 'mono', lh: 19 },
      { t: `            AND ${fmtLon(maxLon).slice(0, 7)}`, size: 11.5, fam: 'mono', lh: 19 },
      { t: '', lh: 8 },
      { t: 'In the box', size: 13, right: `${storesInBox} of ${stores.length}`, lh: 22, a: ep(s, L[1] + 1.2, L[1] + 1.6) },
      { t: 'Within 10 mi (haversine)', size: 13, right: String(storesInCircle), rcolor: C.blue, lh: 22, a: ep(s, cornerT + 0.4, cornerT + 0.8) },
    ], ep(s, L[1], L[1] + 0.4));
  };

  S.ziplist = (s, d, L, E) => {
    background();
    const boxA = 1 - ep(s, 0, 0.8);
    if (boxA > 0) { boxRect(R); ctx.strokeStyle = rgba(C.ink, 0.75 * boxA); ctx.lineWidth = 1.5 * u; ctx.stroke(); }
    drawStores((i) => ({ a: lerp(0.9, 0.12, ep(s, 0, 1)), color: dist(stores[i], SEARCH) <= R ? C.blue : C.muted }));
    searchCircle(R, 1, 1, 0.05);
    const t1 = L[1] + 0.2;
    drawSites((i) => {
      if (centroidIn[i]) { const k = ep(s, t1 + (siteD[i] / R) * 1.4, t1 + (siteD[i] / R) * 1.4 + 0.3); return k > 0 ? { fill: C.blue, r: 3.2 + k, a: 1 } : { a: lerp(0.25, 0.85, ep(s, 0.3, 1.2)) }; }
      return { a: lerp(0.25, 0.85, ep(s, 0.3, 1.2)) };
    });
    sites.forEach((_, i) => { if (centroidIn[i] && i) zipLabel(i, ep(s, t1 + (siteD[i] / R) * 1.4 + 0.2, t1 + (siteD[i] / R) * 1.4 + 0.5)); });
    pin(SEARCH);
    radiusLabel(R, ep(s, 0.5, 1.2) * (1 - ep(s, L[1], L[1] + 0.5)));
    sqlPanel(s, L[2]);
  };
  function sqlPanel(s, t0, a = 1) {
    const list = byDist.filter((i) => centroidIn[i]).map((i) => `'${zips[i]}'`);
    const per = 4, rows = [];
    rows.push({ t: 'SELECT * FROM stores', size: 11.5, fam: 'mono', lh: 19 });
    rows.push({ t: 'WHERE zip IN (', size: 11.5, fam: 'mono', lh: 19 });
    const nRows = Math.min(4, Math.ceil(list.length / per));
    for (let r = 0; r < nRows; r++) {
      let chunk = list.slice(r * per, r * per + per).join(', ');
      if (r === nRows - 1 && list.length > nRows * per) chunk += ', …';
      else if (r < nRows - 1) chunk += ',';
      rows.push({ t: chunk, indent: 14, size: 11.5, fam: 'mono', color: C.blue, lh: 19, a: ep(s, t0 + 0.3 + r * 0.25, t0 + 0.6 + r * 0.25) });
    }
    rows.push({ t: ')', size: 11.5, fam: 'mono', lh: 19 });
    rows.push({ t: '', lh: 6 });
    rows.push({ t: 'ZIP centroids inside the circle', size: 13, right: String(nCentroidIn), rcolor: C.blue, lh: 22 });
    panel(rightX(), 16 * u, PW(), rows, ep(s, t0, t0 + 0.4) * a);
  }

  S.edges = (s, d, L, E) => {
    background();
    drawStores((i) => ({ a: 0.12, color: dist(stores[i], SEARCH) <= R ? C.blue : C.muted }));
    jaggedEdges(0.4 * ep(s, 0.2, 1.4) * (1 - 0.7 * ep(s, L[2], L[2] + 1.2)), missed);
    searchCircle(R, 1, 1, 0.05);
    const m = missed, ma = ep(s, L[1] + 0.2, L[1] + 1);
    if (m >= 0 && ma > 0) {
      polyPath(jagged[m]); ctx.fillStyle = rgba(C.wine, 0.16 * ma); ctx.fill();
      clipCircle(() => { polyPath(jagged[m]); ctx.fillStyle = rgba(C.wine, 0.42 * ma); ctx.fill(); });
      polyPath(jagged[m]); ctx.strokeStyle = rgba(C.wine, ma); ctx.lineWidth = 2 * u; ctx.stroke();
      const da = ep(s, L[1] + 1.2, L[1] + 1.8);
      line(SEARCH, sites[m], rgba(C.wine, da), 1.4, [5, 4]);
      ctx.globalAlpha = da;
      const mid = [(SEARCH[0] + sites[m][0]) / 2, (SEARCH[1] + sites[m][1]) / 2];
      text(`${siteD[m].toFixed(1)} mi`, X(mid[0]), Y(mid[1]) - 7 * u, { size: 12, weight: 600, fam: 'mono', color: C.wine, align: 'center', halo: C.sunken });
      ctx.globalAlpha = 1;
    }
    drawSites((i) => (centroidIn[i] ? { fill: C.blue, r: 4.2 } : i === m ? { fill: C.wine, r: 4.2, a: Math.max(0.85, ma) } : { a: 0.85 }));
    sites.forEach((_, i) => { if (centroidIn[i] && i) zipLabel(i, 1 - 0.6 * ep(s, L[1], L[1] + 0.6)); });
    if (m >= 0) zipLabel(m, ma, C.wine);
    pin(SEARCH);
    sqlPanel(s, -10, 1 - ep(s, L[1], L[1] + 0.5));
    if (m >= 0) panel(rightX(), 16 * u, PW(), [
      { t: `ZIP ${zips[m]} is left out`, size: 15, weight: 600, fam: 'display', color: C.wine, lh: 24 },
      { t: `Centroid ${siteD[m].toFixed(1)} mi away, outside 10 mi`, size: 13, lh: 21 },
      { t: `About ${Math.round(missedFrac * 100)}% of its area is inside the circle`, size: 13, lh: 21, a: ep(s, L[1] + 2.2, L[1] + 2.7) },
    ], ep(s, L[1] + 0.6, L[1] + 1.1), { border: rgba(C.wine, 0.6) });
  };

  // a roomy interior cell left of the panels, for the "closest centroid" demo
  const probeCell = sites.map((p, i) => i)
    .filter((i) => sites[i][0] > 8 && sites[i][0] < 24 && sites[i][1] > 8 && sites[i][1] < 30)
    .sort((a, b) => polyArea(cells[b]) - polyArea(cells[a]))[0] || 0;
  S.voronoi = (s, d, L, E) => {
    background();
    const outA = 1 - ep(s, 0, 0.8);
    if (outA > 0) {
      drawStores(() => ({ a: 0.12 * outA }));
      searchCircle(R, 1, outA, 0.05);
      if (missed >= 0) { polyPath(jagged[missed]); ctx.strokeStyle = rgba(C.wine, outA); ctx.lineWidth = 2 * u; ctx.stroke(); }
    }
    const growDur = Math.max(3, E[1] - L[1] + 1.2);
    const g = ep(s, L[1], L[1] + growDur) * gMax;
    if (g > 0) {
      for (let i = 0; i < NS; i++) {
        ctx.save(); polyPath(cells[i]); ctx.clip();
        circlePath(sites[i], g); ctx.fillStyle = rgba(C.blue, TINTS[tint[i] % TINTS.length]); ctx.fill();
        if (g < gMax * 0.98) { ctx.strokeStyle = rgba(C.blue, 0.75); ctx.lineWidth = 1.4 * u; ctx.stroke(); }
        ctx.restore();
      }
    }
    voronoiEdges(0.9 * ep(s, L[1] + growDur * 0.75, L[1] + growDur + 0.4));
    drawSites((i) => ({ a: 1, fill: i === 0 ? C.blue : null, r: i === 0 ? 4.2 : 3.2 }));
    // a sample spot and its distances to the nearest few centroids
    const pa = ep(s, L[2] + 0.4, L[2] + 0.9);
    if (pa > 0) {
      const tt = ramp(s, L[2] + 0.4, d);
      const cc = cells[probeCell];
      const base = cc.reduce((acc, v) => [acc[0] + v[0] / cc.length, acc[1] + v[1] / cc.length], [0, 0]);
      const p = [lerp(base[0], sites[probeCell][0], 0.2) + Math.cos(tt * 5) * 1.0, lerp(base[1], sites[probeCell][1], 0.2) + Math.sin(tt * 4) * 0.8];
      const near = sites.map((q, i) => [dist(q, p), i]).sort((a, b) => a[0] - b[0]).slice(0, 4);
      cellFill(near[0][1], C.blue, 0.3 * pa);
      near.forEach(([dd, i], k) => {
        line(p, sites[i], rgba(k === 0 ? C.blue : C.muted, pa * (k === 0 ? 1 : 0.7)), k === 0 ? 2 : 1, k === 0 ? null : [4, 3]);
        const mid = [(p[0] + sites[i][0]) / 2, (p[1] + sites[i][1]) / 2];
        ctx.globalAlpha = pa;
        text(`${dd.toFixed(1)}`, X(mid[0]), Y(mid[1]) - 4 * u, { size: 11, fam: 'mono', weight: k === 0 ? 600 : 400, color: k === 0 ? C.blue : C.muted, align: 'center', halo: C.sunken });
        ctx.globalAlpha = 1;
      });
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4 * u, 0, Math.PI * 2); ctx.fillStyle = rgba(C.fire, pa); ctx.fill();
      ctx.strokeStyle = rgba(C.sunken, pa); ctx.lineWidth = 1.5 * u; ctx.stroke();
    }
    panel(rightX(), 16 * u, PW(), [
      { t: 'Voronoi cell', size: 15, weight: 600, fam: 'display', lh: 24 },
      { t: 'Every spot closer to this centroid', size: 13, lh: 21 },
      { t: 'than to any other one', size: 13, lh: 21 },
    ], ep(s, L[2] + 0.2, L[2] + 0.6));
  };

  S.delaunay = (s, d, L, E) => {
    background();
    const dim = 1 - 0.55 * ep(s, L[1], L[1] + 0.8);
    tintAll(dim);
    voronoiEdges(0.9 * dim);
    if (pair) {
      const a0 = sites[0], aj = sites[pair.j];
      const sA = ep(s, 0.3, 1.0) * (1 - 0.6 * ep(s, L[1] + 0.5, L[1] + 1.5));
      cellFill(0, C.blue, 0.25 * sA); cellFill(pair.j, C.blue, 0.25 * sA);
      // the shared edge
      const eA = ep(s, 1.0, 1.6) * (1 - 0.5 * ep(s, L[1] + 0.5, L[1] + 1.5));
      line(pair.a, pair.b, rgba(C.fire, eA), 3.2);
      // the segment between centroids
      const segP = ep(s, 0.3, 1.0);
      line(a0, [lerp(a0[0], aj[0], segP), lerp(a0[1], aj[1], segP)], rgba(C.ink, sA), 1.4, [5, 4]);
      // tick marks for equal halves and a right-angle marker
      const tA = ep(s, 1.8, 2.3) * (1 - 0.6 * ep(s, L[1] + 0.5, L[1] + 1.5));
      if (tA > 0) {
        const dx = aj[0] - a0[0], dy = aj[1] - a0[1], len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, k = 0.45;
        [0.25, 0.75].forEach((f) => {
          const c = [a0[0] + dx * f, a0[1] + dy * f];
          line([c[0] - nx * k, c[1] - ny * k], [c[0] + nx * k, c[1] + ny * k], rgba(C.ink, tA), 1.6);
        });
        const m = pair.m, q = 0.55;
        ctx.beginPath();
        ctx.moveTo(X(m[0] + ux * q), Y(m[1] + uy * q));
        ctx.lineTo(X(m[0] + ux * q + nx * q), Y(m[1] + uy * q + ny * q));
        ctx.lineTo(X(m[0] + nx * q), Y(m[1] + ny * q));
        ctx.strokeStyle = rgba(C.fire, tA); ctx.lineWidth = 1.5 * u; ctx.stroke();
      }
    }
    // Delaunay triangulation
    const t0 = L[1] + 0.4, span = Math.max(2, (E[1] - L[1]) * 0.6);
    dEdges.forEach(([i, j], k) => {
      const ts = t0 + (k / dEdges.length) * span;
      const p = ep(s, ts, ts + 0.35);
      if (p <= 0) return;
      const a = sites[i], b = sites[j];
      line(a, [lerp(a[0], b[0], p), lerp(a[1], b[1], p)], rgba(C.ink, 0.6), 1.1);
    });
    drawSites((i) => ({ a: 1, fill: i === 0 || (pair && i === pair.j) ? C.blue : null, r: i === 0 || (pair && i === pair.j) ? 4.2 : 3.2 }));
    const x = rightX();
    panel(x, 16 * u, PW(), [
      { t: 'Halfway, at a right angle', size: 15, weight: 600, fam: 'display', lh: 24 },
      { t: 'Each edge is the perpendicular bisector', size: 13, lh: 21 },
      { t: 'of the line between two neighbors', size: 13, lh: 21 },
    ], ep(s, 1.4, 1.9) * (1 - ep(s, L[1], L[1] + 0.4)));
    panel(x, 16 * u, PW(), [
      { t: 'Delaunay triangulation', size: 15, weight: 600, fam: 'display', lh: 24 },
      { t: 'Neighbors joined', size: 13, right: `${dEdges.length} edges`, lh: 21 },
      { t: 'Triangles', size: 13, right: String(nTriangles), lh: 21 },
    ], ep(s, L[1] + 0.5, L[1] + 0.9));
  };

  const probePath = [[11, 9], [44, 28], [52, 12], [18, 29], [36, 8]];
  function probeAt(t) {
    // hold 0.7 s at each waypoint, travel 1.5 s between
    const hold = 0.7, move = 1.5, seg = hold + move;
    const k = Math.floor(t / seg), f = t - k * seg;
    const a = probePath[Math.min(k, probePath.length - 1)], b = probePath[Math.min(k + 1, probePath.length - 1)];
    const e = f < move ? easeIO(f / move) : 1;
    return k >= probePath.length - 1 ? a : [lerp(a[0], b[0], e), lerp(a[1], b[1], e)];
  }
  S.reverse = (s, d, L, E) => {
    background();
    const dim = 0.45 + 0.55 * (1 - ep(s, 0, 0.8));
    tintAll(dim);
    voronoiEdges(0.9);
    const lA = 1 - ep(s, 0, 0.8);
    dEdges.forEach(([i, j]) => line(sites[i], sites[j], rgba(C.ink, 0.6 * 0.45 * lA), 1.1));
    const start = L[1] - 0.2;
    const pa = ep(s, start, start + 0.4);
    let p = null, c = -1;
    if (pa > 0) {
      p = probeAt(Math.max(0, s - start - 0.4));
      c = delaunay.find(p[0], p[1]);
      cellFill(c, C.blue, 0.42 * pa);
      cellStroke(c, C.blue, pa, 2.2);
      line(p, sites[c], rgba(C.blue, pa), 1.5, [4, 3]);
    }
    drawSites((i) => ({ a: 1, fill: i === c ? C.blue : null, r: i === c ? 4.2 : 3.2 }));
    if (p) {
      probePin(p, pa);
      // label follows the pin
      const lx = X(p[0]) + 14 * u, ly = Y(p[1]) - 52 * u;
      const w = 150 * u;
      panel(Math.min(lx, cw - w - 8 * u), Math.max(8 * u, ly), w, [
        { t: 'Nearest centroid', size: 11, weight: 600, color: C.muted, lh: 17 },
        { t: `ZIP ${zips[c]}`, size: 16, weight: 600, fam: 'mono', color: C.blue, lh: 24 },
      ], pa, { always: true });
    }
  };

  function classifyFills(s, inT, outT, edgeT, k = 1) {
    for (let i = 0; i < NS; i++) {
      const c = cls[i];
      if (c === 'in') { cellFill(i, C.blue, lerp(TINTS[tint[i] % TINTS.length] * 0.45, 0.5, ep(s, inT, inT + 0.6)) * k); }
      else if (c === 'out') { cellFill(i, C.blue, TINTS[tint[i] % TINTS.length] * 0.45 * (1 - ep(s, outT, outT + 0.6)) * k); }
      else {
        const e = ep(s, edgeT, edgeT + 0.6);
        cellFill(i, C.blue, TINTS[tint[i] % TINTS.length] * 0.45 * (1 - e) * k);
        cellFill(i, C.fire, 0.16 * e * k);
        if (e > 0) clipCircle(() => cellFill(i, C.fire, 0.34 * e * k));
      }
    }
  }
  S.classify = (s, d, L, E) => {
    background();
    const outT = L[1] + (E[1] - L[1]) * 0.55, edgeT = L[2] + 0.2, missT = L[2] + (E[2] - L[2]) * 0.45;
    classifyFills(s, L[1] + 0.2, outT, edgeT);
    // edges: dim on out cells
    for (let i = 0; i < NS; i++) cellStroke(i, C.blue, cls[i] === 'out' ? lerp(0.9, 0.3, ep(s, outT, outT + 0.6)) : 0.9, 1.1);
    searchCircle(R, ep(s, 0.2, 1.4), 1, 0);
    // the cells the centroid test misses
    const ma = ep(s, missT, missT + 0.5);
    for (let i = 0; i < NS; i++) if (cls[i] === 'edge' && !centroidIn[i]) cellStroke(i, C.wine, ma, 2.4);
    drawSites((i) => {
      if (cls[i] === 'out') return { a: lerp(1, 0.35, ep(s, outT, outT + 0.6)) };
      if (cls[i] === 'edge' && !centroidIn[i]) return { a: 1, fill: ma > 0.5 ? C.wine : null, r: 3.2 + ma };
      return { a: 1, fill: centroidIn[i] ? C.blue : null, r: centroidIn[i] ? 3.8 : 3.2 };
    });
    for (let i = 0; i < NS; i++) if (cls[i] === 'edge' && !centroidIn[i]) zipLabel(i, ma, C.wine);
    pin(SEARCH);
    const x = rightX();
    const h = panel(x, 16 * u, PW(), [
      { t: 'Cells vs. the circle', size: 12, weight: 600, color: C.muted, lh: 20 },
      { t: 'Entirely inside', size: 13, right: String(nIn), rcolor: C.blue, lh: 22, a: ep(s, L[1] + 0.2, L[1] + 0.6) },
      { t: 'Never touch it', size: 13, right: String(NS - nTouch), rcolor: C.muted, lh: 22, a: ep(s, outT, outT + 0.4) },
      { t: 'Straddle the edge', size: 13, right: String(nEdge), rcolor: C.fire, lh: 22, a: ep(s, edgeT, edgeT + 0.4) },
    ], ep(s, L[1], L[1] + 0.4));
    panel(x, 16 * u + h + 10 * u, PW(), [
      { t: 'Centroid inside circle', size: 13, right: `${nCentroidIn} ZIPs`, lh: 22 },
      { t: 'Cell touches circle', size: 13, right: `${nTouch} ZIPs`, rcolor: C.blue, lh: 22 },
      { t: `+${nTouch - nCentroidIn} found that the centroid test missed`, size: 13, weight: 600, color: C.wine, lh: 22, a: ep(s, missT + 0.3, missT + 0.8) },
    ], ep(s, missT, missT + 0.4));
  };

  S.walk = (s, d, L, E) => {
    background();
    const t0 = L[1] + 0.3, step = Math.min(0.8, Math.max(0.35, (E[1] - L[1] - 0.6) / Math.max(1, maxDepth)));
    const vis = (i) => (depth[i] < 0 ? -1 : t0 + depth[i] * step);
    let checked = 0;
    for (let i = 0; i < NS; i++) {
      const tv = vis(i);
      const base = TINTS[tint[i] % TINTS.length] * 0.35 * (1 - ep(s, 0, 0.6));
      if (tv < 0 || s < tv) { cellFill(i, C.blue, base); cellStroke(i, C.blue, lerp(0.9, 0.35, ep(s, 0, 0.6)), 1); continue; }
      checked++;
      const k = ep(s, tv, tv + 0.35), flash = 1 - ramp(s, tv, tv + 0.6);
      if (cls[i] !== 'out') { cellFill(i, C.blue, 0.42 * k + 0.25 * flash); cellStroke(i, C.blue, 0.9, 1.2); }
      else { cellFill(i, C.muted, 0.08 * k + 0.12 * flash); cellStroke(i, C.paint, 0.85 * k, 1.4, [4, 3]); }
    }
    // BFS tree links
    for (let i = 0; i < NS; i++) {
      if (parent[i] < 0) continue;
      const tv = vis(i), p = ep(s, tv - step * 0.6, tv);
      if (p <= 0) continue;
      const a = sites[parent[i]], b = sites[i];
      line(a, [lerp(a[0], b[0], p), lerp(a[1], b[1], p)], rgba(C.ink, 0.55), 1.1);
    }
    searchCircle(R, 1, 1, 0);
    // unvisited cells fade further once the walk is done
    const doneA = ep(s, L[2], L[2] + 0.8);
    if (doneA > 0) for (let i = 0; i < NS; i++) if (depth[i] < 0) cellFill(i, C.sunken, 0.55 * doneA);
    drawSites((i) => {
      const tv = vis(i);
      if (tv < 0 || s < tv) return { a: lerp(1, 0.45, doneA) };
      return cls[i] !== 'out' ? { a: 1, fill: C.blue, r: 3.8 } : { a: 1 };
    });
    pin(SEARCH);
    panel(rightX(), 16 * u, PW(), [
      { t: 'Neighbor walk', size: 12, weight: 600, color: C.muted, lh: 20 },
      { t: 'Cells checked', size: 13, right: `${checked} of ${NS}`, lh: 22 },
      { t: 'Touch the circle (kept)', size: 13, right: String(nTouch), rcolor: C.blue, lh: 22, a: ep(s, t0 + step, t0 + step + 0.4) },
      { t: 'Don\'t touch (stop here)', size: 13, right: String(nVisited - nTouch), rcolor: C.paint, lh: 22, a: ep(s, t0 + step, t0 + step + 0.4) },
      { t: 'Never looked at', size: 13, right: String(NS - nVisited), rcolor: C.muted, lh: 22, a: doneA },
    ], ep(s, L[1], L[1] + 0.4));
  };

  S.precompute = (s, d, L, E) => {
    background();
    const span = E[1] - L[1];
    const cue = [L[1] + span * 0.5, L[1] + span * 0.66, L[1] + span * 0.8];
    for (let i = 0; i < NS; i++) {
      const r = ringOf[i];
      let a = TINTS[tint[i] % TINTS.length] * 0.35;
      if (r >= 0) a = lerp(a, [0.55, 0.32, 0.16][r], ep(s, cue[r], cue[r] + 0.6));
      cellFill(i, C.blue, a);
    }
    voronoiEdges(0.5);
    RINGS.forEach((r, k) => { searchCircle(r, ep(s, cue[k] - 0.3, cue[k] + 0.6), k === 1 ? 1 : 0.75, 0); });
    RINGS.forEach((r, k) => {
      const a = ep(s, cue[k] + 0.3, cue[k] + 0.7); if (a <= 0) return;
      const ang = -Math.PI / 2 - 0.35;
      ctx.globalAlpha = a;
      text(`${r} mi`, X(SEARCH[0] + Math.cos(ang) * r), Y(SEARCH[1] + Math.sin(ang) * r) - 5 * u, { size: 11, weight: 600, color: C.blue, align: 'center', halo: C.sunken });
      ctx.globalAlpha = 1;
    });
    const storeA = ep(s, L[2] + 1, L[2] + 1.6);
    if (storeA > 0) drawStores((i) => (ringOf[delaunay.find(stores[i][0], stores[i][1])] >= 0 && ringOf[delaunay.find(stores[i][0], stores[i][1])] <= 1
      ? { a: storeA, color: C.ink, r: 2.4 } : null));
    drawSites((i) => ({ a: ringOf[i] >= 0 ? 1 : 0.5 }));
    pin(SEARCH);
    const fmt = (list) => (list.length > 3 ? list.slice(0, 3).join(' ') + ' …' : list.join(' '));
    const x = rightX();
    const h = panel(x, 16 * u, PW(), [
      { t: 'zip_radius (precomputed)', size: 11, weight: 600, fam: 'mono', color: C.muted, lh: 20 },
      { t: 'zip    radius  zips', size: 11.5, fam: 'mono', color: C.muted, lh: 20 },
      ...RINGS.map((r, k) => ({ t: `76104  ${String(r).padStart(2)} mi   ${fmt(ringZips[k])}`, size: 11.5, fam: 'mono', lh: 20, color: k === 1 ? C.blue : C.ink, a: ep(s, cue[k], cue[k] + 0.4) })),
      ...RINGS.map((r, k) => ({ t: `${r} mi`, right: `${ringCount[k]} ZIPs`, size: 12, color: C.muted, lh: 19, a: ep(s, cue[k] + 0.2, cue[k] + 0.6) })),
    ], ep(s, L[1], L[1] + 0.4));
    panel(x, 16 * u + h + 10 * u, PW(), [
      { t: '1 lookup', size: 13, weight: 600, right: `${ringCount[1]} ZIPs for 10 mi`, rweight: 400, lh: 22 },
      { t: 'then haversine on their stores', size: 13, color: C.muted, lh: 22, a: ep(s, L[2] + 1, L[2] + 1.5) },
    ], ep(s, L[2] + 0.2, L[2] + 0.6));
  };

  S.recap = (s, d, L, E) => {
    background();
    const k = 1 - 0.5 * ep(s, 0, 1);
    classifyFills(99, 0, 0, 0, k);
    voronoiEdges(0.6 * k);
    searchCircle(R, 1, k, 0);
    drawSites((i) => ({ a: k, fill: cls[i] !== 'out' ? C.blue : null }));
    pin(SEARCH, 1, k);
    // steps card
    const span0 = E[0] - L[0];
    const cues = [L[0], L[0] + span0 * 0.36, L[0] + span0 * 0.68, L[1]];
    const steps = [
      ['ZIP → centroid', 'lookup table of lat/lon'],
      ['Bounding box', 'cheap index filter'],
      ['Haversine', 'exact distance on a sphere'],
      ['Voronoi cells', 'which areas the circle covers'],
    ];
    const w = Math.min(460 * u, cw - 32 * u);
    const rows = [];
    steps.forEach(([a, b], i) => {
      rows.push({ t: `${i + 1}   ${a}`, size: 17, weight: 600, fam: 'display', lh: 26, a: ep(s, cues[i], cues[i] + 0.4), color: i === 3 ? C.blue : C.ink });
      rows.push({ t: b, indent: 24, size: 13, color: C.muted, lh: 24, a: ep(s, cues[i] + 0.2, cues[i] + 0.6) });
    });
    rows.push({ t: '', lh: 8 });
    rows.push({ t: 'That\'s a ZIP code radius search.', size: 20, weight: 700, fam: 'display', color: C.ink, lh: 30, a: ep(s, L[2], L[2] + 0.5) });
    const pad = 14 * u, hh = pad * 2 + rows.reduce((a, r) => a + r.lh * u, 0);
    panel((cw - w) / 2, (ch - hh) / 2, w, rows, ep(s, L[0] - 0.3, L[0] + 0.2), { always: true });
  };

  // ---------------------------------------------------------------- timeline
  const scenes = N.scenes.map((sc) => ({
    ...sc, draw: S[sc.id],
    L: sc.sentences.map((x) => x.start - sc.start), E: sc.sentences.map((x) => x.end - sc.start),
  }));
  const sceneAt = (t) => { let k = 0; for (let i = 0; i < scenes.length; i++) if (t >= scenes[i].start) k = i; return k; };

  function render(t) {
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    const k = sceneAt(t), sc = scenes[k];
    sc.draw(t - sc.start, sc.end - sc.start, sc.L, sc.E);
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = r.width; ch = r.height;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    sc = Math.min(cw / W, ch / H); ox = (cw - W * sc) / 2; oy = (ch - H * sc) / 2;
    u = Math.max(cw / 1000, 0.62);
    render(clock());
  }

  // ---------------------------------------------------------------- playback
  const audio = $('audio');
  let audioOK = true, playing = false, started = false, t = 0, rate = 1, last = performance.now();
  const POSTER = scenes.find((x) => x.id === 'classify').end - 0.6;
  const clock = () => (started ? t : POSTER);
  audio.addEventListener('error', () => { audioOK = false; });

  function setPlaying(p) {
    playing = p;
    $('ic-play').hidden = p; $('ic-pause').hidden = !p;
    $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  }
  function play() {
    if (!started) { started = true; t = 0; }
    if (t >= N.duration - 0.05) t = 0;
    $('start').hidden = true;
    setPlaying(true);
    last = performance.now();
    if (audioOK) {
      try { audio.currentTime = t; } catch (e) {}
      audio.playbackRate = rate;
      audio.play().catch(() => { audioOK = false; });
    }
  }
  function pause() { setPlaying(false); audio.pause(); }
  function seek(v) {
    if (!started) { started = true; $('start').hidden = true; }
    t = Math.max(0, Math.min(N.duration, v));
    if (audioOK) { try { audio.currentTime = t; } catch (e) {} }
    last = performance.now();
  }
  audio.addEventListener('ended', () => { t = N.duration; pause(); showReplay(); });
  function showReplay() {
    const st = $('start'); st.hidden = false;
    st.querySelector('.lbl').textContent = 'Replay';
    st.querySelector('.sub').textContent = 'From the beginning';
  }

  const fmtTime = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  let lastScene = -1, lastLine = null;
  function ui(tt) {
    const scrub = $('scrub');
    if (document.activeElement !== scrub || !scrubbing) scrub.value = tt;
    $('time').textContent = `${fmtTime(tt)} / ${fmtTime(N.duration)}`;
    const k = sceneAt(tt), sc = scenes[k];
    let ln = '';
    if (!started) ln = 'Press play to start.';
    else for (const x of sc.sentences) if (tt >= x.start - 0.05) ln = x.text;
    if (k !== lastScene) {
      $('kicker').textContent = `Chapter ${k + 1} of ${scenes.length} · ${sc.title}`;
      document.querySelectorAll('#chapters button').forEach((b, i) => b.classList.toggle('on', i === k));
      lastScene = k;
    }
    if (ln !== lastLine) { $('line').textContent = ln; lastLine = ln; }
  }

  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    if (playing) {
      t += dt * rate;
      if (audioOK && !audio.paused) {
        const at = audio.currentTime;
        if (Math.abs(at - t) > 0.12) t = at;
      }
      if (t >= N.duration) { t = N.duration; pause(); showReplay(); }
    }
    render(clock());
    ui(started ? t : 0);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- controls
  const scrub = $('scrub');
  scrub.max = N.duration;
  let scrubbing = false, wasPlaying = false;
  scrub.addEventListener('pointerdown', () => { scrubbing = true; wasPlaying = playing; if (playing) pause(); });
  scrub.addEventListener('input', () => seek(parseFloat(scrub.value)));
  const endScrub = () => { if (scrubbing) { scrubbing = false; if (wasPlaying) play(); } };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('change', endScrub);

  const ticks = $('ticks');
  scenes.slice(1).forEach((x) => { const i = document.createElement('i'); i.style.left = `${(x.start / N.duration) * 100}%`; ticks.appendChild(i); });

  const list = $('chapters');
  scenes.forEach((x, k) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="n">${fmtTime(x.start)}</span><span></span>`;
    b.lastChild.textContent = x.title;
    b.addEventListener('click', () => { seek(x.start + 0.01); if (!playing) play(); });
    li.appendChild(b); list.appendChild(li);
  });

  $('start').addEventListener('click', () => { if (t >= N.duration - 0.05) t = 0; play(); });
  $('play').addEventListener('click', () => (playing ? pause() : play()));
  const RATES = [1, 1.25, 1.5, 0.75];
  $('rate').addEventListener('click', () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    audio.playbackRate = rate; $('rate').textContent = `${rate}×`;
  });
  $('cc').addEventListener('click', () => {
    const on = $('cc').getAttribute('aria-pressed') !== 'true';
    $('cc').setAttribute('aria-pressed', String(on)); $('caption').classList.toggle('off', !on);
  });
  $('mute').addEventListener('click', () => {
    audio.muted = !audio.muted;
    $('mute').setAttribute('aria-pressed', String(!audio.muted));
    $('ic-vol').hidden = audio.muted; $('ic-mute').hidden = !audio.muted;
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, button') && e.key === ' ') return;
    if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight' && e.target !== scrub) { seek(t + 5); }
    else if (e.key === 'ArrowLeft' && e.target !== scrub) { seek(t - 5); }
  });

  // theme
  function applyTheme(v) {
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    try { localStorage.setItem('zipvor-theme', v); } catch (e) {}
    document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === v)));
    readColors();
  }
  let saved = 'dark';
  try { saved = localStorage.getItem('zipvor-theme') || 'dark'; } catch (e) {}
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeBtn)));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  applyTheme(saved);

  $('voice').textContent = N.voice;
  new ResizeObserver(resize).observe($('stage'));
  if (document.fonts) document.fonts.ready.then(() => render(clock()));
  resize();
  ui(0);
  requestAnimationFrame(frame);

  // deep link: #t=95 opens paused at 1:35; ?frame shows only the stage (for thumbnails)
  const m = /t=([\d.]+)/.exec(location.hash);
  if (m) seek(parseFloat(m[1]));
  if (/[?&]frame/.test(location.search)) document.documentElement.classList.add('frame-only');

  // debug hook for screenshots: window.__seek(seconds)
  window.__seek = (v) => { seek(v); render(t); };
  window.__stats = { NS, nCentroidIn, nTouch, nIn, nEdge, nVisited, missed: missed >= 0 ? zips[missed] : null, ringCount };
})();
