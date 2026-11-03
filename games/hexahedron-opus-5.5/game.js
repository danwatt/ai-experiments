import * as THREE from 'three';
import { buildLevel, S } from './level.js';
import { makeTextures } from './textures.js';

const V3 = THREE.Vector3;
const X_AXIS = new V3(1, 0, 0), Y_AXIS = new V3(0, 1, 0), Z_AXIS = new V3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);

const level = buildLevel();
const { cells, doors } = level;

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x030305, 0.0045);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 1200);
scene.add(camera);

const headlight = new THREE.PointLight(0xfff1dc, 90, 65, 1.5);
camera.add(headlight);
const flashLights = [];
for (let i = 0; i < 4; i++) {
  const l = new THREE.PointLight(0xffffff, 0, 40, 1.6);
  l.userData.t = 0; l.userData.dur = 1; l.userData.power = 0;
  scene.add(l);
  flashLights.push(l);
}

const tex = makeTextures(renderer);
const baked = { value: new V3(1, 1, 1) };

// Lambert material whose baked per-vertex light (aLight) is added as emissive, so the
// headlight and flashes still add on top of the static room lighting.
function bakedMat(map, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ map, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBaked = baked;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLight;\nvarying vec3 vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLight;\nuniform vec3 uBaked;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLight * uBaked;');
  };
  return m;
}

for (const [name, g] of Object.entries(level.groups)) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('aLight', new THREE.Float32BufferAttribute(g.light, 3));
  geo.setIndex(g.idx);
  let mat;
  if (name === 'lava') mat = new THREE.MeshBasicMaterial({ map: tex.lava });
  else if (name === 'light') {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.light, 3));
    mat = new THREE.MeshBasicMaterial({ map: tex.light, vertexColors: true });
  } else mat = bakedMat(tex[name]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
}

