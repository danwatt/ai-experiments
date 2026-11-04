// Descent 1 wall textures from a DESCENT.PIG. A level side names a texture by number; the
// texture table turns that number into a bitmap in the PIG. The registered PIG carries that
// table itself; the shareware one relies on BITMAPS.BIN (an encoded BITMAPS.TBL) from the HOG.
// Colours come from PALETTE.256 in the HOG. Pure data: no three.js here.

const TMI_VOLATILE = 1;
const TRANSPARENT = 255, SUPER_TRANSPARENT = 254;

// Bitmap directory: { name -> header index }, headers with size/flags/offset, and the data start.
export function parsePig(buf) {
  const dv = new DataView(buf);
  const i0 = dv.getInt32(0, true), i1 = dv.getInt32(4, true);
  // Shareware and 1.0 PIGs start with the bitmap directory; 1.4+ registered ones start with
  // the offset of the directory, and the texture tables sit between.
  const plain = i0 > 0 && i0 < 5000 && i1 >= 0 && i1 < 1000 && 8 + i0 * 17 + i1 * 20 < buf.byteLength;
  const dirAt = plain ? 0 : i0;
  if (!plain && (dirAt <= 0 || dirAt + 8 > buf.byteLength)) throw new Error('Not a Descent 1 PIG file');
  const n = dv.getInt32(dirAt, true), ns = dv.getInt32(dirAt + 4, true);
  if (n <= 0 || n > 5000 || ns < 0 || ns > 1000) throw new Error('Not a Descent 1 PIG file');
  const u8 = new Uint8Array(buf);
  const bitmaps = [], byName = new Map();
  let p = dirAt + 8;
  for (let i = 0; i < n; i++, p += 17) {
    let name = '';
    for (let k = 0; k < 8 && u8[p + k]; k++) name += String.fromCharCode(u8[p + k]);
    const dflags = u8[p + 8];
    const bm = { w: u8[p + 9] + (dflags & 128 ? 256 : 0), h: u8[p + 10], flags: u8[p + 11], ofs: dv.getInt32(p + 13, true) };
    if (dflags & 64) name += '#' + (dflags & 63);
    bitmaps.push(bm);
    byName.set(name.toLowerCase(), i);
  }
  const dataAt = dirAt + 8 + n * 17 + ns * 20;
  let table = null;
  if (!plain) {
    // NumTextures, then Textures[800] (bitmap index + 1) and TmapInfo[800] (26 bytes each).
    const count = dv.getInt32(4, true);
    table = [];
    for (let i = 0; i < Math.min(count, 800); i++) {
      const idx = dv.getUint16(8 + i * 2, true) - 1;
      const flags = u8[8 + 1600 + i * 26 + 13];
      table.push({ bitmap: idx >= 0 && idx < n ? idx : -1, volatile: !!(flags & TMI_VOLATILE) });
    }
  }
  return { buf, u8, bitmaps, byName, dataAt, table };
}

// BITMAPS.BIN is BITMAPS.TBL with every byte xor'd and rotated.
export function decodeTbl(buf) {
  const rl = (c) => ((c << 1) & 0xfe) | ((c >> 7) & 1);
  let s = '';
  for (const c of new Uint8Array(buf)) s += String.fromCharCode(c === 10 || c === 13 ? c : rl(rl(c) ^ 0xd3) & 255);
  return s;
}

// Replay the texture numbering BITMAPS.TBL defines: every bitmap in $TEXTURES, one per
// $ECLIP (plus its destroyed version), and one per frame of each $WCLIP door animation.
// Registered-only ('@') entries still take their number, but have no bitmap in the shareware PIG.
function tableFromTbl(text, pig) {
  const table = [];
  const add = (name) => {
    const idx = pig.byName.get(name.toLowerCase());
    table.push({ name, bitmap: idx === undefined ? -1 : idx, volatile: false });
  };
  let mode = null, clip = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/;.*/, '').replace(/\t/g, ' ').trim();
    if (line[0] === '@') line = line.slice(1);
    if (!line || line[0] === '!') continue;
    let sawBitmap = false;
    for (const tok of line.split(/ +/)) {
      if (tok[0] === '$') { mode = tok.toUpperCase(); clip = {}; continue; }
      const eq = tok.indexOf('=');
      if (eq > 0 || !/\.(bbm|abm)$/i.test(tok)) {
        const key = (eq > 0 ? tok.slice(0, eq) : tok).toLowerCase(), val = eq > 0 ? tok.slice(eq + 1) : '';
        if (sawBitmap) { if (key === 'volatile' && table.length) table[table.length - 1].volatile = true; }
        else clip[key] = val;
        continue;
      }
      sawBitmap = true;
      const base = tok.replace(/\.(bbm|abm)$/i, '');
      if (mode === '$TEXTURES') add(base);
      else if (mode === '$ECLIP') {
        if (clip.obj_eclip !== '1' && !clip.crit_flag) add(base + '#0');
        if (clip.dest_bm) {
          const dest = clip.dest_bm.replace(/\.(bbm|abm)$/i, '');
          if (!table.some(t => t.name.toLowerCase() === dest.toLowerCase())) add(dest);
        }
      } else if (mode === '$WCLIP') {
        let frames = 0;
        while (pig.byName.has(`${base}#${frames}`.toLowerCase())) frames++;
        for (let j = 0; j < Math.max(1, frames); j++) add(`${base}#${j}`);
      }
    }
  }
  return table;
}

