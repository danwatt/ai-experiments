// The current trip, kept in the browser and saved to localStorage.
//
//   trip   what the user made: waypoints, zones, options. Saved.
//   route  the last answer from POST /api/route, or null.
//   error  the last route error ({code, message, zone_id, waypoint_id}), or null.
//   stops  the last answer from POST /api/plan for that route: candidate
//          stops with detours, seasonal-closure warnings, and the break plan
//          (`stops.plan`: rows with clock times, days, due times, warnings).
//          null until it arrives (it takes a few seconds the first time, so
//          the route is shown first).
//   ui     selection, active tab and tool. Not saved (except showStops).
//   file   which saved trip this is: {id, saved}. `saved` is what the file held
//          when it was last loaded or saved; the trip is "unsaved" while its
//          file form differs from that (phase 5). id is null for a trip that
//          was never saved.
//   library the shared zone library, {zones, loaded}. Library zones are merged
//          into trip.zones (each marked `lib: true`, switched on or off for
//          this trip); the file form splits them out again (tripToFile).
//   defaults the settings a new trip starts from, as the server keeps them.
//
// The trip's `breaks` (settings, meals, fuel, days, pins, skips) only change
// the choice among candidates the server already has, so changing them
// re-plans without a new route: updatePlan() instead of updateTrip(). So do
// zones other than avoid zones (updateStopZones()).
//
// Every change goes through update(); listeners re-render and the route is
// asked for again when the trip changed.

const STORAGE_KEY = "road-trip-planner.trip.v1";

// Used only until the server's defaults arrive (and without them).
function emptyTripBuiltIn() {
  return emptyTrip(null);
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8);

// The agreed defaults (PLAN.md, Decisions): a break every 2 h or 150 mi,
// 15 min long, landing at 75-100 % of the interval, never past 110 %, at most
// 5 min off the route each way.
export const STOP_ORDER = ["rest_area", "service_plaza", "services", "any"];
export const DEFAULT_BREAKS = {
  every_minutes: 120, every_miles: 150, minutes: 15, window_start: 0.75, window_end: 1.0, hard_max: 1.1, max_detour_each_way: 5,
  stop_order: STOP_ORDER,
};

// Phase 4 (PLAN.md, Decisions): lunch 11:30-13:30 for 45 min, dinner
// 17:30-19:30 for 60 min, any food; fuel every 300 of 400 mi and a fill-up at
// each overnight; 8 h of driving a day, from 08:00, arriving by 19:00.
export const DEFAULT_MEALS = {
  lunch: { on: true, start: "11:30", end: "13:30", minutes: 45 },
  dinner: { on: true, start: "17:30", end: "19:30", minutes: 60 },
  food: "all",
  resets_break_clock: true,
};
export const DEFAULT_FUEL = { on: true, range_miles: 400, refuel_after: 0.75, fill_at_overnight: true, minutes: 10, merge_minutes: 20 };
export const DEFAULT_DAYS = { start: "08:00", driving_minutes: 480, arrive_by: "19:00", auto_overnights: true, min_lodging: 2, stop_at_sunset: false };
export const DEFAULT_LODGING = { brands: [], rule: "prefer" };
export const DEFAULT_OPTIONS = { avoid_tolls: false, avoid_ferries: false, avoid_unpaved: false, alternates: 2 };

export function ensureBreaks(trip) {
  trip.breaks = trip.breaks || {};
  trip.pace = trip.pace || 1.05;
  trip.search_miles = trip.search_miles || 2;
  trip.options = { ...DEFAULT_OPTIONS, ...(trip.options || {}) };
  trip.breaks.lodging = { ...DEFAULT_LODGING, ...(trip.breaks.lodging || {}) };
  if (trip.breaks.warn_closures === undefined) trip.breaks.warn_closures = true;
  trip.breaks.settings = { ...DEFAULT_BREAKS, ...(trip.breaks.settings || {}) };
  const m = trip.breaks.meals || {};
  trip.breaks.meals = { ...DEFAULT_MEALS, ...m, lunch: { ...DEFAULT_MEALS.lunch, ...(m.lunch || {}) }, dinner: { ...DEFAULT_MEALS.dinner, ...(m.dinner || {}) } };
  trip.breaks.fuel = { ...DEFAULT_FUEL, ...(trip.breaks.fuel || {}) };
  trip.breaks.days = { ...DEFAULT_DAYS, ...(trip.breaks.days || {}) };
  trip.breaks.pins = trip.breaks.pins || [];
  trip.breaks.skips = trip.breaks.skips || [];
  return trip;
}

