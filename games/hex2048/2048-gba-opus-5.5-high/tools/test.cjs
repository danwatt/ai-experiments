// Headless test: boots the ROM in gb.js, plays random moves and checks every
// board/score against a JS model of the rules. Writes screenshots to
// build/*.png. Run: node tools/test.cjs [moves]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const GameBoy = require('../gb.js');

const root = path.join(__dirname, '..');
const rom = new Uint8Array(fs.readFileSync(path.join(root, 'hex2048.gb')));
const syms = {};
for (const line of fs.readFileSync(path.join(root, 'build/hex2048.sym'), 'utf8').split('\n')) {
  const m = line.match(/^([0-9a-f]+):([0-9a-f]+) (\S+)/i);
  if (m) syms[m[3]] = parseInt(m[2], 16);
}

const gb = new GameBoy(rom);
const peek = a => gb.read(a);
const frames = n => { for (let i = 0; i < n; i++) gb.runFrame(); };

const SHADES = [[224, 248, 208], [136, 192, 112], [52, 104, 86], [8, 24, 32]];
const SCALE = 3;
function png(file) {
  const w = 160 * SCALE, h = 144 * SCALE;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = SHADES[gb.fb[Math.floor(y / SCALE) * 160 + Math.floor(x / SCALE)]];
      raw.set(s, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', file), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ------------------------------------------------------------ rules model
const cells = [];
for (let r = -2; r <= 2; r++)
  for (let q = -2; q <= 2; q++)
    if (Math.abs(q + r) <= 2) cells.push([q, r]);
const idx = (q, r) => cells.findIndex(([a, b]) => a === q && b === r);
const DIRS = [[1, 0], [-1, 0], [1, -1], [0, -1], [0, 1], [-1, 1]];
const KEYS = [0x10, 0x20, 0x50, 0x60, 0x90, 0xA0]; // E W NE NW SE SW

function slide(board, d) {
  const [dq, dr] = DIRS[d];
  const out = board.slice();
  let gained = 0;
  for (const [q, r] of cells) {
    if (idx(q + dq, r + dr) !== -1) continue;
    const line = [];
    for (let cq = q, cr = r; idx(cq, cr) !== -1; cq -= dq, cr -= dr) line.push(idx(cq, cr));
    const vals = line.map(i => board[i]).filter(Boolean);
    const res = [];
    for (let i = 0; i < vals.length; i++) {
      if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
        res.push(vals[i] + 1); gained += 2 ** (vals[i] + 1); i++;
      } else res.push(vals[i]);
    }
    line.forEach((c, i) => { out[c] = res[i] || 0; });
  }
  return { out, gained, moved: out.some((v, i) => v !== board[i]) };
}
const canMove = b => DIRS.some((_, d) => slide(b, d).moved);

const board = () => Array.from({ length: 19 }, (_, i) => peek(syms.wBoard + i));
const bcd = a => {
  let s = '';
  for (let i = 3; i >= 0; i--) s += peek(a + i).toString(16).padStart(2, '0');
  return parseInt(s, 10);
};

// ------------------------------------------------------------ run
frames(40);
png('title.png');
gb.setKeys(0x08); frames(3); gb.setKeys(0); frames(20);
png('start.png');

let b0 = board();
if (b0.filter(Boolean).length !== 2) throw new Error('expected two starting tiles: ' + b0);

const moves = +(process.argv[2] || 400);
let errors = 0, games = 1, best = 0, maxTile = 0;
let rng = 12345;
const rand = n => { rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF; return rng % n; };

for (let m = 0; m < moves; m++) {
  if (peek(syms.wState) === 1) { // game over
    if (canMove(board())) { console.log('game over reported but moves exist', board()); errors++; }
    best = Math.max(best, bcd(syms.wScore));
    if (games === 1) png('gameover.png');
    gb.setKeys(0x08); frames(2); gb.setKeys(0); frames(20);
    games++;
    if (bcd(syms.wScore) !== 0) { console.log('score not reset'); errors++; }
    continue;
  }
  const before = board();
  const score0 = bcd(syms.wScore);
  // prefer moves that do something so games progress, like a player would
  let d = rand(6);
  for (let t = 0; t < 6 && !slide(before, d).moved; t++) d = (d + 1) % 6;
  const exp = slide(before, d);
  gb.setKeys(KEYS[d]); frames(2); gb.setKeys(0); frames(12);
  const after = board();
  const score1 = bcd(syms.wScore);
  if (score1 !== score0 + exp.gained) { console.log(`move ${m}: score ${score1} expected ${score0 + exp.gained}`); errors++; }
  if (!exp.moved) {
    if (after.join() !== before.join()) { console.log(`move ${m}: board changed on a no-op move`); errors++; }
    continue;
  }
  const diff = after.map((v, i) => [v, exp.out[i], i]).filter(([a, e]) => a !== e);
  if (diff.length !== 1 || diff[0][1] !== 0 || (diff[0][0] !== 1 && diff[0][0] !== 2)) {
    console.log(`move ${m} dir ${d}: mismatch`, { before, expected: exp.out, after });
    errors++;
    if (errors > 5) break;
  }
  maxTile = Math.max(maxTile, ...after);
  if (m === 60) png('midgame.png');
}
png('end.png');
console.log(`moves ${moves}, games ${games}, best score ${best}, max tile ${2 ** maxTile}, errors ${errors}`);
console.log('best in WRAM', bcd(syms.wBest), 'sram', Array.from(gb.eram.slice(0, 8)).map(x => x.toString(16)).join(' '));
process.exit(errors ? 1 : 0);
