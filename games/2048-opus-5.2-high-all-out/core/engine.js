/* ==========================================================================
   Hex 2048 rules. Pure data and functions: no DOM, no renderer.
   Loads as a classic script (window.HexCore) and as a CommonJS module, so
   the same file drives both 3D variants, the Node tests and the tuning bot.

   Cells are flat-topped hexagons in axial coordinates (q, r). That makes the
   board as a whole stand on a point, so the six slide directions are
   straight up and down plus four diagonals, which line up with the
   Q W E / A S D block on a keyboard. Every earlier hex-2048 in this repo
   that tried the other orientation ended up with awkward left/right keys.

   World layout (used by both renderers): x to the right, z toward the
   viewer, one unit = one cell circumradius.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HexCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const SQRT3 = Math.sqrt(3);

// Clockwise from straight up. `angle` is the screen heading in degrees with
// y growing downward, for a camera looking straight down the board.
const DIRS = [
  { id: 0, name: 'up',         dq: 0,  dr: -1, angle: -90, glyph: '↑' },
  { id: 1, name: 'up-right',   dq: 1,  dr: -1, angle: -30, glyph: '↗' },
  { id: 2, name: 'down-right', dq: 1,  dr: 0,  angle: 30,  glyph: '↘' },
  { id: 3, name: 'down',       dq: 0,  dr: 1,  angle: 90,  glyph: '↓' },
  { id: 4, name: 'down-left',  dq: -1, dr: 1,  angle: 150, glyph: '↙' },
  { id: 5, name: 'up-left',    dq: -1, dr: 0,  angle: 210, glyph: '↖' },
];

// Goals were checked with tools/tune.mjs, which lets the hint bot play each
// configuration. Six-way sliding merges far more easily than a 4x4 square:
// even a weak (1 ms) bot clears 4096 on Classic, with or without stones, and
// practically never loses on Grand. So only Mini is set by difficulty (the
// bot reaches 128 in 93% of games, but with one stone only 7%: 64 there).
// Classic keeps the classic 2048, and Grand's 4096 is set by game length
// (about two thousand moves).
const BOARDS = [
  { id: 'mini',    name: 'Mini',    radius: 1, cells: 7,  goal: 128,  stones: 1, stoneGoal: 64 },
  { id: 'classic', name: 'Classic', radius: 2, cells: 19, goal: 2048, stones: 3, stoneGoal: 2048 },
  { id: 'grand',   name: 'Grand',   radius: 3, cells: 37, goal: 4096, stones: 5, stoneGoal: 4096 },
];
const boardById = id => BOARDS.find(b => b.id === id) || BOARDS[1];

const FOUR_CHANCE = 0.1;
const HISTORY_LIMIT = 300;

const exponent = v => 31 - Math.clz32(v);
const isPow2 = v => Number.isInteger(v) && v >= 2 && (v & (v - 1)) === 0;

/* ---------- Topology ---------- */

function cellXZ(q, r) {
  return { x: 1.5 * q, z: SQRT3 * (r + q / 2) };
}

// stones: list of cell indices that are permanently blocked.
function buildTopology(radius, stones) {
  const R = radius;
  const cells = [];
  const index = new Map();
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, R - q); r++) {
      index.set(q + ',' + r, cells.length);
      const p = cellXZ(q, r);
      cells.push({ i: cells.length, q, r, s: -q - r, x: p.x, z: p.z,
        ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) });
    }
  }
  const blocked = cells.map(() => false);
  for (const i of stones || []) blocked[i] = true;
  const raw = (q, r) => {
    const i = index.get(q + ',' + r);
    return i === undefined ? -1 : i;
  };
  const at = (q, r) => {
    const i = raw(q, r);
    return i === -1 || blocked[i] ? -1 : i;
  };
  // Stones have no neighbours and are nobody's neighbour, so a stone simply
  // splits the line it sits on into two shorter lines.
  const neighbors = cells.map((c, i) => DIRS.map(d => (blocked[i] ? -1 : at(c.q + d.dq, c.r + d.dr))));
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
  const degree = neighbors.map(list => list.filter(j => j !== -1).length);
  return { radius: R, cells, blocked, neighbors, lines, open, degree, size: cells.length,
    stones: (stones || []).slice(), indexOf: raw };
}

/* ---------- Sliding ---------- */

