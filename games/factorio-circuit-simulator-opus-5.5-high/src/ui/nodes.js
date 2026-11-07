// Per-kind UI: titles, help text, settings editors and live read-outs, laid out like the
// game's entity windows (section headings over dark inset panels, slots, R/G checkboxes).
import { React, html } from '../../vendor/rete-bundle.js';
import { app, useStore } from '../state.js';
import { ARITH_OPS, KINDS, evalCondition } from '../sim.js';
import { EACH, EVERYTHING, ANYTHING, signalInfo } from '../signals.js';
import { Slot, SignalList, SignalPicker, Num, Check, Radio, Select, Nets, Operand, ConditionEditor, openPicker, fmt } from './components.js';
import { sortedEntries } from '../sim.js';

const BOTH = { red: true, green: true };
const PITCH = 38; // slot size + gap

// ---------------------------------------------------------------- layout helpers

function Section({ title, children, className = '' }) {
  return html`<div className=${`f-section ${className}`}>
    ${title && html`<div className="f-head">${title}</div>`}
    <div className="f-inset">${children}</div>
  </div>`;
}

function Field({ label, children, unit }) {
  return html`<div className="f-field"><span className="f-label">${label}</span>${children}${unit && html`<span className="f-unit">${unit}</span>`}</div>`;
}

/** Read-only grid of slots, padded with empty slots to whole rows like the game's signal grids. */
function SlotGrid({ map, cols }) {
  const entries = map ? sortedEntries(map) : [];
  const pad = Math.max(cols, Math.ceil(entries.length / cols) * cols) - entries.length;
  return html`<div className="f-slot-grid" style=${{ gridTemplateColumns: `repeat(${cols}, 36px)` }}>
    ${entries.map(([id, v]) => html`<${Slot} key=${id} id=${id} value=${v} />`)}
    ${Array.from({ length: pad }, (_, i) => html`<span key=${`e${i}`} className="f-slot empty"></span>`)}
  </div>`;
}

const colsFor = (width, halves = 1) => Math.max(2, Math.floor(((width - 30) / halves - 12 + 2) / PITCH));

// ---------------------------------------------------------------- live read-outs

/** Combinators: input and output signal grids side by side. */
function CombinatorIO({ node }) {
  useStore();
  const cols = colsFor(node.width, 2);
  return html`<div className="f-io">
    <${Section} title="Input signals"><${SlotGrid} map=${app.sim.input(node.id, 'in')} cols=${cols} /></${Section}>
    <${Section} title="Output signals"><${SlotGrid} map=${node.out} cols=${cols} /></${Section}>
  </div>`;
}

/** Buildings: what they read from the wire (red + green) and what they put on it. */
function PointIO({ node, showOut = true }) {
  useStore();
  const cols = colsFor(node.width, showOut ? 2 : 1);
  return html`<div className="f-io">
    <${Section} title="Reads"><${SlotGrid} map=${app.sim.input(node.id, 'main')} cols=${cols} /></${Section}>
    ${showOut && html`<${Section} title="Puts on wire"><${SlotGrid} map=${node.out} cols=${cols} /></${Section}>`}
  </div>`;
}

// ---------------------------------------------------------------- slot grid editor (constant combinator, chest)

function SlotGridEditor({ rows, onChange, itemsOnly = false, width }) {
  const cols = colsFor(width);
  const fallback = itemsOnly ? 50 : 1;
  const edit = (el, row) => {
    let pending = row?.value ?? fallback;
    openPicker(el, {
      value: row?.id ?? null,
      itemsOnly,
      title: itemsOnly ? 'Select an item' : 'Select a signal',
      keepOpen: true,
      liveNumber: true,
      number: pending,
      numberLabel: itemsOnly ? 'Amount' : 'Value',
      focusNumber: !!row,
      onPick: (id) => {
        if (!row) { row = { id, value: pending }; rows.push(row); } else row.id = id;
        onChange();
      },
      onNumber: (n) => { pending = n; if (row) { row.value = n; onChange(); } },
      onClear: row ? () => { rows.splice(rows.indexOf(row), 1); onChange(); } : undefined,
      clearLabel: 'Remove',
    });
  };
  const pad = Math.max(1, Math.ceil((rows.length + 1) / cols) * cols - rows.length);
  return html`<div className="f-slot-grid" style=${{ gridTemplateColumns: `repeat(${cols}, 36px)` }}>
    ${rows.map((r, i) => html`<${Slot} key=${i} id=${r.id} value=${r.value} title=${`${signalInfo(r.id).name}: ${r.value} (click to edit, right-click to remove)`}
      onClick=${(el) => edit(el, r)} onClear=${() => { rows.splice(i, 1); onChange(); }} />`)}
    ${Array.from({ length: pad }, (_, i) => html`<button key=${`e${i}`} className="f-slot empty button" title=${itemsOnly ? 'Add an item' : 'Add a signal'} onClick=${(e) => edit(e.currentTarget, null)}></button>`)}
  </div>`;
}

