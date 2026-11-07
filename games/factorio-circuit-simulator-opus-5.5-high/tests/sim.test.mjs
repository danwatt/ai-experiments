// Run with: ./run-tests.sh   (node:test inside Docker)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator, KINDS, ARITH_OPS, computeArithmetic, computeDecider, evalConditionList } from '../src/sim.js';
import { EACH, EVERYTHING, ANYTHING } from '../src/signals.js';

let nextId = 1;
function ent(kind, config = {}) {
  return { id: `e${nextId++}`, kind, config: { ...KINDS[kind].defaultConfig(), ...config }, state: {}, out: new Map() };
}
const wire = (color, a, ap, b, bp) => ({ color, a: { id: a.id, point: ap }, b: { id: b.id, point: bp } });
const obj = (m) => Object.fromEntries(m);
const both = { red: true, green: true };
const C = (first, cmp, value, extra = {}) => ({ first, cmp, second: { kind: 'const', value }, firstNets: both, secondNets: both, ...extra });
const mapInput = (o) => () => new Map(Object.entries(o));

test('int32 arithmetic matches the game', () => {
  assert.equal(ARITH_OPS['+'](2147483647, 1), -2147483648);
  assert.equal(ARITH_OPS['*'](65536, 65536), 0);
  assert.equal(ARITH_OPS['/'](7, 2), 3);
  assert.equal(ARITH_OPS['/'](-7, 2), -3);
  assert.equal(ARITH_OPS['/'](5, 0), 0);
  assert.equal(ARITH_OPS['%'](-7, 3), -1);
  assert.equal(ARITH_OPS['%'](5, 0), 0);
  assert.equal(ARITH_OPS['^'](2, 10), 1024);
  assert.equal(ARITH_OPS['^'](2, 31), -2147483648);
  assert.equal(ARITH_OPS['^'](3, -1), 0);
  assert.equal(ARITH_OPS['<<'](1, 4), 16);
  assert.equal(ARITH_OPS['>>'](-16, 2), -4);
  assert.equal(ARITH_OPS.XOR(6, 3), 5);
});

test('arithmetic: each on left, specific and each outputs', () => {
  const input = mapInput({ 'iron-plate': 10, coal: 3 });
  assert.deepEqual(obj(computeArithmetic({ left: { kind: 'signal', id: EACH }, op: '*', right: { kind: 'const', value: 2 }, output: EACH }, input)), { 'iron-plate': 20, coal: 6 });
  assert.deepEqual(obj(computeArithmetic({ left: { kind: 'signal', id: EACH }, op: '+', right: { kind: 'const', value: 0 }, output: 'signal-T' }, input)), { 'signal-T': 13 });
  assert.deepEqual(obj(computeArithmetic({ left: { kind: 'signal', id: 'coal' }, op: '-', right: { kind: 'signal', id: 'iron-plate' }, output: 'signal-D' }, input)), { 'signal-D': -7 });
});

test('decider: AND binds tighter than OR', () => {
  const input = mapInput({ 'signal-A': 50, 'signal-S': 1 });
  // A < 20 OR (S > 0 AND A < 90)
  const conds = [C('signal-A', '<', 20), C('signal-S', '>', 0, { join: 'or' }), C('signal-A', '<', 90, { join: 'and' })];
  assert.equal(evalConditionList(conds, input), true);
  assert.equal(evalConditionList(conds, mapInput({ 'signal-A': 50 })), false);
  assert.equal(evalConditionList(conds, mapInput({ 'signal-A': 10 })), true);
});

