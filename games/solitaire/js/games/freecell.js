// FreeCell: every card face up from the start, four free cells to park single
// cards, build down in alternating colors. How many cards move at once
// depends on empty cells and columns.
import { mulberry32, shuffle } from '../core/rng.js';
import { newDeck, red, up, top, moveCards, pileKey } from '../core/cards.js';

const TAB = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
const CELL = ['c0', 'c1', 'c2', 'c3'];
const FND = ['f0', 'f1', 'f2', 'f3'];
const isTab = (p) => p[0] === 't';
const isCell = (p) => p[0] === 'c';
const isFnd = (p) => p[0] === 'f';

const alt = (a, b) => a.r === b.r + 1 && red(a.s) !== red(b.s);
function seqOK(p, i) {
  if (i < 0 || i >= p.length) return false;
  for (let k = i; k < p.length - 1; k++) if (!alt(p[k], p[k + 1])) return false;
  return true;
}
function seqStart(p) {
  if (!p.length) return 0;
  let i = p.length - 1;
  while (i > 0 && alt(p[i - 1], p[i])) i--;
  return i;
}
const fndAccepts = (pile, c) => {
  const t = top(pile);
  return t ? t.s === c.s && t.r + 1 === c.r : c.r === 1;
};
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
function isSafe(P, c) {
  if (c.r <= 2) return true;
  const r = suitRanks(P);
  const opp = red(c.s) ? [0, 3] : [1, 2];
  return r[opp[0]] >= c.r - 1 && r[opp[1]] >= c.r - 1;
}

