// Engine self-test. Run: node games/2048-opus-5.2-high-all-out/tools/test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const H = require('../core/engine.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok', name); };

const valuesOf = cells => cells.map(t => (t ? t.value : 0));
const fromValues = (vals) => { let id = 0; return vals.map(v => (v ? { id: ++id, value: v } : null)); };

test('topology sizes', () => {
  for (const b of H.BOARDS) {
    const t = H.buildTopology(b.radius);
    assert.equal(t.size, b.cells);
    // 1 + 3R(R+1)
    assert.equal(t.size, 1 + 3 * b.radius * (b.radius + 1));
    for (let d = 0; d < 6; d++) {
      const covered = t.lines[d].flat().sort((a, c) => a - c);
      assert.deepEqual(covered, t.open);
    }
  }
});

test('board stands on a point: up is straight up', () => {
  const t = H.buildTopology(2);
  const top = t.cells[t.indexOf(0, -2)];
  assert.equal(top.x, 0);
  assert.ok(top.z < 0);
  assert.ok(Math.abs(Math.hypot(top.x, top.z) - 2 * Math.sqrt(3)) < 1e-9);
});

test('line of 2 2 2 2 2 slides into 4 4 2', () => {
  const t = H.buildTopology(2);
  // the vertical column q=0: r = -2..2, sliding up (dir 0) packs toward r=-2
  const col = [-2, -1, 0, 1, 2].map(r => t.indexOf(0, r));
  const vals = new Array(t.size).fill(0);
  col.forEach(i => (vals[i] = 2));
  let id = 100;
  const res = H.slide(t, fromValues(vals), 0, () => ++id);
  assert.deepEqual(col.map(i => (res.cells[i] ? res.cells[i].value : 0)), [4, 4, 2, 0, 0]);
  assert.equal(res.gain, 8);
  assert.equal(res.merges.length, 2);
  assert.equal(res.moves.filter(m => m.consumed).length, 4);
});

test('merge once per move: 4 2 2 -> 4 4 not 8', () => {
  const t = H.buildTopology(1);
  const col = [-1, 0, 1].map(r => t.indexOf(0, r));
  const vals = new Array(t.size).fill(0);
  vals[col[0]] = 4; vals[col[1]] = 2; vals[col[2]] = 2;
  const res = H.slide(t, fromValues(vals), 0, () => 999);
  assert.deepEqual(col.map(i => (res.cells[i] ? res.cells[i].value : 0)), [4, 4, 0]);
});

test('stones split lines', () => {
  const t = H.buildTopology(2, [H.buildTopology(2).indexOf(0, 0)]);
  const col = [-2, -1, 1, 2].map(r => t.indexOf(0, r));
  const vals = new Array(t.size).fill(0);
  vals[col[3]] = 2; // bottom cell, below the stone
  const res = H.slide(t, fromValues(vals), 0, () => 999);
  assert.equal(res.cells[col[2]].value, 2, 'stops under the stone');
});

test('undo restores exact state and does not re-roll', () => {
  for (const board of ['mini', 'classic', 'grand']) {
    for (const stones of [false, true]) {
      const g = new H.Game({ board, stones }, { seed: 1234 });
      const states = [JSON.stringify([valuesOf(g.cells), g.score])];
      const dirs = [];
      for (let k = 0; k < 60 && !g.over; k++) {
        const d = [0, 2, 4, 1, 3, 5].find(x => g.canMove(x) && (k + x) % 3 !== 0) ?? [0, 1, 2, 3, 4, 5].find(x => g.canMove(x));
        if (d === undefined) break;
        assert.ok(g.move(d));
        dirs.push(d);
        states.push(JSON.stringify([valuesOf(g.cells), g.score]));
      }
      const after = states[states.length - 1];
      for (let k = states.length - 2; k >= 0; k--) {
        const tr = g.undo();
        assert.ok(tr);
        assert.equal(JSON.stringify([valuesOf(g.cells), g.score]), states[k], `${board}/${stones} undo #${k}`);
      }
      for (const d of dirs) g.move(d);
      assert.equal(JSON.stringify([valuesOf(g.cells), g.score]), after, 'redo is deterministic');
    }
  }
});

test('undo transition kinds cover every tile', () => {
  const g = new H.Game({ board: 'classic', stones: false }, { seed: 7 });
  let tr;
  for (let k = 0; k < 40; k++) { const d = [0, 1, 2, 3, 4, 5].find(x => g.canMove(x)); tr = g.move(d); if (tr.merges) break; }
  assert.ok(tr.merges > 0);
  const u = g.undo();
  const kinds = new Set(u.tiles.map(t => t.kind));
  assert.ok(kinds.has('vanish') && kinds.has('split'));
  // every restored tile id appears in cells exactly at its 'to' cell
  for (const t of u.tiles) if (t.kind !== 'vanish') assert.equal(g.cells[t.to].id, t.id);
});

test('serialize round trip keeps undo', () => {
  const g = new H.Game({ board: 'grand', stones: true }, { seed: 99 });
  for (let k = 0; k < 30; k++) { const d = [0, 1, 2, 3, 4, 5].find(x => g.canMove(x)); g.move(d); }
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const h = new H.Game({ board: 'mini' }, { saved: s });
  assert.equal(h.board.id, 'grand');
  assert.deepEqual(valuesOf(h.cells), valuesOf(g.cells));
  assert.deepEqual(h.stoneCells, g.stoneCells);
  h.undo(); g.undo();
  assert.deepEqual(valuesOf(h.cells), valuesOf(g.cells));
  assert.equal(new H.Game({ board: 'mini' }, { saved: { v: 2, board: 'nope' } }).board.id, 'mini');
});

test('stones rules', () => {
  for (let seed = 1; seed < 300; seed++) {
    for (const b of H.BOARDS) {
      const s = H.pickStones(b.radius, b.stones, H.makeRng(seed));
      assert.equal(s.length, b.stones);
      const t = H.buildTopology(b.radius, s);
      assert.ok(!s.includes(t.indexOf(0, 0)));
      assert.ok(t.open.every(i => t.degree[i] >= 2));
    }
  }
});

test('peek has no side effects', () => {
  const g = new H.Game({ board: 'classic' }, { seed: 5 });
  const before = JSON.stringify(g.serialize());
  for (let d = 0; d < 6; d++) g.peek(d);
  assert.equal(JSON.stringify(g.serialize()), before);
});

test('hint returns a legal move quickly', () => {
  const g = new H.Game({ board: 'grand', stones: true }, { seed: 3 });
  for (let k = 0; k < 50; k++) {
    const t0 = Date.now();
    const h = g.hint(40);
    assert.ok(Date.now() - t0 < 200);
    assert.ok(g.canMove(h.dir));
    g.move(h.dir);
  }
});

console.log(`\n${passed} tests passed`);
