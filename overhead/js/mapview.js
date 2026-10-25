// 2D / 3D map: MapLibre basemap with deck.gl layers drawn on top.
/* global maplibregl, deck */
import { circle, destination, pathToAirport, M_PER_NM, M_PER_FT, MS_PER_KT } from "./geo.js";
import { jetMesh, lightMesh, heliMesh } from "./meshes.js";

const MESHES = { jet: jetMesh(), light: lightMesh(), rotor: heliMesh() };
const MESH_FOR = { light: "light", rotor: "rotor" };
const MESH_SCALE = { heavy: 1.35, large: 1, small: 0.8, fast: 0.75, light: 0.7, rotor: 0.75, other: 0.7 };
const ICON_FOR = { heavy: "heavy", large: "jet", small: "jet", fast: "fast", light: "light", rotor: "rotor", other: "other" };
const ICON_PX = { heavy: 36, large: 30, small: 24, fast: 24, light: 22, rotor: 26, other: 18 };

export const STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  fiord: "https://tiles.openfreemap.org/styles/fiord",
  light: "https://tiles.openfreemap.org/styles/positron",
  liberty: "https://tiles.openfreemap.org/styles/liberty",
};

export class MapView {
  constructor(container, { onSelect, onBearing, onMapClick, onContextMenu, tooltip }) {
    this.mode = "2d";
    this.home = null;
    this.onSelect = onSelect;
    this.onMapClick = onMapClick;
    this.map = new maplibregl.Map({
      container,
      style: STYLES.dark,
      center: [-97, 38],
      zoom: 4,
      maxPitch: 0,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
    this.map.touchPitch.disable();
    this.map.on("rotate", () => onBearing(((this.map.getBearing() % 360) + 360) % 360));
    this.map.on("click", (e) => {
      // deck handles picks first; this fires for clicks on empty map too
      if (!this._picked) this.onMapClick?.(e.lngLat);
      this._picked = false;
    });
    this.overlay = new deck.MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: tooltip,
      onClick: (info) => {
        if (info.object?.hex) {
          this._picked = true;
          this.onSelect(info.object.hex);
        }
      },
      getCursor: ({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
    });
    this.map.addControl(this.overlay);
    this.wireContextMenu(onContextMenu);
    this.icons = buildIconAtlas();
    this.dash = new deck.PathStyleExtension({ dash: true });
  }

  // Right-drag rotates/tilts the map, so only a right *click* (little movement
  // between press and release) opens the menu. Touch long-press opens it too.
  wireContextMenu(cb) {
    const cc = this.map.getCanvasContainer();
    let down = null;
    const open = (e) => {
      const r = cc.getBoundingClientRect();
      cb?.({ lngLat: this.map.unproject([e.clientX - r.left, e.clientY - r.top]), clientX: e.clientX, clientY: e.clientY });
    };
    cc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.pointerType === "touch" || e.sourceCapabilities?.firesTouchEvents) open(e);
    });
    cc.addEventListener("mousedown", (e) => { if (e.button === 2) down = [e.clientX, e.clientY]; });
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 2 || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved < 5) open(e);
    });
  }

  setStyle(key) {
    if (key === this.styleKey) return;
    if (this.styleKey || key !== "dark") this.map.setStyle(STYLES[key] || STYLES.dark);
    this.styleKey = key;
    this.light = key === "light" || key === "liberty";
  }

  setHome(lat, lon, radiusNm, fly = true) {
    this.home = { lat, lon, radiusNm };
    const step = [2, 5, 10, 20, 25, 50, 100].find((s) => radiusNm / s <= 5) || 100;
    this.rings = [];
    for (let r = step; r <= radiusNm + 0.01; r += step) this.rings.push({ r, path: circle(lat, lon, r * M_PER_NM) });
    if (this.rings.at(-1)?.r !== radiusNm) this.rings.push({ r: radiusNm, path: circle(lat, lon, radiusNm * M_PER_NM) });
    this.ringLabels = this.rings.map(({ r }) => ({ pos: destination(lat, lon, 180, r * M_PER_NM), text: `${r} nm` }));
    this.cardinals = ["N", "E", "S", "W"].map((t, i) => ({
      pos: destination(lat, lon, i * 90, radiusNm * M_PER_NM * 1.07), text: t,
    }));
    if (fly) this.fit();
  }

  fit() {
    if (!this.home) return;
    const { lat, lon, radiusNm } = this.home;
    const [w, s] = destination(lat, lon, 225, radiusNm * M_PER_NM * 1.414);
    const [e, n] = destination(lat, lon, 45, radiusNm * M_PER_NM * 1.414);
    const cam = this.map.cameraForBounds([[w, s], [e, n]], { padding: 30, bearing: this.map.getBearing() });
    if (!cam) return;
    this.map.easeTo({
      center: [lon, lat], zoom: cam.zoom + (this.mode === "3d" ? 0.3 : 0.1),
      pitch: this.mode === "3d" ? 60 : 0, duration: 800,
    });
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "3d") {
      this.map.setMaxPitch(85);
      this.map.touchPitch.enable();
      this.map.easeTo({ pitch: 60, duration: 700 });
    } else {
      this.map.touchPitch.disable();
      this.map.easeTo({ pitch: 0, duration: 500 });
      setTimeout(() => this.mode === "2d" && this.map.setMaxPitch(0), 520);
    }
  }

  setBearing(deg, animate = false) {
    if (Math.abs(((deg - this.map.getBearing() + 540) % 360) - 180) < 0.05) return;
    if (animate) this.map.easeTo({ bearing: deg, duration: 400 });
    else this.map.setBearing(deg);
  }

  follow(lat, lon) {
    this.map.setCenter([lon, lat]);
  }

  /** Greedy screen-space placement: selected first, then nearest to home. */
  declutter(items, z, iconScale) {
    const m = this.map, c = m.getCenter(), cv = m.getCanvas();
    const vp = new deck.WebMercatorViewport({
      width: cv.clientWidth, height: cv.clientHeight, longitude: c.lng, latitude: c.lat,
      zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(),
    });
    const order = items.slice().sort((a, b) => (b.selected - a.selected) || a.distNm - b.distNm);
    const boxes = [], out = [];
    const keep = this._shownLabels || new Set(), next = new Set();
    for (const d of order) {
      const [x, y] = vp.project([d.st.lon, d.st.lat, z(d.st.alt)]);
      if (x < -50 || y < -20 || x > cv.clientWidth + 50 || y > cv.clientHeight + 20) continue;
      const w = 7 * Math.max(...d.label.split("\n").map((l) => l.length)) + 8;
      // previously shown labels get slightly smaller boxes, which damps flicker
      const pad = keep.has(d.hex) ? -2 : 2;
      const b = [x + 14 * iconScale - pad, y - 14 - pad, x + 14 * iconScale + w + pad, y + 14 + pad];
      if (!d.selected && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b, [x - 10 * iconScale, y - 10 * iconScale, x + 10 * iconScale, y + 10 * iconScale]);
      out.push(d);
      next.add(d.hex);
    }
    this._shownLabels = next;
    return out;
  }

  /**
   * items: [{hex, st:{lat,lon,alt,heading,...}, info, color:[r,g,b], alpha, trail:[[lon,lat,alt]], selected}]
   */
  render(items, opts) {
    if (!this.home) return;
    const is3d = this.mode === "3d";
    const ex = opts.exaggeration * M_PER_FT;
    const z = (altFt) => (is3d ? Math.max(0, altFt) * ex : 0);
    const ringColor = this.light ? [30, 60, 100, 110] : [140, 190, 255, 70];
    const textColor = this.light ? [20, 40, 70, 230] : [210, 225, 245, 230];
    const layers = [
      new deck.PathLayer({
        id: "rings", data: this.rings, getPath: (d) => d.path, getColor: ringColor,
        getWidth: 1, widthUnits: "pixels", parameters: { depthTest: false },
      }),
      new deck.TextLayer({
        id: "ring-labels", data: this.ringLabels, getPosition: (d) => d.pos, getText: (d) => d.text,
        getSize: 11, getColor: ringColor.slice(0, 3).concat(200), fontFamily: "Inter, system-ui, sans-serif",
        getTextAnchor: "middle", getAlignmentBaseline: "top", getPixelOffset: [0, 3],
        parameters: { depthTest: false },
      }),
      new deck.TextLayer({
        id: "cardinals", data: this.cardinals, getPosition: (d) => d.pos, getText: (d) => d.text,
        getSize: 15, fontWeight: 700, getColor: (d) => (d.text === "N" ? [255, 120, 90, 230] : textColor),
        fontFamily: "Inter, system-ui, sans-serif", parameters: { depthTest: false },
      }),
      new deck.ScatterplotLayer({
        id: "home", data: [this.home], getPosition: (d) => [d.lon, d.lat], getRadius: 6, radiusUnits: "pixels",
        getFillColor: [80, 200, 255, 255], getLineColor: [255, 255, 255, 255], stroked: true,
        lineWidthUnits: "pixels", getLineWidth: 2, parameters: { depthTest: false },
      }),
    ];

    const trails = items.filter((d) => d.trail && d.trail.length > 1);
    layers.push(new deck.PathLayer({
      id: "trails", data: trails,
      getPath: (d) => d.trail.map((p) => [p[0], p[1], z(p[2])]),
      getColor: (d) => [...d.color, Math.round((d.selected ? 230 : 120) * d.alpha)],
      getWidth: (d) => (d.selected ? 3 : 1.5), widthUnits: "pixels", jointRounded: true, capRounded: true,
      billboard: true, updateTriggers: { getPath: [is3d, ex] }, parameters: { depthTest: is3d },
    }));

    // Dashed great-circle line from the aircraft to its (likely) destination,
    // descending to field elevation in 3D.
    const routed = opts.routeLines === "none" ? [] :
      items.filter((d) => d.route && (opts.routeLines === "all" || d.selected));
    if (routed.length) {
      layers.push(new deck.PathLayer({
        id: "routes", data: routed,
        getPath: (d) => pathToAirport(d.st, d.route.dest).map(([lon, lat, alt]) => [lon, lat, z(alt)]),
        getColor: (d) => [...d.color, Math.round((d.selected ? 220 : 90) * d.alpha)],
        getWidth: (d) => (d.selected ? 2 : 1.2), widthUnits: "pixels",
        getDashArray: [6, 5], dashJustified: true, extensions: [this.dash],
        parameters: { depthTest: false },
      }));
      const dests = [...new Map(routed.map((d) => [d.route.dest.icao, d.route.dest])).values()];
      layers.push(new deck.ScatterplotLayer({
        id: "dest-airports", data: dests, getPosition: (a) => [a.lon, a.lat], getRadius: 5, radiusUnits: "pixels",
        stroked: true, filled: true, getFillColor: [10, 16, 28, 200], getLineColor: textColor, lineWidthUnits: "pixels",
        getLineWidth: 1.5, parameters: { depthTest: false },
      }));
      layers.push(new deck.TextLayer({
        id: "dest-labels", data: dests, getPosition: (a) => [a.lon, a.lat], getText: (a) => a.iata || a.icao,
        getSize: 12, fontWeight: 700, getColor: textColor, fontFamily: "JetBrains Mono, ui-monospace, monospace",
        getPixelOffset: [0, -13], background: true, getBackgroundColor: this.light ? [255, 255, 255, 190] : [10, 16, 28, 170],
        backgroundPadding: [3, 1], parameters: { depthTest: false },
      }));
    }

    if (is3d) {
      const airborne = items.filter((d) => !d.st.ground && d.st.alt > 0);
      layers.push(new deck.LineLayer({
        id: "stalks", data: airborne,
        getSourcePosition: (d) => [d.st.lon, d.st.lat, 0], getTargetPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
        getColor: (d) => [...d.color, Math.round((d.selected ? 160 : 55) * d.alpha)], getWidth: 1,
      }));
      layers.push(new deck.ScatterplotLayer({
        id: "shadows", data: airborne, getPosition: (d) => [d.st.lon, d.st.lat, 0],
        getRadius: 2.5, radiusUnits: "pixels", getFillColor: (d) => [...d.color, Math.round(110 * d.alpha)],
      }));
      const zoom = this.map.getZoom(), lat = this.home.lat;
      const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
      const sizeScale = mpp * 34 * opts.iconScale;
      for (const kind of ["jet", "light", "rotor"]) {
        const data = items.filter((d) => (MESH_FOR[d.info.size] || "jet") === kind);
        layers.push(new deck.SimpleMeshLayer({
          id: `mesh-${kind}`, data, mesh: MESHES[kind], sizeScale, pickable: true,
          getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
          getColor: (d) => (d.selected ? [255, 255, 255, 255] : [...d.color, Math.round(255 * d.alpha)]),
          getOrientation: (d) => orientation(d.st),
          getScale: (d) => { const s = MESH_SCALE[d.info.size] || 1; return [s, s, s]; },
          material: { ambient: 0.45, diffuse: 0.65, shininess: 24, specularColor: [80, 80, 80] },
          updateTriggers: { getPosition: [ex] },
        }));
      }
    } else {
      layers.push(new deck.IconLayer({
        id: "icons", data: items, iconAtlas: this.icons.atlas, iconMapping: this.icons.mapping,
        getIcon: (d) => ICON_FOR[d.info.size] || "jet", billboard: false, sizeUnits: "pixels",
        getSize: (d) => (ICON_PX[d.info.size] || 24) * opts.iconScale * (d.selected ? 1.2 : 1),
        getPosition: (d) => [d.st.lon, d.st.lat], getAngle: (d) => -d.st.heading,
        getColor: (d) => (d.selected ? [255, 255, 255, 255] : [...d.color, Math.round(255 * d.alpha)]),
        pickable: true, alphaCutoff: 0.05, parameters: { depthTest: false },
      }));
    }

    const sel = items.filter((d) => d.selected);
    layers.push(new deck.ScatterplotLayer({
      id: "selected", data: sel, getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)], billboard: true,
      getRadius: 22 * opts.iconScale, radiusUnits: "pixels", stroked: true, filled: false,
      getLineColor: [255, 255, 255, 220], getLineWidth: 2, lineWidthUnits: "pixels",
      parameters: { depthTest: false },
    }));

    if (opts.labels !== "none") {
      const lab = opts.labels === "all" ? this.declutter(items, z, opts.iconScale) : sel;
      layers.push(new deck.TextLayer({
        id: "labels", data: lab, getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
        getText: (d) => d.label, getSize: 11, lineHeight: 1.15, fontFamily: "Inter, system-ui, sans-serif",
        getColor: (d) => (this.light ? [15, 25, 45, Math.round(240 * d.alpha)] : [235, 242, 255, Math.round(235 * d.alpha)]),
        getTextAnchor: "start", getAlignmentBaseline: "center", getPixelOffset: [16 * opts.iconScale, 0],
        background: true, getBackgroundColor: this.light ? [255, 255, 255, 170] : [10, 16, 28, 150],
        backgroundPadding: [3, 1], parameters: { depthTest: false }, characterSet: "auto",
      }));
    }
    this.overlay.setProps({ layers });
  }
}

