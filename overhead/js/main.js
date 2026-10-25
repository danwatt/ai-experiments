import { TrafficStore } from "./store.js";
import { RouteBook, assessRoute, shownRoute, routeText, apCode } from "./routes.js";
import { RunwayWatch } from "./runways.js";
import { sunPosition } from "./sun.js";
import { api, connect } from "./api.js";
import { MapView } from "./mapview.js";
import { SkyView } from "./skyview.js";
import { SIZE_CLASSES, OPERATOR_KINDS, airlineName, sizeLabel, operatorLabel } from "./classify.js";
import { haversine, bearing as brg, elevationAngle, compassPoint, lerpAngle, angleDiff, toLocal, M_PER_NM, M_PER_FT } from "./geo.js";

const $ = (id) => document.getElementById(id);

// Live data via server.py, or (no backend / ?demo) a recorded sample replayed in a loop.
let DEMO = null;
try {
  DEMO = await connect();
} catch (e) {
  console.error(e);
}
// demo settings are kept apart so trying the demo never moves your real home location
const LS_KEY = DEMO ? "overhead.demo.v1" : "overhead.v1";

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  home: null,            // {lat, lon}
  elevFt: 0,
  provider: "adsbfi",
  radius: 40,
  view: "2d",
  time: "smooth",
  delay: null,           // null = auto
  extrap: true,
  style: "auto",          // "auto" follows the sun: light by day, dark at night
  colorBy: "alt",
  labels: "all",
  trail: 120,            // seconds; 0 = off, -1 = everything kept
  trailSel: 300,         // selected aircraft; 0 = same as others
  trailFade: true,
  airports: true,
  runwayGuides: true,
  sunLight: true,
  heat: 0,               // heatmap window in hours; 0 = off, -1 = everything recorded
  heatBand: "all",
  routeLines: "selected",
  routeLabels: true,
  exaggeration: 3,
  iconScale: 1,
  bearing: 0,
  filters: null,
};
const FILTER_DEFAULTS = {
  search: "", altMin: 0, altMax: 45000, ground: false, sizes: [], kinds: [], vert: [], airlines: [],
  types: "", airport: "", speedMin: 0, distMax: 250, mil: false,
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return { ...DEFAULTS, ...raw, filters: { ...FILTER_DEFAULTS, ...(raw.filters || {}) } };
  } catch {
    return { ...DEFAULTS, filters: { ...FILTER_DEFAULTS } };
  }
}
const S = load();
if (DEMO) {
  S.home = { lat: DEMO.lat, lon: DEMO.lon };
  S.radius = DEMO.radius;
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* private mode */ }
  }, 300);
}
const F = S.filters;

// ---------------------------------------------------------------- colours
const ALT_STOPS = [[0, 20], [500, 32], [2000, 55], [5000, 95], [10000, 140], [20000, 190], [30000, 235], [40000, 285]];
function altHue(ft) {
  if (ft <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    const [a, ha] = ALT_STOPS[i - 1], [b, hb] = ALT_STOPS[i];
    if (ft <= b) return ha + ((ft - a) / (b - a)) * (hb - ha);
  }
  return ALT_STOPS.at(-1)[1];
}
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const SIZE_COLORS = { light: [120, 220, 140], small: [92, 200, 255], large: [255, 196, 90], heavy: [255, 110, 120], fast: [210, 140, 255], rotor: [80, 240, 220], other: [170, 180, 195] };
const KIND_COLORS = { airline: [92, 200, 255], cargo: [255, 170, 70], bizjet: [210, 140, 255], ga: [120, 220, 140], mil: [255, 100, 100], unknown: [160, 170, 185] };
function hashHue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h * 137.508) % 360;
}
function colorOf(info, st) {
  switch (S.colorBy) {
    case "size": return SIZE_COLORS[info.size];
    case "kind": return KIND_COLORS[info.kind];
    case "airline": return info.airline ? hsl(hashHue(info.airline), 75, 62) : [150, 160, 175];
    default: return st.ground ? [150, 150, 150] : hsl(altHue(st.alt), 85, 58);
  }
}

// ---------------------------------------------------------------- formatting
const fmtAlt = (st) => (st.ground ? "GND" : st.alt >= 18000 ? `FL${Math.round(st.alt / 100).toString().padStart(3, "0")}` : `${Math.round(st.alt / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const fmtNum = (n, d = 0) => (n == null || Number.isNaN(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const vArrow = (vr) => (vr > 300 ? "↑" : vr < -300 ? "↓" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- core objects
const store = new TrafficStore();
const routes = new RouteBook();
const runwayWatch = new RunwayWatch();
let apData = null;        // airports / runways / guides for the map
let runwayActivity = [];
let heatBins = null;
let sun = { az: 0, el: 90 };
let selected = null;
let following = false;
let chasing = false;
let chaseLost = 0;
let cardHidden = false; // while chasing, × hides the card instead of deselecting
let picking = false;
let lastItems = [];

const mapView = new MapView($("map"), {
  onSelect: select,
  onBearing: (b) => { if (!sensor.on) setBearing(b, { fromMap: true }); },
  onContextMenu: openContextMenu,
  onMapClick: (ll) => {
    if (picking) {
      setHome(ll.lat, ll.lng);
      endPicking();
    } else if (selected) select(null);
  },
  tooltip: ({ object }) => {
    if (!object?.hex || !object.info) return null;
    const i = object.info;
    return {
      html: `<b>${esc(i.flight || i.reg || i.hex.toUpperCase())}</b> ${esc(i.type || "")}<br>${fmtAlt(object.st)} ft · ${fmtNum(object.st.gs)} kt`,
      style: { background: "rgba(13,21,36,.92)", color: "#e6eefb", font: "12px Inter, system-ui", borderRadius: "8px", padding: "6px 8px", border: "1px solid rgba(150,180,230,.25)" },
    };
  },
});
const skyView = new SkyView($("sky"), { onSelect: select });

store.onUpdate = () => {
  updateStatus();
};

// ---------------------------------------------------------------- location
function setHome(lat, lon, fly = true) {
  S.home = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
  save();
  $("onboard").hidden = true;
  $("sLat").value = S.home.lat;
  $("sLon").value = S.home.lon;
  mapView.setHome(S.home.lat, S.home.lon, S.radius, fly);
  restartFeed();
  updateSun();
  loadAirports();
  loadHeat();
}
function restartFeed() {
  if (!S.home) return;
  store.configure({ provider: S.provider, lat: S.home.lat, lon: S.home.lon, radius: S.radius });
  for (const body of api.history(120)) store.ingest(body); // demo: start with trails already drawn
  updateDelayUi();
}
function useGeolocation() {
  if (!navigator.geolocation) return toast("Geolocation not available in this browser");
  toast("Locating…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (p.coords.altitude != null && !S.elevFt) { S.elevFt = Math.round(p.coords.altitude / M_PER_FT); $("sElev").value = S.elevFt; }
      setHome(p.coords.latitude, p.coords.longitude);
      toast("Location set");
    },
    (e) => toast(`Couldn't get location: ${e.message}`),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
  );
}
function startPicking() {
  picking = true;
  document.body.classList.add("picking");
  $("onboard").hidden = true;
  $("settings").close?.();
  toast("Click the map to set your location");
}
function endPicking() {
  picking = false;
  document.body.classList.remove("picking");
}

