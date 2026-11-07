// Reusable React (htm) widgets: signal chips, pickers, condition rows, network toggles.
import { React, html } from '../../vendor/rete-bundle.js';
import { SIGNALS, signalInfo, EACH, EVERYTHING, ANYTHING } from '../signals.js';
import { COMPARATORS, COMPARATOR_LABEL, sortedEntries } from '../sim.js';

export const stop = (e) => e.stopPropagation();

/** Factorio-style short number: 1234 -> 1.2k */
export function fmt(v) {
  const a = Math.abs(v);
  if (a < 10000) return String(v);
  if (a < 1e6) return `${(v / 1e3).toFixed(a < 1e5 ? 1 : 0)}k`;
  if (a < 1e9) return `${(v / 1e6).toFixed(a < 1e8 ? 1 : 0)}M`;
  return `${(v / 1e9).toFixed(1)}G`;
}

export function Chip({ id, value }) {
  const s = signalInfo(id);
  const title = value == null ? s.name : `${s.name}: ${value}`;
  return html`<span className=${`chip shape-${s.shape}`} title=${title} style=${{ '--c': s.color }}>
    <span className="chip-icon">${s.label}</span>
    ${value != null && html`<span className="chip-val">${fmt(value)}</span>`}
  </span>`;
}

export function SignalList({ map, empty = '—' }) {
  if (!map || map.size === 0) return html`<span className="muted">${empty}</span>`;
  return html`<span className="siglist">${sortedEntries(map).map(([id, v]) => html`<${Chip} key=${id} id=${id} value=${v} />`)}</span>`;
}

// ---------------------------------------------------------------- signal picker

const ITEM_OPTIONS = SIGNALS.filter((s) => s.type === 'item').map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`);
const LETTER_OPTIONS = SIGNALS.filter((s) => s.shape === 'virtual').map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`);
const COLOR_OPTIONS = SIGNALS.filter((s) => s.shape === 'color').map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`);
const GROUPS = [
  html`<optgroup key="i" label="Items">${ITEM_OPTIONS}</optgroup>`,
  html`<optgroup key="l" label="Letters & digits">${LETTER_OPTIONS}</optgroup>`,
  html`<optgroup key="c" label="Colours">${COLOR_OPTIONS}</optgroup>`,
];
const ITEM_GROUP = [html`<optgroup key="i" label="Items">${ITEM_OPTIONS}</optgroup>`];

/**
 * value: signal id | null | '__const'. wildcards: list of wildcard ids allowed.
 * extra: [[value, label]] options shown first (e.g. constant).
 */
export function SignalPicker({ value, onChange, wildcards = [], allowNone = false, extra = [], itemsOnly = false, title }) {
  const showChip = value && !value.startsWith('__');
  return html`<span className="picker" title=${title}>
    ${showChip ? html`<${Chip} id=${value} />` : html`<span className="chip shape-none"><span className="chip-icon">${value === '__const' ? '#' : ''}</span></span>`}
    <select value=${value ?? ''} onChange=${(e) => onChange(e.target.value || null)}>
      ${allowNone && html`<option value="">(none)</option>`}
      ${extra.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
      ${wildcards.length > 0 && html`<optgroup label="Wildcards">${wildcards.map((id) => html`<option key=${id} value=${id}>${signalInfo(id).name}</option>`)}</optgroup>`}
      ${itemsOnly ? ITEM_GROUP : GROUPS}
    </select>
  </span>`;
}

// ---------------------------------------------------------------- numbers

export function Num({ value, onChange, float = false, min = -2147483648, max = 2147483647, width = 64, title }) {
  const [text, setText] = React.useState(String(value ?? 0));
  React.useEffect(() => {
    const parsed = float ? parseFloat(text) : parseInt(text, 10);
    if (parsed !== value) setText(String(value ?? 0));
  }, [value]);
  return html`<input className="num" type="text" inputMode="numeric" title=${title} value=${text} style=${{ width }}
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

export function Check({ checked, onChange, label, title }) {
  return html`<label className="check" title=${title}><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} /> ${label}</label>`;
}

export function Select({ value, onChange, options, className = '', title }) {
  return html`<select className=${className} title=${title} value=${value} onChange=${(e) => onChange(e.target.value)}>
    ${options.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
  </select>`;
}

// ---------------------------------------------------------------- red/green network selection

export function Nets({ nets, onChange, title = 'Which wire colours to read' }) {
  const toggle = (c) => {
    const next = { ...nets, [c]: !nets[c] };
    if (!next.red && !next.green) return; // at least one
    onChange(next);
  };
  return html`<span className="nets" title=${title}>
    <button className=${`net-btn red ${nets.red ? 'on' : ''}`} onClick=${() => toggle('red')}>R</button>
    <button className=${`net-btn green ${nets.green ? 'on' : ''}`} onClick=${() => toggle('green')}>G</button>
  </span>`;
}

// ---------------------------------------------------------------- operands & conditions

/** op: { kind: 'signal'|'const', id, value } – mutated in place. */
export function Operand({ op, onChange, wildcards = [], title }) {
  const value = op.kind === 'const' ? '__const' : op.id;
  return html`<span className="operand">
    <${SignalPicker} title=${title} value=${value} wildcards=${wildcards} extra=${[['__const', 'Constant number']]}
      onChange=${(v) => {
        if (v === '__const') op.kind = 'const';
        else { op.kind = 'signal'; op.id = v; }
        onChange();
      }} />
    ${op.kind === 'const' && html`<${Num} value=${op.value ?? 0} onChange=${(v) => { op.value = v; onChange(); }} />`}
  </span>`;
}

const CMP_OPTIONS = Object.keys(COMPARATORS).map((k) => [k, COMPARATOR_LABEL[k]]);

export function ConditionEditor({ c, onChange, wildcards = [EVERYTHING, ANYTHING], nets = true }) {
  c.firstNets ??= { red: true, green: true };
  c.secondNets ??= { red: true, green: true };
  c.second ??= { kind: 'const', value: 0 };
  return html`<span className="cond">
    <${SignalPicker} value=${c.first} wildcards=${wildcards} onChange=${(v) => { c.first = v; onChange(); }} />
    ${nets && html`<${Nets} nets=${c.firstNets} onChange=${(n) => { c.firstNets = n; onChange(); }} />`}
    <${Select} className="cmp" value=${c.cmp} options=${CMP_OPTIONS} onChange=${(v) => { c.cmp = v; onChange(); }} />
    <${Operand} op=${c.second} onChange=${onChange} />
    ${nets && c.second.kind === 'signal' && html`<${Nets} nets=${c.secondNets} onChange=${(n) => { c.secondNets = n; onChange(); }} />`}
  </span>`;
}

export function describeCondition(c) {
  if (!c?.first) return '(no condition)';
  const rhs = c.second?.kind === 'signal' ? signalInfo(c.second.id).name : String(c.second?.value ?? 0);
  return `${signalInfo(c.first).name} ${COMPARATOR_LABEL[c.cmp] || c.cmp} ${rhs}`;
}

export { EACH, EVERYTHING, ANYTHING };