// A new trip: no places, and the settings from the defaults (the server's
// trips/defaults.json once it has arrived, else the built-in ones).
export function emptyTrip(defaults = state?.defaults) {
  const d = structuredClone(defaults || {});
  const days = { ...DEFAULT_DAYS, ...(d.breaks?.days || {}) };
  const tomorrow = new Date(Date.now() + 86400000);
  const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  return ensureBreaks({
    name: "New trip", depart: `${date}T${days.start}`, pace: d.pace, search_miles: d.search_miles, options: d.options,
    waypoints: [], zones: [], breaks: { ...(d.breaks || {}), pins: [], skips: [] },
  });
}

// ---------- the trip as a file ----------

const FILE_VERSION = 1;

// state.trip -> the trip file (what PUT /api/trips/{id} takes). Library zones
// are not copied: the file lists the ones switched on.
export function tripToFile(trip, { summary = true } = {}) {
  ensureBreaks(trip);
  const own = trip.zones.filter((z) => !z.lib).map(({ lib, ...z }) => z);
  const out = {
    version: FILE_VERSION, name: trip.name, depart: trip.depart || null, pace: trip.pace, search_miles: trip.search_miles,
    options: trip.options, waypoints: trip.waypoints, zones: own,
    library_on: trip.zones.filter((z) => z.lib && z.enabled).map((z) => z.id), breaks: trip.breaks,
  };
  if (summary) out.summary = tripSummary();
  return out;
}

function tripSummary() {
  const r = state.route, plan = state.stops?.plan;
  if (!r) return null;
  return { miles: Math.round(r.total.miles * 10) / 10, driving_minutes: Math.round(r.total.minutes), days: plan ? plan.days.length : null, arrive: plan ? plan.summary.arrive : null };
}

// The part of the file form that decides "unsaved changes": everything but the summary.
const fingerprint = (trip) => JSON.stringify(tripToFile(trip, { summary: false }));

// A trip file -> state.trip. Library zones are put together with the file's
// switches; library zones the file names but the library no longer has are
// reported in `missing`.
export function tripFromFile(doc, library = state.library.zones) {
  const trip = ensureBreaks({
    name: doc.name, depart: doc.depart, pace: doc.pace, search_miles: doc.search_miles, options: doc.options,
    waypoints: doc.waypoints, zones: doc.zones || [], breaks: doc.breaks,
  });
  const on = new Set(doc.library_on || []);
  trip.zones = [...trip.zones, ...library.map((z) => ({ ...z, lib: true, enabled: on.has(z.id) }))];
  trip.missingLibrary = [...on].filter((id) => !library.some((z) => z.id === id));
  return trip;
}

// Put the library's zones into the trip: their shape, name and type come from
// the library, their switch from the trip (off when the trip has not seen
// them). A library zone the library no longer has leaves the trip.
export function mergeLibrary(trip, library) {
  const mine = new Map(trip.zones.filter((z) => z.lib).map((z) => [z.id, z]));
  const merged = library.map((z) => ({ ...z, lib: true, enabled: mine.get(z.id)?.enabled ?? false }));
  const before = JSON.stringify(trip.zones.filter((z) => z.lib));
  trip.zones = [...trip.zones.filter((z) => !z.lib), ...merged];
  return JSON.stringify(merged) !== before;
}

// The working draft: kept in localStorage so a reload keeps unsaved work.
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      const trip = draft.trip || draft; // the first version kept just the trip
      if (Array.isArray(trip.waypoints) && Array.isArray(trip.zones)) return { trip: ensureBreaks(trip), file: draft.file || { id: null, saved: null } };
    }
  } catch (e) {
    console.warn("could not read the saved trip", e);
  }
  return null;
}

function save(trip) {
  state.file.dirty = state.file.saved === null ? trip.waypoints.length > 0 : fingerprint(trip) !== state.file.saved;
  state.rev++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trip, file: { id: state.file.id, saved: state.file.saved } }));
  } catch (e) {
    console.warn("could not save the trip", e);
  }
}

// After the trip was written to, or read from, a file.
export function markSaved(id, trip = state.trip) {
  state.file.id = id;
  state.file.saved = fingerprint(trip);
  state.file.dirty = false;
  state.rev++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trip, file: { id, saved: state.file.saved } }));
  } catch { /* the draft just is not kept */ }
  notify("file");
}