function recenter() {
  following = false;
  stopChase();
  mapView.fit();
}

// ---------------------------------------------------------------- chase
function startChase() {
  if (!selected) return toast("Select an aircraft to chase");
  if (S.view === "sky") setView("3d");
  const it = lastItems.find((d) => d.hex === selected);
  following = false;
  chasing = true;
  chaseLost = 0;
  cardHidden = true; // clear the view; the HUD's Info button brings it back
  mapView.startChase(it?.st || {});
  renderChaseHud();
  renderDetails();
}
function stopChase() {
  if (!chasing) return;
  chasing = false;
  cardHidden = false;
  mapView.stopChase();
  renderChaseHud();
  renderDetails();
}
function renderChaseHud() {
  const hud = $("chaseHud");
  const d = chasing && lastItems.find((x) => x.hex === selected);
  if (!d) { hud.hidden = true; return; }
  hud.hidden = false;
  const st = d.st, i = d.info;
  const hint = S.view === "3d" ? "drag to orbit · scroll for distance" : "drag to turn · scroll to zoom";
  hud.innerHTML = `<b>Chasing ${esc(i.flight || i.reg || d.hex.toUpperCase())}</b>
    <span class="mono">${fmtAlt(st)}${st.ground ? "" : " ft"} · ${fmtNum(st.gs)} kt · ${Math.round(st.heading) % 360}°</span>
    <span class="muted">${hint}</span>
    <button class="mini" id="chaseInfo" aria-pressed="${!cardHidden}">Info</button>
    <button class="mini" id="chaseStop">Stop · Esc</button>`;
  $("chaseStop").onclick = stopChase;
  $("chaseInfo").onclick = () => { cardHidden = !cardHidden; renderDetails(); renderChaseHud(); };
}

// ---------------------------------------------------------------- map context menu
function openContextMenu({ lngLat, clientX, clientY }) {
  const items = [
    ["Recenter on my location", "H", recenter],
    ["Center map here", "", () => { following = false; stopChase(); mapView.map.easeTo({ center: lngLat, duration: 500 }); }],
  ];
  if (S.home) {
    const b = brg(S.home.lat, S.home.lon, lngLat.lat, lngLat.lng);
    items.push([`Face this way (${Math.round(b)}° ${compassPoint(b)})`, "", () => { stopSensor(); setBearing(b, { animate: true }); }]);
  }
  if (!DEMO) items.push(["Set my location here", "", () => setHome(lngLat.lat, lngLat.lng)]);
  const m = $("ctxMenu");
  m.innerHTML = items.map(([label, key], i) =>
    `<button role="menuitem" data-i="${i}"><span>${esc(label)}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`).join("");
  m.onclick = (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    closeContextMenu();
    items[+b.dataset.i][2]();
  };
  m.hidden = false;
  const stage = $("stage").getBoundingClientRect();
  m.style.left = `${Math.max(6, Math.min(clientX - stage.left, stage.width - m.offsetWidth - 6))}px`;
  m.style.top = `${Math.max(6, Math.min(clientY - stage.top, stage.height - m.offsetHeight - 6))}px`;
  m.querySelector("button").focus({ preventScroll: true });
}
function closeContextMenu() {
  $("ctxMenu").hidden = true;
}
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctxMenu")) closeContextMenu(); }, true);
mapView.map.on("movestart", closeContextMenu);

// ---------------------------------------------------------------- bearing / compass
const sensor = { on: false, heading: null };
function setBearing(b, { fromMap = false, animate = false } = {}) {
  if (chasing && !fromMap) {
    // the chase camera owns the bearing; turning the dial orbits around the aircraft instead
    mapView.chase.rel = ((mapView.chase.rel + angleDiff(S.bearing, b) + 540) % 360) - 180;
    return;
  }
  S.bearing = ((b % 360) + 360) % 360;
  if (!fromMap) mapView.setBearing(S.bearing, animate);
  $("dialRot").setAttribute("transform", `rotate(${-S.bearing})`);
  $("dialText").textContent = `${Math.round(S.bearing) % 360}°`;
  $("dialSub").textContent = `facing ${compassPoint(S.bearing)}`;
  save();
}
function buildDial() {
  const g = $("dialRot");
  let html = "";
  for (let a = 0; a < 360; a += 15) {
    const major = a % 90 === 0;
    const r1 = 46, r2 = major ? 38 : 42;
    const s = Math.sin((a * Math.PI) / 180), c = -Math.cos((a * Math.PI) / 180);
    html += `<line class="dial-tick${major ? " major" : ""}" x1="${s * r1}" y1="${c * r1}" x2="${s * r2}" y2="${c * r2}"/>`;
    if (major) html += `<text class="dial-lbl${a === 0 ? " n" : ""}" x="${s * 31}" y="${c * 31 + 3}" text-anchor="middle" transform="rotate(${a} ${s * 31} ${c * 31})">${"NESW"[a / 90]}</text>`;
  }
  // sun marker rides with the dial; updateSun() places it
  html += `<g id="dialSun"><title>Sun</title><circle cy="-40" r="4.2" class="dial-sun"/></g>`;
  g.innerHTML = html;
}
function initDial() {
  const dial = $("dial");
  let drag = null;
  const ang = (e) => {
    const r = dial.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    drag = { a: ang(e), b: S.bearing };
    stopSensor();
  });
  dial.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // dragging the dial clockwise turns the world clockwise, i.e. bearing decreases
    setBearing(drag.b - angleDiff(drag.a, ang(e)));
  });
  dial.addEventListener("pointerup", () => (drag = null));
  dial.addEventListener("dblclick", () => setBearing(0, { animate: true }));
  dial.addEventListener("wheel", (e) => { e.preventDefault(); stopSensor(); setBearing(S.bearing + Math.sign(e.deltaY) * 5); }, { passive: false });
  $("rotL").onclick = () => { stopSensor(); setBearing(S.bearing - 15, { animate: true }); };
  $("rotR").onclick = () => { stopSensor(); setBearing(S.bearing + 15, { animate: true }); };
  $("rotN").onclick = () => { stopSensor(); setBearing(0, { animate: true }); };
  $("rotHome").onclick = recenter;
  const hasSensor = "DeviceOrientationEvent" in window && (matchMedia("(pointer: coarse)").matches || "ondeviceorientationabsolute" in window);
  $("rotSensor").hidden = !hasSensor;
  $("rotSensor").onclick = () => (sensor.on ? stopSensor() : startSensor());
}
async function startSensor() {
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") return toast("Compass permission denied");
    }
  } catch { return toast("Compass unavailable"); }
  sensor.on = true;
  $("rotSensor").setAttribute("aria-pressed", "true");
  window.addEventListener("deviceorientationabsolute", onOrient);
  window.addEventListener("deviceorientation", onOrient);
  toast("Following device compass — point the top of your screen");
}
function stopSensor() {
  if (!sensor.on) return;
  sensor.on = false;
  $("rotSensor").setAttribute("aria-pressed", "false");
  window.removeEventListener("deviceorientationabsolute", onOrient);
  window.removeEventListener("deviceorientation", onOrient);
}
function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + (screen.orientation?.angle || 0)) % 360;
  sensor.heading = sensor.heading == null ? h : lerpAngle(sensor.heading, h, 0.25);
}

