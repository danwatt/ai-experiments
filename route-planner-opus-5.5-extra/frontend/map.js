// The map: basemap, waypoints, route, alternates, zones, and the gestures on
// them (click to add, drag a waypoint, drag the route line, right-click menu,
// draw and edit zones). It reads `state` and changes the trip through edits.js.

import { state, updateUi, requestBody, setShowStops } from "./state.js";
import {
  letter, appendWaypoint, addMiddle, makeStart, makeEnd, insertWaypoint, newWaypoint, insertIndexForRouteIndex,
  bestInsertIndex, km, removeWaypoint, setWaypoint, adoptAlternate, addZone, setZone, removeZone,
  ZONE_TYPES, zoneType, zoneTone, zoneSize, describeWaypoint, waypointName, hm, miles, escapeHtml,
  togglePin, useStop, skipStop, unskipStop, clockOf, pinKind,
} from "./edits.js";
import { setZoneHome } from "./library.js";

const COLORS = {
  accent: "#4a90d9", accentText: "#7ab8f5", casing: "#0b1220", alt: "#8a8f96",
  danger: "#d9534f", warn: "#d9a441", success: "#5cb85c", off: "#777777",
};

// Online raster basemaps (the only part of the app that needs the internet).
// CARTO's dark tiles were the plan, but by November 2026 CARTO serves an
// "API KEY REQUIRED" watermark on every tile without a key. Stadia Maps
// serves its dark style without a key to pages on localhost, which is where
// this app runs. A key-based or offline (PMTiles) basemap is a later option.
const BASEMAPS = {
  stadia: {
    url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  carto: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
};

let map, layers, popup, statusHint;
const zoneLayers = new Map(); // zone id -> { layer, label, ring }

export function initMap(onHint) {
  statusHint = onHint;
  map = L.map("map", { zoomControl: false, preferCanvas: false }).setView([39.0, -105.6], 7);
  const base = BASEMAPS.stadia;
  L.tileLayer(base.url, { attribution: base.attribution, subdomains: base.subdomains || "abc", maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: true, metric: false }).addTo(map);

  // Draw order, bottom to top: zones, alternates, route, markers.
  map.createPane("zones").style.zIndex = 390;
  map.createPane("alts").style.zIndex = 395;
  map.createPane("route").style.zIndex = 405;
  map.createPane("preview").style.zIndex = 410;
  map.createPane("band").style.zIndex = 400; // a break's window, under the route line
  map.createPane("stops").style.zIndex = 450; // above the route, below the waypoint markers (600)
  map.createPane("picks").style.zIndex = 470; // the open picker's alternatives
  map.createPane("breaks").style.zIndex = 500; // planned breaks
  map.createPane("dayline").style.zIndex = 406; // the selected day, over the route
  map.createPane("daychips").style.zIndex = 460;

  layers = {
    zones: L.layerGroup().addTo(map),
    alts: L.layerGroup().addTo(map),
    route: L.layerGroup().addTo(map),
    stops: L.layerGroup().addTo(map),
    band: L.layerGroup().addTo(map),
    picks: L.layerGroup().addTo(map),
    breaks: L.layerGroup().addTo(map),
    days: L.layerGroup().addTo(map),
    markers: L.layerGroup().addTo(map),
    preview: L.layerGroup().addTo(map),
  };
  popup = L.popup({ closeButton: true, autoPan: true, offset: [0, -8], maxWidth: 360, className: "card" });
  map.on("popupclose", (e) => {
    if (e.popup !== popup) return;
    cardKey = null;
    if (state.ui.selected || state.ui.selectedZone || state.ui.selectedStop || state.ui.selectedBreak) {
      updateUi((u) => { u.selected = null; u.selectedZone = null; u.selectedStop = null; u.selectedBreak = null; u.pickerFocus = null; });
    }
  });

  addToolControl();
  addLayerControl();
  watchSize();
  map.on("zoomend", renderStops);
  setUpGeoman();
  setUpContextMenu();
  map.on("click", onMapClick);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { setTool("pan"); hideMenu(); }
  });
  return map;
}

// The map was hidden under the settings or export page: tell Leaflet its size changed.
export function refreshMapSize() {
  map?.invalidateSize();
}

// Wait for one click on the map and answer where it was ({lat, lng}), or null
// if Esc was pressed. The click does nothing else (it does not drag the route).
export function pickOnMap(hint) {
  return new Promise((resolve) => {
    const el = map.getContainer();
    el.classList.add("picking");
    statusHint?.(hint);
    const done = (value) => {
      el.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      el.classList.remove("picking");
      statusHint?.(null);
      resolve(value);
    };
    const onClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const ll = map.mouseEventToLatLng(e);
      done({ lat: ll.lat, lng: ll.lng });
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    el.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  });
}

// ---------- tools ----------

const TOOLS = [
  ["pan", "✋", "Move map"],
  ["add", "📍", "Waypoint"],
  ["thru", "◇", "Through point"],
  ["box", "▭", "Box zone"],
  ["poly", "⬠", "Polygon zone"],
];

function addToolControl() {
  const Tools = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const el = L.DomUtil.create("div", "tools");
      el.innerHTML =
        TOOLS.map(([k, g, l]) => `<button class="tool" data-tool="${k}" title="${l}"><span class="g">${g}</span>${l}</button>`).join("") +
        `<hr><div class="hint-line" id="tool-hint"></div>`;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tool]");
        if (b) setTool(state.ui.tool === b.dataset.tool ? "pan" : b.dataset.tool);
      });
      return el;
    },
  });
  map.addControl(new Tools());
}

const TOOL_HINTS = {
  pan: "Drag the blue route to bend it. Right-click for more.",
  add: "Click the map: the point becomes the new end.",
  thru: "Click the map: the route will pass here.",
  box: "Click two corners.",
  poly: "Click the corners; click the first one to finish.",
};

export function setTool(tool) {
  if (tool !== "box" && tool !== "poly") map.pm.disableDraw();
  if (tool === "box") map.pm.enableDraw("Rectangle");
  if (tool === "poly") map.pm.enableDraw("Polygon", { snappable: false });
  updateUi((u) => { u.tool = tool; });
}

function renderTools() {
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === state.ui.tool));
  const hint = document.getElementById("tool-hint");
  if (hint) hint.textContent = TOOL_HINTS[state.ui.tool] || "";
  const el = document.getElementById("map");
  el.classList.toggle("tool-add", state.ui.tool === "add");
  el.classList.toggle("tool-thru", state.ui.tool === "thru");
}

function onMapClick(e) {
  hideMenu();
  const { lat, lng } = e.latlng;
  if (state.ui.tool === "add") appendWaypoint(lat, lng);
  else if (state.ui.tool === "thru") addThrough(lat, lng);
}

