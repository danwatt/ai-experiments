// Solitaire Parlor: menu, game controller, dialogs.
import { MODES, TILES, modeLabel } from './games/index.js';
import { WINNABLE } from './winnable.js';
import { Faces, BACKS } from './ui/faces.js';
import { Board } from './ui/board.js';
import { FX } from './ui/fx.js';
import { sfx, setSound, unlock } from './ui/sound.js';
import { celebrate, pickKind, HEADLINES, KINDS, KIND_NAMES } from './ui/celebrate.js';
import { solve, settle } from './core/solver.js';
import { hashString, randomSeed } from './core/rng.js';
import * as store from './store.js';

const { settings } = store;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEED = { relaxed: 1.45, normal: 1, quick: 0.6 };
const TABLES = { green: '#1d6b3c', blue: '#1d4f80', red: '#72202f', wood: '#774c27', slate: '#3a424e', purple: '#4c3d78' };

const faces = new Faces();
faces.configure(settings);
const fx = new FX($('#fx'), $('#floaters'));
setSound(settings.sound);

function tileOf(mode) {
  return TILES.find((t) => t.modes.includes(mode)).id;
}
function spiderMode() {
  return 'spider' + settings.spiderSuits;
}
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
const fmtNum = (n) => (n == null ? '–' : typeof n === 'string' ? n : Number(n).toLocaleString());

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- deals ----------