// ---------------------------------------------------------------- doors
const doorMats = {
  normal: bakedMat(tex.door, { side: THREE.DoubleSide }),
  red: bakedMat(tex.door_red, { side: THREE.DoubleSide }),
  exit: bakedMat(tex.door_exit, { side: THREE.DoubleSide }),
};
for (const door of doors) {
  door.state = 'closed'; door.t = 0; door.warnT = 0;
  door.halves = [0, 1].map(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
    geo.setAttribute('aLight', new THREE.Float32BufferAttribute([...door.light, ...door.light, ...door.light, ...door.light], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([...door.normal, ...door.normal, ...door.normal, ...door.normal], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geo, doorMats[door.type]);
    scene.add(mesh);
    return mesh;
  });
  updateDoorGeometry(door);
}
function updateDoorGeometry(door) {
  const [c0, c1, c2, c3] = door.corners.map(p => new V3(...p));
  const k = 0.5 * (1 - door.t), t = door.t;
  const L = [c0, c0.clone().lerp(c1, k), c3.clone().lerp(c2, k), c3];
  const R = [c1.clone().lerp(c0, k), c1, c2, c2.clone().lerp(c3, k)];
  const uvL = [0.5 * t, 0, 0.5, 0, 0.5, 1, 0.5 * t, 1];
  const uvR = [0.5, 0, 1 - 0.5 * t, 0, 1 - 0.5 * t, 1, 0.5, 1];
  [[L, uvL], [R, uvR]].forEach(([pts, uv], i) => {
    const m = door.halves[i];
    const pa = m.geometry.attributes.position;
    pts.forEach((p, j) => pa.setXYZ(j, p.x, p.y, p.z));
    pa.needsUpdate = true;
    m.geometry.attributes.uv.array.set(uv);
    m.geometry.attributes.uv.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.visible = door.t < 0.999;
  });
}

// ---------------------------------------------------------------- audio
const AC = { ctx: null, master: null, noise: null, alarm: null };
function audioInit() {
  if (AC.ctx) { AC.ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  AC.ctx = new C();
  AC.master = AC.ctx.createGain(); AC.master.gain.value = 0.4; AC.master.connect(AC.ctx.destination);
  const len = AC.ctx.sampleRate;
  AC.noise = AC.ctx.createBuffer(1, len, AC.ctx.sampleRate);
  const d = AC.noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  if (!AC.ctx) return;
  const t = AC.ctx.currentTime + delay;
  const o = AC.ctx.createOscillator(), g = AC.ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, f0, f1, delay = 0) {
  if (!AC.ctx) return;
  const t = AC.ctx.currentTime + delay;
  const s = AC.ctx.createBufferSource(), f = AC.ctx.createBiquadFilter(), g = AC.ctx.createGain();
  s.buffer = AC.noise; s.loop = true;
  f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(AC.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
const distVol = (p) => 1 / (1 + p.distanceTo(player.pos) / 25);
const sfx = {
  laser: () => { tone('square', 1500, 380, 0.11, 0.07); tone('sawtooth', 900, 200, 0.09, 0.04); },
  spread: () => { tone('sawtooth', 700, 1400, 0.1, 0.05); tone('square', 500, 180, 0.13, 0.05); },
  missile: () => { noise(0.5, 0.25, 3000, 300); tone('sawtooth', 160, 60, 0.4, 0.08); },
  enemyShot: (p, f = 700) => tone('triangle', f, f * 0.3, 0.16, 0.12 * distVol(p)),
  boom: (p, big = 1) => { const v = distVol(p); noise(0.5 + big * 0.5, 0.55 * v * Math.min(1.5, big), 2400, 60); tone('sine', 120, 30, 0.4 + big * 0.3, 0.3 * v); },
  hit: () => noise(0.06, 0.12, 6000, 2000),
  wall: (p) => noise(0.05, 0.08 * distVol(p), 4000, 800),
  hurt: () => { tone('square', 220, 70, 0.22, 0.12); noise(0.15, 0.2, 2000, 200); },
  door: (p) => { const v = distVol(p); tone('sawtooth', 90, 45, 0.7, 0.12 * v); noise(0.7, 0.12 * v, 900, 200); },
  locked: () => { tone('square', 180, 170, 0.12, 0.08); tone('square', 140, 130, 0.14, 0.08, 0.14); },
  pickup: () => { tone('sine', 660, 660, 0.09, 0.15); tone('sine', 990, 990, 0.14, 0.15, 0.08); },
  key: () => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.16, i * 0.09)),
  weapon: () => [392, 523, 784].forEach((f, i) => tone('square', f, f * 1.01, 0.16, 0.08, i * 0.07)),
  sizzle: () => noise(0.25, 0.15, 5000, 1500),
};
function startAlarm() {
  if (!AC.ctx || AC.alarm) return;
  const o = AC.ctx.createOscillator(), lfo = AC.ctx.createOscillator(), lg = AC.ctx.createGain(), g = AC.ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = 520; lfo.frequency.value = 1.6; lg.gain.value = 160; g.gain.value = 0.035;
  lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(AC.master); o.start(); lfo.start();
  AC.alarm = { o, lfo, g };
}
function stopAlarm() { if (AC.alarm) { AC.alarm.o.stop(); AC.alarm.lfo.stop(); AC.alarm = null; } }

// ---------------------------------------------------------------- particles & flashes
class Particles {
  constructor(n, size) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.drag = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: tex.glow, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, count, speed, color, life, drag = 2, dir = null) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * rand(0.3, 1);
      vx = vx / l * sp; vy = vy / l * sp; vz = vz / l * sp;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      const j = rand(0.75, 1.1);
      this.base[i * 3] = c.r * j; this.base[i * 3 + 1] = c.g * j; this.base[i * 3 + 2] = c.b * j;
      this.life[i] = this.max[i] = life * rand(0.6, 1.2);
      this.drag[i] = drag;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -9999; this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] *= k; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.col[i3] = this.base[i3] * f; this.col[i3 + 1] = this.base[i3 + 1] * f; this.col[i3 + 2] = this.base[i3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
const sparks = new Particles(1500, 0.7);
const fire = new Particles(1200, 3.2);

function flash(p, color, power, dur) {
  let l = flashLights[0];
  for (const f of flashLights) if (f.userData.t <= 0) { l = f; break; } else if (f.userData.t < l.userData.t) l = f;
  l.position.copy(p); l.color.set(color);
  l.userData.t = l.userData.dur = dur; l.userData.power = power;
}
function explode(p, size, color = 0xff8a30) {
  fire.emit(p, Math.round(14 * size), 7 * size, color, 0.6 + 0.25 * size, 3);
  fire.emit(p, Math.round(6 * size), 3 * size, 0xfff0c0, 0.35, 3);
  sparks.emit(p, Math.round(20 * size), 22 * size, 0xffd080, 0.7, 1.5);
  flash(p, color, 260 * size, 0.35 + 0.15 * size);
  sfx.boom(p, size);
}
function glowSprite(color, scale, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(scale);
  return s;
}

// ---------------------------------------------------------------- HUD
const hud = {
  shield: $('shield-num'), shieldBar: $('shield-bar'), weapon: $('weapon'), missiles: $('missiles'), key: $('key'),
  msg: $('msg'), timer: $('timer'), hurt: $('hurt'), heat: $('heat'), pick: $('pick'), objective: $('objective'),
  map: $('map-ui'), room: $('room'),
};
let msgT = 0;
function msg(text, dur = 2.6) { hud.msg.textContent = text; hud.msg.style.opacity = 1; msgT = dur; }

// ---------------------------------------------------------------- player
const player = {
  pos: new V3(...level.start.pos), vel: new V3(), quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, level.start.yaw),
  r: 1.6, shield: 100, weapon: 0, hasSpread: false, missiles: 0, hasKey: false,
  fireCd: 0, missileCd: 0, gun: 1, spreadAxis: 0, cell: null, dead: false, roll: 0, hurt: 0, heat: 0, pick: 0, shake: 0, sizzleT: 0,
};
player.cell = level.findCell(player.pos);
const keys = {};
const input = { mdx: 0, mdy: 0, fire: false, missile: false };
let state = 'title';          // title | playing | paused | dead | won
let automap = false;
let gameTime = 0, kills = 0, countdown = -1;
const timers = [];
const after = (t, fn) => timers.push({ t, fn });

function damagePlayer(amount, from) {
  if (player.dead || state !== 'playing') return;
  player.shield -= amount;
  player.hurt = Math.min(0.8, player.hurt + amount / 22);
  player.shake = Math.min(1.2, player.shake + amount / 15);
  if (from !== 'lava') sfx.hurt();
  if (player.shield < 0) die('SHIP DESTROYED');
}
function die(reason) {
  if (player.dead) return;
  player.dead = true; player.shield = 0;
  explode(player.pos.clone().add(new V3(0, 0, -3).applyQuaternion(player.quat)), 3, 0xffa040);
  stopAlarm();
  after(1.4, () => {
    state = 'dead';
    $('dead-reason').textContent = reason;
    show('dead');
    document.exitPointerLock();
  });
}

const fwdOf = (q, out = new V3()) => out.set(0, 0, -1).applyQuaternion(q);

// ---------------------------------------------------------------- projectiles
const PK = {
  laser:    { color: 0x58b8ff, speed: 140, dmg: 10, rad: 0.3, life: 1.6, len: 2.4, glow: 2.2, w: 0.2 },
  spread:   { color: 0x7dff5a, speed: 120, dmg: 9, rad: 0.35, life: 1.6, len: 1.8, glow: 2.6, w: 0.25 },
  missile:  { color: 0xffe0b0, speed: 62, dmg: 60, rad: 0.5, life: 4, len: 1.4, glow: 2.8, w: 0.3, splash: 10, homing: 3.2 },
  bolt:     { color: 0xff3a1a, speed: 62, dmg: 6, rad: 0.4, life: 2.5, len: 1.8, glow: 2.6, w: 0.25 },
  plasma:   { color: 0xc050ff, speed: 30, dmg: 14, rad: 0.9, life: 5, len: 0.9, glow: 5, w: 0.9, homing: 0.9 },
  fireball: { color: 0xffa020, speed: 48, dmg: 9, rad: 0.8, life: 3, len: 1.0, glow: 4.5, w: 0.7 },
};
for (const k of Object.values(PK)) {
  k.geo = new THREE.BoxGeometry(k.w, k.w, k.len);
  k.mat = new THREE.MeshBasicMaterial({ color: k.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  k.glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: k.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}
const projectiles = [];
function spawnProjectile(kind, from, origin, dir, target = null) {
  const K = PK[kind];
  const mesh = new THREE.Mesh(K.geo, K.mat);
  const g = new THREE.Sprite(K.glowMat); g.scale.setScalar(K.glow); mesh.add(g);
  scene.add(mesh);
  const p = { kind, K, from, pos: origin.clone(), prev: from === 'player' ? player.pos.clone() : origin.clone(), vel: dir.clone().normalize().multiplyScalar(K.speed), life: K.life, mesh, target };
  if (from === 'player') p.vel.addScaledVector(player.vel, 0.5);
  orient(p);
  projectiles.push(p);
  return p;
}
const _d = new V3();
function orient(p) {
  p.mesh.position.copy(p.pos);
  _d.copy(p.vel).normalize();
  p.mesh.quaternion.setFromUnitVectors(Z_AXIS, _d);
}
function segSphere(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (fx * dx + fy * dy + fz * dz), C = fx * fx + fy * fy + fz * fz - r * r;
  if (C <= 0) return 0;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}
function killProjectile(i) {
  scene.remove(projectiles[i].mesh);
  projectiles[i] = projectiles[projectiles.length - 1];
  projectiles.pop();
}
const _hit = new V3();
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    if (p.life <= 0) { killProjectile(i); continue; }
    if (p.K.homing) {
      let tgt = null;
      if (p.from === 'enemy') tgt = player.dead ? null : player.pos;
      else if (p.target && p.target.alive) tgt = p.target.pos;
      if (tgt) {
        const sp = p.vel.length();
        _d.subVectors(tgt, p.pos).normalize();
        p.vel.normalize().lerp(_d, Math.min(1, p.K.homing * dt)).normalize().multiplyScalar(sp);
      }
    }
    if (p.kind === 'missile') { p.vel.multiplyScalar(1 + dt * 0.6); sparks.emit(p.pos, 2, 2, 0xffa050, 0.5, 2); }
    if (p.kind === 'plasma' || p.kind === 'fireball') fire.emit(p.pos, 1, 0.5, p.K.color, 0.35, 2);
    const start = p.prev.clone();
    p.pos.addScaledVector(p.vel, dt);

    // nearest of: wall, entity
    let bestT = 2, hitEnt = null;
    const wall = level.raycast(start, p.pos);
    const wallTri = wall ? wall.tri : null;
    if (wall) bestT = wall.t;
    if (p.from === 'player') {
      for (const e of enemies) {
        if (!e.alive) continue;
        const t = segSphere(start, p.pos, e.pos, e.T.r + p.K.rad);
        if (t >= 0 && t < bestT) { bestT = t; hitEnt = e; }
      }
      if (reactor.alive) {
        const t = segSphere(start, p.pos, reactor.pos, reactor.r + p.K.rad);
        if (t >= 0 && t < bestT) { bestT = t; hitEnt = reactor; }
      }
    } else if (!player.dead) {
      const t = segSphere(start, p.pos, player.pos, player.r + p.K.rad);
      if (t >= 0 && t < bestT) { bestT = t; hitEnt = player; }
    }
    if (bestT <= 1) {
      _hit.copy(start).lerp(p.pos, bestT);
      if (hitEnt === player) {
        damagePlayer(p.K.dmg);
        sparks.emit(_hit, 10, 12, p.K.color, 0.4);
      } else if (hitEnt) {
        hitEnt.damage(p.K.dmg);
        sparks.emit(_hit, 8, 14, p.K.color, 0.4);
        flash(_hit, p.K.color, 40, 0.12);
        sfx.hit();
      } else {
        _hit.addScaledVector(_d.copy(p.vel).normalize(), -0.3);
        sparks.emit(_hit, 7, 10, p.K.color, 0.35);
        flash(_hit, p.K.color, 30, 0.1);
        sfx.wall(_hit);
        if (wallTri.door && p.from === 'player') tryOpenDoor(wallTri.door, true);
      }
      if (p.K.splash) {
        explode(_hit, 1.4, 0xffa040);
        for (const e of [...enemies, reactor]) {
          if (!e.alive || e === hitEnt) continue;
          const d = e.pos.distanceTo(_hit);
          if (d < p.K.splash) e.damage(p.K.dmg * 0.7 * (1 - d / p.K.splash));
        }
      } else if (p.kind === 'plasma' || p.kind === 'fireball') {
        fire.emit(_hit, 10, 5, p.K.color, 0.5, 3);
        flash(_hit, p.K.color, 60, 0.2);
      }
      killProjectile(i);
      continue;
    }
    p.prev.copy(p.pos);
    orient(p);
  }
}

function firePrimary() {
  const q = player.quat;
  const fwd = fwdOf(q), right = new V3(1, 0, 0).applyQuaternion(q), up = new V3(0, 1, 0).applyQuaternion(q);
  const muzzle = (sx, sy) => player.pos.clone().addScaledVector(right, sx).addScaledVector(up, sy).addScaledVector(fwd, 0.6);
  if (player.weapon === 0) {
    for (const s of [-1, 1]) spawnProjectile('laser', 'player', muzzle(s * 0.9, -0.55), fwd);
    flash(muzzle(0, -0.5), PK.laser.color, 30, 0.07);
    sfx.laser();
    player.fireCd = 0.21;
  } else {
    const ax = player.spreadAxis ? up : right;
    player.spreadAxis ^= 1;
    for (const a of [-0.075, 0, 0.075]) spawnProjectile('spread', 'player', muzzle(0, -0.6), fwd.clone().addScaledVector(ax, a));
    flash(muzzle(0, -0.5), PK.spread.color, 34, 0.07);
    sfx.spread();
    player.fireCd = 0.27;
  }
}
function fireMissile() {
  if (player.missiles <= 0) { msg('NO MISSILES', 1); player.missileCd = 0.5; return; }
  const fwd = fwdOf(player.quat);
  let best = null, bestScore = 0.75;
  for (const e of [...enemies, reactor]) {
    if (!e.alive) continue;
    const to = e.pos.clone().sub(player.pos);
    const d = to.length();
    if (d > 140) continue;
    const s = to.normalize().dot(fwd);
    if (s > bestScore && !level.raycast(player.pos, e.pos)) { best = e; bestScore = s; }
  }
  player.missiles--;
  const origin = player.pos.clone().addScaledVector(new V3(0, -1, 0).applyQuaternion(player.quat), 0.8);
  spawnProjectile('missile', 'player', origin, fwd, best);
  sfx.missile();
  player.missileCd = 0.55;
}

// ---------------------------------------------------------------- doors logic
function tryOpenDoor(door, byPlayer) {
  if (door.state !== 'closed') return;
  const locked = door.type === 'red' && !player.hasKey ? 'RED KEY REQUIRED'
    : door.type === 'exit' && reactor.alive ? 'EXIT SEALED - DESTROY THE REACTOR' : null;
  if (locked) {
    if (byPlayer && door.warnT <= 0) { msg(locked, 2); sfx.locked(); door.warnT = 2.5; }
    return;
  }
  door.state = 'opening';
  sfx.door(new V3(...door.centroid));
  if (door.type === 'red') msg('RED DOOR UNLOCKED', 2);
}
const _dc = new V3();
function updateDoors(dt) {
  for (const door of doors) {
    door.warnT -= dt;
    if (door.state === 'closed') {
      _dc.set(...door.centroid);
      if (_dc.distanceToSquared(player.pos) < 100) {
        const r = player.r + 1.6;
        if (door.tris.some(t => level.distToTri2(player.pos, t) < r * r)) tryOpenDoor(door, true);
      }
    } else if (door.state === 'opening') {
      door.t = Math.min(1, door.t + dt * 1.5);
      door.solid = door.t < 0.55;
      if (door.t >= 1) { door.state = 'open'; door.solid = false; }
      updateDoorGeometry(door);
      mapDirty = true;
    }
  }
}

// ---------------------------------------------------------------- enemies
const lambert = (color, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });
const basic = (color) => new THREE.MeshBasicMaterial({ color });
const darkMetal = lambert(0x2c3038);
const MODELS = {
  drone() {
    const g = new THREE.Group(), body = lambert(0x9aa4b0);
    const hull = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), body); hull.scale.set(1.25, 0.6, 1.5); g.add(hull);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), basic(0xff3020)); eye.position.set(0, 0.06, -1.45); g.add(eye);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.9), darkMetal); w.position.set(s * 1.4, 0, 0.2); w.rotation.z = s * 0.35; g.add(w);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.9), basic(0xff5030)); tip.position.set(s * 2.1, 0.25 * 1, 0.2); g.add(tip);
    }
    const gl = glowSprite(0xff3020, 1.6, 0.8); gl.position.copy(eye.position); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x9aa4b0) };
  },
  brute() {
    const g = new THREE.Group(), body = lambert(0x76805a);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.9, 3.2), body); g.add(hull);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 2.2), body); top.position.y = 1.15; g.add(top);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 0.1), basic(0xc050ff)); visor.position.set(0, 0.35, -1.62); g.add(visor);
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 2.0, 10), darkMetal); c.rotation.x = Math.PI / 2; c.position.set(s * 1.75, -0.45, -1.2); g.add(c);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), basic(0xd070ff)); m.position.set(s * 1.75, -0.45, -2.2); g.add(m);
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), darkMetal); sh.position.set(s * 1.6, 0.6, 0.2); g.add(sh);
    }
    const th = glowSprite(0x60a0ff, 2.2, 0.8); th.position.set(0, 0, 1.8); g.add(th);
    const gl = glowSprite(0xc050ff, 2.4, 0.7); gl.position.set(0, 0.35, -1.7); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x76805a) };
  },
  leech() {
    const g = new THREE.Group(), body = lambert(0x8a9440, 0x1a2200);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), body); g.add(core);
    const spikeGeo = new THREE.ConeGeometry(0.2, 1.0, 6); spikeGeo.translate(0, 0.95, 0);
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const seen = new Set();
    for (let i = 0; i < ico.count; i++) {
      const v = new V3().fromBufferAttribute(ico, i).normalize();
      const k = v.toArray().map(n => n.toFixed(2)).join();
      if (seen.has(k)) continue; seen.add(k);
      const s = new THREE.Mesh(spikeGeo, darkMetal); s.quaternion.setFromUnitVectors(Y_AXIS, v); g.add(s);
    }
    for (const [x, y] of [[-0.3, 0.15], [0.3, 0.15], [0, -0.25]]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), basic(0xd8ff40)); e.position.set(x, y, -0.86); g.add(e);
    }
    const gl = glowSprite(0xc8ff40, 3, 0.45); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x8a9440) };
  },
};
const ET = {
  drone: { hp: 30, r: 1.8, speed: 15, turn: 4, prefer: 22, cd: [1.1, 1.9], shot: 'bolt', range: 85, boom: 1.1 },
  brute: { hp: 120, r: 2.7, speed: 6.5, turn: 1.8, prefer: 28, cd: [2.2, 3.0], shot: 'plasma', range: 95, boom: 2 },
  leech: { hp: 22, r: 1.5, speed: 22, turn: 6, melee: 11, boom: 0.9 },
};
const enemies = [];
function spawnEnemy(type, pos) {
  const T = ET[type], m = MODELS[type]();
  scene.add(m.g);
  const e = {
    type, T, ...m, pos: new V3(...pos), home: new V3(...pos), vel: new V3(), quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rand(0, 6.28)),
    hp: T.hp, alive: true, awake: false, los: false, lostT: 99, think: rand(0, 0.3), fireCd: rand(0.5, 1.5), meleeCd: 0,
    lastSeen: new V3(), cell: null, amb: [0.3, 0.3, 0.3], hitT: 0, phase: rand(0, 6.28), freq: rand(0.6, 1.2), side: new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
  };
  e.cell = level.findCell(e.pos);
  level.sampleLight(e.pos, e.cell, e.amb);
  e.damage = (dmg) => {
    if (!e.alive) return;
    e.hp -= dmg; e.hitT = 0.12; e.awake = true; e.lostT = 0; e.lastSeen.copy(player.pos);
    if (e.hp <= 0) killEnemy(e);
  };
  enemies.push(e);
}
function killEnemy(e) {
  e.alive = false;
  scene.remove(e.g);
  explode(e.pos, e.T.boom, e.type === 'brute' ? 0xd070ff : 0xff8a30);
  kills++;
  if (Math.random() < (e.type === 'brute' ? 0.6 : 0.2)) spawnPickup('shield', e.pos.toArray());
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _to = new V3(), _des = new V3(), _tmp = new V3(), _up = new V3();
function updateEnemy(e, dt) {
  const T = e.T;
  _to.subVectors(player.pos, e.pos);
  const dist = _to.length();
  e.think -= dt;
  if (e.think <= 0) {
    e.think = rand(0.15, 0.3);
    e.cell = level.findCell(e.pos, e.cell);
    e.los = !player.dead && dist < 110 && !level.raycast(e.pos, player.pos);
    if (e.los) {
      if (!e.awake) { e.awake = true; e.fireCd = rand(0.4, 1.2); }
      e.lastSeen.copy(player.pos); e.lostT = 0;
    }
    level.sampleLight(e.pos, e.cell, e.amb);
  }
  if (!e.los) e.lostT += dt;
  if (e.lostT > 14) e.awake = false;
  const dir = _to.clone().divideScalar(dist || 1);
  const tt = gameTime * e.freq + e.phase;
  if (e.awake && e.los) {
    if (e.type === 'leech') {
      if (e.meleeCd > 0.4) _des.copy(dir).multiplyScalar(-T.speed * 0.6);
      else _des.copy(dir).multiplyScalar(T.speed).add(_tmp.crossVectors(dir, e.side).normalize().multiplyScalar(Math.sin(tt * 4) * 6));
    } else {
      const radial = THREE.MathUtils.clamp((dist - T.prefer) / 10, -1, 1);
      _des.copy(dir).multiplyScalar(radial * T.speed);
      _des.add(_tmp.crossVectors(dir, e.side).normalize().multiplyScalar(Math.sin(tt) * T.speed * 0.7));
    }
  } else if (e.awake) {
    const next = flowNext(e.cell);
    const target = next ? _tmp.set(...next.center) : e.lastSeen;
    _des.subVectors(target, e.pos);
    if (_des.lengthSq() > 1) _des.normalize().multiplyScalar(T.speed * 0.85);
  } else {
    _des.subVectors(e.home, e.pos).multiplyScalar(0.6);
    _des.y += Math.sin(tt * 1.5) * 0.8;
  }
  e.vel.lerp(_des, 1 - Math.exp(-dt * 2.5));
  e.pos.addScaledVector(e.vel, dt);
  level.collideSphere(e.pos, e.vel, T.r, 0.3);

  // facing
  const look = e.los ? player.pos : _tmp.copy(e.pos).add(e.vel.lengthSq() > 1 ? e.vel : fwdOf(e.quat, _up));
  if (look.distanceToSquared(e.pos) > 0.01) {
    _up.set(0, 1, 0).applyQuaternion(e.quat);
    _m4.lookAt(e.pos, look, _up);
    _q.setFromRotationMatrix(_m4);
    e.quat.slerp(_q, 1 - Math.exp(-dt * T.turn));
  }
  if (e.type === 'leech') { _q.setFromAxisAngle(Z_AXIS, dt * 3); e.quat.multiply(_q); }

  // attack
  if (T.shot && e.awake && e.los && !player.dead) {
    e.fireCd -= dt;
    if (e.fireCd <= 0 && dist < T.range) {
      const fwd = fwdOf(e.quat, _tmp);
      if (fwd.dot(dir) > 0.86) {
        const origin = e.pos.clone().addScaledVector(fwd, T.r + 0.4);
        const aim = player.pos.clone().addScaledVector(player.vel, e.type === 'drone' ? dist / PK.bolt.speed * 0.6 : 0).sub(origin);
        spawnProjectile(T.shot, 'enemy', origin, aim);
        sfx.enemyShot(e.pos, e.type === 'brute' ? 260 : 760);
        e.fireCd = rand(...T.cd);
      }
    }
  }
  if (T.melee) {
    e.meleeCd -= dt;
    if (dist < T.r + player.r + 0.5 && e.meleeCd <= 0 && !player.dead) {
      damagePlayer(T.melee);
      player.vel.addScaledVector(dir, 14);
      e.vel.copy(dir).multiplyScalar(-18);
      e.meleeCd = 1.1;
      sparks.emit(e.pos.clone().addScaledVector(dir, T.r), 16, 14, 0xd8ff40, 0.5);
      tone('sawtooth', 300, 900, 0.15, 0.1);
    }
  }
  // keep apart from the player
  const minD = T.r + player.r;
  if (dist < minD && dist > 0.01) {
    const push = (minD - dist) * 0.5;
    e.pos.addScaledVector(dir, -push); player.pos.addScaledVector(dir, push);
  }

  e.hitT -= dt;
  const k = e.hitT > 0 ? 1 : 0;
  for (const m of e.mats) m.emissive.setRGB(
    e.baseColor.r * e.amb[0] * 0.8 + k, e.baseColor.g * e.amb[1] * 0.8 + k, e.baseColor.b * e.amb[2] * 0.8 + k);
  e.g.position.copy(e.pos);
  e.g.quaternion.copy(e.quat);
}
function separateEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i]; if (!a.alive) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j]; if (!b.alive) continue;
      const min = a.T.r + b.T.r;
      _tmp.subVectors(b.pos, a.pos);
      const d2 = _tmp.lengthSq();
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5 / d;
        a.pos.addScaledVector(_tmp, -push); b.pos.addScaledVector(_tmp, push);
      }
    }
  }
}