// A through point goes into the leg whose route passes closest, if the route
// passes within 20 km; otherwise between the waypoints it fits best.
function addThrough(lat, lon) {
  const wps = state.trip.waypoints;
  if (wps.length < 2) return appendWaypoint(lat, lon);
  const near = nearestRoutePoint({ lat, lng: lon });
  const wp = newWaypoint(lat, lon, "through");
  const index = near && near.km < 20 ? insertIndexForRouteIndex(near.index) : bestInsertIndex(wps, wp);
  insertWaypoint(index, wp);
}

// ---------- rendering ----------

export function renderMap(what) {
  renderTools();
  renderZones();
  renderRoute();
  renderStops();
  renderBreaks();
  renderDays();
  renderPicker();
  renderMarkers();
  renderCard();
  renderLayerControl();
  if (what === "route-fit") fitTrip();
}

// Fit the map to the route (or the waypoints). If the map has no size yet
// (the page loaded in a hidden tab or pane), fitBounds would pick the highest
// zoom for a 0 x 0 view, so the fit waits until the container has a size.
let fitPending = false;

export function fitTrip() {
  map.invalidateSize();
  const size = map.getSize();
  if (size.x < 50 || size.y < 50) {
    fitPending = true;
    return;
  }
  fitPending = false;
  const pts = state.route
    ? state.route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
    : state.trip.waypoints.map((w) => [w.lat, w.lon]);
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
  else if (pts.length === 1) map.setView(pts[0], 9);
}

// Leaflet only learns about size changes of the window. This also catches the
// container going from hidden to shown, and runs the fit that was waiting.
function watchSize() {
  if (!window.ResizeObserver) return;
  new ResizeObserver(() => {
    map.invalidateSize();
    if (fitPending) fitTrip();
  }).observe(document.getElementById("map"));
}

export function panToWaypoint(id) {
  const wp = state.trip.waypoints.find((w) => w.id === id);
  if (wp) map.panTo([wp.lat, wp.lon]);
}

export function panToZone(id) {
  const z = zoneLayers.get(id);
  if (z) map.fitBounds(z.layer.getBounds(), { padding: [60, 60], maxZoom: 12 });
}

