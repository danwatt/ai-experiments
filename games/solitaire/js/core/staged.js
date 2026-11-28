// Experimental staged Spider solver: between deals, search for the best
// position from which a deal is allowed, then deal and continue.
import { settle } from './solver.js';

class Heap { constructor(){this.a=[]} get size(){return this.a.length}
  push(n,p){const a=this.a;n.pri=p;a.push(n);let i=a.length-1;while(i>0){const q=(i-1)>>1;if(a[q].pri>=a[i].pri)break;[a[q],a[i]]=[a[i],a[q]];i=q}}
  pop(){const a=this.a,t=a[0],l=a.pop();if(a.length){a[0]=l;let i=0;for(;;){const L=2*i+1,R=L+1;let m=i;if(L<a.length&&a[L].pri>a[m].pri)m=L;if(R<a.length&&a[R].pri>a[m].pri)m=R;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m}}return t}}

function stage(game, start, nodes, ev, seen) {
  const heap = new Heap();
  const root = { s: start, p: null, m: null };
  heap.push(root, ev(start));
  let best = game.canDeal(start) ? root : null, bestE = best ? ev(start) : -Infinity;
  let n = 0;
  while (heap.size && n++ < nodes) {
    const x = heap.pop();
    for (const m of game.solverMoves(x.s)) {
      if (m.t === 'deal') continue;
      const s = settle(game, game.apply(x.s, m));
      const k = game.key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = { s, p: x, m };
      if (game.isWon(s)) return { won: c };
      const e = ev(s);
      if ((game.canDeal(s) || !s.piles.stock.length) && e > bestE) { best = c; bestE = e; }
      heap.push(c, e);
    }
  }
  return { best };
}

const pathOf = (c) => { const p = []; for (let x = c; x && x.p; x = x.p) p.push(x.m); return p.reverse(); };

export function stagedSolve(game, start, { stageNodes = 4000, finalNodes = 40000, attempts = 10, rng = Math.random } = {}) {
  const base = game.w || [300, 5, 40, 25, 12, 3, 6];
  for (let a = 0; a < attempts; a++) {
    const w = base.map((v, i) => (a === 0 ? v : v * (0.6 + 0.8 * rng())));
    const saved = game.w; game.w = w;
    const ev = (s) => game.eval(s);
    let s = start, path = [];
    let ok = false;
    for (let st = 0; st < 7; st++) {
      const seen = new Set([game.key(s)]);
      const final = !s.piles.stock.length;
      const r = stage(game, s, final ? finalNodes : stageNodes, ev, seen);
      if (r.won) { path = path.concat(pathOf(r.won)); ok = true; break; }
      if (final || !r.best) break;
      path = path.concat(pathOf(r.best));
      s = r.best.s;
      if (!game.canDeal(s)) break;
      path.push({ t: 'deal' });
      s = settle(game, game.apply(s, { t: 'deal' }));
    }
    game.w = saved;
    if (ok) return path;
  }
  return null;
}