// Flow field: BFS from the player's cell; every cell points at its neighbour one step closer.
const flowParent = new Int32Array(cells.length).fill(-1);
const flowSeen = new Int32Array(cells.length);
let flowStamp = 0, flowT = 0;
function updateFlow() {
  if (!player.cell) return;
  flowStamp++;
  const q = [player.cell]; flowSeen[player.cell.idx] = flowStamp; flowParent[player.cell.idx] = -1;
  const depth = new Map([[player.cell, 0]]);
  for (let h = 0; h < q.length; h++) {
    const c = q[h], dep = depth.get(c);
    if (dep > 45) continue;
    for (let d = 0; d < 6; d++) {
      const nb = c.nbr[d];
      if (!nb || flowSeen[nb.idx] === flowStamp) continue;
      if (c.doors[d] && c.doors[d].solid) continue;
      flowSeen[nb.idx] = flowStamp; flowParent[nb.idx] = c.idx; depth.set(nb, dep + 1);
      q.push(nb);
    }
  }
}
const flowNext = (cell) => cell && flowSeen[cell.idx] === flowStamp && flowParent[cell.idx] >= 0 ? cells[flowParent[cell.idx]] : null;

// ---------------------------------------------------------------- reactor
const reactor = (() => {
  const g = new THREE.Group();
  const pos = new V3(...level.reactor.pos);
  g.position.copy(pos);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffa060 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 3), coreMat); g.add(core);
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.5, 1), new THREE.MeshBasicMaterial({ color: 0xff5020, wireframe: true, transparent: true, opacity: 0.6 })); g.add(shell);
  const glow = glowSprite(0xff7030, 16, 0.9); g.add(glow);
  const metal = lambert(0x5a6070, 0x15151a);
  const rings = [0, 1].map(i => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(4.6 + i * 0.7, 0.22, 8, 48), metal);
    g.add(r); return r;
  });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), metal); p.position.set(Math.cos(a) * 5.8, 0, Math.sin(a) * 5.8); g.add(p);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 7, 0.2), basic(0xff6040)); l.position.set(Math.cos(a) * 5.45, 0, Math.sin(a) * 5.45); g.add(l);
  }
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 17, 12), metal); bottom.position.y = -12; g.add(bottom);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 0.9, 17, 12), metal); top.position.y = 12; g.add(top);
  scene.add(g);
  const R = { g, pos, core, coreMat, shell, glow, rings, metal, hp: 320, maxHp: 320, r: 3.6, alive: true, cd: 2, burst: 0, burstT: 0, los: false, think: 0, hitT: 0, cell: level.findCell(pos) };
  R.damage = (dmg) => {
    if (!R.alive) return;
    R.hp -= dmg; R.hitT = 0.1;
    if (R.hp <= 0) destroyReactor();
  };
  return R;
})();
function destroyReactor() {
  reactor.alive = false;
  for (let i = 0; i < 9; i++) after(i * 0.22, () => explode(reactor.pos.clone().add(new V3(rand(-5, 5), rand(-5, 5), rand(-5, 5))), 1.6 + Math.random() * 1.5, i % 2 ? 0xffc060 : 0xff6030));
  after(2.1, () => { explode(reactor.pos, 5, 0xffe0a0); reactor.core.visible = false; reactor.glow.visible = false; reactor.shell.visible = false; player.shake = 1.5; });
  countdown = 50;
  msg('REACTOR DESTROYED! SELF-DESTRUCT IN 50 SECONDS - GET TO THE EXIT!', 5);
  hud.objective.textContent = 'Escape through the green exit door in the Hangar!';
  startAlarm();
}
function updateReactor(dt) {
  const R = reactor;
  R.rings[0].rotation.x += dt * 0.7; R.rings[0].rotation.y += dt * 0.4;
  R.rings[1].rotation.z += dt * 0.5; R.rings[1].rotation.x -= dt * 0.3;
  if (!R.alive) return;
  const pulse = 0.75 + 0.25 * Math.sin(gameTime * 5);
  R.coreMat.color.setRGB(1, 0.45 + 0.3 * pulse, 0.2 * pulse).multiplyScalar(R.hitT > 0 ? 1.6 : 1);
  R.hitT -= dt;
  R.shell.rotation.y += dt * 0.8;
  R.glow.material.opacity = 0.6 + 0.3 * pulse;
  R.think -= dt;
  const d = R.pos.distanceTo(player.pos);
  if (R.think <= 0) { R.think = 0.3; R.los = d < 75 && !player.dead && !level.raycast(R.pos, player.pos); }
  if (!R.los) return;
  R.cd -= dt;
  if (R.cd <= 0) { R.burst = 3; R.cd = rand(2.0, 2.8); }
  R.burstT -= dt;
  if (R.burst > 0 && R.burstT <= 0) {
    R.burst--; R.burstT = 0.16;
    const dir = player.pos.clone().sub(R.pos).normalize();
    const origin = R.pos.clone().addScaledVector(dir, 4.4);
    spawnProjectile('fireball', 'enemy', origin, dir.add(new V3(rand(-0.06, 0.06), rand(-0.06, 0.06), rand(-0.06, 0.06))));
    sfx.enemyShot(R.pos, 200);
  }
}