function renderMarkers() {
  layers.markers.clearLayers();
  const wps = state.trip.waypoints;
  const bad = state.error?.waypoint_id;
  wps.forEach((wp, i) => {
    const thru = wp.type === "through" && i > 0 && i < wps.length - 1;
    const night = wp.type === "overnight" && i > 0 && i < wps.length - 1;
    const cls = ["mk", thru ? "thru" : "", night ? "night" : "", i === wps.length - 1 && i > 0 ? "end" : "",
      state.ui.selected === wp.id ? "sel" : "", bad === wp.id ? "bad" : ""].join(" ");
    const inner = thru ? `<span>${letter(i)}</span>` : letter(i);
    const label = wp.name ? `<div class="mklab"><b>${escapeHtml(wp.name)}</b></div>` : "";
    const size = thru ? 25 : 26;
    const marker = L.marker([wp.lat, wp.lon], {
      draggable: true,
      autoPan: true,
      zIndexOffset: i === 0 ? 0 : i * 10,
      icon: L.divIcon({ className: "wp-icon", html: `<div class="${cls}">${inner}</div>${label}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      title: `${letter(i)} · ${waypointName(wp)}`,
    });
    marker.on("click", (e) => { L.DomEvent.stop(e); selectWaypoint(wp.id); });
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      setWaypoint(wp.id, { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lng * 1e6) / 1e6 });
    });
    marker.on("contextmenu", (e) => { L.DomEvent.stop(e); selectWaypoint(wp.id); });
    layers.markers.addLayer(marker);
  });
}

export function selectWaypoint(id) {
  updateUi((u) => { u.selected = id; u.selectedZone = null; u.selectedStop = null; u.selectedBreak = null; });
}

export function selectZone(id) {
  updateUi((u) => { u.selectedZone = id; u.selected = null; u.selectedStop = null; u.selectedBreak = null; });
}

export function selectStop(key) {
  updateUi((u) => { u.selectedStop = key; u.selected = null; u.selectedZone = null; u.selectedBreak = null; });
}

export function panToStop(key) {
  const c = state.stops?.candidates.find((x) => x.key === key);
  if (c) map.panTo([c.lat, c.lon]);
}

function renderRoute() {
  layers.route.clearLayers();
  layers.alts.clearLayers();
  const r = state.route;
  if (!r) return;
  const latlngs = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

  r.alternates.forEach((alt, i) => {
    const pts = alt.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const line = L.polyline(pts, { pane: "alts", color: COLORS.alt, weight: 4, opacity: 0.85, dashArray: "8 6", pmIgnore: true });
    const extra = alt.extra_minutes >= 0 ? `+${hm(alt.extra_minutes)}` : `−${hm(-alt.extra_minutes)}`;
    line.bindTooltip(`Alternate ${i + 1}: ${miles(alt.miles)} mi, ${hm(alt.minutes)} (${extra}). Click to use it.`, { sticky: true });
    line.on("click", (e) => { L.DomEvent.stop(e); adoptAlternate(alt); });
    line.on("mouseover", () => line.setStyle({ color: COLORS.accentText, opacity: 1 }));
    line.on("mouseout", () => line.setStyle({ color: COLORS.alt, opacity: 0.85 }));
    layers.alts.addLayer(line);
    const chip = L.marker([alt.adopt.lat, alt.adopt.lon], {
      pane: "alts",
      icon: L.divIcon({ className: "", html: `<span class="chipmap">Alternate <b>${extra}</b> · ${miles(alt.miles)} mi</span>`, iconSize: [0, 0] }),
      pmIgnore: true,
    });
    chip.on("click", (e) => { L.DomEvent.stop(e); adoptAlternate(alt); });
    layers.alts.addLayer(chip);
  });

  layers.route.addLayer(L.polyline(latlngs, { pane: "route", color: COLORS.casing, weight: 9, opacity: 0.9, interactive: false, pmIgnore: true }));
  layers.route.addLayer(L.polyline(latlngs, { pane: "route", color: COLORS.accent, weight: 4.5, interactive: false, pmIgnore: true }));
  // A wide invisible line on top, easy to grab.
  const hit = L.polyline(latlngs, { pane: "route", color: "#000", weight: 18, opacity: 0, className: "route-hit", pmIgnore: true, bubblingMouseEvents: false });
  hit.on("mousedown", startRouteDrag);
  hit.on("contextmenu", (e) => showMenu(e));
  layers.route.addLayer(hit);
}

// ---------- dragging the route line ----------

// Nearest route coordinate to a latlng: { index, km }.
function nearestRoutePoint(latlng) {
  const coords = state.route?.geometry.coordinates;
  if (!coords) return null;
  const p = { lat: latlng.lat, lon: latlng.lng };
  const cos = Math.cos((p.lat * Math.PI) / 180);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dx = (coords[i][0] - p.lon) * cos, dy = coords[i][1] - p.lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, km: km(p, { lat: coords[best][1], lon: coords[best][0] }) };
}

function startRouteDrag(e) {
  if (e.originalEvent.button !== 0 || state.ui.tool !== "pan") return;
  L.DomEvent.stop(e);
  L.DomEvent.preventDefault(e.originalEvent);
  map.dragging.disable();
  const near = nearestRoutePoint(e.latlng);
  const index = insertIndexForRouteIndex(near.index);
  const wps = state.trip.waypoints;
  const drag = { index, prev: wps[index - 1], next: wps[index], start: e.containerPoint, moved: false, latlng: e.latlng, preview: null, inFlight: false, last: 0 };
  state.ui.drag = drag;
  document.getElementById("map").classList.add("dragging-route");

  const onMove = (ev) => {
    const latlng = map.mouseEventToLatLng(ev);
    const pt = map.mouseEventToContainerPoint(ev);
    if (!drag.moved && pt.distanceTo(drag.start) < 4) return;
    drag.moved = true;
    drag.latlng = latlng;
    drawDragPreview(drag);
    requestDragPreview(drag);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    map.dragging.enable();
    document.getElementById("map").classList.remove("dragging-route");
    layers.preview.clearLayers();
    state.ui.drag = null;
    statusHint(null);
    if (drag.moved) insertWaypoint(drag.index, newWaypoint(drag.latlng.lat, drag.latlng.lng, "through"));
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function drawDragPreview(drag) {
  layers.preview.clearLayers();
  const cursor = [drag.latlng.lat, drag.latlng.lng];
  // Straight dashed lines right away; replaced by the real roads once the
  // preview route comes back.
  const pts = drag.preview?.points || [drag.prev && [drag.prev.lat, drag.prev.lon], cursor, drag.next && [drag.next.lat, drag.next.lon]].filter(Boolean);
  layers.preview.addLayer(L.polyline(pts, { pane: "preview", color: COLORS.accentText, weight: 3, dashArray: "6 5", interactive: false, pmIgnore: true }));
  layers.preview.addLayer(L.circleMarker(cursor, { pane: "preview", radius: 6, color: "#fff", weight: 2, fill: false, interactive: false, pmIgnore: true }));
  const extra = drag.preview ? ` · ${drag.preview.extra >= 0 ? "+" : "−"}${hm(Math.abs(drag.preview.extra))}` : "";
  layers.preview.addLayer(L.marker(cursor, {
    pane: "preview", interactive: false, pmIgnore: true,
    icon: L.divIcon({ className: "", html: `<span class="tip">Release to add a through point${extra}</span>`, iconSize: [0, 0] }),
  }));
  statusHint(`<b>Dragging the route</b> · release to add a through point${extra}`);
}

// Ask for the bent route while dragging, at most one request at a time.
async function requestDragPreview(drag) {
  if (drag.inFlight || performance.now() - drag.last < 150) return;
  drag.inFlight = true;
  drag.last = performance.now();
  const at = drag.latlng;
  const body = requestBody(state.trip);
  body.waypoints.splice(drag.index, 0, { id: "_preview", lat: at.lat, lon: at.lng, type: "through" });
  body.options = { ...body.options, alternates: 0 };
  try {
    const resp = await fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (resp.ok && state.ui.drag === drag) {
      const r = await resp.json();
      const leg = r.legs.find((l) => l.through.includes("_preview"));
      const coords = r.geometry.coordinates.slice(leg.span[0], leg.span[1] + 1);
      drag.preview = { points: coords.map(([lon, lat]) => [lat, lon]), extra: r.total.minutes - (state.route?.total.minutes || 0) };
      drawDragPreview(drag);
    }
  } catch (e) {
    /* the preview is optional */
  } finally {
    drag.inFlight = false;
  }
  // The pointer may have moved on while we waited.
  if (state.ui.drag === drag && drag.latlng !== at) requestDragPreview(drag);
}

// ---------- zones ----------

function zoneStyle(zone) {
  const tone = zoneTone(zone);
  const bad = state.error?.zone_id === zone.id;
  const color = { avoid: COLORS.danger, other: COLORS.warn, prefer: COLORS.success, off: COLORS.off }[tone];
  return {
    pane: "zones", color, weight: bad ? 3.5 : 1.6, opacity: tone === "off" ? 0.6 : 0.9,
    fillColor: color, fillOpacity: bad ? 0.28 : tone === "off" ? 0.04 : 0.12,
    dashArray: tone === "avoid" && !bad ? null : "5 3",
  };
}

const ringToLatLngs = (ring) => ring.slice(0, ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? -1 : undefined).map(([lon, lat]) => [lat, lon]);

function latLngsToRing(latlngs) {
  const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  const ring = flat.map((ll) => [Math.round(ll.lng * 1e6) / 1e6, Math.round(ll.lat * 1e6) / 1e6]);
  ring.push(ring[0]);
  return ring;
}

function renderZones() {
  const seen = new Set();
  for (const zone of state.trip.zones) {
    seen.add(zone.id);
    let entry = zoneLayers.get(zone.id);
    const ringKey = JSON.stringify(zone.ring);
    if (entry && entry.ringKey !== ringKey && state.ui.editingZone !== zone.id) {
      layers.zones.removeLayer(entry.layer);
      layers.zones.removeLayer(entry.label);
      zoneLayers.delete(zone.id);
      entry = null;
    }
    if (!entry) {
      const latlngs = ringToLatLngs(zone.ring);
      const layer = zone.shape === "rectangle" ? L.rectangle(L.latLngBounds(latlngs), zoneStyle(zone)) : L.polygon(latlngs, zoneStyle(zone));
      layer.on("click", (e) => { L.DomEvent.stop(e); selectZone(zone.id); });
      layer.on("contextmenu", (e) => showMenu(e));
      const onEdit = () => setZone(zone.id, { ring: latLngsToRing(layer.getLatLngs()) });
      layer.on("pm:edit", onEdit);
      const label = L.marker(layer.getBounds().getCenter(), { interactive: false, pmIgnore: true, icon: L.divIcon({ className: "", html: "", iconSize: [0, 0] }) });
      layers.zones.addLayer(layer);
      layers.zones.addLayer(label);
      entry = { layer, label, ringKey };
      zoneLayers.set(zone.id, entry);
    }
    entry.ringKey = ringKey;
    entry.layer.setStyle(zoneStyle(zone));
    const t = zoneType(zone.type);
    entry.label.setLatLng(entry.layer.getBounds().getCenter());
    entry.label.setIcon(L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="zlab ${zoneTone(zone)}">${t.icon} ${escapeHtml(zone.name || t.short)}${zone.enabled ? "" : " · off"}</span>` }));
    const editing = state.ui.editingZone === zone.id;
    if (editing && !entry.layer.pm.enabled()) entry.layer.pm.enable({ allowSelfIntersection: false, snappable: false });
    if (!editing && entry.layer.pm.enabled()) entry.layer.pm.disable();
  }
  for (const [id, entry] of zoneLayers) {
    if (!seen.has(id)) {
      layers.zones.removeLayer(entry.layer);
      layers.zones.removeLayer(entry.label);
      zoneLayers.delete(id);
    }
  }
}

function setUpGeoman() {
  map.pm.setGlobalOptions({
    pathOptions: { color: COLORS.accentText, fillColor: COLORS.accent, fillOpacity: 0.12, weight: 1.6, dashArray: "6 4" },
    templineStyle: { color: COLORS.accentText, dashArray: "6 4" },
    hintlineStyle: { color: COLORS.accentText, dashArray: "4 4" },
    snappable: false,
  });
  map.on("pm:create", (e) => {
    const shape = e.shape === "Rectangle" ? "rectangle" : "polygon";
    const ring = latLngsToRing(e.layer.getLatLngs());
    map.removeLayer(e.layer);
    addZone(ring, shape);
    setTool("pan");
  });
}

// Start a box zone with its first corner at `latlng` (right-click menu).
function drawZoneFrom(latlng) {
  setTool("box");
  const draw = map.pm.Draw.Rectangle;
  // Geoman places the first corner where its hint marker is, so put it there
  // and click.
  draw._hintMarker?.setLatLng(latlng);
  map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng) });
}

