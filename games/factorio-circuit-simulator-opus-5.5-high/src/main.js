// App shell: toolbar, palette, side panel, simulation loop, autosave.
import { React, html, createRoot } from '../vendor/rete-bundle.js';
import { app, store, useStore, onUserChange } from './state.js';
import { TICKS_PER_SECOND } from './sim.js';
import { createEditor, addNode, load, serialize, zoomToFit, resetSimulation, removeNode, selectedNode, flash } from './editor.js';
import { META, PALETTE } from './ui/nodes.js';
import { SignalList, Chip } from './ui/components.js';
import { EXAMPLES, WELCOME } from './examples.js';

const SAVE_KEY = 'circuit-sim-autosave-v1';
const SPEEDS = [[0.1, '0.1×'], [0.25, '¼×'], [1, '1×'], [4, '4×'], [16, '16×']];

// ---------------------------------------------------------------- simulation loop

let last = performance.now();
let carry = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (app.running) {
    carry += dt * TICKS_PER_SECOND * app.speed;
    let n = Math.floor(carry);
    carry -= n;
    n = Math.min(n, 1000);
    for (let i = 0; i < n; i++) app.sim.step();
    if (n > 0) store.bump();
  }
  requestAnimationFrame(frame);
}

app.stepOnce = () => {
  app.sim.step();
  store.bump();
};

// ---------------------------------------------------------------- autosave

let saveTimer = null;
onUserChange(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...serialize(), lesson: app.lesson?.key || null })); } catch { /* storage unavailable */ }
  }, 400);
});

// ---------------------------------------------------------------- toolbar

async function loadExample(key) {
  const ex = EXAMPLES.find((e) => e.key === key);
  if (!ex) return;
  app.lesson = ex;
  app.sideTab = 'lesson';
  await load(ex.data);
  app.running = true;
  store.bump();
  onSaveNow();
}

function onSaveNow() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...serialize(), lesson: app.lesson?.key || null })); } catch { /* ignore */ }
}

function exportFile() {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'circuit.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== 'circuit-sim') throw new Error('not a circuit file');
      app.lesson = null;
      await load(data);
      onSaveNow();
      flash(`Loaded ${f.name}`);
    } catch (e) {
      flash(`Couldn't load: ${e.message}`);
    }
  };
  input.click();
}

