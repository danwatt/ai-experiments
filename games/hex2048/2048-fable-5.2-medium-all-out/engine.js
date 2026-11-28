/* ==========================================================================
   Facet: rules of the game. Pure data and functions, no DOM.
   Runs in the browser (window.Facet) and in Node (module.exports).

   Cells are flat-topped hexagons in axial coordinates (q, r), which makes
   the board as a whole stand on a point: slides go straight up and down
   plus the four diagonals, matching Q W E / A S D on a keyboard.
   ========================================================================== */
(function (root) {
'use strict';

const SQRT3 = Math.sqrt(3);

// Six slide directions, clockwise from straight up. `angle` is the screen
// heading in degrees (y grows downward).
const DIRS = [
  { name: 'up',         dq: 0,  dr: -1, angle: -90 },
  { name: 'up-right',   dq: 1,  dr: -1, angle: -30 },
  { name: 'down-right', dq: 1,  dr: 0,  angle: 30 },
  { name: 'down',       dq: 0,  dr: 1,  angle: 90 },
  { name: 'down-left',  dq: -1, dr: 1,  angle: 150 },
  { name: 'up-left',    dq: -1, dr: 0,  angle: 210 },
];

// Goals were tuned by letting the search bot play each board (tools/tune.js).
// Six-way sliding merges far more easily than a square grid, so the bot
// rarely loses on the big board; its goal is set by how long a game should
// take rather than by how hard it is. `rush` is the clock in seconds.
const BOARDS = [
  { id: 'pocket',  name: 'Pocket',  radius: 1, size: 7,  goal: 128,  stones: 1, stoneGoal: 64,   rush: 45 },
  { id: 'classic', name: 'Classic', radius: 2, size: 19, goal: 2048, stones: 3, stoneGoal: 2048, rush: 90 },
  { id: 'grand',   name: 'Grand',   radius: 3, size: 37, goal: 4096, stones: 6, stoneGoal: 4096, rush: 120 },
];

const MODES = [
  { id: 'classic', name: 'Classic', blurb: 'Merge up to the goal tile.' },
  { id: 'stones',  name: 'Stones',  blurb: 'Fixed stones break up the lanes.' },
  { id: 'rush',    name: 'Rush',    blurb: 'Beat the clock. Score as much as you can.' },
];

const FOUR_CHANCE = 0.1;
const HISTORY_LIMIT = 400;

// Exponent of a power of two, exactly.
const exponent = v => 31 - Math.clz32(v);

const goalOf = (board, mode) =>
  mode.id === 'rush' ? 0 : mode.id === 'stones' ? board.stoneGoal : board.goal;

/* ---------- Topology ---------- */

function buildTopology(radius, stones = []) {
  const R = radius;
  const cells = [];
  const index = new Map();
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, R - q); r++) {
      index.set(q + ',' + r, cells.length);
      cells.push({ q, r, x: 1.5 * q, y: SQRT3 * (r + q / 2) });
    }
  }
  const blocked = cells.map(() => false);
  for (const i of stones) blocked[i] = true;
  const at = (q, r) => {
    const i = index.get(q + ',' + r);
    return i === undefined || blocked[i] ? -1 : i;
  };
  // Stones have no neighbours and are nobody's neighbour.
  const neighbors = cells.map((c, i) => DIRS.map(d => (blocked[i] ? -1 : at(c.q + d.dq, c.r + d.dr))));
  // lines[dir]: every run of open cells along dir, leading edge first.
  const lines = DIRS.map((_, dir) => {
    const back = (dir + 3) % 6;
    const runs = [];
    for (let i = 0; i < cells.length; i++) {
      if (blocked[i] || neighbors[i][dir] !== -1) continue;
      const run = [];
      for (let j = i; j !== -1; j = neighbors[j][back]) run.push(j);
      runs.push(run);
    }
    return runs;
  });
  const open = [];
  blocked.forEach((b, i) => { if (!b) open.push(i); });
  return { radius: R, cells, blocked, neighbors, lines, open, size: cells.length };
}

/* ---------- Sliding ---------- */