// ---------------------------------------------------------------- pickups
const pickups = [];
function spawnPickup(type, pos) {
  const g = new THREE.Group();
  if (type === 'shield') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), basic(0x4a90ff)));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 6, 24), basic(0xa0d0ff)));
    g.add(glowSprite(0x3a80ff, 4.5, 0.9));
  } else if (type === 'spread') {
    const body = lambert(0x4a5a48, 0x0a1a08);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.6), body));
    for (const a of [-0.35, 0, 0.35]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.8, 8), basic(0x80ff60));
      b.rotation.x = Math.PI / 2; b.rotation.z = a; b.position.set(Math.sin(a) * 0.9, 0.1, -1.1); g.add(b);
    }
    g.add(glowSprite(0x60ff40, 5, 0.8));
  } else if (type === 'missiles') {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8), lambert(0xb0b8c0, 0x202020));
      m.position.set((i % 2 - 0.5) * 0.5, (Math.floor(i / 2) - 0.5) * 0.5, 0); m.rotation.x = Math.PI / 2; g.add(m);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), basic(0xff4020));
      tip.position.set(m.position.x, m.position.y, -1.0); tip.rotation.x = -Math.PI / 2; g.add(tip);
    }
    g.add(glowSprite(0xff8040, 4.5, 0.7));
  } else if (type === 'key') {
    const m = basic(0xff2a1a);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.2, 8, 20), m));
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.8, 0.28), m); shaft.position.y = -1.5; g.add(shaft);
    for (const y of [-2.0, -2.35]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.28), m); t.position.set(0.3, y, 0); g.add(t); }
    g.add(glowSprite(0xff2010, 7, 1));
    g.scale.setScalar(1.2);
  }
  g.position.set(...pos);
  scene.add(g);
  pickups.push({ type, g, pos: new V3(...pos), base: pos[1], phase: rand(0, 6), alive: true, cell: level.findCell(new V3(...pos)) });
}
function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.alive) continue;
    p.g.rotation.y += dt * 1.8;
    p.g.position.y = p.base + Math.sin(gameTime * 2 + p.phase) * 0.35;
    if (p.g.position.distanceTo(player.pos) > player.r + 1.6 || player.dead) continue;
    if (p.type === 'shield') {
      if (player.shield >= 200) continue;
      player.shield = Math.min(200, player.shield + 25); msg('SHIELD BOOSTED TO ' + Math.ceil(player.shield), 1.6); sfx.pickup();
    } else if (p.type === 'spread') {
      player.hasSpread = true; player.weapon = 1; msg('SPREADFIRE CANNON! (press 2)', 3); sfx.weapon();
    } else if (p.type === 'missiles') {
      player.missiles += 8; msg('8 HOMING MISSILES! (right click)', 3); sfx.weapon();
    } else if (p.type === 'key') {
      player.hasKey = true; msg('RED ACCESS KEY ACQUIRED!', 3.5); sfx.key();
      hud.objective.textContent = 'Use the red key to reach the reactor. Destroy it.';
      mapDirty = true;
    }
    player.pick = 0.5;
    p.alive = false;
    scene.remove(p.g);
  }
}

