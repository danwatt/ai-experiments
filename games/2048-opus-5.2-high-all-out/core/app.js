/* ==========================================================================
   Shared game shell: HUD, input (keys, swipe with drag-follow, arrows),
   sound, saving. Both 3D variants call HexApp.start() with their own
   renderer; everything a player touches outside the 3D view lives here, so
   the two engines are compared on rendering alone.

   Renderer contract (see playcanvas/renderer.js, babylon/renderer.js):
     init()                    Promise, after fonts are ready
     setBoard(topo, game)      rebuild board, sockets, stones; clears tiles
     apply(transition)         animate a move / undo / reset
     preview(peek|null, dist)  drag-follow
     hint(peek)  nudge(dir)    small tile wiggles
     celebrate(kind, info)     'win' | 'over' | 'milestone' | 'calm'
     layout(insets, opts)      frame the board inside the free screen area
     project(x, y, z)          world -> CSS px {x, y}
     setReduced(bool)          reduced motion
     setPointer(nx, ny)        -1..1, for a little parallax
     tileTop                   world y of a tile's top face
   ========================================================================== */
(function () {
'use strict';

const H = window.HexCore;
const K = window.HexKit;
const KEY = 'hex2048-allout:';
const VERSION = '1';

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// Physical key positions, layout independent:  Q W E   up-left  up  up-right
//                                               A S D   down-left down down-right
const KEYMAP = {
  KeyW: 0, KeyE: 1, KeyD: 2, KeyS: 3, KeyA: 4, KeyQ: 5,
  KeyI: 0, KeyO: 1, KeyL: 2, KeyK: 3, KeyJ: 4, KeyU: 5,
  Numpad8: 0, Numpad9: 1, Numpad3: 2, Numpad2: 3, Numpad1: 4, Numpad7: 5,
  ArrowUp: 0, ArrowDown: 3,
};
const DIR_KEYS = ['W', 'E', 'D', 'S', 'A', 'Q'];

const fmt = n => n.toLocaleString('en-US');
const $ = (sel, el = document) => el.querySelector(sel);
const now = () => performance.now();
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(pointer: coarse)');

const ICON = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  hint: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="M12 19V6M6 11.5 12 5.5l6 6"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
};
const svg = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/* ==========================================================================
   Sound: tiny WebAudio synth with two voices, wood (PlayCanvas tabletop)
   and glass (Babylon night).
   ========================================================================== */
class Sound {
  constructor(voice) {
    this.voice = voice;
    this.enabled = true;
    this.ctx = null;
  }
  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.5;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      // Short synthetic room for the glass voice.
      this.wet = c.createGain();
      this.wet.gain.value = this.voice === 'glass' ? 0.35 : 0.12;
      const conv = c.createConvolver();
      const len = c.sampleRate * (this.voice === 'glass' ? 1.8 : 0.6);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      conv.buffer = ir;
      this.wet.connect(conv).connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  // Pentatonic ladder: each doubling climbs one step.
  freq(exp) {
    const pent = [0, 2, 4, 7, 9];
    const e = Math.max(0, exp - 1);
    const semis = pent[e % 5] + 12 * Math.floor(e / 5);
    return (this.voice === 'glass' ? 330 : 196) * Math.pow(2, semis / 12);
  }
  tone(f, t, dur, gain, partials, type = 'sine') {
    const c = this.ctx;
    for (const [mult, g, decay] of partials) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const a = c.createGain();
      a.gain.setValueAtTime(0, t);
      a.gain.linearRampToValueAtTime(gain * g, t + 0.004);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
      o.connect(a);
      a.connect(this.master);
      a.connect(this.wet);
      o.start(t); o.stop(t + dur * decay + 0.05);
    }
  }
  burst(t, dur, gain, f0, f1, q = 1.2) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const a = c.createGain();
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(gain, t + 0.01);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(a).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  note(exp, t, gain = 0.32) {
    const f = this.freq(exp);
    if (this.voice === 'glass') this.tone(f, t, 1.5, gain * 0.8, [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.18, 0.25], [8.93, 0.07, 0.15]]);
    else this.tone(f, t, 0.55, gain, [[1, 1, 1], [3.9, 0.45, 0.25], [9.2, 0.12, 0.08]], 'sine');
  }
  slide(count) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    if (this.voice === 'glass') this.burst(t, 0.16, 0.05 + count * 0.004, 5200, 2600, 2.5);
    else this.burst(t, 0.13, 0.08 + count * 0.006, 1300, 420, 0.9);
  }
  merge(values) {
    const c = this.ensure(); if (!c || !values.length) return;
    const t = c.currentTime + 0.11;
    const sorted = [...values].sort((a, b) => a - b);
    sorted.slice(-4).forEach((v, i) => this.note(H.exponent(v), t + i * 0.045, 0.28 / Math.sqrt(1 + i * 0.6)));
  }
  spawn() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + 0.2;
    if (this.voice === 'glass') this.tone(2637, t, 0.25, 0.05, [[1, 1, 1]]);
    else this.burst(t + 0.07, 0.05, 0.07, 2600, 1800, 3);
  }
  blocked() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    this.tone(this.voice === 'glass' ? 110 : 82, t, 0.22, 0.25, [[1, 1, 1], [1.5, 0.3, 0.6]], 'triangle');
  }
  undo() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    this.burst(t, 0.14, 0.06, this.voice === 'glass' ? 2400 : 500, this.voice === 'glass' ? 5200 : 1300, 1.5);
  }
  fanfare(up = true) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + 0.05;
    const seq = up ? [5, 7, 9, 10, 12, 14] : [9, 7, 5, 3];
    seq.forEach((e, i) => this.note(e, t + i * (up ? 0.09 : 0.16), up ? 0.26 : 0.2));
  }
  tick() {
    const c = this.ensure(); if (!c) return;
    this.burst(c.currentTime, 0.03, 0.05, 3000, 2500, 4);
  }
}

