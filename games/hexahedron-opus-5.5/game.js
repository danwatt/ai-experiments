import * as THREE from 'three';
import { buildLevel, MISSIONS, S } from './level.js';
import { makeTextures } from './textures.js';
import { createMusic } from './music.js';
import { parseSong, levelSongs, createSongPlayer } from './midi.js';
import { createHolotank } from './holotank.js';
import { readHog, extractLevels, parseLevel, buildDescentLevel, loadImported, saveImported } from './descent.js';
import { createArt, parsePig } from './pig.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V3 = THREE.Vector3;
const X_AXIS = new V3(1, 0, 0), Y_AXIS = new V3(0, 1, 0), Z_AXIS = new V3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);

// ?mission=N picks the mission (1-based). Switching missions reloads the page. Imported
// Descent levels (kept in IndexedDB) follow the built-in missions in the list.
const imported = await loadImported();
const MISSION_COUNT = MISSIONS.length + (imported ? imported.levels.length : 0);
let missionIdx = (() => {
  const n = parseInt(new URLSearchParams(location.search).get('mission'), 10);
  return n >= 1 && n <= MISSION_COUNT ? n - 1 : 0;
})();
let level, MISSION, levelSong = null, importError = null;
if (missionIdx >= MISSIONS.length) {
  const L = imported.levels[missionIdx - MISSIONS.length];
  try {
    let art = null;
    if (imported.pig && imported.palette) {
      try { art = createArt(imported.pig, imported.palette, imported.bitmapsBin); } catch (err) { console.warn('Descent textures unavailable:', err); }
    }
    level = buildDescentLevel(parseLevel(L.data), { source: imported.source, file: L.name }, art);
    MISSION = level.mission;
    // The level's own song from the HOG, if it came with one; otherwise the built-in soundtrack.
    const songData = L.song && imported.songs && imported.songs[L.song];
    if (songData) {
      try { levelSong = parseSong(songData); levelSong.name = L.song; } catch (err) { console.warn('Level song unavailable:', err); }
    }
  } catch (err) {
    console.error(err);
    importError = `Could not load ${L.name}: ${err.message}`;
    missionIdx = 0;
  }
}
if (!level) { MISSION = MISSIONS[missionIdx]; level = buildLevel(MISSION); }
const importedLevel = missionIdx >= MISSIONS.length;
const { cells, doors } = level;
const exitCells = level.exitCellRefs || new Set(level.exitCells.map(([x, y, z]) => level.cellAt(x, y, z)));

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

