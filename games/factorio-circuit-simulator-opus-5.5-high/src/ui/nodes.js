// Per-kind UI: titles, help text, settings editors and live read-outs.
import { React, html } from '../../vendor/rete-bundle.js';
import { app, useStore } from '../state.js';
import { ARITH_OPS, KINDS } from '../sim.js';
import { EACH, EVERYTHING, ANYTHING, signalInfo } from '../signals.js';
import { Chip, SignalList, SignalPicker, Num, Check, Select, Nets, Operand, ConditionEditor, fmt } from './components.js';

const BOTH = { red: true, green: true };

// ---------------------------------------------------------------- live read-outs

function NetLine({ node, point, label }) {
  const sim = app.sim;
  const red = sim.network(node.id, point, 'red');
  const green = sim.network(node.id, point, 'green');
  return html`<div className="io-line">
    <span className="io-label">${label}</span>
    ${!red && !green && html`<span className="muted">no wire</span>`}
    ${red && html`<span className="io-net"><span className="net-tag red">${red.id}</span><${SignalList} map=${red.signals} /></span>`}
    ${green && html`<span className="io-net"><span className="net-tag green">${green.id}</span><${SignalList} map=${green.signals} /></span>`}
  </div>`;
}

function OutLine({ node, label = 'Out' }) {
  return html`<div className="io-line"><span className="io-label">${label}</span><${SignalList} map=${node.out} /></div>`;
}

function CombinatorIO({ node }) {
  useStore();
  return html`<div className="io">
    <${NetLine} node=${node} point="in" label="Input" />
    <${OutLine} node=${node} label="Output" />
  </div>`;
}

function PointIO({ node, showOut = true }) {
  useStore();
  return html`<div className="io">
    <${NetLine} node=${node} point="main" label="Wire" />
    ${showOut && html`<${OutLine} node=${node} label="Puts" />`}
  </div>`;
}

// ---------------------------------------------------------------- list editor (constant combinator, chest)

function SignalRows({ rows, onChange, itemsOnly = false, addLabel = '+ Add signal' }) {
  return html`<div className="rows">
    ${rows.map((r, i) => html`<div className="row" key=${i}>
      <${SignalPicker} value=${r.id} itemsOnly=${itemsOnly} onChange=${(v) => { r.id = v; onChange(); }} />
      <${Num} value=${r.value} onChange=${(v) => { r.value = v; onChange(); }} width=${72} />
      <button className="icon-btn" title="Remove" onClick=${() => { rows.splice(i, 1); onChange(); }}>×</button>
    </div>`)}
    <button className="add-btn" onClick=${() => { rows.push({ id: itemsOnly ? 'iron-plate' : 'signal-A', value: 1 }); onChange(); }}>${addLabel}</button>
  </div>`;
}

// ---------------------------------------------------------------- combinators

function ConstantBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><${Check} checked=${c.enabled} label="On" onChange=${(v) => { c.enabled = v; onChange(); }} title="Switch the combinator on/off" /></div>
    <${SignalRows} rows=${c.signals} onChange=${onChange} />
  </div>`;
}

const OP_OPTIONS = Object.keys(ARITH_OPS).map((k) => [k, k]);

function ArithmeticBody({ node, onChange }) {
  const c = node.config;
  c.leftNets ??= { ...BOTH };
  c.rightNets ??= { ...BOTH };
  const usesEach = (c.left.kind === 'signal' && c.left.id === EACH) || (c.right.kind === 'signal' && c.right.id === EACH);
  return html`<div className="arith">
    <div className="row">
      <${Operand} op=${c.left} wildcards=${[EACH]} onChange=${onChange} title="Left operand" />
      ${c.left.kind === 'signal' && html`<${Nets} nets=${c.leftNets} onChange=${(n) => { c.leftNets = n; onChange(); }} />`}
    </div>
    <div className="row">
      <${Select} className="op" value=${c.op} options=${OP_OPTIONS} onChange=${(v) => { c.op = v; onChange(); }} title="Operation" />
      <${Operand} op=${c.right} wildcards=${[EACH]} onChange=${onChange} title="Right operand" />
      ${c.right.kind === 'signal' && html`<${Nets} nets=${c.rightNets} onChange=${(n) => { c.rightNets = n; onChange(); }} />`}
    </div>
    <div className="row"><span className="lbl">Output</span>
      <${SignalPicker} value=${c.output} wildcards=${usesEach ? [EACH] : []} onChange=${(v) => { c.output = v; onChange(); }} />
    </div>
    ${c.output === EACH && !usesEach && html`<div className="warn">Output "Each" needs Each as an input.</div>`}
  </div>`;
}

function DeciderBody({ node, onChange }) {
  const c = node.config;
  const usesEach = c.conditions.some((x) => x.first === EACH);
  return html`<div className="decider">
    <div className="sub">Conditions</div>
    ${c.conditions.map((cd, i) => html`<div key=${i}>
      ${i > 0 && html`<div className=${`join join-${cd.join || 'and'}`}>
        <button className=${cd.join !== 'or' ? 'on' : ''} onClick=${() => { cd.join = 'and'; onChange(); }}>AND</button>
        <button className=${cd.join === 'or' ? 'on' : ''} onClick=${() => { cd.join = 'or'; onChange(); }}>OR</button>
      </div>`}
      <div className="row">
        <${ConditionEditor} c=${cd} onChange=${onChange} wildcards=${[EVERYTHING, ANYTHING, EACH]} />
        ${c.conditions.length > 1 && html`<button className="icon-btn" title="Remove" onClick=${() => { c.conditions.splice(i, 1); onChange(); }}>×</button>`}
      </div>
    </div>`)}
    <button className="add-btn" onClick=${() => {
      c.conditions.push({ first: 'signal-A', cmp: '>', second: { kind: 'const', value: 0 }, firstNets: { ...BOTH }, secondNets: { ...BOTH }, join: 'and' });
      onChange();
    }}>+ Add condition</button>
    <div className="sub">Outputs</div>
    ${c.outputs.map((o, i) => html`<div className="row" key=${i}>
      <${SignalPicker} value=${o.signal} wildcards=${usesEach ? [EVERYTHING, EACH] : [EVERYTHING]} onChange=${(v) => { o.signal = v; onChange(); }} />
      <${Select} value=${o.mode} options=${[['one', 'Constant'], ['input', 'Input count']]} onChange=${(v) => { o.mode = v; onChange(); }} title="Output a fixed value, or copy the input value" />
      ${o.mode === 'input'
        ? html`<${Nets} nets=${o.nets || BOTH} onChange=${(n) => { o.nets = n; onChange(); }} title="Which input wires to copy from" />`
        : html`<${Num} value=${o.value ?? 1} onChange=${(v) => { o.value = v; onChange(); }} width=${52} />`}
      <button className="icon-btn" title="Remove" onClick=${() => { c.outputs.splice(i, 1); onChange(); }}>×</button>
    </div>`)}
    <button className="add-btn" onClick=${() => { c.outputs.push({ signal: 'signal-A', mode: 'one', value: 1, nets: { ...BOTH } }); onChange(); }}>+ Add output</button>
    ${c.outputs.some((o) => o.signal === EACH) && !usesEach && html`<div className="warn">Output "Each" needs an Each condition.</div>`}
  </div>`;
}

const SELECTOR_MODES = [['select', 'Select input'], ['count', 'Count inputs'], ['random', 'Random input'], ['stack', 'Stack size']];

function SelectorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><${Select} value=${c.mode} options=${SELECTOR_MODES} onChange=${(v) => { c.mode = v; onChange(); }} /></div>
    ${c.mode === 'select' && html`<div>
      <div className="row"><span className="lbl">Order</span>
        <${Select} value=${c.descending ? 'd' : 'a'} options=${[['d', 'Descending (largest first)'], ['a', 'Ascending (smallest first)']]} onChange=${(v) => { c.descending = v === 'd'; onChange(); }} />
      </div>
      <div className="row"><span className="lbl">Index</span><${Operand} op=${c.index} onChange=${onChange} /></div>
    </div>`}
    ${c.mode === 'count' && html`<div className="row"><span className="lbl">Output</span><${SignalPicker} value=${c.countSignal} onChange=${(v) => { c.countSignal = v; onChange(); }} /></div>`}
    ${c.mode === 'random' && html`<div className="row"><span className="lbl">Every</span><${Num} value=${c.interval} min=${1} onChange=${(v) => { c.interval = v; onChange(); }} /> ticks</div>`}
    ${c.mode === 'stack' && html`<div className="hint">Outputs each input item with its stack size.</div>`}
  </div>`;
}

