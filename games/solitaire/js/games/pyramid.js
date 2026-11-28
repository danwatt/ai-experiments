// Pyramid: 28 cards in a pyramid. Remove pairs that add up to 13
// (Jack 11, Queen 12, King 13 on its own). A card is free once nothing
// covers it. Three trips through the deck.
import { mulberry32, shuffle } from '../core/rng.js';
import { newDeck, up, down, top, enc } from '../core/cards.js';

const N = 28;
const ROW = [];
const COL = [];
for (let r = 0, i = 0; r < 7; r++) for (let k = 0; k <= r; k++, i++) { ROW[i] = r; COL[i] = k; }
const idx = (r, k) => (r * (r + 1)) / 2 + k;
const KIDS = ROW.map((r, i) => (r === 6 ? [] : [idx(r + 1, COL[i]), idx(r + 1, COL[i] + 1)]));
const PY = Array.from({ length: N }, (_, i) => 'p' + i);
const MAX_PASSES = 2;

const value = (c) => c.r;

function free(P, i) {
  return P[PY[i]].length > 0 && KIDS[i].every((k) => P[PY[k]].length === 0);
}

export function makePyramid() {
  const g = {
    id: 'pyramid',
    family: 'pyramid',
    title: 'Pyramid',
    subtitle: 'Pairs that make 13',
    deckSize: 52,
    selectable: true,

    deal(seed) {
      const deck = shuffle(newDeck([0, 1, 2, 3]), mulberry32(seed));
      const piles = { stock: [], waste: [], discard: [] };
      for (let i = 0; i < N; i++) piles[PY[i]] = [up(deck[i])];
      piles.stock = deck.slice(N);
      return { piles, score: 0, moves: 0, passes: 0, fx: [] };
    },

    /** Piles whose top card can be played right now. */
    available(s) {
      const P = s.piles, out = [];
      for (let i = 0; i < N; i++) if (free(P, i)) out.push(PY[i]);
      if (P.waste.length) out.push('waste');
      return out;
    },

    canPick(s, pile, i) {
      const p = s.piles[pile];
      if (!p || i !== p.length - 1) return false;
      if (pile === 'waste') return true;
      if (pile[0] === 'p') return free(s.piles, +pile.slice(1));
      return false;
    },

    /** Drag a free card onto its partner (or a King onto the discard pile). */
    dropMove(s, from, i, to) {
      if (!g.canPick(s, from, i)) return null;
      const c = top(s.piles[from]);
      if (c.r === 13 && (to === 'discard' || to === from)) return { t: 'king', a: from };
      if (to !== from && g.canPick(s, to, s.piles[to].length - 1)) {
        const d = top(s.piles[to]);
        if (value(c) + value(d) === 13) return { t: 'pair', a: from, b: to };
      }
      return null;
    },

    /** Click: Kings go at once; otherwise select, then click a partner. */
    tap(s, pile, i, sel) {
      if (pile === 'stock') {
        const m = g.moves(s).find((x) => x.t === 'deal' || x.t === 'recycle');
        return m ? { move: m } : { say: s.piles.waste.length ? 'No more trips through the deck.' : '' };
      }
      if (!g.canPick(s, pile, i)) return sel ? { select: null } : { shake: true };
      const c = top(s.piles[pile]);
      if (c.r === 13) return { move: { t: 'king', a: pile } };
      if (sel && sel !== pile) {
        const d = top(s.piles[sel]);
        if (value(c) + value(d) === 13) return { move: { t: 'pair', a: sel, b: pile } };
        return { select: pile };
      }
      if (sel === pile) return { select: null };
      return { select: pile };
    },

    moves(s) {
      const P = s.piles, out = [];
      const av = g.available(s);
      for (let a = 0; a < av.length; a++) {
        const ca = top(P[av[a]]);
        if (ca.r === 13) { out.push({ t: 'king', a: av[a] }); continue; }
        for (let b = a + 1; b < av.length; b++) if (ca.r + top(P[av[b]]).r === 13) out.push({ t: 'pair', a: av[a], b: av[b] });
      }
      if (P.stock.length) out.push({ t: 'deal' });
      else if (P.waste.length && s.passes < MAX_PASSES) out.push({ t: 'recycle' });
      return out;
    },

    apply(s, m) {
      const P0 = s.piles;
      if (m.t === 'pair' || m.t === 'king') {
        const P = { ...P0 };
        const gone = [];
        for (const p of m.t === 'pair' ? [m.a, m.b] : [m.a]) {
          gone.push(top(P0[p]));
          P[p] = P0[p].slice(0, -1);
        }
        P.discard = P0.discard.concat(gone);
        const fromPyr = gone.filter((_, k) => (k === 0 ? m.a : m.b)[0] === 'p').length;
        let score = s.score + 5 * gone.length + 5 * fromPyr;
        const fx = [{ k: 'pair', piles: m.t === 'pair' ? [m.a, m.b] : [m.a] }];
        const rowsLeft = new Set(PY.filter((p) => P[p].length).map((p) => ROW[+p.slice(1)]));
        const before = new Set(PY.filter((p) => P0[p].length).map((p) => ROW[+p.slice(1)]));
        if (rowsLeft.size < before.size) { score += 25; fx.push({ k: 'row' }); }
        if (PY.every((p) => !P[p].length)) score += 100 + (MAX_PASSES - s.passes) * 50;
        return { ...s, piles: P, score, moves: s.moves + 1, fx };
      }
      if (m.t === 'deal') {
        const stock = P0.stock.slice();
        const waste = P0.waste.concat([up(stock.pop())]);
        return { ...s, piles: { ...P0, stock, waste }, moves: s.moves + 1, fx: [{ k: 'deal' }] };
      }
      if (m.t === 'recycle') {
        const stock = P0.waste.slice().reverse().map(down);
        return { ...s, piles: { ...P0, stock, waste: [] }, passes: s.passes + 1, moves: s.moves + 1, fx: [{ k: 'recycle' }] };
      }
      return s;
    },

    isWon(s) {
      return PY.every((p) => !s.piles[p].length);
    },

    key(s) {
      const P = s.piles;
      let mask = '';
      for (let i = 0; i < N; i++) mask += P[PY[i]].length ? '1' : '0';
      let w = '';
      for (const c of P.waste) w += enc(c.id);
      return mask + '#' + P.stock.length + '#' + w + '#' + s.passes;
    },

    eval(s) {
      const P = s.piles;
      let e = 0;
      for (let i = 0; i < N; i++) if (!P[PY[i]].length) e += 10 + (6 - ROW[i]) * 2;
      e += (MAX_PASSES - s.passes) * 6;
      return e;
    },

    tapScore() { return 1; },

    hud(s) {
      const left = PY.filter((p) => s.piles[p].length).length;
      return [{ label: 'Score', value: s.score }, { label: 'Left', value: left }, { label: 'Trips', value: `${s.passes + 1}/${MAX_PASSES + 1}` }];
    },

    stockLabel(s) {
      if (s.piles.stock.length) return '';
      return s.piles.waste.length && s.passes < MAX_PASSES ? '↻' : '✕';
    },

    layout(s, W, H) {
      const M = Math.max(8, Math.min(24, W * 0.015));
      const gapR = 0.1;
      const cw = Math.min(200, (W - 2 * M) / (7 + 6 * gapR + 2.9), (H - 2 * M) / (1.4 * 4.05));
      const ch = cw * 1.4;
      const gap = cw * gapR;
      const pyrW = 7 * cw + 6 * gap;
      const x0 = (W - pyrW) / 2;
      const rowH = ch * 0.5;
      const pyrH = ch + 6 * rowH;
      const y0 = Math.max(M, (H - pyrH) / 2 - ch * 0.15);
      const piles = {};
      for (let i = 0; i < N; i++) {
        const r = ROW[i], k = COL[i];
        piles[PY[i]] = { x: x0 + ((6 - r) / 2 + k) * (cw + gap), y: y0 + r * rowH, fan: 'stack', slot: 'none', z: r * 10 + 1 };
      }
      const side = Math.max(M, x0 - cw - gap * 3);
      piles.stock = { x: side, y: y0, fan: 'stack', slot: 'stock', z: 0 };
      piles.waste = { x: side, y: y0 + ch + gap * 2, fan: 'stack', slot: 'waste', z: 0 };
      piles.discard = { x: Math.min(W - M - cw, x0 + pyrW + gap * 3), y: y0, fan: 'stack', slot: 'discard', z: 0 };
      return { cw, ch, piles };
    },

    help: [
      'Clear the pyramid by removing pairs of cards that add up to 13.',
      'Ace counts 1, Jack 11, Queen 12. A King is 13 by itself and goes with one click.',
      'Only cards that are not covered by other cards can be used.',
      'Click a card, then click its partner. Or drag one card onto the other.',
      'Click the deck to turn over a card. You can use the top turned-over card in a pair. You get three trips through the deck.',
    ],
  };
  return g;
}
