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
const MARGIN = 4.0;                  // spatial-hash margin; must exceed the biggest sphere radius

// Natural themes jitter their corners by `amp`. Man-made themes keep straight walls and
// chamfer their convex edges by `bevel` instead. `panels: false` lights the room with
// free-standing lamps rather than ceiling panels.
const THEMES = {
  hangar:   { wall: 'metal', floor: 'floor', ceil: 'metal', bevel: 2.5, light: [0.85, 0.9, 1.0], li: 1.15 },
  tech:     { wall: 'tech', floor: 'floor', ceil: 'metal', bevel: 2.0, light: [0.65, 0.82, 1.0], li: 1.05 },
  gallery:  { wall: 'metal', floor: 'grate', ceil: 'tech', bevel: 3.0, light: [0.55, 1.0, 0.92], li: 1.0 },
  armory:   { wall: 'tech', floor: 'floor', ceil: 'metal', bevel: 1.5, light: [0.6, 1.0, 0.55], li: 1.0 },
  hall:     { wall: 'metal', floor: 'floor', ceil: 'metal', bevel: 3.0, light: [1.0, 0.82, 0.55], li: 1.05 },
  storage:  { wall: 'grate', floor: 'floor', ceil: 'grate', bevel: 1.5, light: [0.8, 0.65, 1.0], li: 0.95 },
  lab:      { wall: 'panel', floor: 'floor', ceil: 'panel', bevel: 2.0, light: [0.9, 0.95, 1.0], li: 1.0 },
  quarters: { wall: 'panel', floor: 'floor', ceil: 'metal', bevel: 2.0, light: [1.0, 0.85, 0.65], li: 0.95 },
  foundry:  { wall: 'metal', floor: 'grate', ceil: 'hazard', bevel: 2.5, light: [1.0, 0.6, 0.3], li: 1.05 },
  cold:     { wall: 'panel', floor: 'grate', ceil: 'tech', bevel: 2.0, light: [0.55, 0.85, 1.0], li: 1.05 },
  pipes:    { wall: 'pipes', floor: 'grate', ceil: 'pipes', bevel: 2.5, light: [0.7, 1.0, 0.75], li: 1.0 },
  hazard:   { wall: 'hazard', floor: 'floor', ceil: 'metal', bevel: 1.5, light: [1.0, 0.4, 0.35], li: 1.0 },
  reactor:  { wall: 'tech', floor: 'grate', ceil: 'tech', bevel: 3.0, light: [1.0, 0.45, 0.85], li: 1.0 },
  exit:     { wall: 'metal', floor: 'floor', ceil: 'metal', bevel: 1.5, light: [0.45, 1.0, 0.55], li: 0.9, corridor: true },
  corridor: { wall: 'grate', floor: 'floor', ceil: 'grate', bevel: 2.0, light: [0.9, 0.88, 0.8], li: 0.75, corridor: true },
  lava:     { wall: 'lavarock', floor: 'lavarock', ceil: 'lavarock', amp: 2.6, light: [1.0, 0.45, 0.15], li: 1.0, lava: true },
  pump:     { wall: 'rock', floor: 'rock', ceil: 'rock', amp: 2.0, light: [0.45, 0.9, 0.85], li: 0.95, panels: false },
  drill:    { wall: 'rock', floor: 'rock', ceil: 'rock', amp: 2.3, light: [1.0, 0.8, 0.45], li: 0.95, panels: false },
  crystal:  { wall: 'crystal', floor: 'crystal', ceil: 'crystal', amp: 2.4, light: [0.45, 0.8, 1.0], li: 1.4, panels: false, crystals: true },
  mine:     { wall: 'rock', floor: 'rock', ceil: 'rock', amp: 1.6, light: [0.95, 0.85, 0.6], li: 0.8, corridor: true, panels: false },
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

// Mission 1: the original twelve-room mine. One red key, three robot types.
function layoutProspect(b) {
  const { region, box, hole, path, door, P } = b;
  const tunnel = (name, ...pts) => path(region(name, 'corridor'), ...pts);

  // ================= Sector 1: upper levels =================
  const hangar = region('Hangar', 'hangar');            box(hangar, 0, 0, 0, 3, 1, 3);
  const junction = region('Junction', 'tech');          box(junction, 7, 0, 0, 10, 2, 4);
  hole(9, 0, 2, 9, 2, 2);
  const gallery = region('Pillar Gallery', 'gallery');  box(gallery, 6, 0, 8, 12, 1, 13);
  hole(8, 0, 10, 8, 1, 10); hole(10, 0, 10, 10, 1, 10); hole(8, 0, 12, 8, 1, 12); hole(10, 0, 12, 10, 1, 12);
  const armory = region('Armory', 'armory');            box(armory, 1, 0, 10, 3, 1, 12);
  const hall = region('Upper Hall', 'hall');            box(hall, 7, 5, 16, 11, 7, 20);
  hole(9, 5, 18, 9, 7, 18);
  const storage = region('Storage Bay', 'storage');     box(storage, 2, 5, 17, 4, 6, 19);
  const exit = region('Exit Tunnel', 'exit');           path(exit, [-1, 0, 1], [-3, 0, 1], [-3, 2, 1], [-6, 2, 1]);

  tunnel('Hangar Tunnel', [4, 0, 2], [6, 0, 2]);
  tunnel('North Tunnel', [9, 0, 5], [9, 0, 7]);
  tunnel('Armory Tunnel', [5, 0, 11], [4, 0, 11]);
  tunnel('Lift Shaft', [9, 2, 13], [9, 6, 13], [9, 6, 15]);
  tunnel('Storage Tunnel', [6, 6, 18], [5, 6, 18]);

  door([3, 0, 2], [4, 0, 2]);
  door([4, 0, 11], [3, 0, 11]);
  door([5, 6, 18], [4, 6, 18]);
  door([0, 0, 1], [-1, 0, 1], 'exit');

  // ================= Sector 2: lava cavern and lower works =================
  b.sector(2);
  const lava = region('Red Key Cavern', 'lava');        box(lava, 15, 2, 15, 21, 6, 21);
  hole(17, 2, 17, 17, 3, 17); hole(19, 2, 19, 19, 4, 19); hole(20, 5, 16, 20, 6, 16); hole(16, 2, 20);
  const cross = region('Crossroads', 'tech');           box(cross, 14, 0, 4, 17, 2, 7);
  hole(15, 0, 5, 15, 2, 5);
  const pump = region('Pump Station', 'pump');          box(pump, 13, -5, 4, 17, -3, 9);
  hole(14, -5, 6, 14, -4, 6); hole(16, -4, 8, 16, -3, 8);

  tunnel('Cavern Tunnel', [12, 6, 18], [14, 6, 18]);
  tunnel('Drop Tunnel', [16, 4, 14], [16, 4, 12], [16, 3, 12], [16, 3, 7]);
  tunnel('East Tunnel', [11, 1, 4], [13, 1, 4]);
  tunnel('Pump Hatch', [15, -1, 6], [15, -2, 6]);

  door([14, 6, 18], [15, 6, 18]);
  door([16, 4, 14], [16, 4, 15]);
  door([13, 1, 4], [14, 1, 4]);
  door([15, 0, 6], [15, -1, 6]);

  // ================= Sector 3: reactor (red door) =================
  b.sector(3);
  const ante = region('Antechamber', 'hazard');         box(ante, 20, 0, 4, 22, 1, 6);
  const core = region('Reactor Core', 'reactor');       box(core, 19, 0, -4, 23, 3, 1);

  tunnel('Red Tunnel', [18, 0, 5], [19, 0, 5]);
  tunnel('Core Tunnel', [21, 0, 3], [21, 0, 2]);

  door([17, 0, 5], [18, 0, 5], 'red');
  door([21, 0, 2], [21, 0, 1]);

  for (const [x, z] of [[16, 16], [20, 18], [17.5, 20.5], [19.5, 15.5], [18, 18]]) b.light(lava, P(x, 1.75, z), [1.0, 0.42, 0.12], 1.35, 48);
  const reactorPos = P(21, 1.5, -1.5);
  b.light(core, reactorPos, [1.0, 0.3, 0.8], 0.9, 40);

  return {
    start: { pos: P(1, 0.1, 2), yaw: -Math.PI / 2 },
    exitCells: [[-5, 2, 1], [-6, 2, 1]],
    reactor: { pos: reactorPos },
    keys: { red: P(18, 1.95, 18) },
    enemies: [
      ['drone', P(8, 1, 1)], ['drone', P(10, 1.5, 3.5)],
      ['drone', P(7, 1, 9)], ['drone', P(11, 1, 11)], ['drone', P(9, 1, 11)], ['leech', P(11, 0, 13)],
      ['brute', P(2, 0.6, 11)],
      ['drone', P(8, 6, 19)], ['drone', P(10, 6.5, 17)], ['brute', P(9, 6, 20)],
      ['leech', P(3, 5, 17)], ['leech', P(3, 6, 19)],
      ['drone', P(18, 5, 17)], ['drone', P(20, 4, 20)], ['drone', P(16, 5, 20)], ['leech', P(19, 3, 16)], ['leech', P(18, 3, 20)],
      ['drone', P(14, 1, 6.5)], ['drone', P(17, 2, 4)], ['brute', P(16.5, 1, 6.5)],
      ['leech', P(13, -4, 5)], ['leech', P(17, -4, 7)], ['leech', P(14, -3, 9)],
      ['brute', P(20, 1, 4)], ['brute', P(22, 1, 6)],
      ['drone', P(19.5, 3, -3.5)], ['drone', P(23, 3, 0.5)],
    ],
    pickups: [
      ['spread', P(1, 0.2, 11)],
      ['missiles', P(2, 5.2, 18)],
      ['shield', P(2.5, 0, 0)], ['shield', P(9, 0, 13)], ['shield', P(7, 5, 16)], ['shield', P(21, 6, 21)],
      ['shield', P(14, 0, 4)], ['shield', P(15, -5, 7)], ['shield', P(17, -5, 9)], ['shield', P(21, 0, 5)],
    ],
  };
}

// Mission 3: blue, yellow and red keys, then the Overseer in its arena. No reactor.
function layoutCitadel(b) {
  const { region, box, hole, path, door, P } = b;
  const tunnel = (name, ...pts) => path(region(name, 'corridor'), ...pts);
  const mine = (name, ...pts) => path(region(name, 'mine'), ...pts);

  // ================= Sector 1: landing levels (open) =================
  const bay = region('Landing Bay', 'hangar');           box(bay, 0, 0, 0, 4, 2, 3);
  const deck = region('Command Deck', 'tech');           box(deck, 8, 0, -1, 12, 2, 3);
  hole(10, 0, 1, 10, 1, 1);
  const obs = region('Observation Gallery', 'gallery');  box(obs, 8, 0, 7, 14, 1, 12);
  hole(10, 0, 9, 10, 1, 9); hole(12, 0, 9, 12, 1, 9); hole(10, 0, 11, 10, 1, 11); hole(12, 0, 11, 12, 1, 11);
  const cryo = region('Cryo Lab', 'cold');               box(cryo, 0, 0, 8, 4, 1, 11);
  const ice = region('Ice Caverns', 'crystal');          box(ice, -8, 2, 6, -3, 6, 12);
  hole(-6, 2, 8, -6, 4, 8); hole(-4, 5, 10, -4, 6, 10); hole(-7, 6, 11, -5, 6, 12); hole(-3, 2, 6);
  const crew = region('Crew Deck', 'quarters');          box(crew, 14, 4, -2, 18, 5, 2);
  const comms = region('Comms Array', 'lab');            box(comms, 8, 4, 8, 12, 5, 11);

  tunnel('Bay Tunnel', [5, 1, 1], [7, 1, 1]);
  tunnel('Gallery Tunnel', [10, 0, 4], [10, 0, 6]);
  tunnel('Cryo Tunnel', [5, 0, 9], [7, 0, 9]);
  mine('Ice Chute', [1, 2, 9], [1, 3, 9], [-2, 3, 9]);
  tunnel('Crew Lift', [11, 3, 1], [11, 4, 1], [13, 4, 1]);
  tunnel('Comms Shaft', [13, 2, 11], [13, 4, 11]);

  door([4, 1, 1], [5, 1, 1]);
  door([10, 0, 6], [10, 0, 7]);
  door([4, 0, 9], [5, 0, 9]);
  door([13, 4, 1], [14, 4, 1]);
  door([13, 4, 11], [12, 4, 11]);

  // ================= Sector 2: pump works (blue door) =================
  b.sector(2);
  const pumps = region('Pump Junction', 'pipes');        box(pumps, 19, 0, 8, 23, 3, 12);
  const flood = region('Flooded Mine', 'pump');          box(flood, 19, -6, 7, 24, -3, 13);
  hole(21, -6, 9, 21, -5, 9); hole(23, -6, 11, 23, -4, 11); hole(19, -6, 7);
  const smelter = region('Smelter', 'foundry');          box(smelter, 27, 0, 6, 32, 2, 11);
  hole(29, 0, 8, 30, 0, 9);
  const drill = region('Drill Gallery', 'drill');        box(drill, 27, -6, -3, 33, -3, 3);
  hole(29, -6, -1, 29, -5, -1); hole(31, -6, 1, 31, -4, 1); hole(33, -3, 3);
  const archive = region('Archive', 'lab');              box(archive, 36, 0, 7, 39, 1, 10);
  const silo = region('Ore Silo', 'storage');            box(silo, 36, -4, -2, 39, -2, 1);

  tunnel('Blue Tunnel', [15, 1, 10], [18, 1, 10]);
  tunnel('Pump Shaft', [21, -1, 10], [21, -2, 10]);
  tunnel('Smelter Tunnel', [24, 1, 9], [26, 1, 9]);
  mine('Drill Passage', [25, -4, 8], [26, -4, 8], [26, -4, 4], [27, -4, 4]);
  tunnel('Archive Tunnel', [33, 1, 8], [35, 1, 8]);
  tunnel('Silo Tunnel', [34, -4, 0], [35, -4, 0]);

  door([14, 1, 10], [15, 1, 10], 'blue');
  door([21, 0, 10], [21, -1, 10]);
  door([26, 1, 9], [27, 1, 9]);
  door([35, 1, 8], [36, 1, 8]);
  door([35, -4, 0], [36, -4, 0]);

  // ================= Sector 3: thermal works (yellow door) =================
  b.sector(3);
  const coolant = region('Coolant Plant', 'cold');       box(coolant, 27, 0, 16, 33, 3, 21);
  hole(29, 0, 18, 29, 3, 18); hole(31, 0, 18, 31, 3, 18);
  const guard = region('Guard Post', 'hazard');          box(guard, 20, 0, 17, 24, 2, 20);
  const magma = region('Magma Chamber', 'lava');         box(magma, 36, -2, 15, 43, 3, 22);
  hole(38, -2, 17, 38, -1, 17); hole(41, -2, 20, 41, 0, 20); hole(43, 2, 15, 43, 3, 15); hole(36, -2, 22);
  const spine = region('Turbine Spine', 'hall');         box(spine, 26, 6, 24, 32, 8, 28);
  const towers = region('Cooling Towers', 'pipes');      box(towers, 36, 4, 25, 41, 8, 29);
  hole(38, 4, 27, 38, 8, 27); hole(40, 4, 27, 40, 8, 27);

  tunnel('Yellow Tunnel', [30, 1, 12], [30, 1, 15]);
  tunnel('Guard Tunnel', [26, 1, 18], [25, 1, 18]);
  tunnel('Magma Tunnel', [34, 2, 18], [35, 2, 18]);
  tunnel('Spine Lift', [29, 4, 20], [29, 6, 20], [29, 6, 23]);
  tunnel('Tower Tunnel', [33, 7, 26], [35, 7, 26]);

  door([30, 1, 11], [30, 1, 12], 'yellow');
  door([25, 1, 18], [24, 1, 18]);
  door([33, 2, 18], [34, 2, 18]);
  door([29, 6, 23], [29, 6, 24]);
  door([35, 7, 26], [36, 7, 26]);

  // ================= Sector 4: the Overseer's arena (red door) =================
  b.sector(4);
  const arena = region('Overseer Arena', 'reactor');     box(arena, 25, 4, 32, 33, 9, 40);
  hole(27, 4, 34, 27, 9, 34); hole(31, 4, 34, 31, 9, 34); hole(27, 4, 38, 27, 9, 38); hole(31, 4, 38, 31, 9, 38);
  const exit = region('Escape Shaft', 'exit');           path(exit, [24, 5, 36], [20, 5, 36], [20, 8, 36], [16, 8, 36]);

  tunnel('Red Tunnel', [29, 7, 29], [29, 7, 31]);

  door([29, 7, 28], [29, 7, 29], 'red');
  door([29, 7, 31], [29, 7, 32]);
  door([25, 5, 36], [24, 5, 36], 'exit');

  for (const [x, z] of [[37, 16], [41, 18], [38.5, 21], [40.5, 16], [39, 19]]) b.light(magma, P(x, -2.25, z), [1.0, 0.42, 0.12], 1.35, 48);
  b.light(arena, P(29, 6.5, 36), [1.0, 0.3, 0.6], 0.8, 60);

  return {
    start: { pos: P(1, 0.6, 1.5), yaw: -Math.PI / 2 },
    warps: { boss: { pos: P(29, 7, 29.5), yaw: Math.PI } },   // ?warp=boss: red tunnel, facing the arena door
    exitCells: [[17, 8, 36], [16, 8, 36]],
    keys: { blue: P(-6, 2.6, 11), yellow: P(32, -6.05, -2), red: P(40, -2.05, 18) },
    enemies: [
      // sector 1: drones, leeches, sentries; wasps guard the ice caverns
      ['drone', P(3, 1.5, 3)], ['drone', P(1, 2, 0)],
      ['drone', P(9, 1, 0)], ['drone', P(11, 1.5, 2)], ['leech', P(12, 0, -1)], ['sentry', P(8, 2, 3)],
      ['drone', P(9, 1, 8)], ['drone', P(13, 1, 12)], ['leech', P(11, 0, 10)], ['leech', P(13, 0, 8)], ['sentry', P(14, 1, 7)], ['sentry', P(8, 1, 12)],
      ['leech', P(1, 0, 8)], ['leech', P(3, 1, 11)], ['drone', P(2, 1, 10)],
      ['wasp', P(-5, 5, 7)], ['wasp', P(-4, 4, 11)], ['wasp', P(-7, 5, 9)], ['wasp', P(-6, 3, 12)], ['drone', P(-4, 6, 8)], ['leech', P(-7, 2, 7)], ['sentry', P(-3, 6, 12)],
      ['drone', P(15, 5, -2)], ['drone', P(17, 4, 2)], ['leech', P(18, 4, 0)], ['sentry', P(14, 5, -2)],
      ['sentry', P(8, 5, 8)], ['sentry', P(12, 5, 8)], ['drone', P(10, 4, 10)],
      // sector 2: brutes, minelayers, wasp packs, the first phantoms
      ['brute', P(22, 1, 8)], ['drone', P(20, 3, 12)], ['drone', P(23, 3, 9)], ['minelayer', P(21, 3, 11)],
      ['leech', P(20, -6, 8)], ['leech', P(23, -5, 12)], ['leech', P(24, -6, 7)], ['minelayer', P(22, -4, 13)], ['wasp', P(20, -4, 11)], ['wasp', P(23, -3, 8)],
      ['brute', P(28, 1, 7)], ['brute', P(31, 1, 10)], ['sentry', P(32, 2, 6)], ['drone', P(29, 2, 9)], ['drone', P(30, 0, 11)],
      ['wasp', P(28, -4, -2)], ['wasp', P(30, -3, 0)], ['wasp', P(32, -5, 2)], ['wasp', P(29, -6, 1)], ['minelayer', P(31, -4, -3)], ['brute', P(32, -3, 1)], ['phantom', P(30, -5, -1)],
      ['sentry', P(36, 1, 10)], ['sentry', P(39, 1, 7)], ['phantom', P(38, 1, 9)],
      ['minelayer', P(37, -3, 0)], ['drone', P(39, -2, -2)], ['drone', P(38, -4, 1)],
      // sector 3: phantoms, brutes and a warden
      ['phantom', P(28, 2, 17)], ['phantom', P(32, 2, 20)], ['brute', P(30, 1, 21)], ['sentry', P(27, 3, 16)], ['sentry', P(33, 3, 21)], ['wasp', P(30, 3, 17)], ['wasp', P(28, 3, 20)],
      ['brute', P(21, 1, 18)], ['sentry', P(20, 2, 20)], ['phantom', P(23, 2, 17)],
      ['drone', P(37, 2, 16)], ['drone', P(42, 1, 21)], ['drone', P(40, 3, 19)], ['wasp', P(39, 1, 16)], ['wasp', P(41, 2, 17)], ['minelayer', P(38, 3, 21)], ['leech', P(42, 0, 15)], ['leech', P(37, 0, 22)],
      ['warden', P(29, 7.5, 26)], ['phantom', P(27, 7, 25)], ['phantom', P(31, 7, 27)], ['sentry', P(26, 8, 28)], ['sentry', P(32, 8, 24)],
      ['brute', P(37, 5, 26)], ['brute', P(41, 6, 29)], ['phantom', P(39, 7, 25)], ['wasp', P(37, 8, 29)], ['wasp', P(41, 8, 25)], ['sentry', P(36, 8, 29)],
      // sector 4
      ['overseer', P(29, 6.5, 37)],
    ],
    pickups: [
      ['shield', P(4, 0, 0)], ['shield', P(12, 0, 3)], ['shield', P(8, 0, 8)], ['shield', P(0, 0, 11)], ['shield', P(-8, 2, 12)], ['shield', P(12, 4, 11)],
      ['spread', P(16, 4.2, 0)],
      ['missiles', P(10, 4.2, 9)],
      ['shield', P(19, 0, 12)], ['shield', P(19, -5, 13)], ['shield', P(32, 0, 11)], ['shield', P(27, -6, 3)], ['shield', P(36, -4, -2)],
      ['plasma', P(38, 0.2, 8)],
      ['missiles', P(38, -3.8, -1)],
      ['shield', P(33, 0, 16)], ['shield', P(43, 1, 22)], ['shield', P(32, 6, 28)], ['shield', P(41, 4, 29)], ['shield', P(24, 0, 17)],
      ['fusion', P(36, 4.2, 26)],
      ['overdrive', P(22, 0.3, 19)],
      ['missiles', P(26, 6.2, 24)],
      ['shield', P(25, 4, 40)], ['shield', P(33, 4, 32)], ['shield', P(33, 4, 40)], ['missiles', P(25, 4.2, 32)],
    ],
  };
}

// Briefings, objective lines and sector names live with each layout.
export const MISSIONS = [
  {
    name: 'PROSPECT STATION', layout: layoutProspect,
    text: 'A survey outpost has gone silent and its robots are firing on anything that moves. Take the red key from the lava cavern, break into the reactor, destroy it, and get back to the hangar before the mine blows.',
    sectors: { 1: 'Upper levels', 2: 'Lava cavern and lower works', 3: 'Reactor (red door)' },
    objectives: {
      start: 'Find the red key. Scans place it in a lava cavern east of the Upper Hall.',
      red: 'Red door: east side of the Crossroads. Destroy the reactor behind it.',
      escape: 'Escape! The exit is in the Hangar where you started.',
    },
  },
  {
    name: 'HEXAHEDRON DEEP WORKS', layout: layoutDeepWorks,
    text: 'Robots have overrun a deep mining outpost. Find the blue key to open the deep works, take the red key from the lava cavern, break into the reactor complex, destroy the reactor, and get out before the mine blows.',
    sectors: { 1: 'Upper works', 2: 'Deep works (blue door)', 3: 'Reactor complex (red door)' },
    objectives: {
      start: 'Find the blue access key. Survey drones last saw it in a crystal cave up north.',
      blue: 'Blue door: east side of the Junction. The red key is somewhere hot beyond it.',
      red: 'Red door: Ore Processing. Reach the reactor and destroy it.',
      escape: 'Escape! The exit is off the Security Checkpoint, back past the Turbine Hall.',
    },
  },
  {
    name: 'OVERSEER CITADEL', layout: layoutCitadel,
    text: 'The robots answer to something. Deep under the citadel a command unit called the Overseer is running the uprising. Work through three locked sectors with the blue, yellow and red keys, then destroy the Overseer and escape the collapse.',
    sectors: { 1: 'Landing levels', 2: 'Pump works (blue door)', 3: 'Thermal works (yellow door)', 4: "Overseer's arena (red door)" },
    objectives: {
      start: 'Find the blue key. A survey team lost it in the ice caverns west of the Cryo Lab.',
      blue: 'Blue door: east wall of the Observation Gallery. The yellow key is down in the drill gallery.',
      yellow: 'Yellow door: north side of the Smelter. The red key sits in the magma chamber beyond.',
      red: 'Red door: north end of the Turbine Spine, up the lift from the Coolant Plant. The Overseer waits beyond it.',
      escape: 'Escape! The escape shaft opens off the west wall of the arena.',
    },
  },
];

// Mission 2: the deep works. Blue key, then red key, eight robot types, every weapon.
function layoutDeepWorks(b) {
  const { region, box, hole, path, door, P } = b;
  const tunnel = (name, ...pts) => path(region(name, 'corridor'), ...pts);
  const mine = (name, ...pts) => path(region(name, 'mine'), ...pts);

  // ================= Sector 1: upper levels (open) =================
  const hangar = region('Hangar', 'hangar');            box(hangar, 0, 0, 0, 3, 1, 3);
  const junction = region('Junction', 'tech');          box(junction, 7, 0, 0, 10, 2, 4);
  hole(9, 0, 2, 9, 2, 2);
  const gallery = region('Pillar Gallery', 'gallery');  box(gallery, 6, 0, 8, 12, 1, 13);
  hole(8, 0, 10, 8, 1, 10); hole(10, 0, 10, 10, 1, 10); hole(8, 0, 12, 8, 1, 12); hole(10, 0, 12, 10, 1, 12);
  const armory = region('Armory', 'armory');            box(armory, 1, 0, 10, 3, 1, 12);
  const hall = region('Upper Hall', 'hall');            box(hall, 7, 5, 16, 11, 7, 20);
  hole(9, 5, 18, 9, 7, 18);
  const storage = region('Storage Bay', 'storage');     box(storage, 2, 5, 17, 4, 6, 19);
  const security = region('Security Station', 'hazard'); box(security, 7, 5, 23, 10, 6, 25);
  const grotto = region('Crystal Grotto', 'crystal');   box(grotto, -4, 3, 22, 2, 7, 28);
  hole(-2, 3, 24, -2, 5, 24); hole(0, 5, 26, 0, 7, 26); hole(1, 3, 23); hole(-4, 7, 28, -3, 7, 28); hole(2, 7, 22);
  const control = region('Control Room', 'lab');        box(control, 6, 4, -1, 10, 5, 2);
  const barracks = region('Barracks', 'quarters');      box(barracks, -6, 0, 4, -2, 1, 8);
  hole(-4, 0, 6);
  const mess = region('Mess Hall', 'quarters');         box(mess, -6, 0, 12, -2, 1, 16);

  tunnel('Hangar Tunnel', [4, 0, 2], [6, 0, 2]);
  tunnel('North Tunnel', [9, 0, 5], [9, 0, 7]);
  tunnel('Armory Tunnel', [5, 0, 11], [4, 0, 11]);
  tunnel('Lift Shaft', [9, 2, 13], [9, 6, 13], [9, 6, 15]);
  tunnel('Storage Tunnel', [6, 6, 18], [5, 6, 18]);
  tunnel('Security Tunnel', [9, 5, 21], [9, 5, 22]);
  tunnel('Grotto Tunnel', [6, 5, 24], [3, 5, 24]);
  tunnel('Junction Shaft', [8, 3, 1]);
  tunnel('Service Duct', [-4, 1, 3], [-4, 4, 3], [-4, 4, 0], [5, 4, 0]);
  tunnel('Quarters Tunnel', [-4, 0, 9], [-4, 0, 11]);
  mine('Mine Chute', [-3, 2, 22], [-3, 1, 22], [-3, 1, 17]);

  door([3, 0, 2], [4, 0, 2]);
  door([4, 0, 11], [3, 0, 11]);
  door([5, 6, 18], [4, 6, 18]);
  door([9, 5, 22], [9, 5, 23]);
  door([6, 5, 24], [7, 5, 24]);
  door([8, 3, 1], [8, 4, 1]);
  door([5, 4, 0], [6, 4, 0]);
  door([-4, 0, 11], [-4, 0, 12]);

  // ================= Sector 2: deep works (blue door) =================
  b.sector(2);
  const cross = region('Crossroads', 'tech');           box(cross, 14, 0, 4, 17, 2, 7);
  hole(15, 0, 5, 15, 2, 5);
  const pump = region('Pump Station', 'pump');          box(pump, 13, -5, 4, 17, -3, 9);
  hole(14, -5, 6, 14, -4, 6); hole(16, -4, 8, 16, -3, 8);
  const vault = region('Coolant Vault', 'cold');        box(vault, 13, -5, -4, 17, -3, 0);
  hole(14, -5, -3, 14, -3, -3); hole(16, -5, -3, 16, -3, -3);
  const drill = region('Drill Site', 'drill');          box(drill, 20, -6, 5, 25, -3, 10);
  hole(23, -6, 8, 23, -4, 8); hole(21, -3, 9); hole(25, -6, 5, 25, -5, 5); hole(20, -3, 10);
  const refinery = region('Refinery', 'foundry');       box(refinery, 20, -6, -3, 25, -4, 1);
  hole(21, -6, -1, 21, -5, -1); hole(24, -6, -1, 24, -5, -1);
  const foundry = region('Foundry', 'foundry');         box(foundry, 20, 0, 2, 25, 2, 7);
  hole(22, 0, 4, 23, 0, 5);
  const ore = region('Ore Processing', 'tech');         box(ore, 21, 0, 10, 25, 3, 13);
  hole(22, 0, 12, 22, 1, 12); hole(24, 0, 12, 24, 1, 12);
  const shaft = region('Mine Shaft', 'drill');          box(shaft, 27, 0, 11, 28, 8, 12);
  const lava = region('Red Key Cavern', 'lava');        box(lava, 15, 2, 15, 21, 6, 21);
  hole(17, 2, 17, 17, 3, 17); hole(19, 2, 19, 19, 4, 19); hole(20, 5, 16, 20, 6, 16); hole(16, 2, 20);

  tunnel('East Tunnel', [11, 1, 4], [13, 1, 4]);
  tunnel('Pump Hatch', [15, -1, 6], [15, -2, 6]);
  tunnel('Vault Tunnel', [15, -4, 3], [15, -4, 1]);
  mine('Drill Tunnel', [18, -4, 7], [19, -4, 7]);
  tunnel('Refinery Tunnel', [22, -5, 4], [22, -5, 2]);
  tunnel('Cargo Lift', [23, -3, 0], [23, -1, 0], [23, -1, 2]);
  tunnel('Foundry Tunnel', [18, 1, 5], [19, 1, 5]);
  tunnel('Ore Tunnel', [23, 1, 8], [23, 1, 9]);
  tunnel('Shaft Tunnel', [26, 1, 12]);
  mine('Cavern Passage', [27, 6, 13], [27, 6, 18], [22, 6, 18]);
  tunnel('Drop Tunnel', [16, 4, 14], [16, 4, 12], [16, 3, 12], [16, 3, 8]);

  door([13, 1, 4], [14, 1, 4], 'blue');
  door([15, 0, 6], [15, -1, 6]);
  door([15, -4, 1], [15, -4, 0]);
  door([22, -5, 2], [22, -5, 1]);
  door([23, -1, 2], [23, 0, 2]);
  door([19, 1, 5], [20, 1, 5]);
  door([23, 1, 9], [23, 1, 10]);
  door([22, 6, 18], [21, 6, 18]);
  door([16, 4, 15], [16, 4, 14], 'normal', { oneway: true });   // opens only from the cavern side

  // ================= Sector 3: reactor complex (red door) =================
  b.sector(3);
  const check = region('Security Checkpoint', 'hazard'); box(check, 21, 0, 23, 25, 2, 26);
  hole(23, 0, 24, 23, 0, 25);
  const turbine = region('Turbine Hall', 'pipes');       box(turbine, 20, 0, 29, 27, 5, 35);
  hole(22, 0, 31, 22, 5, 31); hole(25, 0, 31, 25, 5, 31); hole(22, 0, 33, 22, 5, 33); hole(25, 0, 33, 25, 5, 33);
  const exchanger = region('Heat Exchanger', 'pipes');   box(exchanger, 14, 0, 29, 18, 3, 33);
  hole(15, 0, 30, 15, 3, 30); hole(17, 0, 32, 17, 3, 32);
  const rcontrol = region('Reactor Control', 'lab');     box(rcontrol, 29, 3, 30, 32, 4, 33);
  const core = region('Reactor Core', 'reactor');        box(core, 21, -6, 30, 26, -3, 35);
  const exit = region('Exit Tunnel', 'exit');            path(exit, [20, 1, 24], [17, 1, 24], [17, 3, 24], [12, 3, 24]);

  tunnel('Red Tunnel', [23, 1, 14], [23, 1, 22]);
  tunnel('Turbine Tunnel', [23, 1, 27], [23, 1, 28]);
  tunnel('Control Tunnel', [28, 4, 32]);
  tunnel('Exchanger Tunnel', [19, 1, 31]);
  tunnel('Core Tunnel', [16, -1, 31], [16, -3, 31], [20, -3, 31]);

  door([23, 1, 13], [23, 1, 14], 'red');
  door([23, 1, 22], [23, 1, 23]);
  door([23, 1, 28], [23, 1, 29]);
  door([28, 4, 32], [29, 4, 32]);
  door([19, 1, 31], [18, 1, 31]);
  door([20, -3, 31], [21, -3, 31]);
  door([21, 1, 24], [20, 1, 24], 'exit');

  // Lava cavern is lit from below by the lava.
  for (const [x, z] of [[16, 16], [20, 18], [17.5, 20.5], [19.5, 15.5], [18, 18]]) b.light(lava, P(x, 1.75, z), [1.0, 0.42, 0.12], 1.35, 48);
  const reactorPos = P(23.5, -4.5, 32.5);
  b.light(core, reactorPos, [1.0, 0.3, 0.8], 0.9, 40);

  return {
    start: { pos: P(1, 0.1, 2), yaw: -Math.PI / 2 },
    exitCells: [[13, 3, 24], [12, 3, 24]],
    reactor: { pos: reactorPos },
    keys: { blue: P(-3, 3.3, 27), red: P(18, 1.95, 18) },
    enemies: [
      // sector 1: drones, leeches, sentries; wasps first appear in the grotto
      ['drone', P(8, 1, 3)], ['drone', P(10, 1.5, 0.5)], ['leech', P(7, 0, 4)],
      ['drone', P(7, 1, 9)], ['drone', P(11, 1, 11)], ['drone', P(9, 1, 11)], ['leech', P(11, 0, 13)], ['sentry', P(12, 1, 8)],
      ['sentry', P(3, 1, 10)], ['sentry', P(3, 1, 12)], ['leech', P(1, 0, 12)],
      ['drone', P(8, 6, 19)], ['drone', P(10, 6.5, 17)], ['drone', P(11, 7, 20)], ['leech', P(7, 5, 16)], ['sentry', P(11, 7, 16)],
      ['leech', P(3, 5, 17)], ['leech', P(3, 6, 19)], ['drone', P(4, 6, 17)],
      ['sentry', P(7, 6, 23)], ['sentry', P(10, 6, 25)], ['drone', P(8, 5, 24)], ['drone', P(10, 5, 23)],
      ['wasp', P(0, 6, 24)], ['wasp', P(1, 6, 25)], ['wasp', P(-1, 5, 27)], ['wasp', P(-2, 6, 26)],
      ['leech', P(-3, 4, 23)], ['leech', P(1, 4, 28)], ['drone', P(1, 7, 24)],
      ['drone', P(7, 5, 0)], ['drone', P(10, 4, -1)], ['sentry', P(10, 5, 2)],
      ['leech', P(-5, 0, 5)], ['leech', P(-3, 1, 7)], ['leech', P(-6, 1, 8)], ['drone', P(-2, 1, 4)],
      ['drone', P(-5, 1, 13)], ['drone', P(-3, 0, 15)], ['leech', P(-6, 0, 16)],
      // sector 2: brutes, minelayers and wasp swarms
      ['drone', P(14, 1, 6.5)], ['drone', P(17, 2, 4)], ['brute', P(16.5, 1, 6.5)],
      ['leech', P(13, -4, 5)], ['leech', P(17, -4, 7)], ['minelayer', P(14, -3, 9)],
      ['brute', P(15, -4, -1)], ['sentry', P(13, -3, -4)], ['sentry', P(17, -3, -4)],
      ['wasp', P(22, -4, 7)], ['wasp', P(23, -4, 6)], ['wasp', P(24, -3, 9)], ['wasp', P(21, -4, 10)], ['leech', P(25, -4, 6)], ['minelayer', P(24, -5, 9)],
      ['brute', P(22, -5, -2)], ['minelayer', P(25, -5, 1)], ['drone', P(20, -4, -3)],
      ['brute', P(21, 1, 6)], ['drone', P(24, 2, 3)], ['drone', P(25, 1, 7)], ['sentry', P(20, 2, 2)],
      ['minelayer', P(24, 2, 11)], ['wasp', P(21, 2, 11)], ['wasp', P(22, 3, 10)], ['wasp', P(25, 3, 13)], ['brute', P(21, 1, 13)],
      ['wasp', P(27, 4, 11)], ['wasp', P(28, 6, 12)], ['leech', P(27, 2, 12)], ['drone', P(28, 7, 11)],
      ['drone', P(18, 5, 17)], ['drone', P(20, 4, 20)], ['drone', P(16, 5, 20)], ['leech', P(19, 3, 16)], ['leech', P(18, 3, 20)],
      ['minelayer', P(17, 5, 16)], ['wasp', P(20, 5, 19)], ['wasp', P(19, 6, 21)],
      // sector 3: phantoms and wardens
      ['phantom', P(22, 1, 25)], ['phantom', P(25, 2, 23)], ['brute', P(24, 1, 26)], ['sentry', P(21, 2, 23)], ['sentry', P(25, 2, 26)],
      ['warden', P(23.5, 3.5, 34.5)], ['phantom', P(21, 2, 30)], ['phantom', P(26, 3, 30)], ['phantom', P(26, 1, 35)],
      ['wasp', P(24, 5, 29)], ['wasp', P(23, 5, 30)], ['wasp', P(21, 4, 35)], ['brute', P(27, 1, 33)],
      ['phantom', P(14, 2, 29)], ['phantom', P(18, 1, 33)], ['brute', P(14, 1, 32)],
      ['phantom', P(30, 4, 31)], ['sentry', P(32, 4, 33)], ['brute', P(29, 3, 30)],
      ['warden', P(25.5, -3.5, 35)], ['phantom', P(21, -3, 35)], ['phantom', P(26, -6, 30)], ['brute', P(21, -6, 30)],
    ],
    pickups: [
      ['shield', P(2.5, 0, 0)], ['shield', P(9, 0, 13)], ['shield', P(7, 5, 16)], ['shield', P(-6, 0, 8)],
      ['shield', P(10, 6, 24)], ['shield', P(-4, 4, 28)], ['shield', P(6, 4, -1)],
      ['spread', P(1, 0.2, 11)],
      ['missiles', P(2, 5.2, 18)],
      ['shield', P(14, 0, 4)], ['shield', P(15, -5, 7)], ['shield', P(17, -5, 9)], ['shield', P(25, -6, 10)],
      ['shield', P(20, -6, -3)], ['shield', P(25, 0, 7)], ['shield', P(21, 6, 21)], ['shield', P(28, 0, 11)],
      ['plasma', P(15, -4.2, -3)],
      ['missiles', P(25, -6, -3)],
      ['shield', P(25, 0, 26)], ['shield', P(27, 0, 35)], ['shield', P(14, 0, 33)], ['shield', P(29, 3, 33)],
      ['shield', P(21, -6, 35)], ['shield', P(26, -6, 35)],
      ['fusion', P(31, 3.2, 33)],
      ['missiles', P(18, 0, 29)],
      ['overdrive', P(16, 2, 30)],
    ],
  };
}

export function buildLevel(mission = MISSIONS[0]) {
  const regions = [];
  let curSector = 1;
  const cellMap = new Map();
  const doorDefs = [];
  const customLights = [];
  const P = (x, y, z) => [(x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S];

  const b = {
    P,
    region(name, theme) {
      const r = { id: regions.length, name, sector: curSector, theme: THEMES[theme], corridor: !!THEMES[theme].corridor, cells: [], lights: [], order: [] };
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
    sector(n) { curSector = n; },
    door(a, c, type = 'normal', opts = {}) { doorDefs.push({ a, b: c, type, ...opts }); },
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

  const meta = mission.layout(b);

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
    const door = { id, type: def.type, oneway: !!def.oneway, a, b: c, dir: d };
    a.doors[d] = door; c.doors[OPP[d]] = door;
    return door;
  });

  // ---- lattice: shared, jittered corners ----
  const latAmp = new Map();
  const latLavaFloor = new Set();
  for (const c of cells) {
    const amp = c.region.theme.amp || 0;
    for (let i = 0; i < 8; i++) {
      const k = ckey(c.x + (i & 1), c.y + ((i >> 1) & 1), c.z + ((i >> 2) & 1));
      latAmp.set(k, Math.min(latAmp.has(k) ? latAmp.get(k) : Infinity, amp));
      if (c.region.theme.lava && c.y === c.region.min[1] && ((i >> 1) & 1) === 0) latLavaFloor.add(k);
    }
  }
  // Chamfer: a corner on a convex edge of a man-made region (solid on at least two axes,
  // every touching cell in that one region) moves inward along each of those axes.
  const latOff = new Map();
  for (const c of cells) for (let n = 0; n < 8; n++) {
    const i = c.x + (n & 1), j = c.y + ((n >> 1) & 1), k = c.z + ((n >> 2) & 1);
    const key = ckey(i, j, k);
    if (latOff.has(key)) continue;
    let reg = null, mixed = false;
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let m = 0; m < 8; m++) {
      const o = cellMap.get(ckey(i - 1 + (m & 1), j - 1 + ((m >> 1) & 1), k - 1 + ((m >> 2) & 1)));
      if (!o) continue;
      if (reg && o.region !== reg) mixed = true;
      reg = o.region;
      for (let a = 0; a < 3; a++) if ((m >> a) & 1) hi[a] = 1; else lo[a] = 1;
    }
    const bv = reg.theme.bevel || 0;
    const s = [0, 1, 2].map(a => lo[a] && !hi[a] ? -1 : hi[a] && !lo[a] ? 1 : 0);
    latOff.set(key, !mixed && bv && s.filter(Boolean).length >= 2 ? s.map(v => v * bv) : null);
  }
  for (const door of doors) for (const p of faceLattice(door.a.x, door.a.y, door.a.z, door.dir)) { latAmp.set(ckey(...p), 0); latOff.set(ckey(...p), null); }
  const latPos = new Map();
  const lat = (i, j, k) => {
    const key = ckey(i, j, k);
    let p = latPos.get(key);
    if (!p) {
      const a = latAmp.get(key) || 0;
      let dy = hash3(i, j, k, 2) * a;
      if (latLavaFloor.has(key)) dy = -Math.abs(dy) * 0.5;
      const o = latOff.get(key) || [0, 0, 0];
      p = [i * S + hash3(i, j, k, 1) * a + o[0], j * S + dy + o[1], k * S + hash3(i, j, k, 3) * a + o[2]];
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
  const addLight = (r, pos, color, intensity, range, panelCell, lamp = false) => {
    const L = { x: pos[0], y: pos[1], z: pos[2], c: color, i: intensity, range, region: r, lamp };
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
        const ceil = !c.nbr[2], panel = ceil && th.panels !== false;
        addLight(r, [c.center[0], c.center[1] + (ceil ? S * 0.3 : 0), c.center[2]], th.light, th.li, S * 2.6, panel ? c : null, !panel);
      });
      continue;
    }
    if (th.lava) continue;
    const top = r.max[1];
    for (const xi of spots(r.max[0] - r.min[0] + 1)) for (const zi of spots(r.max[2] - r.min[2] + 1)) {
      const c = cellMap.get(ckey(r.min[0] + xi, top, r.min[2] + zi));
      if (!c || c.region !== r || c.nbr[2]) continue;
      const panel = th.panels !== false;
      addLight(r, [c.center[0], c.center[1] + S * (panel ? 0.36 : 0.22), c.center[2]], th.light, th.li, S * Math.max(4.2, 2.6 + (top - r.min[1] + 1) * 0.7), panel ? c : null, !panel);
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
  const pushTri = (a, c, e, n, lava, door) => { const t = makeTri(a, c, e, n, lava, door); tris.push(t); return t; };
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

  const { collideSphere, raycast, distToTri2 } = createPhysics(tris);

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

  const sampleLight = (p, cell, out = [0, 0, 0]) => evalLight(p.x, p.y, p.z, undefined, 0, 0, cell ? cell.region.relLights : [], out);

  return {
    S, regions, cells, cellMap, doors, groups, tris, lights, latPos,
    collideSphere, raycast, findCell, sampleLight, distToTri2,
    cellAt: (x, y, z) => cellMap.get(ckey(x, y, z)),
    ...meta,
  };
}

// A collision triangle with its edges precomputed. `door` makes it vanish while that door is open.
export function makeTri(a, c, e, n, lava = false, door = null) {
  return {
    ax: a[0], ay: a[1], az: a[2], bx: c[0], by: c[1], bz: c[2], cx: e[0], cy: e[1], cz: e[2],
    e1x: c[0] - a[0], e1y: c[1] - a[1], e1z: c[2] - a[2], e2x: e[0] - a[0], e2y: e[1] - a[1], e2z: e[2] - a[2],
    nx: n[0], ny: n[1], nz: n[2], lava, door, stamp: 0,
  };
}

// Sphere collision and ray casts over a triangle soup, bucketed in a world-space hash of S-sized cells.
export function createPhysics(tris) {
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

  const distToTri2 = (p, t) => { closest(p.x, p.y, p.z, t); return (p.x - q[0]) ** 2 + (p.y - q[1]) ** 2 + (p.z - q[2]) ** 2; };
  return { collideSphere, raycast, distToTri2 };
}