// Everything a level needs to texture its faces: which texture numbers exist, which burn,
// and RGBA pixels for a base texture with an optional overlay.
export function createArt(pigBuf, paletteBuf, tblBuf) {
  const pig = parsePig(pigBuf);
  const table = pig.table || (tblBuf ? tableFromTbl(decodeTbl(tblBuf), pig) : null);
  if (!table) throw new Error('This PIG needs BITMAPS.BIN from the HOG; import DESCENT.HOG as well');
  const pal = new Uint8Array(paletteBuf, 0, 768);
  const cache = new Map();
  function pixels(bi) {
    let px = cache.get(bi);
    if (px) return px;
    const bm = pig.bitmaps[bi], u8 = pig.u8;
    px = new Uint8Array(bm.w * bm.h);
    let p = pig.dataAt + bm.ofs;
    if (bm.flags & 8) {
      // RLE: total size, one length byte (or short, for big bitmaps) per row, then the rows.
      const big = bm.flags & 32;
      p += 4;
      let row = p + bm.h * (big ? 2 : 1);
      for (let y = 0; y < bm.h; y++) {
        const len = big ? u8[p + y * 2] | (u8[p + y * 2 + 1] << 8) : u8[p + y];
        let q = row, x = 0;
        while (x < bm.w && q < row + len) {
          const c = u8[q++];
          if ((c & 0xe0) === 0xe0) {
            const n = c & 0x1f;
            if (!n) break;
            const col = u8[q++];
            for (let k = 0; k < n && x < bm.w; k++) px[y * bm.w + x++] = col;
          } else px[y * bm.w + x++] = c;
        }
        row += len;
      }
    } else px.set(u8.subarray(p, p + bm.w * bm.h));
    cache.set(bi, px);
    return px;
  }
  const bitmapOf = (t) => (t >= 0 && t < table.length ? table[t].bitmap : -1);
  return {
    count: table.length,
    has: (t) => bitmapOf(t) >= 0,
    volatile: (t) => t >= 0 && t < table.length && table[t].volatile,
    name: (t) => (table[t] && table[t].name) || `#${t}`,
    // Base texture t1 with overlay t2 (low 14 bits texture, top 2 bits rotation) merged the
    // way the game does: overlay colour 255 shows the base, 254 punches a hole.
    rgba(t1, t2 = 0) {
      const bi = bitmapOf(t1);
      if (bi < 0) return null;
      const { w, h } = pig.bitmaps[bi];
      const base = pixels(bi);
      const oi = t2 ? bitmapOf(t2 & 0x3fff) : -1;
      const top = oi >= 0 && pig.bitmaps[oi].w === w && pig.bitmaps[oi].h === h ? pixels(oi) : null;
      const rot = (t2 >> 14) & 3;
      const out = new Uint8Array(w * h * 4);
      let alpha = false;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let c = base[y * w + x];
        if (top) {
          const tc = top[rot === 0 ? y * w + x : rot === 1 ? x * w + (w - 1 - y) : rot === 2 ? (h - 1 - y) * w + (w - 1 - x) : (h - 1 - x) * w + y];
          if (tc === SUPER_TRANSPARENT) c = TRANSPARENT;
          else if (tc !== TRANSPARENT) c = tc;
        }
        const o = (y * w + x) * 4;
        if (c === TRANSPARENT || c === SUPER_TRANSPARENT) { alpha = true; continue; }
        out[o] = pal[c * 3] * 255 / 63; out[o + 1] = pal[c * 3 + 1] * 255 / 63; out[o + 2] = pal[c * 3 + 2] * 255 / 63; out[o + 3] = 255;
      }
      return { data: out, w, h, alpha };
    },
  };
}