// Post-processing: bloom on anything bright (shots, glows, light panels, lava), then a lens
// pass that adds a vignette and splits colour at the edges when the ship takes a hit.
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.95);
composer.addPass(bloom);
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAberr: { value: 0 }, uVignette: { value: 0.4 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAberr, uVignette; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * uAberr * (0.3 + r2 * 4.0);
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c.rgb *= 1.0 - uVignette * smoothstep(0.08, 0.5, r2);
      gl_FragColor = c;
    }`,
});
composer.addPass(lens);
composer.addPass(new OutputPass());
const lensKick = { v: 0 };
const flashLights = [];
for (let i = 0; i < 6; i++) {
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

// Imported Descent levels with a PIG: "d1:<base>:<overlay>" groups get the original bitmaps,
// merged once per base/overlay pair. Holes (grates) cut out with alphaTest.
const d1Mats = new Map();
function d1Mat(key, opts = {}) {
  const k = key + (opts.side ? ':2' : '');
  if (d1Mats.has(k)) return d1Mats.get(k);
  const [, t1, t2] = key.split(':').map(Number);
  const img = level.art.rgba(t1, t2);
  const t = new THREE.DataTexture(img.data, img.w, img.h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  const m = bakedMat(t, img.alpha ? { alphaTest: 0.5, side: THREE.DoubleSide, ...opts } : opts);
  d1Mats.set(k, m);
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
  } else if (name.startsWith('d1:')) mat = d1Mat(name);
  else mat = bakedMat(tex[name]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
}

// ---------------------------------------------------------------- doors
const doorMats = {
  normal: bakedMat(tex.door, { side: THREE.DoubleSide }),
  red: bakedMat(tex.door_red, { side: THREE.DoubleSide }),
  exit: bakedMat(tex.door_exit, { side: THREE.DoubleSide }),
  blue: bakedMat(tex.door_blue, { side: THREE.DoubleSide }),
  yellow: bakedMat(tex.door_yellow, { side: THREE.DoubleSide }),
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
    const mesh = new THREE.Mesh(geo, door.tex ? d1Mat(door.tex, { side: THREE.DoubleSide }) : doorMats[door.type]);
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
const AC = { ctx: null, master: null, noise: null, alarm: null, music: null };
let musicOn = true;
try { musicOn = localStorage.getItem('hexahedron-music') !== 'off'; } catch (e) { /* storage blocked */ }
function musicResume() {
  if (!AC.music) return;
  if (musicOn && !AC.music.playing) AC.music.start();
  AC.music.setVolume(1);
}
function audioInit() {
  if (AC.ctx) { AC.ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  AC.ctx = new C();
  AC.master = AC.ctx.createGain(); AC.master.gain.value = 0.4; AC.master.connect(AC.ctx.destination);
  AC.music = levelSong ? createSongPlayer(AC.ctx, AC.master, levelSong) : createMusic(AC.ctx, AC.master);
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
  plasma: () => { tone('sawtooth', 1100, 520, 0.07, 0.045); tone('sine', 1800, 900, 0.05, 0.03); },
  fusion: (k) => { tone('sawtooth', 220, 60, 0.5, 0.1 + 0.08 * k); noise(0.45, 0.2 + 0.2 * k, 3000, 200); tone('square', 880, 110, 0.35, 0.05); },
  charge: (k) => tone('sine', 180 + 520 * k, 200 + 540 * k, 0.12, 0.04),
  mine: (p) => tone('square', 1400, 1400, 0.04, 0.05 * distVol(p)),
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
// Point sprites grow without limit as they near the camera; fade them out up close so a
// puff drifting past the cockpit does not blank the screen.
function fadeNearCamera(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvNear = smoothstep(1.5, 7.0, -mvPosition.z);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <premultiplied_alpha_fragment>', '#include <premultiplied_alpha_fragment>\ngl_FragColor *= vNear;');
  };
  return mat;
}
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
    this.points = new THREE.Points(geo, fadeNearCamera(new THREE.PointsMaterial({
      size, map: tex.glow, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    })));
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

// Smoke: soft grey puffs blended normally (not added), fading out as they drift and slow.
class Smoke {
  constructor(n, size) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.shade = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, fadeNearCamera(new THREE.PointsMaterial({ size, map: tex.glow, vertexColors: true, transparent: true, depthWrite: false })));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, count, speed, shade, life, vel = null) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = p.x + rand(-0.3, 0.3); this.pos[i * 3 + 1] = p.y + rand(-0.3, 0.3); this.pos[i * 3 + 2] = p.z + rand(-0.3, 0.3);
      this.vel[i * 3] = rand(-1, 1) * speed + (vel ? vel.x : 0); this.vel[i * 3 + 1] = rand(-1, 1) * speed + 0.6 + (vel ? vel.y : 0); this.vel[i * 3 + 2] = rand(-1, 1) * speed + (vel ? vel.z : 0);
      this.life[i] = this.max[i] = life * rand(0.7, 1.3);
      this.shade[i] = shade * rand(0.8, 1.15);
    }
  }
  update(dt) {
    const k = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3, i4 = i * 4;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -9999; this.col[i4 + 3] = 0; continue; }
      this.vel[i3] *= k; this.vel[i3 + 1] *= k; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.col[i4] = this.col[i4 + 1] = this.col[i4 + 2] = this.shade[i]; this.col[i4 + 3] = Math.min(1, f * 2.2) * f * 0.45;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
const smoke = new Smoke(700, 3.4);

// Scorch marks: a dark blotch on the wall where a shot lands, with a hot glow that cools
// first. Oldest marks are reused once the pool is full.
const scorchTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const x = 32 + rand(-8, 8), y = 32 + rand(-8, 8), r = rand(14, 30);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const scorchGeo = new THREE.PlaneGeometry(1, 1);
const scorches = [];
let scorchNext = 0;
function scorch(p, n, size, hot) {
  let s = scorches[scorchNext];
  if (!s) {
    const mark = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: true }));
    const glow = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    glow.scale.setScalar(0.8);
    mark.add(glow);
    s = scorches[scorchNext] = { mark, glow, t: 0 };
    scene.add(mark);
  }
  scorchNext = (scorchNext + 1) % 90;
  s.mark.position.set(p.x + n.x * 0.04, p.y + n.y * 0.04, p.z + n.z * 0.04);
  s.mark.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
  s.mark.rotateZ(rand(0, 6.28));
  s.mark.scale.setScalar(size * rand(0.8, 1.2));
  s.glow.material.color.set(hot);
  s.t = 0; s.mark.visible = true;
}
function updateScorches(dt) {
  for (const s of scorches) {
    if (!s.mark.visible) continue;
    s.t += dt;
    s.glow.material.opacity = Math.max(0, 1 - s.t / 0.9);
    s.mark.material.opacity = s.t < 20 ? 1 : Math.max(0, 1 - (s.t - 20) / 8);
    if (s.t > 28) s.mark.visible = false;
  }
}

// Shockwave: a bright ring that blows outward from big explosions.
const ringTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const rings = [];
function shockwave(p, size, color) {
  let r = rings.find(x => x.t >= x.dur);
  if (!r) {
    if (rings.length >= 14) return;
    r = { s: new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })), t: 0, dur: 1 };
    rings.push(r); scene.add(r.s);
  }
  r.s.position.copy(p); r.s.material.color.set(color); r.s.material.rotation = rand(0, 6.28);
  r.t = 0; r.dur = 0.3 + size * 0.08; r.size = size; r.s.visible = true;
}
function updateRings(dt) {
  for (const r of rings) {
    if (r.t >= r.dur) { r.s.visible = false; continue; }
    r.t += dt;
    const f = Math.min(1, r.t / r.dur);
    r.s.scale.setScalar(r.size * (1.5 + 9 * Math.sqrt(f)));
    r.s.material.opacity = (1 - f) * 0.9;
  }
}

// Debris: a destroyed robot breaks into chunks that tumble, bounce off the walls and burn out.
const debris = [];
const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
function spawnDebris(e) {
  const n = Math.round(4 + e.T.r * 2.5);
  for (let i = 0; i < n; i++) {
    if (debris.length >= 90) { const old = debris.shift(); scene.remove(old.m); old.m.material.dispose(); }
    const mat = new THREE.MeshLambertMaterial({ color: e.baseColor.clone().multiplyScalar(0.7), emissive: new THREE.Color(0xff7020) });
    const m = new THREE.Mesh(debrisGeo, mat);
    const sz = e.T.r * rand(0.18, 0.42);
    m.scale.set(sz * rand(0.5, 1.4), sz * rand(0.3, 1), sz * rand(0.5, 1.4));
    m.position.copy(e.pos).add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(e.T.r * 0.5));
    m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(m);
    const vel = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 22)).addScaledVector(e.vel, 0.5);
    debris.push({ m, vel, spin: new V3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), r: Math.max(0.25, sz * 0.5), life: rand(2.2, 4.2), age: 0, burns: Math.random() < 0.6 });
  }
}
const _dres = {};
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.age += dt;
    if (d.age >= d.life) {
      sparks.emit(d.m.position, 6, 6, 0xffa050, 0.4);
      scene.remove(d.m); d.m.material.dispose(); debris.splice(i, 1);
      continue;
    }
    d.vel.multiplyScalar(Math.exp(-0.7 * dt));
    d.m.position.addScaledVector(d.vel, dt);
    level.collideSphere(d.m.position, d.vel, d.r, 0.45, _dres);
    if (_dres.hit) d.spin.multiplyScalar(0.85);
    d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
    const heat = Math.max(0, 1 - d.age / (d.life * 0.8));
    d.m.material.emissive.setRGB(1.6 * heat * heat, 0.55 * heat * heat * heat, 0.1 * heat * heat * heat);
    if (d.burns && Math.random() < dt * 30 * heat) fire.emit(d.m.position, 1, 0.6, 0xff7a20, 0.35, 2);
    if (Math.random() < dt * 14) smoke.emit(d.m.position, 1, 0.4, 0.04 + 0.05 * (1 - heat), 1.4);
  }
}

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
  smoke.emit(p, Math.round(5 + 6 * size), 2 + size, 0.05, 1.4 + 0.5 * size);
  if (size >= 1.2) shockwave(p, size, color);
  flash(p, color, 260 * size, 0.35 + 0.15 * size);
  const near = Math.max(0, 1 - p.distanceTo(player.pos) / (25 + size * 8));
  lensKick.v = Math.max(lensKick.v, near * size * 0.012);
  sfx.boom(p, size);
}
function glowSprite(color, scale, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(scale);
  return s;
}

// Rooms without ceiling panels get free-standing lamps; the grotto's lamps are crystal clusters.
{
  const crystalGeo = new THREE.OctahedronGeometry(1, 0);
  const crystalMat = new THREE.MeshBasicMaterial({ color: 0x78d8ff });
  for (const L of level.lights) {
    if (!L.lamp) continue;
    const col = new THREE.Color(...L.c);
    const crystal = L.region.theme.crystals;
    const s = glowSprite(col, crystal ? 10 : 3.5, crystal ? 0.55 : 0.9);
    s.position.set(L.x, L.y, L.z);
    scene.add(s);
    if (crystal) for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(crystalGeo, crystalMat);
      m.scale.set(rand(0.35, 0.6), rand(1.6, 3.2), rand(0.35, 0.6));
      m.position.set(L.x + rand(-1.8, 1.8), L.y + rand(0.5, 2), L.z + rand(-1.8, 1.8));
      m.rotation.set(rand(-0.4, 0.4), rand(0, 3), rand(-0.4, 0.4));
      scene.add(m);
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.8, 8), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4) }));
      m.position.set(L.x, L.y, L.z);
      scene.add(m);
    }
  }
}

// ---------------------------------------------------------------- HUD
const hud = {
  shield: $('shield-num'), shieldBar: $('shield-bar'), weapon: $('weapon'), missiles: $('missiles'), keyEls: { blue: $('key-blue'), yellow: $('key-yellow'), red: $('key-red') },
  boss: $('boss'), bossBar: $('boss-bar'),
  msg: $('msg'), timer: $('timer'), hurt: $('hurt'), heat: $('heat'), pick: $('pick'), power: $('power'), powerTime: $('power-time'), objective: $('objective'),
  map: $('map-ui'), room: $('room'),
};
let msgT = 0;
function msg(text, dur = 2.6) { hud.msg.textContent = text; hud.msg.style.opacity = 1; msgT = dur; }

// ---------------------------------------------------------------- player
const player = {
  pos: new V3(...level.start.pos), vel: new V3(), quat: level.start.basis
    ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...level.start.basis.map(v => new V3(...v))))
    : new THREE.Quaternion().setFromAxisAngle(Y_AXIS, level.start.yaw),
  r: 1.6, shield: 100, weapon: 0, has: [true, false, false, false], missiles: 0, keys: { blue: false, yellow: false, red: false },
  fireCd: 0, missileCd: 0, gun: 1, spreadAxis: 0, charge: 0, chargeSnd: 0, overdrive: 0, cell: null, dead: false, roll: 0, hurt: 0, heat: 0, pick: 0, shake: 0, sizzleT: 0,
};
player.cell = level.findCell(player.pos);
const keys = {};
const input = { mdx: 0, mdy: 0, fire: false, missile: false };
let state = 'title';          // title (main menu) | holo | playing | paused | dead | won
let automap = false;
let gameTime = 0, kills = 0, countdown = -1;
const timers = [];
const after = (t, fn) => timers.push({ t, fn });

function damagePlayer(amount, from) {
  if (player.dead || state !== 'playing') return;
  if (player.overdrive > 0) { if (!from) tone('sine', 1500, 2200, 0.08, 0.05); return; }
  player.shield -= amount;
  player.hurt = Math.min(0.8, player.hurt + amount / 22);
  player.shake = Math.min(1.2, player.shake + amount / 15);
  if (!from) sfx.hurt();
  if (player.shield < 0) die('SHIP DESTROYED');
}
function die(reason) {
  if (player.dead) return;
  if (AC.music) AC.music.stop(2.5);
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
const WEAPONS = ['LASER', 'SPREADFIRE', 'PLASMA', 'FUSION'];
const KEY_COLORS = { blue: 0x2a7aff, yellow: 0xffc81a, red: 0xff2a1a };
const OBJECTIVES = MISSION.objectives;
const chargeGlow = glowSprite(0xc070ff, 1, 0.9);
chargeGlow.position.set(0, -0.7, -3);
chargeGlow.visible = false;
camera.add(chargeGlow);

// ---------------------------------------------------------------- projectiles
const PK = {
  laser:    { color: 0x58b8ff, speed: 140, dmg: 10, rad: 0.3, life: 1.6, len: 2.4, glow: 2.2, w: 0.2 },
  spread:   { color: 0x7dff5a, speed: 120, dmg: 9, rad: 0.35, life: 1.6, len: 1.8, glow: 2.6, w: 0.25 },
  missile:  { color: 0xffe0b0, speed: 62, dmg: 60, rad: 0.5, life: 4, len: 1.4, glow: 2.8, w: 0.3, splash: 10, homing: 3.2 },
  bolt:     { color: 0xff3a1a, speed: 62, dmg: 6, rad: 0.4, life: 2.5, len: 1.8, glow: 2.6, w: 0.25 },
  plasma:   { color: 0xc050ff, speed: 30, dmg: 14, rad: 0.9, life: 5, len: 0.9, glow: 5, w: 0.9, homing: 0.9 },
  fireball: { color: 0xffa020, speed: 48, dmg: 9, rad: 0.8, life: 3, len: 1.0, glow: 4.5, w: 0.7 },
  pplasma:  { color: 0x40ffd8, speed: 165, dmg: 11, rad: 0.3, life: 1.3, len: 2.0, glow: 2.6, w: 0.24 },
  fusion:   { color: 0xc070ff, speed: 115, dmg: 40, rad: 1.0, life: 2.2, len: 2.6, glow: 7, w: 0.9, pierce: true, splash: 7 },
  needle:   { color: 0xffe040, speed: 90, dmg: 4, rad: 0.3, life: 1.6, len: 1.4, glow: 1.8, w: 0.15 },
  lance:    { color: 0x60e0ff, speed: 95, dmg: 11, rad: 0.35, life: 2.0, len: 3.0, glow: 2.6, w: 0.2 },
  rocket:   { color: 0xffb060, speed: 40, dmg: 11, rad: 0.6, life: 4.5, len: 1.4, glow: 3, w: 0.35, homing: 1.1 },
};
for (const k of Object.values(PK)) {
  k.geo = new THREE.BoxGeometry(k.w, k.w, k.len);
  k.mat = new THREE.MeshBasicMaterial({ color: k.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  k.glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: k.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}
const projectiles = [];
// Everything the player's shots can hit.
function* targets() {
  for (const e of enemies) if (e.alive) yield e;
  for (const m of mines) if (m.alive) yield m;
  if (reactor.alive) yield reactor;
}
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
const _hit = new V3(), _hn = new V3();
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
    if (p.kind === 'missile') p.vel.multiplyScalar(1 + dt * 0.6);
    if (p.kind === 'missile' || p.kind === 'rocket') {
      sparks.emit(p.pos, 2, 2, 0xffa050, 0.5, 2);
      if (Math.random() < dt * 45 && p.K.life - p.life > 0.12) smoke.emit(p.pos, 1, 0.5, p.kind === 'missile' ? 0.1 : 0.07, 1.6);
    }
    if (p.kind === 'plasma' || p.kind === 'fireball' || p.kind === 'fusion') fire.emit(p.pos, 1, 0.5, p.K.color, 0.35, 2);
    const start = p.prev.clone();
    p.pos.addScaledVector(p.vel, dt);

    // nearest of: wall, entity
    let bestT = 2, hitEnt = null;
    const wall = level.raycast(start, p.pos);
    const wallTri = wall ? wall.tri : null;
    if (wall) bestT = wall.t;
    const dmg = p.dmg ?? p.K.dmg;
    if (p.from === 'player') {
      const wallT = bestT;
      for (const e of targets()) {
        if (p.hitSet && p.hitSet.has(e)) continue;
        const t = segSphere(start, p.pos, e.pos, e.T.r + p.K.rad);
        if (t < 0 || t >= wallT) continue;
        if (p.hitSet) {   // piercing: damage everything along the path, keep flying
          p.hitSet.add(e); e.damage(dmg);
          _hit.copy(start).lerp(p.pos, t);
          sparks.emit(_hit, 16, 18, p.K.color, 0.5); flash(_hit, p.K.color, 80, 0.15); sfx.hit();
        } else if (t < bestT) { bestT = t; hitEnt = e; }
      }
    } else if (!player.dead) {
      const t = segSphere(start, p.pos, player.pos, player.r + p.K.rad);
      if (t >= 0 && t < bestT) { bestT = t; hitEnt = player; }
    }
    if (bestT <= 1) {
      _hit.copy(start).lerp(p.pos, bestT);
      if (hitEnt === player) {
        damagePlayer(dmg);
        sparks.emit(_hit, 10, 12, p.K.color, 0.4);
      } else if (hitEnt) {
        hitEnt.damage(dmg);
        sparks.emit(_hit, 8, 14, p.K.color, 0.4);
        flash(_hit, p.K.color, 40, 0.12);
        sfx.hit();
      } else {
        _d.copy(p.vel).normalize();
        _hn.set(wallTri.nx, wallTri.ny, wallTri.nz);
        if (_hn.dot(_d) > 0) _hn.negate();
        if (!wallTri.door) scorch(_hit, _hn, p.K.splash ? 4.5 : 0.6 + p.K.rad * 1.6, p.K.color);
        _hit.addScaledVector(_d, -0.3);
        sparks.emit(_hit, 7, 10, p.K.color, 0.35, 2, _hn.multiplyScalar(9));
        flash(_hit, p.K.color, 30, 0.1);
        sfx.wall(_hit);
        if (wallTri.door && p.from === 'player') tryOpenDoor(wallTri.door, true);
      }
      if (p.K.splash) {
        explode(_hit, 1.4, p.kind === 'fusion' ? 0xc070ff : 0xffa040);
        for (const e of targets()) {
          if (e === hitEnt) continue;
          const d = e.pos.distanceTo(_hit);
          if (d < p.K.splash) e.damage(dmg * 0.7 * (1 - d / p.K.splash));
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
  } else if (player.weapon === 2) {
    player.gun = -player.gun;
    spawnProjectile('pplasma', 'player', muzzle(player.gun * 0.8, -0.5), fwd);
    flash(muzzle(0, -0.5), PK.pplasma.color, 24, 0.05);
    sfx.plasma();
    player.fireCd = 0.085;
  } else if (player.weapon === 3) {
    const k = Math.min(1, player.charge / 1.4);
    const p = spawnProjectile('fusion', 'player', muzzle(0, -0.6), fwd);
    p.dmg = 30 + 110 * k; p.hitSet = new Set();
    p.mesh.scale.setScalar(0.6 + 0.8 * k);
    flash(muzzle(0, -0.5), PK.fusion.color, 60 + 120 * k, 0.15);
    player.vel.addScaledVector(fwd, -10 * k);
    player.shake = Math.max(player.shake, 0.3 * k);
    sfx.fusion(k);
    player.fireCd = 0.45;
  } else {
    const ax = player.spreadAxis ? up : right;
    player.spreadAxis ^= 1;
    for (const a of [-0.075, 0, 0.075]) spawnProjectile('spread', 'player', muzzle(0, -0.6), fwd.clone().addScaledVector(ax, a));
    flash(muzzle(0, -0.5), PK.spread.color, 34, 0.07);
    sfx.spread();
    player.fireCd = 0.27;
  }
  if (player.overdrive > 0) player.fireCd *= 0.5;
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
  player.missileCd = player.overdrive > 0 ? 0.28 : 0.55;
}

// ---------------------------------------------------------------- doors logic
function tryOpenDoor(door, byPlayer) {
  if (door.state !== 'closed') return;
  _dc.set(...door.centroid);
  const sideA = _dc.subVectors(player.pos, _dc).dot(_dn.set(...door.normal)) > 0;
  const locked = KEY_COLORS[door.type] && !player.keys[door.type] ? door.type.toUpperCase() + ' KEY REQUIRED'
    : door.type === 'exit' && reactor.alive ? 'EXIT SEALED - DESTROY THE REACTOR'
    : door.type === 'exit' && boss && boss.alive ? 'EXIT SEALED - DESTROY THE OVERSEER'
    : door.oneway && !sideA ? 'THIS DOOR OPENS FROM THE OTHER SIDE' : null;
  if (locked) {
    if (byPlayer && door.warnT <= 0) { msg(locked, 2); sfx.locked(); door.warnT = 2.5; }
    return;
  }
  door.state = 'opening';
  sfx.door(new V3(...door.centroid));
  if (KEY_COLORS[door.type]) msg(door.type.toUpperCase() + ' DOOR UNLOCKED', 2);
}
const _dc = new V3(), _dn = new V3();
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
  sentry() {
    const g = new THREE.Group(), body = lambert(0x8a8478);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), body));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.18, 8, 24), darkMetal); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (const [x, y] of [[-0.45, 0.25], [0.45, 0.25], [0, -0.4]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.4, 8), darkMetal); b.rotation.x = Math.PI / 2; b.position.set(x, y, -1.5); g.add(b);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), basic(0xffa020)); eye.position.set(0, 0.05, -1.22); g.add(eye);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 2.2, 8), darkMetal); stalk.position.y = -1.9; g.add(stalk);
    const gl = glowSprite(0xffa020, 1.8, 0.8); gl.position.copy(eye.position); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x8a8478) };
  },
  wasp() {
    const g = new THREE.Group(), body = lambert(0xc8a030);
    const hull = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), body); hull.scale.set(1, 0.8, 1.6); g.add(hull);
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 6), darkMetal); sting.rotation.x = -Math.PI / 2; sting.position.z = -1.1; g.add(sting);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), wingMat); w.rotation.x = -Math.PI / 2; w.position.set(s * 0.9, 0.3, 0.2); w.rotation.z = s * 0.3; g.add(w); }
    const gl = glowSprite(0xffe040, 1.6, 0.7); gl.position.z = -0.7; g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0xc8a030) };
  },
  minelayer() {
    const g = new THREE.Group(), body = lambert(0x8a4a38);
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 1.3, 6), body); g.add(hull);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), darkMetal); dome.position.y = 0.6; g.add(dome);
    const hopper = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.2), darkMetal); hopper.position.set(0, -0.2, 1.9); g.add(hopper);
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), basic(0xff3020)); m.position.set((i - 1) * 0.5, 0.2, 2.5); g.add(m); }
    const eye = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.1), basic(0xff7020)); eye.position.set(0, 0.1, -1.95); g.add(eye);
    const gl = glowSprite(0xff6020, 2, 0.7); gl.position.copy(eye.position); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x8a4a38) };
  },
  phantom() {
    const g = new THREE.Group();
    const op = { transparent: true, opacity: 0.1, depthWrite: false };
    const body = new THREE.MeshLambertMaterial({ color: 0x8898b8, ...op });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a3040, ...op });
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x60e0ff, ...op });
    const hullGeo = new THREE.ConeGeometry(1.0, 3.4, 6); hullGeo.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(hullGeo, body));
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.4), dark); f.position.set(s * 1.2, 0, 0.9); f.rotation.y = s * 0.5; g.add(f);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), eyeM); eye.position.set(0, 0.2, -1.2); g.add(eye);
    const gl = glowSprite(0x60e0ff, 2.4, 0.1); gl.position.copy(eye.position); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x8898b8), cloakMats: [body, dark, eyeM, gl.material] };
  },
  warden() {
    const g = new THREE.Group(), body = lambert(0x707888);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 4.8), body));
    const brow = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.8, 3.2), darkMetal); brow.position.set(0, 1.7, -0.4); g.add(brow);
    const chin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.2), darkMetal); chin.position.set(0, -1.6, -2.0); g.add(chin);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 0.12), basic(0xff9020)); eye.position.set(0, 0.6, -2.42); g.add(eye);
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.8, 3.2), darkMetal); pod.position.set(sx * 2.9, -0.2, -0.6); g.add(pod);
      for (const [x, y] of [[-0.3, 0.4], [0.3, 0.4], [-0.3, -0.4], [0.3, -0.4]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 8), basic(0xffb060)); t.rotation.x = Math.PI / 2; t.position.set(sx * 2.9 + x, -0.2 + y, -2.25); g.add(t);
      }
      const th = glowSprite(0x60a0ff, 2.6, 0.8); th.position.set(sx * 1.4, 0, 2.6); g.add(th);
    }
    const gl = glowSprite(0xff9020, 4, 0.8); gl.position.copy(eye.position); g.add(gl);
    return { g, mats: [body], baseColor: new THREE.Color(0x707888) };
  },
};
MODELS.overseer = () => {
  const g = new THREE.Group(), body = lambert(0x6a5670), plateMat = lambert(0x8a8c96);
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 2), body));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), basic(0xff2a80)); eye.position.set(0, 0, -3.0); g.add(eye);
  const iris = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 8, 24), darkMetal); iris.position.z = -2.85; g.add(iris);
  // Armour plates: one group sheds at each phase change.
  const plates = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    const pl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 0.5), plateMat);
    pl.position.set(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0.4); pl.lookAt(0, 0, 0.4); g.add(pl); plates.push(pl);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.35, 8, 48), darkMetal); g.add(ring);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), basic(0xff5090)); n.position.set(Math.cos(a) * 5.0, Math.sin(a) * 5.0, 0); ring.add(n);
  }
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 4.6), darkMetal); arm.position.set(sx * 5.4, -0.6, -0.8); g.add(arm);
    for (const [x, y] of [[-0.35, 0.35], [0.35, 0.35], [-0.35, -0.35], [0.35, -0.35]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8), basic(0xffb060)); t.rotation.x = Math.PI / 2; t.position.set(sx * 5.4 + x, -0.6 + y, -3.15); g.add(t);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 2.4), body); fin.position.set(sx * 2.2, 2.6, 2.2); fin.rotation.z = sx * 0.4; g.add(fin);
    const th = glowSprite(0x8060ff, 3.4, 0.8); th.position.set(sx * 5.4, -0.6, 1.8); g.add(th);
  }
  const gl = glowSprite(0xff2a80, 7, 0.9); gl.position.copy(eye.position); g.add(gl);
  return { g, mats: [body, plateMat], baseColor: new THREE.Color(0x6a5670), plates, ring, eyeGlow: gl };
};
// burst/gap: shots per volley; lead: how far ahead of the player they aim; drop: shield drop chance.
const ET = {
  drone:     { hp: 30, r: 1.8, speed: 15, turn: 4, prefer: 22, cd: [1.1, 1.9], shot: 'bolt', range: 85, boom: 1.1, lead: 0.6, pitch: 760 },
  leech:     { hp: 22, r: 1.5, speed: 22, turn: 6, melee: 11, boom: 0.9 },
  sentry:    { hp: 55, r: 1.9, speed: 0, turn: 2.6, cd: [1.6, 2.4], shot: 'bolt', burst: 3, gap: 0.13, range: 90, boom: 1.3, lead: 0.3, stationary: true, pitch: 900 },
  wasp:      { hp: 14, r: 1.1, speed: 24.3, turn: 6.3, prefer: 13, cd: [0.6, 1.1], shot: 'needle', range: 70, boom: 0.7, weave: 1.4, lead: 0.4, pitch: 1300, drop: 0.1 },
  brute:     { hp: 120, r: 2.7, speed: 6.5, turn: 1.8, prefer: 28, cd: [2.2, 3.0], shot: 'plasma', range: 95, boom: 2, boomColor: 0xd070ff, drop: 0.6, pitch: 260 },
  minelayer: { hp: 75, r: 2.2, speed: 10, turn: 2.2, prefer: 42, cd: [2.6, 3.6], shot: 'bolt', range: 80, boom: 1.6, mines: [2.2, 3.2], lead: 0.5, drop: 0.5, pitch: 500 },
  phantom:   { hp: 60, r: 1.7, speed: 19, turn: 4.5, prefer: 20, cd: [2.0, 2.8], shot: 'lance', burst: 2, gap: 0.12, range: 95, boom: 1.4, boomColor: 0x60e0ff, cloak: true, lead: 0.7, drop: 0.4, pitch: 1100, guns: 1.1 },
  warden:    { hp: 450, r: 3.6, speed: 5, turn: 1.3, prefer: 34, cd: [3.4, 4.4], shot: 'rocket', burst: 4, gap: 0.22, range: 110, boom: 3, boomColor: 0xffc040, aimCone: 0.75,
               shot2: 'plasma', cd2: [1.4, 2.2], drop: 1, pitch: 180, guns: 2.9 },
  // Boss: stays in its arena; see updateBoss for the phase attacks.
  overseer:  { hp: 2400, r: 5.6, speed: 9, turn: 1.4, cd: [4.0, 5.0], shot: 'rocket', burst: 6, gap: 0.15, range: 160, boom: 5, boomColor: 0xff3080, aimCone: 0.6,
               shot2: 'plasma', cd2: [1.8, 2.4], lead: 0.4, drop: 0, pitch: 120, guns: 5.4, boss: true },
};
const enemies = [];
function spawnEnemy(type, pos) {
  const T = ET[type], m = MODELS[type]();
  scene.add(m.g);
  const e = {
    type, T, ...m, pos: new V3(...pos), home: new V3(...pos), vel: new V3(), quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rand(0, 6.28)),
    hp: T.hp, alive: true, awake: false, los: false, lostT: 99, think: rand(0, 0.3), fireCd: rand(0.5, 1.5), meleeCd: 0,
    fireCd2: rand(1, 2), burstLeft: 0, burstT: 0, mineCd: rand(0.5, 1.5), vis: 0.1, gun: 1,
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
  explode(e.pos, e.T.boom, e.T.boomColor || 0xff8a30);
  spawnDebris(e);
  kills++;
  if (e.T.boss) return bossDefeated(e);
  if (Math.random() < (e.T.drop ?? 0.2)) spawnPickup('shield', e.pos.toArray());
  if (e.type === 'warden') spawnPickup('missiles', e.pos.clone().add(new V3(0, 2, 0)).toArray());
}
function enemyShoot(e, kind, dist) {
  const fwd = fwdOf(e.quat, new V3());
  const origin = e.pos.clone().addScaledVector(fwd, e.T.r + 0.4);
  if (e.T.guns) {
    e.gun = -e.gun;
    origin.addScaledVector(new V3(1, 0, 0).applyQuaternion(e.quat), e.gun * e.T.guns);
  }
  const aim = player.pos.clone().addScaledVector(player.vel, dist / PK[kind].speed * (e.T.lead || 0)).sub(origin);
  if (kind === 'rocket') aim.normalize().add(new V3(rand(-0.25, 0.25), rand(-0.25, 0.25), rand(-0.25, 0.25)));
  spawnProjectile(kind, 'enemy', origin, aim);
  sfx.enemyShot(e.pos, kind === 'plasma' ? 260 : e.T.pitch || 700);
}

// ---------------------------------------------------------------- mines
const mineGeo = new THREE.IcosahedronGeometry(0.8, 0), mineMat = lambert(0x3a3a40, 0x280404);
const mines = [];
function spawnMine(pos, vel, owner) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mineGeo, mineMat));
  const s = glowSprite(0xff2020, 2.4, 1); g.add(s);
  g.position.copy(pos);
  scene.add(g);
  const m = { pos: pos.clone(), vel: vel.clone(), g, s, life: 16, arm: 0.9, alive: true, owner, T: { r: 1.1 }, blink: 0 };
  m.damage = () => detonateMine(m);
  mines.push(m);
}
function detonateMine(m) {
  if (!m.alive) return;
  m.alive = false;
  scene.remove(m.g);
  explode(m.pos, 1.3, 0xff5020);
  const d = m.pos.distanceTo(player.pos);
  if (d < 10) damagePlayer(20 * (1 - d / 10) + 6);
}
function updateMines(dt) {
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    if (!m.alive) { mines.splice(i, 1); continue; }
    m.life -= dt; m.arm -= dt;
    m.vel.multiplyScalar(Math.exp(-dt * 1.5));
    m.pos.addScaledVector(m.vel, dt);
    level.collideSphere(m.pos, m.vel, 1.0, 0.3);
    m.g.position.copy(m.pos);
    m.g.rotation.y += dt * 2;
    const d2 = m.pos.distanceToSquared(player.pos);
    m.blink -= dt;
    if (m.blink <= 0) { m.blink = d2 < 400 ? 0.15 : 0.6; m.s.visible = !m.s.visible; if (d2 < 400 && m.s.visible) sfx.mine(m.pos); }
    if (m.life <= 0 || (m.arm <= 0 && d2 < 36 && !player.dead)) detonateMine(m);
  }
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _to = new V3(), _des = new V3(), _tmp = new V3(), _up = new V3();
function updateEnemy(e, dt) {
  const T = e.T;
  if (T.boss) return updateBoss(e, dt);
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
  if (T.stationary) {
    _des.set(0, 0, 0);
  } else if (e.awake && e.los) {
    if (e.type === 'leech') {
      if (e.meleeCd > 0.4) _des.copy(dir).multiplyScalar(-T.speed * 0.6);
      else _des.copy(dir).multiplyScalar(T.speed).add(_tmp.crossVectors(dir, e.side).normalize().multiplyScalar(Math.sin(tt * 4) * 6));
    } else {
      const radial = THREE.MathUtils.clamp((dist - T.prefer) / 10, -1, 1);
      _des.copy(dir).multiplyScalar(radial * T.speed);
      _des.add(_tmp.crossVectors(dir, e.side).normalize().multiplyScalar(Math.sin(tt * (T.weave ? 2.5 : 1)) * T.speed * (T.weave || 0.7)));
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
  if (T.stationary) { e.vel.set(0, 0, 0); e.pos.copy(e.home); }
  else {
    e.vel.lerp(_des, 1 - Math.exp(-dt * 2.5));
    e.pos.addScaledVector(e.vel, dt);
    level.collideSphere(e.pos, e.vel, T.r, 0.3);
  }

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
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { enemyShoot(e, T.shot, dist); e.burstLeft--; e.burstT = T.gap; }
    } else if (e.fireCd <= 0 && dist < T.range && fwdOf(e.quat, _tmp).dot(dir) > (T.aimCone || 0.86)) {
      e.burstLeft = T.burst || 1; e.burstT = 0; e.fireCd = rand(...T.cd);
    }
    if (T.shot2) {
      e.fireCd2 -= dt;
      if (e.fireCd2 <= 0 && dist < T.range && fwdOf(e.quat, _tmp).dot(dir) > 0.9) { enemyShoot(e, T.shot2, dist); e.fireCd2 = rand(...T.cd2); }
    }
  }
  if (T.mines && e.awake && !player.dead) {
    e.mineCd -= dt;
    if (e.mineCd <= 0) {
      e.mineCd = rand(...T.mines);
      if (mines.filter(m => m.alive && m.owner === e).length < 4) {
        const back = fwdOf(e.quat, _tmp).negate();
        spawnMine(e.pos.clone().addScaledVector(back, T.r + 1.3), back.multiplyScalar(5).addScaledVector(e.vel, 0.3), e);
      }
    }
  }
  if (T.cloak) {
    const want = e.burstLeft > 0 || (e.awake && e.los && e.fireCd < 0.6) || e.hitT > -0.5 ? 1 : 0.06;
    e.vis += (want - e.vis) * Math.min(1, dt * 5);
    for (const m of e.cloakMats) m.opacity = e.vis;
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
  e.g.visible = !!e.cell && visStamp[e.cell.idx] === visS;
}
// ---------------------------------------------------------------- boss
// The Overseer drifts around its arena on a slow figure-eight. Each third of its armour lost
// sheds two plates and adds an attack: lance fans and wasp launches, then a bolt nova.
function updateBoss(e, dt) {
  const T = e.T, A = e.arena;
  _to.subVectors(player.pos, e.pos);
  const dist = _to.length(), dir = _to.clone().divideScalar(dist || 1);
  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.2;
    e.cell = level.findCell(e.pos, e.cell);
    e.los = !player.dead && dist < T.range && !level.raycast(e.pos, player.pos);
    if (e.los && !e.awake) { e.awake = true; e.fireCd = 1.5; msg('WARNING: OVERSEER ONLINE', 3); tone('sawtooth', 80, 40, 1.2, 0.2); }
    level.sampleLight(e.pos, e.cell, e.amb);
  }
  const phase = e.hp > T.hp * 0.66 ? 1 : e.hp > T.hp * 0.33 ? 2 : 3;
  if (phase > e.phaseN) {
    e.phaseN = phase;
    for (const pl of e.plates.splice(0, 2)) {
      const wp = pl.getWorldPosition(new V3());
      pl.visible = false;
      explode(wp, 1.6, 0xffa060);
    }
    player.shake = Math.max(player.shake, 0.8);
    msg(phase === 2 ? 'OVERSEER ARMOUR BREACHED - LAUNCH BAYS OPEN' : 'OVERSEER CRITICAL - IT IS GOING BERSERK', 3);
  }
  const rage = phase === 3 ? 0.6 : phase === 2 ? 0.8 : 1;

  if (e.awake) {
    const t = gameTime * (phase === 3 ? 0.34 : 0.2) + e.phase;
    _des.set(A.c.x + Math.sin(t) * A.h.x, A.c.y + Math.sin(t * 1.6) * A.h.y, A.c.z + Math.sin(t * 2) * A.h.z).sub(e.pos);
  } else _des.subVectors(e.home, e.pos);
  _des.clampLength(0, T.speed * (phase === 3 ? 1.6 : 1));
  e.vel.lerp(_des, 1 - Math.exp(-dt * 1.2));
  e.pos.addScaledVector(e.vel, dt);
  level.collideSphere(e.pos, e.vel, T.r, 0.3);

  if (e.los && dist > 0.1) {
    _up.set(0, 1, 0);
    _m4.lookAt(e.pos, player.pos, _up);
    _q.setFromRotationMatrix(_m4);
    e.quat.slerp(_q, 1 - Math.exp(-dt * T.turn / rage));
  }

  if (e.awake && e.los && !player.dead) {
    const facing = fwdOf(e.quat, _tmp).dot(dir);
    e.fireCd -= dt;
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { enemyShoot(e, T.shot, dist); e.burstLeft--; e.burstT = T.gap; }
    } else if (e.fireCd <= 0 && facing > T.aimCone) { e.burstLeft = T.burst; e.burstT = 0; e.fireCd = rand(...T.cd) * rage; }
    e.fireCd2 -= dt;
    if (e.fireCd2 <= 0 && facing > 0.8) {
      const origin = e.pos.clone().addScaledVector(fwdOf(e.quat, new V3()), T.r);
      spawnProjectile('plasma', 'enemy', origin, player.pos.clone().sub(origin));
      sfx.enemyShot(e.pos, 200);
      e.fireCd2 = rand(...T.cd2) * rage;
    }
    if (phase >= 2) {
      e.fanCd -= dt;
      if (e.fanCd <= 0 && facing > 0.7) {
        e.fanCd = 3.2 * rage;
        const side = new V3(1, 0, 0).applyQuaternion(e.quat), origin = e.pos.clone().addScaledVector(dir, T.r);
        for (let i = -2; i <= 2; i++) spawnProjectile('lance', 'enemy', origin, dir.clone().addScaledVector(side, i * 0.12));
        sfx.enemyShot(e.pos, 1000);
      }
      e.summonCd -= dt;
      if (e.summonCd <= 0) {
        e.summonCd = 12 * rage;
        e.summons = e.summons.filter(w => w.alive);
        for (let i = 0; i < 2 && e.summons.length < 4; i++) {
          const at = e.pos.clone().add(new V3(rand(-2, 2), T.r + 2, rand(-2, 2)));
          spawnEnemy('wasp', at.toArray());
          const w = enemies[enemies.length - 1];
          w.awake = true; w.home.copy(e.pos); e.summons.push(w);
        }
        tone('square', 300, 900, 0.3, 0.08);
      }
    }
    if (phase === 3) {
      e.novaCd -= dt;
      if (e.novaCd <= 0) {
        e.novaCd = 5;
        const a = new V3().crossVectors(dir, Y_AXIS).normalize(), b = new V3().crossVectors(dir, a);
        for (let i = 0; i < 16; i++) {
          const ang = i / 16 * Math.PI * 2;
          spawnProjectile('bolt', 'enemy', e.pos.clone(), a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang)).addScaledVector(dir, 0.35));
        }
        sfx.enemyShot(e.pos, 400);
      }
    }
  }
  // Ramming the Overseer hurts.
  const minD = T.r + player.r;
  if (dist < minD && dist > 0.01) {
    player.pos.addScaledVector(dir, minD - dist);
    player.vel.addScaledVector(dir, 12);
    e.meleeCd -= dt;
    if (e.meleeCd <= 0) { damagePlayer(8); e.meleeCd = 0.8; }
  }

  e.ring.rotation.z += dt * (0.6 + (3 - rage * 2));
  e.eyeGlow.material.opacity = 0.7 + 0.3 * Math.sin(gameTime * (phase * 3));
  e.hitT -= dt;
  const k = e.hitT > 0 ? 1 : 0;
  for (const m of e.mats) m.emissive.setRGB(
    e.baseColor.r * e.amb[0] * 0.8 + k, e.baseColor.g * e.amb[1] * 0.8 + k * 0.6, e.baseColor.b * e.amb[2] * 0.8 + k * 0.8);
  e.g.position.copy(e.pos);
  e.g.quaternion.copy(e.quat);
  e.g.visible = !!e.cell && visStamp[e.cell.idx] === visS;
}
function bossDefeated(e) {
  for (const w of e.summons) if (w.alive) killEnemy(w);
  for (let i = 0; i < 10; i++) after(i * 0.2, () => explode(e.pos.clone().add(new V3(rand(-6, 6), rand(-6, 6), rand(-6, 6))), 1.8 + Math.random() * 1.6, i % 2 ? 0xff60a0 : 0xffc060));
  after(2.1, () => { explode(e.pos, 6, 0xffe0f0); player.shake = 1.6; });
  spawnPickup('shield', e.pos.toArray());
  startEscape('OVERSEER DESTROYED! THE MINE IS COLLAPSING - 50 SECONDS TO THE EXIT!');
}
function initBoss(e) {
  // Arena bounds: the boss's home room, shrunk by its radius plus some clearance.
  const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity);
  for (const c of e.cell.region.cells) { lo.min(_tmp.set(...c.center)); hi.max(_tmp); }
  const c = lo.clone().add(hi).multiplyScalar(0.5);
  const h = hi.clone().sub(lo).multiplyScalar(0.5).addScalar(S / 2 - e.T.r - 3).max(new V3(0, 0, 0)).multiplyScalar(0.8);
  Object.assign(e, { arena: { c, h }, phaseN: 1, fanCd: 2, summonCd: 4, novaCd: 2, summons: [] });
  return e;
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
// Missions without a reactor get an inert stand-in so the shared code paths stay simple.
// A level with a boss is won by killing the boss, so any reactor in it is left out.
const reactor = !level.reactor || level.enemies.some(([t]) => ET[t] && ET[t].boss) ? { alive: false, pos: new V3(0, -1e5, 0), T: { r: 0 }, cell: null } : (() => {
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
  const R = { g, pos, core, coreMat, shell, glow, rings, metal, hp: 320, maxHp: 320, r: 3.6, T: { r: 3.6 }, alive: true, cd: 2, burst: 0, burstT: 0, los: false, think: 0, hitT: 0, cell: level.findCell(pos) };
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
  startEscape('REACTOR DESTROYED! SELF-DESTRUCT IN 50 SECONDS - GET TO THE EXIT!');
}
function startEscape(text) {
  countdown = 50;
  msg(text, 5);
  for (const door of doors) if (door.type === 'exit') tryOpenDoor(door, false);
  hud.objective.textContent = OBJECTIVES.escape;
  startAlarm();
}
function updateReactor(dt) {
  const R = reactor;
  if (!R.g) return;
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
  } else if (type === 'plasma') {
    const body = lambert(0x3a5058, 0x061418);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 2.0), body));
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), basic(0x40ffd8));
      b.rotation.x = Math.PI / 2; b.position.set(s * 0.4, 0.1, -1.3); g.add(b);
    }
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 16), basic(0x80fff0)); r.position.z = -0.6 + i * 0.5; g.add(r); }
    g.add(glowSprite(0x40ffd8, 5, 0.8));
  } else if (type === 'overdrive') {
    const gold = basic(0xffd040);
    for (let i = 0; i < 2; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), gold); s.scale.set(1, 1.6, 0.35); s.rotation.y = i * Math.PI / 2; g.add(s); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.09, 6, 28), basic(0xfff0a0)); ring.rotation.x = Math.PI / 2; g.add(ring);
    g.add(glowSprite(0xffc020, 8, 1));
  } else if (type === 'fusion') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), basic(0xe0b0ff)));
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 6, 24), basic(0xb060ff)); r.rotation.set(i * 1.05, i * 0.6, 0); g.add(r); }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.2, 10), lambert(0x504860, 0x100818)); barrel.rotation.x = Math.PI / 2; barrel.position.z = -1.2; g.add(barrel);
    g.add(glowSprite(0xb060ff, 6.5, 0.9));
  } else if (type.endsWith('key')) {
    const col = KEY_COLORS[type.slice(0, -3)];
    const m = basic(col);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.2, 8, 20), m));
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.8, 0.28), m); shaft.position.y = -1.5; g.add(shaft);
    for (const y of [-2.0, -2.35]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.28), m); t.position.set(0.3, y, 0); g.add(t); }
    g.add(glowSprite(col, 7, 1));
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
    } else if (p.type === 'spread' || p.type === 'plasma' || p.type === 'fusion') {
      const wi = { spread: 1, plasma: 2, fusion: 3 }[p.type];
      player.has[wi] = true; player.weapon = wi; sfx.weapon();
      msg({ 1: 'SPREADFIRE CANNON! (press 2)', 2: 'PLASMA CANNON! (press 3)', 3: 'FUSION CANNON! (press 4, hold fire to charge)' }[wi], 3.5);
    } else if (p.type === 'overdrive') {
      player.overdrive = 30;
      msg('OVERDRIVE! INVULNERABLE + DOUBLE FIRE RATE FOR 30 SECONDS', 3.5);
      [523, 784, 1047, 1568].forEach((f, i) => tone('sawtooth', f, f, 0.18, 0.07, i * 0.07));
    } else if (p.type === 'missiles') {
      player.missiles += 8; msg('8 HOMING MISSILES! (right click)', 3); sfx.weapon();
    } else if (p.type.endsWith('key')) {
      const k = p.type.slice(0, -3);
      player.keys[k] = true; msg(k.toUpperCase() + ' ACCESS KEY ACQUIRED!', 3.5); sfx.key();
      hud.objective.textContent = OBJECTIVES[k];
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
  for (let h = 0; h < q.length && h < 900; h++) {
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
      if (_cc.distanceToSquared(player.pos) > 170 * 170) continue;
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
  red: new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshBasicMaterial({ color: 0xff2020 })),
  blue: new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshBasicMaterial({ color: 0x3a7aff })),
  yellow: new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshBasicMaterial({ color: 0xffd020 })),
};
for (const m of Object.values(mapMarkers)) mapScene.add(m);
mapMarkers.reactor.position.copy(reactor.pos);
const keyCells = {};
for (const k in level.keys) { keyCells[k] = level.findCell(new V3(...level.keys[k])); mapMarkers[k].position.set(...level.keys[k]); }
const DOOR_COL = { normal: 0xb8c4d0, red: 0xff2a20, blue: 0x3a7aff, yellow: 0xffd020, exit: 0x30ff60 };

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
  for (const k in KEY_COLORS) mapMarkers[k].visible = !!(keyCells[k] && seen[keyCells[k].idx]) && !player.keys[k];
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
  for (const k in KEY_COLORS) mapMarkers[k].rotation.y += dt * 2;
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
  if (player.cell && countdown >= 0 && exitCells.has(player.cell)) win();

  player.fireCd -= dt; player.missileCd -= dt;
  if (player.weapon === 3) {
    // Fusion: hold to charge, release to fire. Holding a full charge too long burns the hull.
    if (input.fire && player.fireCd <= 0) {
      player.charge += dt * (player.overdrive > 0 ? 2 : 1);
      const k = Math.min(1, player.charge / 1.4);
      player.chargeSnd -= dt;
      if (player.chargeSnd <= 0) { sfx.charge(k); player.chargeSnd = 0.12; }
      if (player.charge > 2.8) { damagePlayer(10 * dt, 'overcharge'); if (msgT <= 0) msg('FUSION OVERCHARGE!', 0.6); }
    } else if (player.charge > 0) {
      if (player.charge >= 0.12) firePrimary();
      player.charge = 0;
    }
  } else {
    player.charge = 0;
    if (input.fire && player.fireCd <= 0) firePrimary();
  }
  if (input.missile && player.missileCd <= 0) fireMissile();
}

function win() {
  state = 'won';
  stopAlarm();
  if (AC.music) AC.music.stop(4);
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
  if (AC.music) AC.music.setSong(countdown >= 0 ? 'escape' : player.cell ? player.cell.region.sector : 1);
  updateDoors(dt);
  flowT -= dt; if (flowT <= 0) { flowT = 0.4; updateFlow(); }
  for (const e of enemies) if (e.alive) updateEnemy(e, dt);
  separateEnemies();
  updateReactor(dt);
  updateProjectiles(dt);
  updateMines(dt);
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
const _hl = new V3(), _hf = new V3();
function updateEffects(dt) {
  sparks.update(dt); fire.update(dt); smoke.update(dt);
  updateScorches(dt); updateRings(dt); updateDebris(dt);
  lensKick.v = Math.max(0, lensKick.v - dt * 0.05);
  lens.uniforms.uAberr.value = Math.min(0.05, player.hurt * 0.03 + lensKick.v + (player.overdrive > 0 ? 0.004 : 0) + (countdown >= 0 ? 0.003 + 0.003 * Math.sin(gameTime * 6) : 0));
  for (const l of flashLights) {
    if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.power * Math.max(0, l.userData.t / l.userData.dur); }
    else l.intensity = 0;
  }
  tex.lava.offset.x = gameTime * 0.03; tex.lava.offset.y = Math.sin(gameTime * 0.4) * 0.08;
  player.hurt = Math.max(0, player.hurt - dt * 1.5);
  player.heat = Math.max(0, player.heat - dt * 2);
  player.pick = Math.max(0, player.pick - dt * 1.5);
  if (player.overdrive > 0 && dt > 0) {
    const before = player.overdrive;
    player.overdrive = Math.max(0, player.overdrive - dt);
    if (before > 5 && player.overdrive <= 5) msg('OVERDRIVE FADING', 1.5);
    if (player.overdrive === 0) { msg('OVERDRIVE OVER', 1.5); tone('sawtooth', 600, 150, 0.4, 0.07); }
  }
  player.shake = Math.max(0, player.shake - dt * 2.2);
  msgT -= dt; if (msgT <= 0) hud.msg.style.opacity = 0;

  camera.position.copy(player.pos);
  camera.quaternion.copy(player.quat);
  // Headlight exposure: its falloff blows out a wall right in front of the nose, so it dims
  // as the wall ahead gets close.
  const ahead = level.raycast(player.pos, _hl.copy(player.pos).addScaledVector(fwdOf(player.quat, _hf), 12));
  const near = ahead ? Math.max(0.12, ahead.t) : 1;
  headlight.intensity += (90 * Math.min(1, Math.pow(near / 0.6, 1.5)) - headlight.intensity) * Math.min(1, dt * 10 || 1);
  if (player.shake > 0) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(player.shake * 0.25));

  hud.shield.textContent = Math.max(0, Math.ceil(player.shield));
  hud.shieldBar.style.width = Math.max(0, Math.min(100, player.shield / 2)) + '%';
  hud.shieldBar.style.background = player.shield < 30 ? '#ff4030' : player.shield < 60 ? '#ffb030' : '#40a0ff';
  hud.weapon.innerHTML = WEAPONS.map((w, i) => `<span class="${player.weapon === i ? 'sel' : player.has[i] ? '' : 'na'}">${i + 1} ${w}</span>`).join(' ');
  hud.missiles.textContent = `HOMING MISSILES: ${player.missiles}`;
  for (const k in KEY_COLORS) hud.keyEls[k].style.display = player.keys[k] ? 'inline-block' : 'none';
  const showBoss = boss && boss.alive && boss.awake;
  hud.boss.style.display = showBoss ? 'block' : 'none';
  if (showBoss) hud.bossBar.style.width = Math.max(0, boss.hp / boss.T.hp * 100) + '%';
  const ck = Math.min(1, player.charge / 1.4);
  chargeGlow.visible = player.charge > 0;
  chargeGlow.scale.setScalar(0.3 + 1.6 * ck + (player.charge > 1.4 ? Math.sin(gameTime * 40) * 0.15 : 0));
  hud.hurt.style.opacity = player.hurt;
  hud.heat.style.opacity = player.heat * 0.7;
  hud.pick.style.opacity = player.pick * 0.6;
  const od = player.overdrive;
  hud.power.style.display = od > 0 ? 'block' : 'none';
  if (od > 0) {
    hud.power.style.opacity = od > 5 ? 0.55 + 0.15 * Math.sin(gameTime * 4) : (Math.sin(gameTime * 14) > 0 ? 0.7 : 0.15);
    hud.powerTime.textContent = `OVERDRIVE ${Math.ceil(od)}`;
  }
  if (countdown >= 0) { hud.timer.style.display = 'block'; hud.timer.textContent = countdown.toFixed(1); }
}

// ---------------------------------------------------------------- input & screens
function show(id) {
  for (const s of ['title', 'pause', 'dead', 'win']) $(s).style.display = s === id ? 'flex' : 'none';
  document.body.classList.toggle('inmenu', state === 'title' || state === 'holo');
}
function lock() { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
$('pause').addEventListener('click', () => { audioInit(); lock(); });
$('dead').addEventListener('click', () => location.reload());
$('win').addEventListener('click', () => { if (missionIdx + 1 < MISSION_COUNT) gotoMission(missionIdx + 1); else location.reload(); });
$('win-next').textContent = missionIdx + 1 < MISSION_COUNT ? `CLICK FOR ${missionIdx + 1 < MISSIONS.length ? 'MISSION' : 'LEVEL'} ${missionIdx + 2}` : 'CLICK TO PLAY AGAIN';
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    if (state === 'title' || state === 'paused') { state = 'playing'; show(null); musicResume(); }
  } else if (state === 'playing') { state = 'paused'; show('pause'); input.fire = false; input.missile = false; if (AC.music) AC.music.setVolume(0.3); }
});
// Without pointer lock (unsupported or refused) fly with the free mouse instead.
let noLock = false;
document.addEventListener('pointerlockerror', () => {
  noLock = true;
  if (state === 'title' || state === 'paused') { state = 'playing'; show(null); musicResume(); }
});
addEventListener('mousemove', (e) => { if (document.pointerLockElement || (noLock && state === 'playing')) { input.mdx += e.movementX; input.mdy += e.movementY; } });
addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.missile = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; if (e.button === 2) input.missile = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (automap) { mapView.dist = THREE.MathUtils.clamp(mapView.dist * Math.exp(e.deltaY * 0.001), 15, 600); return; }
  if (state !== 'playing' || Math.abs(e.deltaY) < 1) return;
  const step = e.deltaY > 0 ? 1 : 3;
  for (let i = 1, w = player.weapon; i <= 4; i++) { w = (w + step) % 4; if (player.has[w]) { player.weapon = w; break; } }
}, { passive: true });
// Cheat: type HEXALL in flight for every weapon, both keys, the whole map and full shield.
const CHEAT = 'hexall';
let typed = '';
function cheat() {
  player.has = [true, true, true, true];
  player.missiles += 20;
  player.shield = 200;
  for (const k in KEY_COLORS) player.keys[k] = true;
  for (const p of pickups) if (p.alive && p.type.endsWith('key')) { p.alive = false; scene.remove(p.g); }
  seen.fill(1);
  mapDirty = true;
  if (countdown < 0) hud.objective.textContent = OBJECTIVES.red;
  msg('CHEATER! ALL WEAPONS, KEYS AND MAP', 3);
  sfx.key();
}
addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (state === 'title') return menuKey(e);
  if (state === 'holo') {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') holotank.step(-1);
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') holotank.step(1);
    if (e.code === 'Escape' || e.code === 'Backspace') closeHolo();
    return;
  }
  if (state !== 'playing') return;
  if (e.key.length === 1) {
    typed = (typed + e.key.toLowerCase()).slice(-CHEAT.length);
    if (typed === CHEAT) { typed = ''; cheat(); }
  }
  if (e.code === 'Tab' || e.code === 'KeyM') toggleMap();
  const wi = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (wi >= 0) { if (player.has[wi]) player.weapon = wi; else msg(`YOU DON'T HAVE THE ${WEAPONS[wi]} YET`, 1.5); }
  if (e.code === 'KeyG') input.missile = true;
  if (e.code === 'KeyN') { toggleMusic(); msg(musicOn ? 'MUSIC ON' : 'MUSIC OFF', 1.2); }
});
function toggleMusic() {
  musicOn = !musicOn;
  try { localStorage.setItem('hexahedron-music', musicOn ? 'on' : 'off'); } catch (err) { /* storage blocked */ }
  if (AC.music) { if (musicOn) AC.music.start(); else AC.music.stop(0.5); }
  $('music-state').textContent = musicOn ? 'ON' : 'OFF';
}