// True when this browser has kept a working trip before (so a first visit can start from an example).
export function hasDraft() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// A per-viewer preference, kept apart from the trip.
const SHOW_STOPS_KEY = "road-trip-planner.show-candidate-stops";
function loadShowStops() {
  try {
    return localStorage.getItem(SHOW_STOPS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setShowStops(on) {
  try {
    localStorage.setItem(SHOW_STOPS_KEY, on ? "1" : "0");
  } catch { /* the preference just is not kept */ }
  updateUi((u) => { u.showStops = on; if (!on) u.selectedStop = null; });
}

// Same for the side panel and the map labels.
const SIDE_KEY = "road-trip-planner.side-open";
const LABELS_KEY = "road-trip-planner.map-labels";
const loadFlag = (key) => {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
};

export function setSideOpen(on) {
  try { localStorage.setItem(SIDE_KEY, on ? "1" : "0"); } catch { /* not kept */ }
  updateUi((u) => { u.sideOpen = on; });
}

export function setShowLabels(on) {
  try { localStorage.setItem(LABELS_KEY, on ? "1" : "0"); } catch { /* not kept */ }
  updateUi((u) => { u.showLabels = on; });
}

const draft = load();

export const state = {
  trip: draft ? draft.trip : emptyTripBuiltIn(),
  file: { id: draft ? draft.file.id : null, saved: draft ? draft.file.saved : null, dirty: false },
  rev: 0, // counts changes to the trip, so answers about it (zone what-ifs) can tell when they are stale
  library: { zones: [], loaded: false, seeded: false },
  defaults: null,
  files: { trips: [], examples: [], loaded: false },
  route: null,
  error: null,
  routing: false,
  stops: null,
  stopsLoading: false,
  stopsError: null,
  ui: {
    tab: "itinerary", tool: "pan", selected: null, selectedZone: null, selectedStop: null, editingZone: null, drag: null, showStops: loadShowStops(), sideOpen: loadFlag(SIDE_KEY), showLabels: loadFlag(LABELS_KEY),
    selectedBreak: null, // stop_key of the planned break whose picker is open
    pickerFocus: null, // stop_key of the line chosen inside the picker
    day: 1, // the day the day strip shows
    view: "map", // "map", "settings" or "export": the page shown below the toolbar
    settingsScope: "trip", // on the settings page: "trip" or "defaults"
    whatIf: {}, // zone id -> {text, rev}: what switching an off zone on would do
  },
};
state.file.dirty = draft ? (state.file.saved === null ? state.trip.waypoints.length > 0 : fingerprint(state.trip) !== state.file.saved) : false;

const listeners = [];
export const subscribe = (fn) => listeners.push(fn);
const notify = (what) => listeners.forEach((fn) => fn(what));

// Change the trip. `fn` edits state.trip in place.
export function updateTrip(fn) {
  fn(state.trip);
  save(state.trip);
  notify("trip");
  scheduleRoute();
}

// Change only the UI state (no saving, no routing).
export function updateUi(fn) {
  fn(state.ui);
  notify("ui");
}

// Change only the break settings, pins or skips. `fn` edits state.trip.breaks
// in place. The route stays; the server re-plans from its cached candidates.
export function updatePlan(fn) {
  fn(ensureBreaks(state.trip).breaks);
  save(state.trip);
  notify("trip");
  if (state.route) fetchStops(state.trip);
}

// Change zones that do not change the route (anything but an avoid zone, on
// or off). `fn` edits state.trip in place; the server re-plans from its cache.
export function updateStopZones(fn) {
  fn(state.trip);
  save(state.trip);
  notify("trip");
  if (state.route) fetchStops(state.trip);
}

// The trip changed in a way that needs no new route or plan (its name): save the
// draft, re-check "unsaved", tell the listeners.
export function touchTrip() {
  save(state.trip);
  notify("trip");
}

export function replaceTrip(trip, { id = null, saved = false } = {}) {
  state.trip = ensureBreaks(trip);
  state.file.id = id;
  state.file.saved = saved ? fingerprint(state.trip) : null;
  state.ui.whatIf = {};
  state.ui.day = 1;
  state.route = null;
  state.error = null;
  state.stops = null;
  state.ui.selectedStop = null;
  state.ui.selected = null;
  state.ui.selectedZone = null;
  state.ui.editingZone = null;
  save(trip);
  notify("trip");
  scheduleRoute({ fit: true });
}

// ---------- routing ----------

let timer = null;
let seq = 0;
let fitNext = false;

export function scheduleRoute({ fit = false } = {}) {
  fitNext = fitNext || fit;
  clearTimeout(timer);
  timer = setTimeout(fetchRoute, 120);
}

export function planBody(trip) {
  const b = ensureBreaks(trip).breaks;
  const { start, ...days } = b.days;
  return {
    ...requestBody(trip), breaks: b.settings, meals: b.meals, fuel: b.fuel, days, day_start: start,
    lodging: b.lodging, warn_closures: b.warn_closures, pins: b.pins, skips: b.skips,
  };
}

export function requestBody(trip) {
  return {
    waypoints: trip.waypoints.map(({ id, lat, lon, name, type, minutes, nights }) => ({ id, lat, lon, name, type, minutes, nights })),
    zones: trip.zones,
    options: trip.options,
    depart: trip.depart || null,
    pace: trip.pace || 1.05,
    search_miles: trip.search_miles || 2,
  };
}

async function fetchRoute() {
  const trip = state.trip;
  const mine = ++seq;
  if (trip.waypoints.length < 2) {
    state.route = null;
    state.error = null;
    clearStops();
    notify("route");
    return;
  }
  state.routing = true;
  notify("routing");
  const started = performance.now();
  let route = null, error = null;
  try {
    const resp = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(trip)),
    });
    const data = await resp.json();
    if (resp.ok) route = data;
    else if (data.error) error = data.error;
    else error = { code: "bad_request", message: JSON.stringify(data.detail || data) };
  } catch (e) {
    error = { code: "network", message: `The planner API is not reachable: ${e.message}` };
  }
  if (mine !== seq) return; // a newer request is on its way
  state.routing = false;
  state.error = error;
  if (route) {
    route.round_trip_ms = Math.round(performance.now() - started);
    // Straight-line sums along the shape, scaled to Valhalla's total so the
    // last waypoint's mile matches the trip length.
    const cum = cumulativeMiles(route.geometry.coordinates);
    const scale = cum.at(-1) > 0 ? route.total.miles / cum.at(-1) : 1;
    route.cumulative_miles = cum.map((m) => m * scale);
    state.route = route;
  } else if (error) {
    state.route = null;
    clearStops();
  }
  const fit = fitNext;
  fitNext = false;
  notify(fit ? "route-fit" : "route");
  if (route) fetchStops(trip);
}