// 2048 rules: a tile merges at most once per move, and the pair nearest the
// leading edge merges first.
function slide(topo, cells, dir, nextId) {
  const next = new Array(topo.size).fill(null);
  const moves = [];
  const merges = [];
  let gain = 0;
  let moved = false;
  for (const run of topo.lines[dir]) {
    let fill = 0;
    let open = null; // last placed tile, while it can still absorb a twin
    for (const from of run) {
      const tile = cells[from];
      if (!tile) continue;
      if (open && open.value === tile.value) {
        const at = run[fill - 1];
        const merged = { id: nextId(), value: tile.value * 2 };
        next[at] = merged;
        merges.push({ id: merged.id, value: merged.value, at, from: [open.id, tile.id] });
        moves.push({ id: tile.id, from, to: at });
        gain += merged.value;
        moved = true;
        open = null;
      } else {
        const at = run[fill++];
        next[at] = tile;
        if (at !== from) {
          moves.push({ id: tile.id, from, to: at });
          moved = true;
        }
        open = tile;
      }
    }
  }
  return { dir, cells: next, moves, merges, gain, moved };
}

function hasMoves(topo, cells) {
  for (const i of topo.open) {
    const tile = cells[i];
    if (!tile) return true;
    for (let d = 0; d < 3; d++) {
      const j = topo.neighbors[i][d];
      if (j !== -1 && cells[j] && cells[j].value === tile.value) return true;
    }
  }
  return false;
}

/* ---------- Random numbers ---------- */

// mulberry32. Its state is part of every undo step and the seed is part of
// every game, so undo never re-rolls a tile and any game can be replayed
// from (seed, list of moves).
function makeRng(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() { return state; },
    set state(v) { state = v >>> 0; },
  };
}

function randomSeed() {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; }
  catch (e) { return (Math.random() * 4294967296) >>> 0; }
}

