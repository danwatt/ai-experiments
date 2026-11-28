// The table: one DOM element per card, positioned with transforms so every
// change (a move, an undo, a deal) animates by itself. Handles dragging,
// tapping and drop targets; knows nothing about the rules.

const DRAG_START = 6;

export class Board {
  constructor(root, faces, handlers) {
    this.root = root;
    this.faces = faces;
    this.h = handlers; // { tap(pile, i), canPick(pile, i), dropMove(pile, i, target), explain(pile, i, target) }
    this.slotLayer = el('div', 'slots');
    this.cardLayer = el('div', 'cards');
    root.append(this.slotLayer, this.cardLayer);
    this.cards = new Map(); // id -> { el, x, y, z, up, sc }
    this.slots = new Map(); // pile -> el
    this.where = new Map(); // id -> { pile, i }
    this.state = null;
    this.lay = null;
    this.speed = 1;
    this.large = false;
    this.press = null;
    this.timers = new Map();
    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', (e) => this.onUp(e, true));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.state && this.render(this.state, { instant: true })).observe(root);
  }

  setGame(game, state) {
    this.game = game;
    this.cardLayer.textContent = '';
    this.slotLayer.textContent = '';
    this.cards.clear();
    this.slots.clear();
    this.state = null;
    for (const pile of Object.values(state.piles))
      for (const c of pile) {
        const e = el('div', 'card down');
        e.dataset.id = c.id;
        const flip = el('div', 'flip');
        const face = el('div', 'face');
        const back = el('div', 'back');
        flip.append(face, back);
        e.append(flip);
        this.cardLayer.append(e);
        this.cards.set(c.id, { el: e, face, card: c, x: 0, y: 0, z: 0, up: false, sc: 1 });
      }
    this.refreshArt();
  }

  /** Re-apply card art after the look changes. */
  refreshArt() {
    this.root.style.setProperty('--back', `url("${this.faces.back}")`);
    for (const rec of this.cards.values()) rec.face.style.backgroundImage = `url("${this.faces.face(rec.card)}")`;
  }

  size() {
    return { W: this.root.clientWidth, H: this.root.clientHeight };
  }

  /** Card positions for a state, from the game's pile layout. */
  positions(state) {
    const { W, H } = this.size();
    const lay = this.game.layout(state, W, H);
    const { cw, ch } = lay;
    const out = new Map();
    const where = new Map();
    for (const [pid, spec] of Object.entries(lay.piles)) {
      const cards = state.piles[pid] || [];
      const n = cards.length;
      const sc = spec.scale || 1;
      const base = (spec.z || 0) * 200;
      let dUp = 0, dDown = 0;
      if (spec.fan === 'down' && n > 1) {
        dDown = ch * 0.1;
        dUp = ch * (this.large ? 0.31 : 0.265);
        const downs = cards.slice(0, -1).filter((c) => !c.up).length;
        const ups = n - 1 - downs;
        const avail = spec.maxY - spec.y - ch;
        if (downs * dDown + ups * dUp > avail) {
          const minDown = ch * 0.045;
          if (downs * minDown + ups * dUp <= avail) dDown = (avail - ups * dUp) / downs;
          else {
            dDown = minDown;
            dUp = Math.max(ch * 0.09, (avail - downs * minDown) / Math.max(1, ups));
          }
        }
      }
      let y = spec.y;
      cards.forEach((c, k) => {
        let x = spec.x, cy = spec.y;
        if (spec.fan === 'down') {
          cy = y;
          y += c.up ? dUp : dDown;
        } else if (spec.fan === 'stack') {
          const d = Math.floor(k / 8) * Math.max(1, cw * 0.012);
          x -= d; cy -= d;
        } else if (spec.fan === 'waste3') {
          const fanFrom = Math.max(0, n - 3);
          if (k > fanFrom) x += (k - fanFrom) * cw * 0.3;
        } else if (spec.fan === 'groups') {
          const groups = Math.ceil(n / 10);
          x -= (groups - 1 - Math.floor(k / 10)) * cw * 0.2 * sc;
        } else if (spec.fan === 'fanLeft') {
          x -= (n - 1 - k) * Math.min(cw * 0.075, (cw * 1.8) / Math.max(1, n));
        }
        out.set(c.id, { x, y: cy, z: base + k + 1, up: c.up, sc });
        where.set(c.id, { pile: pid, i: k });
      });
    }
    return { lay, out, where };
  }

