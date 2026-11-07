// Reusable React (htm) widgets in the style of Factorio's GUI: signal icons and slots, the signal
// picker window, orange checkboxes, R/G wire selection, operands and condition rows.
import { React, html } from '../../vendor/rete-bundle.js';
import { SIGNALS, signalInfo, EACH, EVERYTHING, ANYTHING } from '../signals.js';
import { COMPARATORS, COMPARATOR_LABEL, sortedEntries } from '../sim.js';

export const stop = (e) => e.stopPropagation();

/** Factorio-style short number: 12345 -> 12.3k */
export function fmt(v) {
  const a = Math.abs(v);
  if (a < 10000) return String(v);
  if (a < 1e6) return `${(v / 1e3).toFixed(a < 1e5 ? 1 : 0)}k`;
  if (a < 1e9) return `${(v / 1e6).toFixed(a < 1e8 ? 1 : 0)}M`;
  return `${(v / 1e9).toFixed(1)}G`;
}

// ---------------------------------------------------------------- icons

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => {
    const c = (n >> s) & 255;
    return Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function gearPath(cx, cy, r1, r2, teeth) {
  const pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const r = i % 4 < 2 ? r2 : r1;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
const GEAR = gearPath(16, 16, 10, 13.5, 8);
const OUT = { stroke: '#000', strokeWidth: 1, strokeLinejoin: 'round' };

const DRAW = {
  ore: (c) => html`<g>
    <path d="M3 25l3-8 7-3 5 5-2 8-9 1z" fill=${shade(c, -0.15)} ...${OUT} />
    <path d="M12 14l5-8 8 2 3 8-6 5-7-2z" fill=${shade(c, 0.12)} ...${OUT} />
    <path d="M14 28l3-8 8-2 5 6-4 5z" fill=${c} ...${OUT} />
    <path d="M16 8l4 1M6 19l4-2M19 22l4-1" stroke="#fff6" strokeWidth="1.5" strokeLinecap="round" />
  </g>`,
  plate: (c) => html`<g>
    <path d="M3 21v3l13 6 13-6v-3l-13 6z" fill=${shade(c, -0.45)} ...${OUT} />
    <path d="M3 21l13-6 13 6-13 6z" fill=${shade(c, -0.2)} ...${OUT} />
    <path d="M3 13v3l13 6 13-6v-3l-13 6z" fill=${shade(c, -0.35)} ...${OUT} />
    <path d="M3 13l13-6 13 6-13 6z" fill=${c} ...${OUT} />
    <path d="M8 13l8-4" stroke="#fff8" strokeWidth="1.5" strokeLinecap="round" />
  </g>`,
  gear: (c) => html`<g>
    <path d=${GEAR} fill=${c} ...${OUT} />
    <circle cx="16" cy="16" r="6.5" fill=${shade(c, -0.3)} stroke="#0008" />
    <circle cx="16" cy="16" r="3" fill="#1b1b1b" />
  </g>`,
  cable: (c) => html`<g fill="none" strokeLinecap="round">
    ${[9, 16, 23].map((y) => html`<path key=${y} d=${`M4 ${y}c6-6 10 6 16 0s6-2 8-2`} stroke="#000" strokeWidth="5" />`)}
    ${[9, 16, 23].map((y) => html`<path key=${`c${y}`} d=${`M4 ${y}c6-6 10 6 16 0s6-2 8-2`} stroke=${c} strokeWidth="3" />`)}
  </g>`,
  board: (c) => html`<g>
    <rect x="3" y="6" width="26" height="20" rx="2" fill=${c} ...${OUT} />
    <path d="M7 10h6v4h4M7 22h5v-4h5M25 10v6h-4M25 22h-4" stroke="#e8d36a" strokeWidth="1.5" fill="none" />
    <rect x="13" y="12" width="7" height="7" fill="#222" stroke="#000" />
  </g>`,
  battery: (c) => html`<g>
    <rect x="11" y="3" width="10" height="4" fill="#c8c8c8" ...${OUT} />
    <rect x="7" y="6" width="18" height="23" rx="2" fill=${c} ...${OUT} />
    <rect x="7" y="11" width="18" height="5" fill="#0004" />
    <path d="M10 9v16" stroke="#fff5" strokeWidth="2" />
  </g>`,
  wood: (c) => html`<g>
    <rect x="3" y="15" width="22" height="9" rx="4.5" fill=${c} ...${OUT} />
    <ellipse cx="25" cy="19.5" rx="3.5" ry="4.5" fill="#d9b07a" ...${OUT} />
    <rect x="6" y="7" width="20" height="9" rx="4.5" fill=${shade(c, 0.1)} ...${OUT} />
    <ellipse cx="26" cy="11.5" rx="3.5" ry="4.5" fill="#e3bd88" ...${OUT} />
  </g>`,
  bar: (c) => html`<g>
    <path d="M3 18v4l12 6 14-8v-4l-14 8z" fill=${shade(c, -0.35)} ...${OUT} />
    <path d="M3 18l14-8 12 6-14 8z" fill=${c} ...${OUT} />
  </g>`,
};

function Glyph({ s }) {
  if (s.shape === 'virtual') {
    return html`<text x="16" y="24" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="2" paintOrder="stroke" fontFamily="'Titillium Web', sans-serif">${s.label}</text>`;
  }
  if (s.shape === 'color') {
    return html`<g><circle cx="16" cy="16" r="11" fill=${s.color} stroke="#000" strokeWidth="1.5" />
      <ellipse cx="12.5" cy="11.5" rx="5" ry="3" fill="#fff6" /></g>`;
  }
  if (s.shape === 'wild') {
    return html`<g strokeLinecap="round">
      <path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12" stroke="#000" strokeWidth="7" />
      <path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12" stroke=${s.color} strokeWidth="4.5" />
      <circle cx="16" cy="16" r="3" fill=${shade(s.color, 0.5)} />
    </g>`;
  }
  const draw = DRAW[s.icon];
  if (draw) return draw(s.color);
  return html`<text x="16" y="22" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">${s.label}</text>`;
}

export function SignalIcon({ id, size = 26 }) {
  const s = signalInfo(id);
  return html`<svg className="sig-icon" viewBox="0 0 32 32" width=${size} height=${size} aria-hidden="true"><${Glyph} s=${s} /></svg>`;
}

const combo = (sym, color) => html`<g>
  <path d="M4 9l12-5 12 5v15l-12 5-12-5z" fill="#6f6658" stroke="#000" strokeLinejoin="round" />
  <path d="M4 9l12 5 12-5" fill="none" stroke="#9a8f7c" />
  <rect x="8" y="14" width="16" height="10" fill="#14200f" stroke="#000" />
  <text x="16" y="22.5" textAnchor="middle" fontSize="10" fontWeight="700" fill=${color} fontFamily="monospace">${sym}</text>
</g>`;

const ENTITY = {
  constant: combo('#', '#ffcf5a'),
  arithmetic: combo('+×', '#ffcf5a'),
  decider: combo('>', '#7fe07f'),
  selector: combo('⇅', '#7fd0ff'),
  lamp: html`<g><rect x="9" y="22" width="14" height="6" fill="#6f6f6f" stroke="#000" /><circle cx="16" cy="14" r="9" fill="#ffe08a" stroke="#000" /><ellipse cx="13" cy="11" rx="3.5" ry="2.5" fill="#fff9" /></g>`,
  display: html`<g><rect x="3" y="7" width="26" height="18" rx="2" fill="#4a4a4a" stroke="#000" /><rect x="6" y="10" width="20" height="12" fill="#101010" />
    <text x="16" y="20" textAnchor="middle" fontSize="9" fontWeight="700" fill="#ff6a3d" fontFamily="monospace">123</text></g>`,
  chest: html`<g><rect x="5" y="8" width="22" height="18" rx="1" fill="#a06a35" stroke="#000" /><path d="M5 14h22M5 20h22" stroke="#6b4420" strokeWidth="2" />
    <rect x="14" y="12" width="4" height="5" fill="#d8c27a" stroke="#000" /></g>`,
  assembler: html`<g><rect x="3" y="3" width="26" height="26" rx="2" fill="#8a8f93" stroke="#000" /><path d=${GEAR} fill="#5d646a" stroke="#000" transform="translate(3.2 3.2) scale(0.8)" />
    <circle cx="16" cy="16" r="3" fill="#2a2a2a" /></g>`,
  button: html`<g><rect x="4" y="8" width="24" height="18" rx="2" fill="#5a5a5a" stroke="#000" /><circle cx="16" cy="16" r="6.5" fill="#e04a3a" stroke="#000" /><ellipse cx="14" cy="14" rx="2.5" ry="1.6" fill="#fff8" /></g>`,
  solar: html`<g><path d="M2 20l9-12h19l-9 12z" fill="#2f5d8a" stroke="#000" strokeLinejoin="round" />
    <path d="M8 12h18M5 16h18M17 8l-9 12M24 8l-9 12" stroke="#7fb2e0" strokeWidth="0.8" /><path d="M2 20v3h19l9-12v-3" fill="#555" stroke="#000" /></g>`,
  generator: html`<g><rect x="3" y="10" width="22" height="13" rx="6" fill="#8a8f93" stroke="#000" /><rect x="24" y="13" width="6" height="7" fill="#6a6a6a" stroke="#000" />
    <path d="M9 10v13M15 10v13" stroke="#5d646a" strokeWidth="1.5" /><path d="M12 6c0-3 4-3 4-6" stroke="#ddd8" strokeWidth="1.5" fill="none" /></g>`,
  accumulator: html`<g>${[6, 18].map((x) => html`<g key=${x}><rect x=${x} y="7" width="9" height="20" rx="2" fill="#4a4f55" stroke="#000" /><rect x=${x} y="7" width="9" height="4" fill="#4ea3d8" stroke="#000" /></g>`)}</g>`,
  load: html`<g><path d="M3 28V14l7 4v-4l7 4v-4l7 4V6h5v22z" fill="#7a6f60" stroke="#000" strokeLinejoin="round" /><rect x="7" y="21" width="4" height="4" fill="#ffd36a" /><rect x="15" y="21" width="4" height="4" fill="#ffd36a" /></g>`,
};

/** Small picture of a building / combinator kind, used in the palette and window titles. */
export function EntityIcon({ kind, size = 22 }) {
  return html`<svg className="ent-icon" viewBox="0 0 32 32" width=${size} height=${size} aria-hidden="true">${ENTITY[kind]}</svg>`;
}

// ---------------------------------------------------------------- slots

/** A Factorio inventory slot: dark square button with an icon and a count in the corner. */
export function Slot({ id, value, onClick, onClear, title, small = false, selected = false, className = '', children }) {
  const s = id ? signalInfo(id) : null;
  const tip = title ?? (s ? (value != null ? `${s.name}: ${value}` : s.name) : '');
  const cls = `f-slot ${small ? 'small' : ''} ${selected ? 'selected' : ''} ${onClick ? 'button' : ''} ${className}`;
  const body = html`
    ${s && html`<${SignalIcon} id=${id} size=${small ? 20 : 26} />`}
    ${value != null && html`<span className="f-count">${fmt(value)}</span>`}
    ${children}`;
  if (!onClick) return html`<span className=${cls} title=${tip}>${body}</span>`;
  return html`<button className=${cls} title=${tip} onClick=${(e) => onClick(e.currentTarget)}
    onContextMenu=${(e) => { e.preventDefault(); onClear?.(); }}>${body}</button>`;
}

export function Chip({ id, value }) {
  return html`<${Slot} id=${id} value=${value} small />`;
}

export function SignalList({ map, empty = '—' }) {
  if (!map || map.size === 0) return html`<span className="muted">${empty}</span>`;
  return html`<span className="siglist">${sortedEntries(map).map(([id, v]) => html`<${Chip} key=${id} id=${id} value=${v} />`)}</span>`;
}

// ---------------------------------------------------------------- signal picker window

let picker = null;
const pickerSubs = new Set();
function setPicker(p) { picker = p; for (const f of pickerSubs) f(); }
const subscribePicker = (cb) => { pickerSubs.add(cb); return () => pickerSubs.delete(cb); };

/**
 * Open the "Select a signal" window next to `anchor`.
 * opts: { value, wildcards, itemsOnly, title, onPick(id),
 *         number + onNumber(n) + numberLabel: an editable number shown under the grid,
 *         keepOpen: stay open after picking (used when a count goes with the signal),
 *         onClear(): adds a Clear button }
 */
export function openPicker(anchor, opts) {
  setPicker({ ...opts, rect: anchor.getBoundingClientRect(), key: Math.random() });
}
export function closePicker() { setPicker(null); }

const ITEMS = SIGNALS.filter((s) => s.type === 'item');
const VIRTUALS = SIGNALS.filter((s) => s.shape === 'virtual');
const COLOR_SIGNALS = SIGNALS.filter((s) => s.shape === 'color');

function PickerWindow({ p }) {
  const startTab = p.itemsOnly || !p.value || signalInfo(p.value).type === 'item' ? 'items' : 'signals';
  const [tab, setTab] = React.useState(startTab);
  const [sel, setSel] = React.useState(p.value);
  const [num, setNum] = React.useState(String(p.number ?? 0));
  const [pos, setPos] = React.useState({ left: p.rect.left, top: p.rect.bottom + 4, visibility: 'hidden' });
  const ref = React.useRef(null);
  const numRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(p.rect.left, window.innerWidth - w - 8));
    let top = p.rect.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, p.rect.top - h - 4);
    setPos({ left, top });
  }, []);

  const shown = pos.visibility !== 'hidden';
  React.useEffect(() => {
    // focus only once visible: a visibility:hidden input can't take focus
    if (shown && p.focusNumber) { numRef.current?.focus(); numRef.current?.select(); }
  }, [shown]);

  React.useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) closePicker(); };
    const key = (e) => { if (e.key === 'Escape') closePicker(); };
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true));
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); };
  }, []);

  const pick = (id) => {
    p.onPick(id);
    setSel(id);
    if (p.keepOpen) { numRef.current?.focus(); numRef.current?.select(); }
    else closePicker();
  };
  const applyNum = (close) => {
    const v = parseInt(num, 10);
    if (Number.isNaN(v)) return;
    p.onNumber(Math.max(-2147483648, Math.min(2147483647, v)));
    if (close) closePicker();
  };
  const grid = (list) => list.map((s) => html`<${Slot} key=${s.id} id=${s.id} selected=${sel === s.id} onClick=${() => pick(s.id)} />`);
  const wild = (p.wildcards || []).map((id) => signalInfo(id));

  return html`<div className="f-window f-picker" ref=${ref} style=${pos} onPointerDown=${stop}>
    <div className="f-titlebar"><span className="f-title">${p.title || 'Select a signal'}</span><span className="f-drag"></span>
      <button className="f-close" title="Close (Esc)" onClick=${closePicker}>✕</button></div>
    ${!p.itemsOnly && html`<div className="f-tabs">
      <button className=${`f-tab ${tab === 'items' ? 'on' : ''}`} onClick=${() => setTab('items')}><${SignalIcon} id="iron-gear" size=${28} /><span>Items</span></button>
      <button className=${`f-tab ${tab === 'signals' ? 'on' : ''}`} onClick=${() => setTab('signals')}><${SignalIcon} id="signal-A" size=${28} /><span>Signals</span></button>
    </div>`}
    <div className="f-inset f-grid">
      ${tab === 'items' ? grid(ITEMS) : html`
        ${wild.length > 0 && html`<div className="f-grid-row">${grid(wild)}</div>`}
        <div className="f-grid-row">${grid(VIRTUALS)}</div>
        <div className="f-grid-row">${grid(COLOR_SIGNALS)}</div>`}
    </div>
    ${p.onNumber && html`<div className="f-picker-num">
      <span className="f-label">${p.numberLabel || 'Constant'}</span>
      <input ref=${numRef} className="f-text" value=${num} inputMode="numeric"
        onChange=${(e) => { setNum(e.target.value); if (p.liveNumber) { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) p.onNumber(v); } }}
        onKeyDown=${(e) => { if (e.key === 'Enter') applyNum(true); }} />
      ${!p.liveNumber && html`<button className="f-btn green" onClick=${() => applyNum(true)}>Set</button>`}
    </div>`}
    ${p.onClear && html`<div className="f-picker-foot"><button className="f-btn" onClick=${() => { p.onClear(); closePicker(); }}>${p.clearLabel || 'Clear'}</button></div>`}
  </div>`;
}

