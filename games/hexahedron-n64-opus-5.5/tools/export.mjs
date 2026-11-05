// Export the three Hexahedron missions to big-endian binary files for the N64 build.
// Geometry comes straight from the browser game's level.js (cells, shared jittered
// lattice, doors, lights), so the mines are the same shape. Run inside Docker:
//   docker run --rm -v "$PWD/..":/g -w /g/hexahedron-n64-opus-5.5 node:22-alpine node tools/export.mjs
import { buildLevel, MISSIONS, S, ckey } from '../../hexahedron-opus-5.5/level.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const TEX = ['metal', 'tech', 'floor', 'grate', 'panel', 'hazard', 'pipes', 'rock', 'lavarock', 'lava', 'crystal', 'light'];
const DOOR_TYPES = { normal: 0, red: 1, blue: 2, yellow: 3, exit: 4 };
// The N64 port keeps three robot types; the rest of the browser roster maps onto them.
const ENEMY = { drone: 0, sentry: 0, wasp: 0, phantom: 0, leech: 1, brute: 2, minelayer: 2, warden: 2 };
// Three weapons (laser, spreadfire, missiles). Heavier pickups become missiles or shields.
const PICKUP = { shield: 0, spread: 1, missiles: 2, plasma: 2, fusion: 2, overdrive: 0 };
const MARGIN = 4.0;

class W {
  constructor() { this.buf = Buffer.alloc(1 << 22); this.o = 0; }
  u8(v) { this.buf.writeUInt8(v & 255, this.o); this.o += 1; }
  i8(v) { this.buf.writeInt8(v, this.o); this.o += 1; }
  u16(v) { this.buf.writeUInt16BE(v, this.o); this.o += 2; }
  i16(v) { this.buf.writeInt16BE(v, this.o); this.o += 2; }
  u32(v) { this.buf.writeUInt32BE(v >>> 0, this.o); this.o += 4; }
  f(v) { this.buf.writeFloatBE(v, this.o); this.o += 4; }
  v3(a) { this.f(a[0]); this.f(a[1]); this.f(a[2]); }
  str(s) { const b = Buffer.from(s, 'latin1'); this.u16(b.length); b.copy(this.buf, this.o); this.o += b.length; }
  align() { while (this.o & 3) this.u8(0); }
  out() { return this.buf.subarray(0, this.o); }
}

function evalLight(p, n, list) {
  let r = 0.05, g = 0.055, bl = 0.07;
  for (const L of list) {
    const dx = L.x - p[0], dy = L.y - p[1], dz = L.z - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > L.range * L.range) continue;
    const d = Math.sqrt(d2) || 1;
    let a = 1 - d / L.range; a *= a;
    const ndl = n ? Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / d) : 0.65;
    const f = L.i * a * (0.3 + 0.7 * ndl);
    r += L.c[0] * f; g += L.c[1] * f; bl += L.c[2] * f;
  }
  return [r, g, bl];
}
// Vertex colours modulate the texture on the RDP, so 1.0 is full brightness; keep a little headroom.
const col = (l, w) => { for (let i = 0; i < 3; i++) w.u8(Math.min(255, Math.round(Math.pow(Math.min(l[i], 1.6) / 1.6, 0.8) * 255))); };