// ---------------------------------------------------------------- main menu & holotank
const keyNames = Object.keys(KEY_COLORS).filter(k => level.keys[k]);
const keyText = keyNames.length > 1 ? keyNames.slice(0, -1).join(', ') + ' and ' + keyNames.at(-1) + ' keys' : keyNames[0] + ' key';
const roomCount = level.regions.filter(r => !r.corridor).length;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const missionLabel = importedLevel
  ? `DESCENT LEVEL ${missionIdx - MISSIONS.length + 1} OF ${imported.levels.length}`
  : `MISSION ${missionIdx + 1} OF ${MISSIONS.length}`;
$('missions').innerHTML = `<div class="mission"><div class="m-num">${missionLabel}</div><h3>${esc(MISSION.name)}</h3><p>${esc(MISSION.text)}</p>
  <div class="m-meta">${roomCount} room${roomCount === 1 ? '' : 's'} &middot; ${keyNames.length ? keyText : 'no keys'} &middot; ${level.enemies.length} hostiles${levelSong ? ` &middot; music ${esc(levelSong.name.toUpperCase())}` : ''}</div></div>`
  + (importError ? `<p class="m-error">${esc(importError)}</p>` : '');
$('mission-num').textContent = `${missionIdx + 1} / ${MISSION_COUNT}`;
function gotoMission(i, keepFocus) {
  try { if (keepFocus) sessionStorage.setItem('hexahedron-focus', 'mission'); } catch (err) { /* storage blocked */ }
  location.replace(`?mission=${(i + MISSION_COUNT) % MISSION_COUNT + 1}`);
}

