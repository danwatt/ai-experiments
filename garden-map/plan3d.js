// 3D view of the next-year plan. Reads PLANTS, NEXT_SPREAD, NEW_PLANTS, COLORS, css and plantLinks from index.html.
// Feet throughout: x along the fence (0–50), z out from the iron fence (0 at the fence, 7 at the lawn), y up.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const FENCE_H = 4.4;
// iron fence posts, from the video; 33.0 and 36.4 frame the gate
const POSTS = [0.15, 3.1, 9.7, 17.8, 24.7, 33.0, 36.4, 41.2, 46.5, 49.85];
const GATE = [33.0, 36.4];
const STONES = [[34.6, 0.8], [35.4, 1.9], [34.4, 3.0], [35.3, 4.2], [34.5, 5.4], [35.4, 6.6]];

// how each existing plant is drawn, by `kind`; h = height (ft) next summer
const KIND_3D = {
  magnolia:   { type: "magnolia", h: 10, leaf: "#2d5a36", flower: "#f4f1e6" },
  crape:      { type: "crape", h: 12, leaf: "#47703a", flower: "#e0559b" },
  salvia:     { type: "spikes", h: 3.5, leaf: "#7d9a6a", flower: "#5b5fd6" },
  speedwell:  { type: "spikes", h: 1.5, leaf: "#4f7d3a", flower: "#e0408a" },
  violet:     { type: "spikes", h: 1.5, leaf: "#4f7d3a", flower: "#7b4fc9" },
  sage:       { type: "mound", h: 2.5, leaf: "#5f8a3f", flower: "#d12a5c" },
  shrub:      { type: "mound", h: 1.5, leaf: "#8dbb3c", flower: "#b48ad8" },
  yellow:     { type: "mound", h: 3.5, leaf: "#5e8f3a", flower: "#f2b705" },
  coneflower: { type: "daisy", h: 2.5, leaf: "#4d7a38", flower: "#c0569b" },
  vine:       { type: "pot", h: 4.6, leaf: "#3d6e2f", flower: "#d81f2a" },
};
// new plants, by letter
const NEW_3D = {
  A: { type: "grass", h: 3, leaf: "#7d8a55", flower: "#e6a1c9" },
  B: { type: "mound", h: 3.5, leaf: "#4f7d33", flower: "#e8692a" },
  C: { type: "mound", h: 3, leaf: "#5a8a3c", flower: "#f08fb0" },
  D: { type: "daisy", h: 2.5, leaf: "#4d7a38", flower: "#c0569b" },
  E: { type: "spikes", h: 2.5, leaf: "#6a8a4a", flower: "#f6e9f2" },
  F: { type: "mound", h: 1.8, leaf: "#5c8a40", flower: "#a08be0" },
  G: { type: "daisy", h: 1, leaf: "#6e8a5a", flower: "#ffffff" },
  H: { type: "daisy", h: 1.8, leaf: "#5a7f3a", flower: "#f0a818" },
  I: { type: "mound", h: 1, leaf: "#4f7a3c", flower: "#e65a9a" },
  J: { type: "daisy", h: 2, leaf: "#55803e", flower: "#7b55d0" },
  K: { type: "mound", h: 1.8, leaf: "#4f7d33", flower: "#f2c81e" },
  L: { type: "mound", h: 1.8, leaf: "#5a8a3c", flower: "#f07a16" },
  M: { type: "vine", h: FENCE_H, leaf: "#3f6d33", flower: "#d0303a" },
  N: { type: "pot", h: 4.6, leaf: "#3d6e2f", flower: "#d81f2a" },
};

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(2027);
const rr = (a, b) => a + rand() * (b - a);

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: .9, flatShading: true, ...opts }));
  return mats.get(key);
}

// lumpy unit sphere, a new shape each call
function blobGeometry(detail = 2, lump = .14) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute("normal").deleteAttribute("uv"));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + rr(-lump, lump);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

const DOT = new THREE.IcosahedronGeometry(1, 0);
const CONE = new THREE.ConeGeometry(1, 1, 5).translate(0, .5, 0);
const STICK = new THREE.CylinderGeometry(1, 1, 1, 4).translate(0, .5, 0);
const DISC = new THREE.CylinderGeometry(1, 1, .2, 8);

// one InstancedMesh from a list of {p, s, q?}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function instanced(geo, material, list, shadow = true) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  list.forEach((it, i) => {
    _s.set(...(Array.isArray(it.s) ? it.s : [it.s, it.s, it.s]));
    mesh.setMatrixAt(i, _m.compose(it.p, it.q ?? _q.identity(), _s));
  });
  mesh.count = list.length;
  mesh.castShadow = shadow;
  return mesh;
}

