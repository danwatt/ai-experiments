// Generates src/gfx.inc: tile graphics, cell layout and move tables for the
// hex 2048 ROM. Run: node tools/gen.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- font (5x7)
const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
  // arrows used on the title screen: [ = NW, \ = NE, ] = SW, ^ = SE
  '[': ['11110', '11000', '10100', '10010', '00001', '00000', '00000'],
  '\\': ['01111', '00011', '00101', '01001', '10000', '00000', '00000'],
  ']': ['00000', '00000', '00001', '10010', '10100', '11000', '11110'],
  '^': ['00000', '00000', '10000', '01001', '00101', '00011', '01111'],
};

// ---------------------------------------------------------------- palette
// Shades are DMG color indices with BGP = %11100100: 0 lightest, 3 darkest.
const BG = 3;
const UI_TEXT = 0;

// Tile appearance per exponent (0 = empty slot). band = decoration for the
// top/bottom thirds: null, 'dots', 'check', 'stripe'.
const STYLES = [
  { fill: 2, ring: 2, text: 0, band: null },          // empty
  { fill: 0, ring: 0, text: 3, band: null },          // 2
  { fill: 0, ring: 1, text: 3, band: null },          // 4
  { fill: 1, ring: 1, text: 3, band: null },          // 8
  { fill: 1, ring: 0, text: 3, band: null },          // 16
  { fill: 1, ring: 0, text: 3, band: 'dots', deco: 0 }, // 32
  { fill: 2, ring: 0, text: 0, band: null },          // 64
  { fill: 2, ring: 1, text: 0, band: 'dots', deco: 0 }, // 128
  { fill: 3, ring: 1, text: 0, band: null },          // 256
  { fill: 3, ring: 0, text: 0, band: 'dots', deco: 1 }, // 512
  { fill: 3, ring: 0, text: 0, band: 'stripe', deco: 2 }, // 1024
  { fill: 0, ring: 3, text: 3, band: 'check', deco: 1, ring2: 0 }, // 2048
  { fill: 1, ring: 3, text: 3, band: 'check', deco: 0, ring2: 1 }, // 4096
  { fill: 2, ring: 0, text: 0, band: 'check', deco: 3, ring2: 2 }, // 8192
  { fill: 3, ring: 0, text: 0, band: 'check', deco: 2, ring2: 3 }, // 16384
  { fill: 0, ring: 3, text: 3, band: 'stripe', deco: 2, ring2: 0 }, // 32768
  { fill: 1, ring: 3, text: 3, band: 'stripe', deco: 3, ring2: 1 }, // 65536
  { fill: 3, ring: 0, text: 0, band: 'stripe', deco: 1, ring2: 3 }, // 131072
];
const MAX_EXP = STYLES.length - 1;

function label(e) {
  if (e === 0) return '';
  const v = 2 ** e;
  if (v < 10000) return String(v);
  return Math.floor(v / 1024) + 'K';
}

// ---------------------------------------------------------------- cell image
const CW = 32, CH = 24, TIP = 6;
function insideHex(x, y, shrink = 0) {
  const px = x + 0.5, py = y + 0.5;
  const dx = Math.abs(px - 16);
  const half = 15 - shrink;
  let allowed;
  if (py < TIP + shrink) allowed = half * Math.max(0, (py - shrink) / TIP);
  else if (py > CH - TIP - shrink) allowed = half * Math.max(0, (CH - py - shrink) / TIP);
  else allowed = half;
  if (py < shrink || py > CH - shrink) return false;
  return dx <= allowed + 0.01;
}

function cellImage(e) {
  const st = STYLES[e];
  const img = Array.from({ length: CH }, () => new Array(CW).fill(BG));
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (!insideHex(x, y)) continue;
      let c = st.fill;
      const inner1 = insideHex(x, y, 1.2);
      const inner2 = insideHex(x, y, 2.4);
      if (!inner1) c = st.ring;
      else if (st.ring2 !== undefined && !inner2) c = st.ring2;
      else if (st.band && (y < 8 || y >= 16) && insideHex(x, y, 3.5)) {
        const band = st.band;
        if (band === 'dots' && x % 4 === 1 && (y % 4 === 1)) c = st.deco;
        if (band === 'check' && (x + y) % 2 === 0) c = st.deco;
        if (band === 'stripe' && (x + y) % 4 === 0) c = st.deco;
      }
      img[y][x] = c;
    }
  }
  const s = label(e);
  const w = s.length * 6 - 1;
  let x0 = Math.floor((CW - w) / 2);
  for (const ch of s) {
    const g = FONT[ch];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === '1') img[9 + r][x0 + c] = st.text;
    x0 += 6;
  }
  return img;
}

// ---------------------------------------------------------------- tiles
function encodeTile(pix) { // pix: 8x8 array of color idx -> 16 bytes 2bpp
  const out = [];
  for (let y = 0; y < 8; y++) {
    let lo = 0, hi = 0;
    for (let x = 0; x < 8; x++) {
      const c = pix[y][x];
      lo |= (c & 1) << (7 - x);
      hi |= ((c >> 1) & 1) << (7 - x);
    }
    out.push(lo, hi);
  }
  return out;
}

const tiles = new Array(256).fill(null);
tiles[0] = encodeTile(Array.from({ length: 8 }, () => new Array(8).fill(BG)));
for (let code = 32; code < 96; code++) {
  const ch = String.fromCharCode(code);
  const pix = Array.from({ length: 8 }, () => new Array(8).fill(BG));
  const g = FONT[ch];
  if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') pix[r][c + 1] = UI_TEXT;
  tiles[code] = encodeTile(pix);
}