/** Mounted once (main.js) outside the editor so the window isn't scaled with the board. */
export function PickerHost() {
  const p = React.useSyncExternalStore(subscribePicker, () => picker);
  if (!p) return null;
  return html`<${PickerWindow} key=${p.key} p=${p} />`;
}

/** A slot that opens the picker. value: signal id or null. */
export function SignalPicker({ value, onChange, wildcards = [], allowNone = false, itemsOnly = false, title }) {
  return html`<${Slot} id=${value} title=${title ?? (value ? signalInfo(value).name : 'Pick a signal')}
    onClick=${(el) => openPicker(el, { value, wildcards, itemsOnly, onPick: onChange, onClear: allowNone ? () => onChange(null) : undefined })}
    onClear=${allowNone ? () => onChange(null) : undefined} />`;
}

// ---------------------------------------------------------------- form controls

export function Num({ value, onChange, float = false, min = -2147483648, max = 2147483647, width = 64, title }) {
  const [text, setText] = React.useState(String(value ?? 0));
  React.useEffect(() => {
    const parsed = float ? parseFloat(text) : parseInt(text, 10);
    if (parsed !== value) setText(String(value ?? 0));
  }, [value]);
  return html`<input className="f-text" type="text" inputMode="numeric" title=${title} value=${text} style=${{ width }}
    onChange=${(e) => {
      const t = e.target.value;
      setText(t);
      let v = float ? parseFloat(t) : parseInt(t, 10);
      if (Number.isNaN(v)) return;
      v = Math.max(min, Math.min(max, v));
      onChange(float ? v : v | 0);
    }}
    onBlur=${() => setText(String(value ?? 0))} />`;
}