export function makeFreeCell() {
  const g = {
    id: 'freecell',
    family: 'freecell',
    title: 'FreeCell',
    subtitle: 'Every card face up',
    deckSize: 52,

    deal(seed) {
      const deck = shuffle(newDeck([0, 1, 2, 3]), mulberry32(seed)).map(up);
      const piles = {};
      for (const t of TAB) piles[t] = [];
      for (const c of CELL) piles[c] = [];
      for (const f of FND) piles[f] = [];
      deck.forEach((c, n) => piles[TAB[n % 8]].push(c));
      return { piles, moves: 0, fx: [] };
    },

    capacity(s, to) {
      const P = s.piles;
      const free = CELL.filter((c) => !P[c].length).length;
      let empty = TAB.filter((t) => !P[t].length).length;
      if (to && isTab(to) && !P[to].length) empty--;
      return (free + 1) * 2 ** Math.max(0, empty);
    },

    canPick(s, pile, i) {
      const p = s.piles[pile];
      if (!p || i >= p.length) return false;
      if (isTab(pile)) return seqOK(p, i);
      if (isCell(pile)) return i === 0;
      return false;
    },

    canMove(s, from, i, to) {
      if (from === to || !g.canPick(s, from, i)) return false;
      const P = s.piles, src = P[from], dst = P[to];
      const c = src[i];
      const n = src.length - i;
      if (isFnd(to)) return n === 1 && fndAccepts(dst, c);
      if (isCell(to)) return n === 1 && !dst.length && !isCell(from);
      if (isTab(to)) {
        const t = top(dst);
        return (!t || alt(t, c)) && n <= g.capacity(s, to);
      }
      return false;
    },

    explainMove(s, from, i, to) {
      if (!isTab(to) || !g.canPick(s, from, i)) return '';
      const n = s.piles[from].length - i;
      const cap = g.capacity(s, to);
      const t = top(s.piles[to]);
      if (n > cap && (!t || alt(t, s.piles[from][i])))
        return `You can move ${cap} card${cap === 1 ? '' : 's'} at a time right now. Empty a free cell or column to move more.`;
      return '';
    },

    moves(s) {
      const P = s.piles, out = [];
      for (const from of [...TAB, ...CELL]) {
        const c = top(P[from]);
        if (!c) continue;
        const f = fndFor(P, c);
        if (f) out.push({ t: 'm', from, i: P[from].length - 1, to: f });
      }
      for (const from of [...TAB, ...CELL]) {
        const p = P[from];
        if (!p.length) continue;
        const starts = isTab(from) ? range(seqStart(p), p.length) : [0];
        for (const i of starts) {
          let empty = false;
          for (const to of TAB) {
            if (to === from) continue;
            if (!P[to].length && empty) continue;
            if (g.canMove(s, from, i, to)) {
              if (!P[to].length) empty = true;
              out.push({ t: 'm', from, i, to });
            }
          }
        }
      }
      const cell = CELL.find((c) => !P[c].length);
      if (cell) for (const from of TAB) if (P[from].length) out.push({ t: 'm', from, i: P[from].length - 1, to: cell });
      return out;
    },

    apply(s, m) {
      const { P, moving } = moveCards(s.piles, m.from, m.i, m.to);
      const fx = isFnd(m.to) ? [{ k: 'home', pile: m.to, r: moving[0].r }] : [];
      return { ...s, piles: P, moves: s.moves + 1, fx };
    },

    safe(s) {
      const P = s.piles;
      for (const from of [...CELL, ...TAB]) {
        const c = top(P[from]);
        if (!c) continue;
        const f = fndFor(P, c);
        if (f && isSafe(P, c)) return { t: 'm', from, i: P[from].length - 1, to: f };
      }
      return null;
    },

    canFinish(s) {
      if (g.isWon(s)) return false;
      return TAB.every((t) => {
        const p = s.piles[t];
        for (let k = 0; k < p.length - 1; k++) if (p[k].r < p[k + 1].r) return false;
        return true;
      });
    },
    finishMove(s) {
      const P = s.piles;
      let best = null;
      for (const from of [...TAB, ...CELL]) {
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
      const cells = CELL.map((c) => pileKey(P[c])).sort().join('');
      return cols + '#' + cells + '#' + suitRanks(P).join(',');
    },

    eval(s) {
      const P = s.piles;
      const need = suitRanks(P).map((r) => r + 1);
      let e = 0;
      for (const f of FND) e += P[f].length * 10;
      const freeCells = CELL.filter((c) => !P[c].length).length;
      const emptyCols = TAB.filter((t) => !P[t].length).length;
      e += freeCells * 4 + emptyCols * 9;
      for (const t of TAB) {
        const p = P[t];
        for (let k = 0; k < p.length; k++) {
          const c = p[k];
          if (c.r <= need[c.s] + 1) e -= (p.length - 1 - k) * 3;
          if (k < p.length - 1 && !alt(p[k], p[k + 1])) e -= 2;
        }
      }
      return e;
    },

    solverMoves(s) {
      const sf = g.safe(s);
      if (sf) return [sf];
      const P = s.piles;
      return g.moves(s).filter((m) => {
        if (isTab(m.from) && isTab(m.to) && m.i === 0 && !P[m.to].length) return false;
        return true;
      });
    },

    tapScore(s, m) {
      const P = s.piles;
      if (isFnd(m.to)) return 100;
      if (isTab(m.to)) {
        if (!P[m.to].length) return isTab(m.from) && m.i === 0 ? 1 : 25;
        return 70;
      }
      if (isCell(m.to)) return 40;
      return 1;
    },

    hud(s) {
      const home = FND.reduce((n, f) => n + s.piles[f].length, 0);
      return [{ label: 'Home', value: home + '/52' }, { label: 'Moves', value: s.moves }];
    },

    layout(s, W, H) {
      const M = Math.max(8, Math.min(24, W * 0.015));
      const gapR = 0.13;
      const cw = Math.min(220, (W - 2 * M) / (8 + 7 * gapR), (H - 2 * M) / (1.4 * 3.75));
      const ch = cw * 1.4;
      const gap = cw * gapR;
      const x0 = (W - (8 * cw + 7 * gap)) / 2;
      const col = (c) => x0 + c * (cw + gap);
      const piles = {};
      CELL.forEach((c, k) => (piles[c] = { x: col(k) - gap * 0.4, y: M, fan: 'stack', slot: 'cell', z: 0 }));
      FND.forEach((f, k) => (piles[f] = { x: col(4 + k) + gap * 0.4, y: M, fan: 'stack', slot: 'foundation', z: 0 }));
      const ty = M + ch + gap * 1.3;
      TAB.forEach((t, k) => (piles[t] = { x: col(k), y: ty, fan: 'down', slot: 'tableau', maxY: H - M, z: 0 }));
      return { cw, ch, piles };
    },

    help: [
      'Move all cards to the four piles at the top right, one suit each, from Ace up to King.',
      'In the columns, place a card on one that is one higher and the opposite color.',
      'The four spaces at the top left are free cells. Each can hold any one card for a while.',
      'You can move a run of cards at once if there are enough empty free cells and columns to do it one card at a time.',
      'Nearly every FreeCell deal can be won. Take your time and use Undo freely.',
    ],
  };
  return g;
}

function range(a, b) {
  const r = [];
  for (let i = a; i < b; i++) r.push(i);
  return r;
}
