// 2D / 3D map: MapLibre basemap with deck.gl layers drawn on top.
/* global maplibregl, deck */
import { circle, destination, pathToAirport, fromLocal, toLocal, lerpAngle, M_PER_NM, M_PER_FT, MS_PER_KT } from "./geo.js";
import { sunLook } from "./sun.js";
import { jetMesh, lightMesh, heliMesh } from "./meshes.js";
import { trailSpan } from "./store.js";

const MESHES = { jet: jetMesh(), light: lightMesh(), rotor: heliMesh() };
const MESH_FOR = { light: "light", rotor: "rotor" };
const MESH_SCALE = { heavy: 1.35, large: 1, small: 0.8, fast: 0.75, light: 0.7, rotor: 0.75, other: 0.7 };
const ICON_FOR = { heavy: "heavy", large: "jet", small: "jet", fast: "fast", light: "light", rotor: "rotor", other: "other" };
const HEAT_COLORS = [[40, 30, 110], [40, 80, 190], [30, 160, 225], [70, 215, 170], [235, 220, 80], [255, 250, 235]];
const D2R = Math.PI / 180;
const GUIDE_COLORS = { arr: [80, 230, 150], dep: [92, 200, 255] }; // arrivals / departures
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
    this.map.on("rotate", () => {
      if (!this.sweeping) onBearing(((this.map.getBearing() % 360) + 360) % 360);
    });
    this.map.on("click", (e) => {
      // deck handles picks first; this fires for clicks on empty map too. While chasing,
      // drags orbit the camera and end in a click, so empty-map clicks are ignored.
      if (!this._picked && !this.chase) this.onMapClick?.(e.lngLat);
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
    this.map.on("style.load", () => {
      this.applySky(true);
      this.syncBuildings();
    });
    this.buildings = { on: true, ex: 3 };
    this.wireContextMenu(onContextMenu);
    this.wireChaseControls();
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

  // ---------------------------------------------------------------- 3D buildings
  // OpenFreeMap's OpenMapTiles source carries OSM building footprints with heights
  // (render_height) from zoom 13. In 3D they're extruded, using the same altitude
  // exaggeration as the aircraft so a plane over the terminal stays above it.

  setBuildings(on, exaggeration) {
    this.buildings = { on, ex: exaggeration };
    this.syncBuildings();
  }

  syncBuildings() {
    const m = this.map, id = "overhead-buildings";
    if (!m.isStyleLoaded() && !m.getSource("openmaptiles")) return;
    const show = this.buildings.on && this.mode === "3d";
    if (!m.getLayer(id)) {
      if (!show || !m.getSource("openmaptiles")) return;
      const firstLabel = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
      m.addLayer({
        id, type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: { "fill-extrusion-opacity": 0.9 },
      }, firstLabel);
    }
    const ex = this.buildings.ex;
    m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    m.setPaintProperty(id, "fill-extrusion-color", this.light ? "#c3c9d2" : "#2c3648");
    m.setPaintProperty(id, "fill-extrusion-height", ["*", ["coalesce", ["get", "render_height"], 6], ex]);
    m.setPaintProperty(id, "fill-extrusion-base", ["*", ["coalesce", ["get", "render_min_height"], 0], ex]);
  }

  /**
   * Building footprints within radiusM of a point, for the spotter view. Heights only
   * come with zoom-14 tiles, and a screen of those covers ~4 km, so the (hidden) map is
   * stepped over a grid around the point, features read at each stop, and the camera
   * put back. Returns [{ring: [[x, y] metres east/north], h, base, cx, cy, area}].
   */
  async collectBuildings(lat, lon, radiusM, toLocal, fromLocal) {
    const m = this.map;
    if (!m.getSource("openmaptiles")) {
      // still loading (or switching) the basemap style
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 15000);
        m.once("style.load", () => { clearTimeout(t); resolve(); });
      });
      if (!m.getSource("openmaptiles")) return null;
    }
    const saved ={ center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    const step = 3500, n = Math.ceil(radiusM / step);
    const feats = [];
    let last = null;
    this.sweeping = true; // these camera moves are ours: don't report them as the user turning
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if (Math.hypot(i, j) * step > radiusM + step) continue;
        last = fromLocal(lat, lon, i * step, j * step);
        m.jumpTo({ center: last, zoom: 14, pitch: 0, bearing: saved.bearing });
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); resolve(); };
          const t = setTimeout(done, 6000);
          m.once("idle", done);
        });
        feats.push(...m.querySourceFeatures("openmaptiles", { sourceLayer: "building" }));
      }
    }
    // put the camera back, unless something else has moved it meanwhile
    const c = m.getCenter();
    if (last && Math.abs(c.lng - last[0]) < 1e-6 && Math.abs(c.lat - last[1]) < 1e-6) m.jumpTo(saved);
    this.sweeping = false;
    const out = [], seen = new Set();
    for (const f of feats) {
      if (f.properties.hide_3d) continue;
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
      for (const poly of polys) {
        const outer = poly[0];
        if (!outer || outer.length < 4) continue;
        const key = outer.slice(0, 3).map((c) => c.map((v) => v.toFixed(6)).join()).join("|");
        if (seen.has(key)) continue; // same footprint served by two tiles
        seen.add(key);
        const ring = outer.slice(0, -1).map(([x, y]) => toLocal(lat, lon, y, x));
        let cx = 0, cy = 0, area = 0;
        for (let i = 0; i < ring.length; i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
          area += x1 * y2 - x2 * y1;
          cx += x1; cy += y1;
        }
        cx /= ring.length; cy /= ring.length;
        if (Math.hypot(cx, cy) > radiusM) continue;
        // keep what you'd notice from a spotting spot: big footprints (terminals, hangars)
        // and anything tall (towers); houses and sheds would only cost frame time
        const h = f.properties.render_height ?? 6;
        if (Math.abs(area / 2) < 1500 && h < 15) continue;
        out.push({ ring, h: f.properties.render_height ?? 6, base: f.properties.render_min_height ?? 0, cx, cy, area: area / 2 });
      }
    }
    return out;
  }

  setStyle(key) {
    if (key === this.styleKey) return;
    if (this.styleKey || key !== "dark") this.map.setStyle(STYLES[key] || STYLES.dark);
    this.styleKey = key;
    this.light = key === "light" || key === "liberty";
  }

  /** Sun-driven lighting for 3D meshes and the sky/fog seen when the map is tilted. */
  setSun(sun, enabled) {
    const key = `${enabled}|${Math.round(sun.el * 2)}|${Math.round(sun.az)}|${this.light}`;
    if (key === this._sunKey) return;
    this._sunKey = key;
    this.sun = enabled ? sun : null;
    this.look = enabled ? sunLook(sun.el, !this.light) : null;
    const l = this.look;
    // light travels from the sun toward the ground (x east, y north, z up)
    const az = sun.az * D2R, el = sun.el * D2R;
    const direction = [-Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), -Math.sin(el)];
    this.overlay.setProps({
      effects: l ? [new deck.LightingEffect({
        ambient: new deck.AmbientLight({ color: l.ambientColor, intensity: l.ambient }),
        sun: new deck.DirectionalLight({ direction, color: l.sunColor, intensity: l.sun }),
      })] : [],
    });
    this.applySky();
  }

  applySky(styleJustLoaded = false) {
    if (!this.map.setSky || (!styleJustLoaded && !this.map.isStyleLoaded())) return;
    const l = this.look;
    try {
      this.map.setSky(l ? {
        "sky-color": l.sky, "horizon-color": l.horizon, "fog-color": l.fog,
        "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.85, "atmosphere-blend": 0,
      } : undefined);
    } catch (e) {
      console.warn("sky not supported:", e);
    }
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
    if (this.chase) this.setChaseInput();
    this.syncBuildings();
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

  // ---------------------------------------------------------------- chase camera
  // 2D: centred over the aircraft, track-up. 3D: behind and a little above it,
  // looking along its track. The camera is driven every frame, so the map's own
  // pan/rotate gestures are swapped for chase gestures while it runs.

  startChase(st) {
    this.chase = {
      bearing: st.heading ?? this.map.getBearing(),
      rel: 0,        // orbit offset from straight behind, degrees
      alpha: 12,     // look-down angle below horizontal (3D), degrees
      dist: 260,     // camera to aircraft, drawn metres (3D)
    };
    if (this.mode === "2d" && this.map.getZoom() < 10.5) this.map.jumpTo({ zoom: 11.5 });
    this.setChaseInput();
  }

  stopChase() {
    if (!this.chase) return;
    this.chase = null;
    this.setChaseInput();
  }

  setChaseInput() {
    const m = this.map, on = !!this.chase;
    for (const h of [m.dragPan, m.dragRotate, m.keyboard, m.doubleClickZoom]) on ? h.disable() : h.enable();
    // 2D keeps wheel / pinch zoom; 3D uses its own wheel (camera distance)
    if (on && this.mode === "3d") { m.scrollZoom.disable(); m.touchZoomRotate.disable(); }
    else { m.scrollZoom.enable(); m.touchZoomRotate.enable(); }
    if (on) m.touchZoomRotate.disableRotation(); else m.touchZoomRotate.enableRotation();
  }

  wireChaseControls() {
    const cc = this.map.getCanvasContainer();
    let drag = null;
    cc.addEventListener("pointerdown", (e) => {
      if (!this.chase) return;
      drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.chase || !drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.chase.rel = (this.chase.rel - dx * 0.35 + 540) % 360 - 180; // orbit around the aircraft
      if (this.mode === "3d") this.chase.alpha = Math.max(5, Math.min(70, this.chase.alpha + dy * 0.15));
    });
    window.addEventListener("pointerup", () => (drag = null));
    cc.addEventListener("wheel", (e) => {
      if (!this.chase || this.mode !== "3d") return;
      e.preventDefault();
      this.chase.dist = Math.max(40, Math.min(30000, this.chase.dist * 1.15 ** Math.sign(e.deltaY)));
    }, { passive: false });
  }

  /** Move the camera for this frame. st: aircraft state; ex: drawn metres per foot of altitude. */
  chaseCamera(st, ex, dt) {
    const c = this.chase;
    // Smooth the heading so turns pan rather than snap.
    c.bearing = lerpAngle(c.bearing, st.heading ?? c.bearing, 1 - Math.exp(-dt / 0.6));
    const bearing = (c.bearing + c.rel + 360) % 360;
    if (this.mode !== "3d") {
      this.map.jumpTo({ center: [st.lon, st.lat], bearing, pitch: 0 });
      return;
    }
    // MapLibre's camera looks at a point on the ground. Put that point far enough
    // ahead that the line of sight passes through the aircraft, then pull back so
    // the camera sits `dist` behind it.
    const a = c.alpha * D2R, H = Math.max(0, st.alt) * ex, b = bearing * D2R;
    const ahead = H / Math.tan(a);
    const [lon, lat] = fromLocal(st.lat, st.lon, Math.sin(b) * ahead, Math.cos(b) * ahead);
    // deck.gl clips anything nearer than ~1/15 of the camera-to-centre distance, which
    // grows with altitude here, so high aircraft are chased from further back (the mesh
    // is scaled with the distance, so it keeps the same size on screen).
    const dist = Math.max(c.dist, (0.09 * H) / Math.sin(a) + 30);
    c.effDist = dist;
    const toCenter = dist + H / Math.sin(a);
    const vh = this.map.getCanvas().clientHeight;
    const mpp = toCenter / (1.5 * vh); // MapLibre's default 36.87° fov puts the camera 1.5 × height from centre
    const zoom = Math.log2((40075016.686 * Math.cos(lat * D2R)) / (512 * mpp));
    this.map.jumpTo({ center: [lon, lat], zoom, bearing, pitch: 90 - c.alpha });
    const back = dist * Math.cos(a);
    const [camLon, camLat] = fromLocal(st.lat, st.lon, -Math.sin(b) * back, -Math.cos(b) * back);
    c.cam = {
      lon: camLon, lat: camLat, h: H + dist * Math.sin(a), focal: 1.5 * vh, toCenter,
      dir: [Math.sin(b) * Math.cos(a), Math.cos(b) * Math.cos(a), -Math.sin(a)], // view direction (east, north, up)
      near: 0.08 * toCenter, // a little beyond deck.gl's near plane
    };
  }

  /** Runways (coloured when in use), approach / climb-out guides, airport and runway-end labels. */
  airportLayers(layers, ap, zoom, z, textColor, clip) {
    const base = this.light ? [70, 82, 100, 190] : [175, 188, 208, 170];
    layers.push(new deck.PathLayer({
      id: "runways", data: ap.runways, getPath: (r) => r.path, getWidth: (r) => r.widthM,
      widthUnits: "meters", widthMinPixels: 2.5, capRounded: false,
      getColor: (r) => (r.active ? [...GUIDE_COLORS[r.active], 235] : base),
      updateTriggers: { getColor: [ap.version, this.light] }, parameters: { depthTest: false },
    }));
    if (ap.guides.length) {
      layers.push(new deck.PathLayer({
        id: "runway-guides", data: ap.guides, getPath: (g) => clip(g.path.map(([lon, lat, alt]) => [lon, lat, z(alt)])),
        getColor: (g) => [...GUIDE_COLORS[g.kind], 200], getWidth: 2, widthUnits: "pixels",
        getDashArray: [8, 6], dashJustified: true, extensions: [this.dash], parameters: { depthTest: false },
      }));
    }
    const labels = ap.airports.filter((a) => a.size === "large" || (a.size === "medium" && zoom >= 7.5) || zoom >= 10);
    layers.push(new deck.TextLayer({
      id: "airport-labels", data: labels, getPosition: (a) => [a.lon, a.lat], getText: (a) => a.iata || a.ident,
      getSize: (a) => (a.size === "large" ? 13 : 11), fontWeight: 700, fontFamily: "JetBrains Mono, ui-monospace, monospace",
      getColor: (a) => (a.active ? [80, 230, 150, 240] : textColor), getPixelOffset: [0, 18],
      background: true, getBackgroundColor: this.light ? [255, 255, 255, 170] : [10, 16, 28, 150], backgroundPadding: [3, 1],
      updateTriggers: { getColor: [ap.version, this.light] }, parameters: { depthTest: false },
    }));
    if (zoom >= 11.5) {
      layers.push(new deck.TextLayer({
        id: "runway-ends", data: ap.ends, getPosition: (e) => [e.lon, e.lat], getText: (e) => e.ident,
        getSize: 10, fontWeight: 600, fontFamily: "JetBrains Mono, ui-monospace, monospace", getColor: textColor,
        background: true, getBackgroundColor: this.light ? [255, 255, 255, 190] : [10, 16, 28, 170], backgroundPadding: [2, 1],
        parameters: { depthTest: false },
      }));
    }
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
    // deck.gl pixel sizes are exact only at the map centre's depth; the 3D chase camera
    // looks at a point far beyond the aircraft, so rescale pixel sizes by each object's depth.
    const chaseCam = is3d ? this.chase?.cam : null;
    const camDist = (d) => {
      const [x, y] = toLocal(chaseCam.lat, chaseCam.lon, d.st.lat, d.st.lon);
      return Math.hypot(x, y, z(d.st.alt) - chaseCam.h);
    };
    const px = chaseCam ? (d) => Math.max(0.05, Math.min(4, camDist(d) / chaseCam.toCenter)) : () => 1;
    // Lines that pass behind the chase camera get mirrored into the sky; cut them at the near plane.
    const clip = chaseCam ? (path) => clipToFront(path, chaseCam) : (path) => path;
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

    const zoom = this.map.getZoom();
    const mpp = (40075016.686 * Math.cos(this.home.lat * D2R)) / (512 * 2 ** zoom);
    if (opts.heat?.length) {
      // radius follows the ~550 m grid cell so corridors stay continuous at any zoom
      layers.unshift(new deck.HeatmapLayer({
        id: "heat", data: opts.heat, getPosition: (b) => [b[0], b[1]], getWeight: (b) => Math.sqrt(b[2]),
        radiusPixels: Math.max(12, Math.min(70, (550 / mpp) * 1.7)), intensity: 1.3, threshold: 0.03,
        opacity: 0.7, colorRange: HEAT_COLORS, aggregation: "SUM",
      }));
    }
    if (opts.ap) this.airportLayers(layers, opts.ap, zoom, z, textColor, clip);

    // Trails. Faded ones use TripsLayer, which ramps alpha from the tail to the head;
    // selected and other aircraft can have different lengths, hence two layers.
    // Points are [lon, lat, z, t]; clipping keeps t so timestamps stay paired with vertices.
    const trails = items
      .filter((d) => d.trail && d.trail.length > 1)
      .map((d) => ({ ...d, path: clip(d.trail.map((p) => [p[0], p[1], z(p[2]), p[3]])) }))
      .filter((d) => d.path.length > 1);
    for (const sel of [false, true]) {
      const data = trails.filter((d) => d.selected === sel);
      if (!data.length) continue;
      const common = {
        id: `trails-${sel ? "selected" : "others"}`, data,
        getPath: (d) => d.path.map((p) => [p[0], p[1], p[2]]),
        getColor: (d) => [...d.color, Math.round((sel ? 230 : 140) * d.alpha)],
        // in chase the trail runs back toward the lens, so use metres and let perspective taper it
        ...(chaseCam
          ? { getWidth: (sel ? 3 : 1.5) * (this.chase.effDist / chaseCam.focal), widthUnits: "meters", widthMinPixels: 1 }
          : { getWidth: sel ? 3 : 1.5, widthUnits: "pixels" }),
        jointRounded: true, capRounded: true,
        billboard: true, updateTriggers: { getPath: [is3d, ex] }, parameters: { depthTest: is3d },
      };
      if (opts.trailFade) {
        layers.push(new deck.TripsLayer({
          ...common, fadeTrail: true, currentTime: 0,
          trailLength: trailSpan(data, sel ? opts.trailLenSel : opts.trailLen, opts.now),
          // relative to render time so float32 keeps sub-second precision
          getTimestamps: (d) => d.path.map((p) => p[3] - opts.now),
        }));
      } else {
        layers.push(new deck.PathLayer(common));
      }
    }

    // Dashed great-circle line from the aircraft to its (likely) destination,
    // descending to field elevation in 3D.
    const routed = opts.routeLines === "none" ? [] :
      items.filter((d) => d.route && (opts.routeLines === "all" || d.selected));
    if (routed.length) {
      layers.push(new deck.PathLayer({
        id: "routes", data: routed,
        getPath: (d) => clip(pathToAirport(d.st, d.route.dest).map(([lon, lat, alt]) => [lon, lat, z(alt)])),
        getColor: (d) => [...d.color, Math.round((d.selected ? 220 : 90) * d.alpha)],
        getWidth: (d) => (d.selected ? 2 : 1.2) * px(d), widthUnits: "pixels",
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
        // Screen-space lines this close to the chase camera render far too wide, and the
        // chased aircraft's own drop line says nothing from behind it, so leave it out.
        id: "stalks", data: chaseCam ? airborne.filter((d) => !d.selected) : airborne,
        getSourcePosition: (d) => [d.st.lon, d.st.lat, 0], getTargetPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
        getColor: (d) => [...d.color, Math.round((d.selected ? 160 : 55) * d.alpha)], getWidth: 1,
      }));
      let sizeScale = mpp * 34 * opts.iconScale;
      let scaleOf = (d) => MESH_SCALE[d.info.size] || 1;
      const cam = this.chase?.cam;
      if (cam) {
        // Chase: one real-world scale so perspective reads naturally (the chased
        // aircraft spans roughly a sixth of the screen), but never let others shrink below ~14 px.
        sizeScale = 0.18 * this.chase.effDist * opts.iconScale;
        const minPx = 14 * opts.iconScale;
        scaleOf = (d) => {
          const base = MESH_SCALE[d.info.size] || 1;
          if (d.selected) return base;
          const [x, y] = toLocal(cam.lat, cam.lon, d.st.lat, d.st.lon);
          const dist = Math.hypot(x, y, z(d.st.alt) - cam.h);
          return Math.max(base, (minPx * dist) / cam.focal / sizeScale);
        };
      }
      for (const kind of ["jet", "light", "rotor"]) {
        const data = items.filter((d) => (MESH_FOR[d.info.size] || "jet") === kind);
        layers.push(new deck.SimpleMeshLayer({
          id: `mesh-${kind}`, data, mesh: MESHES[kind], sizeScale, pickable: true,
          getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
          getColor: (d) => (d.selected && !cam ? [255, 255, 255, 255] : [...d.color, Math.round(255 * d.alpha)]),
          getOrientation: (d) => orientation(d.st),
          getScale: (d) => { const s = scaleOf(d); return [s, s, s]; },
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
      id: "selected", data: opts.chasing ? [] : sel, // no ring around the aircraft you're riding with getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)], billboard: true,
      getRadius: 22 * opts.iconScale, radiusUnits: "pixels", stroked: true, filled: false,
      getLineColor: [255, 255, 255, 220], getLineWidth: 2, lineWidthUnits: "pixels",
      parameters: { depthTest: false },
    }));

    if (opts.labels !== "none") {
      const lab = opts.labels === "all" ? this.declutter(items, z, opts.iconScale) : sel;
      layers.push(new deck.TextLayer({
        id: "labels", data: lab, getPosition: (d) => [d.st.lon, d.st.lat, z(d.st.alt)],
        getText: (d) => d.label, getSize: (d) => 11 * px(d), lineHeight: 1.15, fontFamily: "Inter, system-ui, sans-serif",
        getColor: (d) => (this.light ? [15, 25, 45, Math.round(240 * d.alpha)] : [235, 242, 255, Math.round(235 * d.alpha)]),
        getTextAnchor: "start", getAlignmentBaseline: "center", getPixelOffset: (d) => [16 * opts.iconScale * px(d), 0],
        background: true, getBackgroundColor: this.light ? [255, 255, 255, 170] : [10, 16, 28, 150],
        backgroundPadding: [3, 1], parameters: { depthTest: false }, characterSet: "auto",
      }));
    }
    this.overlay.setProps({ layers });
  }
}


/**
 * Keep the part of a path [lon, lat, zMetres, ...extra] in front of the camera's near
 * plane: the longest visible run, with crossing points interpolated.
 */
function clipToFront(path, cam) {
  const depth = (p) => {
    const [x, y] = toLocal(cam.lat, cam.lon, p[1], p[0]);
    return x * cam.dir[0] + y * cam.dir[1] + (p[2] - cam.h) * cam.dir[2] - cam.near;
  };
  const ds = path.map(depth);
  if (ds.every((d) => d > 0)) return path;
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let best = [], run = [];
  for (let i = 0; i < path.length; i++) {
    if (ds[i] > 0) {
      if (!run.length && i > 0) run.push(lerp(path[i - 1], path[i], ds[i - 1] / (ds[i - 1] - ds[i])));
      run.push(path[i]);
    } else if (run.length) {
      run.push(lerp(path[i - 1], path[i], ds[i - 1] / (ds[i - 1] - ds[i])));
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  if (run.length > best.length) best = run;
  return best.length > 1 ? best : [];
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