// Stones never sit on the centre cell and never touch each other.
function pickStones(radius, count, rng) {
  if (!count) return [];
  const topo = buildTopology(radius);
  const picked = [];
  for (let tries = 0; picked.length < count && tries < 500; tries++) {
    const i = Math.floor(rng.next() * topo.size);
    const c = topo.cells[i];
    if ((c.q === 0 && c.r === 0) || picked.includes(i)) continue;
    if (topo.neighbors[i].some(j => picked.includes(j))) continue;
    picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

/* ---------- Game ---------- */

const isValue = v => v === 0 || (Number.isInteger(v) && v >= 2 && (v & (v - 1)) === 0);
const isSnapshot = (s, size) =>
  !!s && Array.isArray(s.c) && s.c.length === size && s.c.every(isValue) &&
  Number.isFinite(s.s) && Number.isFinite(s.r);

class Game {
  // opts.saved: output of serialize(). opts.seed: start a specific game.
  constructor(board, mode, opts = {}) {
    this.board = board;
    this.mode = mode;
    this.goal = goalOf(board, mode);
    this.timed = mode.id === 'rush';
    this.uid = 0;
    this.rng = makeRng(0);
    if (!(opts.saved && this.restore(opts.saved))) this.reset(opts.seed);
  }

  nextId() { return ++this.uid; }

  reset(seed) {
    this.seed = (seed === undefined ? randomSeed() : seed) >>> 0;
    this.rng.state = this.seed;
    this.stones = pickStones(this.board.radius, this.mode.id === 'stones' ? this.board.stones : 0, this.rng);
    this.topo = buildTopology(this.board.radius, this.stones);
    this.cells = new Array(this.topo.size).fill(null);
    this.score = 0;
    this.log = '';        // one digit (direction) per move
    this.won = false;
    this.keepPlaying = false;
    this.assisted = false; // the bot played part of this game
    this.undos = 0;
    this.counted = false;  // already added to the statistics
    this.clock = this.timed ? this.board.rush * 1000 : 0; // ms left; the app ticks it
    this.expired = false;
    this.history = [];
    this.spawn();
    this.spawn();
    this.over = false;
  }

  get moves() { return this.log.length; }
  get locked() { return this.over || (this.won && !this.keepPlaying); }

  get maxTile() {
    let max = 0;
    for (const t of this.cells) if (t && t.value > max) max = t.value;
    return max;
  }

  get emptyCount() {
    let n = 0;
    for (const i of this.topo.open) if (!this.cells[i]) n++;
    return n;
  }

  spawn() {
    const empty = this.topo.open.filter(i => !this.cells[i]);
    if (!empty.length) return null;
    const at = empty[Math.floor(this.rng.next() * empty.length)];
    const value = this.rng.next() < FOUR_CHANCE ? 4 : 2;
    const tile = { id: this.nextId(), value };
    this.cells[at] = tile;
    return { id: tile.id, value, at };
  }

  // Value of the tile the next move will spawn (its cell depends on the move).
  peekNext() {
    const probe = makeRng(this.rng.state);
    probe.next();
    return probe.next() < FOUR_CHANCE ? 4 : 2;
  }

  preview(dir) { return slide(this.topo, this.cells, dir, () => 0); }
  canSlide(dir) { return this.preview(dir).moved; }

  refreshOver() {
    this.over = this.expired || !hasMoves(this.topo, this.cells);
  }

  move(dir) {
    if (this.locked) return null;
    const result = slide(this.topo, this.cells, dir, () => this.nextId());
    if (!result.moved) return result;
    this.remember();
    this.cells = result.cells;
    this.score += result.gain;
    this.log += dir;
    result.spawned = this.spawn();
    result.justWon = this.goal > 0 && !this.won && result.merges.some(m => m.value >= this.goal);
    if (result.justWon) this.won = true;
    this.refreshOver();
    return result;
  }

  // Rush only: the clock ran out. The result stands, so undo is closed off.
  expire() {
    this.clock = 0;
    this.expired = true;
    this.history = [];
    this.over = true;
  }

  undo() {
    if (this.expired) return false;
    const snap = this.history.pop();
    if (!snap) return false;
    this.load(snap);
    this.log = this.log.slice(0, -1);
    this.undos++;
    this.refreshOver();
    return true;
  }

  snapshot() {
    return {
      c: this.cells.map(t => (t ? t.value : 0)),
      s: this.score,
      w: this.won ? 1 : 0,
      k: this.keepPlaying ? 1 : 0,
      r: this.rng.state,
    };
  }

  load(snap) {
    this.cells = snap.c.map(v => (v ? { id: this.nextId(), value: v } : null));
    this.score = snap.s;
    this.won = !!snap.w;
    this.keepPlaying = !!snap.k;
    this.rng.state = snap.r;
  }

  remember() {
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  serialize(keep = 60) {
    return {
      v: 2, seed: this.seed, stones: this.stones, log: this.log,
      now: this.snapshot(), history: this.history.slice(-keep),
      assisted: this.assisted, undos: this.undos, counted: this.counted,
      clock: Math.round(this.clock), expired: this.expired,
    };
  }

  restore(data) {
    try {
      if (!data || data.v !== 2 || !Number.isFinite(data.seed)) return false;
      const base = buildTopology(this.board.radius);
      const stones = Array.isArray(data.stones) ? data.stones : [];
      const wanted = this.mode.id === 'stones' ? this.board.stones : 0;
      if (stones.length !== wanted || !stones.every(i => Number.isInteger(i) && i >= 0 && i < base.size)) return false;
      if (!isSnapshot(data.now, base.size) || !data.now.c.some(Boolean)) return false;
      if (stones.some(i => data.now.c[i])) return false;
      if (typeof data.log !== 'string' || !/^[0-5]*$/.test(data.log)) return false;
      this.seed = data.seed >>> 0;
      this.stones = stones;
      this.topo = buildTopology(this.board.radius, stones);
      this.load(data.now);
      this.log = data.log;
      this.history = (Array.isArray(data.history) ? data.history : [])
        .filter(s => isSnapshot(s, base.size)).slice(-this.log.length || 0);
      if (!this.log.length) this.history = [];
      this.assisted = !!data.assisted;
      this.undos = Number(data.undos) || 0;
      this.counted = !!data.counted;
      this.clock = this.timed ? Math.max(0, Math.min(this.board.rush * 1000, Number(data.clock) || 0)) : 0;
      this.expired = this.timed && (!!data.expired || this.clock <= 0);
      if (this.expired) this.history = [];
      this.refreshOver();
      return true;
    } catch (e) { return false; }
  }

  // Rebuilds the position after the first `count` moves of a recorded game.
  static replay(board, mode, seed, log, count = log.length) {
    const g = new Game(board, mode, { seed });
    g.keepPlaying = true;
    for (let i = 0; i < count && i < log.length; i++) {
      const res = g.move(+log[i]);
      if (!res || !res.moved) break;
      g.history.length = 0;
    }
    return g;
  }
}

/* ---------- Replay links ---------- */

// Two moves per character: 6 x 6 = 36 = one base-36 digit.
function packLog(log) {
  let out = '';
  for (let i = 0; i + 1 < log.length; i += 2) out += (+log[i] * 6 + +log[i + 1]).toString(36);
  return log.length % 2 ? out + '-' + log[log.length - 1] : out;
}

function unpackLog(packed) {
  const [pairs, tail = ''] = String(packed).split('-');
  let log = '';
  for (const ch of pairs) {
    const n = parseInt(ch, 36);
    if (!(n >= 0 && n < 36)) return null;
    log += Math.floor(n / 6) + '' + (n % 6);
  }
  if (tail && !/^[0-5]$/.test(tail)) return null;
  return log + tail;
}

function encodeReplay(game) {
  return [game.board.id, game.mode.id, game.seed.toString(36), packLog(game.log)].join('.');
}

function decodeReplay(text) {
  const [b, m, s, l = ''] = String(text).split('.');
  const board = BOARDS.find(x => x.id === b);
  const mode = MODES.find(x => x.id === m);
  const seed = parseInt(s, 36);
  const log = unpackLog(l);
  if (!board || !mode || !Number.isFinite(seed) || log === null || !log.length) return null;
  return { board, mode, seed: seed >>> 0, log };
}

/* ==========================================================================
   Bot: expectimax over tile exponents. Powers hints and autoplay.
   ========================================================================== */

function suggestMove(topo, cells, depth = 3) {
  const n = topo.size;
  const nb = topo.neighbors;
  const open = topo.open;
  const degree = nb.map(list => list.filter(j => j !== -1).length);

  const step = (b, dir) => {
    const out = new Int8Array(n);
    let moved = false;
    for (const run of topo.lines[dir]) {
      let fill = 0;
      let last = 0;
      for (const from of run) {
        const v = b[from];
        if (!v) continue;
        if (last === v) {
          out[run[fill - 1]] = v + 1;
          last = 0;
          moved = true;
        } else {
          const at = run[fill++];
          out[at] = v;
          last = v;
          if (at !== from) moved = true;
        }
      }
    }
    return moved ? out : null;
  };

  // Rewards open cells, mergeable neighbours, smooth gradients, and big
  // tiles parked on low-neighbour rim cells (the hex "keep it in a corner").
  const evaluate = b => {
    let empty = 0, pairs = 0, rough = 0, anchor = 0;
    for (const i of open) {
      const v = b[i];
      if (!v) { empty++; continue; }
      anchor += v * v * (6 - degree[i]);
      for (let d = 0; d < 3; d++) {
        const j = nb[i][d];
        if (j === -1 || !b[j]) continue;
        if (b[j] === v) pairs++;
        rough += Math.abs(v - b[j]);
      }
    }
    return empty * 3 + pairs - rough * 0.4 + anchor * 0.03;
  };

  const player = (b, left) => {
    let best = -Infinity;
    for (let d = 0; d < 6; d++) {
      const next = step(b, d);
      if (!next) continue;
      const v = left <= 1 ? evaluate(next) : chance(next, left - 1);
      if (v > best) best = v;
    }
    return best === -Infinity ? -1e6 : best;
  };

  const chance = (b, left) => {
    const empty = [];
    for (const i of open) if (!b[i]) empty.push(i);
    const stride = Math.max(1, Math.ceil(empty.length / 6)); // sample at most six cells
    let total = 0, count = 0;
    for (let k = 0; k < empty.length; k += stride) {
      const i = empty[k];
      b[i] = 1; total += 0.9 * player(b, left);
      b[i] = 2; total += 0.1 * player(b, left);
      b[i] = 0;
      count++;
    }
    return count ? total / count : player(b, left);
  };

  const start = Int8Array.from(cells, t => (t ? exponent(t.value) : 0));
  let bestDir = -1, bestVal = -Infinity;
  for (let d = 0; d < 6; d++) {
    const next = step(start, d);
    if (!next) continue;
    const v = depth <= 1 ? evaluate(next) : chance(next, depth - 1);
    if (v > bestVal) { bestVal = v; bestDir = d; }
  }
  return bestDir;
}

const api = {
  SQRT3, DIRS, BOARDS, MODES, exponent, goalOf, buildTopology, slide, hasMoves,
  makeRng, randomSeed, Game, encodeReplay, decodeReplay, packLog, unpackLog, suggestMove,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Facet = api;
})(typeof self !== 'undefined' ? self : this);
