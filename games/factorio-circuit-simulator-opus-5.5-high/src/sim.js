// Circuit network simulation. Pure logic: no DOM, no Rete, no React.
//
// Model
//   entity  { id, kind, config, state, out }    out: Map<signalId, int32> placed on the entity's output point
//   wire    { color: 'red'|'green', a: {id, point}, b: {id, point} }   (undirected, like the game)
//
// Every (entity, point, colour) that has at least one wire belongs to exactly one network.
// Each tick:
//   1. every network value = sum of the outputs of all entities attached to it (int32 wrap)
//   2. every entity reads its input point(s) and computes its next output
//   3. all outputs switch over at once  ->  combinators have the game's 1-tick delay
//   4. the electric grid (solar, generators, loads, accumulators) is balanced

import { EACH, EVERYTHING, ANYTHING, isWildcard, bySignalOrder, stackSize, LAMP_COLOR_ORDER, signalInfo } from './signals.js';

export const TICKS_PER_SECOND = 60;

// ---------------------------------------------------------------- int32 maths

export const i32 = (x) => x | 0;

export const ARITH_OPS = {
  '+': (a, b) => (a + b) | 0,
  '-': (a, b) => (a - b) | 0,
  '*': (a, b) => Math.imul(a, b),
  '/': (a, b) => (b === 0 ? 0 : (a === -2147483648 && b === -1 ? a : Math.trunc(a / b) | 0)),
  '%': (a, b) => (b === 0 ? 0 : (a % b) | 0),
  '^': (a, b) => {
    if (b < 0) return 0;
    let result = 1, base = a, e = b;
    while (e > 0) {
      if (e & 1) result = Math.imul(result, base);
      base = Math.imul(base, base);
      e >>>= 1;
    }
    return result;
  },
  '<<': (a, b) => a << (b & 31),
  '>>': (a, b) => a >> (b & 31),
  'AND': (a, b) => a & b,
  'OR': (a, b) => a | b,
  'XOR': (a, b) => a ^ b,
};

export const COMPARATORS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '=': (a, b) => a === b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '!=': (a, b) => a !== b,
};
export const COMPARATOR_LABEL = { '>': '>', '<': '<', '=': '=', '>=': '≥', '<=': '≤', '!=': '≠' };

// ---------------------------------------------------------------- signal maps

/** Add `src` into `dst` (int32 wrap, zeros removed). */
export function addInto(dst, src, scale = 1) {
  if (!src) return dst;
  for (const [k, v] of src) {
    const n = (((dst.get(k) || 0) + v * scale) | 0);
    if (n === 0) dst.delete(k); else dst.set(k, n);
  }
  return dst;
}

function addSignal(dst, id, v) {
  const n = ((dst.get(id) || 0) + v) | 0;
  if (n === 0) dst.delete(id); else dst.set(id, n);
}

export function mapFromList(list) {
  const m = new Map();
  for (const row of list || []) {
    if (!row || !row.id || isWildcard(row.id)) continue;
    addSignal(m, row.id, i32(row.value));
  }
  return m;
}

export function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => bySignalOrder(a[0], b[0]));
}

const BOTH = { red: true, green: true };

// ---------------------------------------------------------------- conditions

/**
 * A condition: { first, cmp, second: {kind:'const', value} | {kind:'signal', id},
 *                firstNets?, secondNets?, join?: 'and'|'or' }
 * `input(nets)` returns the merged signal map for the selected wire colours.
 * `eachSignal` is the signal standing in for EACH (decider only).
 */
function secondValue(cond, input) {
  if (cond.second?.kind === 'signal') {
    if (!cond.second.id) return 0;
    return input(cond.secondNets || BOTH).get(cond.second.id) || 0;
  }
  return i32(cond.second?.value ?? 0);
}

export function evalCondition(cond, input, eachSignal) {
  if (!cond || !cond.first) return false;
  const cmp = COMPARATORS[cond.cmp] || COMPARATORS['>'];
  const rhs = secondValue(cond, input);
  const signals = input(cond.firstNets || BOTH);
  if (cond.first === EVERYTHING) {
    for (const v of signals.values()) if (!cmp(v, rhs)) return false;
    return true; // vacuously true with no signals, like the game
  }
  if (cond.first === ANYTHING) {
    for (const v of signals.values()) if (cmp(v, rhs)) return true;
    return false;
  }
  if (cond.first === EACH) {
    if (!eachSignal) return false;
    return cmp(signals.get(eachSignal) || 0, rhs);
  }
  return cmp(signals.get(cond.first) || 0, rhs);
}