// ---------------------------------------------------------------- visibility + automap
const seen = new Uint8Array(cells.length), visited = new Uint8Array(cells.length);
let mapDirty = true, visT = 0;
const visStamp = new Int32Array(cells.length);
let visS = 0;
const _cc = new V3();
function updateVisibility() {
  const start = player.cell;
  if (!start) return;
  visS++;
  const q = [start]; visStamp[start.idx] = visS;
  if (!visited[start.idx]) { visited[start.idx] = 1; mapDirty = true; }
  for (let h = 0; h < q.length && h < 600; h++) {
    const c = q[h];
    if (!seen[c.idx]) {
      _cc.set(...c.center);
      if (c === start || !level.raycast(player.pos, _cc)) { seen[c.idx] = 1; mapDirty = true; }
    }
    for (let d = 0; d < 6; d++) {
      const nb = c.nbr[d];
      if (!nb || visStamp[nb.idx] === visS) continue;
      if (c.doors[d] && c.doors[d].solid) continue;
      _cc.set(...nb.center);
      if (_cc.distanceToSquared(player.pos) > 130 * 130) continue;
      visStamp[nb.idx] = visS;
      q.push(nb);
    }
  }
}

const mapScene = new THREE.Scene();
mapScene.background = new THREE.Color(0x000004);
mapScene.fog = new THREE.Fog(0x000004, 60, 420);
const mapCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 3000);
const mapView = { yaw: 0, pitch: -0.6, dist: 110, target: new V3() };
let mapLines = null;
const mapMarkers = {
  player: (() => {
    const geo = new THREE.ConeGeometry(1.4, 4.5, 4); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffee40, fog: false }));
    m.add(glowSprite(0xffee40, 6, 0.6));
    return m;
  })(),
  reactor: new THREE.Mesh(new THREE.IcosahedronGeometry(3.5, 0), new THREE.MeshBasicMaterial({ color: 0xff40d0, wireframe: true })),
  key: new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshBasicMaterial({ color: 0xff2020 })),
};
for (const m of Object.values(mapMarkers)) mapScene.add(m);
mapMarkers.reactor.position.copy(reactor.pos);
const keyCell = level.findCell(new V3(...level.key.pos));
mapMarkers.key.position.set(...level.key.pos);
const DOOR_COL = { normal: 0xffc830, red: 0xff2a20, exit: 0x30ff60 };

