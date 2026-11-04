import * as THREE from 'three';

// Robot database shown in a holographic projector: each robot model is rebuilt with additive
// fresnel/scanline materials and turns slowly above an emitter while its stats sit beside it.

const HOLO = new THREE.Color(0x50c8ff);
const holoVert = `
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vN = normalize(normalMatrix * normal); vV = -mv.xyz; vY = wp.y;
    gl_Position = projectionMatrix * mv;
  }`;
const holoFrag = `
  uniform vec3 color; uniform float time; uniform float base; uniform float glitch;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float scan = 0.65 + 0.35 * sin(vY * 30.0 - time * 7.0);
    float sweep = smoothstep(0.0, 0.25, 0.25 - abs(fract(vY * 0.12 - time * 0.35) - 0.5)) * 1.6;
    float flicker = 0.92 + 0.08 * sin(time * 53.0) * sin(time * 7.3) - glitch;
    float a = (base + fres * 0.95) * scan * flicker + sweep * 0.25;
    gl_FragColor = vec4(color * a, 1.0);
  }`;
function holoMat(color, base, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, base: { value: base }, time: uniforms.time, glitch: uniforms.glitch },
    vertexShader: holoVert, fragmentShader: holoFrag,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// Display names, roles and briefings. Numbers come from the live enemy tables.
const INFO = {
  drone: { name: 'SURVEY DRONE', role: 'Light patrol', text: 'A mapping unit refitted with a pulse emitter. Fast and fragile, and it leads its shots, so keep sliding sideways.' },
  leech: { name: 'LEECH', role: 'Melee harrier', text: 'A spiked rubble-clearing hull. It rams the ship, backs off and rams again. It has no ranged weapon; shoot it while it lines up.' },
  sentry: { name: 'SENTRY TURRET', role: 'Fixed emplacement', text: 'Bolted to a stalk, it cannot move, but it tracks you and fires three-round bursts. Peek, shoot and duck back behind cover.' },
  wasp: { name: 'WASP', role: 'Swarm interceptor', text: 'Small and very quick. It weaves on approach and stings with needle rounds. One or two hits bring it down.' },
  brute: { name: 'BRUTE', role: 'Heavy hauler', text: 'An armour-plated ore mover. Slow to turn, it lobs homing plasma that can be dodged around a corner.' },
  minelayer: { name: 'MINELAYER', role: 'Area denial', text: 'Hangs back and seeds the tunnels with proximity mines. Mines can be shot from a safe range before you fly through.' },
  phantom: { name: 'PHANTOM', role: 'Stealth hunter', text: 'A cloaking hull that shows only as a shimmer until it uncloaks to fire twin lances. Watch for the flicker.' },
  warden: { name: 'WARDEN', role: 'Reactor guardian', text: 'A command-grade hull guarding the reactor complex. Four-rocket volleys plus a plasma cannon. It carries homing missiles.' },
  overseer: { name: 'OVERSEER', role: 'Command intelligence', text: 'The mind behind the uprising, sealed in its own arena. Rocket pods and homing plasma; as its armour plates break it adds lance fans, launches wasps, and finally fires rings of bolts.' },
};
const SHOT_NAMES = { bolt: 'Pulse bolt', needle: 'Needle gun', plasma: 'Homing plasma', lance: 'Lance beam', rocket: 'Rocket pod' };

function bar(v) {
  const n = Math.max(1, Math.round(Math.min(1, v) * 10));
  return `<span class="bar">${'<i></i>'.repeat(n)}${'<i class="off"></i>'.repeat(10 - n)}</span>`;
}
const avg = (r) => (r[0] + r[1]) / 2;