// ---------------------------------------------------------------- filters UI
function chipGroup(el, options, key, colors) {
  el.innerHTML = "";
  for (const o of options) {
    const b = document.createElement("button");
    b.className = "chip";
    b.title = o.hint || "";
    b.innerHTML = `${colors ? `<i class="sw" style="background:rgb(${colors[o.id].join(",")})"></i>` : ""}${esc(o.label)}`;
    b.setAttribute("aria-pressed", F[key].includes(o.id));
    b.onclick = () => {
      const set = new Set(F[key]);
      set.has(o.id) ? set.delete(o.id) : set.add(o.id);
      F[key] = [...set];
      b.setAttribute("aria-pressed", set.has(o.id));
      filtersChanged();
    };
    el.appendChild(b);
  }
}
const VERT = [{ id: "climb", label: "Climbing" }, { id: "level", label: "Level" }, { id: "descend", label: "Descending" }];
function buildFilterUi() {
  chipGroup($("fSize"), SIZE_CLASSES, "sizes", SIZE_COLORS);
  chipGroup($("fKind"), OPERATOR_KINDS, "kinds", KIND_COLORS);
  chipGroup($("fVert"), VERT, "vert");
  $("fSearch").value = F.search;
  $("fType").value = F.types;
  $("fAirport").value = F.airport;
  $("fAltMin").value = F.altMin;
  $("fAltMax").value = F.altMax;
  $("fGround").checked = F.ground;
  $("fSpeed").value = F.speedMin;
  $("fDist").value = F.distMax;
  $("fMil").checked = F.mil;
  syncFilterLabels();
}
function syncFilterLabels() {
  const lo = Math.min(F.altMin, F.altMax), hi = Math.max(F.altMin, F.altMax);
  $("altVal").textContent = `${fmtNum(lo)} – ${hi >= 45000 ? "45,000+" : fmtNum(hi)} ft`;
  const dual = $("altRange");
  let fill = dual.querySelector(".fill");
  if (!fill) { fill = document.createElement("div"); fill.className = "fill"; dual.prepend(fill); }
  fill.style.left = `${(lo / 45000) * 100}%`;
  fill.style.width = `${((hi - lo) / 45000) * 100}%`;
  $("spdVal").textContent = F.speedMin ? `≥ ${F.speedMin} kt` : "any";
  $("fDist").max = S.radius;
  $("distVal").textContent = F.distMax >= S.radius ? "whole radius" : `${F.distMax} nm`;
  const n = activeFilterCount();
  $("filterBadge").hidden = !n;
  $("filterBadge").textContent = n;
}
function activeFilterCount() {
  let n = 0;
  if (F.search.trim()) n++;
  if (F.altMin > 0 || F.altMax < 45000) n++;
  if (F.ground) n++;
  for (const k of ["sizes", "kinds", "vert", "airlines"]) if (F[k].length) n++;
  if (F.types.trim()) n++;
  if (F.airport.trim()) n++;
  if (F.speedMin) n++;
  if (F.distMax < S.radius) n++;
  if (F.mil) n++;
  return n;
}
function filtersChanged() {
  syncFilterLabels();
  save();
}
function wireFilterInputs() {
  $("fSearch").oninput = (e) => { F.search = e.target.value; filtersChanged(); };
  $("fType").oninput = (e) => { F.types = e.target.value; filtersChanged(); };
  $("fAirport").oninput = (e) => { F.airport = e.target.value; filtersChanged(); };
  $("fAltMin").oninput = (e) => { F.altMin = +e.target.value; filtersChanged(); };
  $("fAltMax").oninput = (e) => { F.altMax = +e.target.value; filtersChanged(); };
  $("fGround").onchange = (e) => { F.ground = e.target.checked; filtersChanged(); };
  $("fSpeed").oninput = (e) => { F.speedMin = +e.target.value; filtersChanged(); };
  $("fDist").oninput = (e) => { F.distMax = +e.target.value; filtersChanged(); };
  $("fMil").onchange = (e) => { F.mil = e.target.checked; filtersChanged(); };
  $("fReset").onclick = () => {
    Object.assign(F, structuredClone(FILTER_DEFAULTS), { distMax: S.radius });
    buildFilterUi();
    renderAirlineChips(true);
    filtersChanged();
  };
}
let airlineSig = "";
function renderAirlineChips(force = false) {
  const counts = new Map();
  for (const tr of store.tracks.values()) {
    const code = tr.info?.airline;
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  for (const code of F.airlines) if (!counts.has(code)) counts.set(code, 0);
  const list = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sig = list.map(([c, n]) => c + n).join() + F.airlines.join();
  if (!force && sig === airlineSig) return;
  airlineSig = sig;
  const el = $("fAirline");
  el.innerHTML = "";
  if (!list.length) { el.innerHTML = `<span class="muted">No airline callsigns in range yet</span>`; return; }
  for (const [code, n] of list) {
    const b = document.createElement("button");
    b.className = "chip";
    b.title = code;
    b.setAttribute("aria-pressed", F.airlines.includes(code));
    b.innerHTML = `${esc(airlineName(code))} <span class="n">${n}</span>`;
    b.onclick = () => {
      const set = new Set(F.airlines);
      set.has(code) ? set.delete(code) : set.add(code);
      F.airlines = [...set];
      renderAirlineChips(true);
      filtersChanged();
    };
    el.appendChild(b);
  }
}

function passes(info, st, distNm, route) {
  if (F.mil && !info.mil && info.kind !== "mil") return false;
  if (st.ground) { if (!F.ground) return false; }
  else {
    const lo = Math.min(F.altMin, F.altMax), hi = Math.max(F.altMin, F.altMax);
    if (st.alt < lo || (hi < 45000 && st.alt > hi)) return false;
  }
  if (F.sizes.length && !F.sizes.includes(info.size)) return false;
  if (F.kinds.length && !F.kinds.includes(info.kind)) return false;
  if (F.airlines.length && !F.airlines.includes(info.airline)) return false;
  if (F.vert.length) {
    const vr = st.vrate || 0, v = vr > 300 ? "climb" : vr < -300 ? "descend" : "level";
    if (!F.vert.includes(v)) return false;
  }
  if (F.speedMin && (st.gs || 0) < F.speedMin) return false;
  if (F.distMax < S.radius && distNm > F.distMax) return false;
  if (F.types.trim()) {
    const toks = F.types.toUpperCase().split(/[,\s]+/).filter(Boolean);
    const t = (info.type || "").toUpperCase(), d = (info.desc || "").toUpperCase();
    if (!toks.some((k) => t.startsWith(k) || d.includes(k))) return false;
  }
  if (F.airport.trim()) {
    // "DFW" either end, ">DFW" arriving, "<DFW" departing
    if (!route) return false;
    const is = (ap, code) => ap.iata === code || ap.icao === code;
    const toks = F.airport.toUpperCase().split(/[,\s]+/).filter(Boolean);
    if (!toks.some((t) => (t[0] === ">" ? is(route.dest, t.slice(1)) : t[0] === "<" ? is(route.origin, t.slice(1))
      : is(route.dest, t) || is(route.origin, t)))) return false;
  }
  if (F.search.trim()) {
    const q = F.search.trim().toUpperCase();
    const hay = [info.flight, info.reg, info.hex, info.type, info.desc, info.owner, airlineName(info.airline), info.squawk].filter(Boolean).join(" ").toUpperCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- frame loop
function recommendedDelay() {
  return Math.round(Math.min(60, Math.max(4, store.interval * 2 + 2)));
}
function currentDelay() {
  return S.delay ?? recommendedDelay();
}
let lastFrame = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  try {
    drawFrame(nowMs);
  } catch (e) {
    console.error(e);
  }
}
function drawFrame(nowMs) {
  const dtSec = Math.min(0.5, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  if (sensor.on && sensor.heading != null) setBearing(sensor.heading);
  if (S.home && store.offsetReady) {
    const now = store.serverNow();
    const live = S.time === "live";
    const T = live ? now : now - currentDelay();
    const maxEx = live ? (S.extrap ? 20 : 0) : 6;
    const items = [];
    let total = 0;
    for (const tr of store.tracks.values()) {
      let st = store.stateAt(tr, T, maxEx);
      if (!st) continue;
      const lastT = tr.samples[tr.samples.length - 1].t;
      const staleness = T - lastT;
      const alpha = staleness < 20 ? 1 : staleness > 45 ? 0 : 1 - (staleness - 20) / 25;
      if (alpha <= 0) { tr.vis = null; continue; }
      if (live) st = smoothLive(tr, st, dtSec);
      else tr.vis = null;
      total++;
      const distNm = haversine(S.home.lat, S.home.lon, st.lat, st.lon) / M_PER_NM;
      const info = tr.info;
      const route = shownRoute(tr.route);
      if (!passes(info, st, distNm, route) && tr.hex !== selected) continue;
      const isSel = tr.hex === selected;
      const trailSec = trailSeconds(isSel && S.trailSel ? S.trailSel : S.trail);
      items.push({
        hex: tr.hex, info, st, distNm, alpha,
        color: colorOf(info, st),
        trail: trailSec > 0 ? store.trail(tr, T - trailSec, st) : null,
        selected: isSel,
        route,
        name: `${info.flight || info.reg || tr.hex.toUpperCase()}${route && S.routeLabels ? `  ${routeText(route)}` : ""}`,
        label: `${info.flight || info.reg || tr.hex.toUpperCase()}${route && S.routeLabels ? `  ${routeText(route)}` : ""}\n${fmtAlt(st)} ${vArrow(st.vrate)}`,
        altText: `${fmtAlt(st)} ft`,
      });
    }
    lastItems = items;
    lastTotal = total;
    const opts = {
      exaggeration: S.exaggeration, iconScale: S.iconScale, labels: S.labels, routeLines: S.routeLines,
      trailFade: S.trailFade, now: T, ...trailLengths(),
      ap: S.airports && apData ? { ...apData, guides: S.runwayGuides ? apData.guides : [] } : null,
      heat: S.heat ? heatBins : null,
    };
    if (S.view === "sky") {
      skyView.render(items, { home: S.home, bearing: S.bearing, observerFt: S.elevFt || 0, light: mapView.light, sun: S.sunLight ? sun : null, labels: S.labels, routeLines: S.routeLines, trailFade: S.trailFade, now: T, ...trailLengths() });
    } else {
      if (chasing) {
        const it = items.find((d) => d.selected);
        if (it) { chaseLost = 0; mapView.chaseCamera(it.st, S.exaggeration * M_PER_FT, dtSec); }
        else if ((chaseLost += dtSec) > 5) { stopChase(); toast("Lost the aircraft — chase ended"); }
      }
      mapView.render(items, { ...opts, chasing });
      if (following && !chasing && selected) {
        const it = items.find((d) => d.selected);
        if (it) mapView.follow(it.st.lat, it.st.lon);
      }
    }
  }
}
let lastTotal = 0;

const TRAIL_ALL = 3600; // "All": everything kept, capped at an hour of history
const TRAIL_STEPS = [0, 15, 30, 60, 120, 300, 600, 1800, -1];
function trailSeconds(v) {
  return v < 0 ? TRAIL_ALL : v;
}
// Fade lengths for the views; null means "all history" (fade over what is drawn).
function trailLengths() {
  const sel = S.trailSel || S.trail;
  return { trailLen: S.trail < 0 ? null : S.trail, trailLenSel: sel < 0 ? null : sel };
}
function trailLabel(v) {
  return v === 0 ? "off" : v < 0 ? "all history" : v < 60 ? `${v} s` : `${v / 60} min`;
}
// Keep enough position history for the longest trail (and the smooth-mode delay).
function syncHistory() {
  store.keepSeconds = Math.max(15 * 60, trailSeconds(S.trail), trailSeconds(S.trailSel), currentDelay() + 120);
}
function cycleTrail() {
  const i = TRAIL_STEPS.indexOf(S.trail);
  S.trail = TRAIL_STEPS[(i + 1) % TRAIL_STEPS.length];
  syncHistory();
  save();
  toast(`Trails: ${trailLabel(S.trail)}`);
}

// Live mode: positions jump when a fresh fix corrects the dead reckoning.
// Ease toward the target instead (≈0.3 s), snapping on large errors.
function smoothLive(tr, st, dt) {
  const v = tr.vis;
  if (!v) { tr.vis = { ...st }; return st; }
  const [dx, dy] = toLocal(v.lat, v.lon, st.lat, st.lon);
  if (Math.hypot(dx, dy) > 3000 || Math.abs(st.alt - v.alt) > 3000) { tr.vis = { ...st }; return st; }
  const k = 1 - Math.exp(-dt / 0.3);
  v.lat += (st.lat - v.lat) * k;
  v.lon += (st.lon - v.lon) * k;
  v.alt += (st.alt - v.alt) * k;
  v.heading = lerpAngle(v.heading, st.heading, k);
  return { ...st, lat: v.lat, lon: v.lon, alt: v.alt, heading: v.heading };
}

// ---------------------------------------------------------------- periodic UI (list, details, status)
function updateStatus() {
  const el = $("status");
  const m = store.meta;
  el.classList.remove("ok", "warn", "bad");
  if (!S.home) { $("statusText").textContent = "Set a location"; return; }
  if (store.error && !m) { el.classList.add("bad"); $("statusText").textContent = store.error; return; }
  const age = store.lastOk ? Math.round((Date.now() - store.lastOk) / 1000) : null;
  el.classList.add(store.error ? "warn" : age != null && age < store.interval * 3 + 3 ? "ok" : "warn");
  const shown = lastItems.length;
  const parts = [`${m?.providerName || S.provider}`, `${shown}${shown !== lastTotal ? ` of ${lastTotal}` : ""} aircraft`];
  if (age != null) parts.push(age < 2 ? "just now" : `${age}s ago`);
  if (store.error) parts.push(store.error);
  $("statusText").textContent = parts.join(" · ");
  $("shownCount").textContent = `${shown} of ${lastTotal} shown`;
  el.title = `${m?.providerName || ""} — ${m?.license || ""}. Poll every ${store.interval}s.`;
}
function renderList() {
  if ($("list").hidden) return;
  const rows = [...lastItems].sort((a, b) => a.distNm - b.distNm);
  $("listCount").textContent = `${rows.length}`;
  const html = rows.map((d) => {
    const i = d.info;
    return `<button class="row-ac${d.selected ? " sel" : ""}" data-hex="${d.hex}">
      <span class="cs"><i class="sw" style="background:rgb(${d.color.join(",")})"></i><span class="nm">${esc(i.flight || i.reg || d.hex.toUpperCase())}${d.route ? `<small class="rt">${esc(routeText(d.route))}</small>` : ""}</span></span>
      <span class="ty" title="${esc(i.desc || "")}">${esc(i.type || sizeLabel(i.size))}</span>
      <span class="r mono">${fmtAlt(d.st)}${vArrow(d.st.vrate)}</span>
      <span class="r mono">${d.distNm.toFixed(1)}</span></button>`;
  }).join("");
  const body = $("listBody");
  const top = body.scrollTop;
  body.innerHTML = html || `<p class="muted" style="padding:12px">No aircraft match.</p>`;
  body.scrollTop = top;
}
$("listBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hex]");
  if (b) select(b.dataset.hex, true);
});

function renderDetails() {
  const card = $("details");
  const d = lastItems.find((x) => x.selected);
  const tr = selected && store.tracks.get(selected);
  if (!selected || !tr || (chasing && cardHidden)) { card.hidden = true; return; }
  card.hidden = false;
  const i = tr.info, st = d?.st || store.stateAt(tr, store.serverNow(), 0);
  const distM = haversine(S.home.lat, S.home.lon, st.lat, st.lon);
  const az = brg(S.home.lat, S.home.lon, st.lat, st.lon);
  const el = elevationAngle(distM, (st.alt - (S.elevFt || 0)) * M_PER_FT);
  const rel = angleDiff(S.bearing, az);
  const relTxt = Math.abs(rel) < 8 ? "ahead" : Math.abs(rel) > 172 ? "behind you" : `${Math.round(Math.abs(rel))}° ${rel > 0 ? "right" : "left"}`;
  const age = store.serverNow() - tr.samples[tr.samples.length - 1].t;
  const title = i.flight || i.reg || i.hex.toUpperCase();
  const airline = i.airline ? airlineName(i.airline) : null;
  const cell = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const links = [
    `<a href="https://globe.adsb.lol/?icao=${i.hex}" target="_blank" rel="noopener">adsb.lol globe ↗</a>`,
    i.flight ? `<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(i.flight)}" target="_blank" rel="noopener">FlightAware ↗</a>` : "",
    `<a href="https://www.planespotters.net/hex/${i.hex.toUpperCase()}" target="_blank" rel="noopener">Photos ↗</a>`,
  ].join("");
  card.innerHTML = `
    <div class="top">
      <span class="cs">${esc(title)}</span>
      <span class="sub">${esc([airline, i.reg && i.reg !== title ? i.reg : null, i.type].filter(Boolean).join(" · "))}</span>
      ${i.emergency ? `<span class="emerg">${esc(i.emergency.toUpperCase())}</span>` : ""}
      <button class="x" id="dClose" aria-label="Close">×</button>
    </div>
    <div class="sub">${esc([i.desc, i.owner, i.year].filter(Boolean).join(" · ") || "No registry details from this provider")}
      <span class="pill">${esc(sizeLabel(i.size))}</span> <span class="pill">${esc(operatorLabel(i.kind))}</span>${i.mil ? ' <span class="pill">military</span>' : ""}</div>
    ${routeBlock(tr.route, tr.routeEntry)}
    <div class="grid">
      ${cell("Altitude", `${fmtAlt(st)}${st.ground ? "" : " ft"}`)}
      ${cell("Vert rate", `${st.vrate ? `${vArrow(st.vrate)}${fmtNum(Math.abs(st.vrate))}` : "0"} fpm`)}
      ${cell("Speed", `${fmtNum(st.gs)} kt`)}
      ${cell("Track", `${Math.round(st.heading) % 360}° ${compassPoint(st.heading)}`)}
      ${cell("Distance", `${(distM / M_PER_NM).toFixed(1)} nm`)}
      ${cell("Bearing", `${Math.round(az)}° ${compassPoint(az)}`)}
      ${cell("Look", `${relTxt}, ${Math.round(el)}° up`)}
      ${cell("Squawk", esc(i.squawk || "—"))}
      ${cell("Hex", i.hex.toUpperCase())}
      ${cell("Selected alt", i.navAlt ? fmtNum(i.navAlt) : "—")}
      ${cell("Source", esc(i.src === "mlat" ? "MLAT" : i.src?.startsWith("adsb") ? "ADS-B" : i.src || "—"))}
      ${cell("Last fix", `${Math.max(0, age).toFixed(0)}s ago`)}
    </div>
    <div class="actions">
      <button class="btn" id="dChase" aria-pressed="${chasing}" title="Ride along: above it in 2D, behind it in 3D (C)">${chasing ? "Stop chase" : "Chase"}</button>
      <button class="btn" id="dFollow" aria-pressed="${following}" ${chasing ? "disabled" : ""}>${following ? "Following" : "Follow"}</button>
      ${links}
    </div>`;
  $("dClose").onclick = () => {
    if (chasing) { cardHidden = true; renderDetails(); renderChaseHud(); } else select(null);
  };
  $("dFollow").onclick = () => { following = !following; renderDetails(); };
  $("dChase").onclick = () => (chasing ? stopChase() : startChase());
}

function routeBlock(r, entry) {
  if (!entry) return "";
  if (entry.status === "pending") return `<div class="route-note muted">Looking up route…</div>`;
  if (entry.status === "none") return `<div class="route-note muted">No route on file for this callsign.</div>`;
  if (entry.status === "error") return `<div class="route-note muted">Route lookup unavailable right now.</div>`;
  if (!r) return "";
  if (r.confidence === "unlikely") {
    return `<div class="route-note muted">Route databases list ${esc(r.alternatives.join(" or "))}, but that doesn't fit this
      aircraft's position and heading, so today's leg is unknown.</div>`;
  }
  const pct = Math.max(0, Math.min(100, (r.dA / (r.dA + r.dB)) * 100));
  const others = r.alternatives.filter((a) => !a.includes(routeText(r)));
  const place = (ap) => esc(ap.city || ap.name || ap.icao || "");
  return `<div class="route">
      <div class="ap"><b>${esc(apCode(r.origin))}</b><span title="${esc(r.origin.name || "")}">${place(r.origin)}</span></div>
      <div class="leg">
        <div class="bar"><i style="width:${pct}%"></i><em style="left:${pct}%"></em></div>
        <div class="dist">${fmtNum(r.dA / M_PER_NM)} nm from ${esc(apCode(r.origin))} · ${fmtNum(r.dB / M_PER_NM)} nm to ${esc(apCode(r.dest))}</div>
      </div>
      <div class="ap r"><b>${esc(apCode(r.dest))}</b><span title="${esc(r.dest.name || "")}">${place(r.dest)}</span></div>
    </div>
    <div class="route-note"><span class="pill conf-${r.confidence}">${r.confidence}</span>
      ${esc(r.why.join(", "))} · scheduled route from ${esc(r.sources.join(" + "))}${others.length ? ` · also listed: ${esc(others.join(", "))}` : ""}</div>`;
}

// Look up routes for airline-style callsigns and grade them against the aircraft's current state.
function updateRoutes() {
  const now = store.serverNow();
  for (const tr of store.tracks.values()) {
    const cs = tr.info?.airline ? tr.info.flight : null;
    if (!cs) { tr.route = tr.routeEntry = null; continue; }
    routes.want(cs);
    tr.routeEntry = routes.entry(cs);
    tr.route = assessRoute(tr.routeEntry, store.stateAt(tr, now, 20));
  }
  routes.pump();
}

function renderLegend() {
  const el = $("legend");
  if (S.colorBy === "alt") {
    const stops = [];
    for (let ft = 0; ft <= 40000; ft += 2000) stops.push(`rgb(${hsl(altHue(ft), 85, 58).join(",")}) ${(ft / 40000) * 100}%`);
    el.innerHTML = `Altitude (ft)<div class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></div>
      <div class="ticks"><span>0</span><span>10k</span><span>20k</span><span>30k</span><span>40k</span></div>`;
  } else if (S.colorBy === "size" || S.colorBy === "kind") {
    const [defs, cols] = S.colorBy === "size" ? [SIZE_CLASSES, SIZE_COLORS] : [OPERATOR_KINDS, KIND_COLORS];
    el.innerHTML = `${S.colorBy === "size" ? "Size" : "Operator"}<div class="items">${defs.map((d) => `<span><i style="background:rgb(${cols[d.id].join(",")})"></i>${esc(d.label)}</span>`).join("")}</div>`;
  } else {
    el.innerHTML = "Colored by airline";
  }
}

function select(hex, fly = false) {
  if (hex !== selected) following = false;
  if (!hex) stopChase(); // selecting another aircraft while chasing switches to it
  selected = hex;
  renderDetails();
  renderList();
  if (fly && hex && S.view !== "sky") {
    const d = lastItems.find((x) => x.hex === hex);
    if (d) mapView.map.easeTo({ center: [d.st.lon, d.st.lat], duration: 600 });
  }
}

// ---------------------------------------------------------------- airports, runways in use
async function loadAirports() {
  if (!S.airports || !S.home) return;
  await runwayWatch.load(S.home.lat, S.home.lon, S.radius);
  buildApData();
}
function buildApData() {
  const active = new Map(); // `${ap}|${ident}` -> "arr" | "dep"
  for (const a of runwayActivity) {
    for (const r of a.dep) active.set(`${a.ap.ident}|${r.ident}`, "dep");
    for (const r of a.arr) active.set(`${a.ap.ident}|${r.ident}`, "arr"); // landing wins the colour
  }
  const runways = [], ends = [];
  for (const ap of runwayWatch.airports) {
    for (const rw of ap.runways) {
      const kind = active.get(`${ap.ident}|${rw.le.ident}`) || active.get(`${ap.ident}|${rw.he.ident}`);
      runways.push({ path: [[rw.le.lon, rw.le.lat], [rw.he.lon, rw.he.lat]], widthM: (rw.widthFt || 100) * M_PER_FT, active: kind || null });
      ends.push({ lon: rw.le.lon, lat: rw.le.lat, ident: rw.le.ident }, { lon: rw.he.lon, lat: rw.he.lat, ident: rw.he.ident });
    }
  }
  const busy = new Set(runwayActivity.map((a) => a.ap.ident));
  apData = {
    airports: runwayWatch.airports.map((a) => ({ ...a, active: busy.has(a.ident) })),
    runways, ends, guides: runwayWatch.guides(runwayActivity),
    version: (apData?.version || 0) + 1,
  };
}
function updateRunways() {
  if (!S.airports || !runwayWatch.ends.length) return;
  const now = store.serverNow(), states = [];
  for (const tr of store.tracks.values()) {
    const st = store.stateAt(tr, now, 10);
    if (st && now - tr.samples[tr.samples.length - 1].t < 30) states.push({ ...st, hex: tr.hex, rotor: tr.info.size === "rotor" });
  }
  runwayWatch.update(states, now);
  runwayActivity = runwayWatch.activity(now);
  buildApData();
  renderFlow();
}
function renderFlow() {
  const el = $("flow");
  if (!S.airports || !S.home || !runwayWatch.airports.length) { el.hidden = true; return; }
  el.hidden = false;
  const act = runwayActivity.slice(0, 3);
  if (!act.length) {
    el.innerHTML = `<div class="flow-title">Runways in use</div><div class="muted">Watching arrivals and departures…</div>`;
    return;
  }
  const over = runwayWatch.overhead(S.home, runwayActivity);
  const code = (ap) => esc(ap.iata || ap.ident);
  el.innerHTML = `<div class="flow-title">Runways in use <span class="muted">· last 20 min</span></div>
    ${act.map((a) => `<button class="flow-ap" data-ap="${esc(a.ap.ident)}" title="${esc(a.ap.name)}">
      <b>${code(a.ap)}</b><span class="muted">${esc(a.flow)}</span>
      ${a.arr.length ? `<span class="arr" title="Landing">↓ ${a.arr.map((r) => esc(r.ident)).join(" ")}</span>` : ""}
      ${a.dep.length ? `<span class="dep" title="Taking off">↑ ${a.dep.map((r) => esc(r.ident)).join(" ")}</span>` : ""}
    </button>`).join("")}
    ${over ? `<div class="flow-home">${over.kind === "arrival"
      ? `You're under the ${code(over.ap)} ${esc(over.ident)} approach: ${over.outNm.toFixed(1)} nm out, arrivals pass ~${fmtNum(over.aglFt)} ft above.`
      : `You're under the ${code(over.ap)} ${esc(over.ident)} departure path, ${over.outNm.toFixed(1)} nm past the runway.`}</div>` : ""}`;
}
$("flow").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ap]");
  const ap = b && runwayWatch.airports.find((a) => a.ident === b.dataset.ap);
  if (!ap) return;
  if (S.view === "sky") setView("2d");
  following = false;
  mapView.map.flyTo({ center: [ap.lon, ap.lat], zoom: 12, duration: 1200 });
});