function rebuildMap() {
  mapDirty = false;
  const edges = new Map();
  const add = (a, b, col, prio) => {
    const k = a < b ? a + ':' + b : b + ':' + a;
    const e = edges.get(k);
    if (!e || e.prio < prio) edges.set(k, { a, b, col, prio });
  };
  for (const c of cells) {
    if (!seen[c.idx]) continue;
    const vis = visited[c.idx];
    for (const f of c.faces) {
      if (f.type === 'open') continue;
      let col, prio;
      if (f.type === 'door') { col = DOOR_COL[f.door.type]; prio = 4; if (f.door.state === 'open') { col = new THREE.Color(col).multiplyScalar(0.45).getHex(); prio = 3; } }
      else if (f.lava) { col = vis ? 0xff6a20 : 0x8a3a12; prio = 2; }
      else { col = vis ? 0x3a86ff : 0x1c3f78; prio = vis ? 1 : 0; }
      for (let i = 0; i < 4; i++) add(f.lat[i], f.lat[(i + 1) % 4], col, prio);
      if (f.type === 'door' && f.door.state !== 'open') { add(f.lat[0], f.lat[2], col, prio); add(f.lat[1], f.lat[3], col, prio); }
    }
  }
  const pos = [], colArr = [], tc = new THREE.Color();
  for (const e of edges.values()) {
    pos.push(...level.latPos.get(e.a), ...level.latPos.get(e.b));
    tc.setHex(e.col);
    colArr.push(tc.r, tc.g, tc.b, tc.r, tc.g, tc.b);
  }
  if (mapLines) { mapScene.remove(mapLines); mapLines.geometry.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  mapLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
  mapScene.add(mapLines);
  mapMarkers.reactor.visible = !!(reactor.cell && seen[reactor.cell.idx]) && reactor.alive;
  mapMarkers.key.visible = !!(keyCell && seen[keyCell.idx]) && !player.hasKey;
}
function toggleMap() {
  automap = !automap;
  hud.map.style.display = automap ? 'block' : 'none';
  document.body.classList.toggle('mapping', automap);
  if (automap) {
    mapView.target.copy(player.pos);
    const f = fwdOf(player.quat);
    mapView.yaw = Math.atan2(-f.x, -f.z);
    mapView.pitch = -0.55; mapView.dist = 110;
    rebuildMap();
  }
}
function updateMap(dt) {
  if (mapDirty) rebuildMap();
  mapView.yaw -= input.mdx * 0.005;
  mapView.pitch = THREE.MathUtils.clamp(mapView.pitch - input.mdy * 0.005, -1.5, 1.5);
  input.mdx = input.mdy = 0;
  const cp = Math.cos(mapView.pitch);
  const off = new V3(Math.sin(mapView.yaw) * cp, -Math.sin(mapView.pitch), Math.cos(mapView.yaw) * cp);
  const fwd = off.clone().negate(), right = new V3().crossVectors(fwd, Y_AXIS).normalize();
  const pan = 80 * dt;
  if (keys.KeyW) mapView.target.addScaledVector(fwd, pan);
  if (keys.KeyS) mapView.target.addScaledVector(fwd, -pan);
  if (keys.KeyD) mapView.target.addScaledVector(right, pan);
  if (keys.KeyA) mapView.target.addScaledVector(right, -pan);
  if (keys.Space || keys.KeyR) mapView.target.y += pan;
  if (keys.ShiftLeft || keys.ShiftRight || keys.KeyF) mapView.target.y -= pan;
  mapCam.position.copy(mapView.target).addScaledVector(off, mapView.dist);
  mapCam.lookAt(mapView.target);
  mapMarkers.player.position.copy(player.pos);
  mapMarkers.player.quaternion.copy(player.quat);
  const s = 1 + 0.15 * Math.sin(performance.now() / 150);
  mapMarkers.player.scale.setScalar(s);
  mapMarkers.reactor.rotation.y += dt;
  mapMarkers.key.rotation.y += dt * 2;
}

// ---------------------------------------------------------------- player update
const colRes = {};
const THRUST = 72, DRAG = 2.4;
function updatePlayer(dt) {
  if (player.dead) { input.mdx = input.mdy = 0; return; }
  const sens = 0.0021;
  let yaw = -input.mdx * sens, pitch = -input.mdy * sens;
  input.mdx = input.mdy = 0;
  if (keys.ArrowLeft) yaw += 1.9 * dt;
  if (keys.ArrowRight) yaw -= 1.9 * dt;
  if (keys.ArrowUp) pitch -= 1.7 * dt;
  if (keys.ArrowDown) pitch += 1.7 * dt;
  const rollIn = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  player.roll += (rollIn * 2.3 - player.roll) * Math.min(1, dt * 7);
  _q.setFromAxisAngle(X_AXIS, pitch); player.quat.multiply(_q);
  _q.setFromAxisAngle(Y_AXIS, yaw); player.quat.multiply(_q);
  _q.setFromAxisAngle(Z_AXIS, player.roll * dt); player.quat.multiply(_q);
  player.quat.normalize();

  const fwd = fwdOf(player.quat), right = new V3(1, 0, 0).applyQuaternion(player.quat), up = new V3(0, 1, 0).applyQuaternion(player.quat);
  const acc = new V3()
    .addScaledVector(fwd, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0))
    .addScaledVector(right, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0))
    .addScaledVector(up, (keys.Space || keys.KeyR ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight || keys.KeyF ? 1 : 0));
  if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(THRUST);
  player.vel.addScaledVector(acc, dt).multiplyScalar(Math.exp(-DRAG * dt));

  const steps = Math.max(1, Math.ceil(player.vel.length() * dt / 0.6));
  let lava = false;
  for (let i = 0; i < steps; i++) {
    player.pos.addScaledVector(player.vel, dt / steps);
    level.collideSphere(player.pos, player.vel, player.r, 0.2, colRes);
    if (colRes.lava) lava = true;
    if (colRes.door) tryOpenDoor(colRes.door, true);
  }
  // reactor body
  const rd = player.pos.distanceTo(reactor.pos), rmin = 6.2 + player.r;
  if (rd < rmin) {
    const n = player.pos.clone().sub(reactor.pos).normalize();
    player.pos.addScaledVector(n, rmin - rd);
    const vn = player.vel.dot(n); if (vn < 0) player.vel.addScaledVector(n, -vn * 1.3);
  }
  if (lava) {
    damagePlayer(30 * dt, 'lava');
    player.vel.y += 30 * dt;
    player.heat = Math.min(1, player.heat + dt * 4);
    player.sizzleT -= dt;
    if (player.sizzleT <= 0) { sfx.sizzle(); player.sizzleT = 0.3; msg('HULL BURNING - GET OFF THE LAVA!', 1); }
    if (Math.random() < 0.5) fire.emit(player.pos.clone().add(new V3(0, -1.4, 0)), 1, 3, 0xff6020, 0.4);
  }

  player.cell = level.findCell(player.pos, player.cell);
  if (player.cell) hud.room.textContent = player.cell.region.name.toUpperCase();
  if (player.cell && countdown >= 0 && level.exitCells.some(([x, y, z]) => player.cell.x === x && player.cell.y === y && player.cell.z === z)) win();

  player.fireCd -= dt; player.missileCd -= dt;
  if (input.fire && player.fireCd <= 0) firePrimary();
  if (input.missile && player.missileCd <= 0) fireMissile();
}