function Toolbar() {
  useStore();
  const toggle = () => { app.running = !app.running; store.bump(); };
  return html`<div className="toolbar">
    <div className="brand"><span className="logo">⧉</span> Circuit Network Simulator <span className="muted small">a Factorio learning aid</span></div>
    <div className="tb-group">
      <button className=${`tb-btn primary ${app.running ? '' : 'paused'}`} onClick=${toggle} title="Space">${app.running ? '❚❚ Pause' : '▶ Run'}</button>
      <button className="tb-btn" disabled=${app.running} onClick=${() => app.stepOnce()} title="Advance one tick (.)">Step +1 tick</button>
      <select className="tb-select" value=${app.speed} onChange=${(e) => { app.speed = +e.target.value; store.bump(); }} title="Speed">
        ${SPEEDS.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
      </select>
      <span className="tick" title="Ticks since reset (60 per second)">tick <b>${app.sim.tick}</b> · ${(app.sim.tick / 60).toFixed(1)} s</span>
      <button className="tb-btn" onClick=${() => { resetSimulation(); store.bump(); }} title="Clear all outputs, memory and building state">Reset</button>
    </div>
    <div className="tb-group">
      <select className="tb-select examples" value="" onChange=${(e) => loadExample(e.target.value)}>
        <option value="">Examples…</option>
        ${EXAMPLES.map((ex) => html`<option key=${ex.key} value=${ex.key}>${ex.title}</option>`)}
      </select>
      <button className="tb-btn" onClick=${zoomToFit} title="Zoom to fit">Fit</button>
      <button className="tb-btn" onClick=${async () => { if (confirm('Remove everything from the board?')) { app.lesson = null; await load({ nodes: [], wires: [] }); onSaveNow(); } }}>Clear</button>
      <button className="tb-btn" onClick=${exportFile}>Export</button>
      <button className="tb-btn" onClick=${importFile}>Import</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- palette

function Palette() {
  return html`<div className="palette">
    ${PALETTE.map(([cat, kinds]) => html`<div className="pal-group" key=${cat}>
      <div className="pal-head">${cat}</div>
      ${kinds.map((k) => html`<button className=${`pal-btn kind-${k}`} key=${k} onClick=${async () => { await addNode(k); flash(`Added ${META[k].title}`); }} title=${`Add ${META[k].title}`}>
        <span className="pal-icon">${META[k].icon}</span>${META[k].title}
      </button>`)}
    </div>`)}
    <div className="pal-foot">
      <div><b>Wire:</b> drag ● right → ● left</div>
      <div><b>Cut:</b> click a wire</div>
      <div><b>Delete:</b> select + Del</div>
      <div><b>Run/Pause:</b> Space · <b>Step:</b> .</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- side panel

function NetBlock({ net }) {
  const names = net.members.map((m) => {
    const node = app.editor.getNode(m.id);
    if (!node) return '?';
    const pts = node.kind === 'arithmetic' || node.kind === 'decider' || node.kind === 'selector';
    return pts ? `${node.label} (${m.point === 'in' ? 'input' : 'output'})` : node.label;
  });
  return html`<div className=${`net-block ${net.color} ${app.hoverNet === net.id ? 'hot' : ''}`}
      onPointerEnter=${() => { app.hoverNet = net.id; store.bump(); }} onPointerLeave=${() => { app.hoverNet = null; store.bump(); }}>
    <div className="net-head"><span className=${`net-tag ${net.color}`}>${net.id}</span> ${net.color === "red" ? "Red" : "Green"} network · ${net.members.length} points</div>
    <div className="net-members">${names.join(' · ')}</div>
    <${SignalList} map=${net.signals} empty="(no signals)" />
  </div>`;
}

function Inspect() {
  useStore();
  const node = selectedNode();
  if (!node) return html`<div className="side-empty">Select a box on the board to see how it works and exactly what it reads and writes.</div>`;
  const meta = META[node.kind];
  const sim = app.sim;
  const points = (node.kind === 'arithmetic' || node.kind === 'decider' || node.kind === 'selector') ? [['in', 'Input point'], ['out', 'Output point']] : [['main', 'Connection point']];
  const hasPoints = node.kind !== 'solar';
  return html`<div className="inspect">
    <h3><span className="cnode-icon">${meta.icon}</span> ${node.label} <span className="muted small">${meta.title}</span></h3>
    <div className="help" dangerouslySetInnerHTML=${{ __html: meta.help }}></div>
    ${hasPoints && html`<h4>Live</h4>
      ${points.map(([p, label]) => {
        const r = sim.network(node.id, p, 'red');
        const g = sim.network(node.id, p, 'green');
        return html`<div className="insp-point" key=${p}>
          <div className="insp-label">${label}</div>
          <div className="insp-row"><span className="net-tag red">${r ? r.id : '–'}</span>${r ? html`<${SignalList} map=${r.signals} empty="(empty)" />` : html`<span className="muted">no red wire</span>`}</div>
          <div className="insp-row"><span className="net-tag green">${g ? g.id : '–'}</span>${g ? html`<${SignalList} map=${g.signals} empty="(empty)" />` : html`<span className="muted">no green wire</span>`}</div>
          ${p !== 'out' && html`<div className="insp-row"><span className="net-tag sum">Σ</span><${SignalList} map=${sim.input(node.id, p)} empty="(nothing)" /></div>`}
        </div>`;
      })}
      <div className="insp-point"><div className="insp-label">This box puts on the wire</div><${SignalList} map=${node.out} /></div>`}
    <button className="tb-btn danger" onClick=${() => removeNode(node.id)}>Delete ${node.label}</button>
  </div>`;
}

function Networks() {
  useStore();
  const nets = app.sim.networks;
  if (!nets.length) return html`<div className="side-empty">No wires yet. Every set of connected wires of one colour forms a network.</div>`;
  return html`<div className="nets-list">${nets.map((n) => html`<${NetBlock} key=${n.id} net=${n} />`)}</div>`;
}

function Lesson() {
  const ex = app.lesson || WELCOME;
  return html`<div className="lesson">
    <h3>${ex.title}</h3>
    <div className="help" dangerouslySetInnerHTML=${{ __html: ex.html }}></div>
    ${app.lesson && html`<button className="tb-btn" onClick=${() => loadExample(app.lesson.key)}>Restart this example</button>`}
    ${app.lesson && html`<button className="tb-btn" onClick=${() => { app.lesson = null; store.bump(); }}>Show intro</button>`}
  </div>`;
}

function Side() {
  useStore();
  const tab = app.sideTab || 'lesson';
  const set = (t) => { app.sideTab = t; store.bump(); };
  const sel = selectedNode();
  return html`<div className="side">
    <div className="tabs">
      ${[['lesson', 'Lesson'], ['inspect', sel ? `Inspect: ${sel.label}` : 'Inspect'], ['networks', `Networks (${app.sim.networks.length})`]].map(([k, l]) => html`<button key=${k} className=${`tab ${tab === k ? 'on' : ''}`} onClick=${() => set(k)}>${l}</button>`)}
    </div>
    <div className="tab-body">
      ${tab === 'lesson' && html`<${Lesson} />`}
      ${tab === 'inspect' && html`<${Inspect} />`}
      ${tab === 'networks' && html`<${Networks} />`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- boot

async function boot() {
  createRoot(document.getElementById('toolbar')).render(html`<${Toolbar} />`);
  createRoot(document.getElementById('palette')).render(html`<${Palette} />`);
  createRoot(document.getElementById('side')).render(html`<${Side} />`);

  const container = document.getElementById('editor');
  await createEditor(container);

  // switch to Inspect when a node gets picked
  app.area.addPipe((ctx) => {
    if (ctx.type === 'nodepicked' && app.sideTab !== 'networks') { app.sideTab = 'inspect'; queueMicrotask(() => store.bump()); }
    return ctx;
  });

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { saved = null; }
  if (saved && saved.nodes?.length) {
    app.lesson = EXAMPLES.find((e) => e.key === saved.lesson) || null;
    await load(saved);
  } else {
    app.lesson = EXAMPLES[0];
    await load(EXAMPLES[0].data);
  }
  app.sideTab = 'lesson';
  store.bump();

  window.addEventListener('keydown', async (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = app.editor.getNodes().filter((n) => n.selected);
      for (const n of sel) await removeNode(n.id);
    } else if (e.key === ' ') {
      e.preventDefault();
      app.running = !app.running;
      store.bump();
    } else if (e.key === '.') {
      if (app.running) { app.running = false; }
      app.stepOnce();
    }
  });

  requestAnimationFrame((t) => { last = t; frame(t); });
  window.circuitApp = app; // handy for poking around in devtools
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('editor').innerHTML = `<pre class="boot-error">Failed to start: ${String(e?.stack || e)}</pre>`;
});

export { Chip };