// ---------- candidate stops ----------

const KIND_LABEL = { rest_area: "Rest area", service_plaza: "Service plaza", exit: "Exit", town: "Town", other: "Roadside stop" };
const KIND_GLYPH = { rest_area: "🅿", service_plaza: "🅿", exit: "↱", town: "🏘", other: "•" };

// Which candidates are drawn at this zoom. Zoomed out, only the ones worth
// planning around; zoomed in, everything, including exits with nothing at them.
function stopVisible(c, zoom) {
  const amenities = c.food + c.fuel + c.lodging;
  if (c.kind === "rest_area" || c.kind === "service_plaza") return true;
  if (zoom >= 11) return true;
  if (c.over_limit && zoom < 10) return false;
  if (zoom >= 10) return amenities > 0;
  if (zoom >= 9) return c.food >= 3 || c.fuel >= 2;
  return c.food >= 10 || c.fuel >= 4;
}

function stopIcon(c) {
  const glyph = c.kind === "exit" && c.ref ? escapeHtml(c.ref) : KIND_GLYPH[c.kind];
  const food = c.food ? `<span class="n">${c.food}</span>` : "";
  const cls = ["cp", c.kind, c.over_limit ? "over" : "", state.ui.selectedStop === c.key ? "sel" : ""].join(" ");
  return L.divIcon({ className: "cp-icon", iconSize: [0, 0], html: `<div class="${cls}"><span class="g">${glyph}</span>${food}</div>` });
}

function stopTitle(c) {
  const detour = c.detour_status === "unreachable" ? "no way in from this side" : `+${c.detour_min} min`;
  return `${c.name} · mile ${miles(c.mile)} · ${detour}`;
}

let stopsKey = "";

function renderStops() {
  const stops = state.ui.showStops ? state.stops : null;
  const zoom = map.getZoom();
  const key = [stops ? state.stops.candidates.length + ":" + (state.stops.timing?.total_ms ?? "") : "none", zoom, state.ui.selectedStop].join("|");
  if (key === stopsKey) return;
  stopsKey = key;
  layers.stops.clearLayers();
  if (!stops) return;
  // Draw rest areas last, then the busy places, so they sit on top of exits with nothing.
  const weight = (c) => (c.kind === "rest_area" || c.kind === "service_plaza" ? 1e6 : c.food + c.fuel);
  const shown = stops.candidates.filter((c) => stopVisible(c, zoom)).sort((a, b) => weight(a) - weight(b));
  for (const c of shown) {
    const marker = L.marker([c.lat, c.lon], { pane: "stops", icon: stopIcon(c), title: stopTitle(c), pmIgnore: true, riseOnHover: true });
    marker.on("click", (e) => { L.DomEvent.stop(e); selectStop(c.key); });
    layers.stops.addLayer(marker);
  }
}

function addLayerControl() {
  const Layers = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const el = L.DomUtil.create("div", "layers");
      el.innerHTML = `<label class="ly"><input type="checkbox" id="ly-stops"> Candidate stops</label>
        <div class="ly-note" id="ly-note"></div>
        <div class="ly-key"><span><i class="cp rest_area"><span class="g">🅿</span></i> rest area</span><span><i class="cp exit"><span class="g">116</span></i> exit</span><span><i class="cp town"><span class="g">🏘</span></i> town</span><span><i class="cp other"><span class="g">•</span></i> other</span><span class="ly-sub">number = places to eat</span></div>`;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      el.querySelector("#ly-stops").addEventListener("change", (e) => setShowStops(e.target.checked));
      return el;
    },
  });
  map.addControl(new Layers());
}

function renderLayerControl() {
  const box = document.getElementById("ly-stops");
  if (!box) return;
  box.checked = state.ui.showStops;
  document.querySelector(".layers .ly-key").hidden = !state.ui.showStops;
  const note = document.getElementById("ly-note");
  const s = state.stops;
  if (!state.ui.showStops) note.textContent = "";
  else if (state.stopsError) note.innerHTML = `<span class="bad">⚠ ${escapeHtml(state.stopsError.message)}</span>`;
  else if (state.stopsLoading) note.textContent = s ? "Updating stops…" : "Finding stops and checking detours…";
  else if (s) {
    const over = s.candidates.filter((c) => c.over_limit).length;
    note.textContent = `${s.candidates.length} stops · ${over} over the detour limit (${s.limit_minutes / 2} min each way)`;
  } else note.textContent = "";
}

const countsLine = (n, parts) => `${n}${parts.length ? " · " + parts.join(" · ") : ""}`;