function win() {
  state = 'won';
  stopAlarm();
  const t = Math.floor(gameTime);
  $('win-stats').innerHTML =
    `Time: ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}<br>Robots destroyed: ${kills} / ${enemies.length}<br>Shield remaining: ${Math.ceil(player.shield)}<br>Escape margin: ${countdown.toFixed(1)} s`;
  show('win');
  document.exitPointerLock();
}

// ---------------------------------------------------------------- main update
const lavaGroup = level.groups.lava;
function update(dt) {
  gameTime += dt;
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); } }
  updatePlayer(dt);
  updateDoors(dt);
  flowT -= dt; if (flowT <= 0) { flowT = 0.4; updateFlow(); }
  for (const e of enemies) if (e.alive) updateEnemy(e, dt);
  separateEnemies();
  updateReactor(dt);
  updateProjectiles(dt);
  updatePickups(dt);
  visT -= dt; if (visT <= 0) { visT = 0.15; updateVisibility(); }

  if (countdown >= 0 && state === 'playing') {
    countdown -= dt;
    const a = 0.6 + 0.4 * Math.cos(gameTime * 6);
    baked.value.set(1.15, a, a);
    if (Math.random() < dt * 1.5) player.shake = Math.max(player.shake, 0.5);
    if (countdown <= 0) { countdown = 0; baked.value.set(2, 1.6, 1.2); die('THE MINE EXPLODED WITH YOU INSIDE'); }
  }
}
function updateEffects(dt) {
  sparks.update(dt); fire.update(dt);
  for (const l of flashLights) {
    if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.power * Math.max(0, l.userData.t / l.userData.dur); }
    else l.intensity = 0;
  }
  tex.lava.offset.x = gameTime * 0.03; tex.lava.offset.y = Math.sin(gameTime * 0.4) * 0.08;
  player.hurt = Math.max(0, player.hurt - dt * 1.5);
  player.heat = Math.max(0, player.heat - dt * 2);
  player.pick = Math.max(0, player.pick - dt * 1.5);
  player.shake = Math.max(0, player.shake - dt * 2.2);
  msgT -= dt; if (msgT <= 0) hud.msg.style.opacity = 0;

  camera.position.copy(player.pos);
  camera.quaternion.copy(player.quat);
  if (player.shake > 0) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(player.shake * 0.25));

  hud.shield.textContent = Math.max(0, Math.ceil(player.shield));
  hud.shieldBar.style.width = Math.max(0, Math.min(100, player.shield / 2)) + '%';
  hud.shieldBar.style.background = player.shield < 30 ? '#ff4030' : player.shield < 60 ? '#ffb030' : '#40a0ff';
  hud.weapon.innerHTML = `<span class="${player.weapon === 0 ? 'sel' : ''}">1 LASER</span> <span class="${player.weapon === 1 ? 'sel' : player.hasSpread ? '' : 'na'}">2 SPREADFIRE</span>`;
  hud.missiles.textContent = `HOMING MISSILES: ${player.missiles}`;
  hud.key.style.display = player.hasKey ? 'block' : 'none';
  hud.hurt.style.opacity = player.hurt;
  hud.heat.style.opacity = player.heat * 0.7;
  hud.pick.style.opacity = player.pick * 0.6;
  if (countdown >= 0) { hud.timer.style.display = 'block'; hud.timer.textContent = countdown.toFixed(1); }
}