test('decider: wildcards', () => {
  const input = mapInput({ 'iron-plate': 120, coal: 30, stone: 300 });
  const each = computeDecider({ conditions: [C(EACH, '>', 50)], outputs: [{ signal: EACH, mode: 'input', nets: both }] }, input);
  assert.deepEqual(obj(each), { stone: 300, 'iron-plate': 120 });
  const count = computeDecider({ conditions: [C(EACH, '>', 50)], outputs: [{ signal: 'signal-N', mode: 'one', value: 1, nets: both }] }, input);
  assert.deepEqual(obj(count), { 'signal-N': 2 });
  const any = computeDecider({ conditions: [C(ANYTHING, '>', 200)], outputs: [{ signal: EVERYTHING, mode: 'one', value: 1, nets: both }] }, input);
  assert.deepEqual(obj(any), { 'iron-plate': 1, coal: 1, stone: 1 });
  const every = computeDecider({ conditions: [C(EVERYTHING, '>', 50)], outputs: [{ signal: 'signal-E', mode: 'one', value: 1, nets: both }] }, input);
  assert.deepEqual(obj(every), {});
  const empty = computeDecider({ conditions: [C(EVERYTHING, '>', 50)], outputs: [{ signal: 'signal-E', mode: 'one', value: 1, nets: both }] }, mapInput({}));
  assert.deepEqual(obj(empty), { 'signal-E': 1 });
});

test('wires of one colour join into a network that sums outputs', () => {
  const sim = new Simulator();
  const a = ent('constant', { signals: [{ id: 'iron-plate', value: 5 }] });
  const b = ent('constant', { signals: [{ id: 'iron-plate', value: 7 }, { id: 'coal', value: 1 }] });
  const lamp = ent('lamp', { condition: C('iron-plate', '=', 12) });
  sim.setGraph([a, b, lamp], [wire('red', a, 'main', lamp, 'main'), wire('red', b, 'main', lamp, 'main')]);
  sim.step(); // constants were primed on placement, so the lamp already sees the sum
  assert.equal(sim.networks.length, 1);
  assert.deepEqual(obj(sim.networks[0].signals), { 'iron-plate': 12, coal: 1 });
  assert.equal(lamp.state.on, true);
});

test('red and green are separate networks; a combinator adds them', () => {
  const sim = new Simulator();
  const r = ent('constant', { signals: [{ id: 'signal-A', value: 3 }] });
  const g = ent('constant', { signals: [{ id: 'signal-A', value: 4 }] });
  const ar = ent('arithmetic', { left: { kind: 'signal', id: 'signal-A' }, op: '*', right: { kind: 'const', value: 10 }, output: 'signal-B' });
  sim.setGraph([r, g, ar], [wire('red', r, 'main', ar, 'in'), wire('green', g, 'main', ar, 'in')]);
  sim.step(); sim.step();
  assert.deepEqual(obj(ar.out), { 'signal-B': 70 });
  ar.config.leftNets = { red: true, green: false };
  sim.step();
  assert.deepEqual(obj(ar.out), { 'signal-B': 30 });
});

test('each combinator adds one tick of delay', () => {
  const sim = new Simulator();
  const k = ent('constant', { signals: [{ id: 'signal-A', value: 1 }] });
  const a1 = ent('arithmetic', { left: { kind: 'signal', id: 'signal-A' }, op: '+', right: { kind: 'const', value: 0 }, output: 'signal-A' });
  const a2 = ent('arithmetic', { left: { kind: 'signal', id: 'signal-A' }, op: '+', right: { kind: 'const', value: 0 }, output: 'signal-A' });
  sim.setGraph([k, a1, a2], [wire('red', k, 'main', a1, 'in'), wire('red', a1, 'out', a2, 'in')]);
  // the constant is already on the wire; each combinator in the chain adds one tick
  sim.step();
  assert.equal(a1.out.get('signal-A'), 1);
  assert.equal(a2.out.size, 0);
  sim.step();
  assert.equal(a2.out.get('signal-A'), 1);
});