/* ==========================================================================
   HUD markup
   ========================================================================== */
function hudHTML(cfg) {
  const boards = H.BOARDS.map(b => `
    <button class="seg" data-board="${b.id}" role="radio" aria-checked="false">
      <span class="seg-name">${b.name}</span>
      <span class="seg-sub">${b.cells} cells</span>
      <span class="seg-best" data-best="${b.id}"></span>
    </button>`).join('');
  const arrows = H.DIRS.map(d => `
    <button class="arrow" data-dir="${d.id}" aria-label="Slide ${d.name} (${DIR_KEYS[d.id]})">
      <span class="arrow-face">${svg('chev')}</span><kbd>${DIR_KEYS[d.id]}</kbd>
    </button>`).join('');
  return `
  <canvas id="scene" aria-label="Game board" role="img"></canvas>
  <div class="arrows" id="arrows">${arrows}</div>
  <div class="popups" id="popups" aria-hidden="true"></div>

  <header class="top" id="top">
    <div class="brand">
      <h1><span class="brand-hex">Hex</span><span class="brand-num">2048</span></h1>
      <p>${cfg.subtitle}</p>
    </div>
    <div class="goal" id="goal" title="Goal tile">
      <span class="goal-label">Goal</span>
      <span class="goal-tile" id="goalTile">2048</span>
      <span class="goal-bar"><i id="goalFill"></i></span>
    </div>
    <div class="scores">
      <div class="score"><span>Score</span><output id="score">0</output><em id="gain"></em></div>
      <div class="score"><span>Best</span><output id="best">0</output></div>
    </div>
  </header>

  <nav class="bar" id="bar" aria-label="Game controls">
    <button class="btn" id="undoBtn" title="Undo (Z)">${svg('undo')}<span>Undo</span></button>
    <button class="btn" id="hintBtn" title="Hint (H)">${svg('hint')}<span>Hint</span></button>
    <button class="btn primary" id="newBtn" title="New game (N)">${svg('plus')}<span id="newLabel">New</span></button>
    <button class="btn" id="menuBtn" title="Board, stones, settings" aria-haspopup="dialog">${svg('menu')}<span>Menu</span></button>
  </nav>

  <div class="sheet-scrim" id="scrim" hidden></div>
  <section class="sheet" id="menu" role="dialog" aria-modal="true" aria-labelledby="menuTitle" hidden>
    <div class="sheet-head">
      <h2 id="menuTitle">Game</h2>
      <button class="icon-btn" id="menuClose" aria-label="Close menu">${svg('close')}</button>
    </div>
    <div class="sheet-body">
      <h3>Board</h3>
      <div class="segs" role="radiogroup" aria-label="Board size">${boards}</div>
      <label class="row toggle">
        <span><b>Stones</b><small>Fixed blocks split the lanes. New layout every game.</small></span>
        <input type="checkbox" id="stonesToggle"><i></i>
      </label>
      <div class="confirm" id="confirm" hidden>
        <p id="confirmText">Start a new game with these settings?</p>
        <div><button class="btn primary" id="confirmYes">Start new game</button><button class="btn" id="confirmNo">Keep playing</button></div>
      </div>
      <h3>Settings</h3>
      <label class="row toggle"><span><b>Sound</b><small>M to toggle.</small></span><input type="checkbox" id="soundToggle"><i></i></label>
      <label class="row toggle"><span><b>Reduced motion</b><small>Shorter animations, no hops or camera sway.</small></span><input type="checkbox" id="motionToggle"><i></i></label>
      <a class="row link" id="otherLink" href="${cfg.other.href}">
        ${svg('swap')}<span><b>Play in ${cfg.other.name}</b><small>Same game, other engine. Your board comes with you.</small></span>
      </a>
      <h3>How to play</h3>
      <div class="howto">
        <div class="keys" aria-hidden="true">
          <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
        </div>
        <p>Every move slides <b>all</b> tiles as far as they go in one of six directions. Two equal tiles that meet merge into one. Reach the goal tile to win, then keep going.</p>
      </div>
      <p class="small">Drag or swipe the board: tiles follow your finger, let go early to cancel. Arrows work too. <kbd>Z</kbd> undo (unlimited; the next tile is fixed in advance, so undo never re-rolls), <kbd>H</kbd> hint, <kbd>N</kbd> new game. Numpad 7 8 9 / 1 2 3 and U I O / J K L also steer.</p>
      <p class="small credit">${cfg.credit}</p>
    </div>
  </section>

  <section class="card" id="card" role="dialog" aria-live="assertive" hidden>
    <p class="card-kicker" id="cardKicker"></p>
    <h2 id="cardTitle"></h2>
    <p class="card-text" id="cardText"></p>
    <div class="card-actions" id="cardActions"></div>
  </section>

  <div class="toast" id="toast" role="status"></div>
  <div class="coach" id="coach" hidden>
    <p><b>Slide all tiles</b> with <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, or drag the board. Tiles follow your finger; let go early to cancel.</p>
    <button class="btn" id="coachOk">Got it</button>
  </div>
  <div class="sr" id="live" aria-live="polite"></div>
  `;
}