// ---------------------------------------------------------------- combinators

function ConstantBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Output">
      <div className="f-switch-row">
        <span className=${c.enabled ? 'muted' : ''}>Off</span>
        <button className=${`f-switch ${c.enabled ? 'on' : ''}`} title="Switch the combinator on/off" onClick=${() => { c.enabled = !c.enabled; onChange(); }}><span></span></button>
        <span className=${c.enabled ? '' : 'muted'}>On</span>
      </div>
    </${Section}>
    <${Section} title="Signals"><${SlotGridEditor} rows=${c.signals} onChange=${onChange} width=${node.width} /></${Section}>
  </div>`;
}

const OP_OPTIONS = Object.keys(ARITH_OPS).map((k) => [k, k]);

function ArithmeticBody({ node, onChange }) {
  const c = node.config;
  c.leftNets ??= { ...BOTH };
  c.rightNets ??= { ...BOTH };
  const usesEach = (c.left.kind === 'signal' && c.left.id === EACH) || (c.right.kind === 'signal' && c.right.id === EACH);
  return html`<div>
    <${Section} title="Input">
      <div className="f-cond">
        <${Nets} nets=${c.leftNets} disabled=${c.left.kind !== 'signal'} onChange=${(n) => { c.leftNets = n; onChange(); }} />
        <${Operand} op=${c.left} wildcards=${[EACH]} onChange=${onChange} title="Left operand" />
        <${Select} className="f-cmp" value=${c.op} options=${OP_OPTIONS} onChange=${(v) => { c.op = v; onChange(); }} title="Operation" />
        <${Nets} nets=${c.rightNets} disabled=${c.right.kind !== 'signal'} onChange=${(n) => { c.rightNets = n; onChange(); }} />
        <${Operand} op=${c.right} wildcards=${[EACH]} onChange=${onChange} title="Right operand" />
      </div>
    </${Section}>
    <${Section} title="Output">
      <div className="f-out-row">
        <${SignalPicker} value=${c.output} allowNone wildcards=${usesEach ? [EACH] : []} onChange=${(v) => { c.output = v; onChange(); }} />
        ${c.output === EACH && !usesEach ? html`<span className="warn">Output Each needs Each as an input.</span>`
          : html`<span className="muted small">${usesEach ? (c.output === EACH ? 'one result per input signal' : 'sum of all results') : ''}</span>`}
      </div>
    </${Section}>
  </div>`;
}

function OutputRow({ o, usesEach, onChange, onRemove }) {
  const [editing, setEditing] = React.useState(false);
  o.nets ??= { ...BOTH };
  return html`<div className="f-out-row removable">
    <${SignalPicker} value=${o.signal} allowNone wildcards=${usesEach ? [EVERYTHING, EACH] : [EVERYTHING]} onChange=${(v) => { o.signal = v; onChange(); }} />
    <div className="f-out-modes">
      <div className="f-line">
        <${Radio} checked=${o.mode !== 'input'} onChange=${() => { o.mode = 'one'; onChange(); }} title="Output a fixed value">
          ${!editing && html`<span className="f-out-val">${o.value ?? 1}</span>`}
        </${Radio}>
        ${editing && html`<${Num} value=${o.value ?? 1} width=${60} onChange=${(v) => { o.value = v; onChange(); }} />`}
        <button className=${`f-pencil ${editing ? 'on' : ''}`} title="Edit the value" onClick=${() => setEditing(!editing)}>✎</button>
      </div>
      <div className="f-line">
        <${Radio} checked=${o.mode === 'input'} onChange=${() => { o.mode = 'input'; onChange(); }} title="Copy the value from the input">Input count</${Radio}>
        <${Nets} nets=${o.nets} disabled=${o.mode !== 'input'} onChange=${(n) => { o.nets = n; onChange(); }} title="Which input wires to copy from" />
      </div>
    </div>
    <span className="f-grip"></span>
    <button className="f-x" title="Remove output" onClick=${onRemove}>✕</button>
  </div>`;
}

function DeciderBody({ node, onChange }) {
  useStore();
  const c = node.config;
  const usesEach = c.conditions.some((x) => x.first === EACH);
  const inp = (nets) => app.sim.input(node.id, 'in', nets);
  const truth = (cd) => {
    if (!cd.first) return false;
    if (cd.first === EACH) {
      for (const s of inp(cd.firstNets || BOTH).keys()) if (evalCondition(cd, inp, s)) return true;
      return false;
    }
    return evalCondition(cd, inp);
  };
  // AND binds first: a new group starts at every OR.
  const groups = [];
  c.conditions.forEach((cd, i) => { if (i === 0 || cd.join === 'or') groups.push([]); groups[groups.length - 1].push(i); });
  const remove = (i) => { c.conditions.splice(i, 1); onChange(); };
  return html`<div>
    <${Section} title="Conditions">
      <div className="f-conds">
        ${groups.map((g, gi) => html`<div className=${`f-group ${g.length > 1 ? 'bracket' : ''}`} key=${gi}>
          ${gi > 0 && html`<button className="f-btn f-join or" title="OR: click to change to AND" onClick=${() => { c.conditions[g[0]].join = 'and'; onChange(); }}>OR</button>`}
          ${g.map((i, k) => html`<div className="f-cond-wrap" key=${i}>
            ${k > 0 && html`<button className="f-btn f-join and" title="AND: click to change to OR" onClick=${() => { c.conditions[i].join = 'or'; onChange(); }}>AND</button>`}
            <${ConditionEditor} c=${c.conditions[i]} nets onChange=${onChange} wildcards=${[EVERYTHING, ANYTHING, EACH]}
              truth=${truth(c.conditions[i])} onRemove=${c.conditions.length > 1 ? () => remove(i) : null} />
          </div>`)}
        </div>`)}
      </div>
      <button className="f-btn f-add" onClick=${() => {
        c.conditions.push({ first: null, cmp: '<', second: { kind: 'const', value: 0 }, firstNets: { ...BOTH }, secondNets: { ...BOTH }, join: 'and' });
        onChange();
      }}>+ Add condition</button>
    </${Section}>
    <${Section} title="Outputs">
      ${c.outputs.map((o, i) => html`<${OutputRow} key=${i} o=${o} usesEach=${usesEach} onChange=${onChange} onRemove=${() => { c.outputs.splice(i, 1); onChange(); }} />`)}
      <button className="f-btn f-add" onClick=${() => { c.outputs.push({ signal: null, mode: 'one', value: 1, nets: { ...BOTH } }); onChange(); }}>+ Add output</button>
      ${c.outputs.some((o) => o.signal === EACH) && !usesEach && html`<div className="warn">Output Each needs an Each condition.</div>`}
    </${Section}>
  </div>`;
}

const SELECTOR_MODES = [['select', 'Select input'], ['count', 'Count inputs'], ['random', 'Random input'], ['stack', 'Stack size']];

function SelectorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Mode">
      <${Field} label="Operation"><${Select} value=${c.mode} options=${SELECTOR_MODES} onChange=${(v) => { c.mode = v; onChange(); }} /></${Field}>
    </${Section}>
    <${Section} title="Settings">
      ${c.mode === 'select' && html`
        <${Field} label="Sort"><${Select} value=${c.descending ? 'd' : 'a'} options=${[['d', 'Descending'], ['a', 'Ascending']]} onChange=${(v) => { c.descending = v === 'd'; onChange(); }} /></${Field}>
        <${Field} label="Index"><${Operand} op=${c.index} onChange=${onChange} title="Which position to output (0 = first)" /></${Field}>`}
      ${c.mode === 'count' && html`<${Field} label="Output"><${SignalPicker} value=${c.countSignal} onChange=${(v) => { c.countSignal = v; onChange(); }} /></${Field}>`}
      ${c.mode === 'random' && html`<${Field} label="Update every" unit="ticks"><${Num} value=${c.interval} min=${1} onChange=${(v) => { c.interval = v; onChange(); }} /></${Field}>`}
      ${c.mode === 'stack' && html`<div className="muted small">Outputs each input item with its stack size.</div>`}
    </${Section}>
  </div>`;
}

