// Klondike: seven columns, build down in alternating colors, foundations
// up by suit from Ace. Draw 1 ("Classic Solitaire") or Draw 3 ("Klondike").
import { mulberry32, shuffle } from '../core/rng.js';
import { newDeck, red, up, down, top, moveCards, flipTop, pileKey } from '../core/cards.js';

const TAB = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
const FND = ['f0', 'f1', 'f2', 'f3'];
const isTab = (p) => p[0] === 't';
const isFnd = (p) => p[0] === 'f';

const stacks = (a, b) => a.up && a.r === b.r + 1 && red(a.s) !== red(b.s);
const fndAccepts = (pile, c) => {
  const t = top(pile);
  return t ? t.s === c.s && t.r + 1 === c.r : c.r === 1;
};
function validSeq(pile, i) {
  if (i < 0 || i >= pile.length || !pile[i].up) return false;
  for (let k = i; k < pile.length - 1; k++) if (!stacks(pile[k], pile[k + 1])) return false;
  return true;
}
function firstUp(pile) {
  for (let k = 0; k < pile.length; k++) if (pile[k].up) return k;
  return pile.length;
}
function fndFor(P, c) {
  let empty = null;
  for (const f of FND) {
    const t = top(P[f]);
    if (t) { if (t.s === c.s && t.r + 1 === c.r) return f; }
    else if (empty === null) empty = f;
  }
  return c.r === 1 ? empty : null;
}
function suitRanks(P) {
  const r = [0, 0, 0, 0];
  for (const f of FND) { const t = top(P[f]); if (t) r[t.s] = t.r; }
  return r;
}
/** A card is safe to send home when nothing could still need it in the tableau. */
function isSafe(P, c) {
  if (c.r <= 2) return true;
  const r = suitRanks(P);
  const opp = red(c.s) ? [0, 3] : [1, 2];
  return r[opp[0]] >= c.r - 1 && r[opp[1]] >= c.r - 1;
}