// ---------------------------------------------------------------- input & screens
function show(id) { for (const s of ['title', 'pause', 'dead', 'win']) $(s).style.display = s === id ? 'flex' : 'none'; }
function lock() { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
for (const id of ['title', 'pause']) $(id).addEventListener('click', () => { audioInit(); lock(); });
for (const id of ['dead', 'win']) $(id).addEventListener('click', () => location.reload());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    if (state === 'title' || state === 'paused') { state = 'playing'; show(null); }
  } else if (state === 'playing') { state = 'paused'; show('pause'); input.fire = false; input.missile = false; }
});
// Without pointer lock (unsupported or refused) fly with the free mouse instead.
let noLock = false;
document.addEventListener('pointerlockerror', () => {
  noLock = true;
  if (state === 'title' || state === 'paused') { state = 'playing'; show(null); }
});
addEventListener('mousemove', (e) => { if (document.pointerLockElement || (noLock && state === 'playing')) { input.mdx += e.movementX; input.mdy += e.movementY; } });
addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.missile = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; if (e.button === 2) input.missile = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (automap) mapView.dist = THREE.MathUtils.clamp(mapView.dist * Math.exp(e.deltaY * 0.001), 15, 600); }, { passive: true });
addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (state !== 'playing') return;
  if (e.code === 'Tab' || e.code === 'KeyM') toggleMap();
  if (e.code === 'Digit1') player.weapon = 0;
  if (e.code === 'Digit2') { if (player.hasSpread) player.weapon = 1; else msg("YOU DON'T HAVE THE SPREADFIRE YET", 1.5); }
  if (e.code === 'KeyG') input.missile = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyG') input.missile = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = mapCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); mapCam.updateProjectionMatrix();
});

// ---------------------------------------------------------------- start
for (const [type, pos] of level.enemies) spawnEnemy(type, pos);
for (const [type, pos] of level.pickups) spawnPickup(type, pos);
spawnPickup('key', level.key.pos);
updateVisibility();
show('title');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const running = state === 'playing' || (player.dead && state !== 'dead');
  if (automap && state === 'playing') {
    updateMap(dt);
    renderer.render(mapScene, mapCam);
  } else {
    if (running) update(dt);
    if (running || state === 'title') updateEffects(running ? dt : 0);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handle for debugging / automated checks
window.__game = { keys, input, THREE, scene, camera, headlight, baked, level, player, enemies, reactor, doors, pickups, seen, visited, toggleMap, get state() { return state; }, set state(s) { state = s; show(null); }, destroyReactor,
  step(sec, dt = 1 / 60) {
    for (let t = 0; t < sec && (state === 'playing' || player.dead); t += dt) { update(dt); updateEffects(dt); }
    renderer.render(scene, camera);
  },
  view(cell, yaw, pitch = 0) {
    state = 'playing'; show(null);
    player.pos.set((cell[0] + 0.5) * S, (cell[1] + 0.5) * S, (cell[2] + 0.5) * S); player.vel.set(0, 0, 0);
    player.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  },
};