// ---------------------------------------------------------------- sun & sky, heatmap
function updateSun() {
  if (!S.home) return;
  sun = sunPosition(api.clock(), S.home.lat, S.home.lon); // demo: the recording's time of day
  applyStyle();
  mapView.setSun(sun, S.sunLight);
  const g = $("dialSun");
  g.setAttribute("transform", `rotate(${sun.az})`);
  g.style.opacity = sun.el > 0 ? 1 : sun.el > -6 ? 0.45 : 0;
  g.querySelector("title").textContent = `Sun ${Math.round(sun.az)}° ${compassPoint(sun.az)}, ${Math.round(sun.el)}° ${sun.el >= 0 ? "up" : "below horizon"}`;
}
function applyStyle() {
  // auto: light map from just before sunrise to just after sunset
  mapView.setStyle(S.style === "auto" ? (sun.el > -4 ? "light" : "dark") : S.style);
}
const HEAT_BANDS = { all: "0,1,2,3,4", ground: "0", approach: "1,2", high: "3,4" };
let heatTimer;
async function loadHeat() {
  clearTimeout(heatTimer);
  if (!S.heat || !S.home) { heatBins = null; return; }
  try {
    const body = await api.heat({ lat: S.home.lat.toFixed(3), lon: S.home.lon.toFixed(3), radius: S.radius,
      hours: S.heat < 0 ? 0 : S.heat, bands: HEAT_BANDS[S.heatBand] || HEAT_BANDS.all });
    heatBins = body.bins || null;
    if (DEMO) $("heatNote").textContent = "Demo: traffic density from the recorded sample.";
    else if (body.recordingSince && S.heat) {
      const hrs = (Date.now() / 1000 - body.recordingSince) / 3600;
      $("heatNote").textContent = `Recording since ${new Date(body.recordingSince * 1000).toLocaleString()} (${hrs < 1 ? `${Math.round(hrs * 60)} min` : `${hrs.toFixed(1)} h`}) while this server runs.`;
    }
  } catch (e) {
    console.warn("heatmap unavailable:", e);
  }
  heatTimer = setTimeout(loadHeat, 60e3);
}