// Import: a DESCENT.HOG (or a single .RDL/.SDL) is unpacked here, stored, and the first of its
// levels is loaded. Nothing leaves the browser.
const importInput = $('import-file');
$('import-state').textContent = imported ? `${imported.levels.length} LEVELS${imported.pig ? ' + PIG' : ''}` : 'HOG / PIG';
importInput.addEventListener('change', async () => {
  const files = [...importInput.files];
  importInput.value = '';
  if (!files.length) return;
  const status = $('menu-hint');
  status.textContent = `Reading ${files.map(f => f.name).join(', ')}...`;
  try {
    // HOGs bring levels (plus the palette and texture table); a PIG brings the textures.
    // Whatever is not in this batch is kept from the last import.
    const rec = { ...(imported || {}) };
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const hog = readHog(buf);
      if (hog || /\.(rdl|sdl)$/i.test(file.name)) {
        const levels = extractLevels(buf, file.name)
          .filter((L) => { try { parseLevel(L.data); return true; } catch (err) { console.warn(L.name, err); return false; } });
        if (!levels.length) throw new Error(`none of the levels in ${file.name} could be read`);
        Object.assign(rec, { source: file.name.toUpperCase(), levels });
        if (hog) {
          const { songs, forLevel } = levelSongs(hog);
          rec.songs = songs;
          for (const L of levels) L.song = forLevel(L.name);
        }
        const find = (n) => hog && (hog.find(f => f.name.toLowerCase() === n) || {}).data;
        if (find('palette.256')) rec.palette = find('palette.256');
        rec.bitmapsBin = find('bitmaps.bin') || null;
      } else {
        parsePig(buf);
        rec.pig = buf;
      }
    }
    if (!rec.levels) throw new Error('import DESCENT.HOG too, for the levels');
    if (rec.pig && rec.palette) createArt(rec.pig, rec.palette, rec.bitmapsBin);
    await saveImported(rec);
    const nSongs = Object.keys(rec.songs || {}).length;
    status.textContent = `Imported ${rec.levels.length} level${rec.levels.length > 1 ? 's' : ''}${rec.pig ? ' with textures' : ''}${nSongs ? `, ${nSongs} songs` : ''}. Loading...`;
    location.replace(`?mission=${MISSIONS.length + 1}`);
  } catch (err) {
    console.error(err);
    status.textContent = `Import failed: ${err.message}`;
    menuBlip(220);
  }
});
$('music-state').textContent = musicOn ? 'ON' : 'OFF';
const menuButtons = [...document.querySelectorAll('.menu button')];
let menuSel = 0;
const menuBlip = (f = 880) => tone('square', f, f, 0.05, 0.05);
function menuFocus(i) {
  menuSel = (i + menuButtons.length) % menuButtons.length;
  menuButtons.forEach((b, j) => b.classList.toggle('sel', j === menuSel));
}
function menuAction(act) {
  audioInit(); musicResume();
  if (act === 'launch') { menuBlip(1320); lock(); }
  else if (act === 'mission') { menuBlip(); gotoMission(missionIdx + 1, true); }
  else if (act === 'holo') openHolo();
  else if (act === 'import') { menuBlip(); importInput.click(); }
  else if (act === 'controls') { menuBlip(); document.querySelector('.menu-panel').classList.toggle('show-controls'); }
  else if (act === 'music') { toggleMusic(); menuBlip(musicOn ? 1100 : 440); }
}
function menuKey(e) {
  if (e.code === 'ArrowDown' || e.code === 'KeyS') { menuFocus(menuSel + 1); menuBlip(); }
  if (e.code === 'ArrowUp' || e.code === 'KeyW') { menuFocus(menuSel - 1); menuBlip(); }
  if (e.code === 'Enter' || e.code === 'Space') menuAction(menuButtons[menuSel].dataset.act);
  if (menuButtons[menuSel].dataset.act === 'mission' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { menuBlip(); gotoMission(missionIdx + (e.code === 'ArrowLeft' ? -1 : 1), true); }
}
menuButtons.forEach((b, i) => {
  b.addEventListener('mouseenter', () => { if (menuSel !== i) { menuFocus(i); menuBlip(); } });
  b.addEventListener('click', () => { menuFocus(i); menuAction(b.dataset.act); });
});
let focusMission = false;
try { focusMission = sessionStorage.getItem('hexahedron-focus') === 'mission'; sessionStorage.removeItem('hexahedron-focus'); } catch (err) { /* storage blocked */ }
menuFocus(focusMission ? menuButtons.findIndex(b => b.dataset.act === 'mission') : 0);

// Robot census for the holotank: how many of each type and the first sector they turn up in.
const census = {};
for (const [type, pos] of level.enemies) {
  const c = census[type] || (census[type] = { count: 0, sector: 9 });
  const cell = level.findCell(new V3(...pos));
  c.count++;
  if (cell) c.sector = Math.min(c.sector, cell.region.sector);
}
const holotank = createHolotank({
  renderer, MODELS, ET, PK, census, sectors: MISSION.sectors, root: $('holo'), onClose: () => closeHolo(),
  blip: (i) => { tone('sine', 520 + i * 40, 1040 + i * 80, 0.12, 0.05); noise(0.1, 0.04, 6000, 2000); },
});
function openHolo() { state = 'holo'; show(null); holotank.open(); }
function closeHolo() { holotank.close(); state = 'title'; show('title'); menuBlip(660); }
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyG') input.missile = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = mapCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); mapCam.updateProjectionMatrix();
  holotank.resize();
});

