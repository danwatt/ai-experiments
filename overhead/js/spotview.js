// "Spot" view: what's in front of you from where you're standing — a pinhole
// camera at your location, pointed where you (or your tablet) face. The airfield
// is drawn in perspective so it can be matched against the real one; aircraft sit
// where they really are, with cards for what they're doing, and arrows at the
// edges for traffic about to come into view.
import { toLocal, bearing, destination, compassPoint, angleDiff, haversine, M_PER_FT, M_PER_NM, MS_PER_KT, R_EARTH } from "./geo.js";
import { sunLook } from "./sun.js";

const D2R = Math.PI / 180;
const NEAR = 5; // metres
const LENGTH_M = { heavy: 65, large: 38, small: 18, fast: 18, light: 9, rotor: 14, other: 12 };
const MOVE_COLORS = { arr: "#50e696", dep: "#5cc8ff" };

export class SpotView {
  constructor(canvas, { onSelect, onLook, onZoom }) {
    this.cv = canvas;
    this.g = canvas.getContext("2d");
    this.hits = [];
    let drag = null, moved = 0;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
      moved = 0;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      // drag the scene: moving it right turns you left, moving it down looks up
      const degPerPx = (this.fov || 70) / Math.max(1, canvas.clientWidth);
      onLook(-dx * degPerPx, dy * degPerPx);
    });
    canvas.addEventListener("pointerup", (e) => {
      drag = null;
      if (moved > 6) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 40;
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) onSelect(best.hex);
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      onZoom(1.1 ** Math.sign(e.deltaY));
    }, { passive: false });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.round(this.cv.clientWidth * dpr);
    this.cv.height = Math.round(this.cv.clientHeight * dpr);
    this.dpr = dpr;
  }

  /**
   * o: { home, observerFt, yaw, pitch, fov, light, sun, ap: {airports, runways, ends, guides},
   *      moves: Map(hex -> movement), spotAp, aligning, bottomInset }
   */
  render(items, o) {
    const { g, cv } = this;
    if (cv.width !== Math.round(cv.clientWidth * (window.devicePixelRatio || 1))) this.resize();
    const W = cv.width / this.dpr, H = cv.height / this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hits = [];
    this.fov = o.fov;
    if (!o.home || !W) return;

    // ---- camera: x right, y up, z forward
    const f = W / 2 / Math.tan((o.fov / 2) * D2R);
    const cyw = Math.cos(o.yaw * D2R), syw = Math.sin(o.yaw * D2R);
    const cp = Math.cos(o.pitch * D2R), sp = Math.sin(o.pitch * D2R);
    const F = [syw * cp, cyw * cp, sp], R = [cyw, -syw, 0], U = [-syw * sp, -cyw * sp, cp];
    const fromLocal3 = (x, y, z) => [x * R[0] + y * R[1], x * U[0] + y * U[1] + z * U[2], x * F[0] + y * F[1] + z * F[2]];
    // altitude in feet MSL → metres above the observer, minus earth curvature (with refraction)
    const camXY = (x, y, altFt) => fromLocal3(x, y, (altFt - o.observerFt) * M_PER_FT - (x * x + y * y) / (2 * R_EARTH * 1.15));
    const cam = (lat, lon, altFt) => camXY(...toLocal(o.home.lat, o.home.lon, lat, lon), altFt);
    const proj = (c) => [W / 2 + (f * c[0]) / c[2], H / 2 - (f * c[1]) / c[2]];
    const onScreen = ([x, y], m = 0) => x > -m && x < W + m && y > -m && y < H + m;
    const dir = (az, el) => fromLocal3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.cos(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R));

    const look = o.sun ? sunLook(o.sun.el, !o.light) : null;
    const day = look ? o.sun.el > 0 : o.light;
    const ink = day ? "20,40,70" : "190,210,240";
    const horizonY = H / 2 + f * Math.tan(o.pitch * D2R);

    // ---- sky and ground
    const sky = g.createLinearGradient(0, Math.min(horizonY, H) - H, 0, Math.min(horizonY, H));
    sky.addColorStop(0, look ? look.sky : day ? "#6aa6e0" : "#060b16");
    sky.addColorStop(1, look ? look.horizon : day ? "#cfe2f4" : "#1a2440");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    if (horizonY < H) {
      const ground = g.createLinearGradient(0, Math.max(0, horizonY), 0, H);
      ground.addColorStop(0, day ? "#b7c2a6" : "#1d241d");
      ground.addColorStop(1, day ? "#7f9070" : "#0b0f0b");
      g.fillStyle = ground;
      g.fillRect(0, Math.max(0, horizonY), W, H - Math.max(0, horizonY));
    }

    // ---- sun
    if (o.sun && o.sun.el > -3) {
      const c = dir(o.sun.az, o.sun.el);
      if (c[2] > 0) {
        const [x, y] = proj(c);
        const glow = g.createRadialGradient(x, y, 0, x, y, 60);
        glow.addColorStop(0, "rgba(255,230,150,0.9)");
        glow.addColorStop(1, "rgba(255,220,140,0)");
        g.fillStyle = glow;
        g.beginPath(); g.arc(x, y, 60, 0, Math.PI * 2); g.fill();
      }
    }

    // ---- elevation guides and compass along the horizon
    g.lineWidth = 1;
    for (const el of [5, 10, 20, 30, 45]) {
      g.strokeStyle = `rgba(${ink},0.16)`;
      g.setLineDash([3, 6]);
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 40; i++) {
        const c = dir(o.yaw - o.fov / 2 - 5 + ((o.fov + 10) * i) / 40, el);
        if (c[2] <= 0.01) { started = false; continue; }
        const p = proj(c);
        g[started ? "lineTo" : "moveTo"](...p);
        started = true;
      }
      g.stroke();
      g.setLineDash([]);
      const lp = proj(dir(o.yaw - o.fov / 2 + 1.5, el));
      if (lp[1] > 20 && lp[1] < horizonY - 10) {
        g.fillStyle = `rgba(${ink},0.55)`;
        g.font = "10px Inter, system-ui, sans-serif";
        g.textAlign = "left";
        g.fillText(`${el}°`, 6, lp[1] - 3);
      }
    }
    g.strokeStyle = `rgba(${ink},0.45)`;
    g.beginPath(); g.moveTo(0, horizonY); g.lineTo(W, horizonY); g.stroke();
    const first = Math.ceil((o.yaw - o.fov / 2 - 10) / 5) * 5;
    g.textAlign = "center";
    for (let az = first; az <= o.yaw + o.fov / 2 + 10; az += 5) {
      const c = dir(az, 0);
      if (c[2] <= 0.01) continue;
      const [x] = proj(c);
      const a = ((az % 360) + 360) % 360, major = a % 15 === 0;
      g.strokeStyle = `rgba(${ink},${major ? 0.7 : 0.3})`;
      g.beginPath(); g.moveTo(x, horizonY); g.lineTo(x, horizonY - (major ? 9 : 5)); g.stroke();
      if (a % 45 === 0 || (major && o.fov < 50)) {
        g.fillStyle = a === 0 ? "#ff7a5a" : `rgba(${ink},0.85)`;
        g.font = `${a % 90 === 0 ? 700 : 500} 11px Inter, system-ui, sans-serif`;
        g.fillText(a % 45 === 0 ? compassPoint(a) : `${a}°`, x, horizonY - 13);
      }
    }

    // ---- airfield: runways in perspective, active ones tinted, approach / climb-out guides
    if (o.ap) this.drawAirfield(o, { camXY, cam, proj, onScreen, ink, day });

    // ---- buildings and aircraft, painted far to near so nearer things cover farther ones
    const placed = [], offscreen = [], scene = [];
    if (o.buildings) {
      const sunVec = o.sun && o.sun.el > 0 ? [Math.sin(o.sun.az * D2R), Math.cos(o.sun.az * D2R)] : null;
      for (const b of o.buildings) {
        const dist = Math.hypot(b.cx, b.cy);
        if (dist > 2000 && Math.abs(b.area) < 400) continue; // small, far: invisible anyway
        const toward = camXY(b.cx, b.cy, o.groundFt);
        if (toward[2] < -200) continue; // behind us
        scene.push({ dist, draw: () => this.drawBuilding(b, o, { camXY, proj, day, sunVec, W, H }) });
      }
    }
    for (const d of items) {
      const c = cam(d.st.lat, d.st.lon, d.st.alt);
      const dist = Math.hypot(...c);
      if (c[2] > NEAR) {
        const p = proj(c);
        if (onScreen(p, 30)) { placed.push({ d, c, p, dist }); continue; }
      }
      if (dist < 35e3 && (!d.st.ground || o.moves?.has(d.hex))) offscreen.push({ d, c, dist });
    }
    for (const it of placed) scene.push({ dist: it.dist, draw: () => this.drawAircraft(it, o, { cam, proj, f }) });
    scene.sort((a, b) => b.dist - a.dist);
    for (const s of scene) s.draw();
    const taken = this.drawEdgeArrows(offscreen, o, W, H, { cam, proj, day });
    this.drawCards(placed, o, W, H, ink, day, taken);

    // ---- alignment crosshair
    if (o.aligning) {
      g.strokeStyle = "#ffb35c";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W / 2 - 22, H / 2); g.lineTo(W / 2 - 6, H / 2); g.moveTo(W / 2 + 6, H / 2); g.lineTo(W / 2 + 22, H / 2);
      g.moveTo(W / 2, H / 2 - 22); g.lineTo(W / 2, H / 2 - 6); g.moveTo(W / 2, H / 2 + 6); g.lineTo(W / 2, H / 2 + 22);
      g.stroke();
      g.lineWidth = 1;
    }

    // ---- heading readout
    g.font = "600 12px Inter, system-ui, sans-serif";
    g.textAlign = "left";
    g.fillStyle = `rgba(${ink},0.9)`;
    const yawN = ((o.yaw % 360) + 360) % 360;
    const field = o.spotAp ? ` · ${o.spotAp.iata || o.spotAp.ident} ${(haversine(o.home.lat, o.home.lon, o.spotAp.lat, o.spotAp.lon) / M_PER_NM).toFixed(1)} nm` : "";
    g.fillText(`Facing ${Math.round(yawN)}° ${compassPoint(yawN)} · ${o.pitch >= 0 ? "+" : ""}${Math.round(o.pitch)}° · ${Math.round(o.fov)}° view${field}`, 12, 20);
  }

  drawAirfield(o, { camXY, cam, proj, onScreen, ink, day }) {
    const g = this.g;
    // runway outlines: rectangles on the ground, clipped at the camera
    for (const r of o.ap.runways) {
      const [a, b] = r.path;
      const A = toLocal(o.home.lat, o.home.lon, a[1], a[0]), B = toLocal(o.home.lat, o.home.lon, b[1], b[0]);
      if (Math.min(Math.hypot(...A), Math.hypot(...B)) > 30e3) continue;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      const px = (-(B[1] - A[1]) / len) * (r.widthM / 2), py = ((B[0] - A[0]) / len) * (r.widthM / 2);
      const quad = [[A[0] + px, A[1] + py], [B[0] + px, B[1] + py], [B[0] - px, B[1] - py], [A[0] - px, A[1] - py]]
        .map(([x, y]) => camXY(x, y, r.elevFt));
      const poly = clipPolygon(quad).map(proj);
      if (poly.length < 3) continue;
      g.fillStyle = r.active === "arr" ? "rgba(80,230,150,0.75)" : r.active === "dep" ? "rgba(92,200,255,0.75)" : day ? "rgba(70,72,78,0.85)" : "rgba(120,128,140,0.7)";
      g.strokeStyle = day ? "rgba(255,255,255,0.6)" : "rgba(220,230,245,0.35)";
      g.beginPath();
      poly.forEach((p, i) => g[i ? "lineTo" : "moveTo"](...p));
      g.closePath(); g.fill(); g.stroke();
      // centreline
      const cl = clipSegment(camXY(A[0], A[1], r.elevFt), camXY(B[0], B[1], r.elevFt));
      if (cl) {
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.setLineDash([6, 8]);
        g.beginPath(); g.moveTo(...proj(cl[0])); g.lineTo(...proj(cl[1])); g.stroke();
        g.setLineDash([]);
      }
    }
    for (const gd of o.ap.guides || []) {
      g.strokeStyle = gd.kind === "arr" ? "rgba(80,230,150,0.85)" : "rgba(92,200,255,0.85)";
      g.lineWidth = 2;
      g.setLineDash([8, 6]);
      for (let i = 0; i < gd.path.length - 1; i++) {
        const s = clipSegment(cam(gd.path[i][1], gd.path[i][0], gd.path[i][2]), cam(gd.path[i + 1][1], gd.path[i + 1][0], gd.path[i + 1][2]));
        if (!s) continue;
        g.beginPath(); g.moveTo(...proj(s[0])); g.lineTo(...proj(s[1])); g.stroke();
      }
      g.setLineDash([]);
      g.lineWidth = 1;
    }
    // runway-end numbers and airport codes
    g.textAlign = "center";
    g.font = "700 11px JetBrains Mono, ui-monospace, monospace";
    for (const e of o.ap.ends) {
      const c = cam(e.lat, e.lon, e.elevFt);
      if (c[2] < NEAR || Math.hypot(...c) > 20e3) continue;
      const p = proj(c);
      if (!onScreen(p)) continue;
      label(g, e.ident, p[0], p[1] + 14, day ? "#1d2a14" : "#e8f0ff", day ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.6)");
    }
    g.font = "600 11px Inter, system-ui, sans-serif";
    for (const a of o.ap.airports) {
      if (a.size === "small" && a.ident !== o.spotAp?.ident) continue;
      const c = cam(a.lat, a.lon, a.elevFt || 0);
      if (c[2] < NEAR) continue;
      const p = proj(c);
      if (!onScreen(p)) continue;
      label(g, a.iata || a.ident, p[0], Math.min(p[1] + 30, this.cv.clientHeight - 80), `rgba(${ink},0.8)`, day ? "rgba(255,255,255,.6)" : "rgba(0,0,0,.5)");
    }
  }

  /** Extruded footprint: visible walls far to near, shaded by the sun, then the roof if we're above it. */
  drawBuilding(b, o, { camXY, proj, day, sunVec, W, H }) {
    const g = this.g, n = b.ring.length;
    const base = o.groundFt + b.base / M_PER_FT, top = o.groundFt + b.h / M_PER_FT;
    const ccw = b.area > 0;
    const walls = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = b.ring[i], [x2, y2] = b.ring[(i + 1) % n];
      let nx = y2 - y1, ny = -(x2 - x1); // outward for a counter-clockwise ring
      if (!ccw) { nx = -nx; ny = -ny; }
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (nx * mx + ny * my >= 0) continue; // faces away from us
      const len = Math.hypot(nx, ny) || 1;
      walls.push({ x1, y1, x2, y2, nx: nx / len, ny: ny / len, d: Math.hypot(mx, my) });
    }
    walls.sort((a, c) => c.d - a.d);
    const shade = (w) => {
      const lit = sunVec ? Math.max(0, w.nx * sunVec[0] + w.ny * sunVec[1]) : 0.3;
      return day ? `rgb(${Math.round(120 + 70 * lit)},${Math.round(126 + 70 * lit)},${Math.round(136 + 66 * lit)})`
        : `rgb(${Math.round(34 + 18 * lit)},${Math.round(40 + 18 * lit)},${Math.round(52 + 20 * lit)})`;
    };
    g.lineWidth = 0.6;
    g.strokeStyle = day ? "rgba(60,64,72,0.55)" : "rgba(120,140,170,0.35)";
    let drew = false;
    for (const w of walls) {
      const quad = clipPolygon([camXY(w.x1, w.y1, base), camXY(w.x2, w.y2, base), camXY(w.x2, w.y2, top), camXY(w.x1, w.y1, top)]);
      if (quad.length < 3) continue;
      const pts = quad.map(proj);
      if (pts.every(([x]) => x < 0) || pts.every(([x]) => x > W) || pts.every(([, y]) => y > H)) continue;
      g.fillStyle = shade(w);
      g.beginPath();
      pts.forEach((p, i) => g[i ? "lineTo" : "moveTo"](...p));
      g.closePath(); g.fill(); g.stroke();
      drew = true;
    }
    if (o.observerFt > top) {
      const roof = clipPolygon(b.ring.map(([x, y]) => camXY(x, y, top)));
      if (roof.length >= 3) {
        g.fillStyle = day ? "rgb(170,176,186)" : "rgb(44,52,66)";
        g.beginPath();
        roof.map(proj).forEach((p, i) => g[i ? "lineTo" : "moveTo"](...p));
        g.closePath(); g.fill(); g.stroke();
        drew = true;
      }
    }
    return drew;
  }

  drawAircraft({ d, c, p, dist }, o, { cam, proj, f }) {
    const g = this.g, st = d.st;
    const size = Math.max(16, Math.min(150, ((LENGTH_M[d.info.size] || 20) * f) / dist));
    // which way it moves on screen: project a point a few hundred metres ahead
    const [lon2, lat2] = destination(st.lat, st.lon, st.heading || 0, 300);
    const c2 = cam(lat2, lon2, st.alt + (st.vrate || 0) * (300 / Math.max(30, (st.gs || 140) * MS_PER_KT)) / 60);
    let ang = 0, along = 1;
    if (c2[2] > NEAR) {
      const p2 = proj(c2), dx = p2[0] - p[0], dy = p2[1] - p[1];
      ang = Math.atan2(dy, dx);
      // foreshortening: how much of its length we see (1 = side on, ~0 = nose or tail on)
      along = Math.max(0.18, Math.min(1, Math.hypot(dx, dy) / ((300 * f) / dist)));
    }
    const mirror = Math.abs(ang) > Math.PI / 2;
    const move = o.moves?.get(d.hex);
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(mirror ? ang + Math.PI : ang);
    g.scale((mirror ? -1 : 1) * size * along, size);
    g.globalAlpha = d.alpha;
    g.fillStyle = d.selected ? "#ffffff" : `rgb(${d.color.join(",")})`;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 1.2 / size;
    profile(g, d.info.size);
    g.fill(); g.stroke();
    g.restore();
    if (move) {
      g.strokeStyle = MOVE_COLORS[move.kind];
      g.lineWidth = 2;
      g.beginPath(); g.arc(p[0], p[1], size * 0.55 + 6, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1;
    }
    if (d.selected) {
      g.strokeStyle = "#fff"; g.lineWidth = 2;
      g.beginPath(); g.arc(p[0], p[1], size * 0.55 + 10, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1;
    }
    this.hits.push({ x: p[0], y: p[1], hex: d.hex });
  }

  /** Cards with what each aircraft is doing; nearest / soonest first, never overlapping. */
  drawCards(placed, o, W, H, ink, day, taken = []) {
    const g = this.g, boxes = [...taken], bottom = H - (o.bottomInset || 0);
    const rank = (it) => (it.d.selected ? -1e9 : o.moves?.has(it.d.hex) ? -1e6 + (o.moves.get(it.d.hex).eta ?? 500) : it.dist);
    let full = 0;
    for (const it of [...placed].sort((a, b) => rank(a) - rank(b))) {
      const { d, p, dist } = it, i = d.info, st = d.st, move = o.moves?.get(d.hex);
      const lines = [`${i.flight || i.reg || d.hex.toUpperCase()}${i.type ? ` · ${i.type}` : ""}`];
      const above = st.ground ? "on the ground" : `${fmt(Math.max(0, st.alt - o.observerFt))} ft up`;
      lines.push(`${d.route ? `${code(d.route.origin)} → ${code(d.route.dest)} · ` : ""}${above} · ${(dist / M_PER_NM).toFixed(1)} nm`);
      if (move) lines.push(moveText(move));
      const compact = full >= 9 && !d.selected && !move;
      const text = compact ? [lines[0]] : lines;
      let w = 0;
      text.forEach((t, k) => {
        g.font = k ? "11px Inter, system-ui, sans-serif" : "600 12px Inter, system-ui, sans-serif";
        w = Math.max(w, g.measureText(t).width + 16);
      });
      const h = 8 + text.length * 15;
      const tries = [[16, -h - 16], [-w - 16, -h - 16], [16, 16], [-w - 16, 16], [16, -h - 50], [-w - 16, -h - 50]];
      let box = null;
      for (const [ox, oy] of tries) {
        const b = [p[0] + ox, p[1] + oy, p[0] + ox + w, p[1] + oy + h];
        if (b[0] < 4 || b[1] < 28 || b[2] > W - 4 || b[3] > bottom - 4) continue;
        if (boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
        box = b;
        break;
      }
      if (!box) continue;
      boxes.push(box);
      if (!compact) full++;
      const edge = move ? MOVE_COLORS[move.kind] : d.selected ? "#ffffff" : `rgba(${ink},0.35)`;
      g.strokeStyle = edge;
      g.beginPath();
      g.moveTo(p[0], p[1]);
      g.lineTo(box[0] < p[0] ? box[2] : box[0], box[1] < p[1] ? box[3] : box[1]);
      g.stroke();
      g.fillStyle = day ? "rgba(255,255,255,0.88)" : "rgba(10,16,28,0.82)";
      g.strokeStyle = edge;
      roundRect(g, box[0], box[1], w, h, 6);
      g.fill(); g.stroke();
      text.forEach((t, k) => {
        g.font = k ? "11px Inter, system-ui, sans-serif" : "600 12px Inter, system-ui, sans-serif";
        const moveInk = move && (day ? (move.kind === "arr" ? "#0b6b3a" : "#0a5a8a") : MOVE_COLORS[move.kind]);
        g.fillStyle = k === 2 && move ? moveInk : day ? (k ? "#334" : "#0b1830") : k ? "#b8c6dc" : "#eef4ff";
        g.textAlign = "left";
        g.fillText(t, box[0] + 8, box[1] + 17 + k * 15);
      });
      this.hits.push({ x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, hex: d.hex });
    }
  }

  /** Arrows at the screen edges for nearby traffic out of view, with when it will come into view. */
  drawEdgeArrows(offscreen, o, W, H, { cam, proj, day }) {
    const g = this.g, sides = { left: [], right: [] }, boxes = [];
    for (const it of offscreen) {
      const st = it.d.st;
      const rel = angleDiff(o.yaw, bearing(o.home.lat, o.home.lon, st.lat, st.lon));
      let enters = null;
      if (!st.ground && st.gs > 30) {
        for (let t = 5; t <= 180; t += 5) {
          const [lon, lat] = destination(st.lat, st.lon, st.heading || 0, st.gs * MS_PER_KT * t);
          const c = cam(lat, lon, Math.max(0, st.alt + ((st.vrate || 0) * t) / 60));
          if (c[2] > NEAR) {
            const [x, y] = proj(c);
            if (x > 0 && x < W && y > 0 && y < H) { enters = t; break; }
          }
        }
      }
      const move = o.moves?.get(it.d.hex);
      sides[rel < 0 ? "left" : "right"].push({ ...it, enters, move, sortKey: enters ?? 1000 + it.dist / 100 });
    }
    for (const [side, list] of Object.entries(sides)) {
      list.sort((a, b) => a.sortKey - b.sortKey);
      list.slice(0, W < 500 ? 3 : 4).forEach((it, k) => {
        const y = H * 0.3 + k * 46, left = side === "left", x = left ? 10 : W - 10;
        const i = it.d.info;
        g.fillStyle = it.move ? MOVE_COLORS[it.move.kind] : `rgb(${it.d.color.join(",")})`;
        g.beginPath();
        if (left) { g.moveTo(x, y); g.lineTo(x + 14, y - 9); g.lineTo(x + 14, y + 9); }
        else { g.moveTo(x, y); g.lineTo(x - 14, y - 9); g.lineTo(x - 14, y + 9); }
        g.fill();
        g.textAlign = left ? "left" : "right";
        const tx = left ? x + 20 : x - 20;
        g.font = "600 11px Inter, system-ui, sans-serif";
        label(g, i.flight || i.reg || it.d.hex.toUpperCase(), tx, y - 2, day ? "#0b1830" : "#eef4ff", day ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.6)");
        g.font = "10px Inter, system-ui, sans-serif";
        const sub = it.move ? moveText(it.move) : it.enters != null ? `in view ${clock(it.enters)}` : `${(it.dist / M_PER_NM).toFixed(1)} nm`;
        label(g, sub, tx, y + 11, day ? "#334" : "#c8d4e8", day ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.6)");
        this.hits.push({ x: left ? x + 40 : x - 40, y, hex: it.d.hex });
        boxes.push(left ? [0, y - 16, 150, y + 18] : [W - 150, y - 16, W, y + 18]);
      });
    }
    return boxes; // cards keep clear of these
  }
}

function moveText(m) {
  if (m.kind === "arr") return m.state === "landing" ? `Landing ${m.ident} now` : `Lands ${m.ident} in ${clock(m.eta)}`;
  return m.state === "rolling" ? `Taking off ${m.ident}` : m.state === "lined up" ? `Lined up ${m.ident}` : `Holding ${m.ident}`;
}

function clock(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const fmt = (n) => (Math.round(n / 100) * 100).toLocaleString();
const code = (a) => a?.iata || a?.icao || "?";

function label(g, text, x, y, fill, halo) {
  g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = halo;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
  g.lineWidth = 1;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Side-on silhouette in unit length, nose toward +x, tail fin up (−y). */
function profile(g, size) {
  g.beginPath();
  if (size === "rotor") {
    g.ellipse(0.05, 0, 0.28, 0.16, 0, 0, Math.PI * 2);
    g.rect(-0.55, -0.04, 0.42, 0.06);
    g.rect(-0.5, -0.3, 1.05, 0.03); // rotor blur
    return;
  }
  const fat = size === "heavy" ? 0.085 : size === "light" ? 0.07 : 0.065;
  g.moveTo(0.5, 0.01);
  g.quadraticCurveTo(0.48, -fat, 0.36, -fat);
  g.lineTo(-0.3, -fat);
  g.lineTo(-0.44, -0.3);   // fin leading edge
  g.lineTo(-0.5, -0.3);
  g.lineTo(-0.5, -fat * 0.4);
  g.lineTo(-0.5, fat * 0.3);
  g.lineTo(-0.3, fat);
  g.lineTo(0.36, fat);
  g.quadraticCurveTo(0.48, fat, 0.5, 0.01);
  g.closePath();
  // wing root and engine, seen edge-on
  g.moveTo(0.12, fat * 0.6); g.lineTo(-0.14, fat * 0.6); g.lineTo(-0.2, fat * 1.4); g.lineTo(0.06, fat * 1.4); g.closePath();
  if (size !== "light") { g.moveTo(0.14, fat * 1.3); g.ellipse(0.05, fat * 1.9, 0.07, fat * 0.55, 0, 0, Math.PI * 2); }
}

/** Clip a camera-space segment to z > NEAR. */
function clipSegment(a, b) {
  if (a[2] < NEAR && b[2] < NEAR) return null;
  if (a[2] >= NEAR && b[2] >= NEAR) return [a, b];
  const t = (NEAR - a[2]) / (b[2] - a[2]);
  const m = a.map((v, i) => v + (b[i] - v) * t);
  return a[2] < NEAR ? [m, b] : [a, m];
}

/** Sutherland–Hodgman against the near plane. */
function clipPolygon(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
