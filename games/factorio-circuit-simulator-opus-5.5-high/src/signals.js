// Signal catalogue. Order here is the tie-break order used when sorting signals.
// Pure module: no DOM, no vendor imports (used by the simulator and its tests).

const items = [
  // id, name, short label, colour, stack size, shape, icon
  ['iron-ore', 'Iron ore', 'Fe', '#5d7a91', 50, 'ore', 'ore'],
  ['copper-ore', 'Copper ore', 'Cu', '#b8653a', 50, 'ore', 'ore'],
  ['coal', 'Coal', 'C', '#2b2b2b', 50, 'ore', 'ore'],
  ['stone', 'Stone', 'St', '#9a8e72', 50, 'ore', 'ore'],
  ['wood', 'Wood', 'Wd', '#8a5a2b', 100, 'plate', 'wood'],
  ['iron-plate', 'Iron plate', 'Fe', '#a9b8c6', 100, 'plate', 'plate'],
  ['copper-plate', 'Copper plate', 'Cu', '#e08a54', 100, 'plate', 'plate'],
  ['steel-plate', 'Steel plate', 'Stl', '#d5dbe0', 100, 'plate', 'plate'],
  ['iron-gear', 'Iron gear', '⚙', '#8796a3', 100, 'plate', 'gear'],
  ['copper-cable', 'Copper cable', 'Cb', '#d77b3f', 200, 'plate', 'cable'],
  ['circuit-board', 'Circuit board', 'CB', '#3fae49', 200, 'plate', 'board'],
  ['adv-circuit', 'Advanced circuit', 'AC', '#c0392b', 200, 'plate', 'board'],
  ['plastic-bar', 'Plastic bar', 'Pl', '#e9e9e9', 100, 'plate', 'bar'],
  ['sulfur', 'Sulfur', 'S', '#e4d23a', 50, 'ore', 'ore'],
  ['battery', 'Battery', 'Bt', '#6f9e3a', 200, 'plate', 'battery'],
];

const colors = [
  ['signal-red', 'Red', '#e53935'],
  ['signal-green', 'Green', '#43a047'],
  ['signal-blue', 'Blue', '#1e88e5'],
  ['signal-yellow', 'Yellow', '#fdd835'],
  ['signal-pink', 'Pink', '#ec6fb4'],
  ['signal-cyan', 'Cyan', '#26c6da'],
  ['signal-white', 'White', '#f5f5f5'],
  ['signal-grey', 'Grey', '#9e9e9e'],
  ['signal-black', 'Black', '#212121'],
];

export const SIGNALS = [];
export const SIGNAL_BY_ID = new Map();

function add(s) {
  s.order = SIGNALS.length;
  SIGNALS.push(s);
  SIGNAL_BY_ID.set(s.id, s);
}

for (const [id, name, label, color, stack, shape, icon] of items) {
  add({ id, name, label, color, stack, shape, icon, type: 'item' });
}
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
  add({ id: `signal-${ch}`, name: `Signal ${ch}`, label: ch, color: '#3a3f44', type: 'virtual', shape: 'virtual' });
}
for (const [id, name, color] of colors) {
  add({ id, name: `${name} signal`, label: '', color, type: 'virtual', shape: 'color' });
}

// Wildcards are never present on a wire; they only appear in combinator settings.
export const EVERYTHING = 'signal-everything';
export const ANYTHING = 'signal-anything';
export const EACH = 'signal-each';
export const WILDCARDS = [
  { id: EVERYTHING, name: 'Everything', label: '✱', color: '#d84343', type: 'wildcard', shape: 'wild' },
  { id: ANYTHING, name: 'Anything', label: '✱', color: '#3fae49', type: 'wildcard', shape: 'wild' },
  { id: EACH, name: 'Each', label: '✱', color: '#e5b31a', type: 'wildcard', shape: 'wild' },
];
for (const w of WILDCARDS) {
  w.order = -1;
  SIGNAL_BY_ID.set(w.id, w);
}

/** Lamp colour priority, as used by "use colours" mode. */
export const LAMP_COLOR_ORDER = ['signal-red', 'signal-green', 'signal-blue', 'signal-yellow', 'signal-pink', 'signal-cyan', 'signal-white', 'signal-grey', 'signal-black'];

export function signalInfo(id) {
  return SIGNAL_BY_ID.get(id) || { id, name: id, label: '?', color: '#555', type: 'unknown', shape: 'virtual', order: 1e9 };
}

export function isWildcard(id) {
  return id === EVERYTHING || id === ANYTHING || id === EACH;
}

export function stackSize(id) {
  return SIGNAL_BY_ID.get(id)?.stack ?? 0;
}

/** Sort comparator by catalogue order. */
export function bySignalOrder(a, b) {
  return signalInfo(a).order - signalInfo(b).order;
}