// ---------------------------------------------------------------- buildings

function LampBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">On when</span></div>
    <div className="row"><${ConditionEditor} c=${c.condition} onChange=${onChange} /></div>
    <div className="row"><${Check} checked=${c.useColors} label="Use colours" onChange=${(v) => { c.useColors = v; onChange(); }} /></div>
  </div>`;
}

function LampLive({ node }) {
  useStore();
  const s = node.state;
  const color = s.color || '#ffe9a8';
  return html`<div className="lamp-live">
    <div className=${`lamp ${s.on ? 'on' : ''}`} style=${{ '--lamp': color }}></div>
    <span>${s.on ? 'ON' : 'off'}${s.connected === false ? ' (no wire: always on)' : ''}</span>
  </div>`;
}

function DisplayLive({ node }) {
  useStore();
  const sim = app.sim;
  const red = sim.network(node.id, 'main', 'red');
  const green = sim.network(node.id, 'main', 'green');
  const total = sim.input(node.id, 'main');
  const block = (net, cls) => html`<div className=${`disp-block ${cls}`}>
    <div className="disp-head">${net ? `${cls} network ${net.id}` : `no ${cls} wire`}</div>
    ${net && html`<${SignalList} map=${net.signals} empty="(nothing)" />`}
  </div>`;
  return html`<div className="display">
    ${block(red, 'red')}
    ${block(green, 'green')}
    <div className="disp-block sum"><div className="disp-head">red + green (what a combinator reads)</div><${SignalList} map=${total} empty="(nothing)" /></div>
  </div>`;
}

function ChestBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${SignalRows} rows=${c.items} itemsOnly onChange=${onChange} addLabel="+ Add item" />
    <div className="row"><${Check} checked=${c.readContents} label="Read contents" onChange=${(v) => { c.readContents = v; onChange(); }} /></div>
  </div>`;
}

function AssemblerBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Makes</span><${SignalPicker} value=${c.recipe} itemsOnly onChange=${(v) => { c.recipe = v; onChange(); }} /></div>
    <div className="row"><span className="lbl">Craft time</span><${Num} float value=${c.craftSeconds} min=${0.02} onChange=${(v) => { c.craftSeconds = v; onChange(); }} width=${50} /> s</div>
    <div className="row"><span className="lbl">Used</span><${Num} float value=${c.demandPerSecond} min=${0} onChange=${(v) => { c.demandPerSecond = v; onChange(); }} width=${50} /> /s by the factory</div>
    <div className="row"><${Check} checked=${c.enableByCircuit} label="Enable/disable" onChange=${(v) => { c.enableByCircuit = v; onChange(); }} /></div>
    ${c.enableByCircuit && html`<div className="row"><${ConditionEditor} c=${c.condition} onChange=${onChange} /></div>`}
    <div className="row"><${Check} checked=${c.readContents} label="Read contents" onChange=${(v) => { c.readContents = v; onChange(); }} /></div>
  </div>`;
}

function AssemblerLive({ node }) {
  useStore();
  const s = node.state;
  const c = node.config;
  return html`<div className="asm-live">
    <div className="bar"><div className="fill" style=${{ width: `${Math.round((s.progress || 0) * 100)}%` }}></div></div>
    <span className=${`status ${s.working ? 'ok' : 'bad'}`}>${s.working ? 'working' : s.enabled === false ? 'disabled' : 'output full'}</span>
    <span>stock <${Chip} id=${c.recipe} value=${s.stock || 0} /></span>
  </div>`;
}

function ButtonBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Signal</span><${SignalPicker} value=${c.signal} onChange=${(v) => { c.signal = v; onChange(); }} /><${Num} value=${c.value} onChange=${(v) => { c.value = v; onChange(); }} width=${52} /></div>
    <div className="row"><${Select} value=${c.mode} options=${[['pulse', 'Pulse (1 tick)'], ['toggle', 'Toggle (on/off)']]} onChange=${(v) => { c.mode = v; onChange(); }} /></div>
  </div>`;
}