// Standard 2048 rules on each line: tiles pack toward the leading edge, a
// tile merges at most once per move, and the pair nearest the edge merges
// first. Returns the next cells plus a full account of what happened so the
// renderers can animate it and undo can play it backwards.
function slide(topo, cells, dir, nextId) {
  const next = new Array(topo.size).fill(null);
  const moves = [];  // { id, value, from, to, consumed }
  const merges = []; // { id, value, at, from: [idA, idB] }
  let gain = 0;
  let moved = false;
  for (const run of topo.lines[dir]) {
    let fill = 0;
    let open = null; // { tile, move } of the last placed tile while it can still absorb a twin
    for (const from of run) {
      const tile = cells[from];
      if (!tile) continue;
      if (open && open.tile.value === tile.value) {
        const at = run[fill - 1];
        const merged = { id: nextId(), value: tile.value * 2 };
        next[at] = merged;
        open.move.consumed = true;
        moves.push({ id: tile.id, value: tile.value, from, to: at, consumed: true });
        merges.push({ id: merged.id, value: merged.value, at, from: [open.tile.id, tile.id] });
        gain += merged.value;
        moved = true;
        open = null;
      } else {
        const at = run[fill++];
        next[at] = tile;
        const move = { id: tile.id, value: tile.value, from, to: at, consumed: false };
        moves.push(move);
        if (at !== from) moved = true;
        open = { tile, move };
      }
    }
  }
  // Keep only tiles that actually travelled or got merged.
  const travelled = moves.filter(m => m.from !== m.to || m.consumed);
  return { dir, cells: next, moves: travelled, merges, gain, moved };
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

function canMove(topo, cells, dir) {
  for (const run of topo.lines[dir]) {
    let prev = 0, gap = false;
    for (const i of run) {
      const t = cells[i];
      if (!t) { gap = true; continue; }
      if (gap || t.value === prev) return true;
      prev = t.value;
    }
  }
  return false;
}

/* ---------- Random numbers ---------- */

// mulberry32. The state is saved with every undo step, so undoing a move and
// making it again spawns the very same tile: undo is for fixing mistakes,
// not for fishing for a better roll.
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

// Stones never take the centre, never touch each other, and never leave an
// open cell with fewer than two open neighbours (a dead pocket that no tile
// could ever leave is no fun).
function pickStones(radius, count, rng) {
  if (!count) return [];
  const base = buildTopology(radius);
  for (let attempt = 0; attempt < 60; attempt++) {
    const picked = [];
    for (let tries = 0; picked.length < count && tries < 400; tries++) {
      const i = Math.floor(rng.next() * base.size);
      const c = base.cells[i];
      if (c.ring === 0 || picked.includes(i)) continue;
      if (base.neighbors[i].some(j => picked.includes(j))) continue;
      picked.push(i);
    }
    if (picked.length < count) continue;
    const topo = buildTopology(radius, picked);
    if (topo.open.every(i => topo.degree[i] >= 2)) return picked.sort((a, b) => a - b);
  }
  return [];
}

/* ---------- Game ---------- */

class Game {
  // config: { board: 'mini'|'classic'|'grand', stones: bool }
  // opts.saved: output of serialize(). opts.seed: start a specific game.
  constructor(config, opts = {}) {
    this.rng = makeRng(0);
    this.uid = 0;
    if (!(opts.saved && this.restore(opts.saved))) this.reset(config, opts.seed);
  }

  nextId() { return ++this.uid; }

  get goal() { return this.stones ? this.board.stoneGoal : this.board.goal; }

  reset(config, seed) {
    this.board = boardById(config.board);
    this.stones = !!config.stones;
    this.seed = (seed === undefined ? randomSeed() : seed) >>> 0;
    this.rng.state = this.seed;
    this.stoneCells = this.stones ? pickStones(this.board.radius, this.board.stones, this.rng) : [];
    this.topo = buildTopology(this.board.radius, this.stoneCells);
    this.cells = new Array(this.topo.size).fill(null);
    this.score = 0;
    this.moves = 0;
    this.won = false;      // reached the goal this game
    this.over = false;
    this.history = [];
    this.spawn();
    this.spawn();
    return this.snapshotTransition('reset');
  }

  get maxTile() {
    let m = 0;
    for (const t of this.cells) if (t && t.value > m) m = t.value;
    return m;
  }

  emptyCells() {
    return this.topo.open.filter(i => !this.cells[i]);
  }

  spawn() {
    const empty = this.emptyCells();
    if (!empty.length) return null;
    const at = empty[Math.floor(this.rng.next() * empty.length)];
    const value = this.rng.next() < FOUR_CHANCE ? 4 : 2;
    const tile = { id: this.nextId(), value };
    this.cells[at] = tile;
    return { id: tile.id, value, at };
  }

  // What would happen, without changing anything. Drives drag-follow.
  peek(dir) {
    let fake = this.uid;
    return slide(this.topo, this.cells, dir, () => ++fake);
  }

  canMove(dir) { return !this.over && canMove(this.topo, this.cells, dir); }

  move(dir) {
    if (this.over) return null;
    const res = slide(this.topo, this.cells, dir, () => this.nextId());
    if (!res.moved) return null;
    const entry = {
      cells: this.cells.map(t => (t ? [t.id, t.value] : 0)),
      score: this.score, rng: this.rng.state, won: this.won, moves: this.moves,
      record: null,
    };
    this.cells = res.cells;
    this.score += res.gain;
    this.moves++;
    const spawn = this.spawn();
    entry.record = {
      moves: res.moves.map(m => [m.id, m.value, m.from, m.to, m.consumed ? 1 : 0]),
      merges: res.merges.map(m => m.id),
      spawn: spawn ? spawn.id : 0,
    };
    this.history.push(entry);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();

    const max = this.maxTile;
    let wonNow = false;
    if (!this.won && max >= this.goal) { this.won = true; wonNow = true; }
    this.over = !hasMoves(this.topo, this.cells);

    const tiles = [];
    for (const m of res.moves) tiles.push({ kind: m.consumed ? 'consume' : 'slide', id: m.id, value: m.value, from: m.from, to: m.to });
    for (const m of res.merges) tiles.push({ kind: 'merge', id: m.id, value: m.value, to: m.at, from: m.at, parents: m.from });
    if (spawn) tiles.push({ kind: 'spawn', id: spawn.id, value: spawn.value, to: spawn.at, from: spawn.at });
    return {
      type: 'move', dir, tiles, gain: res.gain, merges: res.merges.length,
      mergeValues: res.merges.map(m => m.value), maxMerge: res.merges.reduce((a, m) => Math.max(a, m.value), 0),
      score: this.score, wonNow, over: this.over, maxTile: max,
    };
  }

  get canUndo() { return this.history.length > 0; }

  // Plays the last move backwards: the spawned tile and every merged tile
  // fade out, merged pairs split apart, everything slides home.
  undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    const rec = entry.record;
    const tiles = [];
    if (rec.spawn) tiles.push({ kind: 'vanish', id: rec.spawn });
    for (const id of rec.merges) tiles.push({ kind: 'vanish', id });
    for (const [id, value, from, to, consumed] of rec.moves) {
      tiles.push({ kind: consumed ? 'split' : 'slide', id, value, from: to, to: from });
    }
    this.cells = entry.cells.map(c => (c ? { id: c[0], value: c[1] } : null));
    this.score = entry.score;
    this.rng.state = entry.rng;
    this.won = entry.won;
    this.moves = entry.moves;
    this.over = false;
    return { type: 'undo', tiles, gain: 0, score: this.score, over: false };
  }

  // A transition that builds the whole board from nothing.
  snapshotTransition(type) {
    const tiles = [];
    this.cells.forEach((t, i) => { if (t) tiles.push({ kind: 'spawn', id: t.id, value: t.value, to: i, from: i }); });
    return { type, tiles, gain: 0, score: this.score, over: this.over };
  }

  hint(budgetMs) { return suggestMove(this.topo, this.cells, budgetMs); }

  serialize() {
    return {
      v: 2, board: this.board.id, stones: this.stones, stoneCells: this.stoneCells,
      seed: this.seed, uid: this.uid, rng: this.rng.state,
      cells: this.cells.map(t => (t ? [t.id, t.value] : 0)),
      score: this.score, moves: this.moves, won: this.won,
      history: this.history.slice(-80),
    };
  }

  restore(s) {
    try {
      if (!s || s.v !== 2) return false;
      const board = BOARDS.find(b => b.id === s.board);
      if (!board) return false;
      const topo = buildTopology(board.radius, s.stoneCells || []);
      if (!Array.isArray(s.cells) || s.cells.length !== topo.size) return false;
      const cells = s.cells.map(c => (c ? { id: c[0] | 0, value: c[1] } : null));
      if (cells.some((t, i) => t && (!isPow2(t.value) || topo.blocked[i]))) return false;
      if (!Number.isFinite(s.score)) return false;
      this.board = board;
      this.stones = !!s.stones;
      this.stoneCells = (s.stoneCells || []).slice();
      this.topo = topo;
      this.cells = cells;
      this.seed = s.seed >>> 0;
      this.rng.state = s.rng >>> 0;
      this.uid = Math.max(s.uid | 0, ...cells.map(t => (t ? t.id : 0)));
      this.score = s.score;
      this.moves = s.moves | 0;
      this.won = !!s.won;
      this.history = Array.isArray(s.history) ? s.history.filter(h => h && Array.isArray(h.cells) && h.cells.length === topo.size && h.record) : [];
      this.over = !hasMoves(topo, cells);
      return true;
    } catch (e) {
      return false;
    }
  }
}

