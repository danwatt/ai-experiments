// Descent 1 level import. Reads the level files (.RDL, or shareware .SDL) out of a DESCENT.HOG
// archive and turns their segments into the same cell/face/door structure the lattice
// builder in level.js produces, so the rest of the game runs on them unchanged.
// Geometry, baked vertex light, doors, triggers and object placements come from the level.
// A level only numbers its textures, so faces get the real bitmaps when a PIG has been
// imported too (see pig.js) and this game's procedural textures otherwise.
// Pure math: no three.js here, so it can be checked from node.

import { S, ckey, makeTri, createPhysics } from './level.js';

const FIX = 1 / 65536;
const K = S / 20;                    // a standard Descent segment is 20 units on a side

// Corner indices of each side of a segment: left, top, right, bottom, back, front.
const SIDE_VERTS = [[7, 6, 2, 3], [0, 4, 7, 3], [0, 1, 5, 4], [2, 6, 5, 1], [4, 5, 6, 7], [3, 2, 1, 0]];

const WALL = { NORMAL: 0, BLASTABLE: 1, DOOR: 2, ILLUSION: 3, OPEN: 4, CLOSED: 5 };
const WALL_DOOR_LOCKED = 8;
const KEY_BITS = [[2, 'blue'], [8, 'yellow'], [4, 'red']];
const TRIGGER_EXIT = 8;
const OBJ = { ROBOT: 2, PLAYER: 4, POWERUP: 7, CNTRLCEN: 9 };

// Descent 1 robot ids to the closest robot in this game. Best effort: close-range brawlers
// become leeches, heavies brutes, turrets sentries, small fast ones wasps, cloakers phantoms.
const ROBOTS = [
  'brute', 'leech', 'wasp', 'drone', 'drone', 'phantom', 'phantom', 'warden', 'leech', 'brute', 'minelayer', 'sentry',
  'sentry', 'wasp', 'wasp', 'brute', 'brute', 'overseer', 'phantom', 'drone', 'brute', 'leech', 'warden', 'overseer',
];
// Descent 1 powerup ids to pickups this game has. Anything else is dropped.
const POWERUPS = {
  0: 'shield', 2: 'shield', 10: 'missiles', 11: 'missiles', 13: 'spread', 14: 'spread', 15: 'plasma', 16: 'fusion',
  17: 'missiles', 18: 'missiles', 19: 'missiles', 20: 'missiles', 21: 'missiles', 23: 'overdrive', 25: 'overdrive',
};
const KEY_POWERUPS = { 4: 'blue', 5: 'red', 6: 'yellow' };
// Texture ids are only numbers without the PIG file, so each id is hashed onto a fixed pick of
// this game's textures. Faces sharing a Descent texture still share a look.
const TEXTURES = ['rock', 'rock', 'rock', 'metal', 'metal', 'tech', 'panel', 'grate', 'floor', 'pipes', 'lavarock', 'hazard'];
const texFor = (tmap) => TEXTURES[(Math.imul(tmap + 1, 2654435761) >>> 0) % TEXTURES.length];

class Reader {
  constructor(buf, pos = 0) { this.dv = new DataView(buf); this.u8 = new Uint8Array(buf); this.p = pos; }
  u8_() { return this.dv.getUint8(this.p++); }
  i8() { return this.dv.getInt8(this.p++); }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  fix() { return this.i32() * FIX; }
  vec() { return [this.fix(), this.fix(), this.fix()]; }
  skip(n) { this.p += n; }
  str(n) { let s = ''; for (let i = 0; i < n; i++) { const c = this.u8[this.p + i]; if (!c) break; s += String.fromCharCode(c); } this.p += n; return s; }
}

// ---------------------------------------------------------------- archives
const sig = (buf, n) => String.fromCharCode(...new Uint8Array(buf, 0, Math.min(n, buf.byteLength)));

// The files in a HOG archive as [{ name, data }], or null if it is not one.
export function readHog(buf) {
  if (sig(buf, 3) !== 'DHF') return null;
  const files = [];
  const r = new Reader(buf, 3);
  while (r.p + 17 <= buf.byteLength) {
    const name = r.str(13), len = r.i32();
    if (len < 0 || r.p + len > buf.byteLength) break;
    files.push({ name, data: buf.slice(r.p, r.p + len) });
    r.skip(len);
  }
  return files;
}