/** OR of AND-groups: AND binds tighter, as in the game's decider. */
export function evalConditionList(conds, input, eachSignal) {
  if (!conds || conds.length === 0) return false;
  let any = false;
  let group = true;
  conds.forEach((c, i) => {
    if (i > 0 && c.join === 'or') {
      any = any || group;
      group = true;
    }
    group = group && evalCondition(c, input, eachSignal);
  });
  return any || group;
}

// ---------------------------------------------------------------- entity kinds

const COMBINATOR_POINTS = ['in', 'out'];
const SINGLE_POINT = ['main'];

const cond = (first, cmp, value) => ({ first, cmp, second: { kind: 'const', value }, firstNets: { ...BOTH }, secondNets: { ...BOTH } });

export const KINDS = {
  // ---------------------------- combinators
  constant: {
    primeOutput: true,
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ enabled: true, signals: [{ id: 'signal-A', value: 1 }] }),
    update(e) {
      e.next = e.config.enabled ? mapFromList(e.config.signals) : new Map();
    },
  },

  arithmetic: {
    points: COMBINATOR_POINTS,
    outPoint: 'out',
    defaultConfig: () => ({
      left: { kind: 'signal', id: 'signal-A', value: 0 },
      op: '*',
      right: { kind: 'const', id: null, value: 2 },
      leftNets: { ...BOTH },
      rightNets: { ...BOTH },
      output: 'signal-A',
    }),
    update(e, ctx) {
      e.next = computeArithmetic(e.config, (nets) => ctx.input('in', nets));
    },
  },

  decider: {
    points: COMBINATOR_POINTS,
    outPoint: 'out',
    defaultConfig: () => ({
      conditions: [cond('signal-A', '>', 0)],
      outputs: [{ signal: 'signal-A', mode: 'one', value: 1, nets: { ...BOTH } }],
    }),
    update(e, ctx) {
      e.next = computeDecider(e.config, (nets) => ctx.input('in', nets));
    },
  },

  selector: {
    points: COMBINATOR_POINTS,
    outPoint: 'out',
    defaultConfig: () => ({
      mode: 'select',
      descending: true,
      index: { kind: 'const', value: 0, id: null },
      countSignal: 'signal-C',
      interval: 60,
    }),
    update(e, ctx) {
      e.next = computeSelector(e, ctx.input('in', BOTH), ctx);
    },
  },

  // ---------------------------- buildings (one connection point, read and written)
  lamp: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ condition: cond('signal-A', '>', 0), useColors: false }),
    update(e, ctx) {
      const connected = ctx.connected('main');
      const input = (nets) => ctx.input('main', nets);
      const on = !connected || evalCondition(e.config.condition, input);
      let color = null;
      if (on && e.config.useColors && connected) {
        const all = input(BOTH);
        color = LAMP_COLOR_ORDER.find((id) => (all.get(id) || 0) > 0) || null;
      }
      e.state.on = on;
      e.state.color = color ? signalInfo(color).color : null;
      e.state.connected = connected;
      e.next = new Map();
    },
  },

  display: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ title: '' }),
    update(e) {
      e.next = new Map();
    },
  },

  chest: {
    primeOutput: true,
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ items: [{ id: 'iron-plate', value: 150 }], readContents: true }),
    update(e) {
      e.next = e.config.readContents ? mapFromList(e.config.items.filter((r) => signalInfo(r.id).type === 'item' && r.value > 0)) : new Map();
    },
  },

  assembler: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({
      recipe: 'iron-gear',
      craftSeconds: 0.5,
      demandPerSecond: 1,
      capacity: 500,
      enableByCircuit: true,
      condition: cond('iron-gear', '<', 100),
      readContents: true,
    }),
    update(e, ctx) {
      const s = e.state;
      s.stock ??= 0;
      s.progress ??= 0;
      s.demandAcc ??= 0;
      const c = e.config;
      const connected = ctx.connected('main');
      const enabled = !c.enableByCircuit || !connected || evalCondition(c.condition, (nets) => ctx.input('main', nets));
      const full = s.stock >= c.capacity;
      s.enabled = enabled;
      s.working = enabled && !full;
      if (s.working) {
        s.progress += 1 / Math.max(1, Math.round(c.craftSeconds * TICKS_PER_SECOND));
        if (s.progress >= 1 - 1e-9) {
          s.progress = 0;
          s.stock += 1;
          s.made = (s.made || 0) + 1;
        }
      }
      s.demandAcc += Math.max(0, c.demandPerSecond) / TICKS_PER_SECOND;
      while (s.demandAcc >= 1) {
        s.demandAcc -= 1;
        if (s.stock > 0) s.stock -= 1;
        else s.starved = (s.starved || 0) + 1;
      }
      e.next = new Map();
      if (c.readContents && s.stock > 0) e.next.set(c.recipe, s.stock);
    },
  },

  button: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ signal: 'signal-P', value: 1, mode: 'pulse' }),
    update(e) {
      const s = e.state;
      const c = e.config;
      let active = false;
      if (c.mode === 'toggle') active = !!s.toggled;
      else if (s.pending > 0) { active = true; s.pending -= 1; }
      s.active = active;
      e.next = new Map();
      if (active && c.signal && i32(c.value) !== 0) e.next.set(c.signal, i32(c.value));
    },
  },

  solar: {
    points: [],
    outPoint: null,
    defaultConfig: () => ({ peakKW: 300, daySeconds: 60 }),
    update(e, ctx) {
      e.state.light = daylight(ctx.tick, e.config.daySeconds);
      e.state.supplyKW = e.config.peakKW * e.state.light;
      e.next = new Map();
    },
  },

  generator: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ outputKW: 400, condition: cond('signal-S', '>', 0) }),
    update(e, ctx) {
      const connected = ctx.connected('main');
      e.state.connected = connected;
      e.state.on = !connected || evalCondition(e.config.condition, (nets) => ctx.input('main', nets));
      e.state.supplyKW = e.state.on ? e.config.outputKW : 0;
      e.next = new Map();
    },
  },

  accumulator: {
    primeOutput: true,
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ capacityKJ: 5000, maxKW: 600, signal: 'signal-A', startPercent: 50 }),
    update(e) {
      const s = e.state;
      if (s.charge == null) s.charge = (e.config.capacityKJ * (e.config.startPercent ?? 50)) / 100;
      s.charge = Math.min(s.charge, e.config.capacityKJ);
      s.percent = e.config.capacityKJ > 0 ? Math.floor((s.charge / e.config.capacityKJ) * 100) : 0;
      e.next = new Map();
      if (e.config.signal && s.percent !== 0) e.next.set(e.config.signal, s.percent);
    },
  },

  load: {
    points: SINGLE_POINT,
    outPoint: 'main',
    defaultConfig: () => ({ demandKW: 200, enableByCircuit: false, condition: cond('signal-A', '>', 0) }),
    update(e, ctx) {
      const c = e.config;
      const connected = ctx.connected('main');
      e.state.on = !c.enableByCircuit || !connected || evalCondition(c.condition, (nets) => ctx.input('main', nets));
      e.state.demandKW = e.state.on ? c.demandKW : 0;
      e.next = new Map();
    },
  },
};

