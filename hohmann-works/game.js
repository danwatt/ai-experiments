'use strict';
/*
 * Hohmann Works — a tiny orbital factory game.
 *
 * Core idea: every station rides a circular orbit, and inner orbits move faster
 * (Kepler: angular speed ∝ r^-1.5). Cargo moves between orbits only on Hohmann
 * transfers, so each route has a launch window (a required phase angle between
 * source and receiver) that repeats once per synodic period.
 */
(() => {
  // ---------------------------------------------------------------- constants
  const MU = 72000;                                // gravitational parameter (world units³/s²)
  const RINGS = [90, 135, 185, 240, 300, 365];     // orbit radii
  const WORLD_R = 385;
  const PLANET_R = 44;
  const STEP = 1 / 30;                             // fixed simulation step (s)
  const POD_CAP = 8;
  const CATCH = 0.14;                              // radians of slack when docking a pod
  const MAX_ROUTES = 3;
  const MAX_HOPS = 6;                              // half-orbits a missed pod survives
  const WARPS = [1, 2, 4, 8, 16];
  const SAVE_KEY = 'hohmann-works-v1';
  const SEEN_KEY = 'hohmann-works-intro';
  const TAU = Math.PI * 2;

  const ITEMS = {
    ore:      { name: 'Iron Ore',   shape: 'square',   color: '#a9b8cc', value: 2 },
    ice:      { name: 'Water Ice',  shape: 'circle',   color: '#8fe3ff', value: 2 },
    carbon:   { name: 'Carbon',     shape: 'triangle', color: '#d49a62', value: 2 },
    plate:    { name: 'Iron Plate', shape: 'square',   color: '#ff9d4d', solid: true, value: 6 },
    fuel:     { name: 'Fuel Cell',  shape: 'circle',   color: '#ffe066', solid: true, value: 6 },
    graphite: { name: 'Graphite',   shape: 'triangle', color: '#b48cff', solid: true, value: 6 },
    thruster: { name: 'Thruster',   parts: ['plate', 'fuel'],     color: '#ff7a59', value: 28 },
    hull:     { name: 'Hull Panel', parts: ['plate', 'graphite'], color: '#7fd6a4', value: 28 },
    probe:    { name: 'Probe',      parts: ['thruster', 'hull'],  color: '#f4f7fb', value: 110 },
  };
  const REFINE = { ore: 'plate', ice: 'fuel', carbon: 'graphite' };
  const RECIPES = [
    { in: ['plate', 'fuel'], out: 'thruster' },
    { in: ['plate', 'graphite'], out: 'hull' },
    { in: ['thruster', 'hull'], out: 'probe' },
  ];
  const BUILD = {
    miner:     { name: 'Miner', cost: 60 },
    refinery:  { name: 'Refinery', cost: 90 },
    assembler: { name: 'Assembler', cost: 150 },
  };
  const TYPE_NAME = { hub: 'Orbital Hub', miner: 'Miner', refinery: 'Refinery', assembler: 'Assembler' };
  const TYPE_COLOR = { hub: '#72d0ff', miner: '#e6edf7', refinery: '#ffb04a', assembler: '#c59bff' };
  const IN_LIST = { refinery: ['ore', 'ice', 'carbon'], assembler: ['plate', 'fuel', 'graphite', 'thruster', 'hull'] };
  const OUT_LIST = { refinery: ['plate', 'fuel', 'graphite'], assembler: ['thruster', 'hull', 'probe'] };
  const IN_CAP = { refinery: 16, assembler: 12 };
  const OUT_CAP = 24;
  const CYCLE = { miner: 2.5, refinery: 2, assembler: 3 };

  const CONTRACTS = [
    { item: 'ore', n: 12, reward: 150, unlock: 'refinery',
      brief: 'Your first Miner is already shipping ore. Select it to watch the launch window close, then follow the pod down to the Hub.' },
    { item: 'plate', n: 12, reward: 200,
      brief: 'Build a Refinery on any orbit. Route ore into it, then route its plates to the Hub.' },
    { item: 'fuel', n: 12, reward: 220, unlock: 'assembler',
      brief: 'Water ice floats on Orbit 4. Mine it and refine it into fuel cells.' },
    { item: 'thruster', n: 8, reward: 400,
      brief: 'An Assembler joins one plate and one fuel cell into a thruster. It needs two routes in.' },
    { item: 'hull', n: 8, reward: 400,
      brief: 'Hull panels take plates and graphite. Carbon asteroids ride Orbit 5.' },
    { item: 'probe', n: 5, reward: 1200,
      brief: 'A probe is a thruster plus a hull panel. Chain one Assembler into another.' },
  ];

  // ---------------------------------------------------------------- orbital math
  const omega = r => Math.sqrt(MU / (r * r * r));
  const OMEGA = RINGS.map(omega);
  const PERIOD = OMEGA.map(w => TAU / w);
  const wrap = a => ((a % TAU) + TAU) % TAU;
  const angDiff = (a, b) => { const d = wrap(a - b); return d > Math.PI ? d - TAU : d; };

  function hohmann(r1, r2) {
    const a = (r1 + r2) / 2;
    const e = Math.abs(r2 - r1) / (r1 + r2);
    const T = Math.PI * Math.sqrt(a * a * a / MU);          // half the transfer orbit's period
    const v1 = Math.sqrt(MU / r1), v2 = Math.sqrt(MU / r2);
    const dv1 = Math.abs(v1 * (Math.sqrt(2 * r2 / (r1 + r2)) - 1));
    const dv2 = Math.abs(v2 * (1 - Math.sqrt(2 * r1 / (r1 + r2))));
    const phase = wrap(Math.PI - omega(r2) * T);             // receiver lead angle at launch
    const dv = (dv1 + dv2) * 100;                            // shown in m/s
    return { a, e, T, dv, phase, cost: Math.max(1, Math.round(dv / 250)) };
  }
  const HOH = RINGS.map(r1 => RINGS.map(r2 => (r1 === r2 ? null : hohmann(r1, r2))));

  function synodic(i, j) { return TAU / Math.abs(OMEGA[j] - OMEGA[i]); }

  // seconds until the next launch window from src to dst
  function windowEta(src, dst) {
    const h = HOH[src.ring][dst.ring];
    const rel = OMEGA[dst.ring] - OMEGA[src.ring];
    const phi = wrap(dst.theta - src.theta);
    const d = rel > 0 ? wrap(h.phase - phi) : wrap(phi - h.phase);
    return d / Math.abs(rel);
  }

  function kepler(M, e) {
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 10; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }

  // polar position of a body on a transfer ellipse, t seconds after launch
  function transferPos(theta0, outward, a, e, T, t) {
    const M = wrap((outward ? 0 : Math.PI) + (Math.PI / T) * t);
    const E = kepler(M, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    return { r: a * (1 - e * Math.cos(E)), ang: (outward ? theta0 : theta0 + Math.PI) + nu };
  }

  // ---------------------------------------------------------------- world state
  let world;

  function mkStation(type, ring, theta) {
    return { id: world ? world.nextId++ : 0, type, ring, theta, in: {}, out: {}, incoming: {}, links: [], prog: 0, job: null, state: 'idle', rr: 0 };
  }

  function newWorld() {
    const w = { v: 1, t: 0, credits: 180, nextId: 1, contract: 0, progress: 0, earned: 0,
      unlocked: { refinery: false, assembler: false }, stations: [], asteroids: [], pods: [] };
    world = w;
    [[2, 'ore', 0.4], [2, 'ore', 3.6], [3, 'ice', 1.6], [3, 'ice', 4.7], [4, 'carbon', 0.9],
     [4, 'carbon', 4.0], [5, 'ore', 2.4], [5, 'ice', 5.0], [5, 'carbon', 0.1]]
      .forEach(([ring, res, theta]) => w.asteroids.push({ id: w.nextId++, ring, res, theta, seed: Math.floor(Math.random() * 1e6), miner: null }));
    const hub = mkStation('hub', 0, Math.PI / 2);
    w.stations.push(hub);
    const rock = w.asteroids[0];
    const miner = mkStation('miner', rock.ring, rock.theta);
    miner.ast = rock.id; miner.res = rock.res; rock.miner = miner.id;
    miner.links.push(mkLink(hub.id));
    w.stations.push(miner);
    return w;
  }

  function mkLink(to) { return { to, prev: null, last: 'wait', sent: 0 }; }

  const byId = id => world.stations.find(s => s.id === id);
  const astById = id => world.asteroids.find(a => a.id === id);
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };

  function accepts(st, id) {
    if (st.type === 'hub') return true;
    if (st.type === 'refinery') return id in REFINE;
    if (st.type === 'assembler') return RECIPES.some(r => r.in.includes(id));
    return false;
  }
  function possibleOutputs(st) {
    if (st.type === 'miner') return [st.res];
    return OUT_LIST[st.type] || [];
  }
  function room(st, id) {
    if (st.type === 'hub') return Infinity;
    return IN_CAP[st.type] - (st.in[id] || 0) - (st.incoming[id] || 0);
  }
  function contractAt(i) {
    if (i < CONTRACTS.length) return CONTRACTS[i];
    const pool = ['thruster', 'hull', 'probe', 'plate', 'fuel', 'graphite'];
    const k = i - CONTRACTS.length;
    const item = pool[(k * 5 + 2) % pool.length];
    const v = ITEMS[item].value;
    const n = Math.round((v > 50 ? 6 : v > 10 ? 10 : 20) * (1 + k * 0.2));
    return { item, n, reward: Math.round(n * v * 2.5), brief: 'Standing order from mission control. Keep the lines running.' };
  }

  // ---------------------------------------------------------------- simulation
  function step(dt) {
    world.t += dt;
    for (const a of world.asteroids) a.theta = wrap(a.theta + OMEGA[a.ring] * dt);
    for (const st of world.stations) {
      if (st.type === 'miner') {
        const a = astById(st.ast);
        st.theta = a ? a.theta : st.theta;
      } else {
        st.theta = wrap(st.theta + OMEGA[st.ring] * dt);
      }
      produce(st, dt);
    }
    for (const st of world.stations) {
      st.links = st.links.filter(L => byId(L.to));
      for (const L of st.links) {
        const dst = byId(L.to);
        const eta = windowEta(st, dst);
        if (L.prev != null && eta > L.prev + 1e-6) launch(st, dst, L);   // eta wrapped: window just opened
        L.prev = eta;
      }
    }
    for (const p of world.pods) advancePod(p, dt);
    world.pods = world.pods.filter(p => !p.done);
  }

  function produce(st, dt) {
    const full = sum(st.out) >= OUT_CAP;
    if (st.type === 'miner') {
      if (full) { st.state = 'full'; return; }
      st.state = 'work';
      st.prog += dt / CYCLE.miner;
      if (st.prog >= 1) { st.prog -= 1; add(st.out, st.res, 1); }
      return;
    }
    if (st.type === 'refinery' || st.type === 'assembler') {
      if (!st.job) {
        if (full) { st.state = 'full'; return; }
        st.job = pickJob(st);
        if (!st.job) { st.state = 'idle'; st.prog = 0; return; }
      }
      st.state = 'work';
      st.prog += dt / CYCLE[st.type];
      if (st.prog >= 1) {
        st.prog = 0;
        add(st.out, st.type === 'refinery' ? REFINE[st.job] : st.job, 1);
        st.job = null;
      }
    }
  }

  // consumes inputs up front; returns the item being processed/made
  function pickJob(st) {
    if (st.type === 'refinery') {
      const keys = IN_LIST.refinery;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[(st.rr + i) % keys.length];
        if ((st.in[k] || 0) > 0) { st.in[k]--; st.rr = (st.rr + i + 1) % keys.length; return k; }
      }
      return null;
    }
    for (let i = 0; i < RECIPES.length; i++) {
      const r = RECIPES[(st.rr + i) % RECIPES.length];
      if (r.in.every(k => (st.in[k] || 0) > 0)) {
        r.in.forEach(k => st.in[k]--);
        st.rr = (st.rr + i + 1) % RECIPES.length;
        return r.out;
      }
    }
    return null;
  }

  let fundsWarned = 0;
  function launch(src, dst, L) {
    const load = {};
    let n = 0;
    for (const id of Object.keys(src.out)) {
      if (!src.out[id] || !accepts(dst, id)) continue;
      const take = Math.min(src.out[id], room(dst, id), POD_CAP - n);
      if (take > 0) { load[id] = take; n += take; }
    }
    if (!n) { L.last = sum(src.out) ? 'full' : 'empty'; return; }
    const h = HOH[src.ring][dst.ring];
    if (world.credits < h.cost) {
      L.last = 'funds';
      if (performance.now() - fundsWarned > 8000) { fundsWarned = performance.now(); toast('A launch was scrubbed: not enough credits for fuel.', 'bad'); }
      return;
    }
    world.credits -= h.cost;
    for (const [id, k] of Object.entries(load)) { src.out[id] -= k; add(dst.incoming, id, k); }
    world.pods.push({
      items: load, theta0: src.theta, r1i: src.ring, r2i: dst.ring,
      a: h.a, e: h.e, T: h.T, outward: RINGS[dst.ring] > RINGS[src.ring],
      t: 0, k: 1, dest: dst.id, src: src.id, done: false,
    });
    L.last = 'sent';
    L.sent += n;
  }

  function advancePod(p, dt) {
    p.t += dt;
    while (p.t >= p.k * p.T) {
      const ring = p.k % 2 ? p.r2i : p.r1i;
      const ang = wrap(p.theta0 + p.k * Math.PI);
      const catcher = findCatcher(ring, ang, p);
      if (catcher) {
        release(p);
        deliver(catcher, p.items);
        p.done = true;
        return;
      }
      if (p.k === 1) toast('A pod missed its catch. It will coast around and try again.', 'warn');
      p.k++;
      if (p.k > MAX_HOPS) {
        release(p);
        p.done = true;
        toast(`Cargo lost: ${describe(p.items)} drifted off.`, 'bad');
        return;
      }
    }
  }

  function findCatcher(ring, ang, p) {
    const ok = st => st.ring === ring && Math.abs(angDiff(st.theta, ang)) < CATCH &&
      Object.keys(p.items).every(id => accepts(st, id));
    const dest = byId(p.dest);
    if (dest && ok(dest)) return dest;
    return world.stations.find(ok) || null;
  }

  function release(p) {
    const dest = byId(p.dest);
    if (!dest) return;
    for (const [id, n] of Object.entries(p.items)) dest.incoming[id] = Math.max(0, (dest.incoming[id] || 0) - n);
  }

  function deliver(st, items) {
    for (const [id, n] of Object.entries(items)) {
      if (st.type === 'hub') hubReceive(id, n);
      else add(st.in, id, n);
    }
  }

  function hubReceive(id, n) {
    const pay = ITEMS[id].value * n;
    world.credits += pay;
    world.earned += pay;
    const c = contractAt(world.contract);
    if (id !== c.item) return;
    world.progress += n;
    if (world.progress >= c.n) {
      world.credits += c.reward;
      world.earned += c.reward;
      let msg = `Contract complete: ${c.n} ${ITEMS[c.item].name}. +${c.reward} cr.`;
      if (c.unlock) { world.unlocked[c.unlock] = true; msg += ` ${BUILD[c.unlock].name} unlocked.`; }
      if (world.contract === CONTRACTS.length - 1) msg = `First probe fleet delivered. The deep space program is open. +${c.reward} cr.`;
      toast(msg, 'good', 6000);
      world.contract++;
      world.progress = 0;
      refreshToolbar();
    }
  }

  function describe(items) {
    return Object.entries(items).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ');
  }

  // ---------------------------------------------------------------- player actions
  function build(type, ring, theta, rock) {
    const cost = BUILD[type].cost;
    if (world.credits < cost) { toast(`A ${BUILD[type].name} costs ${cost} cr. You have ${Math.floor(world.credits)}.`, 'warn'); return null; }
    world.credits -= cost;
    const st = mkStation(type, ring, theta);
    if (rock) { st.ast = rock.id; st.res = rock.res; rock.miner = st.id; }
    world.stations.push(st);
    ui.sel = st.id;
    return st;
  }

  function tryLink(src, dst) {
    if (src.ring === dst.ring) {
      toast('Stations on the same orbit never close the gap between them. Pick a receiver on a different orbit.', 'warn');
      return false;
    }
    if (src.links.some(l => l.to === dst.id)) { toast('That route already exists.', 'warn'); return false; }
    if (src.links.length >= MAX_ROUTES) { toast(`A station can run at most ${MAX_ROUTES} routes out.`, 'warn'); return false; }
    const useful = possibleOutputs(src).filter(id => accepts(dst, id));
    if (!useful.length) {
      toast(`A ${TYPE_NAME[dst.type]} can't use anything a ${TYPE_NAME[src.type]} makes.`, 'warn');
      return false;
    }
    src.links.push(mkLink(dst.id));
    const h = HOH[src.ring][dst.ring];
    toast(`Route set. Window every ${fmtDur(synodic(src.ring, dst.ring))}, ${fmtDur(h.T)} in transit, ${h.cost} cr per launch.`, 'good');
    return true;
  }

  function demolish(st) {
    if (st.type === 'hub') { toast('The Orbital Hub stays.', 'warn'); return; }
    const refund = Math.floor(BUILD[st.type].cost / 2);
    world.credits += refund;
    world.stations = world.stations.filter(s => s !== st);
    for (const s of world.stations) s.links = s.links.filter(l => l.to !== st.id);
    if (st.ast) { const a = astById(st.ast); if (a) a.miner = null; }
    if (ui.sel === st.id) ui.sel = null;
    if (ui.linkFrom === st.id) ui.linkFrom = null;
    toast(`${TYPE_NAME[st.type]} demolished. +${refund} cr.`);
  }

  // ---------------------------------------------------------------- view & camera
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const view = { W: 0, H: 0, dpr: 1, cx: 0, cy: 0, base: 1 };
  const cam = { zoom: 1, ox: 0, oy: 0 };
  const scale = () => view.base * cam.zoom;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    Object.assign(view, { W, H, dpr });
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const wide = W >= 900;
    const top = W < 760 ? 150 : 60, bottom = 90;
    const availW = wide ? W - 340 : W;
    const availH = Math.max(200, H - top - bottom);
    view.cx = availW / 2;
    view.cy = top + availH / 2;
    view.base = Math.min(availW, availH) / (2 * WORLD_R + 30);
  }

  function polarToScreen(r, ang) {
    const s = scale();
    return { x: view.cx + cam.ox + r * Math.cos(ang) * s, y: view.cy + cam.oy - r * Math.sin(ang) * s };
  }
  function screenToWorld(x, y) {
    const s = scale();
    return { x: (x - view.cx - cam.ox) / s, y: -(y - view.cy - cam.oy) / s };
  }
  const center = () => ({ x: view.cx + cam.ox, y: view.cy + cam.oy });
  const stationPos = st => polarToScreen(RINGS[st.ring], st.theta);

  function pickStation(x, y, filter) {
    let best = null, bd = 20;
    for (const st of world.stations) {
      if (filter && !filter(st)) continue;
      const p = stationPos(st);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }
  function pickAsteroid(x, y) {
    let best = null, bd = 20;
    for (const a of world.asteroids) {
      const p = polarToScreen(RINGS[a.ring], a.theta);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function placementAt(x, y) {
    const w = screenToWorld(x, y);
    const r = Math.hypot(w.x, w.y);
    const theta = wrap(Math.atan2(w.y, w.x));
    let ring = -1, best = Infinity;
    RINGS.forEach((R, i) => { const d = Math.abs(r - R) * scale(); if (d < best) { best = d; ring = i; } });
    if (best > 22) return null;
    const minSep = 32 / RINGS[ring];
    const clash = world.stations.some(s => s.ring === ring && Math.abs(angDiff(s.theta, theta)) < minSep) ||
      world.asteroids.some(a => a.ring === ring && Math.abs(angDiff(a.theta, theta)) < minSep);
    return { ring, theta, ok: !clash };
  }

  // ---------------------------------------------------------------- drawing
  const stars = Array.from({ length: 260 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + 0.2,
    a: Math.random() * 0.6 + 0.15, ph: Math.random() * TAU,
  }));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  function shapePath(c, shape, x, y, size) {
    c.beginPath();
    if (shape === 'circle') c.arc(x, y, size * 0.42, 0, TAU);
    else if (shape === 'square') { const h = size * 0.38; c.rect(x - h, y - h, h * 2, h * 2); }
    else {
      const r = size * 0.5;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * TAU / 3;
        const px = x + Math.cos(a) * r, py = y + 0.08 * size + Math.sin(a) * r;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath();
    }
  }

  function drawGlyph(c, id, x, y, size) {
    const it = ITEMS[id];
    if (!it) return;
    c.save();
    if (it.parts) {
      const w = size, h = size * 0.66;
      roundRect(c, x - w / 2, y - h / 2, w, h, size * 0.14);
      c.fillStyle = '#0b1322';
      c.fill();
      c.lineWidth = Math.max(1, size * 0.07);
      c.strokeStyle = it.color;
      c.stroke();
      drawGlyph(c, it.parts[0], x - size * 0.22, y, size * 0.42);
      drawGlyph(c, it.parts[1], x + size * 0.22, y, size * 0.42);
    } else {
      shapePath(c, it.shape, x, y, size);
      if (it.solid) { c.fillStyle = it.color; c.fill(); }
      else {
        c.fillStyle = 'rgba(255,255,255,0.06)';
        c.fill();
        c.lineWidth = Math.max(1.2, size * 0.13);
        c.strokeStyle = it.color;
        c.stroke();
      }
    }
    c.restore();
  }

  const glyphCache = {};
  function glyphURL(id) {
    if (glyphCache[id]) return glyphCache[id];
    const g = document.createElement('canvas');
    g.width = g.height = 48;
    drawGlyph(g.getContext('2d'), id, 24, 24, 34);
    return (glyphCache[id] = g.toDataURL());
  }

  function drawBackground() {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, view.W, view.H);
    const now = performance.now() / 1000;
    for (const s of stars) {
      const tw = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(now * 0.8 + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#cfe3ff';
      ctx.fillRect(((s.x * view.W + cam.ox * 0.05) % view.W + view.W) % view.W, ((s.y * view.H + cam.oy * 0.05) % view.H + view.H) % view.H, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet() {
    const c = center(), pr = PLANET_R * scale();
    const glow = ctx.createRadialGradient(c.x, c.y, pr * 0.9, c.x, c.y, pr * 1.9);
    glow.addColorStop(0, 'rgba(114,208,255,0.22)');
    glow.addColorStop(1, 'rgba(114,208,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(c.x, c.y, pr * 1.9, 0, TAU); ctx.fill();
    const body = ctx.createRadialGradient(c.x - pr * 0.35, c.y - pr * 0.4, pr * 0.1, c.x, c.y, pr);
    body.addColorStop(0, '#4fa3bf');
    body.addColorStop(0.55, '#1f5470');
    body.addColorStop(1, '#0c2236');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(c.x, c.y, pr, 0, TAU); ctx.fill();
    const night = ctx.createLinearGradient(c.x - pr, c.y - pr, c.x + pr, c.y + pr);
    night.addColorStop(0.45, 'rgba(3,6,12,0)');
    night.addColorStop(1, 'rgba(3,6,12,0.8)');
    ctx.fillStyle = night;
    ctx.beginPath(); ctx.arc(c.x, c.y, pr, 0, TAU); ctx.fill();
  }

  function drawRings(hoverRing) {
    const c = center(), s = scale();
    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = 'bottom';
    RINGS.forEach((R, i) => {
      const rad = R * s;
      ctx.lineWidth = i === hoverRing ? 2 : 1;
      ctx.strokeStyle = i === hoverRing ? 'rgba(114,208,255,0.55)' : 'rgba(80,110,160,0.28)';
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, TAU); ctx.stroke();
      // moving tick marks show each orbit's speed
      ctx.strokeStyle = 'rgba(114,208,255,0.16)';
      ctx.lineWidth = 3;
      ctx.setLineDash([1.5, 26]);
      ctx.lineDashOffset = (OMEGA[i] * world.t * rad) % 27.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(125,142,168,0.85)';
      ctx.fillText(`O${i + 1} · ${fmtDur(PERIOD[i], true)}`, c.x + 5, c.y - rad - 3);
    });
  }

  function drawAsteroid(a) {
    const p = polarToScreen(RINGS[a.ring], a.theta);
    const col = ITEMS[a.res].color;
    let seed = a.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = i / n * TAU + a.theta * 0.6;
      const r = 7 + rnd() * 4;
      const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#141c2b';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.stroke();
    if (!a.miner) {
      ctx.globalAlpha = 0.7;
      drawGlyph(ctx, a.res, p.x, p.y, 7);
      ctx.globalAlpha = 1;
    }
  }

  function drawStationShape(type, x, y, alpha = 1, color) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.strokeStyle = color || TYPE_COLOR[type];
    ctx.lineWidth = 1.8;
    ctx.fillStyle = '#0b1322';
    ctx.beginPath();
    if (type === 'hub') {
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + Math.PI / 6;
        i ? ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15) : ctx.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(114,208,255,0.35)';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    } else if (type === 'miner') {
      const h = 13, k = 5;
      ctx.beginPath();
      ctx.moveTo(-h, -h + k); ctx.lineTo(-h, -h); ctx.lineTo(-h + k, -h);
      ctx.moveTo(h - k, -h); ctx.lineTo(h, -h); ctx.lineTo(h, -h + k);
      ctx.moveTo(h, h - k); ctx.lineTo(h, h); ctx.lineTo(h - k, h);
      ctx.moveTo(-h + k, h); ctx.lineTo(-h, h); ctx.lineTo(-h, h - k);
      ctx.stroke();
    } else if (type === 'refinery') {
      roundRect(ctx, -11, -11, 22, 22, 4); ctx.fill(); ctx.stroke();
    } else if (type === 'assembler') {
      ctx.moveTo(0, -14); ctx.lineTo(14, 0); ctx.lineTo(0, 14); ctx.lineTo(-14, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawStation(st, selected, dim) {
    const p = stationPos(st);
    drawStationShape(st.type, p.x, p.y, dim ? 0.35 : 1);
    if (dim) return;
    if (st.job) drawGlyph(ctx, st.type === 'refinery' ? REFINE[st.job] : st.job, p.x, p.y, st.type === 'assembler' ? 12 : 10);
    if (st.state === 'work') {
      ctx.strokeStyle = TYPE_COLOR[st.type];
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 19, -Math.PI / 2, -Math.PI / 2 + st.prog * TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (st.state === 'full') {
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.arc(p.x + 13, p.y + 13, 3, 0, TAU); ctx.fill();
    }
    const outKey = Object.keys(st.out).find(k => st.out[k] > 0);
    if (outKey) {
      drawGlyph(ctx, outKey, p.x + 22, p.y - 14, 10);
      ctx.font = `10px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#dbe4f0';
      ctx.fillText(String(sum(st.out)), p.x + 29, p.y - 14);
    }
    if (selected) {
      ctx.strokeStyle = '#72d0ff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawPod(p) {
    const missed = p.k > 1;
    const trailFrom = Math.max(0, p.t - 3);
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const t = trailFrom + (p.t - trailFrom) * i / 14;
      const q = transferPos(p.theta0, p.outward, p.a, p.e, p.T, t);
      const s = polarToScreen(q.r, q.ang);
      i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
    }
    ctx.strokeStyle = missed ? 'rgba(255,107,107,0.55)' : 'rgba(255,176,74,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const q = transferPos(p.theta0, p.outward, p.a, p.e, p.T, p.t);
    const s = polarToScreen(q.r, q.ang);
    ctx.fillStyle = missed ? '#ff6b6b' : '#ffb04a';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, TAU); ctx.fill();
    const id = Object.keys(p.items)[0];
    if (id) drawGlyph(ctx, id, s.x + 9, s.y - 8, 8);
  }

  // dashed transfer arc from a source, the window bracket, and the closing gap
  function drawRoutePreview(src, dst, strong) {
    const h = HOH[src.ring][dst.ring];
    const outward = RINGS[dst.ring] > RINGS[src.ring];
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const q = transferPos(src.theta, outward, h.a, h.e, h.T, h.T * i / 48);
      const s = polarToScreen(q.r, q.ang);
      i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
    }
    ctx.strokeStyle = strong ? 'rgba(255,176,74,0.85)' : 'rgba(255,176,74,0.4)';
    ctx.lineWidth = strong ? 1.6 : 1.2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // where the receiver must be at launch
    const Rd = RINGS[dst.ring], s = scale(), c = center();
    const mark = wrap(src.theta + h.phase);
    const rel = OMEGA[dst.ring] - OMEGA[src.ring];
    const from = rel > 0 ? dst.theta : mark;
    const len = rel > 0 ? wrap(mark - dst.theta) : wrap(dst.theta - mark);
    ctx.strokeStyle = 'rgba(255,176,74,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(c.x, c.y, Rd * s, -from, -(from + len), true); ctx.stroke();

    const m = polarToScreen(Rd, mark);
    const inner = polarToScreen(Rd - 12 / s, mark), outer = polarToScreen(Rd + 12 / s, mark);
    ctx.strokeStyle = '#ffb04a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(inner.x, inner.y); ctx.lineTo(outer.x, outer.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, TAU); ctx.stroke();
    if (strong) {
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = '#ffb04a';
      ctx.textBaseline = 'middle';
      ctx.fillText(`window ${fmtDur(windowEta(src, dst))}`, m.x + 9, m.y);
    }
  }

  function drawTip(x, y, lines) {
    ctx.font = `11px ${MONO}`;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
    const h = lines.length * 15 + 10;
    let tx = x + 16, ty = y + 16;
    if (tx + w > view.W - 8) tx = x - w - 12;
    if (ty + h > view.H - 8) ty = y - h - 12;
    ctx.fillStyle = 'rgba(11,19,34,0.95)';
    ctx.strokeStyle = '#2e4264';
    ctx.lineWidth = 1;
    roundRect(ctx, tx, ty, w, h, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dbe4f0';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, tx + 8, ty + 6 + i * 15));
  }

  function draw() {
    const { dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    drawPlanet();

    const m = ui.mouse;
    const building = ui.tool === 'refinery' || ui.tool === 'assembler';
    const place = building && m.in ? placementAt(m.x, m.y) : null;
    drawRings(place ? place.ring : -1);

    // all routes, faint
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(114,208,255,0.22)';
    for (const st of world.stations) for (const L of st.links) {
      const d = byId(L.to);
      if (!d) continue;
      const a = stationPos(st), b = stationPos(d);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    const sel = ui.sel != null ? byId(ui.sel) : null;
    if (sel && ui.tool === 'select') for (const L of sel.links) { const d = byId(L.to); if (d) drawRoutePreview(sel, d, true); }

    // link preview
    let tip = null;
    const from = ui.linkFrom != null ? byId(ui.linkFrom) : null;
    if (ui.tool === 'link' && from && m.in) {
      const target = pickStation(m.x, m.y, s => s !== from);
      if (target && target.ring !== from.ring) {
        drawRoutePreview(from, target, true);
        const h = HOH[from.ring][target.ring];
        const useful = possibleOutputs(from).some(id => accepts(target, id));
        tip = useful ? [
          `${TYPE_NAME[from.type]} O${from.ring + 1} → ${TYPE_NAME[target.type]} O${target.ring + 1}`,
          `transfer   ${fmtDur(h.T)}`,
          `Δv         ${Math.round(h.dv)} m/s  (${h.cost} cr)`,
          `window     every ${fmtDur(synodic(from.ring, target.ring))}`,
          `next       ${fmtDur(windowEta(from, target))}`,
        ] : [`${TYPE_NAME[target.type]} can't use this cargo`];
      } else if (target) {
        tip = ['Same orbit: pick a different orbit'];
      }
    }

    for (const a of world.asteroids) drawAsteroid(a);
    for (const st of world.stations) drawStation(st, st.id === ui.sel || st.id === ui.linkFrom, false);
    for (const p of world.pods) drawPod(p);

    // placement ghosts
    if (place) {
      const p = polarToScreen(RINGS[place.ring], place.theta);
      drawStationShape(ui.tool, p.x, p.y, 0.6, place.ok ? null : '#ff6b6b');
      const affordable = world.credits >= BUILD[ui.tool].cost;
      tip = place.ok
        ? [`${BUILD[ui.tool].name} on O${place.ring + 1} · ${BUILD[ui.tool].cost} cr`, `period ${fmtDur(PERIOD[place.ring])}`].concat(affordable ? [] : ['not enough credits'])
        : ['Too close to something on this orbit'];
    }
    if (ui.tool === 'miner' && m.in) {
      const a = pickAsteroid(m.x, m.y);
      if (a) {
        const p = polarToScreen(RINGS[a.ring], a.theta);
        drawStationShape('miner', p.x, p.y, 0.7, a.miner ? '#ff6b6b' : null);
        tip = a.miner ? ['Already mined'] : [`Miner on ${ITEMS[a.res].name} · ${BUILD.miner.cost} cr`, `O${a.ring + 1} · 1 unit every ${CYCLE.miner} s`];
      }
    }
    if (ui.tool === 'demolish' && m.in) {
      const st = pickStation(m.x, m.y);
      if (st && st.type !== 'hub') {
        const p = stationPos(st);
        drawStationShape(st.type, p.x, p.y, 1, '#ff6b6b');
        tip = [`Demolish ${TYPE_NAME[st.type]} · refund ${Math.floor(BUILD[st.type].cost / 2)} cr`];
      }
    }
    if (tip && m.in) drawTip(m.x, m.y, tip);
  }

  // ---------------------------------------------------------------- UI state & input
  const ui = { tool: 'select', sel: null, linkFrom: null, mouse: { x: 0, y: 0, in: false }, warp: 1, paused: false };
  const $ = s => document.querySelector(s);

  function setTool(t) {
    if ((t === 'refinery' || t === 'assembler') && !world.unlocked[t]) return;
    ui.tool = t;
    ui.linkFrom = null;
    if (t === 'link' && ui.sel != null) {
      const s = byId(ui.sel);
      if (s && possibleOutputs(s).length) ui.linkFrom = s.id;
    }
    canvas.classList.toggle('build', t !== 'select');
    refreshToolbar();
  }

  function refreshToolbar() {
    document.querySelectorAll('#toolbar button').forEach(b => {
      const t = b.dataset.tool;
      b.setAttribute('aria-pressed', String(t === ui.tool));
      const locked = (t === 'refinery' || t === 'assembler') && !world.unlocked[t];
      b.disabled = locked;
      b.title = locked ? `Unlocks with a Hub contract` : '';
    });
    document.querySelectorAll('.warp [data-warp]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.warp === ui.warp && !ui.paused)));
    $('#pause').setAttribute('aria-pressed', String(ui.paused));
    $('#pause').textContent = ui.paused ? 'Paused' : 'Pause';
  }

  function handleClick(x, y) {
    switch (ui.tool) {
      case 'select': {
        const st = pickStation(x, y);
        ui.sel = st ? st.id : null;
        break;
      }
      case 'miner': {
        const a = pickAsteroid(x, y);
        if (!a) { toast('Click an asteroid to put a Miner on it.', 'warn'); break; }
        if (a.miner) { toast('That asteroid already has a Miner.', 'warn'); break; }
        const st = build('miner', a.ring, a.theta, a);
        if (st) toast(`Miner built on ${ITEMS[a.res].name}. Now give it a route with the Route tool.`);
        break;
      }
      case 'refinery':
      case 'assembler': {
        const p = placementAt(x, y);
        if (!p) { toast('Click on one of the orbit lines.', 'warn'); break; }
        if (!p.ok) { toast('Too close to something else on that orbit.', 'warn'); break; }
        build(ui.tool, p.ring, p.theta);
        break;
      }
      case 'link': {
        const st = pickStation(x, y);
        if (ui.linkFrom == null) {
          if (!st) break;
          if (!possibleOutputs(st).length) { toast(`The ${TYPE_NAME[st.type]} doesn't ship cargo. Start a route from a station that makes something.`, 'warn'); break; }
          ui.linkFrom = st.id;
          ui.sel = st.id;
        } else {
          if (!st) { ui.linkFrom = null; break; }
          if (st.id === ui.linkFrom) { ui.linkFrom = null; break; }
          const src = byId(ui.linkFrom);
          if (src && tryLink(src, st)) { ui.sel = src.id; ui.linkFrom = null; }
        }
        break;
      }
      case 'demolish': {
        const st = pickStation(x, y);
        if (st) demolish(st);
        break;
      }
    }
    renderInspector(true);
  }

  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, ox: cam.ox, oy: cam.oy, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or stale pointer */ }
  });
  canvas.addEventListener('pointermove', e => {
    ui.mouse = { x: e.clientX, y: e.clientY, in: true };
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; canvas.classList.add('panning'); }
    if (drag.moved) { cam.ox = drag.ox + dx; cam.oy = drag.oy + dy; }
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved) handleClick(e.clientX, e.clientY);
    drag = null;
    canvas.classList.remove('panning');
  });
  canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('panning'); });
  canvas.addEventListener('pointerleave', () => { ui.mouse.in = false; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    cam.zoom = Math.min(4, Math.max(0.5, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    const s = scale();
    cam.ox = e.clientX - view.cx - before.x * s;
    cam.oy = e.clientY - view.cy + before.y * s;
  }, { passive: false });

  document.getElementById('toolbar').addEventListener('click', e => {
    const b = e.target.closest('button[data-tool]');
    if (b && !b.disabled) setTool(b.dataset.tool);
  });
  document.querySelector('.warp').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pause') ui.paused = !ui.paused;
    else { ui.warp = +b.dataset.warp; ui.paused = false; }
    refreshToolbar();
  });

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (!$('#intro').hidden) { if (e.key === 'Escape' || e.key === 'Enter') closeIntro(); return; }
    const tools = ['select', 'miner', 'refinery', 'assembler', 'link', 'demolish'];
    if (e.key >= '1' && e.key <= '6') setTool(tools[+e.key - 1]);
    else if (e.key === ' ') { e.preventDefault(); ui.paused = !ui.paused; refreshToolbar(); }
    else if (e.key === ']') { ui.warp = Math.min(WARPS.length - 1, ui.warp + 1); refreshToolbar(); }
    else if (e.key === '[') { ui.warp = Math.max(0, ui.warp - 1); refreshToolbar(); }
    else if (e.key === 'Escape') { if (ui.linkFrom != null) ui.linkFrom = null; else if (ui.tool !== 'select') setTool('select'); else ui.sel = null; renderInspector(true); }
    else if (e.key === 'Delete') { const s = ui.sel != null && byId(ui.sel); if (s) { demolish(s); renderInspector(true); } }
  });

  // ---------------------------------------------------------------- panels
  function fmtDur(s, short) {
    if (!isFinite(s)) return '—';
    if (s < 60) return short ? `${Math.round(s)}s` : `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return short ? `${m}m${String(r).padStart(2, '0')}` : `${m} min ${r} s`;
  }
  function fmtClock(t) {
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60);
    const p = n => String(n).padStart(2, '0');
    return `T+ ${h ? p(h) + ':' : ''}${p(m)}:${p(s)}`;
  }

  let contractShown = -1;
  function renderContract() {
    const c = contractAt(world.contract);
    if (contractShown !== world.contract) {
      contractShown = world.contract;
      $('#c-num').textContent = `${world.contract + 1}${world.contract < CONTRACTS.length ? ' of ' + CONTRACTS.length : ''}`;
      $('#c-glyph').src = glyphURL(c.item);
      $('#c-item').textContent = ITEMS[c.item].name;
      $('#c-n').textContent = c.n;
      $('#c-reward').textContent = `+${c.reward} cr`;
      $('#c-brief').textContent = c.brief;
      $('#c-unlock').textContent = c.unlock ? `Unlocks: ${BUILD[c.unlock].name}` : '';
    }
    $('#c-prog').textContent = Math.min(world.progress, c.n);
    $('#c-bar').style.width = `${Math.min(100, world.progress / c.n * 100)}%`;
  }

  let inspSig = '', inspBind = [];
  function renderInspector(force) {
    const box = $('#inspector');
    const st = ui.sel != null ? byId(ui.sel) : null;
    if (!st) { box.hidden = true; inspSig = ''; return; }
    box.hidden = false;
    const incoming = world.stations.filter(s => s.links.some(l => l.to === st.id));
    const sig = [st.id, st.links.map(l => l.to).join(','), incoming.map(s => s.id).join(',')].join('|');
    if (force || sig !== inspSig) buildInspector(st, incoming, box);
    inspSig = sig;
    for (const [el, fn] of inspBind) {
      const v = fn();
      if (typeof v === 'object') { el.textContent = v.text; el.className = v.cls; }
      else el.textContent = v;
    }
  }

  function statusFor(st) {
    if (st.type === 'hub') {
      const c = contractAt(world.contract);
      return { text: `Buying everything. Contract wants ${ITEMS[c.item].name}.`, cls: 'insp-status' };
    }
    const noRoute = !st.links.length && sum(st.out) > 0;
    if (st.state === 'full') return { text: st.links.length ? 'Output full. Waiting for the next launch window.' : 'Output full. Give it a route.', cls: 'insp-status warn' };
    if (noRoute) return { text: 'No route out yet. Use the Route tool.', cls: 'insp-status warn' };
    if (st.type === 'miner') return { text: `Mining ${ITEMS[st.res].name}`, cls: 'insp-status' };
    if (st.state === 'work') return { text: `${st.type === 'refinery' ? 'Refining' : 'Assembling'} ${ITEMS[st.type === 'refinery' ? REFINE[st.job] : st.job].name}`, cls: 'insp-status' };
    return { text: st.type === 'refinery' ? 'Idle. Waiting for ore, ice or carbon.' : 'Idle. Needs both parts of a recipe.', cls: 'insp-status warn' };
  }

  function chipRow(obj, keys) {
    return `<div class="stock">${keys.map(k => `<span class="chip" data-chip="${obj}:${k}"><img src="${glyphURL(k)}" alt="">${ITEMS[k].name} <b>0</b></span>`).join('')}</div>`;
  }

  const LAST = { sent: 'last window: launched', empty: 'last window: nothing to send', full: 'last window: receiver full', funds: 'last window: no fuel credits', wait: 'waiting for first window' };

  function buildInspector(st, incoming, box) {
    const inKeys = IN_LIST[st.type] || [];
    const outKeys = st.type === 'miner' ? [st.res] : OUT_LIST[st.type] || [];
    let html = `<div class="insp-head"><span class="insp-name">${TYPE_NAME[st.type]}</span>
      <span class="insp-orbit">Orbit ${st.ring + 1} · ${fmtDur(PERIOD[st.ring])} lap</span></div>
      <div class="insp-status" data-b="status"></div>`;
    if (inKeys.length) html += `<div class="insp-sec"><h4>Input · up to ${IN_CAP[st.type]} each</h4>${chipRow('in', inKeys)}</div>`;
    if (outKeys.length) html += `<div class="insp-sec"><h4>Output · holds ${OUT_CAP}</h4>${chipRow('out', outKeys)}</div>`;
    if (st.type === 'hub') html += `<div class="insp-sec"><h4>Revenue</h4><div class="chip"><b data-b="earned"></b></div></div>`;
    if (st.type !== 'hub') {
      html += `<div class="insp-sec"><h4>Routes out · ${st.links.length} of ${MAX_ROUTES}</h4>`;
      if (st.links.length) {
        html += '<ul class="routes">' + st.links.map((L, i) => {
          const d = byId(L.to), h = HOH[st.ring][d.ring];
          return `<li class="route"><span class="to">→ ${TYPE_NAME[d.type]} · Orbit ${d.ring + 1}</span>
            <button class="x" type="button" data-act="unlink" data-i="${i}" title="Remove route" aria-label="Remove route">×</button>
            <span class="meta">next window <span class="eta" data-b="eta${i}"></span> · every ${fmtDur(synodic(st.ring, d.ring))}<br>
            ${fmtDur(h.T)} transit · Δv ${Math.round(h.dv)} m/s · ${h.cost} cr<br><span data-b="last${i}"></span></span></li>`;
        }).join('') + '</ul>';
      } else html += '<p class="empty-note">Nothing ships until you add a route.</p>';
      html += '</div>';
    }
    if (incoming.length) {
      html += `<div class="insp-sec"><h4>Routes in</h4><p class="empty-note">${incoming.map(s => `${TYPE_NAME[s.type]} · Orbit ${s.ring + 1}`).join('<br>')}</p></div>`;
    }
    if (st.type !== 'hub') {
      html += `<div class="insp-actions">
        ${possibleOutputs(st).length && st.links.length < MAX_ROUTES ? '<button class="ghost" type="button" data-act="route">Add route</button>' : ''}
        <button class="ghost danger" type="button" data-act="demolish">Demolish · +${Math.floor(BUILD[st.type].cost / 2)} cr</button></div>`;
    }
    box.innerHTML = html;

    inspBind = [];
    const q = s => box.querySelector(`[data-b="${s}"]`);
    inspBind.push([q('status'), () => statusFor(st)]);
    if (q('earned')) inspBind.push([q('earned'), () => `${Math.floor(world.earned)} cr earned`]);
    box.querySelectorAll('[data-chip]').forEach(el => {
      const [side, k] = el.dataset.chip.split(':');
      const b = el.querySelector('b');
      inspBind.push([b, () => {
        const n = st[side][k] || 0;
        el.classList.toggle('zero', !n);
        return side === 'in' && st.incoming[k] ? `${n} +${st.incoming[k]}` : String(n);
      }]);
    });
    st.links.forEach((L, i) => {
      inspBind.push([q(`eta${i}`), () => { const d = byId(L.to); return d ? fmtDur(windowEta(st, d)) : '—'; }]);
      inspBind.push([q(`last${i}`), () => `${LAST[L.last] || ''}${L.sent ? ` · ${L.sent} shipped` : ''}`]);
    });
  }

  $('#inspector').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    const st = ui.sel != null ? byId(ui.sel) : null;
    if (!b || !st) return;
    if (b.dataset.act === 'unlink') st.links.splice(+b.dataset.i, 1);
    else if (b.dataset.act === 'route') { setTool('link'); ui.linkFrom = st.id; }
    else if (b.dataset.act === 'demolish') demolish(st);
    renderInspector(true);
  });

  function renderHUD() {
    $('#credits').textContent = `${Math.floor(world.credits)} cr`;
    $('#clock').textContent = fmtClock(world.t);
    $('#inflight').textContent = `${world.pods.length} pod${world.pods.length === 1 ? '' : 's'}`;
    let hint = '';
    const from = ui.linkFrom != null ? byId(ui.linkFrom) : null;
    switch (ui.tool) {
      case 'select': hint = 'Click a station to inspect it and see its launch windows. Drag to pan, scroll to zoom.'; break;
      case 'miner': hint = `Click an asteroid to build a Miner (${BUILD.miner.cost} cr). Grey is iron ore, blue is ice, tan is carbon.`; break;
      case 'refinery': hint = `Click an orbit to place a Refinery (${BUILD.refinery.cost} cr). It turns ore, ice and carbon into plates, fuel cells and graphite.`; break;
      case 'assembler': hint = `Click an orbit to place an Assembler (${BUILD.assembler.cost} cr). It joins two parts into one.`; break;
      case 'link': hint = from ? `Shipping from the ${TYPE_NAME[from.type]} on Orbit ${from.ring + 1}. Hover a station on another orbit to preview the transfer, click to set the route.` : 'Click the station that should ship cargo.'; break;
      case 'demolish': hint = 'Click a station to demolish it. You get half the cost back.'; break;
    }
    $('#hint').textContent = hint;
  }

  let toastBox = document.getElementById('toasts');
  function toast(msg, kind = '', ms = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    toastBox.appendChild(el);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
  }

  // ---------------------------------------------------------------- intro & persistence
  function openIntro() { $('#intro').hidden = false; ui.paused = true; refreshToolbar(); $('#start').focus(); }
  function closeIntro() {
    $('#intro').hidden = true;
    ui.paused = false;
    refreshToolbar();
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) { /* storage unavailable */ }
  }
  $('#rule-periods').textContent = `Orbit 1 laps the planet in ${fmtDur(PERIOD[0])}. Orbit 6 takes ${fmtDur(PERIOD[5])}.`;
  $('#help').addEventListener('click', openIntro);
  $('#start').addEventListener('click', closeIntro);
  let resetArmed = false;
  $('#reset').addEventListener('click', () => {
    if (!resetArmed) { resetArmed = true; $('#reset').textContent = 'Click again to wipe this factory'; return; }
    resetArmed = false;
    $('#reset').textContent = 'Restart from scratch';
    newWorld();
    Object.assign(cam, { zoom: 1, ox: 0, oy: 0 });
    Object.assign(ui, { sel: null, linkFrom: null });
    contractShown = -1;
    save();
    refreshToolbar();
    renderInspector(true);
    closeIntro();
  });

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(world)); } catch (_) { /* storage unavailable */ }
  }
  function load() {
    try {
      const w = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (w && w.v === 1 && Array.isArray(w.stations) && Array.isArray(w.pods)) return w;
    } catch (_) { /* ignore corrupt or blocked storage */ }
    return null;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // ---------------------------------------------------------------- main loop
  let last = performance.now(), acc = 0, uiClock = 0, saveClock = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!ui.paused) {
      acc += dt * WARPS[ui.warp];
      let guard = 0;
      while (acc >= STEP && guard++ < 120) { step(STEP); acc -= STEP; }
      if (guard >= 120) acc = 0;
    }
    draw();
    uiClock += dt;
    if (uiClock > 0.15) { uiClock = 0; renderHUD(); renderContract(); renderInspector(false); }
    saveClock += dt;
    if (saveClock > 5) { saveClock = 0; save(); }
    requestAnimationFrame(frame);
  }

  function start(data) {
    world = (data && data.world) || load() || newWorld();
    resize();
    window.addEventListener('resize', resize);
    refreshToolbar();
    renderHUD();
    renderContract();
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { /* storage unavailable */ }
    if (seen || (data && data.world)) $('#intro').hidden = true;
    else openIntro();
    window.claude?.hot?.snapshot?.(() => ({ world }));
    requestAnimationFrame(t => { last = t; frame(t); });
  }

  const hot = window.claude?.hot;
  if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});
})();
