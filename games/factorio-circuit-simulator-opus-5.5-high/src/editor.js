// Rete.js editor: node class, custom React views for nodes / wires / sockets, wiring rules, save & load.
import {
  NodeEditor, ClassicPreset, AreaPlugin, AreaExtensions, ConnectionPlugin, ClassicFlow, getSourceTarget,
  ReactPlugin, ReactPresets, React, createRoot, html,
} from '../vendor/rete-bundle.js';
import { app, store, useStore, userChanged } from './state.js';
import { KINDS } from './sim.js';
import { META } from './ui/nodes.js';
import { stop, EntityIcon } from './ui/components.js';

const { RefSocket, useConnection } = ReactPresets.classic;

const SOCKETS = { red: new ClassicPreset.Socket('red'), green: new ClassicPreset.Socket('green') };
const COLORS = ['red', 'green'];

const counters = {};

export class CircuitNode extends ClassicPreset.Node {
  constructor(kind, config, label) {
    const meta = META[kind];
    counters[kind] = (counters[kind] || 0) + 1;
    super(label || `${meta.short} ${counters[kind]}`);
    this.kind = kind;
    this.config = config ? structuredClone(config) : KINDS[kind].defaultConfig();
    this.state = {};
    this.out = new Map();
    this.width = meta.width;
    if (KINDS[kind].points.length) {
      for (const c of COLORS) {
        this.addInput(c, new ClassicPreset.Input(SOCKETS[c], c, true));
        this.addOutput(c, new ClassicPreset.Output(SOCKETS[c], c, true));
      }
    }
  }
}

/** Which simulator point a socket side maps to. */
export function pointFor(node, side) {
  const pts = KINDS[node.kind].points;
  if (pts.length === 2) return side === 'input' ? 'in' : 'out';
  return 'main';
}

function wiresFromEditor(editor) {
  return editor.getConnections().map((c) => {
    const s = editor.getNode(c.source);
    const t = editor.getNode(c.target);
    return { color: c.sourceOutput, a: { id: s.id, point: pointFor(s, 'output') }, b: { id: t.id, point: pointFor(t, 'input') } };
  });
}

let rebuildQueued = false;
export function rebuildSim() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  queueMicrotask(() => {
    rebuildQueued = false;
    const ed = app.editor;
    app.sim.setGraph(ed.getNodes(), wiresFromEditor(ed));
    store.bump();
  });
}

// ---------------------------------------------------------------- views

function SocketView({ data }) {
  return html`<div className=${`sock sock-${data.name}`} title=${`${data.name} wire: drag to another ${data.name} socket`}></div>`;
}

function Sockets({ node, side, emit }) {
  const ports = side === 'input' ? node.inputs : node.outputs;
  return html`<div className=${`sockets ${side}`}>
    ${COLORS.map((c) => ports[c] && html`<div className=${`srow ${c}`} key=${c}>
      <${RefSocket} name="sref" side=${side} socketKey=${c} nodeId=${node.id} emit=${emit} payload=${ports[c].socket} />
    </div>`)}
  </div>`;
}

/** "Connected to: R1 G2" in the game's style, using this simulator's network ids. */
function NetIds({ node, point, prefix = true }) {
  const r = app.sim.network(node.id, point, 'red');
  const g = app.sim.network(node.id, point, 'green');
  if (!r && !g) return html`<span className="muted">not connected</span>`;
  return html`<span title="Connected networks">${prefix && 'Connected to: '}${r && html`<span className="net-text red">${r.id}</span>`} ${g && html`<span className="net-text green">${g.id}</span>`}</span>`;
}

function ConnectionBar({ node, emit }) {
  useStore();
  const dual = KINDS[node.kind].points.length === 2;
  return html`<div className="f-conn">
    <${Sockets} node=${node} side="input" emit=${emit} />
    ${dual
      ? html`<span className="f-conn-side"><b>Input:</b> <${NetIds} node=${node} point="in" prefix=${false} /></span>
          <span className="f-conn-mid" title="Combinators write their result one tick after reading">→ 1 tick →</span>
          <span className="f-conn-side right"><b>Output:</b> <${NetIds} node=${node} point="out" prefix=${false} /></span>`
      : html`<span className="f-conn-side center" title="Single connection point: both sides are the same point"><b>Circuit:</b> <${NetIds} node=${node} point="main" /></span>`}
    <${Sockets} node=${node} side="output" emit=${emit} />
  </div>`;
}

function StatusLine({ node }) {
  useStore();
  const st = META[node.kind].status?.(node.state);
  if (!st) return null;
  return html`<div className="f-status"><span className=${`f-led ${st[0]}`}></span>${st[1]}</div>`;
}