export function Check({ checked, onChange, label, title, disabled = false }) {
  return html`<label className=${`f-check ${disabled ? 'disabled' : ''}`} title=${title}>
    <input type="checkbox" checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} />
    <span className="f-box"></span>${label != null && html`<span className="f-check-label">${label}</span>`}
  </label>`;
}

export function Radio({ checked, onChange, children, title }) {
  return html`<label className="f-radio" title=${title}>
    <input type="radio" checked=${!!checked} onChange=${() => onChange()} /><span className="f-dot"></span>${children}
  </label>`;
}

export function Select({ value, onChange, options, className = '', title }) {
  return html`<select className=${`f-select ${className}`} title=${title} value=${value} onChange=${(e) => onChange(e.target.value)}>
    ${options.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
  </select>`;
}

/** Factorio's stacked R / G checkboxes choosing which wire colours an operand reads. */
export function Nets({ nets, onChange, disabled = false, title = 'Which wire colours to read' }) {
  const n = nets || { red: true, green: true };
  return html`<span className="f-rg" title=${title}>
    <${Check} checked=${disabled || n.red !== false} disabled=${disabled} label="R" onChange=${(v) => onChange({ ...n, red: v })} />
    <${Check} checked=${disabled || n.green !== false} disabled=${disabled} label="G" onChange=${(v) => onChange({ ...n, green: v })} />
  </span>`;
}