// ---------------------------------------------------------------- start
for (const [type, pos] of level.enemies) spawnEnemy(type, pos);
const boss = enemies.find(e => e.T.boss) ? initBoss(enemies.find(e => e.T.boss)) : null;
for (const [type, pos] of level.pickups) spawnPickup(type, pos);
for (const k in level.keys) spawnPickup(k + 'key', level.keys[k]);
// Testing aid: ?warp=<name> starts at a named spot in the layout, kitted out as if you had fought your way there.
const warp = level.warps && level.warps[new URLSearchParams(location.search).get('warp')];
if (warp) {
  player.pos.set(...warp.pos);
  player.quat.setFromAxisAngle(Y_AXIS, warp.yaw);
  player.cell = level.findCell(player.pos);
  player.has = [true, true, true, true]; player.weapon = 2;
  player.missiles = 16; player.shield = 150;
  for (const k in level.keys) player.keys[k] = true;
  for (const p of pickups) if (p.alive && p.type.endsWith('key')) { p.alive = false; scene.remove(p.g); }
  OBJECTIVES.start = OBJECTIVES.red;
}
hud.objective.textContent = OBJECTIVES.start;
updateVisibility();
show('title');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const running = state === 'playing' || (player.dead && state !== 'dead');
  if (state === 'holo') {
    holotank.render(dt);
  } else if (automap && state === 'playing') {
    updateMap(dt);
    renderer.render(mapScene, mapCam);
  } else {
    if (running) update(dt);
    if (running || state === 'title') updateEffects(running ? dt : 0);
    composer.render(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handle for debugging / automated checks
window.__game = { boss, keys, input, THREE, scene, camera, headlight, baked, level, player, enemies, mines, reactor, doors, pickups, seen, visited, toggleMap, projectiles, get state() { return state; }, set state(s) { state = s; show(null); }, destroyReactor,
  step(sec, dt = 1 / 60) {
    for (let t = 0; t < sec && (state === 'playing' || player.dead); t += dt) { update(dt); updateEffects(dt); }
    composer.render(dt);
  },
  view(cell, yaw, pitch = 0) {
    state = 'playing'; show(null);
    player.pos.set((cell[0] + 0.5) * S, (cell[1] + 0.5) * S, (cell[2] + 0.5) * S); player.vel.set(0, 0, 0);
    player.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  },
};
