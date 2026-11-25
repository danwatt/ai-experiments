/* ==========================================================================
   Renderer kit: everything the two 3D variants share that is not rules.

   - Mesh builders that return plain arrays (positions, normals, uvs,
     indices), so PlayCanvas and Babylon build identical shapes.
   - TileField: the animation brain. It turns engine transitions, drag
     previews, hints and nudges into a per-tile transform every frame.
     Renderers only create/destroy meshes and copy x/y/z/scale/alpha.
   - fitCamera: frames the board inside the part of the screen the HUD
     leaves free, for any engine that can project a point.
   ========================================================================== */
(function (root) {
'use strict';

const SQRT3 = Math.sqrt(3);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outQuart: t => 1 - Math.pow(1 - t, 4),
  inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  // Damped spring from 0 to 1, overshooting `bounces` times.
  spring: (t, bounces = 2, damping = 5) => 1 - Math.exp(-damping * t) * Math.cos(Math.PI * (bounces + 0.5) * t),
};

/* ---------- Geometry ---------- */

// Rounded regular hexagon outline. `rotation` 0 gives a flat-topped hexagon
// (vertex pointing along +x); PI/6 gives a pointy-topped one.
// Returns arrays of {x, z, nx, nz} going around once, plus arc centres.
function roundedHexOutline(radius, corner, segments, rotation = 0) {
  const pts = [];
  const centreDist = radius - corner * 2 / SQRT3;
  for (let k = 0; k < 6; k++) {
    const theta = rotation + k * Math.PI / 3;
    const cx = Math.cos(theta) * centreDist;
    const cz = Math.sin(theta) * centreDist;
    for (let s = 0; s <= segments; s++) {
      const phi = theta - Math.PI / 6 + (s / segments) * (Math.PI / 3);
      const nx = Math.cos(phi), nz = Math.sin(phi);
      pts.push({ cx, cz, nx, nz });
    }
  }
  return pts;
}

// A bevelled hexagonal prism standing on y = 0.
//   radius: circumradius, height, bevel: size of the rounded top edge,
//   corner: corner rounding radius (must be >= bevel), rotation as above.
//   uvScale: top cap UVs span [0,1] over a square of side 2*radius.
//   sideUV: [u, v] used for every non-top vertex (a plain-colour texel).
//   bottomBevel: optional rounded bottom edge too (for pieces that hop).
function hexPrism(o) {
  const radius = o.radius, height = o.height;
  const bevel = Math.min(o.bevel, height * 0.95);
  const corner = Math.max(o.corner, bevel + 1e-3);
  const segs = o.cornerSegments || 4;
  const bsegs = o.bevelSegments || 4;
  const rot = o.rotation || 0;
  const sideUV = o.sideUV || [0.5, 0.03];
  const outline = roundedHexOutline(radius, corner, segs, rot);
  const ringLen = outline.length;

  // Cross-section, bottom to top: [inset, y, normalOut, normalUp]
  const profile = [];
  const bb = o.bottomBevel ? Math.min(o.bottomBevel, height - bevel) : 0;
  if (bb > 0) {
    for (let j = 0; j <= bsegs; j++) {
      const a = -Math.PI / 2 + (j / bsegs) * (Math.PI / 2);
      profile.push([bb * (1 - Math.cos(a)), bb + bb * Math.sin(a), Math.cos(a), Math.sin(a)]);
    }
  } else {
    profile.push([0, 0, 1, 0]);
  }
  for (let j = 0; j <= bsegs; j++) {
    const a = (j / bsegs) * (Math.PI / 2);
    profile.push([bevel * (1 - Math.cos(a)), height - bevel + bevel * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }

  const positions = [], normals = [], uvs = [], indices = [];
  const ringStart = [];
  for (const [inset, y, no, nu] of profile) {
    ringStart.push(positions.length / 3);
    for (const p of outline) {
      const r = corner - inset;
      positions.push(p.cx + p.nx * r, y, p.cz + p.nz * r);
      normals.push(p.nx * no, nu, p.nz * no);
      uvs.push(sideUV[0], sideUV[1]);
    }
  }
  for (let k = 0; k < profile.length - 1; k++) {
    const a = ringStart[k], b = ringStart[k + 1];
    for (let i = 0; i < ringLen; i++) {
      const i2 = (i + 1) % ringLen;
      // counter-clockwise seen from outside, for a y-up right-handed world
      indices.push(a + i, b + i, a + i2, a + i2, b + i, b + i2);
    }
  }
  // Top cap: its own ring so it can carry the label UVs.
  const topY = height;
  const capCentre = positions.length / 3;
  const half = radius;
  positions.push(0, topY, 0); normals.push(0, 1, 0); uvs.push(0.5, 0.5);
  const capStart = positions.length / 3;
  for (const p of outline) {
    const r = corner - bevel;
    const x = p.cx + p.nx * r, z = p.cz + p.nz * r;
    positions.push(x, topY, z);
    normals.push(0, 1, 0);
    uvs.push(0.5 + x / (2 * half), 0.5 + z / (2 * half));
  }
  for (let i = 0; i < ringLen; i++) {
    const i2 = (i + 1) % ringLen;
    indices.push(capCentre, capStart + i2, capStart + i);
  }
  if (o.bottomCap) {
    const c = positions.length / 3;
    positions.push(0, 0, 0); normals.push(0, -1, 0); uvs.push(sideUV[0], sideUV[1]);
    const s = positions.length / 3;
    const r0 = profile[0][0];
    for (const p of outline) {
      const r = corner - r0;
      positions.push(p.cx + p.nx * r, profile[0][1], p.cz + p.nz * r);
      normals.push(0, -1, 0); uvs.push(sideUV[0], sideUV[1]);
    }
    for (let i = 0; i < ringLen; i++) indices.push(c, s + i, s + (i + 1) % ringLen);
  }
  return { positions, normals, uvs, indices };
}

// Flip triangle winding (for engines whose front face is the other way).
function flipWinding(mesh) {
  const idx = mesh.indices.slice();
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return Object.assign({}, mesh, { indices: idx });
}

// Thin ring (outline band) around a rounded hexagon, lying at height y.
function hexRing(o) {
  const outer = roundedHexOutline(o.radius, o.corner, o.cornerSegments || 4, o.rotation || 0);
  const positions = [], normals = [], uvs = [], indices = [];
  const n = outer.length;
  for (const p of outer) {
    const r1 = o.corner, r0 = o.corner - o.width;
    positions.push(p.cx + p.nx * r1, o.y || 0, p.cz + p.nz * r1);
    positions.push(p.cx + p.nx * r0, o.y || 0, p.cz + p.nz * r0);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(1, 0, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, normals, uvs, indices };
}

// World geometry of a board of the given radius (cells of circumradius 1).
function boardMetrics(radius, rim = 0.42) {
  // Corner cells sit sqrt(3)*R from the centre, toward the six slide
  // directions; the board outline is a pointy-topped hexagon around them.
  const apothem = 1.5 * radius + 1 + rim; // edge normals point between directions
  const circum = apothem * 2 / SQRT3;
  return { apothem, circum, rotation: Math.PI / 6 };
}

/* ---------- Text labels ---------- */

// Draws a tile face into a square canvas: background colour, then the
// number fitted to the hexagon's inner width. `style` callbacks let each
// variant add its own finish (engraving, glow...).
function tileCanvas(size, value, style) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  style.background(g, size, value);
  const text = String(value);
  const digits = text.length;
  const maxW = size * (digits <= 2 ? 0.5 : digits === 3 ? 0.58 : digits === 4 ? 0.64 : 0.68);
  let px = size * (digits <= 1 ? 0.5 : digits === 2 ? 0.44 : digits === 3 ? 0.34 : digits === 4 ? 0.27 : 0.22);
  g.font = `${style.weight || 700} ${px}px ${style.font}`;
  const w = g.measureText(text).width;
  if (w > maxW) { px *= maxW / w; g.font = `${style.weight || 700} ${px}px ${style.font}`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  style.text(g, text, size / 2, size / 2 + px * (style.baseline || 0.04), px, value);
  return c;
}

/* ---------- Tile animation ---------- */

// Timings in ms. Variants pass their own `feel` to tune the character.
const DEFAULT_FEEL = {
  slide: 125,        // every slide takes the same time, like classic 2048
  merge: 260,        // pop of the merged tile
  spawn: 280,
  spawnDelay: 60,    // after slides land
  vanish: 170,
  hop: 0.55,         // merge hop height (world units)
  drop: 1.6,         // spawn drop height
  squash: 0.22,
  previewStiffness: 32, // drag-follow smoothing (1/s)
};

class TileField {
  constructor(opts) {
    this.feel = Object.assign({}, DEFAULT_FEEL, opts.feel || {});
    this.onCreate = opts.onCreate;   // (vis) -> renderer object stored on vis.obj
    this.onRemove = opts.onRemove;   // (vis)
    this.tiles = new Map();
    this.topo = null;
    this.reduced = false;
    this.preview = null;             // { peek, dist, target }
    this.wiggle = null;              // hint / nudge: { dir, start, dur, amp, peek }
    this.pressure = new Map();       // id -> 0..1, partner of an arriving merge
  }

  setTopology(topo) {
    this.clear();
    this.topo = topo;
  }

  clear() {
    for (const vis of this.tiles.values()) this.onRemove(vis);
    this.tiles.clear();
    this.preview = null;
    this.wiggle = null;
  }

  cellPos(i) { const c = this.topo.cells[i]; return { x: c.x, z: c.z }; }

  dirVec(dir) {
    const d = (typeof HexCore !== 'undefined' ? HexCore : root.HexCore).DIRS[dir];
    // one step along dir in world units (distance between neighbour centres = sqrt 3)
    const q = d.dq, r = d.dr;
    const x = 1.5 * q, z = SQRT3 * (r + q / 2);
    const len = Math.hypot(x, z);
    return { x: x / len, z: z / len };
  }

  make(id, value, at, now) {
    const p = this.cellPos(at);
    const vis = {
      id, value, cell: at,
      x: p.x, z: p.z, y: 0, s: 1, sy: 1, alpha: 1, tilt: 0, visible: true,
      restX: p.x, restZ: p.z,
      slide: null, fx: null, removeAt: 0, born: now, glow: 0,
      offX: 0, offZ: 0,
    };
    vis.obj = this.onCreate(vis);
    this.tiles.set(id, vis);
    return vis;
  }

  remove(vis) {
    this.onRemove(vis);
    this.tiles.delete(vis.id);
  }

  // Finish everything in flight so a new transition starts from a clean,
  // well-defined state (positions are kept where they are on screen).
  settle(now) {
    for (const vis of [...this.tiles.values()]) {
      if (vis.removeAt) { this.remove(vis); continue; }
      if (vis.fx && vis.fx.start > now) vis.fx.start = now - vis.fx.dur; // pending pops appear at once
      vis.fx = null;
      vis.s = 1; vis.sy = 1; vis.y = 0; vis.alpha = 1; vis.visible = true;
    }
  }

  apply(tr, now) {
    if (!this.topo) return;
    const f = this.feel;
    const k = this.reduced ? 0.35 : 1;
    const slideMs = f.slide * k;
    // Bring preview offsets into the slide start so nothing jumps.
    for (const vis of this.tiles.values()) {
      vis.x = vis.restX + vis.offX; vis.z = vis.restZ + vis.offZ;
      vis.offX = vis.offZ = 0;
    }
    this.preview = null;
    this.wiggle = null;
    this.pressure.clear();
    this.settle(now);

    if (tr.type === 'reset' || tr.type === 'restore') {
      for (const vis of [...this.tiles.values()]) this.remove(vis);
      let n = 0;
      for (const t of tr.tiles) {
        const vis = this.make(t.id, t.value, t.to, now);
        vis.fx = { type: 'spawn', start: now + (tr.type === 'reset' ? 120 + n * 90 : n * 25) * k, dur: f.spawn * k };
        vis.visible = false;
        n++;
      }
      return;
    }

    const landAt = now + slideMs;
    for (const t of tr.tiles) {
      const vis = this.tiles.get(t.id);
      switch (t.kind) {
        case 'slide':
        case 'consume': {
          if (!vis) break;
          const to = this.cellPos(t.to);
          vis.slide = { fx: vis.x, fz: vis.z, tx: to.x, tz: to.z, start: now, dur: slideMs };
          vis.cell = t.to; vis.restX = to.x; vis.restZ = to.z;
          if (t.kind === 'consume') vis.removeAt = landAt;
          break;
        }
        case 'merge': {
          const nv = this.make(t.id, t.value, t.to, now);
          nv.visible = false;
          nv.fx = { type: 'merge', start: landAt, dur: f.merge * k };
          break;
        }
        case 'spawn': {
          const nv = this.make(t.id, t.value, t.to, now);
          nv.visible = false;
          nv.fx = { type: 'spawn', start: landAt + f.spawnDelay * k, dur: f.spawn * k };
          break;
        }
        case 'split': {
          // Undo: a merged pair comes apart from where they fused.
          const nv = this.make(t.id, t.value, t.to, now);
          const from = this.cellPos(t.from), to = this.cellPos(t.to);
          nv.x = from.x; nv.z = from.z;
          nv.slide = { fx: from.x, fz: from.z, tx: to.x, tz: to.z, start: now, dur: slideMs };
          nv.fx = { type: 'split', start: now, dur: slideMs };
          break;
        }
        case 'vanish': {
          if (!vis) break;
          vis.fx = { type: 'vanish', start: now, dur: f.vanish * k };
          vis.removeAt = now + f.vanish * k;
          break;
        }
      }
    }
  }

  // Drag-follow: peek is game.peek(dir) (or null to release), dist is how
  // far the finger has travelled along dir, in world units. Every tile moves
  // with the finger until it reaches the cell the move would put it in.
  setPreview(peek, dist) {
    if (!peek) { this.preview = null; this.pressure.clear(); return; }
    this.preview = { peek, dist };
  }

  // Hint: tiles lean toward the suggested direction twice.
  hint(peek, now) {
    this.wiggle = { peek, start: now, dur: this.reduced ? 500 : 1100, amp: 0.42, cycles: 2 };
  }

  // Blocked move: everything bumps against the wall.
  nudge(dir, now) {
    this.wiggle = { dir, start: now, dur: 220, amp: 0.12, cycles: 1 };
  }

  update(now, dt) {
    const f = this.feel;
    const stiff = 1 - Math.exp(-f.previewStiffness * dt);
    // Preview targets, per tile.
    const target = new Map();
    let wiggleT = 0, wiggleAmp = 0;
    if (this.wiggle) {
      const w = this.wiggle;
      const t = (now - w.start) / w.dur;
      if (t >= 1) this.wiggle = null;
      else { wiggleT = t; wiggleAmp = w.amp * Math.sin(Math.PI * t * w.cycles * 2 - Math.PI / 2) * 0.5 + w.amp * 0.5; wiggleAmp *= Math.sin(Math.PI * t); }
    }
    const pv = this.preview;
    if (pv && pv.peek) {
      const v = this.dirVec(pv.peek.dir);
      if (pv.peek.moved) {
        for (const m of pv.peek.moves) {
          const a = this.cellPos(m.from), b = this.cellPos(m.to);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const d = Math.min(pv.dist, len);
          target.set(m.id, { x: v.x * d, z: v.z * d, arrive: len > 0 ? d / len : 1, consumed: m.consumed, to: m.to });
        }
      } else {
        // Nothing can move that way: everything strains a little and stops.
        const d = 0.14 * (1 - Math.exp(-pv.dist / 0.4));
        for (const vis of this.tiles.values()) target.set(vis.id, { x: v.x * d, z: v.z * d, arrive: 0 });
      }
    } else if (this.wiggle) {
      const w = this.wiggle;
      const peek = w.peek;
      if (peek && peek.moved) {
        const v = this.dirVec(peek.dir);
        for (const m of peek.moves) {
          const a = this.cellPos(m.from), b = this.cellPos(m.to);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const d = Math.min(wiggleAmp * 2.2, len);
          target.set(m.id, { x: v.x * d, z: v.z * d, arrive: 0 });
        }
      } else if (w.dir !== undefined) {
        const v = this.dirVec(w.dir);
        for (const vis of this.tiles.values()) target.set(vis.id, { x: v.x * wiggleAmp, z: v.z * wiggleAmp, arrive: 0 });
      }
    }
    // Partners of tiles about to merge into them swell slightly.
    const swell = new Map();
    if (pv && pv.peek && pv.peek.moved) {
      for (const m of pv.peek.moves) {
        if (!m.consumed) continue;
        const t = target.get(m.id);
        if (t && t.arrive > 0.85) {
          for (const o of pv.peek.moves) if (o.consumed && o.to === m.to && o.id !== m.id) swell.set(o.id, 1);
        }
      }
    }

    for (const vis of [...this.tiles.values()]) {
      if (vis.removeAt && now >= vis.removeAt) { this.remove(vis); continue; }
      // Base position: slide or rest.
      let bx = vis.restX, bz = vis.restZ;
      if (vis.slide) {
        const s = vis.slide;
        const t = clamp((now - s.start) / s.dur, 0, 1);
        const e = ease.outCubic(t);
        bx = lerp(s.fx, s.tx, e); bz = lerp(s.fz, s.tz, e);
        if (t >= 1) vis.slide = null;
      }
      const tg = target.get(vis.id);
      const tx = tg ? tg.x : 0, tz = tg ? tg.z : 0;
      vis.offX += (tx - vis.offX) * stiff;
      vis.offZ += (tz - vis.offZ) * stiff;
      if (Math.abs(vis.offX) < 1e-4) vis.offX = 0;
      if (Math.abs(vis.offZ) < 1e-4) vis.offZ = 0;
      vis.x = bx + vis.offX;
      vis.z = bz + vis.offZ;
      // Lean into the drag a touch.
      vis.tilt = tg ? clamp(Math.hypot(tx, tz), 0, 1) : 0;

      // Effects.
      let y = 0, s = 1, sy = 1, alpha = 1, visible = true;
      const sw = swell.get(vis.id);
      vis.glow += ((sw ? 1 : 0) - vis.glow) * stiff;
      s *= 1 + 0.06 * vis.glow;
      const fx = vis.fx;
      if (fx) {
        const t = (now - fx.start) / fx.dur;
        if (t < 0) {
          visible = fx.type === 'vanish' || fx.type === 'split';
        } else if (t >= 1) {
          vis.fx = null;
        } else if (fx.type === 'merge') {
          const hop = this.reduced ? 0 : f.hop;
          y = hop * 4 * t * (1 - t);
          s = 0.7 + 0.3 * ease.outBack(Math.min(1, t * 1.6), 2.2);
          // squash on landing
          const land = clamp((t - 0.75) / 0.25, 0, 1);
          sy = 1 - f.squash * Math.sin(Math.PI * land) * (this.reduced ? 0 : 1);
          s *= 1 + (1 - sy) * 0.5;
        } else if (fx.type === 'spawn') {
          if (this.reduced) {
            s = ease.outCubic(t); alpha = t;
          } else {
            const fall = clamp(t / 0.55, 0, 1);
            y = f.drop * (1 - fall * fall);
            alpha = clamp(t * 4, 0, 1);
            s = 0.55 + 0.45 * ease.outCubic(clamp(t * 1.8, 0, 1));
            const land = clamp((t - 0.55) / 0.45, 0, 1);
            sy = 1 - f.squash * 1.2 * Math.sin(Math.PI * land) * Math.exp(-2 * land);
          }
        } else if (fx.type === 'vanish') {
          s = 1 - ease.outCubic(t);
          alpha = 1 - t;
        } else if (fx.type === 'split') {
          s = 0.75 + 0.25 * ease.outCubic(t);
        }
      }
      vis.y = y; vis.s = s; vis.sy = sy; vis.alpha = alpha; vis.visible = visible;
      vis.age = now - vis.born;
    }
  }

  get busy() {
    for (const vis of this.tiles.values()) if (vis.slide || vis.fx || vis.removeAt) return true;
    return !!(this.preview || this.wiggle);
  }
}

/* ---------- Camera framing ---------- */

// Iteratively adjusts camera distance and target so that `points` (world
// [x, y, z]) fill the free screen rectangle. Engine-agnostic: the caller
// supplies `apply(dist, tx, tz)` and `project([x,y,z]) -> {x, y}` in CSS px.
function fitCamera(o) {
  const { width, height, insets, points, project, apply, pad = 12 } = o;
  const free = {
    l: insets.left + pad, r: width - insets.right - pad,
    t: insets.top + pad, b: height - insets.bottom - pad,
  };
  const fw = Math.max(40, free.r - free.l), fh = Math.max(40, free.b - free.t);
  const cx = (free.l + free.r) / 2, cy = (free.t + free.b) / 2;
  let dist = o.dist, tx = o.tx || 0, tz = o.tz || 0;
  for (let k = 0; k < 6; k++) {
    apply(dist, tx, tz);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      const s = project(p);
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    const bw = maxX - minX, bh = maxY - minY;
    const scale = Math.max(bw / fw, bh / fh);
    const ex = cx - (minX + maxX) / 2, ey = cy - (minY + maxY) / 2;
    // px per world unit near the board, measured from the box itself
    const ppu = bw / (o.worldWidth || 1);
    tx -= ex / ppu;
    tz -= ey / ppu / (o.verticalSquash || 1);
    dist = clamp(dist * scale, o.minDist || 1, o.maxDist || 500);
  }
  apply(dist, tx, tz);
  return { dist, tx, tz };
}

/* ---------- Colour helpers ---------- */

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], t) * 255));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Deterministic pseudo-random for procedural textures.
function hashRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

root.HexKit = {
  SQRT3, TAU, clamp, lerp, ease, roundedHexOutline, hexPrism, hexRing, flipWinding,
  boardMetrics, tileCanvas, TileField, fitCamera, hexToRgb, mixHex, hashRand, DEFAULT_FEEL,
};
})(typeof self !== 'undefined' ? self : this);
