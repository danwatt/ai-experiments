// Lets the search bot play each board and mode, to tune goals and budgets.
//   node tools/tune.js [games per config] [search depth]
const F = require('../engine.js');
const games = +process.argv[2] || 20;
const depth = +process.argv[3] || 2;

for (const board of F.BOARDS) {
  for (const mode of F.MODES) {
    const tiles = {};
    const scores = [];
    let moves = 0;
    for (let n = 0; n < games; n++) {
      const g = new F.Game(board, mode, { seed: 1000 + n });
      g.keepPlaying = true;
      while (!g.over && g.moves < 20000) {
        const dir = F.suggestMove(g.topo, g.cells, depth);
        if (dir < 0) break;
        g.move(dir);
        g.history.length = 0;
      }
      tiles[g.maxTile] = (tiles[g.maxTile] || 0) + 1;
      scores.push(g.score);
      moves += g.moves;
    }
    scores.sort((a, b) => a - b);
    console.log(
      `${board.id}/${mode.id}`.padEnd(18),
      'max tile:', Object.entries(tiles).map(([t, c]) => `${t}×${c}`).join(' ').padEnd(44),
      'score p25/p50/p75:', scores[games >> 2], scores[games >> 1], scores[(games * 3) >> 2],
      'avg moves:', Math.round(moves / games));
  }
}
