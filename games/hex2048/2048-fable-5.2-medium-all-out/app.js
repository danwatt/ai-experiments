/* ==========================================================================
   Facet: presentation. Board view, input, sound, bot, replays, stats.
   ========================================================================== */
(function () {
'use strict';

const { SQRT3, DIRS, BOARDS, MODES, exponent, buildTopology, Game, suggestMove, encodeReplay, decodeReplay } = window.Facet;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString();
const f = n => +n.toFixed(4);
const pct = n => f(n * 100) + '%';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const SLIDE_MS = 130;
const SPEEDS = ['½×', '1×', '3×']; // bot and replay pace

// Board geometry, in units of one hex radius.
const RIM = 0.3;        // board border beyond the outer cells
const ARROW = 0.42;     // arrow button radius
const ARROW_GAP = 0.16; // space between the board rim and the arrows

// Physical key positions, so the cluster works on any layout:
//   Q W E      up-left  up  up-right
//   A S D    down-left down down-right
const KEY_CODES = ['KeyW', 'KeyE', 'KeyD', 'KeyS', 'KeyA', 'KeyQ'];
const KEYMAP = {
  KeyW: 0, KeyE: 1, KeyD: 2, KeyS: 3, KeyA: 4, KeyQ: 5,
  KeyI: 0, KeyO: 1, KeyL: 2, KeyK: 3, KeyJ: 4, KeyU: 5,
  Numpad8: 0, Numpad9: 1, Numpad3: 2, Numpad2: 3, Numpad1: 4, Numpad7: 5,
  ArrowUp: 0, ArrowDown: 3,
};
let keyLabels = ['W', 'E', 'D', 'S', 'A', 'Q'];

const ICONS = {
  soundOn: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  soundOff: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4.5M9.5 13v1.5M14.5 13v1.5"/><circle cx="12" cy="3.5" r="1"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/>',
};
const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

/* ---------- Gems ---------- */

// Face colour by exponent: a walk round the spectrum from mist to violet,
// then into deep night for the tiles past 2048.
const PALETTE = [
  '#8d94b0',
  '#e9edf8', // 2
  '#c9e0fa', // 4
  '#97d6f2', // 8
  '#57c7d9', // 16
  '#3cc0a0', // 32
  '#7dcf58', // 64
  '#e6cf3c', // 128
  '#f6a637', // 256
  '#f1703f', // 512
  '#e2457a', // 1024
  '#a24be3', // 2048
  '#5c47dc', // 4096
  '#2c3ca6', // 8192
  '#1f2350', // 16384
  '#15141c', // 32768 and beyond
];
const STONE = '#6c7391';

function mix(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((x >> s) & 255) + ((((y >> s) & 255) - ((x >> s) & 255)) * t));
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const HEXV = Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
const hexPoints = (s, cx = 0, cy = 0) => HEXV.map(([x, y]) => f(cx + x * s) + ',' + f(cy + y * s)).join(' ');

// A cut gem seen from above: a rounded girdle, six bevel facets lit from the
// upper left, and a flat table on top where the number sits. Drawn inside a
// flat-topped hexagon of radius 1 centred on (cx, cy).
function gemShapes(face, cx = 0, cy = 0, size = 0.9) {
  const rim = mix(face, '#ffffff', 0.28);
  const lip = mix(face, '#141a4a', 0.36);
  const R = size - 0.07, T = size * 0.66;
  const y = cy - 0.03;
  let s = `<polygon points="${hexPoints(R, cx, y + 0.06)}" fill="${lip}" stroke="${lip}" stroke-width=".15" stroke-linejoin="round"/>` +
    `<polygon points="${hexPoints(R, cx, y)}" fill="${rim}" stroke="${rim}" stroke-width=".14" stroke-linejoin="round"/>`;
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = HEXV[k], [bx, by] = HEXV[(k + 1) % 6];
    const lit = Math.cos(((30 + 60 * k + 115) * Math.PI) / 180); // light from the upper left
    const fill = lit > 0 ? mix(face, '#ffffff', 0.5 * lit) : mix(face, '#141a4a', -0.24 * lit);
    s += `<polygon points="${f(cx + ax * R)},${f(y + ay * R)} ${f(cx + bx * R)},${f(y + by * R)} ${f(cx + bx * T)},${f(y + by * T)} ${f(cx + ax * T)},${f(y + ay * T)}" fill="${fill}"/>`;
  }
  return s + `<polygon points="${hexPoints(T, cx, y)}" fill="${face}"/>` +
    `<polygon points="${hexPoints(T, cx, y)}" fill="url(#tableShine)"/>`;
}

const gemSvg = (face, cls = '') =>
  `<svg viewBox="-1 -0.866 2 1.732" aria-hidden="true" class="${cls}">${gemShapes(face)}</svg>`;

const tileLook = (() => {
  const cache = new Map();
  return value => {
    if (!cache.has(value)) {
      const face = PALETTE[Math.min(exponent(value), PALETTE.length - 1)];
      const e = exponent(value);
      const ink = e >= 14 ? '#ffd65a' : luminance(face) > 0.6 ? mix(face, '#0b1030', 0.78) : '#ffffff';
      cache.set(value, { face, ink, svg: gemSvg(face) });
    }
    return cache.get(value);
  };
})();

function paintGem(el, value) {
  const look = tileLook(value);
  el.style.setProperty('--ink-t', look.ink);
  el.dataset.d = String(value).length;
  el.innerHTML = look.svg + '<b></b>';
  el.lastChild.textContent = value;
}

// Flat-topped hexagon path with rounded corners (for the board plate).
function hexPath(cx, cy, radius, corner = 0) {
  let d = '';
  if (!corner) {
    for (let k = 0; k < 6; k++) d += (k ? 'L' : 'M') + f(cx + radius * HEXV[k][0]) + ' ' + f(cy + radius * HEXV[k][1]);
    return d + 'Z';
  }
  const rc = corner * radius;
  const reach = radius - rc / Math.cos(Math.PI / 6);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const ax = cx + reach * Math.cos(a), ay = cy + reach * Math.sin(a);
    const t0 = a - Math.PI / 6, t1 = a + Math.PI / 6;
    d += (k ? 'L' : 'M') + f(ax + rc * Math.cos(t0)) + ' ' + f(ay + rc * Math.sin(t0)) +
      'A' + f(rc) + ' ' + f(rc) + ' 0 0 1 ' + f(ax + rc * Math.cos(t1)) + ' ' + f(ay + rc * Math.sin(t1));
  }
  return d + 'Z';
}