function chooseSeed(mode) {
  const list = settings.winnable ? WINNABLE[mode] : null;
  if (list && list.length) {
    const recent = new Set(store.recentSeeds(mode));
    const fresh = list.filter((x) => !recent.has(x));
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return randomSeed();
}
function dailySeed(mode, date) {
  const list = WINNABLE[mode];
  const h = hashString(mode + '|' + date);
  return list && list.length ? list[h % list.length] : (h % 999999998) + 1;
}

// ---------- the game in play ----------

class Play {
  constructor() {
    this.board = new Board($('#board'), faces, {
      tap: (p, i) => this.tap(p, i),
      canPick: (p, i) => !this.busy && !this.won && this.game.canPick(this.s, p, i),
      dropMove: (p, i, t) => this.dropMove(p, i, t),
      drop: (p, i, t) => this.drop(p, i, t),
      rejected: (p, i, near) => this.rejected(p, i, near),
    });
    this.applyLook();
    this.mode = null;
    setInterval(() => this.tick(), 500);
  }

  get s() {
    return this.states[this.states.length - 1];
  }
  get slot() {
    return store.slotKey(this.mode, this.daily);
  }
  get inProgress() {
    return this.mode && this.started && !this.won;
  }

  applyLook() {
    this.board.speed = SPEED[settings.speed] || 1;
    this.board.large = settings.large;
    document.documentElement.style.setProperty('--t', 300 * this.board.speed + 'ms');
  }

  start(mode, { seed, daily = null, restart = false } = {}) {
    if (!restart && this.inProgress) store.recordLoss(this.mode);
    this.mode = mode;
    this.game = MODES[mode];
    this.daily = daily;
    this.seed = seed ?? (daily ? dailySeed(mode, daily) : chooseSeed(mode));
    if (!daily && settings.winnable) store.noteSeed(mode, this.seed);
    const s0 = this.game.deal(this.seed);
    this.states = [s0];
    this.keys = [this.game.key(s0)];
    this.groups = [];
    if (!restart) { this.elapsed = 0; this.started = false; }
    this.won = false;
    this.sel = null;
    this.busy = false;
    this.hintFor = -1;
    $('#stuck').hidden = true;
    this.board.root.classList.remove('celebrating');
    this.board.setGame(this.game, s0);
    this.dealIn();
    this.updateTitle();
    this.updateHud();
    this.save();
  }

  /** Rebuild a saved game by replaying its moves. */
  resume(data) {
    try {
      const game = MODES[data.mode];
      let s = game.deal(data.seed);
      const states = [s], keys = [game.key(s)];
      for (const g of data.groups) {
        for (const m of g) s = game.apply(s, m);
        states.push(s);
        keys.push(game.key(s));
      }
      Object.assign(this, {
        mode: data.mode, game, seed: data.seed, daily: data.daily || null, states, keys, groups: data.groups,
        elapsed: data.elapsed || 0, started: !!data.started, won: false, sel: null, busy: false, hintFor: -1,
      });
      $('#stuck').hidden = true;
      this.board.root.classList.remove('celebrating');
      this.board.setGame(game, s);
      this.dealIn();
      this.updateTitle();
      this.updateHud();
      return true;
    } catch (e) {
      console.warn('Could not restore saved game', e);
      return false;
    }
  }

  dealIn() {
    // Wait a frame so the board has its size, then fly the cards out.
    this.busy = true;
    requestAnimationFrame(() => {
      const ms = this.board.render(this.s, { deal: true });
      sfx.shuffle();
      setTimeout(() => sfx.deal(Math.min(8, Math.ceil(ms / 120))), 250);
      setTimeout(() => { this.busy = false; this.after(true); }, ms + 50);
    });
  }

  updateTitle() {
    const g = this.game;
    const name = g.family === 'spider' ? `Spider <small>${g.subtitle}</small>` : `${g.title} <small>${g.subtitle}</small>`;
    $('#game-name').innerHTML = name + (this.daily ? ` <small>Daily deal · ${prettyDate(this.daily)}</small>` : '');
    document.title = `${modeLabel(this.mode)} · Solitaire Parlor`;
  }

  updateHud() {
    if (!this.mode) return;
    const items = this.game.hud(this.s).map((h) => `<div><span>${h.label}</span> <b>${fmtNum(h.value)}</b></div>`);
    if (settings.showTimer) items.push(`<div><span>Time</span> <b>${fmtTime(this.elapsed)}</b></div>`);
    $('#hud').innerHTML = items.join('');
    $('[data-act="undo"].tb').disabled = this.states.length < 2 || this.won;
  }

  tick() {
    const now = performance.now();
    const dt = now - (this.lastTick || now);
    this.lastTick = now;
    if (this.started && !this.won && !$('#game').hidden && document.visibilityState === 'visible' && !$('#dialogs').classList.contains('open')) {
      this.elapsed += dt;
      if (settings.showTimer) {
        const b = $('#hud div:last-child b');
        if (b) b.textContent = fmtTime(this.elapsed);
      }
    }
  }

  save() {
    if (!this.mode) return;
    if (this.won) return store.clearGame(this.slot);
    store.saveGame(this.slot, { mode: this.mode, seed: this.seed, daily: this.daily, groups: this.groups, elapsed: Math.round(this.elapsed), started: this.started });
  }

  // ----- input -----

  tap(pile, i) {
    if (this.busy || this.won) return;
    unlock();
    const g = this.game, s = this.s;
    if (g.tap) return this.handle(g.tap(s, pile, i, this.sel), pile, i);
    if (pile === 'stock') {
      const m = g.moves(s).find((x) => x.t === 'deal' || x.t === 'recycle');
      if (m) return this.play(m);
      const why = g.explainStock?.(s);
      if (why) { toast(why); sfx.invalid(); }
      return;
    }
    if (i < 0) return;
    if (!g.canPick(s, pile, i)) return this.reject(pile, i);
    const cands = g.moves(s).filter((m) => m.t === 'm' && m.from === pile && m.i === i);
    if (!cands.length) return this.reject(pile, i);
    cands.sort((a, b) => g.tapScore(s, b) - g.tapScore(s, a));
    this.play(cands[0]);
  }

  handle(r, pile, i) {
    if (!r) return;
    if (r.move) return this.play(r.move);
    if ('select' in r) {
      this.sel = r.select;
      this.board.select(r.select);
      if (r.select) sfx.select();
      return;
    }
    if (r.say) { toast(r.say); sfx.invalid(); return; }
    if (r.shake) this.reject(pile, i);
  }

  reject(pile, i) {
    const cards = (this.s.piles[pile] || []).slice(Math.max(0, i));
    this.board.shake(cards.map((c) => c.id));
    sfx.invalid();
  }

  dropMove(pile, i, target) {
    const g = this.game, s = this.s;
    if (g.dropMove) return g.dropMove(s, pile, i, target);
    return g.canMove && g.canMove(s, pile, i, target) ? { t: 'm', from: pile, i, to: target } : null;
  }

  drop(pile, i, target) {
    if (this.busy || this.won) return false;
    const m = this.dropMove(pile, i, target);
    if (!m) return false;
    unlock();
    this.play(m);
    return true;
  }

  rejected(pile, i, near) {
    const msg = near && this.game.explainMove?.(this.s, pile, i, near);
    if (msg) toast(msg, 4000);
    sfx.invalid();
  }

  // ----- moves -----

  async play(move, { auto = false } = {}) {
    if (this.busy || this.won) return;
    this.busy = true;
    this.board.clearHint();
    if (this.sel) { this.sel = null; this.board.select(null); }
    $('#stuck').hidden = true;
    const g = this.game;
    let s;
    try {
      s = g.apply(this.s, move);
    } catch (e) {
      // Never leave the table locked because of a bad move; just redraw.
      console.warn('Move failed', move, e);
      this.busy = false;
      this.board.render(this.s);
      return;
    }
    const group = [move];
    await wait(this.show(this.s, s, move) * 0.8);
    for (let guard = 0; guard < 80; guard++) {
      let m = g.forced?.(s);
      if (!m && settings.autoPlay && g.safe) m = g.safe(s);
      if (!m) break;
      const n = g.apply(s, m);
      group.push(m);
      await wait(this.show(s, n, m) * 0.75);
      s = n;
    }
    this.commit(s, group, auto);
    this.busy = false;
    this.after();
  }

  commit(s, group, auto = false) {
    this.states.push(s);
    this.keys.push(this.game.key(s));
    this.groups.push(group);
    if (!this.started && !auto) {
      this.started = true;
      store.recordStart(this.mode);
    }
    this.updateHud();
    this.save();
  }

  /** Render one step and play its sound and sparkle. Returns the animation time. */
  show(prev, s, m) {
    const opts = {};
    if (m.t === 'deal') {
      const before = new Set(Object.values(prev.piles).flat().filter((c) => c.up).map((c) => c.id));
      opts.stagger = Object.entries(s.piles).filter(([p]) => p !== 'stock').flatMap(([, a]) => a).filter((c) => c.up && !before.has(c.id)).map((c) => c.id);
      opts.step = this.game.family === 'spider' ? 55 : 70;
    }
    if (m.t === 'run') {
      const f = s.fx.find((e) => e.k === 'run');
      opts.stagger = s.piles[f.pile].map((c) => c.id);
      opts.step = 40;
    }
    const ms = this.board.render(s, opts);
    this.effects(s, m, ms);
    return ms;
  }

  effects(s, m, ms) {
    const b = this.board;
    let sounded = false;
    for (const e of s.fx || []) {
      if (e.k === 'flip') setTimeout(() => sfx.flip(), ms * 0.5);
      else if (e.k === 'home') {
        sounded = true;
        sfx.home(e.r);
        setTimeout(() => {
          const p = b.pilePoint(e.pile);
          fx.burst(p.x, p.y, { count: e.r === 13 ? 50 : 14, speed: e.r === 13 ? 6 : 3 });
          if (e.r === 13) sfx.sparkle();
        }, ms * 0.8);
      } else if (e.k === 'deal') { sounded = true; sfx.deal(m.t === 'deal' && this.game.family === 'spider' ? 8 : 2); }
      else if (e.k === 'recycle') { sounded = true; sfx.shuffle(); }
      else if (e.k === 'run') {
        sounded = true;
        setTimeout(() => {
          sfx.run();
          const p = b.pilePoint(e.pile);
          fx.burst(p.x, p.y, { count: 70, speed: 7, colors: ['#ffe28a', '#fff', '#ffb3c1', '#9be7ff'] });
          fx.say(p.x + 60, p.y - 50, pick(['Run complete!', 'One down!', 'Lovely run!', 'Gone home!']));
        }, ms * 0.9);
      } else if (e.k === 'pair') {
        sounded = true;
        sfx.pair();
        setTimeout(() => {
          const p = b.pilePoint('discard');
          fx.burst(p.x, p.y, { count: 18, speed: 3.5 });
        }, ms * 0.8);
      } else if (e.k === 'row') {
        setTimeout(() => {
          const r = b.root.getBoundingClientRect();
          fx.say(r.left + r.width / 2, r.top + r.height * 0.4, 'Row cleared!');
        }, ms);
      } else if (e.k === 'chain') {
        sounded = true;
        sfx.chain(e.n);
        if (e.n >= 5 && (e.n % 5 === 0 || e.n >= 10)) {
          setTimeout(() => {
            const p = b.pilePoint('waste');
            fx.say(p.x, p.y - 70, `Streak ×${e.n}!`, e.n >= 10 ? 'big' : '');
            fx.burst(p.x, p.y, { count: 12 + e.n * 2, speed: 4, suits: e.n >= 10 });
          }, ms * 0.7);
        }
      } else if (e.k === 'peak') {
        setTimeout(() => {
          const p = b.pilePoint(e.pile);
          fx.burst(p.x, p.y, { count: 60, speed: 6, suits: true, colors: ['#ffe28a', '#fff', '#ff9eb5'] });
          if (e.left) fx.say(p.x, p.y, 'Peak cleared!', 'big');
          sfx.sparkle();
        }, ms * 0.6);
      }
    }
    if (!sounded) setTimeout(() => sfx.place(), ms * 0.75);
  }

  after(fromDeal) {
    const g = this.game, s = this.s;
    this.updateHud();
    if (g.isWon(s)) return this.win();
    if (g.canFinish?.(s)) return this.autoFinish();
    if (!fromDeal && this.isStuck()) $('#stuck').hidden = false;
    else if (fromDeal && settings.autoPlay && g.safe && g.safe(s)) this.play(g.safe(s), { auto: true });
  }

  isStuck() {
    const g = this.game, s = this.s;
    const seen = new Set(this.keys);
    for (const m of g.moves(s)) if (!seen.has(g.key(settle(g, g.apply(s, m))))) return false;
    return true;
  }

  async autoFinish() {
    if (this.busy) return;
    this.busy = true;
    toast('Finishing up…', 1500);
    const g = this.game;
    let s = this.s;
    const group = [];
    await wait(250);
    for (let guard = 0; guard < 120 && !g.isWon(s); guard++) {
      const m = g.finishMove(s);
      if (!m) break;
      const n = g.apply(s, m);
      group.push(m);
      this.board.speed = (SPEED[settings.speed] || 1) * 0.55;
      const ms = this.show(s, n, m);
      s = n;
      await wait(ms * 0.45);
    }
    this.applyLook();
    await wait(300);
    if (group.length) this.commit(s, group);
    this.busy = false;
    this.after();
  }

  undo() {
    if (this.busy || this.won || this.states.length < 2) return;
    this.states.pop();
    this.keys.pop();
    this.groups.pop();
    this.sel = null;
    this.board.select(null);
    this.board.clearHint();
    $('#stuck').hidden = true;
    this.board.render(this.s);
    sfx.whoosh();
    this.updateHud();
    this.save();
  }

  // ----- hints -----

  hint() {
    if (this.busy || this.won) return;
    unlock();
    if (this.hintFor !== this.states.length) {
      this.hints = this.computeHints();
      this.hintIdx = 0;
      this.hintFor = this.states.length;
    }
    if (!this.hints.length) {
      $('#stuck').hidden = false;
      toast('No more useful moves. Try Undo, or deal a new game.', 3500);
      return;
    }
    const m = this.hints[this.hintIdx++ % this.hints.length];
    const s = this.s, P = s.piles;
    const topId = (p) => (P[p].length ? [P[p][P[p].length - 1].id] : []);
    sfx.select();
    if (m.t === 'm') this.board.hint(P[m.from].slice(m.i).map((c) => c.id), m.to);
    else if (m.t === 'pair') this.board.hint([...topId(m.a), ...topId(m.b)]);
    else if (m.t === 'king') this.board.hint(topId(m.a), 'discard');
    else if (m.t === 'deal') { this.board.hint(topId('stock')); toast('Deal from the deck.'); }
    else if (m.t === 'recycle') { this.board.hint([], 'stock'); toast('Turn the deck over and go through it again.'); }
  }

  computeHints() {
    const g = this.game, s = this.s;
    const seen = new Set(this.keys);
    const e0 = g.eval(s);
    const cands = [];
    for (const m of g.moves(s)) {
      const n = settle(g, g.apply(s, m));
      if (seen.has(g.key(n))) continue;
      let v = g.eval(n) - e0 + (g.tapScore ? g.tapScore(s, m) * 0.05 : 0);
      if (m.t === 'deal' || m.t === 'recycle') v -= 1000;
      cands.push({ m, v });
    }
    cands.sort((a, b) => b.v - a.v);
    const list = cands.map((c) => c.m);
    // A short search for a real winning line; its first move goes first.
    const path = solve(g, s, { maxNodes: 4000, timeMs: 160 });
    if (path && path.length) {
      const k = JSON.stringify(path[0]);
      const at = list.findIndex((m) => JSON.stringify(m) === k);
      if (at > 0) list.unshift(list.splice(at, 1)[0]);
      else if (at < 0) list.unshift(path[0]);
    }
    return list;
  }

  // ----- winning -----

  async win() {
    if (this.won) return;
    this.won = true;
    this.busy = true;
    $('#stuck').hidden = true;
    const s = this.s;
    const time = Math.round(this.elapsed);
    const res = store.recordWin(this.mode, { time, moves: s.moves, score: s.score ?? null });
    let dailyNote = null;
    if (this.daily) {
      store.recordDaily(this.daily, tileOf(this.mode), { mode: this.mode, time, moves: s.moves });
      dailyNote = 'Daily deal complete!';
    }
    store.clearGame(this.slot);
    this.updateHud();
    await wait(450);

    const golden = Math.random() < 0.07;
    const kind = pickKind(store.celebrationsSeen);
    store.noteCelebration(golden ? 'golden' : kind);
    const headline = pick(HEADLINES);
    await this.celebrate(kind, golden, headline);
    this.busy = false;
    winDialog({ headline, time, s, res, dailyNote, mode: this.mode, daily: this.daily });
  }

  /** Gather card pictures and positions for a celebration and run it. */
  async celebrate(kind, golden, headline) {
    const b = this.board, r = b.root.getBoundingClientRect();
    const cards = [];
    for (const [pid, pile] of Object.entries(this.s.piles))
      for (const c of pile) {
        const rect = b.cardRect(c.id);
        cards.push({ src: faces.face(c), x: r.left + rect.x, y: r.top + rect.y, w: rect.w, h: rect.h, pile: pid });
      }
    await celebrate({ kind, golden, cards, headline, onStart: () => b.root.classList.add('celebrating') });
    b.root.classList.remove('celebrating');
  }
}

const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------- screens ----------

let play;

function showMenu(push = true) {
  if (play?.mode) { play.save(); }
  $('#game').hidden = true;
  $('#menu').hidden = false;
  $('#stuck').hidden = true;
  document.title = 'Solitaire Parlor';
  renderMenu();
  if (push && location.hash) history.pushState(null, '', location.pathname + location.search);
}

function showGame() {
  $('#menu').hidden = true;
  $('#game').hidden = false;
  if (!location.hash) history.pushState(null, '', '#play');
}

function openMode(mode, { fresh = false, daily = null } = {}) {
  unlock();
  settings.lastTile = tileOf(mode);
  store.saveSettings();
  showGame();
  const saved = !fresh && store.loadGame(store.slotKey(mode, daily));
  if (saved && play.resume(saved)) return;
  play.mode = null;
  play.start(mode, { daily });
}

addEventListener('popstate', () => {
  if (!location.hash && !$('#game').hidden) showMenu(false);
});

// ---------- menu ----------

const ART = {
  spider: [0, 1, 2].flatMap((col) => [[13, 0], [12, 0], [11, 0], [10, 0]].slice(col === 1 ? 0 : 1, col === 1 ? 4 : 3).map(([r, s], k) => ({ r: col === 1 ? r : r - 2 - col, s: col === 2 ? 1 : 0, x: (col - 1) * 1.12, y: k * 0.3 + (col === 1 ? 0 : 0.3), z: k }))),
  klondike1: [[13, 0], [12, 1], [11, 3], [10, 2]].map(([r, s], k) => ({ r, s, x: 0, y: k * 0.3, z: k })).concat([{ back: true, x: -1.25, y: 0, z: 0 }, { r: 1, s: 1, x: 1.25, y: 0, z: 0 }]),
  klondike3: [{ back: true, x: -2.0, y: -0.5 }, { back: true, x: -1.97, y: -0.53 }, { r: 7, s: 2, x: -0.75, y: -0.5 }, { r: 8, s: 3, x: -0.35, y: -0.5 }, { r: 9, s: 1, x: 0.05, y: -0.5 }, { r: 1, s: 0, x: 1.3, y: -0.5 }].map((c, k) => ({ ...c, z: k })),
  freecell: [[1, 0], [1, 1], [1, 2], [1, 3]].map(([r, s], k) => ({ r, s, x: -0.5 + (k - 1.5) * 0.85, y: -0.5 + Math.abs(k - 1.5) * 0.18, rot: (k - 1.5) * 9, z: k })),
  pyramid: [[0, 0, 13, 3], [1, 0, 6, 1], [1, 1, 7, 0], [2, 0, 4, 2], [2, 1, 9, 3], [2, 2, 12, 1]].map(([row, k, r, s], n) => ({ r, s, x: -0.5 + (k - row / 2) * 1.08, y: -1.25 + row * 0.55, z: n })),
  tripeaks: [0, 1, 2].flatMap((p) => [
    { r: [5, 9, 12][p], s: p, x: (p - 1) * 1.75, y: 0, z: 1, back: true },
    { r: [4, 10, 11][p], s: (p + 1) % 4, x: (p - 1) * 1.75 - 0.42, y: 0.55, z: 2 },
    { r: [6, 8, 13][p], s: (p + 2) % 4, x: (p - 1) * 1.75 + 0.42, y: 0.55, z: 2 },
  ]),
};

function tileArt(el, id) {
  el.textContent = '';
  const U = 62, CH = 87;
  const cs = ART[id];
  const x0 = Math.min(...cs.map((c) => c.x * U)), x1 = Math.max(...cs.map((c) => c.x * U + U));
  const y0 = Math.min(...cs.map((c) => c.y * U)), y1 = Math.max(...cs.map((c) => c.y * U + CH));
  const ox = -(x0 + x1) / 2, oy = -(y0 + y1) / 2 + 4;
  for (const c of cs) {
    const d = document.createElement('div');
    d.className = 'mini';
    d.style.backgroundImage = `url("${c.back ? faces.back : faces.face(c)}")`;
    d.style.transform = `translate(${c.x * U + ox}px, ${c.y * U + oy}px) rotate(${c.rot || 0}deg)`;
    d.style.zIndex = c.z || 0;
    d.dataset.base = d.style.transform;
    el.append(d);
  }
  el.onmouseenter = () => $$('.mini', el).forEach((d, k) => (d.style.transform = d.dataset.base + ` translateY(${-4 - (k % 3) * 2}px) rotate(${(k % 2 ? 1 : -1) * 2}deg)`));
  el.onmouseleave = () => $$('.mini', el).forEach((d) => (d.style.transform = d.dataset.base));
}

function renderMenu() {
  const wrap = $('#tiles');
  wrap.textContent = '';
  for (const t of TILES) {
    const mode = t.id === 'spider' ? spiderMode() : t.modes[0];
    const saved = store.loadGame(mode);
    const st = store.statsFor(mode);
    const el = document.createElement('article');
    el.className = 'tile';
    el.innerHTML = `
      <div class="art" title="Play ${t.title}"></div>
      ${saved && saved.started ? '<div class="badge">Game in progress</div>' : ''}
      <div class="info">
        <h3>${t.title}</h3>
        <p>${t.blurb}</p>
        ${t.id === 'spider' ? `<div class="seg" role="group" aria-label="Number of suits">${[1, 2, 4].map((n) => `<button data-suits="${n}" class="${settings.spiderSuits === n ? 'on' : ''}">${n} suit${n > 1 ? 's' : ''}</button>`).join('')}</div>` : ''}
        <div class="tstats">${st.played ? `Won ${st.won} of ${st.played}${st.bestTime ? ` · Best time ${fmtTime(st.bestTime)}` : ''}${st.streak > 1 ? ` · ${st.streak} wins in a row` : ''}` : 'Not played yet'}</div>
        <div class="actions">
          ${saved && saved.started ? '<button class="btn primary" data-go="resume">Continue</button><button class="btn" data-go="new">New game</button>' : '<button class="btn primary" data-go="new">Play</button>'}
        </div>
      </div>`;
    tileArt($('.art', el), t.id);
    $('.art', el).onclick = () => openMode(mode, { fresh: !(saved && saved.started) });
    $$('[data-go]', el).forEach((b) => (b.onclick = () => openMode(mode, { fresh: b.dataset.go === 'new' })));
    $$('[data-suits]', el).forEach((b) => (b.onclick = () => {
      settings.spiderSuits = +b.dataset.suits;
      store.saveSettings();
      renderMenu();
    }));
    wrap.append(el);
  }
  renderDailyStrip();
}

function renderDailyStrip() {
  const today = store.dateKey();
  const done = store.dailyDay(today);
  const n = Object.keys(done).length;
  const streak = store.dailyStreak(today);
  const short = { spider: 'Sp', klondike1: 'Cl', klondike3: 'Kl', freecell: 'Fc', pyramid: 'Py', tripeaks: 'Tp' };
  $('#daily-strip').innerHTML = `
    <div><div class="dlabel">Today’s daily deals</div>
    <div class="dsub">${n === 6 ? 'All six done today. Wonderful!' : `${n} of 6 played today`}${streak > 1 ? ` · ${streak}-day streak` : ''}</div></div>
    <div class="dots">${TILES.map((t) => `<div class="dot ${done[t.id] ? 'done' : ''}" title="${t.title}">${done[t.id] ? '★' : short[t.id]}</div>`).join('')}</div>
    <button data-act="daily">Play today’s deals</button>`;
}

// ---------- dialogs ----------

function openDialog(html, { wide = false, onClose } = {}) {
  const host = $('#dialogs');
  host.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="close" title="Close"><svg><use href="#i-close"/></svg></button>${html}</div>`;
  host.classList.add('open');
  const d = $('.dialog', host);
  const close = () => {
    host.classList.remove('open');
    host.innerHTML = '';
    onClose?.();
  };
  $('.close', d).onclick = close;
  host.onclick = (e) => { if (e.target === host) close(); };
  dialogClose = close;
  return { d, close };
}
let dialogClose = null;
const dialogOpen = () => $('#dialogs').classList.contains('open');

function confirmDialog(title, text, yes, no, onYes) {
  const { d, close } = openDialog(`<h2>${title}</h2><p>${text}</p><div class="buttons"><button class="btn" data-no>${no}</button><button class="btn primary" data-yes>${yes}</button></div>`);
  $('[data-no]', d).onclick = close;
  $('[data-yes]', d).onclick = () => { close(); onYes(); };
}

function prettyDate(key) {
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function helpDialog() {
  const g = play.game;
  openDialog(`<h2>How to play ${g.family === 'spider' ? 'Spider' : g.title}</h2><ul class="rules">${g.help.map((h) => `<li>${h}</li>`).join('')}</ul>
    <h3>Handy keys</h3><p>Undo: Ctrl+Z &nbsp;·&nbsp; Hint: H &nbsp;·&nbsp; New game: N &nbsp;·&nbsp; Full screen: F</p>
    <p style="color:var(--muted);font-size:15px">Deal number ${play.seed}${settings.winnable && WINNABLE[play.mode] ? ' · this deal can be won' : ''}</p>`);
}

function winDialog({ headline, time, s, res, dailyNote, mode, daily }) {
  const st = res.stats;
  const notes = [...res.notes];
  if (dailyNote) notes.unshift(dailyNote);
  if (st.streak > 1 && !notes.some((n) => n.includes('in a row'))) notes.push(`${st.streak} wins in a row`);
  const cells = [`<div><b>${fmtTime(time)}</b><span>Time</span></div>`, `<div><b>${s.moves}</b><span>Moves</span></div>`];
  if (s.score != null) cells.push(`<div><b>${fmtNum(s.score)}</b><span>Score</span></div>`);
  cells.push(`<div><b>${st.won}</b><span>Games won</span></div>`);
  const { d, close } = openDialog(`
    <div class="win-head"><h2>${headline}</h2><p style="margin:0;color:var(--muted)">You won ${modeLabel(mode)}${daily ? ' · daily deal' : ''}.</p></div>
    <div class="win-grid">${cells.join('')}</div>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <div class="buttons">
      <button class="btn" data-menu>Menu</button>
      <button class="btn" data-again>Play this deal again</button>
      <button class="btn primary" data-new>${daily ? 'More daily deals' : 'Deal a new game'}</button>
    </div>`, { onClose: () => {} });
  $('[data-menu]', d).onclick = () => { close(); showMenu(); };
  $('[data-again]', d).onclick = () => { close(); play.start(mode, { seed: play.seed, daily }); };
  $('[data-new]', d).onclick = () => { close(); if (daily) { showMenu(); dailyDialog(); } else play.start(mode); };
}

function statsDialog() {
  const rows = Object.keys(MODES).map((m) => {
    const s = store.statsFor(m);
    const pct = s.played ? Math.round((100 * s.won) / s.played) + '%' : '–';
    return `<tr><td>${modeLabel(m)}</td><td>${s.played}</td><td>${s.won}</td><td>${pct}</td><td>${s.streak}</td><td>${s.bestStreak}</td><td>${s.bestTime ? fmtTime(s.bestTime) : '–'}</td><td>${fmtNum(s.bestScore)}</td></tr>`;
  });
  const seen = store.celebrationsSeen;
  const { d, close } = openDialog(`<h2>Statistics</h2>
    <div class="table-wrap"><table class="stats"><thead><tr><th>Game</th><th>Played</th><th>Won</th><th>Win %</th><th>Streak</th><th>Best streak</th><th>Best time</th><th>High score</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <h3>Celebrations</h3><p style="font-size:15px;color:var(--muted)">There are ${KINDS.length} different ways to celebrate a win, plus a rare golden one. Recently: ${seen.length ? [...new Set(seen.slice(-5))].map((k) => KIND_NAMES[k]).join(', ') : 'none yet'}.</p>
    <div class="buttons"><button class="btn" data-reset>Reset statistics</button><button class="btn primary" data-ok>Done</button></div>`, { wide: true });
  $('[data-ok]', d).onclick = close;
  $('[data-reset]', d).onclick = () => confirmDialog('Reset statistics?', 'This clears wins, streaks and best times for every game. It cannot be undone.', 'Reset', 'Cancel', () => { store.resetStats(); renderMenu(); statsDialog(); });
}

function dailyDialog(monthOffset = 0, selected = null) {
  const today = store.dateKey();
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear(), mo = base.getMonth();
  const days = new Date(y, mo + 1, 0).getDate();
  const startDow = new Date(y, mo, 1).getDay();
  const sel = selected || today;
  let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const won = Object.keys(store.dailyDay(key)).length;
    const future = key > today;
    const cls = ['day', key === today ? 'today' : '', future ? 'future' : '', key === sel ? 'sel' : '', won === 6 ? 'all' : ''].join(' ');
    cells += future ? `<div class="${cls}">${d}</div>` : `<button class="${cls}" data-day="${key}">${d}<span class="stars">${'★'.repeat(Math.min(won, 6))}</span></button>`;
  }
  const done = store.dailyDay(sel);
  const list = TILES.map((t) => {
    const mode = t.id === 'spider' ? spiderMode() : t.modes[0];
    const r = done[t.id];
    const saved = store.loadGame(store.slotKey(mode, sel));
    return `<div class="ditem"><div class="nm">${t.id === 'spider' ? modeLabel(mode) : t.title}</div>${r ? `<span class="ok">✓ Won in ${fmtTime(r.time)}</span>` : ''}<button data-play="${mode}">${r ? 'Play again' : saved && saved.started ? 'Continue' : 'Play'}</button></div>`;
  }).join('');
  const streak = store.dailyStreak(today);
  const { d, close } = openDialog(`<h2>Daily deals</h2>
    <p style="margin-top:-6px;color:var(--muted)">One deal for each game every day, and every one can be won. Win any of them to keep your streak going${streak > 1 ? ` (now ${streak} days)` : ''}.</p>
    <div class="daily-grid"><div>
    <div class="cal-head"><button data-m="-1" title="Previous month">‹</button><b>${base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button data-m="1" title="Next month" ${monthOffset >= 0 ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    <div class="cal">${cells}</div></div>
    <div><h3 style="margin-top:4px">${sel === today ? 'Today' : prettyDate(sel)}</h3>
    <div class="dlist">${list}</div></div></div>`, { wide: true });
  $$('[data-m]', d).forEach((b) => (b.onclick = () => { if (!b.disabled) dailyDialog(monthOffset + +b.dataset.m); }));
  $$('[data-day]', d).forEach((b) => (b.onclick = () => dailyDialog(monthOffset, b.dataset.day)));
  $$('[data-play]', d).forEach((b) => (b.onclick = () => {
    close();
    const mode = b.dataset.play;
    const fresh = !!done[tileOf(mode)];
    openMode(mode, { daily: sel, fresh });
  }));
}

function settingsDialog() {
  const sw = (key) => `<button class="switch ${settings[key] ? 'on' : ''}" data-key="${key}" role="switch" aria-checked="${!!settings[key]}"></button>`;
  const { d } = openDialog(`<h2>Settings</h2>
    <h3>Table</h3><div class="swatches">${Object.entries(TABLES).map(([k, c]) => `<button class="swatch ${settings.table === k ? 'on' : ''}" data-table="${k}" title="${k}" style="background:${c}"></button>`).join('')}</div>
    <h3>Card back</h3><div class="backs" id="backs"></div>
    <h3>Cards</h3>
    <div class="row"><div class="lbl">Large print<small>Bigger numbers and suit symbols</small></div>${sw('large')}</div>
    <div class="row"><div class="lbl">Four-color suits<small>Diamonds blue, clubs green: easier to tell apart</small></div>${sw('fourColor')}</div>
    <h3>Play</h3>
    <div class="row"><div class="lbl">Winnable deals only<small>Every new deal has been checked and can be won (Spider with 4 suits not included)</small></div>${sw('winnable')}</div>
    <div class="row"><div class="lbl">Move cards home automatically<small>Sends cards to the foundations when it is safe (Klondike and FreeCell)</small></div>${sw('autoPlay')}</div>
    <div class="row"><div class="lbl">Show timer</div>${sw('showTimer')}</div>
    <div class="row"><div class="lbl">Sound effects</div>${sw('sound')}</div>
    <div class="row"><div class="lbl">Animation speed</div><div class="seg" style="flex:0 0 280px">${['relaxed', 'normal', 'quick'].map((k) => `<button data-speed="${k}" class="${settings.speed === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
    <div class="buttons"><button class="btn" data-preview>Preview a win celebration</button></div>`);
  const backs = $('#backs', d);
  const draw = () => {
    backs.innerHTML = Object.entries(BACKS).map(([k, b]) => `<button data-back="${k}" title="${b.name}" class="${settings.back === k ? 'on' : ''}"></button>`).join('');
    // Each thumbnail needs its own art; build them from a temporary Faces.
    $$('[data-back]', backs).forEach((b) => {
      const tmp = new Faces();
      tmp.configure({ ...settings, back: b.dataset.back });
      b.style.backgroundImage = `url("${tmp.back}")`;
      b.onclick = () => { settings.back = b.dataset.back; changed(); draw(); };
    });
  };
  draw();
  $$('[data-table]', d).forEach((b) => (b.onclick = () => {
    settings.table = b.dataset.table;
    $$('[data-table]', d).forEach((x) => x.classList.toggle('on', x === b));
    changed();
  }));
  $$('.switch', d).forEach((b) => (b.onclick = () => {
    settings[b.dataset.key] = !settings[b.dataset.key];
    b.classList.toggle('on', settings[b.dataset.key]);
    b.setAttribute('aria-checked', settings[b.dataset.key]);
    changed();
  }));
  $$('[data-speed]', d).forEach((b) => (b.onclick = () => {
    settings.speed = b.dataset.speed;
    $$('[data-speed]', d).forEach((x) => x.classList.toggle('on', x === b));
    changed();
  }));
  $('[data-preview]', d).onclick = async () => {
    dialogClose?.();
    await previewCelebration();
  };
}

async function previewCelebration() {
  const kind = pickKind(store.celebrationsSeen);
  store.noteCelebration(kind);
  if (!$('#game').hidden && play.mode) return play.celebrate(kind, false, pick(HEADLINES));
  // From the menu: celebrate with a fresh deck laid out in four piles.
  const W = innerWidth, cw = Math.min(110, W / 10), ch = cw * 1.4;
  const cards = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) cards.push({ src: faces.face({ r, s }), x: W / 2 - 2 * (cw + 12) + s * (cw + 12), y: 120, w: cw, h: ch, pile: 'f' + s });
  await celebrate({ kind, golden: false, cards, headline: pick(HEADLINES) });
}

function changed() {
  store.saveSettings();
  document.body.dataset.table = settings.table;
  setSound(settings.sound);
  updateSoundButton();
  if (faces.configure(settings)) {
    play.board.refreshArt();
    if (!$('#menu').hidden) renderMenu();
  }
  play.applyLook();
  if (play.mode && !$('#game').hidden) {
    play.board.render(play.s, { instant: true });
    play.updateHud();
  }
}

function updateSoundButton() {
  const b = $('#toolbar [data-act="sound"]');
  b.querySelector('use').setAttribute('href', settings.sound ? '#i-sound' : '#i-mute');
  b.querySelector('span').textContent = settings.sound ? 'Sound' : 'Muted';
}

// ---------- full screen & install ----------

function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement) (doc.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => toast('Press F11 for full screen.'));
  else doc.exitFullscreen?.();
}
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  $$('[data-act="fullscreen"]').forEach((b) => {
    b.querySelector('use').setAttribute('href', on ? '#i-exitfull' : '#i-full');
    b.querySelector('span').textContent = on ? 'Exit full screen' : 'Full screen';
  });
});