// random point on the upper part of an ellipsoid; maxPhi is the angle down from the top
function onEllipsoid(c, rx, ry, rz, maxPhi = 1.2) {
  const th = rr(0, Math.PI * 2), ph = Math.acos(1 - rand() * (1 - Math.cos(maxPhi)));
  return new THREE.Vector3(c.x + rx * Math.sin(ph) * Math.cos(th), c.y + ry * Math.cos(ph), c.z + rz * Math.sin(ph) * Math.sin(th));
}

function cylinderBetween(a, b, r, material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(STICK, material);
  m.scale.set(r, len, r);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

function foliage(g, c, rx, ry, rz, color) {
  const m = new THREE.Mesh(blobGeometry(), mat(color));
  m.position.copy(c); m.scale.set(rx, ry, rz);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

// ---- plant builders; each returns the height of its top for the label ----
const BUILD = {
  mound(g, it) {
    const r = it.spread / 2, ry = it.h / 1.6, c = new THREE.Vector3(it.x, it.h - ry, it.z);
    foliage(g, c, r, ry, r, it.leaf);
    const n = THREE.MathUtils.clamp(Math.round(r * r * 22), 10, 260);
    g.add(instanced(DOT, mat(it.flower), Array.from({ length: n }, () => ({ p: onEllipsoid(c, r * 1.02, ry * 1.02, r * 1.02), s: rr(.06, .1) })), false));
    return it.h;
  },
  spikes(g, it) {
    const r = it.spread / 2, top = it.h * .6, ry = top / 1.6, c = new THREE.Vector3(it.x, top - ry, it.z);
    foliage(g, c, r, ry, r, it.leaf);
    const n = THREE.MathUtils.clamp(Math.round(r * r * 14), 8, 240);
    const spikes = Array.from({ length: n }, () => {
      const p = onEllipsoid(c, r * .9, ry * .95, r * .9, 1.1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-.25, .25), 0, rr(-.25, .25)));
      return { p, q, s: [rr(.05, .08), it.h * rr(.3, .45), rr(.05, .08)] };
    });
    g.add(instanced(CONE, mat(it.flower), spikes));
    return it.h;
  },
  daisy(g, it) {
    const r = it.spread / 2, top = it.h * .5, ry = top / 1.6, c = new THREE.Vector3(it.x, top - ry, it.z);
    foliage(g, c, r, ry, r, it.leaf);
    const n = THREE.MathUtils.clamp(Math.round(r * r * 9), 5, 90);
    const stems = [], heads = [], eyes = [];
    for (let i = 0; i < n; i++) {
      const base = onEllipsoid(c, r * .7, ry * .9, r * .7, .9);
      const tip = new THREE.Vector3(base.x + rr(-.1, .1), it.h * rr(.85, 1), base.z + rr(-.1, .1));
      stems.push({ p: base, s: [.025, tip.y - base.y, .025] });
      const size = THREE.MathUtils.clamp(it.spread * .07, .08, .17);
      heads.push({ p: tip, s: [size, size * .6, size] });
      eyes.push({ p: tip.clone().setY(tip.y + .03), s: size * .4 });
    }
    g.add(instanced(STICK, mat("#4d7a38"), stems, false));
    g.add(instanced(DISC, mat(it.flower), heads));
    g.add(instanced(DOT, mat(it.label === "13" || it.label === "20" || it.label === "D" ? "#6b3b1f" : "#e8b21a"), eyes, false));
    return it.h;
  },
  grass(g, it) {
    const r = it.spread / 2;
    const blades = Array.from({ length: 90 }, () => {
      const a = rr(0, Math.PI * 2), d = rr(0, r * .45);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * d * .5, 0, -Math.cos(a) * d * .5));
      return { p: new THREE.Vector3(it.x + Math.cos(a) * d, 0, it.z + Math.sin(a) * d), q, s: [.05, it.h * rr(.5, .75), .05] };
    });
    g.add(instanced(CONE, mat(it.leaf), blades));
    const haze = new THREE.Mesh(blobGeometry(2, .1), mat(it.flower, { transparent: true, opacity: .55, depthWrite: false }));
    haze.position.set(it.x, it.h * .6, it.z); haze.scale.set(r, it.h * .42, r);
    g.add(haze);
    return it.h;
  },
  magnolia(g, it) {
    const r = it.spread / 2;
    g.add(cylinderBetween(new THREE.Vector3(it.x, 0, it.z), new THREE.Vector3(it.x, 2, it.z), .18, mat("#5b4636")));
    const tiers = [[3.0, 1, 2.4], [5.6, .9, 2.4], [8.2, .68, 1.9]];
    const blobs = tiers.map(([y, k, ry]) => foliage(g, new THREE.Vector3(it.x, y, it.z), r * k, ry, r * k, it.leaf));
    const flowers = Array.from({ length: 10 }, () => {
      const b = blobs[Math.floor(rand() * blobs.length)];
      return { p: onEllipsoid(b.position, b.scale.x, b.scale.y, b.scale.z, 1.6), s: .22 };
    });
    g.add(instanced(DOT, mat(it.flower), flowers, false));
    return 10.2;
  },
  crape(g, it) {
    const r = it.spread / 2, bark = mat("#c9b393");
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + rr(-.3, .3);
      const base = new THREE.Vector3(it.x + Math.cos(a) * .25, 0, it.z + Math.sin(a) * .25);
      const top = new THREE.Vector3(it.x + Math.cos(a) * r * .45, rr(6, 7), it.z + Math.sin(a) * r * .45);
      g.add(cylinderBetween(base, top, .1, bark));
      // the pink pool noodles on the trunks
      if (it.isOld) g.add(cylinderBetween(base.clone().setY(.4), base.clone().lerp(top, .2), .14, mat("#ef8fb5")));
    }
    const blobs = Array.from({ length: 9 }, (_, i) => {
      const a = i / 9 * Math.PI * 2, d = i % 3 === 0 ? r * .15 : r * .55;
      return foliage(g, new THREE.Vector3(it.x + Math.cos(a) * d, rr(7.6, 10.2), it.z + Math.sin(a) * d), r * .45, 1.5, r * .45, it.leaf);
    });
    const flowers = Array.from({ length: 260 }, () => {
      const b = blobs[Math.floor(rand() * blobs.length)];
      return { p: onEllipsoid(b.position, b.scale.x * 1.02, b.scale.y * 1.02, b.scale.z * 1.02, 1.3), s: rr(.1, .17) };
    });
    g.add(instanced(DOT, mat(it.flower), flowers, false));
    return 11.8;
  },
  pot(g, it) {
    const x = it.x, iron = mat("#2b2b2b", { roughness: .6, metalness: .3 });
    g.add(cylinderBetween(new THREE.Vector3(x, FENCE_H + .1, 0), new THREE.Vector3(x, FENCE_H + .1, .75), .03, iron));
    g.add(cylinderBetween(new THREE.Vector3(x, 3.95, .75), new THREE.Vector3(x, FENCE_H + .1, .75), .015, iron));
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.42, .3, .55, 16), mat("#7fa39a", { flatShading: false }));
    pot.position.set(x, 3.65, .75); pot.castShadow = true;
    g.add(pot);
    const c = new THREE.Vector3(x, 4.0, .75);
    foliage(g, c, .55, .35, .55, it.leaf);
    const leaves = [], flowers = [];
    for (let s = 0; s < 7; s++) {
      const a = s / 7 * Math.PI * 2;
      for (let k = 0; k < 8; k++) {
        const d = .4 + k * .05, p = new THREE.Vector3(x + Math.cos(a) * d, 3.7 - k * .22, .75 + Math.sin(a) * d);
        leaves.push({ p, s: rr(.07, .1) });
        if (k % 3 === 1) flowers.push({ p: p.clone().add(new THREE.Vector3(0, -.05, 0)), s: .1 });
      }
    }
    for (let i = 0; i < 18; i++) flowers.push({ p: onEllipsoid(c, .57, .37, .57), s: rr(.09, .13) });
    g.add(instanced(DOT, mat(it.leaf), leaves));
    g.add(instanced(DOT, mat(it.flower), flowers, false));
    return 4.9;
  },
  vine(g, it) {
    const leaves = [], flowers = [];
    for (let i = 0; i < 320; i++) {
      const y = rr(.3, it.h), w = 2.4 * (1 - y / it.h * .4);
      leaves.push({ p: new THREE.Vector3(it.x + rr(-w, w), y, rr(.06, .2)), s: [rr(.09, .13), rr(.07, .1), .04] });
      if (i % 7 === 0) flowers.push({ p: new THREE.Vector3(it.x + rr(-w, w), y, .22), s: [.04, .16, .04] });
    }
    g.add(instanced(DOT, mat(it.leaf), leaves));
    g.add(instanced(STICK, mat(it.flower), flowers, false));
    return it.h + .3;
  },
};