// ---------------------------------------------------------------- combinator logic

function operandValue(op, input, nets, eachSignal) {
  if (!op) return 0;
  if (op.kind === 'const') return i32(op.value);
  if (op.id === EACH) return input(nets).get(eachSignal) || 0;
  if (!op.id) return 0;
  return input(nets).get(op.id) || 0;
}

export function computeArithmetic(c, input) {
  const out = new Map();
  const fn = ARITH_OPS[c.op] || ARITH_OPS['+'];
  const leftEach = c.left?.kind === 'signal' && c.left.id === EACH;
  const rightEach = c.right?.kind === 'signal' && c.right.id === EACH;
  const lNets = c.leftNets || BOTH;
  const rNets = c.rightNets || BOTH;
  if (!leftEach && !rightEach) {
    if (!c.output || isWildcard(c.output)) return out;
    const r = fn(operandValue(c.left, input, lNets), operandValue(c.right, input, rNets));
    if (r !== 0) out.set(c.output, r);
    return out;
  }
  const keys = new Set();
  if (leftEach) for (const k of input(lNets).keys()) keys.add(k);
  if (rightEach) for (const k of input(rNets).keys()) keys.add(k);
  for (const s of [...keys].sort(bySignalOrder)) {
    const r = fn(operandValue(c.left, input, lNets, s), operandValue(c.right, input, rNets, s));
    if (!c.output) continue;
    if (c.output === EACH) addSignal(out, s, r);
    else if (!isWildcard(c.output)) addSignal(out, c.output, r);
  }
  return out;
}