/* ==========================================================================
   App
   ========================================================================== */
async function start(cfg) {
  const root = document.getElementById('app');
  root.dataset.variant = cfg.variant;
  root.insertAdjacentHTML('afterbegin', hudHTML(cfg));
  const loading = document.getElementById('loading');
  const canvas = $('#scene');

  const prefs = Object.assign({ board: 'classic', stones: false, sound: true, reduced: null, coached: false }, store.get('prefs', {}));
  const savePrefs = () => store.set('prefs', prefs);
  const bests = store.get('best', {});
  const bestKey = g => g.board.id + (g.stones ? '+stones' : '');

  const sound = new Sound(cfg.voice);
  sound.enabled = prefs.sound;

  let game = new H.Game({ board: prefs.board, stones: prefs.stones }, { saved: store.get('game') });

  // ?shot=<moves>[&board=grand&stones=1]: thumbnail mode. A fixed seed, the
  // hint bot plays ahead, nothing is saved. Used for the landing page images.
  const shot = new URLSearchParams(location.search);
  const shotMoves = +shot.get('shot') || 0;
  if (shotMoves) {
    prefs.coached = true;
    game = new H.Game({ board: shot.get('board') || 'classic', stones: shot.get('stones') === '1' }, { seed: +(shot.get('seed') || 7) });
    for (let i = 0; i < shotMoves && !game.over; i++) game.move(game.hint(4).dir);
    store.set = () => {};
  }
  const reduced = () => (prefs.reduced === null ? prefersReduced.matches : prefs.reduced);

  // Fonts first: tile faces are drawn into textures once.
  try {
    await Promise.race([
      Promise.all(cfg.fonts.map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* system fallback */ }

  let renderer;
  let ready = false; // the render loop may tick before the board exists
  try {
    renderer = cfg.createRenderer({ canvas, core: H, kit: K, feel: cfg.feel, onFrame: () => onFrame() });
    await renderer.init();
  } catch (err) {
    console.error(err);
    loading.innerHTML = `<div class="load-card"><h2>3D failed to start</h2><p>${String(err && err.message || err)}</p><p><a href="${cfg.other.href}">Try the ${cfg.other.name} version</a></p></div>`;
    return;
  }
  renderer.setReduced(reduced());

  /* ---------- DOM refs ---------- */
  const el = {
    score: $('#score'), best: $('#best'), gain: $('#gain'), goalTile: $('#goalTile'), goalFill: $('#goalFill'), goal: $('#goal'),
    undo: $('#undoBtn'), hint: $('#hintBtn'), newBtn: $('#newBtn'), newLabel: $('#newLabel'), menuBtn: $('#menuBtn'),
    menu: $('#menu'), scrim: $('#scrim'), menuClose: $('#menuClose'), stones: $('#stonesToggle'), sound: $('#soundToggle'),
    motion: $('#motionToggle'), confirm: $('#confirm'), confirmText: $('#confirmText'), confirmYes: $('#confirmYes'), confirmNo: $('#confirmNo'),
    card: $('#card'), cardKicker: $('#cardKicker'), cardTitle: $('#cardTitle'), cardText: $('#cardText'), cardActions: $('#cardActions'),
    toast: $('#toast'), live: $('#live'), popups: $('#popups'), arrows: [...document.querySelectorAll('.arrow')],
    arrowsWrap: $('#arrows'), top: $('#top'), bar: $('#bar'), coach: $('#coach'), coachOk: $('#coachOk'),
  };

  let cardOpen = null;   // 'win' | 'over' | null
  let menuOpen = false;

  /* ---------- Layout ---------- */
  const showArrows = () => !coarse.matches;
  // animate: glide the camera (used when an end card opens or closes, so
  // the card never covers the board).
  function layout(animate) {
    const top = el.top.getBoundingClientRect();
    const bar = el.bar.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    root.classList.toggle('touch', coarse.matches);
    let lowest = bar.top;
    if (cardOpen && !el.card.hidden) lowest = Math.min(lowest, el.card.getBoundingClientRect().top + 16);
    renderer.layout({ top: top.bottom + 4, bottom: h - lowest + 4, left: 0, right: 0 }, { arrows: showArrows(), width: w, height: h, animate: animate === true });
    onFrame();
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(root); ro.observe(el.top); ro.observe(el.bar);
  coarse.addEventListener('change', layout);

  // Screen directions, recomputed every frame the arrows are placed: the
  // camera tilts a little, so a swipe is matched against where each
  // direction really points on screen, not an idealised hexagon.
  let screenDirs = null;
  function measureDirs() {
    const o = renderer.project(0, 0, 0);
    screenDirs = H.DIRS.map(d => {
      const x = 1.5 * d.dq, z = K.SQRT3 * (d.dr + d.dq / 2); // one step = sqrt(3)
      const p = renderer.project(x, 0, z);
      const dx = p.x - o.x, dy = p.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      return { ux: dx / len, uy: dy / len, step: len, angle: Math.atan2(dy, dx) };
    });
    return screenDirs;
  }

  function onFrame() {
    if (!ready) return;
    measureDirs();
    if (!showArrows()) return;
    const m = K.boardMetrics(game.topo.radius);
    const r = m.circum + 0.62;
    for (const btn of el.arrows) {
      const d = H.DIRS[+btn.dataset.dir];
      const x = 1.5 * d.dq, z = K.SQRT3 * (d.dr + d.dq / 2);
      const len = Math.hypot(x, z);
      const p = renderer.project(x / len * r, 0, z / len * r);
      const a = screenDirs[d.id].angle * 180 / Math.PI + 90;
      btn.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      btn.firstElementChild.style.setProperty('--rot', a.toFixed(1) + 'deg');
    }
  }

  /* ---------- State display ---------- */
  let shownScore = game.score;
  function refresh() {
    const key = bestKey(game);
    const best = bests[key] || { score: 0, tile: 0 };
    el.score.textContent = fmt(game.score);
    el.best.textContent = fmt(Math.max(best.score, game.score));
    el.goalTile.textContent = fmt(game.goal);
    el.goalTile.dataset.tier = String(Math.min(17, H.exponent(game.goal)));
    // Log-scale progress: each doubling is one step toward the goal.
    const p = game.maxTile ? Math.min(1, H.exponent(game.maxTile) / H.exponent(game.goal)) : 0;
    el.goalFill.style.width = (p * 100).toFixed(1) + '%';
    el.goal.classList.toggle('done', game.won);
    el.undo.disabled = !game.canUndo;
    for (const btn of el.arrows) btn.classList.toggle('blocked', !game.canMove(+btn.dataset.dir));
    el.stones.checked = game.stones;
    for (const s of document.querySelectorAll('.seg')) {
      const on = s.dataset.board === game.board.id;
      s.setAttribute('aria-checked', String(on));
      const b = bests[s.dataset.board + (game.stones ? '+stones' : '')];
      s.querySelector('.seg-best').textContent = b && b.score ? `Best ${fmt(b.score)}` : `Goal ${fmt(game.stones ? H.boardById(s.dataset.board).stoneGoal : H.boardById(s.dataset.board).goal)}`;
    }
    shownScore = game.score;
  }

  function recordBest() {
    const key = bestKey(game);
    const b = bests[key] || { score: 0, tile: 0 };
    let beat = false;
    // Only worth a toast when the old best was a real game, once per game.
    if (game.score > b.score) { beat = b.score >= 500 && !game._beatBest; b.score = game.score; if (beat) game._beatBest = true; }
    b.tile = Math.max(b.tile, game.maxTile);
    bests[key] = b;
    store.set('best', bests);
    return beat;
  }

  function save() { store.set('game', game.serialize()); }

  let liveTimer = 0;
  function announce(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { el.live.textContent = text; }, 60);
  }

  let toastTimer = 0;
  function toast(html, ms = 1800) {
    el.toast.innerHTML = html;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }

  function popup(cell, text, cls = '') {
    const c = game.topo.cells[cell];
    const p = renderer.project(c.x, renderer.tileTop + 0.4, c.z);
    const s = document.createElement('div');
    s.className = 'pop ' + cls;
    s.textContent = text;
    s.style.left = p.x + 'px';
    s.style.top = p.y + 'px';
    el.popups.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }

  function bumpScore(gain) {
    if (!gain) return;
    el.gain.textContent = '+' + fmt(gain);
    el.gain.classList.remove('go');
    void el.gain.offsetWidth;
    el.gain.classList.add('go');
  }

  /* ---------- Cards ---------- */
  function showCard(kind) {
    cardOpen = kind;
    const key = bestKey(game);
    const best = bests[key] || { score: 0 };
    el.cardActions.innerHTML = '';
    const add = (label, cls, fn, hint) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.innerHTML = label + (hint ? ` <kbd>${hint}</kbd>` : '');
      b.addEventListener('click', fn);
      el.cardActions.appendChild(b);
      return b;
    };
    if (kind === 'win') {
      el.cardKicker.textContent = `${game.board.name}${game.stones ? ' · Stones' : ''}`;
      el.cardTitle.textContent = `${fmt(game.goal)} reached`;
      el.cardText.textContent = `${fmt(game.score)} points in ${fmt(game.moves)} moves. The board is still yours: keep merging for a bigger tile.`;
      add('Keep going', 'primary', () => hideCard(), 'Enter').focus({ preventScroll: true });
      add('New game', '', () => { hideCard(); newGame(true); });
    } else {
      el.cardKicker.textContent = 'No moves left';
      el.cardTitle.textContent = fmt(game.score);
      const top = game.maxTile;
      el.cardText.textContent = `Top tile ${fmt(top)} · ${fmt(game.moves)} moves` + (game.score >= best.score && game.score > 0 ? ' · new best' : ` · best ${fmt(best.score)}`);
      add('Undo', '', () => { hideCard(); undo(); }, 'Z');
      add('New game', 'primary', () => { hideCard(); newGame(true); }, 'Enter').focus({ preventScroll: true });
    }
    el.card.hidden = false;
    requestAnimationFrame(() => { el.card.classList.add('show'); layout(true); });
  }
  function hideCard() {
    if (!cardOpen) return;
    const wasOver = cardOpen === 'over';
    cardOpen = null;
    el.card.classList.remove('show');
    setTimeout(() => { if (!cardOpen) el.card.hidden = true; }, 220);
    layout(true);
    if (wasOver) renderer.celebrate('calm');
  }

  /* ---------- Actions ---------- */
  const peeks = new Map();
  const peek = dir => {
    if (!peeks.has(dir)) peeks.set(dir, game.peek(dir));
    return peeks.get(dir);
  };

  let hintDir = -1;
  function clearHint() {
    hintDir = -1;
    for (const b of el.arrows) b.classList.remove('hinted');
  }

  function move(dir) {
    if (cardOpen === 'win') hideCard();
    if (cardOpen || menuOpen) return false;
    const prevMax = game.maxTile;
    const tr = game.move(dir);
    peeks.clear();
    clearHint();
    if (!tr) {
      renderer.nudge(dir);
      sound.blocked();
      flashArrow(dir, 'nope');
      return false;
    }
    renderer.apply(tr);
    flashArrow(dir, 'go');
    const slid = tr.tiles.filter(t => t.kind === 'slide' || t.kind === 'consume').length;
    sound.slide(slid);
    if (tr.merges) {
      sound.merge(tr.mergeValues);
      if (navigator.vibrate && coarse.matches) { try { navigator.vibrate(tr.maxMerge >= 128 ? 18 : 8); } catch (e) { /* no haptics */ } }
      setTimeout(() => {
        for (const t of tr.tiles) if (t.kind === 'merge') popup(t.to, '+' + fmt(t.value), 'tier-' + Math.min(17, H.exponent(t.value)));
      }, (cfg.feel && cfg.feel.slide) || 125);
    }
    sound.spawn();
    bumpScore(tr.gain);
    const beat = recordBest();
    refresh();
    save();
    if (tr.maxTile > prevMax && tr.maxTile >= 128 && !tr.wonNow) {
      const cell = tr.tiles.find(t => t.kind === 'merge' && t.value === tr.maxTile);
      renderer.celebrate('milestone', { value: tr.maxTile, cell: cell ? cell.to : 0 });
      if (tr.maxTile >= Math.min(512, game.goal / 2)) toast(`<b>${fmt(tr.maxTile)}</b> new top tile`);
    } else if (beat) {
      toast('<b>New best score</b>');
    }
    announce(`Slid ${H.DIRS[dir].name}.` + (tr.merges ? ` Merged ${tr.mergeValues.map(fmt).join(', ')}.` : '') + ` Score ${fmt(game.score)}.`);
    if (tr.wonNow) {
      const cell = tr.tiles.find(t => t.kind === 'merge' && t.value === tr.maxTile);
      renderer.celebrate('win', { value: tr.maxTile, cell: cell ? cell.to : 0 });
      sound.fanfare(true);
      setTimeout(() => showCard('win'), 750);
    } else if (tr.over) {
      setTimeout(() => {
        if (!game.over) return;
        renderer.celebrate('over');
        sound.fanfare(false);
        showCard('over');
        announce(`No moves left. Final score ${fmt(game.score)}.`);
      }, 520);
    }
    return true;
  }

  function undo() {
    if (menuOpen) return;
    if (cardOpen) hideCard();
    const tr = game.undo();
    peeks.clear();
    clearHint();
    if (!tr) return;
    renderer.apply(tr);
    sound.undo();
    refresh();
    save();
    announce(`Undone. Score ${fmt(game.score)}.`);
  }

  function hint() {
    if (cardOpen || menuOpen || game.over) return;
    const h = game.hint(140);
    if (h.dir < 0) return;
    hintDir = h.dir;
    for (const b of el.arrows) b.classList.toggle('hinted', +b.dataset.dir === h.dir);
    renderer.hint(peek(h.dir));
    sound.tick();
    const k = DIR_KEYS[h.dir];
    toast(`Try <b>${H.DIRS[h.dir].glyph} ${H.DIRS[h.dir].name}</b> <kbd>${k}</kbd>`, 1600);
    announce(`Hint: slide ${H.DIRS[h.dir].name}, key ${k}.`);
  }

  let confirmNewUntil = 0;
  function newGame(force, config) {
    const cfgNext = config || { board: game.board.id, stones: game.stones };
    const inProgress = game.moves > 0 && !game.over;
    if (!force && inProgress && now() > confirmNewUntil) {
      confirmNewUntil = now() + 2600;
      el.newLabel.textContent = 'Sure?';
      el.newBtn.classList.add('confirming');
      setTimeout(() => { if (now() >= confirmNewUntil) { el.newLabel.textContent = 'New'; el.newBtn.classList.remove('confirming'); } }, 2700);
      return;
    }
    confirmNewUntil = 0;
    el.newLabel.textContent = 'New';
    el.newBtn.classList.remove('confirming');
    hideCard();
    const boardChanged = cfgNext.board !== game.board.id || true; // stones move every game
    prefs.board = cfgNext.board; prefs.stones = cfgNext.stones; savePrefs();
    const tr = game.reset(cfgNext);
    peeks.clear();
    clearHint();
    if (boardChanged) renderer.setBoard(game.topo, game);
    renderer.celebrate('calm');
    renderer.apply(tr);
    layout();
    sound.tick();
    refresh();
    save();
    announce(`New ${game.board.name} game${game.stones ? ' with stones' : ''}. Goal ${fmt(game.goal)}.`);
  }

  function flashArrow(dir, cls) {
    const b = el.arrows[dir];
    if (!b) return;
    b.classList.remove('go', 'nope');
    void b.offsetWidth;
    b.classList.add(cls);
  }

  /* ---------- Menu ---------- */
  let pending = null;
  function openMenu() {
    menuOpen = true;
    renderer.preview(null, 0);
    el.menu.hidden = false; el.scrim.hidden = false;
    requestAnimationFrame(() => { el.menu.classList.add('show'); el.scrim.classList.add('show'); });
    el.sound.checked = sound.enabled;
    el.motion.checked = reduced();
    el.confirm.hidden = true;
    pending = null;
    refresh();
    el.menuClose.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    el.menu.classList.remove('show'); el.scrim.classList.remove('show');
    setTimeout(() => { if (!menuOpen) { el.menu.hidden = true; el.scrim.hidden = true; } }, 240);
    el.menuBtn.focus({ preventScroll: true });
  }
  function requestConfig(config) {
    const inProgress = game.moves > 0 && !game.over;
    if (!inProgress) { newGame(true, config); refresh(); return; }
    pending = config;
    const b = H.boardById(config.board);
    el.confirmText.textContent = `Start a new ${b.name}${config.stones ? ' + Stones' : ''} game? This one (${fmt(game.score)} points) will end.`;
    el.confirm.hidden = false;
    // show what is pending
    for (const s of document.querySelectorAll('.seg')) s.setAttribute('aria-checked', String(s.dataset.board === config.board));
    el.stones.checked = config.stones;
  }
  for (const s of document.querySelectorAll('.seg')) {
    s.addEventListener('click', () => requestConfig({ board: s.dataset.board, stones: pending ? pending.stones : game.stones }));
  }
  el.stones.addEventListener('change', () => requestConfig({ board: pending ? pending.board : game.board.id, stones: el.stones.checked }));
  el.confirmYes.addEventListener('click', () => { if (pending) newGame(true, pending); pending = null; el.confirm.hidden = true; closeMenu(); });
  el.confirmNo.addEventListener('click', () => { pending = null; el.confirm.hidden = true; refresh(); });
  el.sound.addEventListener('change', () => { sound.enabled = prefs.sound = el.sound.checked; savePrefs(); if (sound.enabled) sound.tick(); });
  el.motion.addEventListener('change', () => { prefs.reduced = el.motion.checked; savePrefs(); renderer.setReduced(reduced()); });
  el.menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
  el.menuClose.addEventListener('click', closeMenu);
  el.scrim.addEventListener('click', closeMenu);
  $('#otherLink').addEventListener('click', () => save());

  el.undo.addEventListener('click', undo);
  el.hint.addEventListener('click', hint);
  el.newBtn.addEventListener('click', () => newGame(false));
  el.coachOk.addEventListener('click', () => { el.coach.hidden = true; prefs.coached = true; savePrefs(); layout(); });

  /* ---------- Arrows ---------- */
  for (const btn of el.arrows) {
    const dir = +btn.dataset.dir;
    btn.addEventListener('click', () => { renderer.preview(null, 0); move(dir); });
    btn.addEventListener('pointerenter', e => {
      if (e.pointerType !== 'mouse' || cardOpen || menuOpen) return;
      renderer.preview(peek(dir), 0.55);
    });
    btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) renderer.preview(null, 0); });
  }

  /* ---------- Keyboard ---------- */
  let lastKeyMove = 0;
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Escape') { if (menuOpen) closeMenu(); else if (cardOpen === 'win') hideCard(); return; }
    if (menuOpen) return;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (mod || e.altKey) return;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && cardOpen) {
      e.preventDefault();
      if (cardOpen === 'win') hideCard(); else { hideCard(); newGame(true); }
      return;
    }
    if (e.code in KEYMAP) {
      e.preventDefault();
      if (e.repeat && now() - lastKeyMove < 110) return;
      lastKeyMove = now();
      dismissCoach();
      move(KEYMAP[e.code]);
      return;
    }
    switch (e.code) {
      case 'KeyZ': case 'Backspace': e.preventDefault(); undo(); break;
      case 'KeyH': hint(); break;
      case 'KeyN': newGame(false); break;
      case 'KeyM': sound.enabled = prefs.sound = !sound.enabled; savePrefs(); toast(sound.enabled ? 'Sound on' : 'Sound off', 900); break;
    }
  });

  /* ---------- Drag-follow ---------- */
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (drag || menuOpen || (cardOpen && cardOpen !== 'win') || e.button > 0) return;
    sound.ensure();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    measureDirs();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: -1, dist: 0, samples: [[now(), e.clientX, e.clientY]] };
  });
  canvas.addEventListener('pointermove', e => {
    // parallax follows the mouse
    if (e.pointerType === 'mouse') renderer.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    drag.samples.push([now(), e.clientX, e.clientY]);
    if (drag.samples.length > 8) drag.samples.shift();
    const len = Math.hypot(dx, dy);
    if (len < 8 && drag.dir < 0) return;
    // nearest of the six on-screen directions, with a little stickiness
    let best = -1, bestDot = -2;
    screenDirs.forEach((d, i) => {
      const dot = (dx * d.ux + dy * d.uy) / len;
      if (dot > bestDot) { bestDot = dot; best = i; }
    });
    if (drag.dir >= 0 && best !== drag.dir) {
      const cur = screenDirs[drag.dir];
      const curDot = (dx * cur.ux + dy * cur.uy) / len;
      if (curDot > bestDot - 0.09) best = drag.dir;
    }
    if (best !== drag.dir) { drag.dir = best; dismissCoach(); }
    const d = screenDirs[best];
    const along = Math.max(0, dx * d.ux + dy * d.uy);
    drag.dist = along / d.step * K.SQRT3; // world units
    renderer.preview(peek(best), drag.dist);
  });
  const endDrag = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.dir < 0) return;
    // flick speed along the chosen direction, px/ms
    const s = d.samples, a = s[0], b = s[s.length - 1];
    const dtm = Math.max(1, b[0] - a[0]);
    const sd = screenDirs[d.dir];
    const v = ((b[1] - a[1]) * sd.ux + (b[2] - a[2]) * sd.uy) / dtm;
    const commit = !cancelled && (d.dist >= 0.62 || (v > 0.45 && d.dist > 0.18));
    if (commit) {
      const p = peek(d.dir);
      if (p.moved) { move(d.dir); return; }
      renderer.preview(null, 0);
      renderer.nudge(d.dir);
      sound.blocked();
      return;
    }
    renderer.preview(null, 0);
  };
  canvas.addEventListener('pointerup', e => endDrag(e, false));
  canvas.addEventListener('pointercancel', e => endDrag(e, true));
  canvas.addEventListener('lostpointercapture', e => endDrag(e, false));
  window.addEventListener('blur', () => { drag = null; renderer.preview(null, 0); });

  /* ---------- Coach ---------- */
  function dismissCoach() {
    if (!el.coach.hidden) { el.coach.hidden = true; prefs.coached = true; savePrefs(); }
  }
  if (!prefs.coached) el.coach.hidden = false;

  prefersReduced.addEventListener('change', () => renderer.setReduced(reduced()));
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  /* ---------- Go ---------- */
  renderer.setBoard(game.topo, game);
  ready = true;
  layout();
  renderer.apply(game.snapshotTransition('reset'));
  refresh();
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);
  if (game.over) setTimeout(() => { renderer.celebrate('over'); showCard('over'); }, 900);

  // Debug / test handle.
  window.hex = { get game() { return game; }, renderer, move, undo, hint, newGame, layout };
}

window.HexApp = { start, VERSION };
})();