// Pull the level files out of a HOG archive (or accept a bare level file). Returns
// [{ name, data }] in level order, or throws if nothing usable is found.
export function extractLevels(buf, fileName = 'level.rdl') {
  let files = readHog(buf);
  if (!files) {
    if (sig(buf, 4) !== 'LVLP') throw new Error('Not a Descent HOG or level file');
    files = [{ name: fileName, data: buf }];
  }
  const levels = files.filter(f => /\.(rdl|sdl)$/i.test(f.name) && sig(f.data, 4) === 'LVLP');
  if (!levels.length) throw new Error('No Descent 1 levels (.RDL / .SDL) in that file');
  // level01..level27, then the secret levels (levels1..)
  return levels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en', { numeric: true }));
}

// ---------------------------------------------------------------- level file
export function parseLevel(buf) {
  const r = new Reader(buf);
  if (r.str(4) !== 'LVLP') throw new Error('Missing LVLP signature');
  const version = r.i32(), mineOfs = r.i32(), gameOfs = r.i32();
  if (version > 1) throw new Error(`Level version ${version} is not Descent 1`);

  // ---- mine: vertices and segments
  r.p = mineOfs;
  r.skip(1);                                   // compiled mine version
  // Shareware (.SDL) mines predate the compact format: int counts, no child/wall bitmasks,
  // and every textured side stores its overlay texture.
  const old = r.dv.getUint16(r.p + 2, true) === 0;
  const nv = old ? r.i32() : r.u16(), ns = old ? r.i32() : r.u16();
  const verts = new Float64Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) verts[i] = r.fix();
  const segs = [];
  for (let s = 0; s < ns; s++) {
    const seg = { children: [], verts: [], walls: [], sides: [], special: 0, matcen: -1, light: 0 };
    const mask = old ? 0x7f : r.u8_();
    for (let i = 0; i < 6; i++) seg.children.push(mask & (1 << i) ? r.i16() : -1);
    for (let i = 0; i < 8; i++) seg.verts.push(r.u16());
    if (mask & 64) { seg.special = r.u8_(); seg.matcen = r.i8(); r.skip(2); }
    seg.light = (r.u16() << 4) * FIX;
    const wmask = old ? 0x3f : r.u8_();
    for (let i = 0; i < 6; i++) { const w = wmask & (1 << i) ? r.u8_() : 255; seg.walls.push(w === 255 ? -1 : w); }
    for (let i = 0; i < 6; i++) {
      const side = { tmap: 0, tmap2: 0, uvl: null };
      if (seg.children[i] === -1 || seg.walls[i] !== -1) {
        const t = r.u16();
        side.tmap = t & 0x7fff;
        if (old || t & 0x8000) side.tmap2 = r.u16();
        side.uvl = [];
        for (let k = 0; k < 4; k++) side.uvl.push([r.i16() / 2048, r.i16() / 2048, r.u16() / 32768]);
      }
      seg.sides.push(side);
    }
    if (seg.verts.some(v => v >= nv)) throw new Error(`Segment ${s} points past the vertex list`);
    segs.push(seg);
  }

  // ---- game data: header, then objects, walls, triggers and the reactor's door list
  r.p = gameOfs;
  if (r.u16() !== 0x6705) throw new Error('Bad game data signature');
  const gver = r.u16(), gsize = r.i32();
  r.skip(15 + 4);                              // mine file name, level number
  r.skip(8);                                   // player offset/size
  const table = () => ({ ofs: r.i32(), n: r.i32(), size: r.i32() });
  const T = { objects: table(), walls: table(), doors: table(), triggers: table(), links: table(), control: table(), matcens: table() };
  let name = '';
  if (gver >= 14) {
    r.p = gameOfs + gsize;
    while (name.length < 40 && r.p < buf.byteLength) { const c = r.u8_(); if (c === 0 || c === 10) break; name += String.fromCharCode(c); }
  }
  // Offsets inside the game data are file positions; fall back to treating them as relative.
  let objects = readObjects(buf, T.objects.ofs, T.objects.n, gver, ns), base = 0;
  if (!objects) { objects = readObjects(buf, gameOfs + T.objects.ofs, T.objects.n, gver, ns); base = gameOfs; }
  if (!objects) throw new Error('Could not read the object list');

  const walls = [];
  if (T.walls.n > 0) {
    r.p = T.walls.ofs + base;
    for (let i = 0; i < T.walls.n; i++) {
      const at = r.p, w = {};
      if (gver >= 20) {
        w.seg = r.i32(); w.side = r.i32(); r.skip(4); r.skip(4);   // hit points, linked wall
        w.type = r.u8_(); w.flags = r.u8_(); r.skip(1); w.trigger = r.i8(); r.skip(1); w.keys = r.u8_();
      } else {
        w.seg = r.i32(); w.side = r.i32(); w.type = r.u8_(); w.flags = r.u8_(); r.skip(4);
        w.trigger = r.i8(); r.skip(1); w.keys = r.u8_();
      }
      walls.push(w);
      r.p = at + (T.walls.size || (gver >= 20 ? 24 : 21));
    }
  }
  const triggers = [];
  if (T.triggers.n > 0) {
    r.p = T.triggers.ofs + base;
    for (let i = 0; i < T.triggers.n; i++) {
      const at = r.p;
      r.skip(1);
      const t = { flags: r.i16() };
      r.skip(9);
      const n = r.i16(), seg = [], side = [];
      for (let k = 0; k < 10; k++) seg.push(r.i16());
      for (let k = 0; k < 10; k++) side.push(r.i16());
      t.links = seg.slice(0, Math.max(0, Math.min(10, n))).map((sg, k) => [sg, side[k]]);
      triggers.push(t);
      r.p = at + (T.triggers.size || 54);
    }
  }
  // Doors the reactor (or boss) opens when it dies: the exit doors.
  const exitDoors = [];
  if (T.control.n > 0) {
    r.p = T.control.ofs + base;
    const n = r.i16(), seg = [], side = [];
    for (let k = 0; k < 10; k++) seg.push(r.i16());
    for (let k = 0; k < 10; k++) side.push(r.i16());
    for (let k = 0; k < Math.min(10, n); k++) exitDoors.push([seg[k], side[k]]);
  }
  return { version, gameVersion: gver, name: name.trim(), verts, segs, objects, walls, triggers, exitDoors };
}

