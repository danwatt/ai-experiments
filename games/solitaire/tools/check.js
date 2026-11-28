// Sanity check: deal each mode, solve, and replay the solution move by move
// against the legal-move list.  node tools/check.js [modes] [deals] [maxNodes]
import { MODES } from '../js/games/index.js';
import { solve, settle } from '../js/core/solver.js';
const which = process.argv[2] ? process.argv[2].split(',') : Object.keys(MODES);
const n = +(process.argv[3] || 30), maxNodes = +(process.argv[4] || 50000);
for (const id of which) {
  const g = MODES[id];
  let won = 0, t0 = Date.now(), nodesTotal = 0;
  for (let seed = 1; seed <= n; seed++) {
    let s = g.deal(seed);
    // sanity: card count
    const count = Object.values(s.piles).reduce((a, p) => a + p.length, 0);
    if (count !== g.deckSize) throw new Error(id + ' bad deal count ' + count);
    const path = solve(g, s, { maxNodes });
    if (path) {
      // replay to verify
      let r = g.deal(seed);
      for (const m of path) {
        const legal = g.moves(r).some((x) => JSON.stringify(x) === JSON.stringify(m)) || (g.safe && JSON.stringify(g.safe(r)) === JSON.stringify(m));
        if (!legal) throw new Error(id + ' illegal move in path ' + JSON.stringify(m));
        r = settle(g, g.apply(r, m));
      }
      if (!g.isWon(r)) throw new Error(id + ' replay not won');
      won++;
    }
  }
  console.log(id.padEnd(10), `won ${won}/${n}`, `${((Date.now() - t0) / n).toFixed(0)} ms/deal`);
}