// ---------------------------------------------------------------- buildings

function LampBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Circuit connection">
      <div className="f-label sub">Enabled condition</div>
      <${ConditionEditor} c=${c.condition} onChange=${onChange} />
      <${Check} checked=${c.useColors} label="Use colors" onChange=${(v) => { c.useColors = v; onChange(); }} />
    </${Section}>
  </div>`;
}

function LampLive({ node }) {
  useStore();
  const s = node.state;
  const color = s.color || '#ffe9a8';
  return html`<div className="f-preview">
    <div className=${`lamp ${s.on ? 'on' : ''}`} style=${{ '--lamp': color }}></div>
    ${s.connected === false && html`<span className="muted small">No wire: always on</span>`}
  </div>`;
}

function DisplayLive({ node }) {
  useStore();
  const sim = app.sim;
  const red = sim.network(node.id, 'main', 'red');
  const green = sim.network(node.id, 'main', 'green');
  const total = sim.input(node.id, 'main');
  const block = (net, color) => html`<div className=${`disp-block ${color}`}>
    <div className="disp-head">${net ? html`<span className=${`net-text ${color}`}>${net.id}</span> ${color} network` : html`<span className="muted">no ${color} wire</span>`}</div>
    ${net && html`<${SignalList} map=${net.signals} empty="(nothing)" />`}
  </div>`;
  return html`<${Section} title="Signals at this point">
    <div className="display">
      ${block(red, 'red')}
      ${block(green, 'green')}
      <div className="disp-block sum"><div className="disp-head">Red + green (what a combinator reads)</div><${SignalList} map=${total} empty="(nothing)" /></div>
    </div>
  </${Section}>`;
}

function ChestBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Inventory"><${SlotGridEditor} rows=${c.items} itemsOnly onChange=${onChange} width=${node.width} /></${Section}>
    <${Section} title="Circuit connection"><${Check} checked=${c.readContents} label="Read contents" onChange=${(v) => { c.readContents = v; onChange(); }} /></${Section}>
  </div>`;
}

function AssemblerBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Recipe">
      <${Field} label="Makes"><${SignalPicker} value=${c.recipe} itemsOnly onChange=${(v) => { c.recipe = v; onChange(); }} /></${Field}>
      <${Field} label="Craft time" unit="s"><${Num} float value=${c.craftSeconds} min=${0.02} onChange=${(v) => { c.craftSeconds = v; onChange(); }} width=${56} /></${Field}>
      <${Field} label="Factory uses" unit="/s"><${Num} float value=${c.demandPerSecond} min=${0} onChange=${(v) => { c.demandPerSecond = v; onChange(); }} width=${56} /></${Field}>
    </${Section}>
    <${Section} title="Circuit connection">
      <${Check} checked=${c.enableByCircuit} label="Enable/disable" onChange=${(v) => { c.enableByCircuit = v; onChange(); }} />
      ${c.enableByCircuit && html`<${ConditionEditor} c=${c.condition} onChange=${onChange} />`}
      <${Check} checked=${c.readContents} label="Read contents" onChange=${(v) => { c.readContents = v; onChange(); }} />
    </${Section}>
  </div>`;
}

function AssemblerLive({ node }) {
  useStore();
  const s = node.state;
  const c = node.config;
  return html`<div className="f-preview">
    <${Slot} id=${c.recipe} value=${s.stock || 0} title="Output stock" />
    <div className="f-bar"><div className="fill" style=${{ width: `${Math.round((s.progress || 0) * 100)}%` }}></div></div>
  </div>`;
}

function ButtonBody({ node, onChange }) {
  const c = node.config;
  return html`<${Section} title="Settings">
    <${Field} label="Signal"><${SignalPicker} value=${c.signal} onChange=${(v) => { c.signal = v; onChange(); }} /><${Num} value=${c.value} onChange=${(v) => { c.value = v; onChange(); }} width=${56} /></${Field}>
    <${Field} label="Mode"><${Select} value=${c.mode} options=${[['pulse', 'Pulse (1 tick)'], ['toggle', 'Toggle (on/off)']]} onChange=${(v) => { c.mode = v; onChange(); }} /></${Field}>
  </${Section}>`;
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
  return html`<div className="f-preview">
    <button className=${`push ${s.active || s.toggled ? 'active' : ''}`} onClick=${press}>${c.mode === 'toggle' ? (s.toggled ? 'ON' : 'OFF') : 'PRESS'}</button>
    <span className="muted small">${c.mode === 'pulse' ? 'one tick per press' : ''}</span>
  </div>`;
}

function SolarBody({ node, onChange }) {
  const c = node.config;
  return html`<${Section} title="Settings">
    <${Field} label="Peak output" unit="kW"><${Num} value=${c.peakKW} min=${0} onChange=${(v) => { c.peakKW = v; onChange(); }} /></${Field}>
    <${Field} label="Day length" unit="s"><${Num} value=${c.daySeconds} min=${2} onChange=${(v) => { c.daySeconds = v; onChange(); }} width=${56} /></${Field}>
  </${Section}>`;
}

function SolarLive({ node }) {
  useStore();
  const light = node.state.light ?? 0;
  return html`<div className="f-preview">
    <span className="sky" style=${{ '--light': light }}>${light > 0.05 ? '☀' : '☾'}</span>
    <span>${Math.round(node.state.supplyKW || 0)} kW · ${Math.round(light * 100)}% light</span>
  </div>`;
}

function GeneratorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Settings"><${Field} label="Output" unit="kW"><${Num} value=${c.outputKW} min=${0} onChange=${(v) => { c.outputKW = v; onChange(); }} /></${Field}></${Section}>
    <${Section} title="Circuit connection">
      <div className="f-label sub">Enabled condition</div>
      <${ConditionEditor} c=${c.condition} onChange=${onChange} />
    </${Section}>
  </div>`;
}

function AccumulatorBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Settings">
      <${Field} label="Capacity" unit="kJ"><${Num} value=${c.capacityKJ} min=${1} onChange=${(v) => { c.capacityKJ = v; onChange(); }} /></${Field}>
      <${Field} label="Max rate" unit="kW"><${Num} value=${c.maxKW} min=${1} onChange=${(v) => { c.maxKW = v; onChange(); }} /></${Field}>
    </${Section}>
    <${Section} title="Circuit connection">
      <${Field} label="Read charge as"><${SignalPicker} value=${c.signal} onChange=${(v) => { c.signal = v; onChange(); }} /></${Field}>
    </${Section}>
  </div>`;
}

function AccumulatorLive({ node }) {
  useStore();
  const pct = node.state.percent ?? 0;
  return html`<div className="f-preview">
    <div className="f-bar tall"><div className="fill" style=${{ width: `${pct}%`, background: pct < 20 ? '#e04a3a' : pct < 60 ? '#f2b33d' : '#5eb663' }}></div><span className="bar-text">${pct}%</span></div>
  </div>`;
}

function LoadBody({ node, onChange }) {
  const c = node.config;
  return html`<div>
    <${Section} title="Settings"><${Field} label="Draws" unit="kW"><${Num} value=${c.demandKW} min=${0} onChange=${(v) => { c.demandKW = v; onChange(); }} /></${Field}></${Section}>
    <${Section} title="Circuit connection">
      <${Check} checked=${c.enableByCircuit} label="Enable/disable" onChange=${(v) => { c.enableByCircuit = v; onChange(); }} />
      ${c.enableByCircuit && html`<${ConditionEditor} c=${c.condition} onChange=${onChange} />`}
    </${Section}>
  </div>`;
}

function GridLine() {
  useStore();
  const g = app.sim.grid;
  return html`<div className="f-preview muted small">Grid: supply ${Math.round(g.supplyKW)} kW · demand ${Math.round(g.demandKW)} kW</div>`;
}

// ---------------------------------------------------------------- status lines ("● Working")

const DISABLED = ['bad', 'Disabled by control behavior'];
const STATUS = {
  combinator: () => ['ok', 'Working'],
  lamp: (s) => (s.on ? ['ok', 'Working'] : DISABLED),
  assembler: (s) => (s.working ? ['ok', 'Working'] : s.enabled === false ? DISABLED : ['warn', 'Output full']),
  button: (s) => (s.active || s.toggled ? ['ok', 'Sending signal'] : ['idle', 'Waiting for press']),
  solar: (s) => ((s.light ?? 0) > 0.05 ? ['ok', 'Working'] : ['warn', 'Not enough sunlight']),
  generator: (s) => (s.on !== false ? ['ok', `Working · ${s.supplyKW || 0} kW${s.connected === false ? ' (no wire: always runs)' : ''}`] : DISABLED),
  accumulator: () => {
    const kw = app.sim.grid.accumulatorKW;
    return kw > 1 ? ['warn', `Discharging ${Math.round(kw)} kW`] : kw < -1 ? ['ok', `Charging ${Math.round(-kw)} kW`] : ['idle', 'Idle'];
  },
  load: (s) => {
    const sat = s.satisfaction ?? 1;
    return s.on === false ? DISABLED : sat > 0.99 ? ['ok', 'Working'] : ['bad', `Low power ${Math.round(sat * 100)}%`];
  },
};

// ---------------------------------------------------------------- registry

const W = '<b>One connection point:</b> the left and right sockets are the same point, so you can daisy-chain wires through it. Whatever the building puts on the wire, it also reads back.';
const SLOTS = '<p class="muted">Click a slot to pick a signal; right-click a slot to clear it.</p>';

export const META = {
  constant: {
    title: 'Constant combinator', short: 'Constant', cat: 'Combinators', width: 290,
    Body: ConstantBody, Live: null, status: STATUS.combinator,
    help: `<p>Puts a fixed set of signals on every wire attached to it, every tick. Switch it off to remove them.</p>
      <p>Click an empty slot to add a signal, click a filled slot to change its signal or value, right-click to remove it.</p>
      <p>${W}</p><p>Several constant combinators on the same network simply add up.</p>`,
  },
  arithmetic: {
    title: 'Arithmetic combinator', short: 'Arithmetic', cat: 'Combinators', width: 330,
    Body: ArithmeticBody, Live: CombinatorIO, status: STATUS.combinator,
    help: `<p>Reads its <b>input</b> side, computes <i>left op right</i>, and writes the result on its <b>output</b> side <b>one tick later</b>.</p>
      <ul><li>Red and green input are summed unless you untick R or G for an operand.</li>
      <li>Click an operand to pick a signal or type a constant.</li>
      <li><b>Each</b> runs the operation once per input signal. Output <i>Each</i> keeps them separate; output a single signal to get their sum.</li>
      <li>Numbers are 32-bit integers: they wrap around past ±2,147,483,647. Division rounds toward zero, divide by zero gives 0, <code>%</code> keeps the sign of the left side.</li>
      <li>Input and output are <b>separate networks</b>. Wire the output back to the input to build memory and counters.</li></ul>${SLOTS}`,
  },
  decider: {
    title: 'Decider combinator', short: 'Decider', cat: 'Combinators', width: 420,
    Body: DeciderBody, Live: CombinatorIO, status: STATUS.combinator,
    help: `<p>Tests conditions on its input. While they are true it writes the outputs, <b>one tick later</b>; otherwise it outputs nothing. A condition row turns <b style="color:#5eb663">green</b> while it is true.</p>
      <ul><li>Rows joined with <b>AND</b> (bracketed) are grouped first, then groups are <b>OR</b>-ed: <i>a OR b AND c</i> means <i>a OR (b AND c)</i>. Click AND/OR to switch.</li>
      <li>Output <b>1</b> (✎ to change) writes a fixed number. <b>Input count</b> copies that signal's value from the input.</li>
      <li><b>Everything</b>: true when every input signal passes (and also when there are no signals). <b>Anything</b>: true when at least one passes.</li>
      <li><b>Each</b>: every input signal is tested on its own. Output <i>Each</i> gives the signals that passed; output one signal to get their count (value 1) or their sum (Input count).</li>
      <li>Output <b>Everything</b> + Input count passes the whole input through while the condition holds.</li></ul>${SLOTS}`,
  },
  selector: {
    title: 'Selector combinator', short: 'Selector', cat: 'Combinators', width: 300,
    Body: SelectorBody, Live: CombinatorIO, status: STATUS.combinator,
    help: `<p>Picks or describes signals from its input, one tick later.</p>
      <ul><li><b>Select input</b>: sorts the input by value and outputs the one at <i>Index</i>. Index 0 is the largest (descending) or smallest (ascending). Ties are broken by signal order.</li>
      <li><b>Count inputs</b>: how many different signals are present.</li>
      <li><b>Random input</b>: picks one input signal every N ticks and passes it through.</li>
      <li><b>Stack size</b>: outputs each input item with its stack size.</li></ul>
      <p class="muted">Quality and rocket-capacity modes aren't simulated.</p>`,
  },
  lamp: {
    title: 'Lamp', short: 'Lamp', cat: 'Buildings', width: 290,
    Body: LampBody, Live: LampLive, Extra: PointIO, status: STATUS.lamp,
    help: `<p>Lights up while its condition is true. A lamp with <b>no wire</b> is always on.</p>
      <p><b>Use colors</b>: takes the colour of the first colour signal above 0 (red, green, blue, yellow, pink, cyan, white, grey, black).</p><p>${W}</p>`,
  },
  display: {
    title: 'Signal display', short: 'Display', cat: 'Buildings', width: 280,
    Body: null, Live: DisplayLive,
    help: `<p>A probe that shows exactly what is on each wire at its connection point, plus the red + green sum that a combinator would read. It puts nothing on the wire.</p><p>${W}</p>`,
  },
  chest: {
    title: 'Storage chest', short: 'Chest', cat: 'Buildings', width: 290,
    Body: ChestBody, Live: null, status: null,
    help: `<p>Holds items. With <b>read contents</b> on it puts its whole inventory on the wire. Click a slot to change an item or its amount (pretend items arrived or were taken); right-click to remove it.</p><p>${W}</p>`,
  },
  assembler: {
    title: 'Assembling machine', short: 'Assembler', cat: 'Buildings', width: 300,
    Body: AssemblerBody, Live: AssemblerLive, Extra: PointIO, status: STATUS.assembler,
    help: `<p>Crafts one item every <i>craft time</i> into its output stock, while the factory uses some each second. With <b>enable/disable</b> it only crafts while the condition is true. With <b>read contents</b> it puts its stock on the wire.</p>
      <p>Because it reads and writes the same point, it can watch its own stock: try "stop at 100".</p>`,
  },
  button: {
    title: 'Push button', short: 'Button', cat: 'Buildings', width: 270,
    Body: ButtonBody, Live: ButtonLive, Extra: PointIO, status: STATUS.button,
    help: `<p>A made-up input device. <b>Pulse</b> puts the signal on the wire for exactly one tick per press: the ideal way to test counters and memory cells. <b>Toggle</b> holds it until pressed again.</p>`,
  },
  solar: {
    title: 'Solar panel', short: 'Solar', cat: 'Power', width: 260,
    Body: SolarBody, Live: SolarLive, status: STATUS.solar,
    help: `<p>Supplies the electric grid during the day, nothing at night. No circuit connection. All power buildings share one grid.</p>`,
  },
  generator: {
    title: 'Steam generator', short: 'Generator', cat: 'Power', width: 290,
    Body: GeneratorBody, Live: null, Extra: PointIO, status: STATUS.generator,
    help: `<p>Backup power. Runs while its condition is true (with no wire it always runs). Pair it with an accumulator and an SR latch so it doesn't flicker on and off.</p>`,
  },
  accumulator: {
    title: 'Accumulator', short: 'Accumulator', cat: 'Power', width: 280,
    Body: AccumulatorBody, Live: AccumulatorLive, Extra: PointIO, status: STATUS.accumulator,
    help: `<p>Stores surplus grid energy and releases it when demand exceeds supply. Puts its charge in percent (0–100) on the wire as a signal (A by default).</p>`,
  },
  load: {
    title: 'Factory load', short: 'Load', cat: 'Power', width: 290,
    Body: LoadBody, Live: null, Extra: GridLine, status: STATUS.load,
    help: `<p>Stands in for the rest of your factory: draws a constant amount of power from the grid. Shows <i>Low power</i> when supply plus accumulators can't keep up. Can optionally be switched by a condition.</p>`,
  },
};

export const PALETTE = ['Combinators', 'Buildings', 'Power'].map((cat) => [cat, Object.keys(META).filter((k) => META[k].cat === cat)]);

for (const k of Object.keys(META)) if (!KINDS[k]) throw new Error(`META for unknown kind ${k}`);
export { signalInfo, fmt };