/* ==========================================================================
   Hint bot: expectimax over tile exponents with iterative deepening inside a
   time budget. Also used headless by tools/tune.mjs.
   ========================================================================== */

function makeSearcher(topo) {
  const n = topo.size;
  const nb = topo.neighbors;
  const open = topo.open;
  const lines = topo.lines;
  // Rim cells with few neighbours are the hex answer to "keep it in a corner".
  const edgeWeight = topo.degree.map(d => 6 - d);

  const step = (b, dir) => {
    const out = new Int8Array(n);
    let moved = false;
    for (const run of lines[dir]) {
      let fill = 0, last = 0;
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

  const evaluate = b => {
    let empty = 0, pairs = 0, rough = 0, anchor = 0, mono = 0;
    for (const i of open) {
      const v = b[i];
      if (!v) { empty++; continue; }
      anchor += v * v * edgeWeight[i];
      for (let d = 0; d < 3; d++) {
        const j = nb[i][d];
        if (j === -1) continue;
        const w = b[j];
        if (!w) continue;
        if (w === v) pairs += v;
        else rough += Math.abs(v - w) * Math.max(v, w);
      }
    }
    // Monotonicity: along each line, reward runs that only climb or only fall.
    for (let dir = 0; dir < 3; dir++) {
      for (const run of lines[dir]) {
        let up = 0, down = 0, prev = -1;
        for (const i of run) {
          const v = b[i];
          if (prev >= 0) { if (v > prev) up += v * v - prev * prev; else down += prev * prev - v * v; }
          prev = v;
        }
        mono -= Math.min(up, down);
      }
    }
    return empty * 28 + pairs * 3 - rough * 0.9 + anchor * 0.35 + mono * 1.4;
  };

  let deadline = 0, nodes = 0, aborted = false;
  const memo = new Map();
  const key = b => String.fromCharCode.apply(null, b);

  const player = (b, depth) => {
    let best = -Infinity;
    for (let d = 0; d < 6; d++) {
      const next = step(b, d);
      if (!next) continue;
      const v = depth <= 1 ? evaluate(next) : chance(next, depth - 1);
      if (v > best) best = v;
    }
    return best === -Infinity ? -1e7 : best;
  };

  const chance = (b, depth) => {
    if ((++nodes & 255) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return evaluate(b);
    const k = key(b) + depth;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const empty = [];
    for (const i of open) if (!b[i]) empty.push(i);
    if (!empty.length) return evaluate(b);
    // With lots of room the exact spawn matters less: sample a spread of cells.
    const maxSamples = depth > 2 ? 4 : 7;
    const stride = Math.max(1, Math.ceil(empty.length / maxSamples));
    let total = 0, count = 0;
    for (let s = 0; s < empty.length; s += stride) {
      const i = empty[s];
      b[i] = 1; total += 0.9 * player(b, depth);
      b[i] = 2; total += 0.1 * player(b, depth);
      b[i] = 0;
      count++;
    }
    const v = total / count;
    memo.set(k, v);
    return v;
  };

  // Returns { dir, depth, scores } where scores[d] is null for impossible moves.
  return function search(cells, budgetMs = 60, maxDepth = 7) {
    const start = Int8Array.from(cells, t => (t ? exponent(t.value) : 0));
    const legal = [];
    for (let d = 0; d < 6; d++) { const s = step(start, d); if (s) legal.push([d, s]); }
    if (!legal.length) return { dir: -1, depth: 0, scores: [] };
    if (legal.length === 1) return { dir: legal[0][0], depth: 0, scores: [] };
    deadline = Date.now() + budgetMs;
    let bestDir = legal[0][0], reached = 0, scores = [];
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      aborted = false;
      memo.clear();
      let localBest = -1, localVal = -Infinity;
      const local = new Array(6).fill(null);
      for (const [d, s] of legal) {
        const v = depth === 1 ? evaluate(s) : chance(s, depth);
        local[d] = v;
        if (v > localVal) { localVal = v; localBest = d; }
      }
      if (aborted && depth > 1) break;
      bestDir = localBest;
      scores = local;
      reached = depth;
      if (Date.now() > deadline) break;
    }
    return { dir: bestDir, depth: reached, scores };
  };
}

const searchers = new WeakMap();
function suggestMove(topo, cells, budgetMs) {
  let s = searchers.get(topo);
  if (!s) { s = makeSearcher(topo); searchers.set(topo, s); }
  return s(cells, budgetMs);
}

/* ---------- Tile palette helpers shared by both renderers ---------- */

// Tier 0..n for a value, so renderers can map size/height/glow to it.
const tierOf = value => Math.max(1, exponent(value));

return {
  SQRT3, DIRS, BOARDS, FOUR_CHANCE, boardById, cellXZ,
  buildTopology, slide, hasMoves, canMove, makeRng, randomSeed, pickStones,
  Game, makeSearcher, suggestMove, exponent, tierOf,
};
});