function stopCard(c) {
  const d = c.detail || {};
  const where = [];
  if (c.kind === "exit") where.push(c.ref ? `Exit ${escapeHtml(c.ref)}` : "Exit", c.road ? escapeHtml(c.road.replace(" ", "-")) : "");
  else if (c.name !== KIND_LABEL[c.kind]) where.push(KIND_LABEL[c.kind]);
  if (c.kind === "town" && c.population) where.push(`pop. ${c.population.toLocaleString()}`);
  if (c.near && c.near !== c.name) where.push(`near ${escapeHtml(c.near)}`);
  let detour;
  if (c.detour_status === "unreachable") detour = `<span class="chip bad">over the limit</span> no way in from this side of the road`;
  else if (c.over_limit) detour = `<span class="chip bad">over the limit</span> +${c.detour_min} min there and back (limit ${state.stops.limit_minutes / 2} min each way)`;
  else detour = `<span class="chip ok">+${c.detour_min} min</span> ${c.detour_min < 1 ? "on the way" : "to get there and back on route"}`;
  const brands = (kind) => Object.entries(d.brands?.[kind] || {}).slice(0, 4).map(([b, n]) => (n > 1 ? `${escapeHtml(b)} ×${n}` : escapeHtml(b)));
  const rows = [];
  rows.push(["Mile", `${miles(c.mile)} · ${hm(c.minute)} driving${c.off_route_m > 150 ? ` · ${(c.off_route_m / 1609).toFixed(1)} mi off the road` : ""}`]);
  rows.push(["Detour", detour]);
  if (c.food) {
    const kinds = [c.food_sitdown && `sit-down ${c.food_sitdown}`, c.food_fast && `fast food ${c.food_fast}`, c.food_cafe && `café ${c.food_cafe}`].filter(Boolean);
    const cuisines = Object.entries(d.cuisines || {}).slice(0, 4).map(([k, n]) => `${escapeHtml(k)} ${n}`);
    rows.push(["Food", countsLine(c.food, kinds) + (cuisines.length ? `<br><span class="dim">${cuisines.join(" · ")}</span>` : "")]);
  }
  if (c.fuel) rows.push(["Fuel", countsLine(c.fuel, brands("fuel"))]);
  if (c.lodging) rows.push(["Lodging", countsLine(c.lodging, brands("lodging"))]);
  if (c.kind === "rest_area" || c.kind === "service_plaza") {
    const yn = (v) => (v === true ? "yes" : v === false ? "no" : "not mapped");
    rows.push(["Here", `toilets: ${yn(c.toilets)} · picnic: ${yn(c.picnic)}`]);
  }
  if (!c.food && !c.fuel && !c.lodging && c.kind !== "rest_area" && c.kind !== "service_plaza") rows.push(["Here", `<span class="dim">nothing mapped in OSM</span>`]);
  return `<div class="pop stopcard">
    <h5><span class="cp ${c.kind}"><span class="g">${c.kind === "exit" && c.ref ? escapeHtml(c.ref) : KIND_GLYPH[c.kind]}</span></span><span style="flex:1">${escapeHtml(c.name)}</span></h5>
    <div class="m">${where.filter(Boolean).join(" · ")}</div>
    <div class="kv wide">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("")}</div>
    ${stopActs(c)}
  </div>`;
}

// Pin or skip a candidate straight from its card.
function stopActs(c) {
  if (!c.stop_key || !state.stops?.plan) return "";
  const b = state.trip.breaks;
  const pinned = b.pins.some((p) => p.key === c.stop_key), skipped = b.skips.some((p) => p.key === c.stop_key);
  const pin = b.pins.find((p) => p.key === c.stop_key);
  const as = (kind, label) => `<button class="btn sm ${pin?.kind === kind ? "on" : ""}" data-act="cpin" data-kind="${kind}">${pin?.kind === kind ? `📌 Unpin (${kind})` : label}</button>`;
  return `<div class="acts">
    ${as("break", "📌 Pin as a break")}
    ${c.food ? as("lunch", "🍴 Lunch here") : ""}
    ${c.food ? as("dinner", "🍴 Dinner here") : ""}
    ${c.lodging >= 2 ? as("overnight", "🛏 Stay here") : ""}
    <button class="btn sm quiet" data-act="cskip">${skipped ? "Stop skipping" : "Skip on this trip"}</button></div>`;
}

function wireStopCard(el, c) {
  if (!el) return;
  keepClicksInCard(el);
  el.querySelectorAll('[data-act="cpin"]').forEach((btn) => btn.addEventListener("click", () => {
    const pin = state.trip.breaks.pins.find((p) => p.key === c.stop_key);
    if (pin && pin.kind !== btn.dataset.kind) togglePin(c.stop_key, c.name); // drop the other kind first
    togglePin(c.stop_key, c.name, btn.dataset.kind);
  }));
  el.querySelector('[data-act="cskip"]')?.addEventListener("click", () =>
    (state.trip.breaks.skips.some((p) => p.key === c.stop_key) ? unskipStop(c.stop_key) : skipStop(c.stop_key, c.name)));
}

// ---------- planned stops: breaks, meals, fuel, overnights ----------

// Every row the planner chose and the picker can open: breaks, meals, fuel
// stops and its own overnights.
const STOP_ROW = new Set(["break", "lunch", "dinner", "fuel"]);
const isStopRow = (r) => STOP_ROW.has(r.type) || (r.type === "overnight" && r.auto);
const breakRows = () => (state.stops?.plan?.rows || []).filter(isStopRow);
const breakRow = (key) => breakRows().find((r) => r.stop_key === key);
const STOP_GLYPH = { break: "☕", lunch: "🍴", dinner: "🍴", fuel: "⛽", overnight: "🛏" };
const STOP_NAME = { break: "Break", lunch: "Lunch", dinner: "Dinner", fuel: "Fuel", overnight: "Overnight" };

export function selectBreak(key, { pan = false } = {}) {
  const r = breakRow(key);
  updateUi((u) => {
    u.selectedBreak = key; u.pickerFocus = key; u.selected = null; u.selectedZone = null; u.selectedStop = null;
    if (r) u.day = r.day;
  });
  if (r) fitPicker(r, pan);
}

// Show the break, its alternatives and its window, with room above them for
// the picker card (Leaflet opens popups above their point).
function fitPicker(r, always) {
  const pts = [[r.lat, r.lon], ...r.alternatives.map((a) => [a.lat, a.lon])];
  if (r.window) pts.push(...routeBetween(r.window.earliest_mile, r.window.hard_mile));
  if (pts.length < 2) pts.push(...routeBetween(r.mile - 20, r.mile + 20));
  const bounds = L.latLngBounds(pts);
  const size = map.getSize();
  const top = Math.min(380, size.y * 0.55);
  if (!always && map.getBounds().contains(bounds) && map.latLngToContainerPoint([r.lat, r.lon]).y > top) return;
  map.fitBounds(bounds, { paddingTopLeft: [60, top], paddingBottomRight: [60, 30], maxZoom: 10 });
}

// The candidate nearest a point on the map (skipped ones excluded): where a
// dragged break marker snaps to.
function nearestCandidate(latlng) {
  const skipped = new Set(state.trip.breaks.skips.map((s) => s.key));
  let best = null, bestKm = Infinity;
  for (const c of state.stops?.candidates || []) {
    if (skipped.has(c.stop_key)) continue;
    const d = km({ lat: latlng.lat, lon: latlng.lng }, c);
    if (d < bestKm) { best = c; bestKm = d; }
  }
  return best;
}