// ---------------------------------------------------------------- top bar & settings
function setView(v) {
  S.view = v;
  save();
  for (const b of $("viewSeg").querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.view === v);
  const sky = v === "sky";
  $("sky").hidden = !sky;
  $("map").style.visibility = sky ? "hidden" : "visible";
  $("rotHome").hidden = sky;
  closeContextMenu();
  if (sky) stopChase();
  if (sky) skyView.resize();
  else mapView.setMode(v);
}
function setTime(t) {
  S.time = t;
  save();
  for (const b of $("timeSeg").querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.time === t);
  $("delayCtl").hidden = t !== "smooth";
  updateDelayUi();
}
function updateDelayUi() {
  const d = currentDelay();
  $("delay").value = d;
  $("delayVal").textContent = `${d}s`;
  $("delayAuto").setAttribute("aria-pressed", S.delay == null);
}
function toggle(id, btn) {
  const p = $(id);
  p.hidden = !p.hidden;
  $(btn).setAttribute("aria-pressed", !p.hidden);
  if (id === "list") renderList();
  if (id === "filters") renderAirlineChips(true);
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function wireTopbar() {
  $("viewSeg").onclick = (e) => e.target.dataset.view && setView(e.target.dataset.view);
  $("timeSeg").onclick = (e) => e.target.dataset.time && setTime(e.target.dataset.time);
  $("delay").oninput = (e) => { S.delay = +e.target.value; updateDelayUi(); save(); };
  $("delayAuto").onclick = (e) => { e.preventDefault(); S.delay = null; updateDelayUi(); save(); };
  $("btnFilters").onclick = () => toggle("filters", "btnFilters");
  $("btnList").onclick = () => toggle("list", "btnList");
  for (const x of document.querySelectorAll("[data-close]")) x.onclick = () => toggle(x.dataset.close, x.dataset.close === "list" ? "btnList" : "btnFilters");
  $("btnSettings").onclick = () => openSettings();
}
function openSettings() {
  $("sLat").value = S.home?.lat ?? "";
  $("sLon").value = S.home?.lon ?? "";
  $("sElev").value = S.elevFt || 0;
  $("sProvider").value = S.provider;
  $("sRadius").value = String(S.radius);
  $("sExtrap").checked = S.extrap;
  $("sStyle").value = S.style;
  $("sColor").value = S.colorBy;
  $("sLabels").value = S.labels;
  $("sTrail").value = String(S.trail);
  $("sTrailSel").value = String(S.trailSel);
  $("sTrailFade").checked = S.trailFade;
  $("sRouteLines").value = S.routeLines;
  $("sRouteLabels").checked = S.routeLabels;
  $("sAirports").checked = S.airports;
  $("sGuides").checked = S.runwayGuides;
  $("sSun").checked = S.sunLight;
  $("sHeat").value = String(S.heat);
  $("sHeatBand").value = S.heatBand;
  $("sEx").value = S.exaggeration;
  $("sIcon").value = S.iconScale;
  syncSettingLabels();
  $("settings").showModal();
}
function syncSettingLabels() {
  $("exVal").textContent = `${S.exaggeration}×`;
  $("iconVal").textContent = `${S.iconScale.toFixed(1)}×`;
}
function wireSettings() {
  $("sGeo").onclick = () => { $("settings").close(); useGeolocation(); };
  $("sPick").onclick = startPicking;
  const latlon = () => {
    const lat = parseFloat($("sLat").value), lon = parseFloat($("sLon").value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setHome(lat, lon);
  };
  $("sLat").onchange = latlon;
  $("sLon").onchange = latlon;
  $("sElev").onchange = (e) => { S.elevFt = +e.target.value || 0; save(); };
  $("sProvider").onchange = (e) => {
    S.provider = e.target.value;
    S.delay = null;
    save();
    restartFeed();
    if (S.provider === "opensky") toast("OpenSky: anonymous use is ~400 requests/day — polls every 15 s");
  };
  $("sRadius").onchange = (e) => {
    const wasAll = F.distMax >= S.radius;
    S.radius = +e.target.value;
    if (wasAll || F.distMax > S.radius) F.distMax = S.radius;
    save();
    if (S.home) mapView.setHome(S.home.lat, S.home.lon, S.radius);
    loadAirports();
    loadHeat();
    syncFilterLabels();
    $("fDist").value = F.distMax;
    restartFeed();
  };
  $("sExtrap").onchange = (e) => { S.extrap = e.target.checked; save(); };
  $("sStyle").onchange = (e) => { S.style = e.target.value; applyStyle(); save(); };
  $("sAirports").onchange = (e) => { S.airports = e.target.checked; loadAirports(); renderFlow(); save(); };
  $("sGuides").onchange = (e) => { S.runwayGuides = e.target.checked; save(); };
  $("sSun").onchange = (e) => { S.sunLight = e.target.checked; updateSun(); save(); };
  $("sHeat").onchange = (e) => { S.heat = +e.target.value; heatBins = null; loadHeat(); save(); };
  $("sHeatBand").onchange = (e) => { S.heatBand = e.target.value; loadHeat(); save(); };
  $("sColor").onchange = (e) => { S.colorBy = e.target.value; renderLegend(); save(); };
  $("sLabels").onchange = (e) => { S.labels = e.target.value; save(); };
  $("sTrail").onchange = (e) => { S.trail = +e.target.value; syncHistory(); save(); };
  $("sTrailSel").onchange = (e) => { S.trailSel = +e.target.value; syncHistory(); save(); };
  $("sTrailFade").onchange = (e) => { S.trailFade = e.target.checked; save(); };
  $("sRouteLines").onchange = (e) => { S.routeLines = e.target.value; save(); };
  $("sRouteLabels").onchange = (e) => { S.routeLabels = e.target.checked; save(); };
  $("sEx").oninput = (e) => { S.exaggeration = +e.target.value; syncSettingLabels(); save(); };
  $("sIcon").oninput = (e) => { S.iconScale = +e.target.value; syncSettingLabels(); save(); };
}
function wireOnboard() {
  $("oGeo").onclick = useGeolocation;
  $("oPick").onclick = startPicking;
  $("oGo").onclick = () => {
    const lat = parseFloat($("oLat").value), lon = parseFloat($("oLon").value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setHome(lat, lon);
    else toast("Enter a valid latitude and longitude");
  };
}
function wireKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "1") setView("2d");
    else if (k === "2") setView("3d");
    else if (k === "3") setView("sky");
    else if (k === "l") setTime("live");
    else if (k === "s") setTime("smooth");
    else if (k === "q") { stopSensor(); setBearing(S.bearing - 15, { animate: true }); }
    else if (k === "e") { stopSensor(); setBearing(S.bearing + 15, { animate: true }); }
    else if (k === "n") { stopSensor(); setBearing(0, { animate: true }); }
    else if (k === "f") toggle("filters", "btnFilters");
    else if (k === "t") cycleTrail();
    else if (k === "c") (chasing ? stopChase() : startChase());
    else if (k === "h") recenter();
    else if (k === "escape") {
      if (!$("ctxMenu").hidden) closeContextMenu();
      else if (chasing) stopChase();
      else if (picking) endPicking();
      else select(null);
    }
  });
}