// Fits board, rim and the six arrows into one box centred on the middle cell.
function computeLayout(topo) {
  const arrows = DIRS.map(d => {
    const a = (d.angle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    // Every slide direction is perpendicular to a hex edge, so the board's
    // extent that way is the farthest centre plus one apothem.
    const extent = Math.max(...topo.cells.map(c => c.x * ux + c.y * uy)) + SQRT3 / 2;
    const dist = extent + RIM + ARROW_GAP + ARROW;
    return { x: ux * dist, y: uy * dist };
  });
  let hw = 0, hh = 0;
  for (const c of topo.cells) {
    hw = Math.max(hw, Math.abs(c.x) + 1 + RIM);
    hh = Math.max(hh, Math.abs(c.y) + SQRT3 / 2 + RIM);
  }
  const outer = ARROW + (finePointer.matches ? 0.26 : 0); // room for key badges
  for (const p of arrows) {
    hw = Math.max(hw, Math.abs(p.x) + outer);
    hh = Math.max(hh, Math.abs(p.y) + outer);
  }
  hw += 0.12;
  hh += 0.12;
  return { w: hw * 2, h: hh * 2, cx: hw, cy: hh, arrows };
}

function shapeIcon(board) {
  const topo = buildTopology(board.radius);
  const d = topo.cells.map(c => hexPath(c.x, c.y, 0.82, 0.2)).join('');
  return `<svg viewBox="-6.2 -6.4 12.4 12.8" aria-hidden="true"><path d="${d}"/></svg>`;
}

const arrowIcon = angle =>
  `<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-6.5 0H6M1.5-5 6.5 0 1.5 5" transform="rotate(${angle})"/></svg>`;

/* ---------- Storage ---------- */

const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('facet:' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('facet:' + key, JSON.stringify(value)); } catch (e) { /* full or blocked */ }
  },
  remove(key) {
    try { localStorage.removeItem('facet:' + key); } catch (e) { /* blocked */ }
  },
};

/* ---------- Sound: synthesised glass, no audio files ---------- */

const Sound = {
  enabled: true,
  ctx: null,
  out: null,

  wake() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.5;
        this.out.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) { return null; }
  },

  tone(freq, { at = 0, dur = 0.15, type = 'sine', gain = 0.12, bend = 1, attack = 0.008 } = {}) {
    const ctx = this.wake();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },

  // A struck-glass note: fundamental plus two inharmonic partials that die fast.
  chime(freq, at = 0, gain = 0.12) {
    this.tone(freq, { at, dur: 0.42, gain });
    this.tone(freq * 2.76, { at, dur: 0.16, gain: gain * 0.28 });
    this.tone(freq * 5.4, { at, dur: 0.07, gain: gain * 0.14 });
  },

  // Pentatonic ladder: bigger merges ring higher.
  pitch(value) {
    const steps = [0, 2, 4, 7, 9];
    const k = Math.max(0, exponent(value) - 2);
    return 293.66 * Math.pow(2, (steps[k % 5] + 12 * Math.floor(k / 5)) / 12);
  },

  slide(quiet) { this.tone(170, { dur: 0.07, type: 'triangle', gain: quiet ? 0.025 : 0.05, bend: 0.65 }); },
  merge(value, count, quiet) {
    const p = this.pitch(value), g = quiet ? 0.05 : 0.11;
    this.chime(p, 0.07, g);
    if (count > 1) this.chime(p * 1.5, 0.12, g * 0.6);
    if (count > 2) this.chime(p * 2, 0.17, g * 0.5);
  },
  bump() { this.tone(92, { dur: 0.12, gain: 0.1, bend: 0.7 }); },
  undo() { this.tone(540, { dur: 0.1, type: 'triangle', gain: 0.05, bend: 0.6 }); },
  tick() { this.tone(880, { dur: 0.05, type: 'square', gain: 0.02 }); },
  badge() { [0, 7, 12].forEach((s, i) => this.chime(587.33 * Math.pow(2, s / 12), i * 0.08, 0.09)); },
  win() { [0, 4, 7, 12, 16].forEach((s, i) => this.chime(392 * Math.pow(2, s / 12), i * 0.09, 0.1)); },
  lose() { [7, 3, 0].forEach((s, i) => this.tone(220 * Math.pow(2, s / 12), { at: i * 0.17, dur: 0.45, gain: 0.09, bend: 0.97 })); },
};

const buzz = ms => {
  try {
    const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    if (active && navigator.vibrate) navigator.vibrate(ms);
  } catch (e) { /* unsupported */ }
};

/* ---------- Particles ---------- */

// Shards that fly off a merge. One canvas over the stage, drawn only while
// something is in the air.
const Sparks = {
  canvas: null, ctx: null, bits: [], running: false, w: 0, h: 0, dpr: 1,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  },
  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = box.width;
    this.h = box.height;
    this.canvas.width = Math.round(box.width * this.dpr);
    this.canvas.height = Math.round(box.height * this.dpr);
  },
  // x, y in canvas CSS pixels; size is the cell radius in pixels.
  burst(x, y, color, count, size, delay) {
    if (reducedMotion.matches || !this.ctx) return;
    const light = mix(color, '#ffffff', 0.55);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.05 + Math.random() * 0.13) * size;
      this.bits.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.03 * size,
        r: (0.07 + Math.random() * 0.1) * size, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.5,
        c: Math.random() < 0.4 ? light : color, life: -delay / 16.7, max: 26 + Math.random() * 18, g: size * 0.006,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }
  },
  frame(now) {
    const k = Math.min(3, (now - this.last) / 16.7);
    this.last = now;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.bits = this.bits.filter(p => p.life < p.max);
    for (const p of this.bits) {
      p.life += k;
      if (p.life < 0) continue;
      p.vy += p.g * k;
      p.vx *= Math.pow(0.95, k);
      p.vy *= Math.pow(0.95, k);
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.spin * k;
      const t = p.life / p.max;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = p.rot + (i * Math.PI * 2) / 3;
        ctx.lineTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r * (i ? 0.7 : 1.2));
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.bits.length) requestAnimationFrame(t => this.frame(t));
    else this.running = false;
  },
};