function ButtonLive({ node }) {
  useStore();
  const s = node.state;
  const c = node.config;
  const press = () => {
    if (c.mode === 'toggle') s.toggled = !s.toggled;
    else s.pending = (s.pending || 0) + 1;
    if (!app.running) app.stepOnce?.();
  };
  return html`<div className="button-live">
    <button className=${`push ${s.active || s.toggled ? 'active' : ''}`} onClick=${press}>${c.mode === 'toggle' ? (s.toggled ? 'ON' : 'OFF') : 'PRESS'}</button>
    <span className="muted">${c.mode === 'pulse' ? 'one tick per press' : ''}</span>
  </div>`;
}

function SolarBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Peak</span><${Num} value=${c.peakKW} min=${0} onChange=${(v) => { c.peakKW = v; onChange(); }} /> kW</div>
    <div className="row"><span className="lbl">Day length</span><${Num} value=${c.daySeconds} min=${2} onChange=${(v) => { c.daySeconds = v; onChange(); }} width=${50} /> s</div>
  </div>`;
}

function SolarLive({ node }) {
  useStore();
  const s = node.state;
  const light = s.light ?? 0;
  return html`<div className="solar-live">
    <span className="sky" style=${{ '--light': light }}>${light > 0.05 ? '☀' : '☾'}</span>
    <span>${Math.round((s.supplyKW || 0))} kW (${Math.round(light * 100)}% light)</span>
  </div>`;
}

function GeneratorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Output</span><${Num} value=${c.outputKW} min=${0} onChange=${(v) => { c.outputKW = v; onChange(); }} /> kW</div>
    <div className="row"><span className="lbl">Run when</span></div>
    <div className="row"><${ConditionEditor} c=${c.condition} onChange=${onChange} /></div>
  </div>`;
}

function GeneratorLive({ node }) {
  useStore();
  const s = node.state;
  return html`<div className="gen-live">
    <span className=${`status ${s.on ? 'ok' : 'idle'}`}>${s.on ? 'RUNNING' : 'stopped'}</span>
    <span>${s.supplyKW || 0} kW${s.connected === false ? ' (no wire: always runs)' : ''}</span>
  </div>`;
}

function AccumulatorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Capacity</span><${Num} value=${c.capacityKJ} min=${1} onChange=${(v) => { c.capacityKJ = v; onChange(); }} /> kJ</div>
    <div className="row"><span className="lbl">Max rate</span><${Num} value=${c.maxKW} min=${1} onChange=${(v) => { c.maxKW = v; onChange(); }} /> kW</div>
    <div className="row"><span className="lbl">Charge as</span><${SignalPicker} value=${c.signal} onChange=${(v) => { c.signal = v; onChange(); }} /></div>
  </div>`;
}

function AccumulatorLive({ node }) {
  useStore();
  const s = node.state;
  const pct = s.percent ?? 0;
  const g = app.sim.grid;
  return html`<div className="acc-live">
    <div className="bar tall"><div className="fill" style=${{ width: `${pct}%`, background: pct < 20 ? '#d84343' : pct < 60 ? '#e5b31a' : '#43a047' }}></div><span className="bar-text">${pct}%</span></div>
    <span className="muted">${g.accumulatorKW > 1 ? `discharging ${Math.round(g.accumulatorKW)} kW` : g.accumulatorKW < -1 ? `charging ${Math.round(-g.accumulatorKW)} kW` : 'idle'}</span>
  </div>`;
}

function LoadBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <div className="row"><span className="lbl">Draws</span><${Num} value=${c.demandKW} min=${0} onChange=${(v) => { c.demandKW = v; onChange(); }} /> kW</div>
    <div className="row"><${Check} checked=${c.enableByCircuit} label="Enable/disable" onChange=${(v) => { c.enableByCircuit = v; onChange(); }} /></div>
    ${c.enableByCircuit && html`<div className="row"><${ConditionEditor} c=${c.condition} onChange=${onChange} /></div>`}
  </div>`;
}