function planItems() {
  const items = [];
  PLANTS.forEach((p, i) => {
    const n = i + 1, k = KIND_3D[p.kind];
    // the two big salvia masses stand taller than a single plant
    const h = p.kind === "salvia" && p.d > 4 ? 3.5 : k.h;
    items.push({ ...k, h, label: String(n), name: p.name, sci: p.sci, x: p.x, z: p.y, spread: NEXT_SPREAD[n] ?? p.d,
      color: css(COLORS[p.kind]), isOld: true });
  });
  NEW_PLANTS.forEach(s => s.at.forEach(([x, y]) =>
    items.push({ ...NEW_3D[s.id], label: s.id, name: s.name, sci: s.sci, x, z: y, spread: s.spread, color: s.color, isOld: false })));
  return items;
}

function buildGround(scene) {
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(260, 160).rotateX(-Math.PI / 2), mat("#6f9a4a", { flatShading: false }));
  lawn.position.set(25, 0, 0); lawn.receiveShadow = true;
  scene.add(lawn);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(50, .15, 7), mat("#6b4f35", { flatShading: false }));
  bed.position.set(25, .02, 3.5); bed.receiveShadow = true;
  scene.add(bed);

  // river rock at both ends, same outline as the 2D map
  const rockShape = (pts) => {
    const s = new THREE.Shape();
    s.moveTo(...pts[0]); s.lineTo(...pts[1]); s.quadraticCurveTo(...pts[2], ...pts[3]); s.lineTo(...pts[4]);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(Math.PI / 2), mat("#8b8a84", { side: THREE.DoubleSide, flatShading: false }));
    m.position.y = .11; m.receiveShadow = true;
    scene.add(m);
  };
  rockShape([[0, 0], [2.6, 0], [2, 3], [.6, 7], [0, 7]]);
  rockShape([[50, 0], [45.8, 0], [47, 3], [48.4, 7], [50, 7]]);
  const pebbles = [];
  for (let i = 0; i < 700; i++) {
    const z = rr(0, 7), left = i % 2 === 0;
    const x = left ? rr(0, 2.6 - 2 * z / 7) : rr(45.8 + 2.6 * z / 7, 50);
    pebbles.push({ p: new THREE.Vector3(x, .12, z), s: [rr(.08, .16), rr(.04, .07), rr(.08, .16)] });
  }
  const pm = instanced(DOT, mat("#a3a199"), pebbles, false);
  pm.receiveShadow = true;
  scene.add(pm);

  // stepping stones to the gate
  for (const [x, z] of STONES) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .12, 20), mat("#bdb6a6", { flatShading: false }));
    s.scale.set(.62, 1, .42); s.position.set(x, .12, z); s.receiveShadow = true;
    scene.add(s);
  }

  // greenbelt beyond the fence: the trail and a tree line
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(260, 5).rotateX(-Math.PI / 2), mat("#d6d0c4", { flatShading: false }));
  trail.position.set(25, .03, -16); trail.receiveShadow = true;
  scene.add(trail);
  const greens = ["#3f6b34", "#4d7a3a", "#5b8640", "#355f30"];
  for (let i = 0; i < 46; i++) {
    const x = rr(-50, 100), z = rr(-70, -40), h = rr(16, 32), r = rr(5, 9);
    scene.add(cylinderBetween(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h * .5, z), .5, mat("#5b4636")));
    const t = new THREE.Mesh(blobGeometry(1, .18), mat(greens[i % 4]));
    t.position.set(x, h * .6, z); t.scale.set(r, h * .45, r); t.castShadow = true;
    scene.add(t);
  }
}