function orientation(st) {
  const v = Math.max(20, (st.gs || 0) * MS_PER_KT);
  const climb = st.ground ? 0 : Math.max(-12, Math.min(12, (Math.atan2((st.vrate || 0) * 0.00508, v) * 180) / Math.PI));
  const omega = ((st.turn || 0) * Math.PI) / 180;
  const bank = st.ground ? 0 : Math.max(-30, Math.min(30, (Math.atan((v * omega) / 9.81) * 180) / Math.PI));
  return [-climb, 90 - st.heading, bank];
}

// Top-down silhouettes, nose up, drawn white so deck can tint them.
function buildIconAtlas() {
  const C = 128, names = ["jet", "heavy", "light", "rotor", "fast", "other"];
  const cv = document.createElement("canvas");
  cv.width = C * names.length;
  cv.height = C;
  const g = cv.getContext("2d");
  const mapping = {};
  names.forEach((name, i) => {
    g.save();
    g.translate(i * C + C / 2, C / 2);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    const S = 100; // model length 1 -> px
    const poly = (pts, mirror = true) => {
      for (const sgn of mirror ? [1, -1] : [1]) {
        g.beginPath();
        pts.forEach(([x, y], k) => g[k ? "lineTo" : "moveTo"](sgn * y * S, -x * S));
        g.closePath();
        g.fill();
      }
    };
    const body = (prof, w = 1) => {
      const pts = prof.map(([x, r]) => [x, r * w]);
      poly([...pts, ...pts.slice().reverse().map(([x, r]) => [x, -r])], false);
    };
    if (name === "jet" || name === "heavy") {
      const w = name === "heavy" ? 1.35 : 1.15;
      body([[0.5, 0], [0.47, 0.025], [0.42, 0.045], [0.34, 0.055], [-0.22, 0.055], [-0.38, 0.04], [-0.5, 0.012]], w);
      poly([[0.12, 0.05], [-0.13, 0.5], [-0.21, 0.5], [-0.06, 0.05]]);
      poly([[-0.33, 0.03], [-0.44, 0.19], [-0.5, 0.19], [-0.46, 0.03]]);
      const eng = name === "heavy" ? [0.16, 0.3] : [0.17];
      for (const y of eng) poly([[0.14 - y * 0.25, y - 0.03], [0.14 - y * 0.25, y + 0.03], [0.02 - y * 0.25, y + 0.03], [0.02 - y * 0.25, y - 0.03]]);
    } else if (name === "light") {
      body([[0.5, 0.02], [0.46, 0.07], [0.3, 0.09], [0.05, 0.08], [-0.3, 0.035], [-0.5, 0.015]]);
      poly([[0.22, 0.06], [0.2, 0.62], [0.06, 0.62], [0.06, 0.06]]);
      poly([[-0.36, 0.02], [-0.38, 0.22], [-0.48, 0.22], [-0.5, 0.02]]);
    } else if (name === "fast") {
      body([[0.5, 0], [0.4, 0.04], [0.2, 0.06], [-0.45, 0.06], [-0.5, 0.05]]);
      poly([[0.25, 0.05], [-0.3, 0.42], [-0.38, 0.42], [-0.3, 0.05]]);
      poly([[-0.32, 0.05], [-0.48, 0.2], [-0.5, 0.2], [-0.5, 0.05]]);
    } else if (name === "rotor") {
      body([[0.32, 0.02], [0.28, 0.1], [0.12, 0.14], [-0.05, 0.12], [-0.15, 0.05], [-0.55, 0.025], [-0.6, 0.02]]);
      g.lineWidth = 7;
      g.beginPath(); g.arc(0, -0.05 * S, 0.47 * S, 0, Math.PI * 2); g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1;
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(-0.45 * S, -0.3 * S); g.lineTo(0.45 * S, 0.2 * S); g.moveTo(-0.45 * S, 0.2 * S); g.lineTo(0.45 * S, -0.3 * S); g.stroke();
    } else {
      poly([[0.45, 0], [-0.4, 0.3], [-0.2, 0], [-0.4, -0.3]], false);
    }
    g.restore();
    mapping[name] = { x: i * C, y: 0, width: C, height: C, mask: true };
  });
  return { atlas: cv.toDataURL(), mapping };
}