function confetti(originEl) {
  if (reducedMotion.matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const box = originEl.getBoundingClientRect();
  const ox = box.left + box.width / 2, oy = box.top + box.height * 0.42;
  const colors = [3, 5, 6, 7, 8, 10, 11, 12].map(e => PALETTE[e]);
  const bits = Array.from({ length: 130 }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 10;
    return {
      x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5,
      r: 4 + Math.random() * 6, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0],
    };
  });
  const start = performance.now();
  let last = start;
  const frame = now => {
    const k = Math.min(3, (now - last) / 16.7);
    const life = (now - start) / 2800;
    last = now;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - life * life);
    for (const p of bits) {
      p.vy += 0.32 * k;
      p.vx *= Math.pow(0.985, k);
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.spin * k;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = p.rot + (i * Math.PI) / 3;
        ctx.lineTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r * 0.8);
      }
      ctx.fill();
    }
    if (life < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/* ---------- Board view: SVG board, DOM tiles, arrows ---------- */

class BoardView {
  constructor() {
    this.stage = $('stage');
    this.svg = $('boardSvg');
    this.layer = $('tiles');
    this.els = new Map();  // tile id -> element
    this.pos = new Map();  // tile id -> cell index
    this.ghosts = [];      // merged-away tiles still sliding into place
    this.dragged = [];     // tile ids displaced by a drag in progress
    this.ghostTimer = 0;
    this.hintTimer = 0;
    this.quiet = false;    // replay scrubbing: no particles
    Sparks.init($('fx'));
    this.arrows = DIRS.map((d, i) => {
      const b = document.createElement('button');
      const a = (d.angle * Math.PI) / 180;
      b.type = 'button';
      b.className = 'arrow';
      b.dataset.dir = i;
      b.setAttribute('aria-label', 'Slide ' + d.name);
      b.style.setProperty('--ux', f(Math.cos(a)));
      b.style.setProperty('--uy', f(Math.sin(a)));
      b.innerHTML = arrowIcon(d.angle) + '<kbd aria-hidden="true"></kbd>';
      $('arrows').appendChild(b);
      return b;
    });
    this.labelArrows();
    const measure = () => this.measure();
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(this.stage);
    else window.addEventListener('resize', measure);
  }

  labelArrows() {
    this.arrows.forEach((b, i) => {
      b.title = `Slide ${DIRS[i].name} (${keyLabels[i]})`;
      b.querySelector('kbd').textContent = keyLabels[i];
    });
  }

  setBoard(game) {
    const topo = (this.topo = game.topo);
    this.goal = game.goal;
    const L = (this.layout = computeLayout(topo));
    const s = this.stage.style;
    s.setProperty('--ar', f(L.w / L.h));
    s.setProperty('--tile-l', pct((L.cx - 1) / L.w));
    s.setProperty('--tile-t', pct((L.cy - SQRT3 / 2) / L.h));
    s.setProperty('--tile-w', pct(2 / L.w));
    s.setProperty('--tile-h', pct(SQRT3 / L.h));

    let plate = '', sockets = '', inner = '', stones = '';
    topo.cells.forEach((c, i) => {
      const x = L.cx + c.x, y = L.cy + c.y;
      plate += hexPath(x, y, 1);
      if (topo.blocked[i]) {
        stones += gemShapes(STONE, x, y, 0.93);
      } else {
        sockets += hexPath(x, y, 0.9, 0.16);
        inner += hexPath(x, y + 0.04, 0.84, 0.16);
      }
    });
    this.svg.setAttribute('viewBox', `0 0 ${f(L.w)} ${f(L.h)}`);
    this.svg.innerHTML =
      '<defs><linearGradient id="tableShine" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>' +
      `<path class="plate-edge" d="${plate}" stroke-width="${f(RIM * 2 + 0.12)}"/>` +
      `<path class="plate" d="${plate}" stroke-width="${f(RIM * 2)}"/>` +
      `<path class="socket" d="${sockets}"/><path class="socket-in" d="${inner}"/>${stones}`;

    L.arrows.forEach((p, i) => {
      this.arrows[i].style.left = pct((L.cx + p.x) / L.w);
      this.arrows[i].style.top = pct((L.cy + p.y) / L.h);
    });
    this.measure();
  }

  measure() {
    if (!this.layout) return;
    const w = this.stage.getBoundingClientRect().width;
    if (w) this.stage.style.setProperty('--cell', f(w / this.layout.w) + 'px');
    Sparks.resize();
  }

  cellPx() {
    return this.layout ? this.stage.getBoundingClientRect().width / this.layout.w : 40;
  }

  // Percentages of the tile's own 2 x sqrt(3) box.
  at(x, y) { return `translate(${f(50 * x)}%, ${f((100 * y) / SQRT3)}%)`; }
  place(i) { const c = this.topo.cells[i]; return this.at(c.x, c.y); }

  makeTile(value, cell, cls) {
    const el = document.createElement('div');
    el.className = cls ? 'tile ' + cls : 'tile';
    el.style.transform = this.place(cell);
    if (value >= 2048 || (this.goal && value >= this.goal)) {
      el.classList.add('glow');
      el.style.setProperty('--glow', tileLook(value).face + 'b0');
    }
    const gem = document.createElement('div');
    gem.className = 'gem';
    paintGem(gem, value);
    el.appendChild(gem);
    this.layer.appendChild(el);
    return el;
  }

  add(id, value, cell, cls) {
    const el = this.makeTile(value, cell, cls);
    this.els.set(id, el);
    this.pos.set(id, cell);
    return el;
  }

  // Redraws every tile from scratch: new game, undo, board switch, scrubbing.
  renderAll(cells, mode) {
    this.settle();
    this.dragged = [];
    this.layer.classList.remove('dragging');
    this.layer.style.transform = '';
    this.layer.replaceChildren();
    this.els.clear();
    this.pos.clear();
    let n = 0;
    cells.forEach((t, i) => {
      if (!t) return;
      const el = this.add(t.id, t.value, i, mode);
      if (mode === 'deal') el.style.setProperty('--i', n++);
    });
  }

  animate(result) {
    this.settle();
    this.dragged = [];
    this.layer.classList.remove('dragging');
    this.layer.style.transform = '';
    for (const el of this.els.values()) el.classList.remove('spawn', 'merged', 'restore', 'deal');
    for (const m of result.moves) {
      const el = this.els.get(m.id);
      if (!el) continue;
      el.style.transform = this.place(m.to);
      this.pos.set(m.id, m.to);
    }
    for (const m of result.merges) {
      for (const id of m.from) {
        const el = this.els.get(id);
        if (!el) continue;
        this.els.delete(id);
        this.pos.delete(id);
        el.classList.add('ghost');
        this.ghosts.push(el);
      }
      this.add(m.id, m.value, m.at, 'merged');
      if (m.value >= 16) this.sparkle(m.value, m.at);
    }
    const s = result.spawned;
    if (s) this.add(s.id, s.value, s.at, 'spawn');
    if (this.ghosts.length) {
      this.ghostTimer = setTimeout(() => this.settle(), reducedMotion.matches ? 0 : SLIDE_MS + 130);
    }
  }

  // Drops merged-away tiles immediately, so a fast next move starts clean.
  settle() {
    clearTimeout(this.ghostTimer);
    for (const el of this.ghosts) el.remove();
    this.ghosts = [];
  }

  // Merge flourish: an expanding ring and a spray of shards.
  sparkle(value, cell) {
    if (reducedMotion.matches || this.quiet) return;
    const face = tileLook(value).face;
    const el = document.createElement('div');
    el.className = 'tile fxring';
    el.style.transform = this.place(cell);
    el.innerHTML = `<div class="ring"><svg viewBox="-1 -0.866 2 1.732"><polygon points="${hexPoints(0.9)}" fill="${face}"/></svg></div>`;
    el.firstChild.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 1500);
    this.layer.appendChild(el);

    const c = this.topo.cells[cell], L = this.layout, px = this.cellPx();
    const box = this.stage.getBoundingClientRect(), fxBox = Sparks.canvas.getBoundingClientRect();
    const x = (L.cx + c.x) * px + (box.left - fxBox.left), y = (L.cy + c.y) * px + (box.top - fxBox.top);
    Sparks.burst(x, y, face, Math.min(26, 4 + exponent(value) * 2), px, SLIDE_MS * 0.8);
  }

  // Drag in progress: slide every tile part of the way toward where the
  // move would put it. `result` comes from Game.preview().
  drag(result, t) {
    this.layer.classList.add('dragging');
    this.layer.style.transform = '';
    this.dragged = result.moves.map(m => m.id);
    for (const m of result.moves) {
      const el = this.els.get(m.id);
      if (!el) continue;
      const a = this.topo.cells[m.from], b = this.topo.cells[m.to];
      el.style.transform = this.at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }

  // Nothing can move that way: lean the whole layer a little instead.
  lean(dir, t) {
    const a = (DIRS[dir].angle * Math.PI) / 180;
    this.layer.style.transform =
      `translate(calc(var(--cell) * ${f(Math.cos(a) * 0.1 * t)}), calc(var(--cell) * ${f(Math.sin(a) * 0.1 * t)}))`;
  }

  // Lets go of a drag; tiles glide back to their cells.
  release() {
    this.layer.classList.remove('dragging');
    this.layer.style.transform = '';
    for (const id of this.dragged) {
      const el = this.els.get(id);
      if (el && this.pos.has(id)) el.style.transform = this.place(this.pos.get(id));
    }
    this.dragged = [];
  }

  aim(dir) {
    this.arrows.forEach((a, i) => a.classList.toggle('preview', i === dir));
  }

  // Blocked move: bump the tiles toward the wall and back.
  nudge(dir) {
    const a = (DIRS[dir].angle * Math.PI) / 180;
    this.layer.style.setProperty('--nx', `calc(var(--cell) * ${f(Math.cos(a) * 0.12)})`);
    this.layer.style.setProperty('--ny', `calc(var(--cell) * ${f(Math.sin(a) * 0.12)})`);
    this.layer.classList.remove('nudge');
    void this.layer.offsetWidth;
    this.layer.classList.add('nudge');
  }

  pulse(dir, delay = 0) {
    const a = this.arrows[dir];
    a.classList.remove('pulse');
    void a.offsetWidth;
    a.style.animationDelay = delay ? delay + 'ms' : '';
    a.classList.add('pulse');
    a.addEventListener('animationend', () => { a.classList.remove('pulse'); a.style.animationDelay = ''; }, { once: true });
  }

  setIdle(valid) {
    this.arrows.forEach((a, i) => a.classList.toggle('idle', !valid[i]));
  }

  showHint(dir) {
    this.clearHint();
    this.arrows[dir].classList.add('hint');
    this.hintTimer = setTimeout(() => this.clearHint(), 2600);
  }

  clearHint() {
    clearTimeout(this.hintTimer);
    this.arrows.forEach(a => a.classList.remove('hint'));
  }
}

/* ---------- Small UI helpers ---------- */

let toastTimer = 0;
function toast(message, ms = 2200) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function announce(message) {
  const el = $('announcer');
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 40);
}