function NodeView({ data, emit }) {
  const meta = META[data.kind];
  const [, force] = React.useReducer((x) => x + 1, 0);
  const onChange = React.useCallback(() => { force(); userChanged(); }, []);
  const hasSockets = KINDS[data.kind].points.length > 0;
  const { Body, Live, Extra } = meta;
  return html`<div className=${`cnode f-window kind-${data.kind} ${data.selected ? 'selected' : ''}`} style=${{ width: `${meta.width}px` }} data-testid="node">
    <div className="f-titlebar">
      <${EntityIcon} kind=${data.kind} size=${22} />
      <span className="f-title" title=${meta.title}>${data.label}</span>
      <span className="f-drag"></span>
      ${data.label !== meta.title && html`<span className="f-kind">${meta.title}</span>`}
      <button className="f-close" title="Delete (Del)" onPointerDown=${stop} onClick=${() => removeNode(data.id)}>✕</button>
    </div>
    ${hasSockets && html`<${ConnectionBar} node=${data} emit=${emit} />`}
    <div className="cnode-body" onPointerDown=${stop} onDoubleClick=${stop} onContextMenu=${stop}>
      <${StatusLine} node=${data} />
      ${Live && html`<${Live} node=${data} />`}
      ${Body && html`<${Body} node=${data} onChange=${onChange} />`}
      ${Extra && html`<${Extra} node=${data} />`}
    </div>
  </div>`;
}

function WireView({ data }) {
  const { path } = useConnection();
  useStore();
  const ref = React.useRef(null);
  const [mid, setMid] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!ref.current || !path) return;
    try {
      const len = ref.current.getTotalLength();
      const p = ref.current.getPointAtLength(len / 2);
      setMid({ x: p.x, y: p.y });
    } catch { /* not laid out yet */ }
  }, [path]);
  if (!path) return null;
  const color = (data.sourceOutput || data.targetInput) === 'green' ? 'green' : 'red';
  if (data.isPseudo) {
    return html`<svg className=${`wire wire-${color} pseudo`} data-testid="connection"><path className="wire-line" d=${path} /></svg>`;
  }
  const src = app.editor.getNode(data.source);
  const net = src ? app.sim.network(src.id, pointFor(src, 'output'), color) : null;
  const hot = net && app.hoverNet === net.id;
  return html`<svg className=${`wire wire-${color} ${hot ? 'hot' : ''}`} data-testid="connection">
    <path className="wire-hit" d=${path}
      onPointerDown=${stop}
      onPointerEnter=${() => { app.hoverNet = net?.id ?? null; store.bump(); }}
      onPointerLeave=${() => { app.hoverNet = null; store.bump(); }}
      onClick=${() => { app.hoverNet = null; removeConnection(data.id); }}>
      <title>${`${color} wire, network ${net?.id ?? '?'}: click to cut`}</title>
    </path>
    <path ref=${ref} className="wire-line" d=${path} />
    ${mid && net && html`<g className="wire-tag" transform=${`translate(${mid.x},${mid.y})`}><rect x="-13" y="-8" width="26" height="16" rx="4" /><text y="4">${net.id}</text></g>`}
  </svg>`;
}

// ---------------------------------------------------------------- editor actions

export async function removeConnection(id) {
  await app.editor.removeConnection(id);
  userChanged();
}

export async function removeNode(id) {
  const ed = app.editor;
  for (const c of ed.getConnections().filter((c) => c.source === id || c.target === id)) await ed.removeConnection(c.id);
  await ed.removeNode(id);
  userChanged();
}

export async function addNode(kind, pos, config, label) {
  const node = new CircuitNode(kind, config, label);
  await app.editor.addNode(node);
  if (!pos) pos = freeSpot(node.width, 260);
  await app.area.translate(node.id, pos);
  return node;
}

/** A spot near the middle of the view that doesn't cover an existing box. */
function freeSpot(w, h) {
  const { x, y, k } = app.area.area.transform;
  const rect = app.area.container.getBoundingClientRect();
  const cx = (rect.width / 2 - x) / k - w / 2;
  const cy = (rect.height / 2 - y) / k - h / 2;
  const boxes = [];
  for (const [id, view] of app.area.nodeViews) {
    const el = view.element.querySelector('.cnode');
    if (!el || !app.editor.getNode(id)) continue;
    boxes.push({ x: view.position.x, y: view.position.y, w: el.offsetWidth, h: el.offsetHeight });
  }
  const free = (px, py) => boxes.every((b) => px + w + 16 < b.x || b.x + b.w + 16 < px || py + h + 16 < b.y || b.y + b.h + 16 < py);
  for (let ring = 0; ring < 12; ring++) {
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      const px = cx + Math.cos(a) * ring * 90;
      const py = cy + Math.sin(a) * ring * 70;
      if (free(px, py)) return { x: px, y: py };
    }
  }
  return { x: cx, y: cy };
}

