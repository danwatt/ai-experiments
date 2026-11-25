// Goal tuning: let the hint bot play each board configuration and report how
// often it reaches each tile. Run:
//   node games/2048-opus-5.2-high-all-out/tools/tune.mjs [games=40] [budgetMs=8] [board] [stones]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../core/engine.js');

const N = +(process.argv[2] || 40);
const budget = +(process.argv[3] || 8);
const onlyBoard = process.argv[4];
const onlyStones = process.argv[5];

for (const board of H.BOARDS) {
  if (onlyBoard && board.id !== onlyBoard) continue;
  for (const stones of [false, true]) {
    if (onlyStones !== undefined && String(stones) !== onlyStones) continue;
    const tops = [];
    const moves = [];
    const t0 = Date.now();
    for (let k = 0; k < N; k++) {
      const g = new H.Game({ board: board.id, stones }, { seed: 1000 + k });
      while (!g.over && g.moves < (+process.env.CAP || 20000)) {
        const h = g.hint(budget);
        if (h.dir < 0) break;
        g.move(h.dir);
      }
      tops.push(g.maxTile);
      moves.push(g.moves);
      if (process.env.VERBOSE) console.log(`  ${board.id} stones=${stones} #${k}: top ${g.maxTile}, ${g.moves} moves`);
    }
    const reach = {};
    for (let v = 16; v <= 65536; v *= 2) reach[v] = tops.filter(t => t >= v).length / N;
    const line = Object.entries(reach).filter(([, p]) => p > 0).map(([v, p]) => `${v}:${Math.round(p * 100)}%`).join('  ');
    const avgMoves = Math.round(moves.reduce((a, b) => a + b, 0) / N);
    console.log(`${board.id.padEnd(8)} stones=${String(stones).padEnd(5)} goal=${stones ? board.stoneGoal : board.goal}  ${line}  avg moves ${avgMoves}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