// Objects are variable-length records, so the list is read straight through. Returns null if
// the records stop making sense, which means the start offset was wrong.
function readObjects(buf, ofs, n, gver, ns) {
  if (ofs < 0 || ofs >= buf.byteLength) return null;
  const r = new Reader(buf, ofs), list = [];
  try {
    for (let i = 0; i < n; i++) {
      const o = { type: r.u8_(), id: r.u8_() };
      const ctype = r.u8_(), mtype = r.u8_(), rtype = r.u8_();
      r.skip(1);                               // flags
      o.seg = r.i16();
      o.pos = r.vec();
      o.orient = [r.vec(), r.vec(), r.vec()];  // right, up, forward
      r.skip(4 + 4 + 12);                      // size, shields, last position
      o.contains = [r.u8_(), r.u8_(), r.u8_()];
      if (o.type > 14 || o.seg < -1 || o.seg >= ns || ctype > 16 || mtype > 3 || rtype > 7) return null;
      if (mtype === 1) r.skip(64);             // physics
      else if (mtype === 3) r.skip(12);        // spinning
      if (ctype === 1) r.skip(24);             // AI
      else if (ctype === 2) r.skip(10);        // explosion
      else if (ctype === 9) r.skip(8);         // weapon
      else if (ctype === 14) r.skip(4);        // light
      else if (ctype === 13 && gver >= 25) r.skip(4);   // powerup count
      if (rtype === 1 || rtype === 6) r.skip(72);       // polygon model
      else if (rtype === 2 || rtype === 4 || rtype === 5 || rtype === 7) r.skip(9);   // vclip
      list.push(o);
    }
  } catch (err) { return null; }               // ran off the end of the file
  return list;
}

// ---------------------------------------------------------------- engine level
const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const avg = (pts) => [0, 1, 2].map(a => pts.reduce((s, p) => s + p[a], 0) / pts.length);

