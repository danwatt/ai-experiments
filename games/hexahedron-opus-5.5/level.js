// Hexahedron level data and geometry. The mine is built from cubes ("cells") on an
// integer lattice. Neighbouring cells share lattice corners, so jittering a corner
// deforms every cube that touches it without ever opening a seam. A side of a cell is
// either solid (wall), open (portal to the neighbour) or a door.
// Pure math: no three.js here, so it can be checked from node.

export const S = 10;                 // world units per cell edge
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const OPP = [1, 0, 3, 2, 5, 4];
export const ckey = (x, y, z) => ((x + 256) * 512 + (y + 256)) * 512 + (z + 256);

const SUB = 2;                       // each cell side is drawn and collided as a SUBxSUB grid
const MARGIN = 2.9;                  // spatial-hash margin; must exceed the biggest sphere radius

const THEMES = {
  hangar:   { wall: 'metal', floor: 'floor', ceil: 'metal', amp: 0.4, light: [0.85, 0.9, 1.0], li: 1.15 },
  tech:     { wall: 'tech', floor: 'floor', ceil: 'metal', amp: 0.5, light: [0.65, 0.82, 1.0], li: 1.05 },
  gallery:  { wall: 'metal', floor: 'grate', ceil: 'tech', amp: 0.9, light: [0.55, 1.0, 0.92], li: 1.0 },
  armory:   { wall: 'tech', floor: 'floor', ceil: 'metal', amp: 0.3, light: [0.6, 1.0, 0.55], li: 1.0 },
  hall:     { wall: 'metal', floor: 'floor', ceil: 'metal', amp: 1.0, light: [1.0, 0.82, 0.55], li: 1.05 },
  storage:  { wall: 'grate', floor: 'floor', ceil: 'grate', amp: 0.4, light: [0.8, 0.65, 1.0], li: 0.95 },
  lava:     { wall: 'lavarock', floor: 'lavarock', ceil: 'lavarock', amp: 2.6, light: [1.0, 0.45, 0.15], li: 1.0, lava: true },
  pump:     { wall: 'rock', floor: 'rock', ceil: 'rock', amp: 2.0, light: [0.45, 0.9, 0.85], li: 0.95 },
  hazard:   { wall: 'hazard', floor: 'floor', ceil: 'metal', amp: 0.3, light: [1.0, 0.4, 0.35], li: 1.0 },
  reactor:  { wall: 'tech', floor: 'grate', ceil: 'tech', amp: 0.7, light: [1.0, 0.45, 0.85], li: 1.0 },
  exit:     { wall: 'metal', floor: 'floor', ceil: 'metal', amp: 0.3, light: [0.45, 1.0, 0.55], li: 0.9, corridor: true },
  corridor: { wall: 'grate', floor: 'floor', ceil: 'grate', amp: 0.8, light: [0.9, 0.88, 0.8], li: 0.75, corridor: true },
};

function hash3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295 * 2 - 1;
}

// Lattice corners of side d of cell (x,y,z), ordered so c0->c1 is the texture u axis
// and c0->c3 is v (world up for walls).
function faceLattice(x, y, z, d) {
  if (d < 2) { const f = x + (d === 0 ? 1 : 0); return [[f, y, z], [f, y, z + 1], [f, y + 1, z + 1], [f, y + 1, z]]; }
  if (d < 4) { const f = y + (d === 2 ? 1 : 0); return [[x, f, z], [x + 1, f, z], [x + 1, f, z + 1], [x, f, z + 1]]; }
  const f = z + (d === 4 ? 1 : 0);
  return [[x, y, f], [x + 1, y, f], [x + 1, y + 1, f], [x, y + 1, f]];
}