  /**
   * Draw a state. Options: instant (no animation), deal (fly in from the
   * stock), stagger: [ids] to start one after another, step (ms).
   */
  render(state, opts = {}) {
    const { lay, out, where } = this.positions(state);
    this.state = state;
    this.lay = lay;
    this.where = where;
    this.root.style.setProperty('--cw', lay.cw + 'px');
    this.root.style.setProperty('--ch', lay.ch + 'px');
    this.drawSlots(lay, state);
    const dur = 300 * this.speed;
    const instant = opts.instant || this.speed === 0;
    this.root.classList.toggle('instant', !!instant);
    const order = opts.stagger ? new Map(opts.stagger.map((id, k) => [id, k])) : null;
    const step = (opts.step ?? 45) * this.speed;

    if (opts.deal) {
      // Start every card on the stock (or the middle top), face down, then fly out.
      const sp = lay.piles.stock || { x: this.size().W / 2 - lay.cw / 2, y: -lay.ch * 1.2 };
      const seq = dealOrder(state, lay);
      this.root.classList.add('instant');
      for (const [id, rec] of this.cards) {
        Object.assign(rec, { x: sp.x, y: sp.y, up: false, sc: sp.scale || 1 });
        apply(rec, 1000 + (seq.get(id) ?? 0));
        rec.el.style.transitionDelay = '0ms';
      }
      void this.root.offsetWidth;
      this.root.classList.remove('instant');
      const dstep = Math.min(34, 1400 / Math.max(1, seq.size)) * this.speed;
      for (const [id, p] of out) {
        const rec = this.cards.get(id);
        const k = seq.get(id);
        const delay = k === undefined ? 0 : k * dstep;
        rec.el.style.transitionDelay = `${delay}ms`;
        rec.el.querySelector('.flip').style.transitionDelay = `${delay + dur * 0.6}ms`;
        Object.assign(rec, p);
        apply(rec, p.z + 2000);
        this.later(id, delay + dur + 60, () => {
          rec.el.style.zIndex = rec.z;
          rec.el.style.transitionDelay = '';
          rec.el.querySelector('.flip').style.transitionDelay = '';
        });
      }
      return (seq.size * dstep + dur) | 0;
    }

    let longest = instant ? 0 : dur;
    for (const [id, p] of out) {
      const rec = this.cards.get(id);
      if (!rec) continue;
      rec.card = state.piles[where.get(id).pile][where.get(id).i];
      const moved = Math.abs(rec.x - p.x) > 0.5 || Math.abs(rec.y - p.y) > 0.5 || rec.sc !== p.sc;
      const delay = order && order.has(id) ? order.get(id) * step : 0;
      rec.el.style.transitionDelay = delay ? `${delay}ms` : '';
      Object.assign(rec, p);
      if (moved && !instant) {
        apply(rec, p.z + 3000);
        longest = Math.max(longest, delay + dur);
        this.later(id, delay + dur + 30, () => {
          rec.el.style.zIndex = rec.z;
          rec.el.style.transitionDelay = '';
        });
      } else apply(rec, p.z);
    }
    if (instant) {
      void this.root.offsetWidth;
      this.root.classList.remove('instant');
    }
    return longest;
  }