export function computeDecider(c, input) {
  const out = new Map();
  const conds = c.conditions || [];
  const outputs = c.outputs || [];
  const eachConds = conds.filter((x) => x.first === EACH);

  const emit = (o, passing) => {
    const nets = o.nets || BOTH;
    const one = o.mode !== 'input';
    const k = i32(o.value ?? 1);
    if (!o.signal) return;
    if (passing) {
      // "Each" mode: one entry per signal that passed
      for (const s of passing) {
        if (o.signal === EACH) addSignal(out, s, one ? k : (input(nets).get(s) || 0));
        else if (o.signal === EVERYTHING || o.signal === ANYTHING) continue;
        else addSignal(out, o.signal, one ? k : (input(nets).get(s) || 0));
      }
      return;
    }
    if (o.signal === EVERYTHING) {
      for (const [s, v] of input(nets)) addSignal(out, s, one ? k : v);
    } else if (o.signal === EACH || o.signal === ANYTHING) {
      // invalid without an Each condition: outputs nothing
    } else {
      addSignal(out, o.signal, one ? k : (input(nets).get(o.signal) || 0));
    }
  };

  if (eachConds.length === 0) {
    if (evalConditionList(conds, input)) for (const o of outputs) emit(o, null);
    return out;
  }
  const keys = new Set();
  for (const ec of eachConds) for (const k of input(ec.firstNets || BOTH).keys()) keys.add(k);
  const passing = [...keys].sort(bySignalOrder).filter((s) => evalConditionList(conds, input, s));
  if (passing.length === 0) return out;
  for (const o of outputs) {
    if (o.signal === EVERYTHING) emit(o, null);
    else emit(o, passing);
  }
  return out;
}