function defineLayout(b) {
  const { region, box, hole, path, door, P } = b;

  // ---- rooms ----
  const hangar = region('Hangar', 'hangar');            box(hangar, 0, 0, 0, 3, 1, 3);
  const junction = region('Junction', 'tech');          box(junction, 7, 0, 0, 10, 2, 4);
  hole(9, 0, 2, 9, 2, 2);
  const gallery = region('Pillar Gallery', 'gallery');  box(gallery, 6, 0, 8, 12, 1, 13);
  hole(8, 0, 10, 8, 1, 10); hole(10, 0, 10, 10, 1, 10); hole(8, 0, 12, 8, 1, 12); hole(10, 0, 12, 10, 1, 12);
  const armory = region('Armory', 'armory');            box(armory, 1, 0, 10, 3, 1, 12);
  const hall = region('Upper Hall', 'hall');            box(hall, 7, 5, 16, 11, 7, 20);
  hole(9, 5, 18, 9, 7, 18);
  const storage = region('Storage Bay', 'storage');     box(storage, 2, 5, 17, 4, 6, 19);
  const lava = region('Red Key Cavern', 'lava');        box(lava, 15, 2, 15, 21, 6, 21);
  hole(17, 2, 17, 17, 3, 17); hole(19, 2, 19, 19, 4, 19); hole(20, 5, 16, 20, 6, 16); hole(16, 2, 20);
  const cross = region('Crossroads', 'tech');           box(cross, 14, 0, 4, 17, 2, 7);
  hole(15, 0, 5, 15, 2, 5);
  const pump = region('Pump Station', 'pump');          box(pump, 13, -5, 4, 17, -3, 9);
  hole(14, -5, 6, 14, -4, 6); hole(16, -4, 8, 16, -3, 8);
  const ante = region('Antechamber', 'hazard');         box(ante, 20, 0, 4, 22, 1, 6);
  const core = region('Reactor Core', 'reactor');       box(core, 19, 0, -4, 23, 3, 1);
  const exit = region('Exit Tunnel', 'exit');           path(exit, [-1, 0, 1], [-3, 0, 1], [-3, 2, 1], [-6, 2, 1]);

  // ---- connecting tunnels ----
  path(region('Hangar Tunnel', 'corridor'), [4, 0, 2], [6, 0, 2]);
  path(region('North Tunnel', 'corridor'), [9, 0, 5], [9, 0, 7]);
  path(region('Armory Tunnel', 'corridor'), [5, 0, 11], [4, 0, 11]);
  path(region('Lift Shaft', 'corridor'), [9, 2, 13], [9, 6, 13], [9, 6, 15]);
  path(region('Storage Tunnel', 'corridor'), [6, 6, 18], [5, 6, 18]);
  path(region('Cavern Tunnel', 'corridor'), [12, 6, 18], [14, 6, 18]);
  path(region('Drop Tunnel', 'corridor'), [16, 4, 14], [16, 4, 12], [16, 3, 12], [16, 3, 7]);
  path(region('East Tunnel', 'corridor'), [11, 1, 4], [13, 1, 4]);
  path(region('Red Tunnel', 'corridor'), [18, 0, 5], [19, 0, 5]);
  path(region('Core Tunnel', 'corridor'), [21, 0, 3], [21, 0, 2]);
  path(region('Pump Hatch', 'corridor'), [15, -1, 6], [15, -2, 6]);

  // ---- doors ----
  door([3, 0, 2], [4, 0, 2]);
  door([4, 0, 11], [3, 0, 11]);
  door([5, 6, 18], [4, 6, 18]);
  door([14, 6, 18], [15, 6, 18]);
  door([16, 4, 14], [16, 4, 15]);
  door([13, 1, 4], [14, 1, 4]);
  door([17, 0, 5], [18, 0, 5], 'red');
  door([21, 0, 2], [21, 0, 1]);
  door([15, 0, 6], [15, -1, 6]);
  door([0, 0, 1], [-1, 0, 1], 'exit');

  // Lava cavern is lit from below by the lava.
  for (const [x, z] of [[16, 16], [20, 18], [17.5, 20.5], [19.5, 15.5], [18, 18]]) b.light(lava, P(x, 1.75, z), [1.0, 0.42, 0.12], 1.35, 48);
  b.light(core, P(21, 1.5, -1.5), [1.0, 0.3, 0.8], 0.9, 40);

  return {
    start: { pos: P(1, 0.1, 2), yaw: -Math.PI / 2 },
    exitCells: [[-5, 2, 1], [-6, 2, 1]],
    reactor: { pos: P(21, 1.5, -1.5) },
    key: { pos: P(18, 1.95, 18) },
    enemies: [
      ['drone', P(8, 1, 1)], ['drone', P(10, 1.5, 3.5)],
      ['drone', P(7, 1, 9)], ['drone', P(11, 1, 11)], ['drone', P(9, 1, 11)], ['leech', P(11, 0, 13)],
      ['brute', P(2, 0.6, 11)],
      ['drone', P(8, 6, 19)], ['drone', P(10, 6.5, 17)], ['brute', P(9, 6, 20)],
      ['leech', P(3, 5, 17)], ['leech', P(3, 6, 19)],
      ['drone', P(18, 5, 17)], ['drone', P(20, 4, 20)], ['drone', P(16, 5, 20)], ['leech', P(19, 3, 16)], ['leech', P(18, 3, 20)],
      ['drone', P(14, 1, 6.5)], ['drone', P(17, 2, 4)], ['brute', P(16.5, 1, 6.5)],
      ['leech', P(13, -4, 5)], ['leech', P(17, -4, 7)], ['leech', P(14, -3, 9)],
      ['brute', P(20, 1, 4), ], ['brute', P(22, 1, 6)],
      ['drone', P(19.5, 3, -3.5)], ['drone', P(23, 3, 0.5)],
    ],
    pickups: [
      ['spread', P(1, 0.2, 11)],
      ['missiles', P(2, 5.2, 18)],
      ['shield', P(2.5, 0, 0)],
      ['shield', P(9, 0, 13)],
      ['shield', P(7, 5, 16)],
      ['shield', P(21, 6, 21)],
      ['shield', P(14, 0, 4)],
      ['shield', P(15, -5, 7)], ['shield', P(17, -5, 9)],
      ['shield', P(21, 0, 5)],
    ],
  };
}