// ---------------------------------------------------------------- operands & conditions

/**
 * op: { kind: 'signal'|'const', id, value } – mutated in place.
 * Shows a signal slot, or a dark box with the constant. Clicking opens the picker with a
 * Constant field; right-click turns a signal back into a constant.
 */
export function Operand({ op, onChange, wildcards = [], title }) {
  const open = (el) => openPicker(el, {
    value: op.kind === 'signal' ? op.id : null,
    wildcards,
    number: op.kind === 'const' ? op.value ?? 0 : 0,
    focusNumber: op.kind === 'const',
    onPick: (id) => { op.kind = 'signal'; op.id = id; onChange(); },
    onNumber: (n) => { op.kind = 'const'; op.value = n; onChange(); },
  });
  if (op.kind === 'const') {
    return html`<button className="f-slot f-const button" title=${title ?? 'Constant: click to change it or pick a signal'} onClick=${(e) => open(e.currentTarget)}>${fmt(op.value ?? 0)}</button>`;
  }
  return html`<${Slot} id=${op.id} title=${title} onClick=${open} onClear=${() => { op.kind = 'const'; op.value = 0; onChange(); }} />`;
}

const CMP_OPTIONS = Object.keys(COMPARATORS).map((k) => [k, COMPARATOR_LABEL[k]]);