// ---------- candidate stops and closures ----------

let stopsSeq = 0;

function clearStops() {
  stopsSeq++;
  state.stops = null;
  state.stopsLoading = false;
  state.stopsError = null;
  state.ui.selectedStop = null;
  state.ui.selectedBreak = null;
}

// Asked after the route has been drawn. The previous candidates stay on the
// map (dimmed by the "checking" note) until the new ones arrive.
async function fetchStops(trip) {
  const mine = ++stopsSeq;
  state.stopsLoading = true;
  state.stopsError = null;
  notify("stops");
  let data = null, error = null;
  try {
    const resp = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planBody(trip)),
    });
    const body = await resp.json();
    if (resp.ok) data = body;
    else error = body.error || { code: "bad_request", message: JSON.stringify(body.detail || body) };
  } catch (e) {
    error = { code: "network", message: `The planner API is not reachable: ${e.message}` };
  }
  if (mine !== stopsSeq) return;
  state.stopsLoading = false;
  state.stopsError = error;
  if (data) {
    for (const c of data.candidates) c.key = `${c.id}@${c.mile}`;
    state.stops = data;
    const sel = state.ui.selectedStop;
    if (sel && !data.candidates.some((c) => c.key === sel)) state.ui.selectedStop = null;
    const brk = state.ui.selectedBreak;
    if (brk && !data.plan.rows.some((r) => r.stop_key === brk)) state.ui.selectedBreak = null;
    const days = data.plan.days.length;
    if (state.ui.day > days) state.ui.day = 1;
    forgetDropped(data.plan.dropped);
  } else {
    state.stops = null;
  }
  notify("stops");
}

// Pins and skips whose place is no longer on the route: the plan says so in
// its warnings, and they leave the trip so they do not come back.
function forgetDropped(dropped) {
  if (!dropped?.length) return;
  const gone = new Set(dropped.map((d) => d.key));
  const b = state.trip.breaks;
  b.pins = b.pins.filter((p) => !gone.has(p.key));
  b.skips = b.skips.filter((p) => !gone.has(p.key));
  save(state.trip);
}

// Miles from the start at every route coordinate.
function cumulativeMiles(coords) {
  const out = [0];
  const rad = Math.PI / 180;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1], [lon2, lat2] = coords[i];
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    out.push(out[i - 1] + 2 * 3958.8 * Math.asin(Math.sqrt(h)));
  }
  return out;
}