export function buildLevel() {
  const regions = [];
  const cellMap = new Map();
  const doorDefs = [];
  const customLights = [];
  const P = (x, y, z) => [(x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S];

  const b = {
    P,
    region(name, theme) {
      const r = { id: regions.length, name, theme: THEMES[theme], corridor: !!THEMES[theme].corridor, cells: [], lights: [], order: [] };
      regions.push(r);
      return r;
    },
    box(r, x0, y0, z0, x1, y1, z1) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(r, x, y, z);
    },
    hole(x0, y0, z0, x1 = x0, y1 = y0, z1 = z0) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cellMap.delete(ckey(x, y, z));
    },
    path(r, ...pts) {
      let [x, y, z] = pts[0];
      put(r, x, y, z);
      for (let i = 1; i < pts.length; i++) {
        const [tx, ty, tz] = pts[i];
        while (x !== tx || y !== ty || z !== tz) {
          if (x !== tx) x += Math.sign(tx - x); else if (y !== ty) y += Math.sign(ty - y); else z += Math.sign(tz - z);
          put(r, x, y, z);
        }
      }
    },
    door(a, c, type = 'normal') { doorDefs.push({ a, b: c, type }); },
    light(r, pos, color, intensity, range) { customLights.push({ r, pos, color, intensity, range }); },
  };
  function put(r, x, y, z) {
    const k = ckey(x, y, z);
    const ex = cellMap.get(k);
    if (ex) {
      if (ex.region === r) return;
      throw new Error(`cell ${x},${y},${z} in both ${ex.region.name} and ${r.name}`);
    }
    cellMap.set(k, { x, y, z, key: k, region: r });
    r.order.push(k);
  }

  const meta = defineLayout(b);

  // ---- cells and neighbours ----
  const cells = [...cellMap.values()];
  cells.forEach((c, i) => { c.idx = i; c.region.cells.push(c); c.nbr = []; c.doors = []; c.faces = []; });
  for (const c of cells) for (let d = 0; d < 6; d++) {
    const [dx, dy, dz] = DIRS[d];
    c.nbr[d] = cellMap.get(ckey(c.x + dx, c.y + dy, c.z + dz)) || null;
    c.doors[d] = null;
  }
  for (const r of regions) {
    r.min = [Infinity, Infinity, Infinity]; r.max = [-Infinity, -Infinity, -Infinity];
    for (const c of r.cells) {
      r.min[0] = Math.min(r.min[0], c.x); r.min[1] = Math.min(r.min[1], c.y); r.min[2] = Math.min(r.min[2], c.z);
      r.max[0] = Math.max(r.max[0], c.x); r.max[1] = Math.max(r.max[1], c.y); r.max[2] = Math.max(r.max[2], c.z);
    }
  }

  // ---- doors ----
  const doors = doorDefs.map((def, id) => {
    const a = cellMap.get(ckey(...def.a)), c = cellMap.get(ckey(...def.b));
    if (!a || !c) throw new Error(`door ${def.a} -> ${def.b} missing cell`);
    const d = DIRS.findIndex(([dx, dy, dz]) => a.x + dx === c.x && a.y + dy === c.y && a.z + dz === c.z);
    if (d < 0) throw new Error(`door ${def.a} -> ${def.b} not adjacent`);
    const door = { id, type: def.type, a, b: c, dir: d };
    a.doors[d] = door; c.doors[OPP[d]] = door;
    return door;
  });

  // ---- lattice: shared, jittered corners ----
  const latAmp = new Map();
  const latLavaFloor = new Set();
  for (const c of cells) {
    const amp = c.region.theme.amp;
    for (let i = 0; i < 8; i++) {
      const k = ckey(c.x + (i & 1), c.y + ((i >> 1) & 1), c.z + ((i >> 2) & 1));
      latAmp.set(k, Math.min(latAmp.has(k) ? latAmp.get(k) : Infinity, amp));
      if (c.region.theme.lava && c.y === c.region.min[1] && ((i >> 1) & 1) === 0) latLavaFloor.add(k);
    }
  }
  for (const door of doors) for (const p of faceLattice(door.a.x, door.a.y, door.a.z, door.dir)) latAmp.set(ckey(...p), 0);
  const latPos = new Map();
  const lat = (i, j, k) => {
    const key = ckey(i, j, k);
    let p = latPos.get(key);
    if (!p) {
      const a = latAmp.get(key) || 0;
      let dy = hash3(i, j, k, 2) * a;
      if (latLavaFloor.has(key)) dy = -Math.abs(dy) * 0.5;
      p = [i * S + hash3(i, j, k, 1) * a, j * S + dy, k * S + hash3(i, j, k, 3) * a];
      latPos.set(key, p);
    }
    return p;
  };

  // ---- faces ----
  const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  for (const c of cells) {
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(lat(c.x + (i & 1), c.y + ((i >> 1) & 1), c.z + ((i >> 2) & 1)));
    c.center = [0, 1, 2].map(a => corners.reduce((s, p) => s + p[a], 0) / 8);
    c.planes = [];
    for (let d = 0; d < 6; d++) {
      const L = faceLattice(c.x, c.y, c.z, d);
      const pos = L.map(p => lat(...p));
      const centroid = [0, 1, 2].map(a => (pos[0][a] + pos[1][a] + pos[2][a] + pos[3][a]) / 4);
      let n = norm(cross(sub(pos[2], pos[0]), sub(pos[3], pos[1])));
      if (dot(n, sub(c.center, centroid)) < 0) n = [-n[0], -n[1], -n[2]];
      const flip = dot(cross(sub(pos[1], pos[0]), sub(pos[2], pos[0])), n) < 0;
      let u0, v0;
      if (d < 2) { u0 = c.z; v0 = c.y; } else if (d < 4) { u0 = c.x; v0 = c.z; } else { u0 = c.x; v0 = c.y; }
      const door = c.doors[d];
      const type = door ? 'door' : c.nbr[d] ? 'open' : 'wall';
      const face = { cell: c, dir: d, type, door, lat: L.map(p => ckey(...p)), pos, centroid, normal: n, flip, u0, v0, tex: null };
      c.faces[d] = face;
      c.planes.push({ p: centroid, n });
      if (door && door.a === c) { door.corners = pos; door.normal = n; door.flip = flip; door.lat = face.lat; door.centroid = centroid; }
    }
  }

  // ---- lights ----
  const lights = [];
  const addLight = (r, pos, color, intensity, range, panelCell) => {
    const L = { x: pos[0], y: pos[1], z: pos[2], c: color, i: intensity, range, region: r };
    lights.push(L); r.lights.push(L);
    if (panelCell) panelCell.faces[2].tex = 'light';
    return L;
  };
  const spots = (n) => { if (n <= 3) return [Math.floor((n - 1) / 2)]; const s = []; for (let i = 1; i < n - 1; i += 3) s.push(i); return s; };
  for (const r of regions) {
    const th = r.theme;
    if (r.corridor) {
      r.order.forEach((k, i) => {
        if (i % 3 !== 1 && r.order.length > 1) return;
        const c = cellMap.get(k);
        if (!c) return;
        const ceil = !c.nbr[2];
        addLight(r, [c.center[0], c.center[1] + (ceil ? S * 0.36 : 0), c.center[2]], th.light, th.li, S * 2.6, ceil ? c : null);
      });
      continue;
    }
    if (th.lava) continue;
    const top = r.max[1];
    for (const xi of spots(r.max[0] - r.min[0] + 1)) for (const zi of spots(r.max[2] - r.min[2] + 1)) {
      const c = cellMap.get(ckey(r.min[0] + xi, top, r.min[2] + zi));
      if (!c || c.region !== r || c.nbr[2]) continue;
      addLight(r, [c.center[0], c.center[1] + S * 0.36, c.center[2]], th.light, th.li, S * 4.2, c);
    }
  }
  const [ex, ey, ez] = meta.exitCells[meta.exitCells.length - 1];
  cellMap.get(ckey(ex, ey, ez)).faces[1].tex = 'light';
  for (const cl of customLights) addLight(cl.r, cl.pos, cl.color, cl.intensity, cl.range, null);
  // Light leaks only through open portals into directly connected regions.
  for (const r of regions) r.near = new Set([r]);
  for (const c of cells) for (let d = 0; d < 6; d++) if (c.faces[d].type === 'open') c.region.near.add(c.nbr[d].region);
  for (const r of regions) r.relLights = [...r.near].flatMap(q => q.lights);

  function evalLight(px, py, pz, nx, ny, nz, list, out) {
    let r = 0.05, g = 0.055, bl = 0.07;
    for (const L of list) {
      const dx = L.x - px, dy = L.y - py, dz = L.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > L.range * L.range) continue;
      const d = Math.sqrt(d2) || 1;
      let a = 1 - d / L.range; a *= a;
      const ndl = nx === undefined ? 0.65 : Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
      const f = L.i * a * (0.3 + 0.7 * ndl);
      r += L.c[0] * f; g += L.c[1] * f; bl += L.c[2] * f;
    }
    out[0] = Math.min(r, 1.8); out[1] = Math.min(g, 1.8); out[2] = Math.min(bl, 1.8);
    return out;
  }

  // ---- render groups + collision triangles ----
  const groups = {};
  const tris = [];
  const grp = (t) => groups[t] || (groups[t] = { pos: [], nrm: [], uv: [], light: [], idx: [] });
  const lv = [0, 0, 0];
  const pushTri = (a, c, e, n, lava, door) => {
    const t = {
      ax: a[0], ay: a[1], az: a[2], bx: c[0], by: c[1], bz: c[2], cx: e[0], cy: e[1], cz: e[2],
      e1x: c[0] - a[0], e1y: c[1] - a[1], e1z: c[2] - a[2], e2x: e[0] - a[0], e2y: e[1] - a[1], e2z: e[2] - a[2],
      nx: n[0], ny: n[1], nz: n[2], lava, door, stamp: 0,
    };
    tris.push(t);
    return t;
  };
  const bilerp = (p, s, t) => [0, 1, 2].map(a => (p[0][a] * (1 - s) + p[1][a] * s) * (1 - t) + (p[3][a] * (1 - s) + p[2][a] * s) * t);

  for (const c of cells) {
    const th = c.region.theme;
    for (const f of c.faces) {
      if (f.type !== 'wall') continue;
      const lava = th.lava && f.dir === 3 && c.y === c.region.min[1];
      if (!f.tex) f.tex = lava ? 'lava' : f.dir === 3 ? th.floor : f.dir === 2 ? th.ceil : th.wall;
      f.lava = lava;
      const g = grp(f.tex);
      const base = g.pos.length / 3;
      const grid = [];
      for (let j = 0; j <= SUB; j++) for (let i = 0; i <= SUB; i++) {
        const s = i / SUB, t = j / SUB;
        const p = bilerp(f.pos, s, t);
        grid.push(p);
        g.pos.push(p[0], p[1], p[2]);
        g.nrm.push(f.normal[0], f.normal[1], f.normal[2]);
        g.uv.push(f.flip ? -(f.u0 + s) : f.u0 + s, f.v0 + t);
        if (f.tex === 'light') { lv[0] = th.light[0] * 1.1; lv[1] = th.light[1] * 1.1; lv[2] = th.light[2] * 1.1; }
        else evalLight(p[0], p[1], p[2], f.normal[0], f.normal[1], f.normal[2], c.region.relLights, lv);
        g.light.push(lv[0], lv[1], lv[2]);
      }
      for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
        const a = j * (SUB + 1) + i, bb = a + 1, cc = a + SUB + 2, dd = a + SUB + 1;
        if (f.flip) g.idx.push(base + a, base + cc, base + bb, base + a, base + dd, base + cc);
        else g.idx.push(base + a, base + bb, base + cc, base + a, base + cc, base + dd);
        pushTri(grid[a], grid[bb], grid[cc], f.normal, lava, null);
        pushTri(grid[a], grid[cc], grid[dd], f.normal, lava, null);
      }
    }
  }
  for (const door of doors) {
    const p = door.corners;
    door.tris = [pushTri(p[0], p[1], p[2], door.normal, false, door), pushTri(p[0], p[2], p[3], door.normal, false, door)];
    door.solid = true;
    const la = evalLight(...door.centroid, undefined, 0, 0, door.a.region.relLights, [0, 0, 0]);
    const lb = evalLight(...door.centroid, undefined, 0, 0, door.b.region.relLights, [0, 0, 0]);
    door.light = [0, 1, 2].map(i => Math.max(la[i], lb[i]) + 0.15);
  }

  // ---- spatial hash over triangles ----
  const hash = new Map();
  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti];
    const x0 = Math.floor((Math.min(t.ax, t.bx, t.cx) - MARGIN) / S), x1 = Math.floor((Math.max(t.ax, t.bx, t.cx) + MARGIN) / S);
    const y0 = Math.floor((Math.min(t.ay, t.by, t.cy) - MARGIN) / S), y1 = Math.floor((Math.max(t.ay, t.by, t.cy) + MARGIN) / S);
    const z0 = Math.floor((Math.min(t.az, t.bz, t.cz) - MARGIN) / S), z1 = Math.floor((Math.max(t.az, t.bz, t.cz) + MARGIN) / S);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = ckey(x, y, z);
      let l = hash.get(k);
      if (!l) hash.set(k, l = []);
      l.push(t);
    }
  }
  const EMPTY = [];
  const trisAt = (x, y, z) => hash.get(ckey(Math.floor(x / S), Math.floor(y / S), Math.floor(z / S))) || EMPTY;

  const q = [0, 0, 0];
  function closest(px, py, pz, t) {
    const abx = t.e1x, aby = t.e1y, abz = t.e1z, acx = t.e2x, acy = t.e2y, acz = t.e2z;
    const apx = px - t.ax, apy = py - t.ay, apz = pz - t.az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { q[0] = t.ax; q[1] = t.ay; q[2] = t.az; return; }
    const bpx = px - t.bx, bpy = py - t.by, bpz = pz - t.bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { q[0] = t.bx; q[1] = t.by; q[2] = t.bz; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q[0] = t.ax + abx * v; q[1] = t.ay + aby * v; q[2] = t.az + abz * v; return; }
    const cpx = px - t.cx, cpy = py - t.cy, cpz = pz - t.cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { q[0] = t.cx; q[1] = t.cy; q[2] = t.cz; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q[0] = t.ax + acx * w; q[1] = t.ay + acy * w; q[2] = t.az + acz * w; return; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      q[0] = t.bx + (t.cx - t.bx) * w; q[1] = t.by + (t.cy - t.by) * w; q[2] = t.bz + (t.cz - t.bz) * w; return;
    }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    q[0] = t.ax + abx * v + acx * w; q[1] = t.ay + aby * v + acy * w; q[2] = t.az + abz * v + acz * w;
  }

  // Push a sphere out of the walls (and closed doors). pos/vel are {x,y,z} objects.
  function collideSphere(pos, vel, r, bounce = 0, res = {}) {
    res.hit = false; res.lava = false; res.door = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const list = trisAt(pos.x, pos.y, pos.z);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.door && !t.door.solid) continue;
        closest(pos.x, pos.y, pos.z, t);
        let dx = pos.x - q[0], dy = pos.y - q[1], dz = pos.z - q[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (t.lava && d2 < (r + 0.6) * (r + 0.6)) res.lava = true;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) { dx = t.nx; dy = t.ny; dz = t.nz; d = 1; } else { dx /= d; dy /= d; dz /= d; }
        const push = r - (d === 1 && d2 < 1e-10 ? 0 : d);
        pos.x += dx * push; pos.y += dy * push; pos.z += dz * push;
        if (vel) {
          const vn = vel.x * dx + vel.y * dy + vel.z * dz;
          if (vn < 0) { const k = vn * (1 + bounce); vel.x -= dx * k; vel.y -= dy * k; vel.z -= dz * k; }
        }
        res.hit = true; if (t.door) res.door = t.door;
        moved = true;
      }
      if (!moved) break;
    }
    return res;
  }

  // Segment p0->p1 against walls and closed doors. Returns { t, tri } or null.
  let stamp = 0;
  const rayHit = { t: 0, tri: null };
  function raycast(p0, p1) {
    stamp++;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(len / 2.5));
    let best = 2, bestTri = null, lastKey = -1;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = p0.x + dx * f, y = p0.y + dy * f, z = p0.z + dz * f;
      const k = ckey(Math.floor(x / S), Math.floor(y / S), Math.floor(z / S));
      if (k === lastKey) continue;
      lastKey = k;
      const list = hash.get(k);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.stamp === stamp) continue;
        t.stamp = stamp;
        if (t.door && !t.door.solid) continue;
        // Moller-Trumbore
        const px = dy * t.e2z - dz * t.e2y, py = dz * t.e2x - dx * t.e2z, pz = dx * t.e2y - dy * t.e2x;
        const det = t.e1x * px + t.e1y * py + t.e1z * pz;
        if (det > -1e-9 && det < 1e-9) continue;
        const inv = 1 / det;
        const tx = p0.x - t.ax, ty = p0.y - t.ay, tz = p0.z - t.az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * t.e1z - tz * t.e1y, qy = tz * t.e1x - tx * t.e1z, qz = tx * t.e1y - ty * t.e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (t.e2x * qx + t.e2y * qy + t.e2z * qz) * inv;
        if (tt >= 0 && tt <= 1 && tt < best) { best = tt; bestTri = t; }
      }
    }
    if (!bestTri) return null;
    rayHit.t = best; rayHit.tri = bestTri;
    return rayHit;
  }

  function inside(c, p) {
    for (const pl of c.planes) if ((p.x - pl.p[0]) * pl.n[0] + (p.y - pl.p[1]) * pl.n[1] + (p.z - pl.p[2]) * pl.n[2] < -0.05) return false;
    return true;
  }
  function findCell(p, hint) {
    if (hint) {
      if (inside(hint, p)) return hint;
      for (const nb of hint.nbr) if (nb && inside(nb, p)) return nb;
    }
    const bx = Math.floor(p.x / S), by = Math.floor(p.y / S), bz = Math.floor(p.z / S);
    let best = null, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const c = cellMap.get(ckey(bx + dx, by + dy, bz + dz));
      if (!c) continue;
      if (inside(c, p)) return c;
      const d = (p.x - c.center[0]) ** 2 + (p.y - c.center[1]) ** 2 + (p.z - c.center[2]) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best || hint || null;
  }

  const distToTri2 = (p, t) => { closest(p.x, p.y, p.z, t); return (p.x - q[0]) ** 2 + (p.y - q[1]) ** 2 + (p.z - q[2]) ** 2; };
  const sampleLight = (p, cell, out = [0, 0, 0]) => evalLight(p.x, p.y, p.z, undefined, 0, 0, cell ? cell.region.relLights : [], out);

  return {
    S, regions, cells, cellMap, doors, groups, tris, lights, latPos,
    collideSphere, raycast, findCell, sampleLight, distToTri2,
    cellAt: (x, y, z) => cellMap.get(ckey(x, y, z)),
    ...meta,
  };
}