/**
 * One condition row: [R/G] [signal] [comparator] [R/G] [signal or constant].
 * `truth` highlights the row green (true) like the game does; `onRemove` adds the grip and ✕.
 */
export function ConditionEditor({ c, onChange, wildcards = [EVERYTHING, ANYTHING], nets = false, truth = null, onRemove }) {
  c.firstNets ??= { red: true, green: true };
  c.secondNets ??= { red: true, green: true };
  c.second ??= { kind: 'const', value: 0 };
  return html`<div className=${`f-cond ${truth ? 'true' : ''} ${onRemove ? 'removable' : ''}`}>
    ${nets && html`<${Nets} nets=${c.firstNets} onChange=${(n) => { c.firstNets = n; onChange(); }} />`}
    <${SignalPicker} value=${c.first} wildcards=${wildcards} allowNone onChange=${(v) => { c.first = v; onChange(); }} />
    <${Select} className="f-cmp" value=${c.cmp} options=${CMP_OPTIONS} onChange=${(v) => { c.cmp = v; onChange(); }} title="Comparator" />
    ${nets && html`<${Nets} nets=${c.secondNets} disabled=${c.second.kind !== 'signal'} onChange=${(n) => { c.secondNets = n; onChange(); }} />`}
    <${Operand} op=${c.second} onChange=${onChange} />
    ${onRemove && html`<span className="f-grip"></span><button className="f-x" title="Remove condition" onClick=${onRemove}>✕</button>`}
  </div>`;
}

export function describeCondition(c) {
  if (!c?.first) return '(no condition)';
  const rhs = c.second?.kind === 'signal' ? signalInfo(c.second.id).name : String(c.second?.value ?? 0);
  return `${signalInfo(c.first).name} ${COMPARATOR_LABEL[c.cmp] || c.cmp} ${rhs}`;
}

export { EACH, EVERYTHING, ANYTHING };