mkdirSync('filesystem', { recursive: true });
MISSIONS.forEach((mission, mi) => {
  const L = buildLevel(mission);
  const w = new W();
  const cells = L.cells;
  const regions = L.regions;

  // wall faces (render + collision) and doors
  const walls = [];
  for (const c of cells) for (const f of c.faces) if (f.type === 'wall') walls.push(f);
  const doors = L.doors;

  // spatial hash over faces, in S-sized buckets (same scheme as the browser physics)
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) { mn = [Math.min(mn[0], c.x), Math.min(mn[1], c.y), Math.min(mn[2], c.z)]; mx = [Math.max(mx[0], c.x), Math.max(mx[1], c.y), Math.max(mx[2], c.z)]; }
  const g0 = mn.map(v => v - 1), dim = mx.map((v, a) => v + 2 - g0[a]);
  const slots = Array.from({ length: dim[0] * dim[1] * dim[2] }, () => []);
  const slotOf = (x, y, z) => ((x - g0[0]) * dim[1] + (y - g0[1])) * dim[2] + (z - g0[2]);
  const addQuad = (id, pos) => {
    const lo = [0, 1, 2].map(a => Math.floor((Math.min(...pos.map(p => p[a])) - MARGIN) / S));
    const hi = [0, 1, 2].map(a => Math.floor((Math.max(...pos.map(p => p[a])) + MARGIN) / S));
    for (let x = Math.max(lo[0], g0[0]); x <= Math.min(hi[0], g0[0] + dim[0] - 1); x++)
      for (let y = Math.max(lo[1], g0[1]); y <= Math.min(hi[1], g0[1] + dim[1] - 1); y++)
        for (let z = Math.max(lo[2], g0[2]); z <= Math.min(hi[2], g0[2] + dim[2] - 1); z++) slots[slotOf(x, y, z)].push(id);
  };
  walls.forEach((f, i) => addQuad(i, f.pos));
  doors.forEach((d, i) => addQuad(walls.length + i, d.corners));

  const meta = L;
  const enemies = meta.enemies.filter(([t]) => t in ENEMY);
  const pickups = meta.pickups.filter(([t]) => t in PICKUP);
  // Citadel's Overseer becomes a reactor-style core in the arena.
  const boss = meta.enemies.find(([t]) => t === 'overseer');
  const reactor = meta.reactor ? meta.reactor.pos : boss ? boss[1] : null;

  // ---------- header ----------
  w.u32(0x48455836);                 // 'HEX6'
  w.u16(cells.length); w.u16(walls.length); w.u16(doors.length); w.u16(regions.length);
  w.u16(enemies.length); w.u16(pickups.length);
  w.str(mission.name); w.str(mission.text);
  for (const k of ['start', 'blue', 'yellow', 'red', 'escape']) w.str(mission.objectives[k] || '');
  w.str(boss ? 'OVERSEER CORE' : 'REACTOR');
  w.v3(meta.start.pos); w.f(meta.start.yaw);
  w.u8(reactor ? 1 : 0); w.v3(reactor || [0, 0, 0]);
  for (const k of ['blue', 'yellow', 'red']) { const p = meta.keys[k]; w.u8(p ? 1 : 0); w.v3(p || [0, 0, 0]); }
  w.u8(meta.exitCells.length);
  for (const [x, y, z] of meta.exitCells) w.u16(L.cellMap.get(ckey(x, y, z)).idx);
  w.align();

  // ---------- regions ----------
  for (const r of regions) {
    w.str(r.name); w.u8(r.sector); w.u8(r.theme.lava ? 1 : 0);
    const amb = evalLight(r.cells[0].center, null, r.relLights);
    col(r.theme.light, w); col(amb, w);
  }
  w.align();

  // ---------- cells ----------
  for (const c of cells) {
    w.i16(c.x); w.i16(c.y); w.i16(c.z); w.u16(c.region.id);
    for (let d = 0; d < 6; d++) w.i16(c.nbr[d] ? c.nbr[d].idx : -1);
    for (let d = 0; d < 6; d++) w.i16(c.doors[d] ? c.doors[d].id : -1);
    for (let d = 0; d < 6; d++) w.u8({ wall: 0, open: 1, door: 2 }[c.faces[d].type]);
    w.u16(0);
    w.v3(c.center);
    for (let d = 0; d < 6; d++) { w.v3(c.faces[d].centroid); w.v3(c.faces[d].normal); }
  }
  // per cell: first wall index + count (walls are grouped by cell in order)
  let wi = 0;
  for (const c of cells) {
    const start = wi;
    while (wi < walls.length && walls[wi].cell === c) wi++;
    w.u16(start); w.u16(wi - start);
  }

  // ---------- walls ----------
  for (const f of walls) {
    const c = f.cell, list = c.region.relLights;
    const lit = f.tex === 'light';
    w.u8(TEX.indexOf(f.tex)); w.u8((f.lava ? 1 : 0) | (f.flip ? 2 : 0)); w.u16(c.idx);
    for (const p of f.pos) w.v3(p);
    w.v3(f.normal);
    const ctr = f.centroid;
    for (const p of [...f.pos, ctr]) {
      // lava caverns are lit by several strong lights; scale them so walls keep some texture
      const k = c.region.theme.lava ? 0.62 : 1;
      if (lit) col(c.region.theme.light.map(v => v * 1.6), w);
      else if (f.lava) col(evalLight(p, f.normal, list).map(v => v * k + 0.3), w);
      else col(evalLight(p, f.normal, list).map(v => v * k), w);
    }
    w.u8(0);
  }

  // ---------- doors ----------
  for (const d of doors) {
    w.u16(d.a.idx); w.u16(d.b.idx); w.u8(d.dir); w.u8(DOOR_TYPES[d.type]); w.u8(d.oneway ? 1 : 0); w.u8(d.flip ? 1 : 0);
    for (const p of d.corners) w.v3(p);
    w.v3(d.normal); w.v3(d.centroid);
    const la = evalLight(d.centroid, null, d.a.region.relLights), lb = evalLight(d.centroid, null, d.b.region.relLights);
    col([0, 1, 2].map(i => Math.max(la[i], lb[i]) + 0.25), w); w.u8(0);
  }

  // ---------- spatial hash ----------
  w.i16(g0[0]); w.i16(g0[1]); w.i16(g0[2]); w.i16(dim[0]); w.i16(dim[1]); w.i16(dim[2]);
  // cell lookup grid (lattice cell -> cell index)
  for (let x = 0; x < dim[0]; x++) for (let y = 0; y < dim[1]; y++) for (let z = 0; z < dim[2]; z++) {
    const c = L.cellMap.get(ckey(x + g0[0], y + g0[1], z + g0[2]));
    w.i16(c ? c.idx : -1);
  }
  w.align();
  let total = 0;
  for (const s of slots) { w.u32(total); total += s.length; }
  w.u32(total);
  for (const s of slots) for (const id of s) w.u16(id);
  w.align();

  // ---------- actors ----------
  for (const [t, p] of enemies) { w.u8(ENEMY[t]); w.u8(t === 'warden' ? 1 : 0); w.u16(0); w.v3(p); }
  for (const [t, p] of pickups) { w.u8(PICKUP[t]); w.u8(0); w.u16(0); w.v3(p); }

  const out = w.out();
  writeFileSync(`filesystem/m${mi + 1}.bin`, out);
  const rooms = regions.filter(r => !r.corridor).length;
  console.log(`m${mi + 1} ${mission.name}: ${cells.length} cells, ${walls.length} walls, ${doors.length} doors, ${rooms} rooms, ${enemies.length} robots, ${pickups.length} pickups, grid ${dim.join('x')}, hash ${total}, ${out.length} bytes`);
});