// ---------------------------------------------------------------- demo
function setupDemo() {
  const when = new Date(DEMO.start * 1000).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const mins = Math.round(DEMO.duration / 60);
  const text = `Demo: replaying ${mins} minutes of traffic recorded around ${DEMO.name} on ${when} ` +
    `(${DEMO.provider}, looping). Run server.py for live data where you are.`;
  const badge = $("demoBadge");
  badge.hidden = false;
  badge.title = text;
  badge.onclick = () => openSettings();
  $("demoNote").hidden = false;
  $("demoNote").textContent = text;
  // location and data source are fixed by the recording
  for (const id of ["sGeo", "sPick", "sLat", "sLon", "sProvider", "sRadius"]) $(id).disabled = true;
}

// ---------------------------------------------------------------- boot
buildDial();
initDial();
buildFilterUi();
wireFilterInputs();
wireTopbar();
wireSettings();
wireOnboard();
wireKeys();
renderLegend();
setView(S.view);
setTime(S.time);
setBearing(S.bearing);
if (DEMO) setupDemo();
if (S.home) setHome(S.home.lat, S.home.lon);
else $("onboard").hidden = false;
window.addEventListener("resize", () => S.view === "sky" && skyView.resize());

syncHistory();
updateSun();
setInterval(() => {
  renderChaseHud();
  updateRoutes();
  updateRunways();
  renderList();
  renderDetails();
  renderAirlineChips();
  updateStatus();
  if (S.delay == null) updateDelayUi();
}, 1000);
setInterval(updateSun, 30e3);
requestAnimationFrame(frame);
window.overhead = { // console debugging
  store, routes, runwayWatch, mapView, skyView, settings: S,
  get items() { return lastItems; },
  get sun() { return sun; },
  set sun(v) { sun = v; applyStyle(); mapView.setSun(sun, S.sunLight); }, // preview lighting until the next 30 s update
};