export function makeKlondike(draw) {
  const g = {
    id: draw === 1 ? 'klondike1' : 'klondike3',
    family: 'klondike',
    title: draw === 1 ? 'Classic Solitaire' : 'Klondike',
    subtitle: draw === 1 ? 'Turn one card' : 'Turn three cards',
    draw,
    deckSize: 52,

    deal(seed) {
      const deck = shuffle(newDeck([0, 1, 2, 3]), mulberry32(seed));
      const piles = { stock: [], waste: [] };
      for (const f of FND) piles[f] = [];
      for (const t of TAB) piles[t] = [];
      let k = 0;
      for (let row = 0; row < 7; row++)
        for (let c = row; c < 7; c++) {
          const card = deck[k++];
          piles['t' + c].push(c === row ? up(card) : card);
        }
      piles.stock = deck.slice(k);
      return { piles, score: 0, moves: 0, passes: 0, fx: [] };
    },

    canPick(s, pile, i) {
      const p = s.piles[pile];
      if (!p || i >= p.length) return false;
      if (pile === 'waste' || isFnd(pile)) return i === p.length - 1;
      if (isTab(pile)) return validSeq(p, i);
      return false;
    },

    canMove(s, from, i, to) {
      if (from === to) return false;
      const P = s.piles, src = P[from], dst = P[to];
      if (!src || !dst || i >= src.length || !g.canPick(s, from, i)) return false;
      const c = src[i];
      if (isFnd(to)) return i === src.length - 1 && fndAccepts(dst, c);
      if (isTab(to)) { const t = top(dst); return t ? stacks(t, c) : c.r === 13; }
      return false;
    },

    moves(s) {
      const P = s.piles, out = [];
      for (const from of ['waste', ...TAB]) {
        const p = P[from];
        if (!p.length) continue;
        const f = fndFor(P, top(p));
        if (f) out.push({ t: 'm', from, i: p.length - 1, to: f });
      }
      for (const from of ['waste', ...TAB, ...FND]) {
        const p = P[from];
        if (!p.length) continue;
        const starts = isTab(from) ? range(firstUp(p), p.length) : [p.length - 1];
        for (const i of starts) {
          let empty = false;
          for (const to of TAB) {
            if (!P[to].length) { if (empty) continue; }
            if (g.canMove(s, from, i, to)) {
              if (!P[to].length) empty = true;
              out.push({ t: 'm', from, i, to });
            }
          }
        }
      }
      if (P.stock.length) out.push({ t: 'deal' });
      else if (P.waste.length) out.push({ t: 'recycle' });
      return out;
    },

    apply(s, m) {
      const P0 = s.piles;
      if (m.t === 'm') {
        const { P, moving } = moveCards(P0, m.from, m.i, m.to);
        let score = s.score;
        const fx = [];
        if (isTab(m.from) && flipTop(P, m.from)) { score += 5; fx.push({ k: 'flip' }); }
        if (isFnd(m.to)) { score += 10; fx.push({ k: 'home', pile: m.to, r: moving[0].r }); }
        else if (m.from === 'waste') score += 5;
        if (isFnd(m.from)) score = Math.max(0, score - 15);
        return { ...s, piles: P, score, moves: s.moves + 1, fx };
      }
      if (m.t === 'deal') {
        const stock = P0.stock.slice(), waste = P0.waste.slice();
        for (let k = 0; k < draw && stock.length; k++) waste.push(up(stock.pop()));
        return { ...s, piles: { ...P0, stock, waste }, moves: s.moves + 1, fx: [{ k: 'deal' }] };
      }
      if (m.t === 'recycle') {
        const stock = P0.waste.slice().reverse().map(down);
        const score = Math.max(0, s.score - (draw === 1 ? 100 : 20));
        return { ...s, piles: { ...P0, stock, waste: [] }, score, passes: s.passes + 1, moves: s.moves + 1, fx: [{ k: 'recycle' }] };
      }
      return s;
    },

    /** Optional automatic move: send a safe card home (when the setting is on). */
    safe(s) {
      const P = s.piles;
      for (const from of ['waste', ...TAB]) {
        const c = top(P[from]);
        if (!c || !c.up) continue;
        const f = fndFor(P, c);
        if (f && isSafe(P, c)) return { t: 'm', from, i: P[from].length - 1, to: f };
      }
      return null;
    },

    canFinish(s) {
      const P = s.piles;
      return !P.stock.length && !P.waste.length && TAB.every((t) => P[t].every((c) => c.up)) && !g.isWon(s);
    },
    finishMove(s) {
      const P = s.piles;
      let best = null;
      for (const from of TAB) {
        const c = top(P[from]);
        if (!c) continue;
        const f = fndFor(P, c);
        if (f && (!best || c.r < best.r)) best = { r: c.r, m: { t: 'm', from, i: P[from].length - 1, to: f } };
      }
      return best && best.m;
    },

    isWon(s) {
      return FND.every((f) => s.piles[f].length === 13);
    },

    key(s) {
      const P = s.piles;
      const cols = TAB.map((t) => pileKey(P[t])).sort().join('|');
      return cols + '#' + suitRanks(P).join(',') + '#' + pileKey(P.stock) + '/' + pileKey(P.waste);
    },

    eval(s) {
      const P = s.piles;
      let e = 0;
      for (const f of FND) e += P[f].length * 12;
      for (const t of TAB) {
        const p = P[t];
        const d = firstUp(p);
        e -= d * 7 + (d ? 2 : 0);
        if (!p.length) e += 3;
      }
      e -= P.waste.length * 0.5 + P.stock.length * 0.3;
      return e;
    },

    /** Pruned move list for the solver: still legal moves, just fewer pointless ones. */
    solverMoves(s) {
      const sf = g.safe(s);
      if (sf) return [sf];
      const P = s.piles;
      return g.moves(s).filter((m) => {
        if (m.t !== 'm') return true;
        if (isFnd(m.from)) return false;
        if (isTab(m.from) && isTab(m.to)) {
          const p = P[m.from];
          if (m.i === 0 && !P[m.to].length) return false;
          if (m.i > 0 && p[m.i - 1].up) {
            const under = p[m.i - 1];
            return !!fndFor(P, under);
          }
        }
        return true;
      });
    },

    tapScore(s, m) {
      if (m.t !== 'm') return 1;
      const P = s.piles;
      if (isFnd(m.to)) return 100;
      if (isFnd(m.from)) return 5;
      const dst = P[m.to];
      let v = dst.length ? 60 : 30;
      if (isTab(m.from)) {
        if (m.i > 0 && !P[m.from][m.i - 1].up) v += 15;
        if (m.i === 0 && !dst.length) v = 2;
      }
      return v;
    },

    hud(s) {
      return [{ label: 'Score', value: s.score }, { label: 'Moves', value: s.moves }];
    },

    stockLabel(s) {
      return s.piles.stock.length ? '' : s.piles.waste.length ? '↻' : '';
    },

    layout(s, W, H) {
      const M = Math.max(8, Math.min(24, W * 0.015));
      const gapR = 0.14;
      const cw = Math.min(240, (W - 2 * M) / (7 + 6 * gapR), (H - 2 * M) / (1.4 * 3.55));
      const ch = cw * 1.4;
      const gap = cw * gapR;
      const x0 = (W - (7 * cw + 6 * gap)) / 2;
      const col = (c) => x0 + c * (cw + gap);
      const ty = M + ch + gap * 1.3;
      const piles = {
        stock: { x: col(0), y: M, fan: 'stack', slot: 'stock', z: 0 },
        waste: { x: col(1), y: M, fan: draw === 3 ? 'waste3' : 'stack', slot: 'none', z: 0 },
      };
      FND.forEach((f, k) => (piles[f] = { x: col(3 + k), y: M, fan: 'stack', slot: 'foundation', z: 0 }));
      TAB.forEach((t, k) => (piles[t] = { x: col(k), y: ty, fan: 'down', slot: 'king', maxY: H - M, z: 0 }));
      return { cw, ch, piles };
    },

    help: [
      'Move every card to the four piles at the top right, one suit each, from Ace up to King.',
      'In the seven columns, place a card on one that is one higher and the opposite color (red 6 on black 7). You can move a whole run of cards at once.',
      'Only a King (or a run starting with a King) can go into an empty column.',
      draw === 1
        ? 'Click the deck to turn over one card at a time. When it runs out, click it again to go through the cards once more.'
        : 'Click the deck to turn over three cards; only the top one can be played. When it runs out, click it again to go through once more.',
      'Click a card to send it to the best spot, or drag it where you want it.',
    ],
  };
  return g;
}

function range(a, b) {
  const r = [];
  for (let i = a; i < b; i++) r.push(i);
  return r;
}