function renderBreaks() {
  layers.breaks.clearLayers();
  for (const r of breakRows()) {
    const night = r.type === "overnight";
    const cls = ["bk", r.type === "overnight" ? "night" : r.type, r.pinned ? "pinned" : "", r.over_limit && !night ? "over" : "",
      r.refuel && r.type !== "fuel" ? "merged" : "", state.ui.selectedBreak === r.stop_key ? "sel" : ""].join(" ");
    const glyph = r.pinned ? "📌" : STOP_GLYPH[r.type];
    const label = night ? `🛏 <b>${clockOf(r.arrive)}</b> · ${escapeHtml(r.name)}` : `<b>${clockOf(r.arrive)}</b> · ${escapeHtml(r.name)}`;
    const marker = L.marker([r.lat, r.lon], {
      pane: "breaks", draggable: r.type !== "fuel", autoPan: true, pmIgnore: true, riseOnHover: true,
      icon: L.divIcon({ className: "bk-icon", iconSize: [0, 0], html: `<div class="${cls}">${glyph}</div><div class="bklab">${label}</div>` }),
      title: `${STOP_NAME[r.type]} at ${r.name}, ${clockOf(r.arrive)}. Click for alternatives; drag to another stop to pin it.`,
    });
    marker.on("click", (e) => { L.DomEvent.stop(e); selectBreak(r.stop_key, { pan: true }); });
    marker.on("drag", () => {
      const c = nearestCandidate(marker.getLatLng());
      statusHint(c ? `<b>Moving the break</b> · release to pin ${escapeHtml(c.name)} (mile ${miles(c.mile)})` : null);
    });
    marker.on("dragend", () => {
      statusHint(null);
      const c = nearestCandidate(marker.getLatLng());
      if (!c || c.stop_key === r.stop_key) { renderBreaks(); return; }
      useStop(c.stop_key, c.name, r.pinned ? r.stop_key : null, pinKind(r));
    });
    layers.breaks.addLayer(marker);
  }
}

// One chip per driving day along the route, and the selected day drawn over
// the route line. Clicking a chip selects that day (sidebar and day strip too).
function renderDays() {
  layers.days.clearLayers();
  const plan = state.stops?.plan;
  if (!plan || !state.route || plan.days.length < 2) return;
  for (const d of plan.days) {
    if (!d.driving) continue;
    const pts = routeBetween(d.start_mile, d.end_mile);
    if (pts.length < 2) continue;
    const on = d.day === state.ui.day;
    if (on) layers.days.addLayer(L.polyline(pts, { pane: "dayline", color: COLORS.accentText, weight: 7, opacity: 0.9, interactive: false, pmIgnore: true }));
    const mid = pts[Math.floor(pts.length / 2)];
    const chip = L.marker(mid, {
      pane: "daychips", pmIgnore: true,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="chipmap day ${on ? "sel" : ""}">Day ${d.day} · <b>${miles(d.miles)} mi</b> · ${hm(d.driving_minutes)}</span>` }),
    });
    chip.on("click", (e) => { L.DomEvent.stop(e); updateUi((u) => { u.day = d.day; }); });
    layers.days.addLayer(chip);
  }
}

// Route coordinates between two miles (the route's cumulative miles, scaled
// to Valhalla's total, from state.js).
function routeBetween(fromMile, toMile) {
  const r = state.route;
  if (!r?.cumulative_miles) return [];
  const coords = r.geometry.coordinates, cum = r.cumulative_miles;
  const out = [];
  for (let i = 0; i < coords.length; i++) if (cum[i] >= fromMile && cum[i] <= toMile) out.push([coords[i][1], coords[i][0]]);
  return out;
}

// The open picker on the map: the window as a shaded band on the road, and
// every alternative as a small dot with its arrival time.
function renderPicker() {
  layers.band.clearLayers();
  layers.picks.clearLayers();
  const r = breakRow(state.ui.selectedBreak);
  if (!r) return;
  if (!r.window) { if (r.type === "overnight") renderPicks(r); return; }
  const w = r.window;
  const band = routeBetween(w.earliest_mile, w.latest_mile);
  if (band.length > 1) {
    layers.band.addLayer(L.polyline(band, { pane: "band", color: "#7ab8f5", opacity: 0.28, weight: 26, lineCap: "round", interactive: false, pmIgnore: true }));
    layers.band.addLayer(L.marker(band[0], { pane: "picks", interactive: false, pmIgnore: true,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="bandlab">${w.meal ? `${w.meal} window` : "break window"} · ${clockOf(w.earliest_clock)}–${clockOf(w.latest_clock)}</span>` }) }));
  }
  const late = routeBetween(w.latest_mile, w.hard_mile);
  if (late.length > 1) layers.band.addLayer(L.polyline(late, { pane: "band", color: "#d9a441", opacity: 0.22, weight: 18, interactive: false, pmIgnore: true }));
  renderPicks(r);
}

// Every alternative of the open picker as a small dot with its arrival time
// (for an overnight: that day's driving).
function renderPicks(r) {
  for (const a of r.alternatives.slice(1)) {
    const no = a.status === "ruled_out" || a.status === "skipped";
    const focus = state.ui.pickerFocus === a.key;
    const m = L.marker([a.lat, a.lon], {
      pane: "picks", pmIgnore: true,
      icon: L.divIcon({ className: "alt-icon", iconSize: [0, 0], html: `<div class="alt ${no ? "no" : ""} ${focus ? "focus" : ""}"></div><div class="altlab ${no ? "no" : ""}">${a.drive_minutes !== undefined ? hm(a.drive_minutes) : clockOf(a.arrive)} · ${escapeHtml(a.name)}</div>` }),
      title: `${a.name}: ${a.reason}`,
    });
    m.on("click", (e) => { L.DomEvent.stop(e); updateUi((u) => { u.pickerFocus = a.key; }); });
    layers.picks.addLayer(m);
  }
}

const STATUS_ICON = { chosen: "✓", ok: "", ruled_out: "🚫", skipped: "⏭" };

