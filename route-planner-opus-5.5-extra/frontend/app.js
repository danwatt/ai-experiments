// Entry point: wires the map, the sidebar, the toolbar and the status bar to
// the trip state, and asks for the first route.

import { state, subscribe, updateUi, replaceTrip, scheduleRoute, hasDraft, tripFromFile } from "./state.js";
import { initMap, renderMap, fitTrip, refreshMapSize } from "./map.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { renderDayStrip } from "./timeline.js";
import { hm, miles, escapeHtml } from "./edits.js";
import { initPicker } from "./trips.js";
import { loadLibrary } from "./library.js";
import { adoptDefaults, renderSettings, loadSettingsData } from "./settings.js";
import { initExport, renderExport, showExport } from "./export.js";
import { initHere } from "./here.js";

const $ = (id) => document.getElementById(id);
let dragHint = null;

let shownView = "map";

function render(what) {
  const view = state.ui.view;
  $("view-map").hidden = view !== "map";
  $("btn-settings").classList.toggle("on", view === "settings");
  $("btn-export").classList.toggle("on", view === "export");
  if (view === "map") {
    renderMap(what);
    renderSidebar();
    renderDayStrip();
    if (shownView !== "map") refreshMapSize();
  }
  if (view === "settings") {
    if (shownView !== "settings") loadSettingsData();
    requestAnimationFrame(renderSettings);
  } else $("view-settings").hidden = true;
  if (view === "export") renderExport();
  else $("view-export").hidden = true;
  shownView = view;
  renderBanner();
  renderStatus();
}

function renderBanner() {
  const el = $("banner");
  const err = state.error;
  if (!err) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "banner";
  el.innerHTML = `<span>⚠</span><span>${escapeHtml(err.message)}</span>`;
}

function renderStatus() {
  const r = state.route;
  const main = $("status-main"), msg = $("status-msg"), vh = $("status-valhalla");
  const plan = state.stops?.plan;
  if (dragHint) {
    main.innerHTML = dragHint;
  } else if (r && plan) {
    const s = plan.summary;
    main.innerHTML = `<b>${miles(r.total.miles)} mi</b> · ${hm(r.total.minutes)} driving · ${s.breaks} break${s.breaks === 1 ? "" : "s"}, ${hm(s.stopped_minutes)} stopped · ` +
      `arrive ${s.arrive.slice(11, 16)}${plan.days.length > 1 ? ` on day ${plan.days.length}` : ""}`;
  } else if (r) {
    main.innerHTML = `<b>${miles(r.total.miles)} mi</b> · ${hm(r.total.minutes)} driving · ${r.legs.length} leg${r.legs.length === 1 ? "" : "s"}: ` +
      r.legs.map((l) => `${miles(l.miles)} mi ${hm(l.minutes)}`).join(" · ");
  } else if (state.trip.waypoints.length < 2) {
    main.textContent = "Add at least two waypoints to get a route";
  } else {
    main.textContent = state.routing ? "Routing…" : "No route";
  }
  const closure = (state.stops?.closures || [])[0]; // the worst one: closed, then check, then open
  if (state.error) msg.innerHTML = `<span class="bad">⚠ ${escapeHtml(state.error.code.replaceAll("_", " "))}</span>`;
  else if (closure && closure.level !== "open") {
    msg.innerHTML = `<span class="${closure.level === "closed" ? "bad" : "warn"}">${closure.level === "closed" ? "⛔" : "⚠"} ${escapeHtml(closure.message)}</span>`;
  } else if (r?.warnings.length) msg.innerHTML = `<span class="warn">${escapeHtml(r.warnings[0])}</span>`;
  else if (closure) msg.innerHTML = `<span>ℹ ${escapeHtml(closure.message)}</span>`;
  else msg.textContent = "";
  const stops = state.stopsLoading ? " · planning …" : state.stops ? ` · ${state.stops.candidates.length} places within 2 mi · planned in ${state.stops.plan.plan_ms} ms` : "";
  vh.innerHTML = r ? `Valhalla <span class="dot-ok">●</span> ${r.valhalla_ms} ms${stops}` : state.routing ? "Valhalla …" : "";
}

async function checkStatus() {
  const el = $("tb-data");
  try {
    const s = await (await fetch("/api/status")).json();
    const v = s.valhalla;
    el.innerHTML = v.up
      ? `<span class="dot-ok">●</span> map data: Colorado · Valhalla ${escapeHtml(v.version || "")}`
      : `<span class="dot-bad">●</span> Valhalla is down`;
  } catch {
    el.innerHTML = `<span class="dot-bad">●</span> API not reachable`;
  }
}

function initToolbar() {
  const toggle = (name) => updateUi((u) => { u.view = u.view === name ? "map" : name; });
  $("btn-settings").addEventListener("click", () => toggle("settings"));
  $("btn-export").addEventListener("click", () => (state.ui.view === "export" ? toggle("export") : showExport()));
}

// The server's defaults and the zone library, then, on a first visit, the Colorado loop to look at.
async function bootstrap() {
  try {
    adoptDefaults(await (await fetch("/api/defaults")).json());
  } catch { /* the built-in defaults stay in use */ }
  const first = !hasDraft();
  await loadLibrary();
  if (first && !state.trip.waypoints.length) {
    try {
      const doc = await (await fetch("/api/examples/colorado-loop")).json();
      replaceTrip(tripFromFile(doc));
    } catch { /* an empty trip is fine */ }
  }
}

initMap((html) => { dragHint = html; renderStatus(); });
window.addEventListener("resize", renderDayStrip);
initSidebar();
initToolbar();
initPicker();
initExport();
initHere();
subscribe(render);
render("trip");
checkStatus();
setInterval(checkStatus, 30000);
scheduleRoute({ fit: true });
if (state.trip.waypoints.length > 1) fitTrip();
bootstrap();
