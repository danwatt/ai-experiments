/* ==========================================================================
   PlayCanvas renderer: "Tabletop".
   A walnut game board on a green baize table under warm late-afternoon
   light. Tiles are glazed ceramic pieces with debossed numbers; stones are
   river pebbles. PlayCanvas strengths on show: PCSS soft shadows, SSAO
   contact shadows, depth of field and clearcoat through CameraFrame, plus
   image-based lighting from a procedural studio cubemap.
   ========================================================================== */
(function () {
'use strict';

const FONT = '"Fredoka", ui-rounded, system-ui, sans-serif';

// Ceramic glazes per exponent: [glaze, ink, extras]
const GLAZE = [
  null,
  ['#f6eee0', '#7a5a3e'],            // 2
  ['#efdcb6', '#7a5a3e'],            // 4
  ['#f3b46c', '#5e3514'],            // 8
  ['#ee8e4c', '#fff6ea'],            // 16
  ['#e3684c', '#fff6ea'],            // 32
  ['#c8473a', '#fff3e6'],            // 64
  ['#eac24c', '#5b3d0c'],            // 128
  ['#9fc15b', '#2d3c12'],            // 256
  ['#46a698', '#f3fffb'],            // 512
  ['#3a7cbc', '#f2f8ff'],            // 1024
  ['#f4c64e', '#4b3000', { metal: 0.6, gloss: 0.9 }], // 2048: gold leaf
  ['#8b4c9f', '#fff4ff'],            // 4096
  ['#3a3f73', '#ffd76a'],            // 8192
  ['#22201d', '#ffcf4a', { metal: 0.3 }], // 16384+
];
const glazeOf = v => GLAZE[Math.min(GLAZE.length - 1, Math.max(1, Math.log2(v) | 0))];

function createRenderer({ canvas, core, kit, feel }) {
  const K = kit;
  let app, device, cameraEnt, camera, frame, keyLight, fillLight, tableEnt;
  let boardRoot = null, tileRoot, fxRoot;
  let topo = null;
  const tileMeshes = new Map();   // height bucket -> pc.Mesh
  const materials = new Map();    // value -> material
  const view = { dist: 30, tx: 0, tz: 0, pitch: 57 * Math.PI / 180, yaw: 0, px: 0, py: 0, ppx: 0, ppy: 0 };
  let layoutState = null;
  let reduced = false;
  let mood = 1, moodTarget = 1;   // 1 = normal, 0 = game over dim
  const chips = [];               // confetti pieces
  let chipMeshes = null;
  const TILE_R = 0.91;
  const tileHeight = value => 0.34 + 0.028 * Math.min(12, Math.max(0, Math.log2(value) - 1));
  let field;

  /* ---------- Procedural textures ---------- */

  function canvasTex(c, opts = {}) {
    const t = new pc.Texture(device, {
      width: c.width, height: c.height,
      format: opts.linear ? pc.PIXELFORMAT_RGBA8 : pc.PIXELFORMAT_SRGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR,
      addressU: opts.repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: opts.repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
      anisotropy: 8,
    });
    t.setSource(c);
    return t;
  }

  function woodCanvas(size, base, dark, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const rnd = K.hashRand(seed);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    // long grain lines with gentle waviness
    for (let i = 0; i < 220; i++) {
      const y0 = rnd() * size;
      const amp = 2 + rnd() * 10, freq = 0.004 + rnd() * 0.01, ph = rnd() * 6;
      g.strokeStyle = rnd() < 0.5 ? dark : K.mixHex(base, '#ffffff', 0.12);
      g.globalAlpha = 0.05 + rnd() * 0.14;
      g.lineWidth = 0.6 + rnd() * 2.6;
      g.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.25;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }

  // Billiard-style felt: deep green with fibres and a faint mottling.
  function feltCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const rnd = K.hashRand(77);
    g.fillStyle = '#2d5a4a'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * size, y = rnd() * size, r = 30 + rnd() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = rnd() * 0.06;
      grd.addColorStop(0, rnd() < 0.5 ? `rgba(0,20,10,${a})` : `rgba(120,170,140,${a})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
    }
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 1 + rnd() * 3;
      g.strokeStyle = rnd() < 0.5 ? `rgba(10,30,20,${0.1 + rnd() * 0.2})` : `rgba(140,190,160,${0.06 + rnd() * 0.12})`;
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return c;
  }

  function stoneCanvas(size, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const rnd = K.hashRand(seed);
    const grd = g.createRadialGradient(size * 0.42, size * 0.38, size * 0.05, size / 2, size / 2, size * 0.6);
    grd.addColorStop(0, '#9c968c'); grd.addColorStop(1, '#5f5a53');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const r = rnd() * 2.2;
      g.fillStyle = rnd() < 0.5 ? `rgba(40,36,32,${rnd() * 0.25})` : `rgba(235,230,220,${rnd() * 0.22})`;
      g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, 7); g.fill();
    }
    // a quartz vein
    g.strokeStyle = 'rgba(240,235,225,0.35)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, size * (0.3 + rnd() * 0.4));
    g.bezierCurveTo(size * 0.3, size * rnd(), size * 0.7, size * rnd(), size, size * (0.3 + rnd() * 0.4)); g.stroke();
    return c;
  }

  // Studio environment: warm sky, darker floor, two soft boxes. Gives the
  // glaze and clearcoat something to reflect.
  function buildEnvironment() {
    const S = 128;
    const face = (fn) => {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); fn(g); return c;
    };
    const side = (bright) => face(g => {
      const grd = g.createLinearGradient(0, 0, 0, S);
      grd.addColorStop(0, '#fff3dc'); grd.addColorStop(0.45, '#d9b98f'); grd.addColorStop(0.55, '#7a5b3e'); grd.addColorStop(1, '#2a1c12');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      if (bright) { g.fillStyle = 'rgba(255,248,230,0.95)'; g.fillRect(S * 0.18, S * 0.12, S * 0.64, S * 0.26); }
    });
    const top = face(g => {
      const grd = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.72);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.35, '#fff1d6'); grd.addColorStop(1, '#e2c296');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      g.fillStyle = 'rgba(255,255,250,1)'; g.fillRect(S * 0.15, S * 0.3, S * 0.3, S * 0.4);
    });
    const bottom = face(g => { g.fillStyle = '#2b1d13'; g.fillRect(0, 0, S, S); });
    const cube = new pc.Texture(device, {
      cubemap: true, width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    // +x, -x, +y, -y, +z, -z
    cube.setSource([side(false), side(true), top, bottom, side(false), side(true)]);
    const lighting = pc.EnvLighting.generateLightingSource(cube);
    const atlas = pc.EnvLighting.generateAtlas(lighting);
    lighting.destroy();
    cube.destroy();
    app.scene.envAtlas = atlas;
    app.scene.skyboxIntensity = 0.9;
  }

  /* ---------- Meshes ---------- */

  // keep: cached meshes are shared by many entities; PlayCanvas destroys a
  // mesh when its last mesh instance goes, so hold an extra reference.
  function toMesh(data, keep) {
    const m = new pc.Mesh(device);
    if (keep) m.incRefCount();
    m.setPositions(data.positions);
    m.setNormals(data.normals);
    m.setUvs(0, data.uvs);
    m.setIndices(data.indices);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }

  function tileMesh(value) {
    const h = Math.round(tileHeight(value) * 100) / 100;
    if (!tileMeshes.has(h)) {
      tileMeshes.set(h, toMesh(K.hexPrism({
        radius: TILE_R, height: h, bevel: 0.1, corner: 0.2, cornerSegments: 5, bevelSegments: 5,
        bottomBevel: 0.03, sideUV: [0.5, 0.02],
      }), true));
    }
    return tileMeshes.get(h);
  }

  function makeMaterial(opts) {
    const m = new pc.StandardMaterial();
    m.useMetalness = true;
    m.metalness = opts.metal || 0;
    m.gloss = opts.gloss ?? 0.6;
    if (opts.color) m.diffuse = new pc.Color().fromString(opts.color);
    if (opts.map) { m.diffuseMap = opts.map; if (opts.tiling) m.diffuseMapTiling = new pc.Vec2(opts.tiling, opts.tiling); }
    if (opts.clearCoat) { m.clearCoat = opts.clearCoat; m.clearCoatGloss = opts.clearCoatGloss ?? 0.9; }
    if (opts.emissive) { m.emissive = new pc.Color().fromString(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity || 1; }
    m.update();
    return m;
  }

  function tileMaterial(value) {
    if (materials.has(value)) return materials.get(value);
    const [glaze, ink, extra = {}] = glazeOf(value);
    const tex = canvasTex(K.tileCanvas(256, value, {
      font: FONT, weight: 600, baseline: 0.06,
      background(g, s) {
        g.fillStyle = glaze; g.fillRect(0, 0, s, s);
        // soft pooled glaze: lighter centre, a hint of darker rim
        const grd = g.createRadialGradient(s * 0.45, s * 0.42, s * 0.05, s / 2, s / 2, s * 0.5);
        grd.addColorStop(0, 'rgba(255,255,255,0.18)'); grd.addColorStop(0.75, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(60,30,10,0.12)');
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
      },
      text(g, text, x, y, px) {
        // debossed: highlight below, shade above, then the ink
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillText(text, x, y + px * 0.045);
        g.fillStyle = 'rgba(40,20,5,0.35)'; g.fillText(text, x, y - px * 0.03);
        g.fillStyle = ink; g.fillText(text, x, y);
      },
    }));
    const m = makeMaterial({ map: tex, gloss: extra.gloss ?? 0.74, metal: extra.metal || 0, clearCoat: 0.55, clearCoatGloss: 0.92 });
    materials.set(value, m);
    return m;
  }

  /* ---------- Board ---------- */

  let woodTex, socketMat, stoneTexs = [];
  function buildBoard() {
    if (boardRoot) boardRoot.destroy();
    boardRoot = new pc.Entity('board');
    app.root.addChild(boardRoot);
    const m = K.boardMetrics(topo.radius);
    const slabH = 0.55;
    const slab = new pc.Entity('slab');
    slab.addComponent('render', {
      meshInstances: [new pc.MeshInstance(toMesh(K.hexPrism({
        radius: m.circum, height: slabH, bevel: 0.2, corner: 0.75, rotation: m.rotation,
        cornerSegments: 8, bevelSegments: 6, sideUV: [0.31, 0.5], bottomCap: false,
      })), makeMaterial({ map: woodTex, gloss: 0.62, clearCoat: 0.35, clearCoatGloss: 0.8 }))],
      castShadows: true, receiveShadows: true,
    });
    slab.setLocalPosition(0, -slabH, 0);
    boardRoot.addChild(slab);

    // A darker inlaid band just inside the rim.
    const band = new pc.Entity('band');
    band.addComponent('render', {
      meshInstances: [new pc.MeshInstance(toMesh(K.hexRing({ radius: m.circum - 0.32, corner: 0.5, width: 0.07, rotation: m.rotation, y: 0.004 })),
        makeMaterial({ color: '#2c1a0e', gloss: 0.5 }))],
      castShadows: false, receiveShadows: true,
    });
    boardRoot.addChild(band);

    const socketMesh = toMesh(K.hexPrism({ radius: 0.95, height: 0.012, bevel: 0.01, corner: 0.18, cornerSegments: 4, bevelSegments: 1 }));
    topo.cells.forEach((c, i) => {
      if (topo.blocked[i]) {
        const st = new pc.Entity('stone');
        const rnd = K.hashRand(i * 31 + topo.stones.length);
        const stoneMesh = toMesh(K.hexPrism({
          radius: 0.84 + rnd() * 0.04, height: 0.36 + rnd() * 0.1, bevel: 0.2, corner: 0.48, cornerSegments: 8, bevelSegments: 6,
          bottomBevel: 0.08, sideUV: [0.5, 0.5],
        }));
        st.addComponent('render', {
          meshInstances: [new pc.MeshInstance(stoneMesh, stoneTexs[i % stoneTexs.length])],
          castShadows: true, receiveShadows: true,
        });
        st.setLocalPosition(c.x, 0.0, c.z);
        st.setLocalEulerAngles(0, rnd() * 60 - 30, 0);
        boardRoot.addChild(st);
        return;
      }
      const s = new pc.Entity('socket');
      s.addComponent('render', { meshInstances: [new pc.MeshInstance(socketMesh, socketMat)], castShadows: false, receiveShadows: true });
      s.setLocalPosition(c.x, 0, c.z);
      boardRoot.addChild(s);
    });
  }

  /* ---------- Confetti chips ---------- */

  function spawnChips(count, origin, spread, power) {
    if (reduced) count = Math.min(count, 12);
    if (!chipMeshes) {
      chipMeshes = {
        mesh: toMesh(K.hexPrism({ radius: 0.13, height: 0.03, bevel: 0.01, corner: 0.03, cornerSegments: 1, bevelSegments: 1, bottomCap: true }), true),
        mats: [3, 5, 7, 8, 9, 10, 11].map(e => makeMaterial({ color: GLAZE[e][0], gloss: 0.7, metal: e === 11 ? 0.8 : 0 })),
      };
    }
    for (let i = 0; i < count; i++) {
      const e = new pc.Entity('chip');
      e.addComponent('render', {
        meshInstances: [new pc.MeshInstance(chipMeshes.mesh, chipMeshes.mats[i % chipMeshes.mats.length])],
        castShadows: true, receiveShadows: false,
      });
      fxRoot.addChild(e);
      const a = Math.random() * K.TAU;
      const r = Math.random() * spread;
      const up = power * (0.7 + Math.random() * 0.6);
      chips.push({
        e, x: origin.x + Math.cos(a) * r, y: origin.y, z: origin.z + Math.sin(a) * r,
        vx: Math.cos(a) * (1 + Math.random() * 2.5) * power * 0.35, vy: up, vz: Math.sin(a) * (1 + Math.random() * 2.5) * power * 0.35,
        rx: Math.random() * 360, ry: Math.random() * 360, rz: Math.random() * 360,
        wx: (Math.random() - 0.5) * 900, wy: (Math.random() - 0.5) * 900, wz: (Math.random() - 0.5) * 900,
        life: 0, rest: false,
      });
    }
    while (chips.length > 260) { const c = chips.shift(); c.e.destroy(); }
  }

  function updateChips(dt) {
    if (!chips.length) return false;
    const m = K.boardMetrics(topo.radius);
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i];
      c.life += dt;
      if (!c.rest) {
        c.vy -= 14 * dt;
        c.vx *= 1 - 0.6 * dt; c.vz *= 1 - 0.6 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        const onBoard = Math.hypot(c.x, c.z) < m.apothem;
        const floor = (onBoard ? 0.02 : -0.53);
        if (c.y < floor) {
          c.y = floor;
          if (Math.abs(c.vy) < 1.2) { c.rest = true; c.rx = 0; c.rz = 0; }
          c.vy = -c.vy * 0.3; c.vx *= 0.5; c.vz *= 0.5; c.wx *= 0.4; c.wz *= 0.4;
        }
      }
      const fade = K.clamp((3.6 - c.life) / 0.6, 0, 1);
      c.e.setLocalPosition(c.x, c.y, c.z);
      c.e.setLocalEulerAngles(c.rx, c.ry, c.rz);
      c.e.setLocalScale(fade, fade, fade);
      if (c.life > 3.6) { c.e.destroy(); chips.splice(i, 1); }
    }
    return true;
  }

  /* ---------- Camera ---------- */

  function placeCamera() {
    const yaw = view.yaw + view.ppx * 0.035;
    const pitch = view.pitch - view.ppy * 0.03;
    const d = view.dist;
    const x = view.tx + Math.sin(yaw) * Math.cos(pitch) * d;
    const z = view.tz + Math.cos(yaw) * Math.cos(pitch) * d;
    const y = Math.sin(pitch) * d;
    cameraEnt.setPosition(x, y, z);
    cameraEnt.lookAt(view.tx, 0, view.tz);
  }

  const tmpV = new pc.Vec3(), tmpS = new pc.Vec3();
  function project(x, y, z) {
    tmpV.set(x, y, z);
    // The view matrix is cached per frame; the fit loop moves the camera
    // several times between frames, so force a refresh.
    camera.camera._viewMatDirty = true;
    camera.worldToScreen(tmpV, tmpS);
    return { x: tmpS.x, y: tmpS.y };
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
      const a = m.rotation + k * Math.PI / 3 + Math.PI / 6 - Math.PI / 6;
      const ang = -Math.PI / 2 + k * Math.PI / 3;
      pts.push([Math.cos(ang) * reach, 0, Math.sin(ang) * reach]);
      pts.push([Math.cos(a) * m.circum, -0.55, Math.sin(a) * m.circum]);
    }
    const saved = { px: view.ppx, py: view.ppy };
    view.ppx = view.ppy = 0;
    const r = K.fitCamera({
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
    // keep the focus plane on the board
    frame.dof.focusDistance = r.dist;
    frame.dof.focusRange = m.circum * 1.6;
    keyLight.light.shadowDistance = r.dist + m.circum * 3;
    frame.update();
  }

  /* ---------- API ---------- */

  const api = {
    name: 'PlayCanvas',
    tileTop: 0.4,

    async init() {
      if (typeof pc === 'undefined') throw new Error('PlayCanvas did not load (offline?)');
      app = new pc.Application(canvas, {
        graphicsDeviceOptions: { antialias: false, alpha: false, powerPreference: 'high-performance' },
      });
      device = app.graphicsDevice;
      api.app = app; // debug handle
      device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      app.setCanvasFillMode(pc.FILLMODE_NONE);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
      app.autoRender = false;

      woodTex = canvasTex(woodCanvas(1024, '#6b4329', '#2e1a0d', 11));
      socketMat = makeMaterial({ map: canvasTex(woodCanvas(256, '#4a2c19', '#1e1008', 5)), gloss: 0.35 });
      for (let k = 0; k < 3; k++) stoneTexs.push(makeMaterial({ map: canvasTex(stoneCanvas(256, 300 + k)), gloss: 0.42, clearCoat: 0.2 }));

      buildEnvironment();
      app.scene.ambientLight = new pc.Color(0.2, 0.17, 0.14);

      cameraEnt = new pc.Entity('camera');
      cameraEnt.addComponent('camera', {
        clearColor: new pc.Color().fromString('#1f3d33'),
        fov: 28, nearClip: 0.5, farClip: 400,
      });
      camera = cameraEnt.camera;
      app.root.addChild(cameraEnt);

      frame = new pc.CameraFrame(app, camera);
      frame.rendering.samples = 4;
      frame.rendering.toneMapping = pc.TONEMAP_NEUTRAL;
      frame.ssao.type = pc.SSAOTYPE_COMBINE;
      frame.ssao.intensity = 0.55;
      frame.ssao.radius = 0.9;
      frame.ssao.samples = 12;
      frame.ssao.power = 5;
      frame.bloom.intensity = 0.012;
      frame.bloom.blurLevel = 12;
      frame.vignette.intensity = 0.38;
      frame.vignette.inner = 0.45;
      frame.vignette.outer = 1.25;
      frame.vignette.color = new pc.Color(0.02, 0.06, 0.04);
      frame.dof.enabled = true;
      frame.dof.blurRadius = 4;
      frame.dof.highQuality = true;
      frame.grading.enabled = true;
      frame.update();

      keyLight = new pc.Entity('sun');
      keyLight.addComponent('light', {
        type: 'directional', color: new pc.Color().fromString('#ffe6c4'), intensity: 1.9,
        castShadows: true, shadowType: pc.SHADOW_PCSS_32F, shadowResolution: 2048, shadowDistance: 60,
        shadowBias: 0.15, normalOffsetBias: 0.04, penumbraSize: 12, penumbraFalloff: 1.3,
      });
      keyLight.setEulerAngles(52, -38, 0);
      app.root.addChild(keyLight);

      fillLight = new pc.Entity('fill');
      fillLight.addComponent('light', { type: 'directional', color: new pc.Color().fromString('#bcd2ff'), intensity: 0.28, castShadows: false });
      fillLight.setEulerAngles(40, 150, 0);
      app.root.addChild(fillLight);

      tableEnt = new pc.Entity('table');
      tableEnt.addComponent('render', {
        type: 'plane',
        material: makeMaterial({ map: canvasTex(feltCanvas(512), { repeat: true }), tiling: 22, gloss: 0.12 }),
        castShadows: false, receiveShadows: true,
      });
      tableEnt.setLocalScale(160, 1, 160);
      tableEnt.setLocalPosition(0, -0.551, 0);
      app.root.addChild(tableEnt);

      tileRoot = new pc.Entity('tiles'); app.root.addChild(tileRoot);
      fxRoot = new pc.Entity('fx'); app.root.addChild(fxRoot);

      field = new K.TileField({
        feel,
        onCreate: vis => {
          const e = new pc.Entity('tile');
          e.addComponent('render', {
            meshInstances: [new pc.MeshInstance(tileMesh(vis.value), tileMaterial(vis.value))],
            castShadows: true, receiveShadows: true,
          });
          tileRoot.addChild(e);
          return e;
        },
        onRemove: vis => vis.obj && vis.obj.destroy(),
      });

      let last = performance.now();
      app.on('update', () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        let busy = field.busy;
        field.update(now, dt);
        for (const vis of field.tiles.values()) {
          const e = vis.obj;
          e.enabled = vis.visible && vis.s > 0.01;
          e.setLocalPosition(vis.x, vis.y + 0.004, vis.z);
          e.setLocalScale(vis.s, vis.s * vis.sy, vis.s);
        }
        // camera sway
        const k = 1 - Math.exp(-6 * dt);
        if (view.goal) {
          const g = view.goal, kg = 1 - Math.exp(-7 * dt);
          view.dist += (g.dist - view.dist) * kg; view.tx += (g.tx - view.tx) * kg; view.tz += (g.tz - view.tz) * kg;
          if (Math.abs(g.dist - view.dist) < 1e-3 && Math.abs(g.tz - view.tz) < 1e-4) { Object.assign(view, g); view.goal = null; }
          placeCamera();
          busy = true;
        }
        const tpx = reduced ? 0 : view.px, tpy = reduced ? 0 : view.py;
        if (Math.abs(tpx - view.ppx) > 1e-4 || Math.abs(tpy - view.ppy) > 1e-4) {
          view.ppx += (tpx - view.ppx) * k; view.ppy += (tpy - view.ppy) * k;
          placeCamera();
          busy = true;
        }
        if (Math.abs(mood - moodTarget) > 1e-3) {
          mood += (moodTarget - mood) * (1 - Math.exp(-3 * dt));
          keyLight.light.intensity = 0.9 + 1.0 * mood;
          frame.grading.saturation = 0.45 + 0.55 * mood;
          frame.grading.brightness = 0.86 + 0.14 * mood;
          frame.update();
          busy = true;
        }
        if (updateChips(dt)) busy = true;
        if (busy || field.busy) app.renderNextFrame = true;
        if (onFrameCb) onFrameCb();
      });
      app.start();
      app.renderNextFrame = true;
    },

    setBoard(t) {
      topo = t;
      field.setTopology(t);
      buildBoard();
      fit(false);
      app.renderNextFrame = true;
    },

    apply(tr) { field.apply(tr, performance.now()); app.renderNextFrame = true; },
    preview(peek, dist) { field.setPreview(peek, dist); app.renderNextFrame = true; },
    hint(peek) { field.hint(peek, performance.now()); app.renderNextFrame = true; },
    nudge(dir) { field.nudge(dir, performance.now()); app.renderNextFrame = true; },

    celebrate(kind, info) {
      if (kind === 'over') moodTarget = 0;
      else if (kind === 'calm') moodTarget = 1;
      else if (kind === 'milestone' || kind === 'win') {
        const c = topo.cells[info.cell] || { x: 0, z: 0 };
        if (kind === 'win') {
          spawnChips(150, { x: 0, y: 3.5, z: 0 }, K.boardMetrics(topo.radius).apothem * 0.8, 3.2);
        } else {
          spawnChips(Math.min(60, 10 + Math.log2(info.value) * 3), { x: c.x, y: 0.6, z: c.z }, 0.3, 5.5);
        }
      }
      app.renderNextFrame = true;
    },

    layout(insets, opts) {
      const animate = !!opts.animate && !!layoutState && layoutState.opts.width === opts.width && layoutState.opts.height === opts.height;
      layoutState = { insets, opts };
      app.resizeCanvas(opts.width, opts.height);
      camera.aspectRatioMode = pc.ASPECT_MANUAL;
      camera.aspectRatio = opts.width / Math.max(1, opts.height);
      fit(animate);
      app.renderNextFrame = true;
    },

    project,
    setReduced(v) { reduced = v; field.reduced = v; },
    setPointer(nx, ny) { view.px = nx; view.py = ny; app.renderNextFrame = true; },
  };
  let onFrameCb = null;
  api.onFrame = cb => { onFrameCb = cb; };
  return api;
}

window.createPlayCanvasRenderer = function (opts) {
  const r = createRenderer(opts);
  if (opts.onFrame) r.onFrame(opts.onFrame);
  return r;
};
})();