export function computeSelector(e, input, ctx) {
  const c = e.config;
  const out = new Map();
  const entries = sortedEntries(input);
  switch (c.mode) {
    case 'select': {
      const sorted = entries.slice().sort((a, b) => (c.descending ? b[1] - a[1] : a[1] - b[1]) || bySignalOrder(a[0], b[0]));
      const idx = c.index?.kind === 'signal' ? (c.index.id ? input.get(c.index.id) || 0 : 0) : i32(c.index?.value ?? 0);
      const hit = sorted[idx];
      if (idx >= 0 && hit) out.set(hit[0], hit[1]);
      break;
    }
    case 'count': {
      if (c.countSignal && entries.length) out.set(c.countSignal, entries.length);
      break;
    }
    case 'random': {
      const s = e.state;
      const interval = Math.max(1, i32(c.interval) || 1);
      s.timer = (s.timer ?? 0) + 1;
      if (s.choice == null || s.timer >= interval || !input.has(s.choice)) {
        s.timer = 0;
        s.choice = entries.length ? entries[Math.floor(ctx.random() * entries.length)][0] : null;
      }
      if (s.choice && input.has(s.choice)) out.set(s.choice, input.get(s.choice));
      break;
    }
    case 'stack': {
      for (const [id] of entries) {
        const n = stackSize(id);
        if (n) out.set(id, n);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------- electricity

export function daylight(tick, daySeconds) {
  const len = Math.max(1, daySeconds) * TICKS_PER_SECOND;
  const phase = (tick % len) / len; // 0 = noon
  const v = (Math.cos(phase * Math.PI * 2) + 0.25) * 1.4;
  return Math.max(0, Math.min(1, v));
}

function balanceGrid(entities) {
  let supply = 0;
  let demand = 0;
  const accs = [];
  for (const e of entities) {
    if (e.kind === 'solar' || e.kind === 'generator') supply += e.state.supplyKW || 0;
    else if (e.kind === 'load') demand += e.state.demandKW || 0;
    else if (e.kind === 'accumulator') accs.push(e);
  }
  const grid = { supplyKW: supply, demandKW: demand, accumulatorKW: 0, satisfaction: 1, hasGrid: supply > 0 || demand > 0 || accs.length > 0 };
  const perTick = (kw) => kw / TICKS_PER_SECOND; // kJ per tick
  let net = perTick(supply - demand);
  if (net > 0) {
    // charge accumulators, surplus is wasted
    for (const a of accs) {
      const room = Math.max(0, a.config.capacityKJ - a.state.charge);
      const take = Math.min(net / accs.length, perTick(a.config.maxKW), room);
      a.state.charge += take;
      grid.accumulatorKW -= take * TICKS_PER_SECOND;
    }
  } else if (net < 0) {
    let need = -net;
    let got = 0;
    for (const a of accs) {
      const give = Math.min(need / accs.length, perTick(a.config.maxKW), a.state.charge);
      a.state.charge -= give;
      got += give;
    }
    grid.accumulatorKW = got * TICKS_PER_SECOND;
    grid.satisfaction = demand > 0 ? Math.min(1, (supply + got * TICKS_PER_SECOND) / demand) : 1;
  }
  for (const e of entities) if (e.kind === 'load') e.state.satisfaction = e.state.on ? grid.satisfaction : 1;
  return grid;
}

// ---------------------------------------------------------------- simulator

function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Simulator {
  constructor() {
    this.tick = 0;
    this.entities = [];
    this.wires = [];
    this.networks = []; // [{ id, color, members: [{id, point}], signals: Map }]
    this.pointNet = new Map(); // `${id}|${point}|${color}` -> network
    this.grid = { supplyKW: 0, demandKW: 0, satisfaction: 1, accumulatorKW: 0, hasGrid: false };
    this.random = makeRandom(12345);
  }

  static key(id, point, color) {
    return `${id}|${point}|${color}`;
  }

  /** Replace the graph. Entities keep their state; networks are rebuilt. */
  setGraph(entities, wires) {
    this.entities = entities;
    for (const e of entities) {
      e.state ??= {};
      e.out ??= new Map();
      // Sources that don't read the network publish immediately when placed, so nothing downstream
      // sees a bogus "signal missing" on the first tick (e.g. an accumulator reading as 0%).
      const kind = KINDS[e.kind];
      if (kind?.primeOutput && !e.state.primed) {
        e.state.primed = true;
        kind.update(e, { tick: this.tick, random: this.random, connected: () => false, input: () => new Map() });
        e.out = e.next;
        e.next = null;
      }
    }
    this.wires = wires;
    this.rebuildNetworks();
  }

  rebuildNetworks() {
    const parent = new Map();
    const find = (k) => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r);
      let c = k;
      while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; }
      return r;
    };
    const touch = (k) => { if (!parent.has(k)) parent.set(k, k); };
    for (const w of this.wires) {
      const a = Simulator.key(w.a.id, w.a.point, w.color);
      const b = Simulator.key(w.b.id, w.b.point, w.color);
      touch(a); touch(b);
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const byRoot = new Map();
    // stable numbering: walk entities in order
    const order = [];
    for (const e of this.entities) for (const p of KINDS[e.kind]?.points || []) for (const color of ['red', 'green']) order.push([e.id, p, color]);
    this.networks = [];
    this.pointNet = new Map();
    const counter = { red: 0, green: 0 };
    for (const [id, point, color] of order) {
      const k = Simulator.key(id, point, color);
      if (!parent.has(k)) continue;
      const root = find(k);
      let net = byRoot.get(root);
      if (!net) {
        counter[color] += 1;
        net = { id: `${color[0].toUpperCase()}${counter[color]}`, color, members: [], signals: new Map() };
        byRoot.set(root, net);
        this.networks.push(net);
      }
      net.members.push({ id, point });
      this.pointNet.set(k, net);
    }
    this.computeNetworkValues();
  }

  computeNetworkValues() {
    const byId = new Map(this.entities.map((e) => [e.id, e]));
    for (const net of this.networks) {
      net.signals = new Map();
      for (const m of net.members) {
        const e = byId.get(m.id);
        if (e && KINDS[e.kind]?.outPoint === m.point) addInto(net.signals, e.out);
      }
    }
  }

  network(id, point, color) {
    return this.pointNet.get(Simulator.key(id, point, color)) || null;
  }

  /** Merged signals seen at a point (selected colours). */
  input(id, point, nets = BOTH) {
    const m = new Map();
    if (nets.red !== false) addInto(m, this.network(id, point, 'red')?.signals);
    if (nets.green !== false) addInto(m, this.network(id, point, 'green')?.signals);
    return m;
  }

  step() {
    this.computeNetworkValues();
    const sim = this;
    for (const e of this.entities) {
      const kind = KINDS[e.kind];
      if (!kind) continue;
      const cache = new Map();
      const ctx = {
        tick: this.tick,
        random: this.random,
        connected: (point) => !!(sim.network(e.id, point, 'red') || sim.network(e.id, point, 'green')),
        input: (point, nets = BOTH) => {
          const key = `${point}|${nets.red !== false}|${nets.green !== false}`;
          let m = cache.get(key);
          if (!m) { m = sim.input(e.id, point, nets); cache.set(key, m); }
          return m;
        },
      };
      kind.update(e, ctx);
    }
    for (const e of this.entities) {
      if (e.next) { e.out = e.next; e.next = null; }
    }
    this.grid = balanceGrid(this.entities);
    this.tick += 1;
    // keep network values in sync with the outputs just produced (for display)
    this.computeNetworkValues();
  }
}
