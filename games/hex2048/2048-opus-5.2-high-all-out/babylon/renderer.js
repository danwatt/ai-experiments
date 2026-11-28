/* ==========================================================================
   BabylonJS renderer: "Nightglass".
   An obsidian board floating in a starfield. Tiles are slabs of dark glass
   with neon numbers that bloom; the board mirrors them. Merges throw
   sparks, the goal sets off fireworks. Babylon strengths on show:
   GlowLayer, MirrorTexture with blur, emissive fresnel, GPU-ready particle
   systems and the DefaultRenderingPipeline (bloom, ACES, vignette, grain,
   chromatic aberration).
   ========================================================================== */
(function () {
'use strict';

const FONT = '"Chakra Petch", system-ui, sans-serif';

// Neon spectrum per exponent.
const NEON = [
  null,
  '#a9bfff', // 2
  '#7d9dff', // 4
  '#39e1ff', // 8
  '#2fffc4', // 16
  '#9dff4f', // 32
  '#ffe14f', // 64
  '#ff9a3d', // 128
  '#ff4f6d', // 256
  '#ff4fd8', // 512
  '#a45bff', // 1024
  '#fff3b0', // 2048: white gold
  '#5bf0ff', // 4096
  '#ff7bf0', // 8192
  '#ffffff', // 16384+
];
const neonOf = v => NEON[Math.min(NEON.length - 1, Math.max(1, Math.log2(v) | 0))];

function createRenderer({ canvas, core, kit, feel }) {
  const K = kit;
  const B = window.BABYLON;
  let engine, scene, camera, glow, pipeline, mirror, mirrorMat, boardRoot = null, sparks, dust, rimMat;
  let topo = null;
  let layoutState = null;
  let reduced = false;
  const view = { dist: 30, tx: 0, tz: 0, pitch: 60 * Math.PI / 180, px: 0, py: 0, ppx: 0, ppy: 0 };
  const tileSources = new Map(); // value -> mesh template (geometry + material)
  const sideMats = new Map();
  const TILE_R = 0.9;
  const HOVER = 0.07;
  const tileHeight = v => 0.24 + 0.022 * Math.min(12, Math.max(0, Math.log2(v) - 1));
  let mood = 1, moodTarget = 1;
  let field;
  let onFrameCb = null;
  let time = 0;
  const fireworks = [];
  let sparkNext = 0;

  const color3 = hex => { const [r, g, b] = K.hexToRgb(hex); return new B.Color3(r, g, b); };
  const color4 = (hex, a = 1) => { const [r, g, b] = K.hexToRgb(hex); return new B.Color4(r, g, b, a); };

  /* ---------- Meshes ---------- */

  // The kit emits counter-clockwise triangles; Babylon's right-handed mode
  // still treats clockwise as front, so flip once here.
  function toMesh(name, data, parent) {
    data = K.flipWinding(data);
    const m = new B.Mesh(name, scene);
    const vd = new B.VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.uvs = data.uvs;
    vd.indices = data.indices;
    vd.applyToMesh(m);
    if (parent) m.parent = parent;
    return m;
  }

  function canvasTexture(name, c, opts = {}) {
    const t = new B.DynamicTexture(name, c, scene, opts.mips !== false, B.Texture.TRILINEAR_SAMPLINGMODE);
    t.update(false);
    t.wrapU = t.wrapV = opts.repeat ? B.Texture.WRAP_ADDRESSMODE : B.Texture.CLAMP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    return t;
  }

  // Dark glass face: deep tint, an inner neon hexagon and a glowing number.
  function faceCanvas(value) {
    const neon = neonOf(value);
    const tier = Math.log2(value);
    return K.tileCanvas(256, value, {
      font: FONT, weight: 700, baseline: 0.02,
      background(g, s) {
        const grd = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
        grd.addColorStop(0, K.mixHex('#000000', neon, 0.32));
        grd.addColorStop(1, K.mixHex('#000000', neon, 0.12));
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
        // edge band: the tile sides sample this row, so the glass edges glow
        g.fillStyle = K.mixHex('#000000', neon, 0.6);
        g.fillRect(0, 0, s, s * 0.045);
        // inner hexagon line (flat-topped, like the tile)
        const r = s * 0.5 * 0.86;
        g.save();
        g.translate(s / 2, s / 2);
        g.shadowColor = neon; g.shadowBlur = s * 0.04;
        g.strokeStyle = K.mixHex(neon, '#ffffff', 0.15);
        g.globalAlpha = tier >= 11 ? 0.95 : 0.7;
        g.lineWidth = s * 0.016;
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = k * Math.PI / 3;
          k ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath(); g.stroke();
        g.restore();
        g.globalAlpha = 1;
      },
      text(g, text, x, y, px) {
        g.shadowColor = neon; g.shadowBlur = px * 0.35;
        g.fillStyle = neon; g.fillText(text, x, y);
        g.shadowBlur = px * 0.12;
        g.fillStyle = K.mixHex(neon, '#ffffff', tier >= 11 ? 0.8 : 0.55);
        g.fillText(text, x, y);
        g.shadowBlur = 0;
      },
    });
  }

  function tileSource(value) {
    if (tileSources.has(value)) return tileSources.get(value);
    const h = tileHeight(value);
    const neon = neonOf(value);
    const mesh = toMesh('tile-src-' + value, K.hexPrism({
      radius: TILE_R, height: h, bevel: 0.07, corner: 0.16, cornerSegments: 4, bevelSegments: 3,
      bottomBevel: 0.04, bottomCap: true, sideUV: [0.5, 0.02],
    }));
    const m = new B.StandardMaterial('tile-' + value, scene);
    m.diffuseColor = color3(K.mixHex('#000000', neon, 0.12));
    m.specularColor = new B.Color3(0.9, 0.95, 1);
    m.specularPower = 180;
    m.emissiveTexture = canvasTexture('face-' + value, faceCanvas(value));
    m.emissiveColor = new B.Color3(0, 0, 0);
    m.reflectionTexture = starReflection;
    m.reflectionTexture.level = 0.25;
    m.reflectionFresnelParameters = new B.FresnelParameters();
    m.reflectionFresnelParameters.bias = 0.1;
    m.reflectionFresnelParameters.power = 1.5;
    m.reflectionFresnelParameters.leftColor = B.Color3.White();
    m.reflectionFresnelParameters.rightColor = B.Color3.Black();
    mesh.material = m;
    mesh.setEnabled(false);
    mesh.isPickable = false;
    const src = { mesh, mat: m, neon, height: h };
    tileSources.set(value, src);
    return src;
  }

  /* ---------- Environment ---------- */

  let starReflection;
  function buildSky() {
    // Equirect nebula + stars on an inside-out sphere.
    const W = 2048, Hh = 1024;
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const g = c.getContext('2d');
    const rnd = K.hashRand(2048);
    const bg = g.createLinearGradient(0, 0, 0, Hh);
    bg.addColorStop(0, '#060a1c'); bg.addColorStop(0.5, '#0a0f28'); bg.addColorStop(1, '#03040b');
    g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
    const blob = (x, y, r, col, a) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, col.replace('A', a)); grd.addColorStop(1, col.replace('A', 0));
      g.fillStyle = grd;
      for (const dx of [-W, 0, W]) g.fillRect(x - r + dx, y - r, r * 2, r * 2);
    };
    for (let i = 0; i < 26; i++) {
      const col = ['rgba(57,120,255,A)', 'rgba(255,60,200,A)', 'rgba(40,220,255,A)', 'rgba(140,70,255,A)'][i % 4];
      blob(rnd() * W, Hh * (0.25 + rnd() * 0.6), 120 + rnd() * 360, col, 0.05 + rnd() * 0.09);
    }
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * W, y = rnd() * Hh, r = Math.pow(rnd(), 8) * 0.9 + 0.25;
      g.fillStyle = `rgba(${200 + rnd() * 55 | 0},${210 + rnd() * 45 | 0},255,${0.3 + rnd() * 0.7})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const sky = B.MeshBuilder.CreateSphere('sky', { diameter: 400, segments: 32, sideOrientation: B.Mesh.BACKSIDE }, scene);
    const m = new B.StandardMaterial('skyMat', scene);
    m.disableLighting = true;
    m.emissiveTexture = canvasTexture('sky', c);
    m.backFaceCulling = false;
    m.fogEnabled = false;
    sky.material = m;
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    glow.addExcludedMesh(sky);
    // A small blurred copy as a fake environment for glass reflections.
    const small = document.createElement('canvas'); small.width = 512; small.height = 256;
    const sg = small.getContext('2d'); sg.filter = 'blur(6px)'; sg.drawImage(c, 0, 0, 512, 256);
    starReflection = canvasTexture('skyEnv', small, { mips: false });
    starReflection.coordinatesMode = B.Texture.EQUIRECTANGULAR_MODE;
  }

  // Stones: dark amethyst with faint glowing fractures.
  function voidCanvas() {
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const rnd = K.hashRand(909);
    const grd = g.createRadialGradient(S * 0.45, S * 0.4, 4, S / 2, S / 2, S * 0.55);
    grd.addColorStop(0, '#2a0f45'); grd.addColorStop(1, '#0c0418');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.fillStyle = '#3a1466'; g.fillRect(0, 0, S, S * 0.045); // side band
    g.strokeStyle = '#b06bff'; g.shadowColor = '#b06bff'; g.shadowBlur = 6;
    for (let i = 0; i < 7; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.35;
      g.lineWidth = 0.8 + rnd() * 1.4;
      let x = S * (0.2 + rnd() * 0.6), y = S * (0.2 + rnd() * 0.6);
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; g.lineTo(x, y); }
      g.stroke();
    }
    return c;
  }

  /* ---------- Board ---------- */

  // Board materials are made once; rebuilding a board only swaps meshes
  // (disposing materials would also take the shared mirror texture with it).
  let BM = null;
  function boardMaterials() {
    if (BM) return BM;
    const slab = new B.StandardMaterial('slabMat', scene);
    slab.diffuseColor = new B.Color3(0.015, 0.02, 0.045);
    slab.specularColor = new B.Color3(0.5, 0.6, 0.9);
    slab.specularPower = 90;
    slab.emissiveColor = new B.Color3(0.005, 0.01, 0.03);

    const cell = new B.StandardMaterial('cellMat', scene);
    cell.disableLighting = true;
    cell.emissiveColor = new B.Color3(0.08, 0.22, 0.42);
    cell.backFaceCulling = false;

    const fill = new B.StandardMaterial('cellFill', scene);
    fill.disableLighting = true;
    fill.emissiveColor = new B.Color3(0.02, 0.05, 0.11);
    fill.alpha = 0.55;

    const stone = new B.StandardMaterial('stoneMat', scene);
    stone.diffuseColor = new B.Color3(0.01, 0.005, 0.02);
    stone.specularColor = new B.Color3(0.8, 0.6, 1);
    stone.specularPower = 40;
    stone.emissiveColor = new B.Color3(0, 0, 0);
    stone.emissiveTexture = canvasTexture('voidFace', voidCanvas());
    stone.reflectionTexture = starReflection;
    stone.reflectionFresnelParameters = new B.FresnelParameters();
    stone.reflectionFresnelParameters.bias = 0.05;
    stone.reflectionFresnelParameters.power = 2;
    stone.reflectionFresnelParameters.leftColor = new B.Color3(0.9, 0.6, 1);
    stone.reflectionFresnelParameters.rightColor = new B.Color3(0.05, 0.02, 0.1);

    const stoneRing = new B.StandardMaterial('stoneRing', scene);
    stoneRing.disableLighting = true;
    stoneRing.backFaceCulling = false;
    stoneRing.emissiveColor = new B.Color3(0.5, 0.15, 0.9);

    const hc = document.createElement('canvas'); hc.width = hc.height = 256;
    const hg = hc.getContext('2d');
    const grd = hg.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(60,140,255,0.45)'); grd.addColorStop(0.35, 'rgba(120,60,255,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    hg.fillStyle = grd; hg.fillRect(0, 0, 256, 256);
    const halo = new B.StandardMaterial('haloMat', scene);
    halo.disableLighting = true;
    halo.emissiveTexture = canvasTexture('halo', hc, { mips: false });
    halo.opacityTexture = halo.emissiveTexture;
    halo.emissiveTexture.hasAlpha = true;
    halo.alphaMode = B.Engine.ALPHA_ADD;
    halo.backFaceCulling = false;

    BM = { slab, cell, fill, stone, stoneRing, halo,
      ringData: K.hexRing({ radius: 0.92, corner: 0.14, width: 0.028, y: 0.006 }),
      fillData: K.hexPrism({ radius: 0.9, height: 0.003, bevel: 0.001, corner: 0.14, cornerSegments: 3, bevelSegments: 1 }),
      stoneRingData: K.hexRing({ radius: 0.95, corner: 0.2, width: 0.05, y: 0.008 }),
    };
    return BM;
  }

  function buildBoard() {
    if (boardRoot) boardRoot.dispose(false, false);
    boardRoot = new B.TransformNode('board', scene);
    const M = boardMaterials();
    const m = K.boardMetrics(topo.radius);
    const slabH = 0.5;
    const slab = toMesh('slab', K.hexPrism({
      radius: m.circum, height: slabH, bevel: 0.12, corner: 0.6, rotation: m.rotation,
      cornerSegments: 6, bevelSegments: 3, sideUV: [0.5, 0.5], bottomCap: true,
    }), boardRoot);
    slab.position.y = -slabH;
    slab.material = M.slab;

    // Mirror top: the board reflects the glass tiles above it.
    const top = toMesh('mirrorTop', K.hexPrism({
      radius: m.circum - 0.12, height: 0.002, bevel: 0.001, corner: 0.5, rotation: m.rotation, cornerSegments: 6, bevelSegments: 1,
    }), boardRoot);
    top.material = mirrorMat;
    top.position.y = -0.0015;
    glow.addExcludedMesh(top);

    // Neon rim and cell outlines.
    const rim = toMesh('rim', K.hexRing({ radius: m.circum - 0.16, corner: 0.48, width: 0.05, rotation: m.rotation, y: 0.004 }), boardRoot);
    rim.material = rimMat;
    const rim2 = toMesh('rim2', K.hexRing({ radius: m.circum + 0.002, corner: 0.6, width: 0.03, rotation: m.rotation, y: -slabH + 0.02 }), boardRoot);
    rim2.material = rimMat;

    topo.cells.forEach((c, i) => {
      if (topo.blocked[i]) {
        const rnd = K.hashRand(i * 17 + 3);
        const st = toMesh('stone', K.hexPrism({
          radius: 0.82, height: 0.5 + rnd() * 0.25, bevel: 0.16, corner: 0.3, cornerSegments: 1, bevelSegments: 1, bottomCap: true,
        }), boardRoot);
        st.position.set(c.x, 0, c.z);
        st.rotation.y = rnd() * Math.PI;
        st.material = M.stone;
        mirror.renderList.push(st);
        const r = toMesh('stoneRing', M.stoneRingData, boardRoot);
        r.position.set(c.x, 0, c.z);
        r.material = M.stoneRing;
        return;
      }
      const ring = toMesh('cell', M.ringData, boardRoot);
      ring.position.set(c.x, 0, c.z);
      ring.material = M.cell;
      const fill = toMesh('cellFill', M.fillData, boardRoot);
      fill.position.set(c.x, 0, c.z);
      fill.material = M.fill;
      glow.addExcludedMesh(fill);
    });

    // Soft halo under the floating board.
    const halo = B.MeshBuilder.CreateGround('halo', { width: m.circum * 6, height: m.circum * 6 }, scene);
    halo.parent = boardRoot;
    halo.position.y = -3.2;
    halo.material = M.halo;
    glow.addExcludedMesh(halo);
  }

  /* ---------- Particles ---------- */

  function flareTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = canvasTexture('flare', c, { mips: false });
    t.hasAlpha = true;
    return t;
  }

  function buildParticles() {
    const tex = flareTexture();
    // A small pool, so several merges in one move each get their own burst.
    sparks = [];
    for (let i = 0; i < 8; i++) {
      const ps = new B.ParticleSystem('sparks' + i, 500, scene);
      ps.particleTexture = tex;
      ps.emitter = new B.Vector3(0, 0.4, 0);
      ps.createHemisphericEmitter(0.6, 1);
      ps.minSize = 0.02; ps.maxSize = 0.06;
      ps.minLifeTime = 0.35; ps.maxLifeTime = 0.95;
      ps.gravity = new B.Vector3(0, -7, 0);
      ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.colorDead = new B.Color4(0, 0, 0, 0);
      ps.addSizeGradient(0, 1); ps.addSizeGradient(1, 0.2);
      ps.start();
      sparks.push(ps);
    }

    dust = new B.ParticleSystem('dust', 400, scene);
    dust.particleTexture = tex;
    dust.emitter = new B.Vector3(0, 0, 0);
    dust.createBoxEmitter(new B.Vector3(-0.04, 0.02, -0.04), new B.Vector3(0.04, 0.06, 0.04), new B.Vector3(-10, -4, -10), new B.Vector3(10, 1.2, 10));
    dust.minSize = 0.015; dust.maxSize = 0.05;
    dust.minLifeTime = 6; dust.maxLifeTime = 12;
    dust.minEmitPower = 0.05; dust.maxEmitPower = 0.18;
    dust.emitRate = 26;
    dust.color1 = new B.Color4(0.4, 0.8, 1, 0.55);
    dust.color2 = new B.Color4(0.9, 0.5, 1, 0.4);
    dust.colorDead = new B.Color4(0, 0, 0, 0);
    dust.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    dust.preWarmCycles = 300;
    dust.start();
  }

  function burst(pos, neon, count, power = 1, sphere = false) {
    if (reduced) count = Math.floor(count / 4);
    if (!count) return;
    const ps = sparks[sparkNext++ % sparks.length];
    if (sphere) ps.createSphereEmitter(0.15, 1); else ps.createHemisphericEmitter(0.6, 1);
    ps.minLifeTime = sphere ? 0.6 : 0.35; ps.maxLifeTime = sphere ? 1.3 : 0.95;
    ps.emitter = new B.Vector3(pos.x, pos.y, pos.z);
    ps.color1 = color4(neon, 0.75);
    ps.color2 = color4(K.mixHex(neon, '#ffffff', 0.5), 0.45);
    ps.minEmitPower = 2.5 * power; ps.maxEmitPower = 6.5 * power;
    ps.manualEmitCount = Math.min(480, count);
  }

  /* ---------- Camera ---------- */

  function placeCamera() {
    const yaw = view.ppx * 0.04;
    const pitch = view.pitch - view.ppy * 0.035;
    const d = view.dist;
    camera.position.set(view.tx + Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, view.tz + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.setTarget(new B.Vector3(view.tx, 0, view.tz));
  }

  const ident = B.Matrix.Identity();
  function project(x, y, z) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const vp = camera.viewport.toGlobal(w, h);
    const m = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const p = B.Vector3.Project(new B.Vector3(x, y, z), ident, m, vp);
    return { x: p.x, y: p.y };
  }

  // animate: glide to the new framing instead of jumping (cards opening).
  function fit(animate) {
    if (!layoutState || !topo) return;
    const from = { dist: view.dist, tx: view.tx, tz: view.tz };
    const { insets, opts } = layoutState;
    const m = K.boardMetrics(topo.radius);
    const reach = opts.arrows ? m.circum + 0.62 + 0.75 : m.circum + 0.1;
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const ang = -Math.PI / 2 + k * Math.PI / 3;
      pts.push([Math.cos(ang) * reach, 0, Math.sin(ang) * reach]);
      pts.push([Math.cos(ang) * m.circum, -0.5, Math.sin(ang) * m.circum]);
    }
    const saved = { px: view.ppx, py: view.ppy };
    view.ppx = view.ppy = 0;
    K.fitCamera({
      width: opts.width, height: opts.height, insets, points: pts, pad: opts.arrows ? 6 : 14,
      dist: view.dist, tx: view.tx, tz: view.tz, worldWidth: reach * 2 * Math.cos(Math.PI / 6),
      verticalSquash: Math.sin(view.pitch), minDist: 5, maxDist: 400,
      project: p => project(p[0], p[1], p[2]),
      apply: (dist, tx, tz) => { view.dist = dist; view.tx = tx; view.tz = tz; placeCamera(); },
    });
    view.ppx = saved.px; view.ppy = saved.py;
    view.goal = animate && !reduced ? { dist: view.dist, tx: view.tx, tz: view.tz } : null;
    if (view.goal) Object.assign(view, from);
    placeCamera();
  }

  /* ---------- API ---------- */

  const api = {
    name: 'BabylonJS',
    tileTop: HOVER + 0.3,

    async init() {
      if (!B) throw new Error('BabylonJS did not load (offline?)');
      engine = new B.Engine(canvas, true, { stencil: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }, false);
      engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
      scene = new B.Scene(engine);
      scene.useRightHandedSystem = true;
      scene.clearColor = new B.Color4(0.012, 0.016, 0.04, 1);
      scene.ambientColor = new B.Color3(0.1, 0.1, 0.2);
      scene.skipPointerMovePicking = true;

      camera = new B.TargetCamera('cam', new B.Vector3(0, 20, 14), scene);
      camera.fov = 32 * Math.PI / 180;
      camera.minZ = 0.3; camera.maxZ = 600;

      const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0.3), scene);
      hemi.intensity = 0.35;
      hemi.diffuse = new B.Color3(0.5, 0.6, 1);
      hemi.groundColor = new B.Color3(0.1, 0.02, 0.2);
      hemi.specular = new B.Color3(0.2, 0.25, 0.4);
      const key = new B.DirectionalLight('key', new B.Vector3(0.45, -1, -0.6), scene);
      key.intensity = 0.9;
      key.diffuse = new B.Color3(0.7, 0.8, 1);
      key.specular = new B.Color3(1, 1, 1);
      const pink = new B.PointLight('pink', new B.Vector3(-8, 5, 6), scene);
      pink.diffuse = new B.Color3(1, 0.3, 0.85); pink.specular = new B.Color3(1, 0.4, 0.9); pink.intensity = 0.6;
      const cyan = new B.PointLight('cyan', new B.Vector3(8, 4, -6), scene);
      cyan.diffuse = new B.Color3(0.2, 0.9, 1); cyan.specular = new B.Color3(0.3, 0.9, 1); cyan.intensity = 0.6;

      glow = new B.GlowLayer('glow', scene, { mainTextureSamples: 4, blurKernelSize: 48 });
      glow.intensity = 0.6;

      buildSky();

      mirror = new B.MirrorTexture('mirror', { ratio: 0.6 }, scene, true);
      mirror.mirrorPlane = new B.Plane(0, -1, 0, 0);
      mirror.adaptiveBlurKernel = 18;
      mirror.level = 0.55;
      mirrorMat = new B.StandardMaterial('mirrorMat', scene);
      mirrorMat.diffuseColor = new B.Color3(0.01, 0.015, 0.035);
      mirrorMat.specularColor = new B.Color3(0.4, 0.5, 0.8);
      mirrorMat.specularPower = 120;
      mirrorMat.reflectionTexture = mirror;

      rimMat = new B.StandardMaterial('rimMat', scene);
      rimMat.disableLighting = true;
      rimMat.backFaceCulling = false;
      rimMat.emissiveColor = new B.Color3(0.16, 0.62, 0.85);

      pipeline = new B.DefaultRenderingPipeline('post', true, scene, [camera]);
      pipeline.samples = 4;
      pipeline.fxaaEnabled = true;
      pipeline.bloomEnabled = true;
      pipeline.bloomThreshold = 0.75;
      pipeline.bloomWeight = 0.28;
      pipeline.bloomKernel = 64;
      pipeline.bloomScale = 0.5;
      pipeline.imageProcessingEnabled = true;
      const ip = pipeline.imageProcessing;
      ip.toneMappingEnabled = true;
      ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.15;
      ip.contrast = 1.25;
      ip.vignetteEnabled = true;
      ip.vignetteWeight = 2.2;
      ip.vignetteColor = new B.Color4(0, 0, 0.02, 0);
      ip.vignetteStretch = 0.4;
      pipeline.chromaticAberrationEnabled = true;
      pipeline.chromaticAberration.aberrationAmount = 14;
      pipeline.chromaticAberration.radialIntensity = 1.4;
      pipeline.grainEnabled = true;
      pipeline.grain.intensity = 6;
      pipeline.grain.animated = true;

      buildParticles();

      field = new K.TileField({
        feel,
        onCreate: vis => {
          const src = tileSource(vis.value);
          const mesh = src.mesh.clone('tile-' + vis.id);
          mesh.setEnabled(true);
          mirror.renderList.push(mesh);
          return { mesh, src, phase: (vis.id * 0.618) % 1 * Math.PI * 2 };
        },
        onRemove: vis => {
          if (!vis.obj) return;
          const i = mirror.renderList.indexOf(vis.obj.mesh);
          if (i >= 0) mirror.renderList.splice(i, 1);
          vis.obj.mesh.dispose();
        },
      });

      let last = performance.now();
      scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        time += dt;
        field.update(now, dt);
        for (const vis of field.tiles.values()) {
          const o = vis.obj;
          const mesh = o.mesh;
          const on = vis.visible && vis.s > 0.01;
          if (mesh.isEnabled() !== on) mesh.setEnabled(on);
          // glass floats: a slow individual bob
          const bob = reduced ? 0 : Math.sin(time * 1.6 + o.phase) * 0.025;
          mesh.position.set(vis.x, HOVER + vis.y + bob, vis.z);
          mesh.scaling.set(vis.s, vis.s * vis.sy, vis.s);
          mesh.rotation.z = reduced ? 0 : Math.sin(time * 1.1 + o.phase) * 0.012;
          mesh.rotation.x = reduced ? 0 : Math.cos(time * 0.9 + o.phase) * 0.012;
        }
        // big tiles breathe
        for (const [value, src] of tileSources) {
          if (value >= 128) src.mat.emissiveTexture.level = 1 + 0.18 * Math.sin(time * (value >= 2048 ? 4 : 2.2)) * mood;
        }
        const k = 1 - Math.exp(-5 * dt);
        if (view.goal) {
          const g = view.goal, kg = 1 - Math.exp(-7 * dt);
          view.dist += (g.dist - view.dist) * kg; view.tx += (g.tx - view.tx) * kg; view.tz += (g.tz - view.tz) * kg;
          if (Math.abs(g.dist - view.dist) < 1e-3 && Math.abs(g.tz - view.tz) < 1e-4) { Object.assign(view, g); view.goal = null; }
          placeCamera();
          
        }
        const tpx = reduced ? 0 : view.px, tpy = reduced ? 0 : view.py;
        view.ppx += (tpx - view.ppx) * k; view.ppy += (tpy - view.ppy) * k;
        placeCamera();
        if (Math.abs(mood - moodTarget) > 1e-3) {
          mood += (moodTarget - mood) * (1 - Math.exp(-3 * dt));
          glow.intensity = 0.25 + 0.35 * mood;
          pipeline.imageProcessing.exposure = 0.7 + 0.45 * mood;
          rimMat.emissiveColor = B.Color3.Lerp(new B.Color3(0.9, 0.12, 0.3), new B.Color3(0.16, 0.62, 0.85), mood);
        }
        for (let i = fireworks.length - 1; i >= 0; i--) {
          const f = fireworks[i];
          if (now >= f.at) { burst(f.pos, f.neon, f.count, f.power, true); fireworks.splice(i, 1); }
        }
        if (onFrameCb) onFrameCb();
      });

      engine.runRenderLoop(() => scene.render());
      // compile shaders before the first move
      await scene.whenReadyAsync();
    },

    setBoard(t) {
      topo = t;
      field.setTopology(t);
      mirror.renderList.length = 0;
      buildBoard();
      fit(false);
    },

    apply(tr) { field.apply(tr, performance.now()); },
    preview(peek, dist) { field.setPreview(peek, dist); },
    hint(peek) { field.hint(peek, performance.now()); },
    nudge(dir) { field.nudge(dir, performance.now()); },

    celebrate(kind, info) {
      if (kind === 'over') moodTarget = 0;
      else if (kind === 'calm') moodTarget = 1;
      else if (kind === 'milestone') {
        const c = topo.cells[info.cell] || { x: 0, z: 0 };
        burst({ x: c.x, y: 0.5, z: c.z }, neonOf(info.value), Math.min(260, 40 + Math.log2(info.value) * 14), 1.1);
      } else if (kind === 'win') {
        const R = K.boardMetrics(topo.radius).apothem;
        const now = performance.now();
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * K.TAU, r = Math.random() * R * 0.9;
          fireworks.push({ at: now + i * 160 + Math.random() * 80, pos: { x: Math.cos(a) * r, y: 1.5 + Math.random() * 2.5, z: Math.sin(a) * r },
            neon: NEON[3 + (i % 10)], count: 110, power: 1.9 });
        }
      }
    },

    layout(insets, opts) {
      const animate = !!opts.animate && !!layoutState && layoutState.opts.width === opts.width && layoutState.opts.height === opts.height;
      layoutState = { insets, opts };
      engine.resize();
      fit(animate);
    },

    project,
    setReduced(v) {
      reduced = v; field.reduced = v;
      if (pipeline) { pipeline.grainEnabled = !v; pipeline.chromaticAberrationEnabled = !v; }
      if (dust) dust.emitRate = v ? 6 : 26;
    },
    setPointer(nx, ny) { view.px = nx; view.py = ny; },
  };
  api.onFrame = cb => { onFrameCb = cb; };

  // Hook a new spawn into the sparks: merged tiles throw sparks of their colour.
  const baseApply = api.apply;
  api.apply = tr => {
    baseApply(tr);
    if (tr.type !== 'move') return;
    const delay = (feel && feel.slide) || 125;
    setTimeout(() => {
      for (const t of tr.tiles) {
        if (t.kind !== 'merge') continue;
        const c = topo.cells[t.to];
        const tier = Math.log2(t.value);
        burst({ x: c.x, y: HOVER + 0.25, z: c.z }, neonOf(t.value), Math.round(6 + tier * 4), 0.6 + tier * 0.05);
      }
    }, delay);
  };
  return api;
}

window.createBabylonRenderer = function (opts) {
  const r = createRenderer(opts);
  if (opts.onFrame) r.onFrame(opts.onFrame);
  return r;
};
})();