  later(id, ms, fn) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(fn, ms));
  }

  drawSlots(lay, state) {
    const seen = new Set();
    for (const [pid, spec] of Object.entries(lay.piles)) {
      if (!spec.slot || spec.slot === 'none') continue;
      seen.add(pid);
      let s = this.slots.get(pid);
      if (!s) {
        s = el('div', 'slot slot-' + spec.slot);
        s.dataset.pile = pid;
        this.slotLayer.append(s);
        this.slots.set(pid, s);
      }
      const sc = spec.scale || 1;
      s.style.transform = `translate(${spec.x}px, ${spec.y}px) scale(${sc})`;
      let label = spec.label ?? { foundation: 'A', king: 'K' }[spec.slot] ?? '';
      if (spec.slot === 'stock' && this.game.stockLabel) label = this.game.stockLabel(state);
      if (s.textContent !== label) s.textContent = label;
    }
    for (const [pid, s] of this.slots) if (!seen.has(pid)) { s.remove(); this.slots.delete(pid); }
  }

  // ---------- geometry helpers ----------

  cardRect(id) {
    const r = this.cards.get(id);
    return { x: r.x, y: r.y, w: this.lay.cw * r.sc, h: this.lay.ch * r.sc };
  }

  /** Area that counts as "dropping on" a pile: its top card, its column, or its empty slot. */
  pileRect(pid) {
    const spec = this.lay.piles[pid];
    const cards = this.state.piles[pid] || [];
    const sc = spec.scale || 1;
    const { cw, ch } = this.lay;
    if (!cards.length) return { x: spec.x, y: spec.y, w: cw * sc, h: ch * sc };
    const last = this.cardRect(top(cards).id);
    if (spec.fan === 'down') return { x: spec.x, y: spec.y, w: cw, h: last.y + last.h - spec.y + ch * 0.25 };
    return last;
  }

  /** Center of a pile's top card in page coordinates (for effects). */
  pilePoint(pid) {
    const r = this.pileRect(pid);
    const b = this.root.getBoundingClientRect();
    const cards = this.state.piles[pid] || [];
    if (cards.length) {
      const c = this.cardRect(top(cards).id);
      return { x: b.left + c.x + c.w / 2, y: b.top + c.y + c.h / 2 };
    }
    return { x: b.left + r.x + r.w / 2, y: b.top + r.y + r.h / 2 };
  }

  // ---------- effects ----------

  mark(ids, cls, ms) {
    for (const id of ids) {
      const r = this.cards.get(id);
      if (!r) continue;
      r.el.classList.remove(cls);
      void r.el.offsetWidth;
      r.el.classList.add(cls);
      if (ms) setTimeout(() => r.el.classList.remove(cls), ms);
    }
  }

  shake(ids) {
    this.mark(ids, 'shake', 420);
  }

  /** Glow the cards to move and the place they go. */
  hint(ids, target) {
    this.clearHint();
    this.mark(ids, 'hint', 0);
    if (target) {
      const cards = this.state.piles[target] || [];
      if (cards.length) this.mark([top(cards).id], 'hint-target', 0);
      else this.slots.get(target)?.classList.add('hint-target');
    }
    this.hintTimer = setTimeout(() => this.clearHint(), 2200);
  }
  clearHint() {
    clearTimeout(this.hintTimer);
    this.root.querySelectorAll('.hint, .hint-target').forEach((e) => e.classList.remove('hint', 'hint-target'));
  }

  select(pid) {
    this.root.querySelectorAll('.card.selected').forEach((e) => e.classList.remove('selected'));
    if (!pid) return;
    const cards = this.state.piles[pid];
    if (cards && cards.length) this.cards.get(top(cards).id).el.classList.add('selected');
  }

  // ---------- input ----------

  local(e) {
    const b = this.root.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  onDown(e) {
    if (e.button > 0 || this.press || !this.state || this.locked) return;
    const cardEl = e.target.closest('.card');
    const slotEl = e.target.closest('.slot');
    let pile, i, id = null;
    if (cardEl) {
      id = +cardEl.dataset.id;
      const w = this.where.get(id);
      if (!w) return;
      pile = w.pile; i = w.i;
    } else if (slotEl) {
      pile = slotEl.dataset.pile; i = -1;
    } else return;
    const p = this.local(e);
    this.press = { id, pile, i, x0: p.x, y0: p.y, pointerId: e.pointerId, started: false };
    try { this.root.setPointerCapture(e.pointerId); } catch {}
  }

  onMove(e) {
    const pr = this.press;
    if (!pr || e.pointerId !== pr.pointerId) return;
    const p = this.local(e);
    const dx = p.x - pr.x0, dy = p.y - pr.y0;
    if (!pr.started) {
      if (Math.hypot(dx, dy) < DRAG_START || pr.id === null || pr.noDrag) return;
      if (!this.h.canPick(pr.pile, pr.i)) { pr.noDrag = true; return; }
      pr.started = true;
      const cards = this.state.piles[pr.pile].slice(pr.i);
      pr.group = cards.map((c) => this.cards.get(c.id));
      pr.group.forEach((r, k) => {
        r.el.classList.add('dragging');
        r.el.style.zIndex = 9000 + k;
        r.el.style.transitionDelay = '';
      });
      this.clearHint();
    }
    pr.dx = dx; pr.dy = dy;
    for (const r of pr.group) r.el.style.transform = `translate(${r.x + dx}px, ${r.y + dy}px) scale(${r.sc})`;
    const t = this.findTarget(pr);
    if (t !== pr.over) {
      this.overEl(pr.over)?.classList.remove('drop-ok');
      pr.over = t;
      this.overEl(t)?.classList.add('drop-ok');
    }
  }

  overEl(pid) {
    if (!pid) return null;
    const cards = this.state.piles[pid] || [];
    return cards.length ? this.cards.get(top(cards).id).el : this.slots.get(pid);
  }

  findTarget(pr) {
    const lead = this.cardRect(pr.group[0].card.id);
    const r = { x: lead.x + pr.dx, y: lead.y + pr.dy, w: lead.w, h: lead.h };
    let best = null, bestA = 0;
    for (const pid of Object.keys(this.lay.piles)) {
      if (pid === pr.pile && !this.h.selfDrop) continue;
      const a = overlap(r, this.pileRect(pid));
      if (a > bestA && this.h.dropMove(pr.pile, pr.i, pid)) { best = pid; bestA = a; }
    }
    return best;
  }

  onUp(e, cancel) {
    const pr = this.press;
    if (!pr || e.pointerId !== pr.pointerId) return;
    this.press = null;
    try { this.root.releasePointerCapture(e.pointerId); } catch {}
    if (pr.started) {
      this.overEl(pr.over)?.classList.remove('drop-ok');
      const target = cancel ? null : this.findTarget(pr);
      for (const r of pr.group) r.el.classList.remove('dragging');
      let ok = false;
      if (target) ok = this.h.drop(pr.pile, pr.i, target);
      if (!ok) {
        if (!cancel) {
          // Find what it was dropped on, to explain why not.
          const lead = this.cardRect(pr.group[0].card.id);
          const r = { x: lead.x + pr.dx, y: lead.y + pr.dy, w: lead.w, h: lead.h };
          let near = null, a0 = 0;
          for (const pid of Object.keys(this.lay.piles)) {
            if (pid === pr.pile) continue;
            const a = overlap(r, this.pileRect(pid));
            if (a > a0) { near = pid; a0 = a; }
          }
          this.h.rejected?.(pr.pile, pr.i, near);
        }
        this.render(this.state);
      }
    } else if (!pr.noDrag && !cancel) {
      this.h.tap(pr.pile, pr.i);
    }
  }
}

function apply(rec, z) {
  rec.el.style.transform = `translate(${rec.x}px, ${rec.y}px) scale(${rec.sc})`;
  rec.el.style.zIndex = z;
  rec.el.classList.toggle('down', !rec.up);
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const top = (a) => a[a.length - 1];

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** Round-robin order, like a dealer going along the row: card k of every pile, then k+1. */
function dealOrder(state, lay) {
  const seq = new Map();
  const piles = Object.keys(lay.piles).filter((p) => p !== 'stock');
  let n = 0;
  const maxLen = Math.max(...piles.map((p) => (state.piles[p] || []).length));
  for (let k = 0; k < maxLen; k++)
    for (const p of piles) {
      const c = (state.piles[p] || [])[k];
      if (c) seq.set(c.id, n++);
    }
  return seq;
}
