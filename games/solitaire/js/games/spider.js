// Spider: two decks, ten columns. Build down regardless of suit, but only a
// run of one suit moves together. A full King-to-Ace run of one suit leaves
// the table on its own. 1, 2 or 4 suits.
import { mulberry32, shuffle } from '../core/rng.js';
import { newDeck, up, top, moveCards, flipTop, pileKey } from '../core/cards.js';

const TAB = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'];
const FND = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
const isTab = (p) => p[0] === 't';

const link = (a, b) => a.up && b.up && a.s === b.s && a.r === b.r + 1;
function seqOK(p, i) {
  if (i < 0 || i >= p.length || !p[i].up) return false;
  for (let k = i; k < p.length - 1; k++) if (!link(p[k], p[k + 1])) return false;
  return true;
}
function seqStart(p) {
  if (!p.length || !top(p).up) return p.length;
  let i = p.length - 1;
  while (i > 0 && link(p[i - 1], p[i])) i--;
  return i;
}
function firstUp(p) {
  for (let k = 0; k < p.length; k++) if (p[k].up) return k;
  return p.length;
}

export function makeSpider(suits) {
  const sets = suits === 1 ? [0, 0, 0, 0, 0, 0, 0, 0] : suits === 2 ? [0, 1, 0, 1, 0, 1, 0, 1] : [0, 1, 2, 3, 0, 1, 2, 3];
  const g = {
    id: 'spider' + suits,
    family: 'spider',
    title: 'Spider',
    subtitle: suits === 1 ? '1 suit' : suits + ' suits',
    suits,
    deckSize: 104,

    deal(seed) {
      const deck = shuffle(newDeck(sets), mulberry32(seed));
      const piles = { stock: [] };
      for (const t of TAB) piles[t] = [];
      for (const f of FND) piles[f] = [];
      for (let n = 0; n < 54; n++) piles[TAB[n % 10]].push(deck[n]);
      for (const t of TAB) flipTop(piles, t);
      piles.stock = deck.slice(54);
      return { piles, score: 500, moves: 0, runs: 0, fx: [] };
    },

    canPick(s, pile, i) {
      return isTab(pile) && seqOK(s.piles[pile], i);
    },

    canMove(s, from, i, to) {
      if (from === to || !isTab(from) || !isTab(to)) return false;
      const src = s.piles[from], dst = s.piles[to];
      if (!seqOK(src, i)) return false;
      const t = top(dst);
      return !t || (t.up && t.r === src[i].r + 1);
    },

    canDeal(s) {
      return s.piles.stock.length > 0 && TAB.every((t) => s.piles[t].length > 0);
    },

    explainStock(s) {
      if (!s.piles.stock.length) return 'No cards left to deal.';
      if (!g.canDeal(s)) return 'Fill every empty column before dealing a new row.';
      return '';
    },

    moves(s) {
      const P = s.piles, out = [];
      for (const from of TAB) {
        const p = P[from];
        for (let i = seqStart(p); i < p.length; i++) {
          let empty = false;
          for (const to of TAB) {
            if (to === from) continue;
            const t = top(P[to]);
            if (!t) { if (empty) continue; empty = true; out.push({ t: 'm', from, i, to }); }
            else if (t.r === p[i].r + 1) out.push({ t: 'm', from, i, to });
          }
        }
      }
      if (g.canDeal(s)) out.push({ t: 'deal' });
      return out;
    },

    apply(s, m) {
      const P0 = s.piles;
      if (m.t === 'm') {
        const { P } = moveCards(P0, m.from, m.i, m.to);
        const fx = flipTop(P, m.from) ? [{ k: 'flip' }] : [];
        return { ...s, piles: P, score: s.score - 1, moves: s.moves + 1, fx };
      }
      if (m.t === 'deal') {
        const P = { ...P0 };
        const stock = P0.stock.slice();
        for (const t of TAB) if (stock.length) P[t] = P0[t].concat([up(stock.pop())]);
        P.stock = stock;
        return { ...s, piles: P, score: s.score - 1, moves: s.moves + 1, fx: [{ k: 'deal' }] };
      }
      if (m.t === 'run') {
        const P = { ...P0 };
        const p = P0[m.p];
        const run = p.slice(p.length - 13);
        P[m.p] = p.slice(0, p.length - 13);
        const fx = [{ k: 'run', from: m.p }];
        if (flipTop(P, m.p)) fx.push({ k: 'flip' });
        const dest = FND.find((f) => !P0[f].length);
        P[dest] = run.slice().reverse();
        fx[0].pile = dest;
        return { ...s, piles: P, score: s.score + 100, runs: s.runs + 1, fx };
      }
      return s;
    },

    /** Mandatory: a finished King-to-Ace run of one suit leaves the table. */
    forced(s) {
      for (const t of TAB) {
        const p = s.piles[t];
        if (p.length >= 13 && top(p).r === 1 && p[p.length - 13].r === 13 && seqOK(p, p.length - 13)) return { t: 'run', p: t };
      }
      return null;
    },

    isWon(s) {
      return FND.every((f) => s.piles[f].length === 13);
    },

    key(s) {
      return TAB.map((t) => pileKey(s.piles[t])).sort().join('|') + '#' + s.piles.stock.length;
    },

    eval(s) {
      const P = s.piles;
      const W = g.w || [300, 5, 40, 25, 12, 3, 6];
      let e = s.runs * W[0] - P.stock.length * W[1];
      for (const t of TAB) {
        const p = P[t];
        if (!p.length) { e += W[2]; continue; }
        const d = firstUp(p);
        e -= d * W[3];
        for (let k = d; k < p.length - 1; k++) {
          const a = p[k], b = p[k + 1];
          if (a.r === b.r + 1) e += a.s === b.s ? W[4] : W[5];
          else e -= W[6];
        }
      }
      return e;
    },

    solverMoves(s) {
      const P = s.piles;
      return g.moves(s).filter((m) => {
        if (m.t !== 'm') return true;
        const p = P[m.from];
        const dst = P[m.to];
        if (m.i !== seqStart(p)) return false;
        if (!dst.length && m.i === 0) return false;
        if (m.i > 0 && p[m.i - 1].up && p[m.i - 1].r === p[m.i].r + 1) {
          if (!dst.length || top(dst).s !== p[m.i].s) return false;
        }
        return true;
      });
    },

    tapScore(s, m) {
      if (m.t !== 'm') return 1;
      const P = s.piles, p = P[m.from], dst = P[m.to];
      const t = top(dst);
      let v = !t ? 20 : t.s === p[m.i].s ? 100 : 60;
      if (m.i > 0 && !p[m.i - 1].up) v += 15;
      if (!t && m.i === 0) v = 2;
      if (m.i > 0 && p[m.i - 1].up && p[m.i - 1].r === p[m.i].r + 1 && p[m.i - 1].s === p[m.i].s) v -= 50;
      return v;
    },

    hud(s) {
      return [{ label: 'Score', value: s.score }, { label: 'Moves', value: s.moves }];
    },

    layout(s, W, H) {
      const M = Math.max(8, Math.min(22, W * 0.012));
      const gapR = 0.11;
      const cw = Math.min(200, (W - 2 * M) / (10 + 9 * gapR), (H - 2 * M) / (1.4 * 3.9));
      const ch = cw * 1.4;
      const gap = cw * gapR;
      const x0 = (W - (10 * cw + 9 * gap)) / 2;
      const col = (c) => x0 + c * (cw + gap);
      const sc = 0.78;
      const by = H - M - ch * sc;
      const piles = {};
      TAB.forEach((t, k) => (piles[t] = { x: col(k), y: M, fan: 'down', slot: 'tableau', maxY: by - gap * 0.6, z: 0 }));
      FND.forEach((f, k) => (piles[f] = { x: col(0) + k * cw * 0.32, y: by, fan: 'stack', slot: k === 0 ? 'foundation' : 'none', label: '', z: 10 + k, scale: sc }));
      piles.stock = { x: col(9) + cw * (1 - sc), y: by, fan: 'groups', slot: 'stock', z: 0, scale: sc };
      return { cw, ch, piles };
    },

    help: [
      'Build runs of cards in the ten columns. When you build a full run from King down to Ace of one suit, it is removed. Remove all eight runs to win.',
      'Any card can go on a card one higher, whatever the suit. But only cards in a run of the same suit can be moved together.',
      'Any card or same-suit run can go into an empty column.',
      'Click the deck in the bottom corner to deal one new card onto every column. Every column needs at least one card first.',
      'Click a card to move it to the best spot, or drag it.',
    ],
  };
  return g;
}
