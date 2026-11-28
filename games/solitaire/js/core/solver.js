// Generic best-first search over a game's own rules. It only ever plays moves
// the game itself generates, so any line it finds is a real, legal win.
// Used offline (tools/gen-winnable.js) to prove deals winnable, and in the
// browser with a small budget to power the Hint button.

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, pri) {
    const a = this.a;
    node.pri = pri;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri >= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri > a[m].pri) m = l;
        if (r < a.length && a[r].pri > a[m].pri) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Apply a game's mandatory follow-up moves (e.g. Spider removing a finished run). */
export function settle(game, s) {
  if (!game.forced) return s;
  for (let guard = 0; guard < 20; guard++) {
    const f = game.forced(s);
    if (!f) break;
    s = game.apply(s, f);
  }
  return s;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Best-first search. Returns the list of moves to a win, or null when the
 * budget runs out (which does not mean the deal is lost).
 */
export function solve(game, start, { maxNodes = 100000, timeMs = Infinity, depthWeight = 0 } = {}) {
  const t0 = now();
  const seen = new Set();
  const heap = new Heap();
  const gen = game.solverMoves ? (s) => game.solverMoves(s) : (s) => game.moves(s);
  const root = { s: start, p: null, m: null, d: 0 };
  if (game.isWon(start)) return [];
  seen.add(game.key(start));
  heap.push(root, game.eval(start));
  let nodes = 0;
  while (heap.size) {
    const n = heap.pop();
    if (++nodes > maxNodes) return null;
    if ((nodes & 255) === 0 && now() - t0 > timeMs) return null;
    for (const m of gen(n.s)) {
      const s = settle(game, game.apply(n.s, m));
      const k = game.key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = { s, p: n, m, d: n.d + 1 };
      if (game.isWon(s)) {
        const path = [];
        for (let x = c; x.p; x = x.p) path.push(x.m);
        return path.reverse();
      }
      heap.push(c, game.eval(s) - depthWeight * c.d);
    }
  }
  return null;
}

/**
 * Beam search: keep the `width` best states at each depth. Better than
 * best-first for Spider, where huge plateaus of equal-looking shuffles
 * swallow a global queue.
 */
export function beam(game, start, { width = 200, maxDepth = 400, timeMs = Infinity } = {}) {
  const t0 = now();
  const gen = game.solverMoves ? (s) => game.solverMoves(s) : (s) => game.moves(s);
  const seen = new Set([game.key(start)]);
  let level = [{ s: start, p: null, m: null }];
  if (game.isWon(start)) return [];
  for (let d = 0; d < maxDepth && level.length; d++) {
    if (now() - t0 > timeMs) return null;
    const next = [];
    for (const n of level) {
      for (const m of gen(n.s)) {
        const s = settle(game, game.apply(n.s, m));
        const k = game.key(s);
        if (seen.has(k)) continue;
        seen.add(k);
        const c = { s, p: n, m, e: game.eval(s) };
        if (game.isWon(s)) {
          const path = [];
          for (let x = c; x.p; x = x.p) path.push(x.m);
          return path.reverse();
        }
        next.push(c);
      }
    }
    next.sort((a, b) => b.e - a.e);
    level = next.length > width ? next.slice(0, width) : next;
  }
  return null;
}