test('decider clock counts 1..N and wraps', () => {
  const sim = new Simulator();
  const k = ent('constant', { signals: [{ id: 'signal-C', value: 1 }] });
  const d = ent('decider', { conditions: [C('signal-C', '<', 5)], outputs: [{ signal: 'signal-C', mode: 'input', nets: both }] });
  sim.setGraph([k, d], [wire('red', k, 'main', d, 'in'), wire('red', d, 'out', d, 'in')]);
  const seen = [];
  for (let i = 0; i < 14; i++) { sim.step(); seen.push(d.out.get('signal-C') || 0); }
  // the constant is live from the start; the decider counts 1..4 then resets
  assert.deepEqual(seen, [1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
});

test('memory cell: button pulses accumulate and reset clears', () => {
  const sim = new Simulator();
  const inc = ent('button', { signal: 'signal-C', value: 1 });
  const rst = ent('button', { signal: 'signal-R', value: 1 });
  const mem = ent('decider', { conditions: [C('signal-R', '=', 0)], outputs: [{ signal: EVERYTHING, mode: 'input', nets: both }] });
  sim.setGraph([inc, rst, mem], [wire('red', inc, 'main', mem, 'in'), wire('red', rst, 'main', mem, 'in'), wire('red', mem, 'out', mem, 'in')]);
  const press = (b) => { b.state.pending = 1; };
  for (let n = 0; n < 3; n++) { press(inc); for (let i = 0; i < 5; i++) sim.step(); }
  assert.equal(mem.out.get('signal-C'), 3);
  press(rst);
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(mem.out.size, 0);
});

test('selector: select, count, stack size', () => {
  const sim = new Simulator();
  const chest = ent('chest', { items: [{ id: 'iron-plate', value: 40 }, { id: 'coal', value: 90 }, { id: 'stone', value: 10 }] });
  const top = ent('selector', { mode: 'select', descending: true, index: { kind: 'const', value: 0 } });
  const low = ent('selector', { mode: 'select', descending: false, index: { kind: 'const', value: 0 } });
  const cnt = ent('selector', { mode: 'count', countSignal: 'signal-N' });
  const stk = ent('selector', { mode: 'stack' });
  const ws = [top, low, cnt, stk].map((s) => wire('red', chest, 'main', s, 'in'));
  sim.setGraph([chest, top, low, cnt, stk], ws);
  sim.step(); sim.step();
  assert.deepEqual(obj(top.out), { coal: 90 });
  assert.deepEqual(obj(low.out), { stone: 10 });
  assert.deepEqual(obj(cnt.out), { 'signal-N': 3 });
  assert.deepEqual(obj(stk.out), { coal: 50, stone: 50, 'iron-plate': 100 });
});

test('assembler stops when its own contents reach the limit', () => {
  const sim = new Simulator();
  const asm = ent('assembler', { craftSeconds: 1 / 60, demandPerSecond: 0, condition: C('iron-gear', '<', 10) });
  const disp = ent('display');
  sim.setGraph([asm, disp], [wire('red', asm, 'main', disp, 'main')]);
  for (let i = 0; i < 100; i++) sim.step();
  assert.ok(asm.state.stock >= 10 && asm.state.stock <= 11, `stock ${asm.state.stock}`);
});

test('backup generator latch keeps accumulator between thresholds', () => {
  const sim = new Simulator();
  const acc = ent('accumulator', { capacityKJ: 1000, maxKW: 10000, startPercent: 50 });
  const load = ent('load', { demandKW: 600 });
  const gen = ent('generator', { outputKW: 1200, condition: C('signal-S', '>', 0) });
  const latch = ent('decider', {
    conditions: [C('signal-A', '<', 20), C('signal-S', '>', 0, { join: 'or' }), C('signal-A', '<', 90, { join: 'and' })],
    outputs: [{ signal: 'signal-S', mode: 'one', value: 1, nets: both }],
  });
  sim.setGraph([acc, load, gen, latch], [
    wire('red', acc, 'main', latch, 'in'),
    wire('green', latch, 'out', latch, 'in'),
    wire('green', latch, 'out', gen, 'main'),
  ]);
  let min = 100, max = 0, switches = 0, last = false;
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    if (i > 60) { min = Math.min(min, acc.state.percent); max = Math.max(max, acc.state.percent); }
    if (gen.state.on !== last) { switches++; last = gen.state.on; }
  }
  assert.ok(min >= 15 && max <= 95, `range ${min}..${max}`);
  assert.ok(switches >= 4, `switches ${switches}`);
});

test('accumulator charge is on the wire from the first tick (no false alarm)', () => {
  const sim = new Simulator();
  const acc = ent('accumulator', { startPercent: 70 });
  const d = ent('decider', { conditions: [C('signal-A', '<', 20)], outputs: [{ signal: 'signal-S', mode: 'one', value: 1, nets: both }] });
  sim.setGraph([acc, d], [wire('red', acc, 'main', d, 'in')]);
  for (let i = 0; i < 5; i++) { sim.step(); assert.equal(d.out.size, 0); }
});
