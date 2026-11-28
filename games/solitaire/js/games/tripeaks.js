// TriPeaks: three peaks of cards. Play any uncovered card that is one higher
// or one lower than the card on the pile (King and Ace wrap around).
// Long streaks score more.
import { mulberry32, shuffle } from '../core/rng.js';
import { newDeck, up, top, enc } from '../core/cards.js';

const N = 28;
// Rows: 0 = three peak tops, 1 = six, 2 = nine, 3 = ten (bottom, face up).
const ROW = [], POSX = [], KIDS = [];
for (let p = 0; p < 3; p++) { ROW.push(0); POSX.push(3 * p + 1.5); KIDS.push([3 + 2 * p, 4 + 2 * p]); }
for (let j = 0; j < 6; j++) {
  const p = j >> 1, k = j & 1;
  ROW.push(1); POSX.push(3 * p + k + 1); KIDS.push([9 + 3 * p + k, 10 + 3 * p + k]);
}
for (let j = 0; j < 9; j++) { ROW.push(2); POSX.push(j + 0.5); KIDS.push([18 + j, 19 + j]); }
for (let j = 0; j < 10; j++) { ROW.push(3); POSX.push(j); KIDS.push([]); }
const PARENTS = Array.from({ length: N }, () => []);
KIDS.forEach((ks, i) => ks.forEach((k) => PARENTS[k].push(i)));
const PY = Array.from({ length: N }, (_, i) => 'p' + i);

const adjacent = (a, b) => Math.abs(a - b) === 1 || (a === 1 && b === 13) || (a === 13 && b === 1);
const uncovered = (P, i) => KIDS[i].every((k) => P[PY[k]].length === 0);

export function makeTriPeaks() {
  const g = {
    id: 'tripeaks',
    family: 'tripeaks',
    title: 'TriPeaks',
    subtitle: 'One higher or lower',
    deckSize: 52,

    deal(seed) {
      const deck = shuffle(newDeck([0, 1, 2, 3]), mulberry32(seed));
      const piles = { stock: [], waste: [] };
      for (let i = 0; i < N; i++) piles[PY[i]] = [ROW[i] === 3 ? up(deck[i]) : deck[i]];
      const rest = deck.slice(N);
      piles.waste = [up(rest.pop())];
      piles.stock = rest;
      return { piles, score: 0, moves: 0, chain: 0, best: 0, fx: [] };
    },

    canPick(s, pile, i) {
      const p = s.piles[pile];
      return pile[0] === 'p' && p.length === 1 && i === 0 && p[0].up;
    },

    canMove(s, from, i, to) {
      if (to !== 'waste' || !g.canPick(s, from, i)) return false;
      const w = top(s.piles.waste);
      return !!w && adjacent(w.r, s.piles[from][0].r);
    },

    tap(s, pile, i) {
      if (pile === 'stock') {
        return s.piles.stock.length ? { move: { t: 'deal' } } : { say: 'The deck is empty.' };
      }
      if (g.canMove(s, pile, i, 'waste')) return { move: { t: 'm', from: pile, i, to: 'waste' } };
      return { shake: true };
    },

    moves(s) {
      const P = s.piles, out = [];
      const w = top(P.waste);
      for (let i = 0; i < N; i++) {
        const p = P[PY[i]];
        if (p.length && p[0].up && w && adjacent(w.r, p[0].r)) out.push({ t: 'm', from: PY[i], i: 0, to: 'waste' });
      }
      if (P.stock.length) out.push({ t: 'deal' });
      return out;
    },

    apply(s, m) {
      const P0 = s.piles;
      if (m.t === 'm') {
        const P = { ...P0 };
        const n = +m.from.slice(1);
        const card = P0[m.from][0];
        P[m.from] = [];
        P.waste = P0.waste.concat([card]);
        const fx = [];
        for (const par of PARENTS[n]) {
          const pp = P[PY[par]];
          if (pp.length && !pp[0].up && uncovered(P, par)) { P[PY[par]] = [up(pp[0])]; fx.push({ k: 'flip' }); }
        }
        const chain = s.chain + 1;
        let score = s.score + 10 * chain;
        if (chain >= 3) fx.push({ k: 'chain', n: chain, pile: 'waste' });
        if (ROW[n] === 0) {
          const peaksLeft = [0, 1, 2].filter((p) => P[PY[p]].length).length;
          score += peaksLeft === 0 ? 500 : 150;
          fx.push({ k: 'peak', left: peaksLeft, pile: m.from });
          if (peaksLeft === 0) score += P0.stock.length * 25;
        }
        return { ...s, piles: P, score, chain, best: Math.max(s.best, chain), moves: s.moves + 1, fx };
      }
      if (m.t === 'deal') {
        const stock = P0.stock.slice();
        const waste = P0.waste.concat([up(stock.pop())]);
        return { ...s, piles: { ...P0, stock, waste }, chain: 0, moves: s.moves + 1, fx: [{ k: 'deal' }] };
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
      return mask + '#' + P.stock.length + '#' + enc(top(P.waste).id);
    },

    eval(s) {
      const P = s.piles;
      let e = 0;
      for (let i = 0; i < N; i++) if (!P[PY[i]].length) e += 10 + (3 - ROW[i]) * 3;
      return e + P.stock.length * 2;
    },

    tapScore() { return 1; },

    hud(s) {
      return [{ label: 'Score', value: s.score }, { label: 'Streak', value: s.chain }, { label: 'Deck', value: s.piles.stock.length }];
    },

    stockLabel(s) {
      return s.piles.stock.length ? '' : '✕';
    },

    layout(s, W, H) {
      const M = Math.max(8, Math.min(24, W * 0.015));
      const gapR = 0.08;
      const cw = Math.min(190, (W - 2 * M) / (10 + 9 * gapR), (H - 2 * M) / (1.4 * 3.75));
      const ch = cw * 1.4;
      const gap = cw * gapR;
      const step = cw + gap;
      const x0 = (W - (10 * cw + 9 * gap)) / 2;
      const rowH = ch * 0.52;
      const totalH = ch + 3 * rowH + gap * 3 + ch;
      const y0 = Math.max(M, (H - totalH) / 2);
      const piles = {};
      for (let i = 0; i < N; i++) piles[PY[i]] = { x: x0 + POSX[i] * step, y: y0 + ROW[i] * rowH, fan: 'stack', slot: 'none', z: ROW[i] * 10 + 1 };
      const by = y0 + ch + 3 * rowH + gap * 3;
      piles.stock = { x: W / 2 - cw - gap * 3, y: by, fan: 'fanLeft', slot: 'stock', z: 0 };
      piles.waste = { x: W / 2 + gap * 3, y: by, fan: 'stack', slot: 'waste', z: 0 };
      return { cw, ch, piles };
    },

    help: [
      'Clear all three peaks.',
      'Click any face-up card that is one higher or one lower than the card on the pile below. Suit does not matter, and King and Ace go on each other.',
      'Cards turn over once nothing covers them.',
      'When you are stuck, click the deck to turn over a new card. Long streaks of plays without the deck score more.',
    ],
  };
  return g;
}