function pickerCard(r) {
  const w = r.window;
  const night = r.type === "overnight";
  const focus = r.alternatives.find((a) => a.key === state.ui.pickerFocus) || r.alternatives[0];
  const lines = r.alternatives.map((a) => {
    const no = a.status === "ruled_out" || a.status === "skipped";
    const cls = ["cand", a.status === "chosen" ? "chosen on" : "", no ? "no" : "", a.key === focus.key ? "focus" : ""].join(" ");
    const have = (night ? [a.lodging && `${a.lodging} lodging`, a.food && `${a.food} food`] : [a.food && `${a.food} food`, a.fuel && `${a.fuel} fuel`]).filter(Boolean).join(" · ");
    const icon = a.pinned ? "📌" : STATUS_ICON[a.status];
    const road = a.kind === "exit" && a.ref ? ` · Exit ${escapeHtml(a.ref)}` : a.road ? ` · ${escapeHtml(a.road)}` : "";
    const when = night ? hm(a.drive_minutes) : clockOf(a.arrive);
    return `<button class="${cls}" data-alt="${a.key}"><span>${icon}</span><span>${escapeHtml(a.name)}${road}<small>${escapeHtml(a.reason)}${have && !no ? ` · ${have}` : ""}</small></span><span class="when">${when}</span></button>`;
  }).join("");
  const name = escapeHtml(focus.name);
  const pinWord = night ? "Pin this night at" : "Pin";
  let acts;
  if (focus.status === "chosen") {
    acts = `<button class="btn sm ${r.pinned ? "on" : "primary"}" data-act="pin">📌 ${r.pinned ? "Unpin" : pinWord} ${name}</button>` +
      `<button class="btn sm quiet" data-act="skip">Skip ${name} on this trip</button>`;
  } else if (focus.status === "skipped") {
    acts = `<button class="btn sm" data-act="unskip">Stop skipping ${name}</button>`;
  } else {
    acts = `<button class="btn sm primary" data-act="use">${night ? "Stay at" : "Use"} ${name}${night ? " instead" : ""}${focus.status === "ruled_out" ? " anyway" : ""}</button>` +
      `<button class="btn sm quiet" data-act="skip">Skip ${name} on this trip</button>`;
  }
  const merged = r.refuel && r.type !== "fuel" ? " + ⛽ fuel" : "";
  const title = `${STOP_GLYPH[r.type]} ${STOP_NAME[r.type]}${merged} at ${clockOf(r.arrive)} · day ${r.day}`;
  let explain;
  if (night) explain = `Places with 2 or more lodgings that could end day ${r.day}, each judged with the nights before and after fixed: that day's driving and the next. Times on the right are that day's driving.`;
  else if (w.meal) explain = `${w.meal[0].toUpperCase() + w.meal.slice(1)} window ${clockOf(w.earliest_clock)}–${clockOf(w.latest_clock)} (mile ${miles(w.earliest_mile)}–${miles(w.latest_mile)} at this pace). Times are arrivals; dashed ones are ruled out.`;
  else explain = `Window ${clockOf(w.earliest_clock)}–${clockOf(w.latest_clock)} (mile ${miles(w.earliest_mile)}–${miles(w.latest_mile)}), never after ${clockOf(w.hard_clock)}. Times are arrivals; dashed ones are ruled out.`;
  return `<div class="pop picker">
    <h5>${title}</h5>
    <div class="m">${explain}${r.fuel_note ? ` <b>${escapeHtml(r.fuel_note[0].toUpperCase() + r.fuel_note.slice(1))}.</b>` : ""}${r.moved ? ` <b>${escapeHtml(r.moved[0].toUpperCase() + r.moved.slice(1))}.</b>` : ""}</div>
    <div class="cands">${lines}</div>
    <div class="acts">${acts}</div>
    <div class="m">Pinned stops hold; the rest of the day is planned again around them. You can also drag a break marker to another stop.</div>
  </div>`;
}

function wirePicker(el, r) {
  if (!el) return;
  keepClicksInCard(el);
  const focus = () => r.alternatives.find((a) => a.key === state.ui.pickerFocus) || r.alternatives[0];
  el.querySelectorAll("[data-alt]").forEach((b) => b.addEventListener("click", () => updateUi((u) => { u.pickerFocus = b.dataset.alt; })));
  el.querySelector('[data-act="pin"]')?.addEventListener("click", () => togglePin(r.stop_key, r.name, pinKind(r)));
  el.querySelector('[data-act="use"]')?.addEventListener("click", () => { const f = focus(); useStop(f.key, f.name, r.pinned ? r.stop_key : null, pinKind(r)); });
  el.querySelector('[data-act="skip"]')?.addEventListener("click", () => {
    const f = focus();
    skipStop(f.key, f.name);
    if (f.key === r.stop_key) updateUi((u) => { u.selectedBreak = null; u.pickerFocus = null; });
  });
  el.querySelector('[data-act="unskip"]')?.addEventListener("click", () => unskipStop(focus().key));
}

// ---------- cards (popups) ----------

let cardKey = null; // what the open card shows, e.g. "wp:abc"

// Rebuild the card unless the user is typing in it and it still shows the
// same thing (a route arriving must not wipe a half-typed name).
function setCard(key, latlng, html, wire) {
  const typing = map.hasLayer(popup) && popup.getElement()?.contains(document.activeElement) && cardKey === key;
  popup.setLatLng(latlng);
  if (!typing) {
    popup.setContent(html);
    cardKey = key;
  }
  if (!map.hasLayer(popup)) popup.openOn(map);
  if (!typing) wire(popup.getElement());
}

function renderCard() {
  const { selected, selectedZone, selectedStop, selectedBreak } = state.ui;
  if (selectedBreak) {
    const r = breakRow(selectedBreak);
    if (!r) return state.stopsLoading ? undefined : map.closePopup(popup);
    setCard(`break:${r.stop_key}:${state.ui.pickerFocus}:${r.arrive}:${r.pinned}`, [r.lat, r.lon], pickerCard(r), (el) => wirePicker(el, r));
  } else if (selectedStop) {
    const c = state.stops?.candidates.find((x) => x.key === selectedStop);
    if (!c) return map.closePopup(popup);
    const b = state.trip.breaks;
    setCard(`stop:${c.key}:${b.pins.length}:${b.skips.length}`, [c.lat, c.lon], stopCard(c), (el) => wireStopCard(el, c));
  } else if (selected) {
    const i = state.trip.waypoints.findIndex((w) => w.id === selected);
    if (i < 0) return map.closePopup(popup);
    const wp = state.trip.waypoints[i];
    setCard(`wp:${wp.id}`, [wp.lat, wp.lon], waypointCard(wp, i), (el) => wireWaypointCard(el, wp));
  } else if (selectedZone) {
    const zone = state.trip.zones.find((z) => z.id === selectedZone);
    const entry = zoneLayers.get(selectedZone);
    if (!zone || !entry) return map.closePopup(popup);
    const b = entry.layer.getBounds();
    setCard(`zone:${zone.id}`, [b.getNorth(), b.getCenter().lng], zoneCard(zone), (el) => wireZoneCard(el, zone));
  } else if (map.hasLayer(popup)) {
    map.closePopup(popup);
  }
}

function waypointMile(wp) {
  const r = state.route;
  const pos = r?.waypoint_positions?.[wp.id];
  if (pos === undefined) return null;
  return r.cumulative_miles?.[pos] ?? null;
}

function waypointCard(wp, i) {
  const n = state.trip.waypoints.length;
  const fixed = i === 0 || i === n - 1;
  const type = fixed ? null : wp.type;
  const seg = ["through", "stop", "overnight"].map((t) => {
    const label = { through: "◇ Through", stop: "📍 Stop", overnight: "🛏 Overnight" }[t];
    return `<button data-type="${t}" class="${type === t ? "on" : ""}" ${fixed ? "disabled" : ""}>${label}</button>`;
  }).join("");
  let detail = "";
  if (fixed) {
    detail = `<div class="m">${i === 0 ? "Start" : "End"} of the trip. The first and last waypoints are always where the trip starts and ends; drag rows in the Waypoints tab to change that.</div>`;
  } else if (type === "stop") {
    detail = `<div class="kv"><span>Stay</span><span><input class="fld num" type="number" min="0" step="5" name="minutes" value="${wp.minutes}"> min</span></div>
      <div class="m">The leg ends here. The planner will add this time to the day (phase 3).</div>`;
  } else if (type === "overnight") {
    detail = `<div class="kv"><span>Nights</span><span class="stepper"><button class="btn sm" data-nights="-1">−</button><b>${wp.nights}</b><button class="btn sm" data-nights="1">＋</button></span></div>
      <div class="m">The day ends here. Nights are stored for phase 4.</div>`;
  } else {
    detail = `<div class="m">The route passes here without stopping. It does not start a new leg.</div>`;
  }
  const mile = waypointMile(wp);
  return `<div class="pop">
    <h5><span class="wpd">${letter(i)}</span><input class="fld" name="name" value="${escapeHtml(wp.name)}" placeholder="Name this waypoint" style="flex:1"></h5>
    <span class="seg">${seg}</span>
    ${detail}
    <div class="m">${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}${mile !== null ? ` · mile ${miles(mile)}` : ""}</div>
    <div class="acts"><button class="btn sm danger" data-act="remove">✕ Remove</button></div>
  </div>`;
}