function buildFences(scene) {
  const iron = mat("#2b2b2b", { roughness: .6, metalness: .3 });
  for (const x of POSTS) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(.2, FENCE_H + .3, .2), iron);
    p.position.set(x, (FENCE_H + .3) / 2, 0); p.castShadow = true;
    scene.add(p);
  }
  for (const y of [.35, FENCE_H - .35, FENCE_H - .05]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(49.7, .08, .06), iron);
    rail.position.set(25, y, 0); rail.castShadow = true;
    scene.add(rail);
  }
  const pickets = [];
  for (let x = .5; x < 49.6; x += .36) pickets.push({ p: new THREE.Vector3(x, .1, 0), s: [.03, FENCE_H - .1, .03] });
  scene.add(instanced(STICK, iron, pickets));
  // gate: an extra mid rail and a diagonal brace
  const mid = new THREE.Mesh(new THREE.BoxGeometry(GATE[1] - GATE[0] - .2, .08, .07), iron);
  mid.position.set((GATE[0] + GATE[1]) / 2, FENCE_H / 2, 0);
  scene.add(mid);
  scene.add(cylinderBetween(new THREE.Vector3(GATE[0] + .15, .4, 0), new THREE.Vector3(GATE[1] - .15, FENCE_H - .4, 0), .04, iron));

  // wooden privacy fences on each side
  const wood = mat("#a27b55");
  for (const x of [-.18, 50.18]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(.35, 6, 15), wood);
    f.position.set(x, 3, 6.3); f.castShadow = f.receiveShadow = true;
    scene.add(f);
  }
}