let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('[data-act="install"]').hidden = false;
});
addEventListener('appinstalled', () => ($('[data-act="install"]').hidden = true));

// ---------- actions ----------

const ACTIONS = {
  menu: () => showMenu(),
  new: () => {
    if (!play.mode) return;
    if (play.inProgress && play.states.length > 2) confirmDialog('Start a new game?', 'This game will count as a loss in your statistics.', 'New game', 'Keep playing', () => play.start(play.mode));
    else play.start(play.mode);
  },
  restart: () => play.mode && !play.busy && play.start(play.mode, { seed: play.seed, daily: play.daily, restart: true }),
  undo: () => play.undo(),
  hint: () => play.hint(),
  help: () => helpDialog(),
  settings: () => settingsDialog(),
  stats: () => statsDialog(),
  daily: () => dailyDialog(),
  fullscreen: () => toggleFullscreen(),
  sound: () => { settings.sound = !settings.sound; changed(); if (settings.sound) { unlock(); sfx.select(); } },
  install: async () => { if (installPrompt) { installPrompt.prompt(); installPrompt = null; $('[data-act="install"]').hidden = true; } },
  'dismiss-stuck': () => ($('#stuck').hidden = true),
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.closest('.dialog')) return;
  unlock();
  ACTIONS[b.dataset.act]?.();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (dialogOpen()) return dialogClose?.();
    if (play.sel) { play.sel = null; play.board.select(null); return; }
    if (!$('#game').hidden) return showMenu();
    return;
  }
  if (dialogOpen() || e.altKey) return;
  const inGame = !$('#game').hidden;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (inGame) play.undo(); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (k === 'f') toggleFullscreen();
  else if (inGame && k === 'h') play.hint();
  else if (inGame && k === 'n') ACTIONS.new();
  else if (inGame && (k === ' ' || k === 'd')) { e.preventDefault(); play.tap('stock', -1); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && play?.mode) play.save();
});

// ---------- boot ----------

document.body.dataset.table = settings.table;
play = new Play();
updateSoundButton();
renderMenu();
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For quick checks from the console.
window.solitaire = { play, settings, MODES, celebrate: previewCelebration };