const clockText = ms => {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

/* ---------- Badges ---------- */

const BADGES = [
  { id: 't256',    tile: 256,   name: 'Rough cut',     text: 'Make a 256 tile.' },
  { id: 't1024',   tile: 1024,  name: 'Brilliant',     text: 'Make a 1024 tile.' },
  { id: 't2048',   tile: 2048,  name: 'Flawless',      text: 'Make a 2048 tile.' },
  { id: 't4096',   tile: 4096,  name: 'Beyond',        text: 'Make a 4096 tile.' },
  { id: 'combo3',  tile: 32,    name: 'Triple cut',    text: 'Fuse three pairs with one move.' },
  { id: 'combo5',  tile: 64,    name: 'Cascade',       text: 'Fuse five pairs with one move.' },
  { id: 'full',    tile: 8,     name: 'Tight setting', text: 'Make a move with every cell full.' },
  { id: 'pocket',  tile: 128,   name: 'Pocket watch',  text: 'Win on the Pocket board.' },
  { id: 'classic', tile: 2048,  name: 'Honeycomb',     text: 'Win on the Classic board.' },
  { id: 'grand',   tile: 4096,  name: 'Grand tour',    text: 'Win on the Grand board.' },
  { id: 'stones',  tile: 0,     name: 'Stonecutter',   text: 'Win a game of Stones.' },
  { id: 'pure',    tile: 16,    name: 'No take-backs', text: 'Win without using undo.' },
  { id: 'rush',    tile: 512,   name: 'Quick hands',   text: 'Score 2,500 in Classic Rush.' },
  { id: 'regular', tile: 4,     name: 'Regular',       text: 'Play ten games.' },
];

/* ---------- App ---------- */

const App = {
  games: new Map(),
  board: null,
  mode: null,
  game: null,
  view: null,
  stats: null,
  card: null,       // 'won' | 'over' | null
  cardTimer: 0,
  flashedBest: false,
  auto: { on: false, speed: 1, timer: 0 },
  replay: null,     // { board, mode, seed, log, game, idx, playing, speed, timer, link }
  clockTimer: 0,
  clockLast: 0,
  confirmTimer: 0,

  get key() { return this.board.id + ':' + this.mode.id; },
  get shown() { return this.replay ? this.replay.game : this.game; },

  init() {
    const prefs = Store.get('prefs', {});
    Sound.enabled = prefs.sound !== false;
    this.stats = Object.assign({ keys: {}, moves: 0, merges: 0, badges: {} }, Store.get('stats', {}));
    $('logo').innerHTML = gemShapes(PALETTE[11], 0, 0, 1);

    this.view = new BoardView();
    this.buildPickers();
    this.buildKeys();
    this.renderToggles();
    this.localiseKeys();

    $('undoBtn').addEventListener('click', () => this.undo());
    $('hintBtn').addEventListener('click', () => this.hint());
    $('autoBtn').addEventListener('click', () => this.toggleAuto());
    $('newBtn').addEventListener('click', () => this.askNewGame());
    $('replayBtn').addEventListener('click', () => this.watchOwn());
    $('statsBtn').addEventListener('click', () => this.openSheet('stats'));
    $('soundBtn').addEventListener('click', () => this.toggleSound());
    $('themeBtn').addEventListener('click', () => this.toggleTheme());
    $('botChip').addEventListener('click', () => this.cycleAutoSpeed());
    $('arrows').addEventListener('click', e => {
      const b = e.target.closest('.arrow');
      if (b) this.move(+b.dataset.dir);
    });
    $('sheetClose').addEventListener('click', () => $('sheet').close());
    $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').close(); });
    $('tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) this.renderSheet(b.dataset.tab);
    });
    this.bindReplayBar();
    this.bindKeys();
    this.bindSwipe();
    finePointer.addEventListener?.('change', () => { this.view.setBoard(this.shown); });
    document.addEventListener('visibilitychange', () => { this.clockLast = performance.now(); });
    window.addEventListener('hashchange', () => this.openLink());

    const board = BOARDS.find(b => b.id === prefs.board) || BOARDS[1];
    const mode = MODES.find(m => m.id === prefs.mode) || MODES[0];
    this.select(board, mode);
    this.clockTimer = setInterval(() => this.tickClock(), 100);

    if (!prefs.seen) {
      // First visit: sweep the arrows once to show off the six directions.
      if (!reducedMotion.matches) [5, 0, 1, 2, 3, 4].forEach((d, i) => this.view.pulse(d, 600 + i * 110));
      this.savePrefs({ seen: true });
    }
    this.openLink();
  },

  /* ----- pickers and static chrome ----- */

  buildPickers() {
    $('boards').innerHTML = BOARDS.map(b =>
      `<button type="button" class="seg" data-id="${b.id}" aria-pressed="false" ` +
      `aria-label="${b.name} board, ${b.size} cells" title="${b.name} · ${b.size} cells">` +
      `${shapeIcon(b)}<span class="seg-name">${b.name}</span></button>`).join('');
    $('modes').innerHTML = MODES.map(m =>
      `<button type="button" class="seg" data-id="${m.id}" aria-pressed="false" title="${m.blurb}">${m.name}</button>`).join('');
    $('boards').addEventListener('click', e => {
      const b = e.target.closest('.seg');
      if (b) this.select(BOARDS.find(x => x.id === b.dataset.id), this.mode);
    });
    $('modes').addEventListener('click', e => {
      const b = e.target.closest('.seg');
      if (b) this.select(this.board, MODES.find(x => x.id === b.dataset.id));
    });
  },

  buildKeys() {
    // Keyboard rows: Q W E over A S D.
    $('keys').innerHTML = [5, 0, 1, 4, 3, 2]
      .map(d => `<span class="key">${arrowIcon(DIRS[d].angle)}<span>${keyLabels[d]}</span></span>`)
      .join('');
  },

  // Show the user's own key caps (e.g. AZERTY) where the browser can tell us.
  localiseKeys() {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
    navigator.keyboard.getLayoutMap().then(map => {
      const labels = KEY_CODES.map((code, i) => (map.get(code) || keyLabels[i]).toUpperCase());
      if (labels.join() === keyLabels.join()) return;
      keyLabels = labels;
      this.view.labelArrows();
      this.buildKeys();
    }).catch(() => {});
  },

  renderToggles() {
    const s = $('soundBtn');
    s.setAttribute('aria-pressed', String(Sound.enabled));
    s.innerHTML = icon(Sound.enabled ? 'soundOn' : 'soundOff');
    const dark = document.documentElement.dataset.theme === 'dark';
    $('themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
    $('themeBtn').title = dark ? 'Light theme' : 'Dark theme';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0b0d1b' : '#eceef6';
  },

  /* ----- choosing a game ----- */

  select(board, mode) {
    if (!board || !mode || this.replay) return;
    if (board === this.board && mode === this.mode) return;
    clearTimeout(this.cardTimer);
    this.stopAuto();
    const first = !this.board;
    this.board = board;
    this.mode = mode;
    this.flashedBest = false;
    const key = this.key;
    if (!this.games.has(key)) this.games.set(key, new Game(board, mode, { saved: Store.get('game:' + key) }));
    this.game = this.games.get(key);

    for (const b of $('boards').children) b.setAttribute('aria-pressed', String(b.dataset.id === board.id));
    for (const b of $('modes').children) b.setAttribute('aria-pressed', String(b.dataset.id === mode.id));

    this.hideCard();
    this.view.clearHint();
    this.view.setBoard(this.game);
    this.view.renderAll(this.game.cells, 'deal');
    this.hud(0);
    if (this.game.won && !this.game.keepPlaying) this.showCard('won', true);
    else if (this.game.over) this.showCard('over', true);
    this.savePrefs({ board: board.id, mode: mode.id });
    if (!first) announce(`${board.name} board, ${mode.name} mode. ${mode.blurb}`);
  },

  /* ----- playing ----- */

  move(dir, bot = false) {
    if (this.replay || this.card) return;
    if (!bot) this.stopAuto();
    const game = this.game;
    const wasFull = game.emptyCount === 0;
    const before = game.maxTile;
    const result = game.move(dir);
    if (!result) return;
    if (!result.moved) {
      if (!reducedMotion.matches) this.view.nudge(dir);
      Sound.bump();
      return;
    }
    if (bot) game.assisted = true;
    this.view.clearHint();
    this.view.animate(result);
    this.view.pulse(dir);
    this.track(result, wasFull);
    this.hud(result.gain);
    this.save();

    if (result.merges.length) {
      const top = Math.max(...result.merges.map(m => m.value));
      Sound.merge(top, result.merges.length, bot);
      if (!bot) buzz(top >= 128 ? 18 : 8);
      if (top >= 64 && top > before) announce(`New tile: ${top}.`);
    } else {
      Sound.slide(bot);
    }

    if (result.justWon) this.later(() => this.showCard('won'), 520);
    else if (game.over) this.later(() => this.showCard('over'), 700);
  },

  later(fn, ms) {
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(fn, reducedMotion.matches ? 0 : ms);
  },

  undo() {
    if (this.replay) return;
    this.stopAuto();
    if (!this.game.undo()) return;
    clearTimeout(this.cardTimer);
    this.hideCard();
    this.view.clearHint();
    this.view.renderAll(this.game.cells, 'restore');
    this.hud(0);
    this.save();
    Sound.undo();
  },

  // A game worth keeping asks twice before it is thrown away.
  askNewGame() {
    if (this.replay) return;
    const g = this.game, btn = $('newBtn');
    const precious = g.moves >= 12 && !g.over && !(g.won && !g.keepPlaying);
    if (precious && !btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      $('newLabel').textContent = 'Sure?';
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.resetConfirm(), 2600);
      return;
    }
    this.newGame();
  },

  resetConfirm() {
    clearTimeout(this.confirmTimer);
    $('newBtn').classList.remove('confirm');
    $('newLabel').textContent = 'New';
  },

  newGame() {
    clearTimeout(this.cardTimer);
    this.resetConfirm();
    this.stopAuto();
    this.hideCard();
    this.view.clearHint();
    this.flashedBest = false;
    this.game.reset();
    this.view.setBoard(this.game); // stones move
    this.view.renderAll(this.game.cells, 'deal');
    this.hud(0);
    this.save();
  },

  keepGoing() {
    this.game.keepPlaying = true;
    this.save();
    this.hideCard();
    this.hud(0);
    if (this.game.over) this.later(() => this.showCard('over'), 250);
  },

  hint() {
    if (this.replay || this.card || this.game.locked) return;
    const dir = suggestMove(this.game.topo, this.game.cells, 3);
    if (dir < 0) return;
    this.view.showHint(dir);
    toast(finePointer.matches ? `Try ${DIRS[dir].name} (${keyLabels[dir]})` : `Try ${DIRS[dir].name}`);
  },

  /* ----- bot ----- */

  toggleAuto() {
    if (this.auto.on) return this.stopAuto();
    if (this.replay || this.card || this.game.locked) return;
    if (!this.game.assisted) toast('Bot at the wheel. This game will not count toward bests or badges.', 3200);
    this.auto.on = true;
    this.hud(0);
    this.autoStep();
  },

  stopAuto() {
    if (!this.auto.on) return;
    this.auto.on = false;
    clearTimeout(this.auto.timer);
    this.hud(0);
  },

  autoStep() {
    if (!this.auto.on) return;
    if (this.replay || this.card || this.game.locked || $('sheet').open) return this.stopAuto();
    const dir = suggestMove(this.game.topo, this.game.cells, 3);
    if (dir < 0) return this.stopAuto();
    this.move(dir, true);
    if (this.auto.on) this.auto.timer = setTimeout(() => this.autoStep(), [520, 240, 90][this.auto.speed]);
  },

  cycleAutoSpeed() {
    if (!this.auto.on) return;
    this.auto.speed = (this.auto.speed + 1) % 3;
    this.hud(0);
  },

  /* ----- Rush clock ----- */

  tickClock() {
    const now = performance.now();
    const dt = Math.min(250, now - this.clockLast);
    this.clockLast = now;
    const g = this.game;
    if (!g || !g.timed || g.over || !g.moves || this.replay || document.hidden || $('sheet').open) return;
    const before = g.clock;
    g.clock = Math.max(0, g.clock - dt);
    if (g.clock <= 10000 && Math.ceil(before / 1000) !== Math.ceil(g.clock / 1000) && g.clock > 0) Sound.tick();
    if (g.clock <= 0) {
      g.expire();
      this.stopAuto();
      this.save();
      this.hud(0);
      this.finish();
      this.showCard('over');
      return;
    }
    this.renderStatus();
    if (Math.floor(before / 2000) !== Math.floor(g.clock / 2000)) this.save();
  },

  /* ----- statistics and badges ----- */

  keyStats(key = this.key) {
    return (this.stats.keys[key] = Object.assign({ games: 0, wins: 0, best: 0, tile: 0 }, this.stats.keys[key]));
  },

  track(result, wasFull) {
    const g = this.game;
    if (g.assisted) return;
    const st = this.keyStats();
    if (!g.counted) {
      g.counted = true;
      st.games++;
      const total = Object.values(this.stats.keys).reduce((n, k) => n + (k.games || 0), 0);
      if (total >= 10) this.award('regular');
    }
    this.stats.moves++;
    this.stats.merges += result.merges.length;
    const top = result.merges.reduce((m, x) => Math.max(m, x.value), 0);
    if (top > st.tile) st.tile = top;
    if (top >= 256) this.award('t256');
    if (top >= 1024) this.award('t1024');
    if (top >= 2048) this.award('t2048');
    if (top >= 4096) this.award('t4096');
    if (result.merges.length >= 3) this.award('combo3');
    if (result.merges.length >= 5) this.award('combo5');
    if (wasFull) this.award('full');
    if (result.justWon) {
      st.wins++;
      this.award(g.board.id);
      if (g.mode.id === 'stones') this.award('stones');
      if (!g.undos) this.award('pure');
    }
    if (g.score > st.best) st.best = g.score;
    if (g.over) this.finish();
    Store.set('stats', this.stats);
  },

  // End-of-game bookkeeping that does not hang off a particular move.
  finish() {
    const g = this.game;
    if (g.assisted) return;
    if (g.mode.id === 'rush' && g.board.id === 'classic' && g.score >= 2500) this.award('rush');
    Store.set('stats', this.stats);
  },

  award(id) {
    if (this.stats.badges[id]) return;
    const badge = BADGES.find(b => b.id === id);
    if (!badge) return;
    this.stats.badges[id] = Date.now();
    Store.set('stats', this.stats);
    setTimeout(() => {
      toast(`Badge earned: ${badge.name}`, 3000);
      Sound.badge();
    }, 500);
  },

  /* ----- heads-up display ----- */

  hud(gain) {
    const g = this.shown;
    $('score').textContent = fmt(g.score);
    if (gain > 0 && !reducedMotion.matches) {
      const add = document.createElement('span');
      add.className = 'score-add';
      add.textContent = '+' + fmt(gain);
      add.addEventListener('animationend', () => add.remove());
      $('scoreBox').appendChild(add);
    }
    const key = g.board.id + ':' + g.mode.id;
    const best = this.keyStats(key).best;
    if (!this.replay && gain > 0 && !g.assisted && g.score >= best && best > 0 && !this.flashedBest && g.score - gain < best) {
      this.flashedBest = true;
      const box = $('bestBox');
      box.classList.remove('flash');
      void box.offsetWidth;
      box.classList.add('flash');
    }
    $('best').textContent = fmt(best);

    const live = !this.replay;
    $('undoBtn').disabled = !live || g.history.length === 0;
    $('hintBtn').disabled = !live || g.locked;
    $('autoBtn').disabled = !live || (g.locked && !this.auto.on);
    $('autoBtn').setAttribute('aria-pressed', String(this.auto.on));
    $('autoIcon').innerHTML = this.auto.on ? ICONS.pause : ICONS.bot;
    $('replayBtn').disabled = !live || g.moves === 0;
    this.view.setIdle(DIRS.map((_, d) => live && !g.locked && g.canSlide(d)));
    this.renderStatus();
  },

  renderStatus() {
    const g = this.shown;
    const goal = $('goalChip');
    if (g.timed) {
      const frac = g.clock / (g.board.rush * 1000);
      goal.innerHTML = icon('clock', 'mini') +
        `<span>${g.moves ? 'Time' : 'Clock starts on your first move'} <strong>${g.moves ? clockText(g.clock) : ''}</strong></span>` +
        `<span class="meter ${g.clock <= 10000 ? 'low' : ''}"><i style="width:${f(frac * 100)}%"></i></span>`;
    } else {
      const max = g.maxTile || 2;
      const frac = clamp((exponent(max) - 1) / (exponent(g.goal) - 1), 0, 1);
      goal.innerHTML = gemSvg(tileLook(g.goal).face, 'mini') +
        (g.won ? `<span>Goal reached. Top tile <strong>${fmt(max)}</strong></span>`
          : `<span>Goal <strong>${fmt(g.goal)}</strong></span><span class="meter"><i style="width:${f(frac * 100)}%"></i></span>`);
    }
    const next = $('nextChip');
    if (g.over) next.innerHTML = '';
    else {
      const v = g.peekNext();
      next.innerHTML = `<span>Next</span>${gemSvg(tileLook(v).face, 'mini')}<strong>${v}</strong>`;
    }
    const bot = $('botChip');
    if (this.replay) {
      bot.hidden = false;
      bot.disabled = true;
      bot.innerHTML = '<span>Replay</span>';
    } else if (this.auto.on) {
      bot.hidden = false;
      bot.disabled = false;
      bot.title = 'Change bot speed';
      bot.innerHTML = `<span class="dot"></span><span>Bot ${SPEEDS[this.auto.speed]}</span>`;
    } else if (g.assisted) {
      bot.hidden = false;
      bot.disabled = true;
      bot.title = 'The bot played part of this game, so it does not count toward bests';
      bot.innerHTML = '<span>Bot-assisted</span>';
    } else {
      bot.hidden = true;
    }
  },

  save() {
    Store.set('game:' + this.key, this.game.serialize());
  },

  savePrefs(patch) {
    Store.set('prefs', Object.assign(Store.get('prefs', {}), patch));
  },

  /* ----- end-of-game card ----- */

  showCard(kind, quiet = false) {
    if (this.replay) return;
    const game = this.game;
    this.stopAuto();
    this.card = kind;
    const gem = document.createElement('div');
    gem.className = 'gem';
    const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
    const best = !game.assisted && game.score > 0 && game.score >= this.keyStats().best;
    let actions;
    if (kind === 'won') {
      paintGem(gem, game.goal);
      $('cardTitle').textContent = `You cut a ${fmt(game.goal)}!`;
      $('cardText').textContent = `${plural(game.moves, 'move')}, ${plural(game.score, 'point')}` +
        (game.assisted ? ', with help from the bot.' : game.undos ? '.' : ', no undo.') + ' Keep going for a higher score?';
      actions = [['Keep going', () => this.keepGoing(), true], ['Replay', () => this.watchOwn()], ['New game', () => this.newGame()]];
    } else {
      paintGem(gem, game.maxTile || 2);
      $('cardTitle').textContent = game.expired ? 'Time!' : 'Out of moves';
      $('cardText').textContent = `${plural(game.score, 'point')} in ${plural(game.moves, 'move')}, top tile ${fmt(game.maxTile)}.` +
        (best ? ' A new best!' : '');
      actions = [];
      if (game.history.length) actions.push(['Undo', () => this.undo()]);
      actions.push(['Replay', () => this.watchOwn()]);
      actions.push([game.expired ? 'Again' : 'Try again', () => this.newGame(), true]);
    }
    $('cardTile').replaceChildren(gem);
    $('cardActions').replaceChildren(...actions.map(([label, fn, primary]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn primary' : 'btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    }));
    const veil = $('veil');
    veil.hidden = false;
    void veil.offsetWidth;
    veil.classList.add('show');
    const primary = veil.querySelector('.btn.primary');
    if (primary && finePointer.matches) primary.focus({ preventScroll: true });
    this.hud(0);
    if (quiet) return;
    if (kind === 'won') {
      Sound.win();
      confetti(this.view.stage);
      announce(`You made ${game.goal}! Keep going or start a new game.`);
    } else {
      Sound.lose();
      announce(`${game.expired ? 'Time is up' : 'Out of moves'}. Final score ${game.score}.`);
    }
  },

  hideCard() {
    const veil = $('veil');
    const hadFocus = veil.contains(document.activeElement);
    veil.classList.remove('show');
    veil.hidden = true;
    this.card = null;
    if (hadFocus) document.activeElement.blur();
  },

  /* ----- replays ----- */

  watchOwn() {
    const g = this.game;
    if (this.replay || !g.moves) return;
    this.startReplay({ board: g.board, mode: g.mode, seed: g.seed, log: g.log }, false);
  },

  openLink() {
    const m = /^#replay=(.+)$/.exec(location.hash);
    if (!m) return;
    const data = decodeReplay(decodeURIComponent(m[1]));
    if (!data) return toast('That replay link is damaged.');
    if (this.replay) this.endReplay(true);
    this.startReplay(data, true);
  },

  startReplay(data, fromLink) {
    clearTimeout(this.cardTimer);
    this.stopAuto();
    this.resetConfirm();
    this.hideCard();
    this.view.clearHint();
    if ($('sheet').open) $('sheet').close();
    this.replay = Object.assign({ idx: 0, playing: false, speed: 1, timer: 0, fromLink }, data);
    document.body.classList.add('replaying');
    $('replayBar').hidden = false;
    $('rpSlider').max = data.log.length;
    this.seekReplay(0);
    this.view.measure();
    if (fromLink) toast(`Replay: ${data.board.name} board, ${data.mode.name} mode, ${fmt(data.log.length)} moves`, 3000);
    setTimeout(() => this.playReplay(true), 500);
  },

  // Jumps to the position after `n` moves by replaying from the seed.
  seekReplay(n) {
    const r = this.replay;
    r.idx = clamp(n, 0, r.log.length);
    r.game = Game.replay(r.board, r.mode, r.seed, r.log, r.idx);
    this.view.setBoard(r.game);
    this.view.renderAll(r.game.cells, null);
    this.renderReplayBar();
    this.hud(0);
  },

  stepReplay() {
    const r = this.replay;
    if (!r || r.idx >= r.log.length) return false;
    const res = r.game.move(+r.log[r.idx]);
    if (!res || !res.moved) { r.idx = r.log.length; return false; }
    r.game.history.length = 0;
    r.idx++;
    this.view.layer.classList.toggle('fast', r.speed === 2);
    this.view.animate(res);
    if (res.merges.length) Sound.merge(Math.max(...res.merges.map(m => m.value)), res.merges.length, true);
    else Sound.slide(true);
    this.renderReplayBar();
    this.hud(res.gain);
    return true;
  },

  playReplay(on) {
    const r = this.replay;
    if (!r) return;
    clearTimeout(r.timer);
    r.playing = on;
    if (on && r.idx >= r.log.length) this.seekReplay(0);
    this.renderReplayBar();
    if (!on) return;
    const loop = () => {
      if (!this.replay || !r.playing) return;
      if (!this.stepReplay() || r.idx >= r.log.length) {
        r.playing = false;
        this.renderReplayBar();
        return;
      }
      r.timer = setTimeout(loop, [420, 190, 70][r.speed]);
    };
    r.timer = setTimeout(loop, 60);
  },

  renderReplayBar() {
    const r = this.replay;
    if (!r) return;
    $('rpPlay').innerHTML = icon(r.playing ? 'pause' : 'play');
    $('rpSlider').value = r.idx;
    $('rpCount').textContent = `${fmt(r.idx)} / ${fmt(r.log.length)}`;
    $('rpSpeed').textContent = SPEEDS[r.speed];
  },

  endReplay(silent = false) {
    const r = this.replay;
    if (!r) return;
    clearTimeout(r.timer);
    this.replay = null;
    document.body.classList.remove('replaying');
    $('replayBar').hidden = true;
    this.view.layer.classList.remove('fast');
    if (r.fromLink && /^#replay=/.test(location.hash)) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file: URLs */ }
    }
    if (silent) return;
    this.view.setBoard(this.game);
    this.view.renderAll(this.game.cells, 'restore');
    this.hud(0);
    if (this.game.won && !this.game.keepPlaying) this.showCard('won', true);
    else if (this.game.over) this.showCard('over', true);
  },

  copyReplayLink() {
    const r = this.replay;
    if (!r) return;
    const url = location.href.split('#')[0] + '#replay=' + encodeReplay({ board: r.board, mode: r.mode, seed: r.seed, log: r.log });
    const done = () => toast('Replay link copied');
    const fail = () => toast('Could not copy the link here');
    try {
      navigator.clipboard.writeText(url).then(done, fail);
    } catch (e) { fail(); }
  },

  bindReplayBar() {
    $('rpStart').addEventListener('click', () => { this.playReplay(false); this.seekReplay(0); });
    $('rpPlay').addEventListener('click', () => this.playReplay(!this.replay.playing));
    $('rpSpeed').addEventListener('click', () => {
      this.replay.speed = (this.replay.speed + 1) % 3;
      this.renderReplayBar();
    });
    $('rpSlider').addEventListener('input', e => {
      this.playReplay(false);
      this.view.quiet = true;
      this.seekReplay(+e.target.value);
      this.view.quiet = false;
    });
    $('rpLink').addEventListener('click', () => this.copyReplayLink());
    $('rpExit').addEventListener('click', () => this.endReplay());
  },

  /* ----- sheet: stats, badges, guide ----- */

  openSheet(tab) {
    this.stopAuto();
    this.renderSheet(tab);
    const sheet = $('sheet');
    if (!sheet.open) {
      if (sheet.showModal) sheet.showModal();
      else sheet.setAttribute('open', '');
    }
  },

  renderSheet(tab) {
    for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const body = $('sheetBody');
    body.scrollTop = 0;
    if (tab === 'stats') {
      const keys = Object.values(this.stats.keys);
      const sum = k => keys.reduce((n, s) => n + (s[k] || 0), 0);
      const cell = (b, m) => {
        const s = this.stats.keys[b.id + ':' + m.id];
        if (!s || !s.games) return '<td><span class="none">–</span></td>';
        return `<td><span class="cellstat">${s.tile ? gemSvg(tileLook(s.tile).face) : ''}${fmt(s.best)}</span>` +
          `<small>${s.tile ? 'top ' + fmt(s.tile) + ' · ' : ''}${m.id === 'rush' ? s.games + ' played' : s.wins + '/' + s.games + ' won'}</small></td>`;
      };
      body.innerHTML =
        '<h3>All games</h3><div class="totals">' +
        `<div class="total"><b>${fmt(sum('games'))}</b><span>games</span></div>` +
        `<div class="total"><b>${fmt(sum('wins'))}</b><span>wins</span></div>` +
        `<div class="total"><b>${fmt(this.stats.moves)}</b><span>moves</span></div>` +
        `<div class="total"><b>${fmt(this.stats.merges)}</b><span>merges</span></div></div>` +
        '<h3>Best score by board and mode</h3><table class="grid-stats"><thead><tr><th></th>' +
        MODES.map(m => `<th>${m.name}</th>`).join('') + '</tr></thead><tbody>' +
        BOARDS.map(b => `<tr><td>${b.name}<small>${b.size} cells</small></td>${MODES.map(m => cell(b, m)).join('')}</tr>`).join('') +
        '</tbody></table><p style="margin-top:12px;font-size:13px">Games the bot helped with are left out.</p>' +
        '<button class="danger-link" id="wipeBtn" type="button">Reset statistics and badges</button>';
      $('wipeBtn').addEventListener('click', e => {
        if (e.target.dataset.armed) {
          this.stats = { keys: {}, moves: 0, merges: 0, badges: {} };
          Store.set('stats', this.stats);
          this.renderSheet('stats');
          this.hud(0);
        } else {
          e.target.dataset.armed = '1';
          e.target.textContent = 'Click again to erase all statistics and badges';
        }
      });
    } else if (tab === 'badges') {
      const got = BADGES.filter(b => this.stats.badges[b.id]).length;
      body.innerHTML = `<h3>${got} of ${BADGES.length} earned</h3><div class="badges">` +
        BADGES.map(b => `<div class="badge ${this.stats.badges[b.id] ? '' : 'locked'}">` +
          gemSvg(b.tile ? tileLook(b.tile).face : STONE) + `<div><b>${b.name}</b><span>${b.text}</span></div></div>`).join('') +
        '</div>';
    } else {
      const k = keyLabels;
      body.innerHTML =
        '<h3>The move</h3><p>Every move slides <strong>all</strong> tiles as far as they will go along one of six directions. ' +
        'When two equal tiles meet they fuse into one of twice the value, and each tile fuses at most once per move. ' +
        'Then a new 2 (or, one time in ten, a 4) drops into an empty cell. The <strong>Next</strong> gem shows which.</p>' +
        '<h3>Controls</h3><ul class="guide-list">' +
        `<li><strong>Keys:</strong> <kbd class="k">${k[5]}</kbd><kbd class="k">${k[0]}</kbd><kbd class="k">${k[1]}</kbd> over ` +
        `<kbd class="k">${k[4]}</kbd><kbd class="k">${k[3]}</kbd><kbd class="k">${k[2]}</kbd>. The number pad (7 8 9 / 1 2 3) and U I O / J K L work too.</li>` +
        '<li><strong>Drag:</strong> pull the board and the tiles follow your finger, so you see the move before you let go. Drag back to cancel.</li>' +
        '<li><strong>Arrows:</strong> tap one of the six around the board. Faded arrows are blocked.</li></ul>' +
        '<h3>Boards</h3><ul class="guide-list">' +
        BOARDS.map(b => `<li><strong>${b.name}</strong>, ${b.size} cells. Goal ${fmt(b.goal)}.</li>`).join('') + '</ul>' +
        '<h3>Modes</h3><ul class="guide-list">' +
        '<li><strong>Classic.</strong> Reach the goal tile, then keep going as long as you like.</li>' +
        '<li><strong>Stones.</strong> A few cells hold fixed stones, new each game. Lanes stop at a stone, so tiles on either side never meet.</li>' +
        '<li><strong>Rush.</strong> The clock starts on your first move. Score as much as you can before it runs out.</li></ul>' +
        '<h3>Tools</h3><ul class="guide-list">' +
        '<li><strong>Undo</strong> goes back as far as you like. The next tile is fixed in advance, so undoing never re-rolls it.</li>' +
        '<li><strong>Hint</strong> asks the bot for one move. <strong>Auto</strong> lets it play; tap the Bot chip to change speed. Bot games do not count toward bests or badges.</li>' +
        '<li><strong>Replay</strong> plays any game back from its first move. Copy the link to share it.</li></ul>';
    }
  },

  /* ----- preferences ----- */

  toggleSound() {
    Sound.enabled = !Sound.enabled;
    this.savePrefs({ sound: Sound.enabled });
    this.renderToggles();
    if (Sound.enabled) Sound.merge(8, 1);
    toast(Sound.enabled ? 'Sound on' : 'Sound off');
  },

  toggleTheme() {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    this.savePrefs({ theme: root.dataset.theme });
    this.renderToggles();
  },

  /* ----- input ----- */

  bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.defaultPrevented || $('sheet').open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyZ') {
          e.preventDefault();
          this.undo();
        }
        return;
      }
      Sound.wake();
      if (this.replay) return this.replayKey(e);
      const dir = KEYMAP[e.code];
      if (dir !== undefined) {
        e.preventDefault();
        if (!e.repeat) this.move(dir);
        return;
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyZ':
        case 'Backspace':
          e.preventDefault();
          this.undo();
          break;
        case 'KeyN': this.askNewGame(); break;
        case 'KeyH': this.hint(); break;
        case 'KeyP': this.toggleAuto(); break;
        case 'KeyR': this.watchOwn(); break;
        case 'KeyM': this.toggleSound(); break;
        case 'Slash': this.openSheet('help'); break;
        case 'Escape':
          if (this.auto.on) this.stopAuto();
          else if (this.card === 'won') this.keepGoing();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          toast(`Six directions here: ${keyLabels[5]} ${keyLabels[0]} ${keyLabels[1]} / ${keyLabels[4]} ${keyLabels[3]} ${keyLabels[2]}`);
          break;
      }
    });
  },

  replayKey(e) {
    const r = this.replay;
    switch (e.code) {
      case 'Space':
        if (e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        this.playReplay(!r.playing);
        break;
      case 'ArrowRight': e.preventDefault(); this.playReplay(false); this.stepReplay(); break;
      case 'ArrowLeft': e.preventDefault(); this.playReplay(false); this.seekReplay(r.idx - 1); break;
      case 'Escape':
      case 'KeyR': this.endReplay(); break;
      case 'KeyM': this.toggleSound(); break;
    }
  },

  // Dragging slides the tiles under the pointer. Past the commit distance,
  // letting go makes the move; dragging back toward the start cancels it.
  bindSwipe() {
    const stage = this.view.stage;
    let drag = null;
    const read = e => {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const dist = Math.hypot(dx, dy);
      const cell = this.view.cellPx();
      const dead = Math.max(8, cell * 0.14);
      if (dist < dead) return { dir: -1, t: 0, commit: false };
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const dir = ((Math.round((deg + 90) / 60) % 6) + 6) % 6;
      const t = clamp((dist - dead) / (cell * 1.5), 0, 1);
      return { dir, t, commit: dist >= Math.max(18, cell * 0.38) };
    };
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.card || this.replay || e.target.closest('button, .veil')) return;
      Sound.wake();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dir: -1, res: null };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    stage.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dir, t, commit } = read(e);
      if (dir !== drag.dir) {
        this.view.release();
        drag.dir = dir;
        drag.res = dir >= 0 && !this.game.locked ? this.game.preview(dir) : null;
      }
      this.view.aim(commit ? dir : -1);
      if (dir < 0 || !drag.res || reducedMotion.matches) return;
      // Ease out, and stop short of the far cell so the release still animates.
      const eased = 0.62 * (1 - (1 - t) * (1 - t));
      if (drag.res.moved) this.view.drag(drag.res, eased);
      else this.view.lean(dir, t);
    });
    const finish = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dir, commit } = e.type === 'pointerup' ? read(e) : { dir: -1, commit: false };
      drag = null;
      this.view.aim(-1);
      if (dir >= 0 && commit) {
        this.view.layer.classList.remove('dragging');
        this.view.layer.style.transform = '';
        this.move(dir);
        if (this.view.dragged.length) this.view.release(); // the move was refused
      } else {
        this.view.release();
      }
    };
    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', finish);
    // Older iOS ignores touch-action on some elements; keep the page still mid-drag.
    stage.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  },
};

App.init();
window.FacetApp = App; // handy in the console
})();
