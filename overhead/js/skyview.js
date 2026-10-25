// "Sky" view: what is above you. A polar plot with the zenith at the centre and
// the horizon at the rim, turned so the top of the screen is the direction you
// face. Not mirrored: something on your right when you face it is on the right.
import { haversine, bearing, elevationAngle, compassPoint, pathToAirport, M_PER_FT } from "./geo.js";

const D2R = Math.PI / 180;

export class SkyView {
  constructor(canvas, { onSelect }) {
    this.cv = canvas;
    this.g = canvas.getContext("2d");
    this.onSelect = onSelect;
    this.hits = [];
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 26;
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) this.onSelect(best.hex);
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.cv;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.dpr = dpr;
  }

  project(home, observerFt, lat, lon, altFt) {
    const d = haversine(home.lat, home.lon, lat, lon);
    const az = bearing(home.lat, home.lon, lat, lon);
    const el = elevationAngle(d, (altFt - observerFt) * M_PER_FT);
    return { dist: d, az, el };
  }

  render(items, { home, bearing: facing, observerFt, light, labels, routeLines }) {
    const { g, cv } = this;
    if (cv.width !== Math.round(cv.clientWidth * (window.devicePixelRatio || 1))) this.resize();
    const W = cv.width / this.dpr, H = cv.height / this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!home) return;
    const cx = W / 2, cy = H / 2 + 8, R = Math.max(60, Math.min(W, H) / 2 - 46);
    // Square-root elevation scale: most traffic sits within 10° of the horizon,
    // so give that band far more room than a linear scale would.
    const rad = (el) => (el >= 0 ? R * (1 - Math.sqrt(Math.min(90, el) / 90)) : R + Math.min(4, -el) * 4);
    const pt = (az, el) => {
      const r = rad(el), a = (az - facing) * D2R;
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    };

    const sky = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    if (light) { sky.addColorStop(0, "#bcd6f5"); sky.addColorStop(1, "#eef4fb"); }
    else { sky.addColorStop(0, "#07101f"); sky.addColorStop(0.8, "#0d1d36"); sky.addColorStop(1, "#1b2f4d"); }
    g.fillStyle = sky;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    const ink = light ? "20,40,70" : "170,200,240";
    g.lineWidth = 1;
    for (const el of [0, 2, 5, 10, 20, 35, 60]) {
      g.strokeStyle = `rgba(${ink},${el === 0 ? 0.6 : 0.18})`;
      g.beginPath(); g.arc(cx, cy, rad(el), 0, Math.PI * 2); g.stroke();
      if (el) {
        g.fillStyle = `rgba(${ink},0.55)`;
        g.font = "10px Inter, system-ui, sans-serif";
        g.textAlign = "left";
        const [x, y] = pt(facing + 180, el);
        g.fillText(`${el}°`, x + 3, y - 3);
      }
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let az = 0; az < 360; az += 10) {
      const major = az % 45 === 0;
      const [x1, y1] = pt(az, 0), [x2, y2] = pt(az, major ? -2.5 : -1.2);
      g.strokeStyle = `rgba(${ink},${major ? 0.8 : 0.35})`;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      if (major) {
        const [lx, ly] = pt(az, -4), r0 = Math.hypot(lx - cx, ly - cy), k = (r0 + 12) / r0;
        const lxx = cx + (lx - cx) * k, lyy = cy + (ly - cy) * k;
        g.fillStyle = az === 0 ? "#ff7a5a" : `rgba(${ink},0.95)`;
        g.font = `${az % 90 === 0 ? 700 : 500} ${az % 90 === 0 ? 15 : 12}px Inter, system-ui, sans-serif`;
        g.fillText(compassPoint(az), lxx, lyy);
      }
    }
    // facing marker
    g.fillStyle = light ? "#1c6fd1" : "#5cc8ff";
    g.beginPath(); g.moveTo(cx, cy - R - 2); g.lineTo(cx - 7, cy - R - 14); g.lineTo(cx + 7, cy - R - 14); g.fill();
    g.fillStyle = `rgba(${ink},0.35)`;
    g.font = "11px Inter, system-ui, sans-serif";
    g.fillText("zenith", cx, cy + 12);
    g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();

    this.hits = [];
    const placed = items.map((d) => {
      const p = this.project(home, observerFt, d.st.lat, d.st.lon, d.st.alt);
      return { d, ...p };
    }).filter((p) => p.el > -3).sort((a, b) => a.el - b.el);

    // Route to destination: where the aircraft is headed across your sky, down to the horizon.
    for (const { d } of placed) {
      if (!d.route || routeLines === "none" || (routeLines !== "all" && !d.selected)) continue;
      g.save();
      g.setLineDash([5, 5]);
      g.strokeStyle = `rgba(${d.color.join(",")},${(d.selected ? 0.85 : 0.35) * d.alpha})`;
      g.lineWidth = d.selected ? 1.6 : 1;
      g.beginPath();
      let last = null, started = false;
      for (const [lon, lat, alt] of pathToAirport(d.st, d.route.dest)) {
        const q = this.project(home, observerFt, lat, lon, alt);
        if (q.el < -2) break;
        last = pt(q.az, q.el);
        g[started ? "lineTo" : "moveTo"](...last);
        started = true;
      }
      g.stroke();
      g.restore();
      if (last && d.selected) {
        g.font = "700 11px JetBrains Mono, ui-monospace, monospace";
        g.fillStyle = light ? "#0b1830" : "#eaf2ff";
        g.textAlign = "center";
        g.fillText(`→ ${d.route.dest.iata || d.route.dest.icao}`, last[0], last[1] - 9);
      }
    }

    for (const { d } of placed) {
      if (!d.trail || d.trail.length < 2) continue;
      g.strokeStyle = `rgba(${d.color.join(",")},${(d.selected ? 0.8 : 0.3) * d.alpha})`;
      g.lineWidth = d.selected ? 2 : 1.2;
      g.beginPath();
      d.trail.forEach(([lon, lat, alt], i) => {
        const q = this.project(home, observerFt, lat, lon, alt);
        const [x, y] = pt(q.az, q.el);
        g[i ? "lineTo" : "moveTo"](x, y);
      });
      g.stroke();
    }

    // Greedy label placement: selected first, then highest in the sky.
    const labelled = new Set(), boxes = [];
    if (labels !== "none") {
      const order = placed.slice().sort((a, b) => (b.d.selected - a.d.selected) || b.el - a.el);
      for (const p of order) {
        if (labels === "selected" && !p.d.selected) continue;
        const [x, y] = pt(p.az, p.el);
        const w = 7 * Math.max(p.d.name.length, 14);
        const b = [x + 10, y - 13, x + 12 + w, y + 13];
        if (!p.d.selected && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
        boxes.push(b);
        labelled.add(p.d.hex);
      }
    }

    for (const { d, az, el } of placed) {
      const [x, y] = pt(az, el);
      const below = el < 0;
      const size = d.info.size === "heavy" ? 9 : d.info.size === "large" ? 8 : 6.5;
      g.save();
      g.translate(x, y);
      g.rotate((d.st.heading - facing) * D2R);
      g.globalAlpha = d.alpha * (below ? 0.4 : 1);
      g.fillStyle = d.selected ? "#fff" : `rgb(${d.color.join(",")})`;
      g.strokeStyle = light ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.6)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -size * 1.4); g.lineTo(size, size); g.lineTo(0, size * 0.45); g.lineTo(-size, size); g.closePath();
      g.fill(); g.stroke();
      g.restore();
      if (d.selected) {
        g.strokeStyle = "#fff"; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.stroke();
      }
      if (labelled.has(d.hex)) {
        g.globalAlpha = d.alpha * (below ? 0.5 : 1);
        g.font = "600 11px Inter, system-ui, sans-serif";
        g.textAlign = "left";
        g.fillStyle = light ? "#0b1830" : "#eaf2ff";
        g.fillText(d.name, x + 12, y - 6);
        g.font = "10px Inter, system-ui, sans-serif";
        g.fillStyle = light ? "rgba(11,24,48,.7)" : "rgba(220,232,255,.7)";
        g.fillText(`${Math.round(el)}° up · ${d.altText}`, x + 12, y + 7);
        g.globalAlpha = 1;
      }
      this.hits.push({ x, y, hex: d.hex });
    }
  }
}