// `art` (from pig.js) gives faces their real Descent textures; without it they get this
// game's procedural ones.
export function buildDescentLevel(d, info = {}, art = null) {
  // Descent is left-handed with z forward; flip z for three.js and centre the mine on the origin.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.verts.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], d.verts[i + a]); hi[a] = Math.max(hi[a], d.verts[i + a]); }
  const mid = [0, 1, 2].map(a => (lo[a] + hi[a]) / 2);
  const W = (v) => [(v[0] - mid[0]) * K, (v[1] - mid[1]) * K, -(v[2] - mid[2]) * K];
  const dirW = (v) => [v[0], v[1], -v[2]];
  const latPos = new Map();
  for (let i = 0; i < d.verts.length / 3; i++) latPos.set(i, W([d.verts[i * 3], d.verts[i * 3 + 1], d.verts[i * 3 + 2]]));

  const wallAt = (s, side) => { const w = d.segs[s].walls[side]; return w >= 0 && w < d.walls.length ? d.walls[w] : null; };
  const exitDoorSet = new Set(d.exitDoors.map(([s, side]) => s * 8 + side));

  // ---- cells
  const cells = d.segs.map((seg, idx) => {
    const corners = seg.verts.map(v => latPos.get(v));
    return { idx, seg, corners, center: avg(corners), nbr: [], doors: [null, null, null, null, null, null], faces: [], planes: [], region: null };
  });
  for (const c of cells) for (let i = 0; i < 6; i++) { const ch = c.seg.children[i]; c.nbr[i] = ch >= 0 && ch < cells.length ? cells[ch] : null; }
  const backSide = (c, i) => { const nb = c.nbr[i]; return nb ? nb.seg.children.indexOf(c.idx) : -1; };

  // What each side is: an open portal, a door, a solid wall, or an illusion (drawn, fly-through).
  const kindOf = (c, i) => {
    if (!c.nbr[i] || backSide(c, i) < 0) return 'wall';
    const w = wallAt(c.idx, i);
    if (!w) return 'open';
    if (w.type === WALL.DOOR || w.type === WALL.BLASTABLE) return 'door';
    if (w.type === WALL.CLOSED) return 'wall';
    if (w.type === WALL.ILLUSION) return 'illusion';
    return 'open';
  };
  const doorType = (c, i) => {
    const w = wallAt(c.idx, i), nb = c.nbr[i], bs = backSide(c, i), w2 = wallAt(nb.idx, bs);
    if (exitDoorSet.has(c.idx * 8 + i) || exitDoorSet.has(nb.idx * 8 + bs)) return 'exit';
    for (const [bit, k] of KEY_BITS) if ((w && w.keys & bit) || (w2 && w2.keys & bit)) return k;
    if (((w && w.flags) | (w2 && w2.flags)) & WALL_DOOR_LOCKED && !d.exitDoors.length) return 'exit';
    return 'normal';
  };

  const doors = [];
  for (const c of cells) {
    for (let i = 0; i < 6; i++) {
      const L = SIDE_VERTS[i].map(k => c.seg.verts[k]);
      const pos = L.map(v => latPos.get(v));
      const centroid = avg(pos);
      let n = norm(cross(sub(pos[2], pos[0]), sub(pos[3], pos[1])));
      if (dot(n, sub(c.center, centroid)) < 0) n = [-n[0], -n[1], -n[2]];
      const kind = kindOf(c, i);
      const face = { cell: c, dir: i, type: kind === 'illusion' ? 'open' : kind, kind, door: null, lat: L, pos, centroid, normal: n, lava: false, side: c.seg.sides[i] };
      c.faces[i] = face;
      c.planes.push({ p: centroid, n });
      if (kind === 'door') {
        const nb = c.nbr[i], bs = backSide(c, i);
        let door = nb.doors[bs];
        if (!door) {
          const flip = dot(cross(sub(pos[1], pos[0]), sub(pos[2], pos[0])), n) < 0;
          door = { id: doors.length, type: doorType(c, i), oneway: false, a: c, b: nb, dir: i, corners: pos, normal: n, flip, lat: L, centroid };
          doors.push(door);
        }
        c.doors[i] = door; face.door = door;
      }
    }
  }

  // ---- rooms: segments joined by open sides, split up by doors and walls
  const regions = [];
  for (const c of cells) {
    if (c.region) continue;
    const r = { id: regions.length, name: '', sector: 1, theme: {}, corridor: false, cells: [], lights: [], relLights: [] };
    regions.push(r);
    const q = [c]; c.region = r;
    while (q.length) {
      const x = q.pop(); r.cells.push(x);
      for (let i = 0; i < 6; i++) if (x.faces[i].type === 'open' && x.nbr[i] && !x.nbr[i].region) { x.nbr[i].region = r; q.push(x.nbr[i]); }
    }
    r.corridor = r.cells.length < 4;
  }

  // ---- objects
  const start = { pos: [0, 0, 0], yaw: 0 };
  const enemies = [], pickups = [], keys = {};
  let reactor = null, haveStart = false;
  const objPos = (o) => W(o.pos);
  for (const o of d.objects) {
    if (o.type === OBJ.PLAYER && !haveStart) {
      haveStart = true;
      start.pos = objPos(o);
      const [rv, uv, fv] = o.orient.map(dirW);
      start.basis = [rv, uv, [-fv[0], -fv[1], -fv[2]]];
    } else if (o.type === OBJ.ROBOT) enemies.push([ROBOTS[o.id] || 'drone', objPos(o)]);
    else if (o.type === OBJ.CNTRLCEN && !reactor) reactor = { pos: objPos(o) };
    else if (o.type === OBJ.POWERUP) {
      if (KEY_POWERUPS[o.id]) { if (!keys[KEY_POWERUPS[o.id]]) keys[KEY_POWERUPS[o.id]] = objPos(o); }
      else if (POWERUPS[o.id]) pickups.push([POWERUPS[o.id], objPos(o)]);
    }
  }
  if (!haveStart) start.pos = [...cells[0].center];
  const boss = enemies.some(([t]) => t === 'overseer');
  if (boss) reactor = null;              // boss levels are won by the boss, not the reactor

  // ---- exit: the segment past the trigger that ends the level
  const exitCellRefs = new Set();
  for (const w of d.walls) {
    if (w.trigger < 0 || w.trigger >= d.triggers.length || !(d.triggers[w.trigger].flags & TRIGGER_EXIT)) continue;
    const c = cells[w.seg];
    if (!c) continue;
    exitCellRefs.add(c.nbr[w.side] || c);
  }
  for (const c of cells) if (c.seg.children.includes(-2)) exitCellRefs.add(c);

  // ---- sectors: which key you need to reach each room, from the start room outwards
  const startCell = findCellIn(cells, start.pos);
  const order = ['blue', 'yellow', 'red'].filter(k => keys[k] || doors.some(dr => dr.type === k));
  const allowed = new Set(['normal', 'exit']);
  const reached = new Set();
  let sector = 1;
  const spread = (seeds) => {
    const q = [...seeds];
    while (q.length) {
      const r = q.pop();
      for (const c of r.cells) for (let i = 0; i < 6; i++) {
        const nb = c.nbr[i];
        if (!nb || reached.has(nb.region)) continue;
        if (c.faces[i].type === 'wall') continue;
        if (c.doors[i] && !allowed.has(c.doors[i].type)) continue;
        reached.add(nb.region); nb.region.sector = sector; q.push(nb.region);
      }
    }
  };
  const r0 = (startCell || cells[0]).region;
  reached.add(r0); spread([r0]);
  for (const k of order) { allowed.add(k); sector = Math.min(4, sector + 1); spread([...reached]); }
  for (const r of regions) if (!reached.has(r)) r.sector = sector;
  // Room names for the HUD: what the room is for when it is special, else a zone number.
  const specials = { 1: 'Energy Center', 3: reactor ? 'Reactor Chamber' : null, 4: 'Robot Factory' };
  let zone = 0;
  for (const r of regions) {
    // A special segment names its room only when it is a real part of it, not one cell of a big area.
    const sp = r.cells.length <= 40 ? r.cells.map(c => specials[c.seg.special]).find(Boolean) : null;
    r.name = r.cells.some(c => exitCellRefs.has(c)) ? 'Exit Tunnel' : sp || (r.corridor ? 'Passage' : `Zone ${++zone}`);
  }
  const reactorCell = reactor && findCellIn(cells, reactor.pos);
  if (reactorCell) reactorCell.region.name = 'Reactor Chamber';

  // ---- render groups and collision triangles
  const groups = {};
  const tris = [];
  const grp = (t) => groups[t] || (groups[t] = { pos: [], nrm: [], uv: [], light: [], idx: [] });
  // Real textures already carry their own colour, so their light stays close to the level's;
  // the ship's headlight adds on top.
  const lightOf = art ? (l) => [l * 0.8, l * 0.8, l * 0.8] : (l) => [l * 1.15, l * 1.1, l * 1.0];
  // Real textures are keyed "d1:<base>:<overlay>"; the game builds them from level.art.
  const realTex = (side) => (art && art.has(side.tmap) ? `d1:${side.tmap}:${art.has(side.tmap2 & 0x3fff) ? side.tmap2 : 0}` : null);
  for (const c of cells) {
    let sum = 0, cnt = 0;
    for (const f of c.faces) {
      if (f.side.uvl) for (const u of f.side.uvl) { sum += u[2]; cnt++; }
      if (f.kind !== 'wall' && f.kind !== 'illusion') continue;
      const uvl = f.side.uvl || [[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]];
      const bright = uvl.reduce((s, u) => s + u[2], 0) / 4;
      f.tex = realTex(f.side) || (f.side.tmap2 && bright > 0.8 ? 'light' : texFor(f.side.tmap));
      f.lava = !!art && f.kind === 'wall' && (art.volatile(f.side.tmap) || art.volatile(f.side.tmap2 & 0x3fff));
      const real = f.tex.startsWith('d1:');
      const g = grp(f.tex);
      const base = g.pos.length / 3;
      for (let k = 0; k < 4; k++) {
        const p = f.pos[k];
        g.pos.push(p[0], p[1], p[2]);
        g.nrm.push(f.normal[0], f.normal[1], f.normal[2]);
        g.uv.push(uvl[k][0], real ? uvl[k][1] : -uvl[k][1]);
        const lv = f.tex === 'light' ? [1.1, 1.08, 1.0] : lightOf(uvl[k][2]);
        g.light.push(lv[0], lv[1], lv[2]);
      }
      for (const [a, b, e] of [[0, 1, 2], [0, 2, 3]]) {
        const pa = f.pos[a], pb = f.pos[b], pe = f.pos[e];
        const cr = cross(sub(pb, pa), sub(pe, pa));
        if (len(cr) < 1e-6) continue;
        let tn = norm(cr);
        const facing = dot(tn, sub(c.center, pa)) >= 0;
        if (!facing) tn = [-tn[0], -tn[1], -tn[2]];
        if (facing) g.idx.push(base + a, base + b, base + e); else g.idx.push(base + a, base + e, base + b);
        if (f.kind === 'wall') tris.push(makeTri(pa, pb, pe, tn, f.lava));
      }
    }
    c.light = cnt ? sum / cnt : c.seg.light;
  }
  for (const door of doors) {
    const p = door.corners;
    door.tris = [makeTri(p[0], p[1], p[2], door.normal, false, door), makeTri(p[0], p[2], p[3], door.normal, false, door)];
    tris.push(...door.tris);
    door.solid = true;
    const l = Math.max(door.a.light, door.b.light);
    door.light = [l + 0.15, l + 0.15, l + 0.15];
    door.tex = realTex(door.a.faces[door.dir].side);
    // Turn the corner list so the door art sits the way the level maps it: the door code
    // textures corners 0..3 as (0,0) (1,0) (1,1) (0,1).
    const uvl = door.a.faces[door.dir].side.uvl;
    if (door.tex && uvl) {
      const want = [[0, 0], [1, 0], [1, 1], [0, 1]];
      let best = null, bestErr = Infinity;
      for (const flip of [false, true]) for (let r = 0; r < 4; r++) {
        const order = [0, 1, 2, 3].map(k => (flip ? (4 - k + r) : (k + r)) % 4);
        const u0 = uvl[order[0]];
        const err = order.reduce((e, o, k) => e + Math.hypot(uvl[o][0] - u0[0] - want[k][0], uvl[o][1] - u0[1] - want[k][1]), 0);
        if (err < bestErr) { bestErr = err; best = order; }
      }
      door.corners = best.map(o => door.corners[o]);
    }
  }

  const { collideSphere, raycast, distToTri2 } = createPhysics(tris);
  const grid = cellGrid(cells);
  const findCell = (p, hint) => {
    if (hint) {
      if (inside(hint, p)) return hint;
      for (const nb of hint.nbr) if (nb && inside(nb, p)) return nb;
    }
    const list = grid.get(ckey(Math.floor(p.x / S), Math.floor(p.y / S), Math.floor(p.z / S)));
    if (!list) return hint || null;
    let best = null, bd = Infinity;
    for (const c of list) {
      if (inside(c, p)) return c;
      const dd = (p.x - c.center[0]) ** 2 + (p.y - c.center[1]) ** 2 + (p.z - c.center[2]) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    return best || hint || null;
  };
  const sampleLight = (p, cell, out = [0, 0, 0]) => { const l = 0.06 + (cell ? cell.light : 0.3) * 0.9; out[0] = l * 1.05; out[1] = l; out[2] = l * 0.95; return out; };

  // ---- briefing text for the menu
  const goal = reactor ? 'destroy the reactor' : boss ? 'destroy the boss robot' : 'find the exit';
  const objectives = { start: order.length ? `Find the ${order[0]} key.` : `Find the reactor chamber and ${goal}.` };
  order.forEach((k, i) => { objectives[k] = order[i + 1] ? `${k[0].toUpperCase() + k.slice(1)} key acquired. Now find the ${order[i + 1]} key.` : `${k[0].toUpperCase() + k.slice(1)} key acquired. Now ${goal}.`; });
  objectives.escape = 'Escape! The exit door shows green on the automap (Tab).';
  const sectors = { 1: 'Open from the start' };
  order.forEach((k, i) => { sectors[Math.min(4, i + 2)] = `Behind the ${k} door`; });
  const title = d.name || info.file || 'Descent level';
  const mission = {
    name: title.toUpperCase(),
    text: `Imported from ${info.source || 'a Descent level file'}${info.file ? ` (${info.file})` : ''}: ${cells.length} segments, ${enemies.length} robots, ${doors.length} doors. Geometry and lighting are the original level's; textures and robots are stand-ins from this game.`,
    sectors, objectives,
  };

  return {
    S, regions, cells, doors, groups, tris, lights: [], latPos,
    collideSphere, raycast, findCell, sampleLight, distToTri2,
    start, keys, enemies, pickups, reactor, exitCells: [], exitCellRefs, mission, art,
  };
}

// The faces of a Descent segment are rarely flat, so the inside test allows a little slack.
function inside(c, p) {
  for (const pl of c.planes) if ((p.x - pl.p[0]) * pl.n[0] + (p.y - pl.p[1]) * pl.n[1] + (p.z - pl.p[2]) * pl.n[2] < -0.3) return false;
  return true;
}
function cellGrid(cells) {
  const grid = new Map();
  for (const c of cells) {
    const lo = [0, 1, 2].map(a => Math.floor(Math.min(...c.corners.map(p => p[a])) / S));
    const hi = [0, 1, 2].map(a => Math.floor(Math.max(...c.corners.map(p => p[a])) / S));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = ckey(x, y, z);
      let l = grid.get(k);
      if (!l) grid.set(k, l = []);
      l.push(c);
    }
  }
  return grid;
}
function findCellIn(cells, pos) {
  const p = { x: pos[0], y: pos[1], z: pos[2] };
  let best = null, bd = Infinity;
  for (const c of cells) {
    if (inside(c, p)) return c;
    const dd = (p.x - c.center[0]) ** 2 + (p.y - c.center[1]) ** 2 + (p.z - c.center[2]) ** 2;
    if (dd < bd) { bd = dd; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------- storage
// Imported levels live in IndexedDB so they survive the reload that switching missions does.
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hexahedron', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function loadImported() {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction('files').objectStore('files').get('descent');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) { return null; }
}
export async function saveImported(value) {
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    if (value) tx.objectStore('files').put(value, 'descent'); else tx.objectStore('files').delete('descent');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