const VIEWS = {
  lawn: { pos: [25, 16, 31], target: [25, 5, 2] },
  above: { pos: [25, 44, 6], target: [25, 0, 3.5] },
  along: { pos: [3.5, 6.5, 15], target: [28, 3, 2] },
};

export function init(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", top: 0, left: 0, pointerEvents: "none" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#bcd9ee");
  scene.fog = new THREE.Fog("#bcd9ee", 70, 170);
  scene.add(new THREE.HemisphereLight("#e3f0ff", "#6b5a3a", 1.6));
  const sun = new THREE.DirectionalLight("#fff4e0", 2.6);
  sun.position.set(5, 42, 32);
  sun.target.position.set(25, 0, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 22, bottom: -22, near: 1, far: 120 });
  sun.shadow.bias = -.0005;
  scene.add(sun, sun.target);

  buildGround(scene);
  buildFences(scene);

  const picks = [], labelEls = [];
  for (const it of planItems()) {
    const g = new THREE.Group();
    g.userData.item = it;
    const top = BUILD[it.type](g, it);
    scene.add(g);
    picks.push(g);
    const el = document.createElement("div");
    el.className = "lbl3d"; el.textContent = it.label; el.style.background = it.color;
    el.style.pointerEvents = "auto";
    el.addEventListener("click", () => select(it));
    const lbl = new CSS2DObject(el);
    lbl.position.set(it.x, top + .5, it.type === "pot" ? .75 : it.z);
    scene.add(lbl);
    labelEls.push(lbl);
  }

  const ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: .9 }));
  ring.position.y = .2; ring.visible = false;
  scene.add(ring);

  const camera = new THREE.PerspectiveCamera(40, 1, .5, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - .04;
  controls.minDistance = 4; controls.maxDistance = 110;
  const render = () => { renderer.render(scene, camera); labels.render(scene, camera); };
  controls.addEventListener("change", render);
  function setView(name) {
    const v = VIEWS[name];
    camera.position.set(...v.pos); controls.target.set(...v.target);
    controls.update(); render();
  }

  const info = document.getElementById("v3info");
  function select(it) {
    ring.visible = true;
    ring.position.set(it.x, .2, it.type === "pot" ? .75 : it.z);
    const r = it.type === "pot" ? .6 : it.type === "vine" ? 2.4 : it.spread / 2 + .1;
    ring.scale.set(r, 1, r);
    info.hidden = false;
    const size = it.type === "pot" ? "hanging pot on a fence post" : it.type === "vine" ? `vine along the fence, about ${it.h} ft tall` : `about ${it.h} ft tall and ${it.spread} ft across`;
    info.innerHTML = `<strong>${it.label}. ${it.name}</strong><div class="sci">${it.sci}</div>${plantLinks(it.sci)}
      <div class="meta">${it.isOld ? "Already in the bed" : "New next year"} · ${size}</div>`;
    render();
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down;
  renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const b = renderer.domElement.getBoundingClientRect();
    ptr.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
    ray.setFromCamera(ptr, camera);
    let o = ray.intersectObjects(picks, true)[0]?.object;
    while (o && !o.userData.item) o = o.parent;
    if (o) select(o.userData.item);
    else { info.hidden = true; ring.visible = false; render(); }
  });

  container.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  document.getElementById("v3labels").addEventListener("change", e => {
    labelEls.forEach(l => { l.visible = e.target.checked; });
    render();
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); labels.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    render();
  }
  new ResizeObserver(resize).observe(container);
  document.getElementById("v3status").remove();
  setView("lawn");
  resize();
  return { resize };
}