export async function connect(source, sourceColor, target) {
  const c = new ClassicPreset.Connection(source, sourceColor, target, sourceColor);
  c.isLoop = source.id === target.id;
  await app.editor.addConnection(c);
  return c;
}

export function serialize() {
  const ed = app.editor;
  const nodes = ed.getNodes().map((n) => {
    const p = app.area.nodeViews.get(n.id)?.position || { x: 0, y: 0 };
    return { id: n.id, kind: n.kind, label: n.label, config: n.config, x: Math.round(p.x), y: Math.round(p.y) };
  });
  const wires = ed.getConnections().map((c) => ({ from: c.source, to: c.target, color: c.sourceOutput }));
  return { format: 'circuit-sim', version: 1, nodes, wires };
}

export async function load(data, { fit = true } = {}) {
  const ed = app.editor;
  await ed.clear();
  for (const k of Object.keys(counters)) delete counters[k];
  const map = new Map();
  for (const n of data.nodes || []) {
    if (!KINDS[n.kind]) continue;
    // keep the counter ahead of loaded labels like "Decider 3"
    const m = /\s(\d+)$/.exec(n.label || '');
    const node = await addNode(n.kind, { x: n.x, y: n.y }, { ...KINDS[n.kind].defaultConfig(), ...n.config }, n.label);
    if (m) counters[n.kind] = Math.max(counters[n.kind] || 0, +m[1]);
    map.set(n.id, node);
  }
  for (const w of data.wires || []) {
    const s = map.get(w.from);
    const t = map.get(w.to);
    if (s && t && (w.color === 'red' || w.color === 'green')) await connect(s, w.color, t);
  }
  app.sim.tick = 0;
  rebuildSim();
  if (fit) setTimeout(() => zoomToFit(), 50);
}

export function zoomToFit() {
  const nodes = app.editor.getNodes();
  if (nodes.length) AreaExtensions.zoomAt(app.area, nodes, { scale: 0.92 });
}

export function resetSimulation() {
  for (const n of app.editor.getNodes()) { n.state = {}; n.out = new Map(); }
  app.sim.tick = 0;
  rebuildSim();
}

export function selectedNode() {
  return app.editor?.getNodes().find((n) => n.selected) || null;
}

let flashTimer = null;
export function flash(msg) {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- setup

export async function createEditor(container) {
  const editor = new NodeEditor();
  const area = new AreaPlugin(container);
  const connection = new ConnectionPlugin();
  const render = new ReactPlugin({ createRoot });
  app.editor = editor;
  app.area = area;

  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), { accumulating: AreaExtensions.accumulateOnCtrl() });

  render.addPreset(ReactPresets.classic.setup({
    customize: {
      node: () => NodeView,
      connection: () => WireView,
      socket: () => SocketView,
    },
  }));

  connection.addPreset(() => new ClassicFlow({
    canMakeConnection(from, to) {
      // releasing on the socket you started from = click-to-connect mode, keep the wire in hand
      if (from.nodeId === to.nodeId && from.side === to.side && from.key === to.key) return false;
      const reject = (msg) => {
        flash(msg);
        setTimeout(() => connection.drop(), 0); // don't leave a dangling wire on the cursor
        return false;
      };
      const st = getSourceTarget(from, to);
      if (!st) return reject('Drag from a right-hand socket to a left-hand socket.');
      const [s, t] = st;
      if (s.key !== t.key) return reject('A red wire only joins red sockets, green only green.');
      const dup = editor.getConnections().some((c) => c.source === s.nodeId && c.target === t.nodeId && c.sourceOutput === s.key);
      if (dup) return reject('Those points are already wired with that colour.');
      return true;
    },
    makeConnection(from, to, context) {
      const st = getSourceTarget(from, to);
      if (!st) return false;
      const [s, t] = st;
      const c = new ClassicPreset.Connection(editor.getNode(s.nodeId), s.key, editor.getNode(t.nodeId), t.key);
      c.isLoop = s.nodeId === t.nodeId;
      void context.editor.addConnection(c);
      return true;
    },
  }));

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  editor.addPipe((ctx) => {
    if (['nodecreated', 'noderemoved', 'connectioncreated', 'connectionremoved'].includes(ctx.type)) {
      rebuildSim();
      if (ctx.type.startsWith('connection')) userChanged();
    }
    return ctx;
  });
  area.addPipe((ctx) => {
    if (ctx.type === 'nodepicked' || ctx.type === 'pointerdown') queueMicrotask(() => store.bump());
    if (ctx.type === 'nodedragged') userChanged();
    return ctx;
  });
  return { editor, area };
}