function LoadLive({ node }) {
  useStore();
  const s = node.state;
  const sat = s.satisfaction ?? 1;
  return html`<div className="load-live">
    <span className=${`status ${!s.on ? 'idle' : sat > 0.99 ? 'ok' : 'bad'}`}>${!s.on ? 'off' : sat > 0.99 ? 'powered' : `LOW POWER ${Math.round(sat * 100)}%`}</span>
  </div>`;
}

function GridLine() {
  useStore();
  const g = app.sim.grid;
  return html`<div className="io-line grid-line"><span className="io-label">Grid</span>
    <span>supply ${Math.round(g.supplyKW)} kW · demand ${Math.round(g.demandKW)} kW</span></div>`;
}

// ---------------------------------------------------------------- registry

const W = '<b>One connection point:</b> the left and right sockets are the same point, so you can daisy-chain wires through it. Whatever the building puts on the wire, it also reads back.';

export const META = {
  constant: {
    title: 'Constant combinator', short: 'Constant', cat: 'Combinators', icon: '▦', width: 270,
    Body: ConstantBody, Live: PointIO,
    help: `<p>Puts a fixed set of signals on every wire attached to it, every tick. Turn it off to remove them.</p>
      <p>${W}</p><p>Several constant combinators on the same network simply add up.</p>`,
  },
  arithmetic: {
    title: 'Arithmetic combinator', short: 'Arithmetic', cat: 'Combinators', icon: '±', width: 300,
    Body: ArithmeticBody, Live: CombinatorIO,
    help: `<p>Reads its <b>input</b> side, computes <i>left op right</i>, and writes the result on its <b>output</b> side <b>one tick later</b>.</p>
      <ul><li>Red and green input are summed unless you untick a colour (R/G buttons) for an operand.</li>
      <li><b>Each</b> runs the operation once per input signal. Output <i>Each</i> keeps them separate; output a single signal to get their sum.</li>
      <li>Numbers are 32-bit integers: they wrap around past ±2,147,483,647. Division rounds toward zero, divide by zero gives 0, <code>%</code> keeps the sign of the left side.</li>
      <li>Input and output are <b>separate networks</b>. Wire the output back to the input to build memory and counters.</li></ul>`,
  },
  decider: {
    title: 'Decider combinator', short: 'Decider', cat: 'Combinators', icon: '⋚', width: 400,
    Body: DeciderBody, Live: CombinatorIO,
    help: `<p>Tests conditions on its input. While they are true it writes the outputs, <b>one tick later</b>; otherwise it outputs nothing.</p>
      <ul><li>Rows joined with <b>AND</b> are grouped first, then groups are <b>OR</b>-ed: <i>a OR b AND c</i> means <i>a OR (b AND c)</i>.</li>
      <li>Output <b>Constant</b> writes a fixed number (1 by default). <b>Input count</b> copies that signal's value from the input.</li>
      <li><b>Everything</b>: true when every input signal passes (and also when there are no signals). <b>Anything</b>: true when at least one passes.</li>
      <li><b>Each</b>: every input signal is tested on its own. Output <i>Each</i> gives the signals that passed; output one signal to get their count (Constant 1) or their sum (Input count).</li>
      <li>Output <b>Everything</b> + Input count passes the whole input through while the condition holds.</li></ul>`,
  },
  selector: {
    title: 'Selector combinator', short: 'Selector', cat: 'Combinators', icon: '⇅', width: 280,
    Body: SelectorBody, Live: CombinatorIO,
    help: `<p>Picks or describes signals from its input, one tick later.</p>
      <ul><li><b>Select input</b>: sorts the input by value and outputs the one at <i>Index</i>. Index 0 is the largest (descending) or smallest (ascending). Ties are broken by signal order.</li>
      <li><b>Count inputs</b>: how many different signals are present.</li>
      <li><b>Random input</b>: picks one input signal every N ticks and passes it through.</li>
      <li><b>Stack size</b>: outputs each input item with its stack size.</li></ul>
      <p class="muted">Quality and rocket-capacity modes aren't simulated.</p>`,
  },
  lamp: {
    title: 'Lamp', short: 'Lamp', cat: 'Buildings', icon: '💡', width: 280,
    Body: LampBody, Live: LampLive, Extra: PointIO,
    help: `<p>Lights up while its condition is true. A lamp with <b>no wire</b> is always on.</p>
      <p><b>Use colours</b>: takes the colour of the first colour signal above 0 (red, green, blue, yellow, pink, cyan, white, grey, black).</p><p>${W}</p>`,
  },
  display: {
    title: 'Signal display', short: 'Display', cat: 'Buildings', icon: '▤', width: 260,
    Body: null, Live: DisplayLive,
    help: `<p>A probe that shows exactly what is on each wire at its connection point, plus the red + green sum that a combinator would read. It puts nothing on the wire.</p><p>${W}</p>`,
  },
  chest: {
    title: 'Storage chest', short: 'Chest', cat: 'Buildings', icon: '▣', width: 270,
    Body: ChestBody, Live: PointIO,
    help: `<p>Holds items. With <b>read contents</b> on it puts its whole inventory on the wire. Edit the numbers to pretend items arrived or were taken.</p><p>${W}</p>`,
  },
  assembler: {
    title: 'Assembling machine', short: 'Assembler', cat: 'Buildings', icon: '⚙', width: 300,
    Body: AssemblerBody, Live: AssemblerLive, Extra: PointIO,
    help: `<p>Crafts one item every <i>craft time</i> into its output stock, while the factory uses some each second. With <b>enable/disable</b> it only crafts while the condition is true. With <b>read contents</b> it puts its stock on the wire.</p>
      <p>Because it reads and writes the same point, it can watch its own stock: try "stop at 100".</p>`,
  },
  button: {
    title: 'Push button', short: 'Button', cat: 'Buildings', icon: '◉', width: 240,
    Body: ButtonBody, Live: ButtonLive, Extra: PointIO,
    help: `<p>A made-up input device. <b>Pulse</b> puts the signal on the wire for exactly one tick per press: the ideal way to test counters and memory cells. <b>Toggle</b> holds it until pressed again.</p>`,
  },
  solar: {
    title: 'Solar panel', short: 'Solar', cat: 'Power', icon: '☀', width: 240,
    Body: SolarBody, Live: SolarLive,
    help: `<p>Supplies the electric grid during the day, nothing at night. No circuit connection. All power buildings share one grid.</p>`,
  },
  generator: {
    title: 'Steam generator', short: 'Generator', cat: 'Power', icon: '♨', width: 290,
    Body: GeneratorBody, Live: GeneratorLive, Extra: PointIO,
    help: `<p>Backup power. Runs while its condition is true (with no wire it always runs). Pair it with an accumulator and an SR latch so it doesn't flicker on and off.</p>`,
  },
  accumulator: {
    title: 'Accumulator', short: 'Accumulator', cat: 'Power', icon: '▮', width: 260,
    Body: AccumulatorBody, Live: AccumulatorLive, Extra: PointIO,
    help: `<p>Stores surplus grid energy and releases it when demand exceeds supply. Puts its charge in percent (0–100) on the wire as a signal (A by default).</p>`,
  },
  load: {
    title: 'Factory load', short: 'Load', cat: 'Power', icon: '⚡', width: 270,
    Body: LoadBody, Live: LoadLive, Extra: GridLine,
    help: `<p>Stands in for the rest of your factory: draws a constant amount of power from the grid. Shows LOW POWER when supply plus accumulators can't keep up. Can optionally be switched by a condition.</p>`,
  },
};

export const PALETTE = ['Combinators', 'Buildings', 'Power'].map((cat) => [cat, Object.keys(META).filter((k) => META[k].cat === cat)]);

for (const k of Object.keys(META)) if (!KINDS[k]) throw new Error(`META for unknown kind ${k}`);
export { signalInfo };