const tileIndex = new Map();
tiles.forEach((t, i) => { if (t && !tileIndex.has(t.join())) tileIndex.set(t.join(), i); });
const freeIds = [];
for (let i = 96; i < 256; i++) freeIds.push(i);
for (let i = 1; i < 32; i++) freeIds.push(i);

function tileId(pix) {
  const t = encodeTile(pix);
  const k = t.join();
  if (tileIndex.has(k)) return tileIndex.get(k);
  const id = freeIds.shift();
  if (id === undefined) throw new Error('out of tile ids');
  tiles[id] = t;
  tileIndex.set(k, id);
  return id;
}

const cellTiles = [];
for (let e = 0; e <= MAX_EXP; e++) {
  const img = cellImage(e);
  const ids = [];
  for (let ty = 0; ty < 3; ty++)
    for (let tx = 0; tx < 4; tx++)
      ids.push(tileId(img.slice(ty * 8, ty * 8 + 8).map(row => row.slice(tx * 8, tx * 8 + 8))));
  cellTiles.push(ids);
}
const lastTile = tiles.reduce((m, t, i) => (t ? i : m), 0);
console.log(`tiles used: ${tiles.filter(Boolean).length}, highest id ${lastTile}`);

// ---------------------------------------------------------------- board
// Pointy-top hex board of radius 2 in axial coords (q, r), row-major order.
const cells = [];
for (let r = -2; r <= 2; r++)
  for (let q = -2; q <= 2; q++)
    if (Math.abs(q) <= 2 && Math.abs(r) <= 2 && Math.abs(q + r) <= 2) cells.push([q, r]);
const indexOf = (q, r) => cells.findIndex(([a, b]) => a === q && b === r);

// Directions: 0 E, 1 W, 2 NE, 3 NW, 4 SE, 5 SW
const DIRS = [[1, 0], [-1, 0], [1, -1], [0, -1], [0, 1], [-1, 1]];

const cellVram = cells.map(([q, r]) => {
  const col = 4 * q + 2 * r + 8;
  const row = 3 * (r + 2) + 3;
  return 0x9800 + row * 32 + col;
});

const lineTable = [];
for (const [dq, dr] of DIRS) {
  const bytes = [];
  for (const [q, r] of cells) {
    if (indexOf(q + dq, r + dr) !== -1) continue; // not a front cell
    const line = [];
    let cq = q, cr = r;
    while (indexOf(cq, cr) !== -1) { line.push(indexOf(cq, cr)); cq -= dq; cr -= dr; }
    bytes.push(line.length, ...line);
  }
  if (bytes.length !== 24) throw new Error('bad line table');
  lineTable.push(bytes);
}

const pairs = [];
cells.forEach(([q, r], i) => {
  for (const [dq, dr] of [DIRS[0], DIRS[4], DIRS[5]]) {
    const j = indexOf(q + dq, r + dr);
    if (j !== -1) pairs.push(i, j);
  }
});

const bcd = n => {
  const s = String(n).padStart(8, '0');
  const out = [];
  for (let i = 6; i >= 0; i -= 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
};

// Rising pentatonic scale for merge sounds, starting at C5.
const PENTA = [0, 2, 4, 7, 9];
const mergeFreq = [];
for (let e = 0; e <= MAX_EXP; e++) {
  const step = Math.max(0, e - 1);
  const semis = Math.floor(step / 5) * 12 + PENTA[step % 5];
  const hz = 523.25 * 2 ** (semis / 12);
  mergeFreq.push(Math.min(2047, Math.round(2048 - 131072 / hz)));
}

// ---------------------------------------------------------------- output
const hex = b => '$' + b.toString(16).toUpperCase().padStart(2, '0');
const hex16 = w => '$' + w.toString(16).toUpperCase().padStart(4, '0');
const rows = (arr, per, fmt = hex) => {
  const out = [];
  for (let i = 0; i < arr.length; i += per) out.push('    db ' + arr.slice(i, i + per).map(fmt).join(', '));
  return out.join('\n');
};

let tileBytes = [];
for (let i = 0; i <= lastTile; i++) tileBytes = tileBytes.concat(tiles[i] || new Array(16).fill(0));

const out = `; Generated by tools/gen.mjs - do not edit.

DEF NUM_CELLS EQU ${cells.length}
DEF NUM_PAIRS EQU ${pairs.length / 2}
DEF MAX_EXP EQU ${MAX_EXP}

SECTION "Generated data", ROM0

; 2bpp tile data, loaded at $8000 (tile id 0..${lastTile})
TileData:
${rows(tileBytes, 16)}
TileDataEnd:

; 12 tile ids (4 wide x 3 tall) per exponent 0..MAX_EXP
CellTiles:
${cellTiles.map(ids => '    db ' + ids.map(hex).join(', ')).join('\n')}

; BG map address of each cell's top-left tile
CellVram:
${cells.map((_, i) => '    dw ' + hex16(cellVram[i])).join('\n')}

; Per direction (E, W, NE, NW, SE, SW): five lines of [length, cells...],
; each listed from the cell furthest along the direction backwards.
LineTable:
${lineTable.map(b => '    db ' + b.join(', ')).join('\n')}

; Every pair of adjacent cells
NeighborPairs:
${rows(pairs, 12, String)}

; 2^e as 4-byte little-endian BCD
ScoreBCD:
${Array.from({ length: MAX_EXP + 1 }, (_, e) => '    db ' + (e ? bcd(2 ** e) : [0, 0, 0, 0]).map(hex).join(', ')).join('\n')}

; Channel 1 frequency per merged exponent
MergeFreq:
${mergeFreq.map(f => '    dw ' + hex16(f)).join('\n')}
`;
writeFileSync(join(root, 'src/gfx.inc'), out);
console.log('wrote src/gfx.inc');