export function createHolotank({ renderer, MODELS, ET, PK, census, sectors, root, onClose, blip }) {
  const types = Object.keys(INFO).filter(t => MODELS[t]);
  const uniforms = { time: { value: 0 }, glitch: { value: 0 } };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010408);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  cam.position.set(0, 1.8, 15);

  // Projector: emitter base, rings and a light cone.
  const ringMat = holoMat(HOLO, 0.5, uniforms);
  const base = new THREE.Group(); base.position.y = -3.6; scene.add(base);
  base.add(new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.4, 0.5, 48), new THREE.MeshBasicMaterial({ color: 0x0b1620 })));
  const rings = [3.4, 2.6, 1.6].map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 64), ringMat);
    m.rotation.x = Math.PI / 2; m.position.y = 0.3 + i * 0.02; base.add(m); return m;
  });
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { time: uniforms.time },
    vertexShader: 'varying float vH; void main() { vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float time; varying float vH; void main() { float a = (1.0 - vH) * 0.16 * (0.85 + 0.15 * sin(time * 9.0)); gl_FragColor = vec4(vec3(0.3, 0.75, 1.0) * a, 1.0); }',
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 2.2, 8.5, 48, 1, true), coneMat);
  cone.position.y = 4.5; base.add(cone);
  // Dust motes drifting up through the beam.
  const N = 160, dust = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, r = Math.random() * 3.5; dust.set([Math.cos(a) * r, Math.random() * 9 - 3.4, Math.sin(a) * r], i * 3); }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const motes = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x60c8ff, size: 0.06, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
  scene.add(motes);

  const pivot = new THREE.Group(); scene.add(pivot);
  const holder = new THREE.Group(); pivot.add(holder);

  // Rebuild a model's meshes with holo materials: lights (basic materials) keep their colour,
  // hull parts go projector-blue, and every mesh gets crisp edge lines.
  function holoModel(type) {
    const m = MODELS[type]();
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fe4ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 });
    const meshes = [];
    m.g.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const src = o.material, light = src.isMeshBasicMaterial;
      o.material = holoMat(light ? src.color.clone().lerp(new THREE.Color(1, 1, 1), 0.15) : HOLO, light ? 0.75 : 0.1, uniforms);
      if (!light) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), edgeMat));
    }
    m.g.traverse((o) => { if (o.isSprite) { o.material = o.material.clone(); o.material.opacity = Math.max(0.5, o.material.opacity) * 0.8; } });
    // Fit to the projector volume, centred on the beam.
    const box = new THREE.Box3().setFromObject(m.g), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const s = 6.2 / Math.max(size.x, size.y * 1.3, size.z);
    m.g.scale.setScalar(s); m.g.position.copy(mid).multiplyScalar(-s);
    return m.g;
  }

  function statsHtml(type) {
    const T = ET[type], I = INFO[type], c = census[type] || { count: 0, sector: 0 };
    let dps = 0, weapons = [];
    if (T.shot) {
      const burst = T.burst || 1;
      dps += PK[T.shot].dmg * burst / avg(T.cd);
      weapons.push(`${SHOT_NAMES[T.shot]}${burst > 1 ? ` &times;${burst}` : ''} <em>${PK[T.shot].dmg} dmg</em>`);
    }
    if (T.shot2) { dps += PK[T.shot2].dmg / avg(T.cd2); weapons.push(`${SHOT_NAMES[T.shot2]} <em>${PK[T.shot2].dmg} dmg</em>`); }
    if (T.mines) { dps += 13 / avg(T.mines); weapons.push('Proximity mines <em>up to 26 dmg</em>'); }
    if (T.melee) { dps += T.melee / 1.1; weapons.push(`Ramming spikes <em>${T.melee} dmg</em>`); }
    const traits = [];
    if (T.stationary) traits.push('stationary');
    if (T.cloak) traits.push('cloaks');
    if (T.weave) traits.push('evasive');
    if (T.lead >= 0.6) traits.push('leads its target');
    if (T.drop >= 0.5) traits.push('often drops shields');
    if (type === 'warden') traits.push('drops missiles');
    if (T.boss) { traits.push('boss', 'three armour phases', 'launches wasps'); weapons.push('Lance fan &times;5, bolt nova &times;16'); }
    return `
      <div class="h-role">${I.role}</div>
      <h3>${I.name}</h3>
      <p>${I.text}</p>
      <div class="h-grid">
        <span>ARMOR</span>${bar(T.hp / 450 * 1.6)}<b>${T.hp}</b>
        <span>SPEED</span>${bar(T.speed / 25)}<b>${T.speed ? Math.round(T.speed) : '&ndash;'}</b>
        <span>FIREPOWER</span>${bar(dps / 20)}<b>${dps.toFixed(1)}/s</b>
        <span>SIZE</span>${bar(T.r / 3.6)}<b>${T.r.toFixed(1)}</b>
      </div>
      <div class="h-row"><span>WEAPONS</span><div>${weapons.join('<br>')}</div></div>
      ${traits.length ? `<div class="h-row"><span>NOTES</span><div>${traits.join(', ')}</div></div>` : ''}
      <div class="h-row"><span>FIRST SEEN</span><div>${sectors[c.sector] || 'Not in this mission'}</div></div>
      <div class="h-row"><span>IN THIS MINE</span><div>${c.count}</div></div>`;
  }

  const list = root.querySelector('.h-list'), stats = root.querySelector('.h-stats'), count = root.querySelector('.h-count');
  list.innerHTML = types.map((t, i) => `<button data-i="${i}">${INFO[t].name}</button>`).join('');
  let fit = 1, idx = 0, spin = 0, tilt = 0.18, spinV = 0.45, dist = 15, swapT = 0, open = false;
  function select(i) {
    idx = (i + types.length) % types.length;
    holder.clear();
    holder.add(holoModel(types[idx]));
    stats.innerHTML = statsHtml(types[idx]);
    count.textContent = `${idx + 1} / ${types.length}`;
    list.querySelectorAll('button').forEach((b, j) => b.classList.toggle('sel', j === idx));
    swapT = 0.35;
    blip(idx);
  }
  list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(+b.dataset.i); });
  root.querySelector('.h-prev').addEventListener('click', () => select(idx - 1));
  root.querySelector('.h-next').addEventListener('click', () => select(idx + 1));
  root.querySelector('.h-back').addEventListener('click', () => onClose());

  // Drag to turn the model, wheel to zoom.
  const stage = root.querySelector('.h-stage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    spin += (e.clientX - drag.x) * 0.01; tilt = THREE.MathUtils.clamp(tilt + (e.clientY - drag.y) * 0.006, -0.9, 0.9);
    drag = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('wheel', (e) => { dist = THREE.MathUtils.clamp(dist * Math.exp(e.deltaY * 0.001), 9, 26); }, { passive: true });

  function resize() {
    const w = innerWidth, h = innerHeight;
    cam.aspect = w / h;
    // Shift the projector left of the stats panel on wide screens.
    // Narrow screens: back the camera off to fit the width and raise the projector above the panel.
    if (w > 760) { cam.setViewOffset(w, h, w * 0.1, 0, w, h); fit = 1; }
    else { cam.setViewOffset(w, h, 0, h * 0.2, w, h); fit = Math.min(2.4, Math.max(1, 0.95 / cam.aspect)); }
    cam.updateProjectionMatrix();
  }

  return {
    open() { open = true; root.style.display = 'flex'; resize(); select(idx); },
    close() { open = false; root.style.display = 'none'; holder.clear(); },
    get isOpen() { return open; },
    step(d) { select(idx + d); },
    resize,
    render(dt) {
      uniforms.time.value += dt;
      swapT = Math.max(0, swapT - dt);
      uniforms.glitch.value = swapT > 0 ? Math.random() * swapT * 2 : (Math.random() < 0.004 ? 0.4 : 0);
      if (!drag) spin += dt * spinV;
      pivot.rotation.set(tilt, spin, 0);
      holder.position.y = Math.sin(uniforms.time.value * 1.3) * 0.15 + (swapT > 0 ? (Math.random() - 0.5) * swapT : 0);
      holder.scale.setScalar(1 - swapT * 0.6);
      rings.forEach((r, i) => { r.rotation.z += dt * (i % 2 ? -0.6 : 0.4); });
      const p = dustGeo.attributes.position;
      for (let i = 0; i < N; i++) { let y = p.getY(i) + dt * 0.6; if (y > 5.6) y = -3.4; p.setY(i, y); }
      p.needsUpdate = true;
      cam.position.set(0, 1.8 * dist / 15, dist * fit);
      cam.lookAt(0, 0.2, 0);
      renderer.render(scene, cam);
    },
  };
}