// Card buttons re-render the card, which detaches the clicked button before
// the click reaches the map. Leaflet then cannot tell it came from the popup
// and closes it, so clicks inside the card stop here.
function keepClicksInCard(el) {
  if (el._keepsClicks) return;
  L.DomEvent.disableClickPropagation(el);
  el.addEventListener("click", (e) => e.stopPropagation());
  el._keepsClicks = true;
}

function wireWaypointCard(el, wp) {
  if (!el) return;
  keepClicksInCard(el);
  el.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => setWaypoint(wp.id, { type: b.dataset.type })));
  el.querySelector('[name="name"]')?.addEventListener("change", (e) => setWaypoint(wp.id, { name: e.target.value.trim() }));
  el.querySelector('[name="name"]')?.addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  el.querySelector('[name="minutes"]')?.addEventListener("change", (e) => setWaypoint(wp.id, { minutes: Math.max(0, parseInt(e.target.value, 10) || 0) }));
  el.querySelectorAll("[data-nights]").forEach((b) =>
    b.addEventListener("click", () => setWaypoint(wp.id, { nights: Math.max(1, wp.nights + parseInt(b.dataset.nights, 10)) })));
  el.querySelector('[data-act="remove"]')?.addEventListener("click", () => removeWaypoint(wp.id));
}

function zoneCard(zone) {
  const types = ZONE_TYPES.map((t) =>
    `<button class="cand ${zone.type === t.type ? "on" : ""}" data-ztype="${t.type}"><span>${t.icon}</span><span>${t.label}<small>${t.note}</small></span><span>${zone.type === t.type ? "✓" : ""}</span></button>`).join("");
  const editing = state.ui.editingZone === zone.id;
  return `<div class="pop">
    <h5>${zoneType(zone.type).icon} <input class="fld" name="zname" value="${escapeHtml(zone.name)}" placeholder="Name this zone" style="flex:1"></h5>
    <div class="m">${zone.shape === "rectangle" ? "Box" : "Polygon"} · ${zoneSize(zone)}</div>
    <div class="cands">${types}</div>
    <div class="m">${escapeHtml((state.stops?.plan?.zone_effects?.[zone.id] || []).join(" · ") || (zone.enabled ? "" : "Off for this trip."))}</div>
    <div class="optrow">Zone is on for this trip <button class="tg ${zone.enabled ? "on" : ""}" data-act="toggle" aria-label="Zone on"></button></div>
    <div class="optrow">Keep it in <span class="seg"><button data-home="library" class="${zone.lib ? "on" : ""}" title="Shared by every trip; each trip switches it on or off">📚 The library</button><button data-home="trip" class="${zone.lib ? "" : "on"}" title="Only in this trip's file">This trip only</button></span></div>
    <div class="acts">
      <button class="btn sm ${editing ? "on" : ""}" data-act="edit">${editing ? "✓ Done editing" : "✎ Edit shape"}</button>
      <button class="btn sm danger" data-act="delete">✕ Delete</button>
    </div>
  </div>`;
}

function wireZoneCard(el, zone) {
  if (!el) return;
  keepClicksInCard(el);
  el.querySelectorAll("[data-ztype]").forEach((b) => b.addEventListener("click", () => setZone(zone.id, { type: b.dataset.ztype })));
  el.querySelector('[name="zname"]')?.addEventListener("change", (e) => setZone(zone.id, { name: e.target.value.trim() }));
  el.querySelector('[name="zname"]')?.addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  el.querySelector('[data-act="toggle"]')?.addEventListener("click", () => setZone(zone.id, { enabled: !zone.enabled }));
  el.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => setZoneHome(zone.id, b.dataset.home)));
  el.querySelector('[data-act="edit"]')?.addEventListener("click", () => toggleZoneEdit(zone.id));
  el.querySelector('[data-act="delete"]')?.addEventListener("click", () => removeZone(zone.id));
}

export function toggleZoneEdit(id) {
  updateUi((u) => { u.editingZone = u.editingZone === id ? null : id; u.selectedZone = id; u.selected = null; });
}

// ---------- right-click menu ----------

const menuEl = () => document.getElementById("ctx-menu");

function setUpContextMenu() {
  map.on("contextmenu", showMenu);
  map.on("movestart zoomstart", hideMenu);
  document.addEventListener("mousedown", (e) => { if (!menuEl().contains(e.target)) hideMenu(); });
  menuEl().addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const { lat, lng } = menuEl()._latlng;
    hideMenu();
    ({
      stop: () => addMiddle(lat, lng, "stop"),
      thru: () => addThrough(lat, lng),
      night: () => addMiddle(lat, lng, "overnight"),
      start: () => makeStart(lat, lng),
      end: () => makeEnd(lat, lng),
      zone: () => drawZoneFrom(L.latLng(lat, lng)),
      copy: () => navigator.clipboard?.writeText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`),
    })[b.dataset.act]?.();
  });
}

function showMenu(e) {
  L.DomEvent.stop(e);
  const el = menuEl();
  el._latlng = e.latlng;
  const { lat, lng } = e.latlng;
  const n = state.trip.waypoints.length;
  el.innerHTML = `<div class="hd">${lat.toFixed(5)}, ${lng.toFixed(5)} · right-click</div>
    <button class="mi" data-act="stop"><span class="g">📍</span>Add a stop here</button>
    <button class="mi" data-act="thru"><span class="g">◇</span>Route through here</button>
    <button class="mi" data-act="night"><span class="g">🛏</span>Stay overnight here</button>
    <button class="mi" data-act="start"><span class="g">🏁</span>Start the trip here${n ? "<small>new A</small>" : ""}</button>
    <button class="mi" data-act="end"><span class="g">🏁</span>End the trip here${n ? `<small>new ${letter(n)}</small>` : ""}</button><hr>
    <button class="mi" data-act="zone"><span class="g">▭</span>Draw a zone from here</button><hr>
    <button class="mi" data-act="copy"><span class="g">📋</span>Copy coordinates<small>${lat.toFixed(3)}, ${lng.toFixed(3)}</small></button>`;
  el.hidden = false;
  const { clientX, clientY } = e.originalEvent;
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.min(clientX + 4, window.innerWidth - w - 8)}px`;
  el.style.top = `${Math.min(clientY + 4, window.innerHeight - h - 8)}px`;
}

function hideMenu() {
  const el = menuEl();
  if (el) el.hidden = true;
}
