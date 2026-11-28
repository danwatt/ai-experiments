// The settings page: every rule the planner follows, in cards (design screen 6).
//
// A scope switch picks what is edited: this trip, or the defaults new trips
// start from (trips/defaults.json). Editing the trip re-plans it right away;
// editing the defaults saves them after a short pause and changes no trip.
// Derived limits ("hard limit 2 h 12 at these settings") are spelled out under
// the fields. The compact editors in the sidebar footer edit the same fields.

import { state, updateTrip, updatePlan, updateUi, ensureBreaks, DEFAULT_BREAKS, DEFAULT_MEALS, DEFAULT_FUEL, DEFAULT_DAYS, DEFAULT_LODGING, DEFAULT_OPTIONS, STOP_ORDER } from "./state.js";
import { confirmDialog, flash } from "./dialog.js";
import { escapeHtml, hm } from "./edits.js";

const $ = (id) => document.getElementById(id);

// ---------- reading and writing a setting by its path ----------

const scope = () => state.ui.settingsScope;
const source = () => (scope() === "trip" ? state.trip : state.defaults);
const getIn = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
function setIn(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

let defaultsTimer = null;
function saveDefaultsSoon() {
  clearTimeout(defaultsTimer);
  defaultsTimer = setTimeout(saveDefaults, 600);
}

async function saveDefaults() {
  const d = structuredClone(state.defaults);
  const { pins, skips, ...breaks } = d.breaks;
  try {
    const resp = await fetch("/api/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, breaks }) });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error?.message || JSON.stringify(body.detail || body));
    updateUi((u) => { u.defaultsSaved = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); });
  } catch (e) {
    flash(`Could not save the defaults: ${e.message}`, "bad");
  }
}

export function adoptDefaults(d) {
  state.defaults = ensureBreaks(structuredClone(d));
}

// Set one setting. In the trip it re-plans (a new route for the route-level
// ones, else a re-plan from the candidates the server has); in the defaults it saves.
function set(path, value) {
  if (scope() === "defaults") {
    setIn(state.defaults, path, value);
    saveDefaultsSoon();
    updateUi(() => {});
    return;
  }
  if (path.startsWith("breaks.")) updatePlan((b) => setIn({ breaks: b }, path, value));
  else if (path === "depart") updateTrip((t) => { t.depart = value; });
  else updateTrip((t) => setIn(t, path, value));
}

// ---------- controls ----------

// scale: the file keeps minutes, the page shows hours (1/60); percentages are kept as 0.75 and shown as 75.
function num(path, { step = 1, min = 0, max = 9999, scale = 1, unit = "", offset = 0, cls = "" } = {}) {
  const v = getIn(source(), path);
  const shown = Math.round((v * scale - offset) * 1000) / 1000;
  return `<input class="fld num ${cls}" type="number" data-path="${path}" data-scale="${scale}" data-offset="${offset}" value="${shown}" step="${step}" min="${min}" max="${max}">${unit ? ` ${unit}` : ""}`;
}
const time = (path) => `<input class="fld time" type="time" data-path="${path}" value="${getIn(source(), path) || ""}">`;
const toggle = (path, label) => `<button class="tg ${getIn(source(), path) ? "on" : ""}" data-toggle="${path}" aria-label="${escapeHtml(label)}" aria-pressed="${!!getIn(source(), path)}"></button>`;
const seg = (path, options) => `<span class="seg">${options.map(([v, label]) => `<button data-seg="${path}" data-value="${escapeHtml(JSON.stringify(v))}" class="${getIn(source(), path) === v ? "on" : ""}">${label}</button>`).join("")}</span>`;
const row = (label, ctl, help = "") => `<div class="fr"><span>${label}${help ? `<span class="help">${help}</span>` : ""}</span><span class="ctl">${ctl}</span></div>`;

const miles = (m) => `${Math.round(m)} mi`;

// ---------- cards ----------

function scheduleCard() {
  const isTrip = scope() === "trip";
  const [date, t] = (state.trip.depart || "T").split("T");
  const d = source().breaks.days;
  return `<div class="card"><h4>🕐 Schedule</h4>
    ${isTrip ? row("Depart", `<input class="fld" type="date" data-depart="date" value="${date}"> <input class="fld time" type="time" data-depart="time" value="${t || d.start}">`, "Local time at the start. The date decides each day's sunset and timed road closures.") : row("First day starts at", `<span class="help">the day-start time below; the date is set per trip</span>`)}
    ${row("Start each later day at", time("breaks.days.start"))}
    ${row("Driving per day, at most", num("breaks.days.driving_minutes", { step: 0.5, min: 1, max: 24, scale: 1 / 60, unit: "h" }))}
    ${row("Arrive by", time("breaks.days.arrive_by"))}
    ${row("Stop driving at sunset", toggle("breaks.days.stop_at_sunset", "Stop driving at sunset"), "Off: arriving after dark only shows a warning")}
    ${row("Choose overnights for me", toggle("breaks.days.auto_overnights", "Automatic overnights"), "Off: only the overnights you place on the map")}
    <div class="derived">Both limits are soft. A day may go past <b>${hm(d.driving_minutes)}</b> of driving or arriving after <b>${d.arrive_by}</b> when nothing else works; the plan then warns and says why.</div>
  </div>`;
}

function breaksCard() {
  const s = source().breaks.settings;
  const hard = s.every_minutes * s.hard_max, lo = s.every_minutes * s.window_start, hi = s.every_minutes * s.window_end;
  return `<div class="card"><h4>☕ Breaks</h4>
    <div class="sent">Take a break every ${num("breaks.settings.every_minutes", { step: 5, min: 20, max: 600, unit: "min" })} or ${num("breaks.settings.every_miles", { step: 5, min: 10, max: 600, unit: "mi" })}, whichever comes first, for ${num("breaks.settings.minutes", { step: 5, min: 0, max: 180, unit: "min" })}.</div>
    ${row("Aim for", `${num("breaks.settings.window_start", { step: 5, min: 10, max: 100, scale: 100, unit: "–" })}${num("breaks.settings.window_end", { step: 5, min: 10, max: 150, scale: 100, unit: "%" })}`, "Share of the interval where a stop may land")}
    ${row("Never go past", `+${num("breaks.settings.hard_max", { step: 5, min: 0, max: 100, scale: 100, offset: 100, unit: "%" })}`, `Hard limit: ${hm(hard)} or ${miles(s.every_miles * s.hard_max)} at these settings`)}
    ${scope() === "trip" ? `<div class="fr"><span>Pins and skips<span class="help">Stops you fixed in the picker, and places you ruled out</span></span><span class="ctl">📌 ${state.trip.breaks.pins.length} · ⏭ ${state.trip.breaks.skips.length}
      <button class="btn sm" data-clear="pins" ${state.trip.breaks.pins.length ? "" : "disabled"}>Unpin all</button><button class="btn sm" data-clear="skips" ${state.trip.breaks.skips.length ? "" : "disabled"}>Un-skip all</button></span></div>` : ""}
    <div class="derived">The planner looks for a stop between <b>${hm(lo)}</b> and <b>${hm(hi)}</b> (${miles(s.every_miles * s.window_start)} to ${miles(s.every_miles * s.window_end)}) after the last one, and goes past <b>${hm(hard)}</b> only when nothing fits.</div>
  </div>`;
}

function mealsCard() {
  const m = source().breaks.meals;
  const meal = (n) => row(n[0].toUpperCase() + n.slice(1), `${toggle(`breaks.meals.${n}.on`, n)} ${time(`breaks.meals.${n}.start`)}–${time(`breaks.meals.${n}.end`)} ${num(`breaks.meals.${n}.minutes`, { step: 5, min: 0, max: 240, unit: "min" })}`);
  return `<div class="card"><h4>🍴 Meals</h4>
    ${meal("lunch")}${meal("dinner")}
    ${row("Breakfast", `<span class="seg"><button class="on" disabled>At the hotel</button><button disabled title="Not planned">On the road</button></span>`, "Breakfast is not planned on the road")}
    ${row("A meal resets the break clock", toggle("breaks.meals.resets_break_clock", "A meal resets the break clock"), "Off: the next break still falls due on the old schedule")}
    ${row("Food", seg("breaks.meals.food", [["all", "All"], ["sitdown", "Sit-down"], ["fast", "Fast food"]]))}
    <div class="derived">A meal happens on arrival inside its window, in the local time of the place. Dinner at an overnight you reach by <b>${m.dinner.end}</b> happens there.</div>
  </div>`;
}

function fuelCard() {
  const f = source().breaks.fuel;
  const due = f.range_miles * f.refuel_after;
  return `<div class="card"><h4>⛽ Fuel</h4>
    ${row("Plan fuel stops", toggle("breaks.fuel.on", "Plan fuel"))}
    ${row("Range on a full tank", num("breaks.fuel.range_miles", { step: 10, min: 50, max: 1500, unit: "mi" }))}
    ${row("Refuel when used", num("breaks.fuel.refuel_after", { step: 5, min: 20, max: 100, scale: 100, unit: "%" }), `${miles(due)} at these settings`)}
    ${row("Fill up at each overnight", toggle("breaks.fuel.fill_at_overnight", "Fill up at each overnight"))}
    ${row("A fuel stop on its own takes", num("breaks.fuel.minutes", { step: 5, min: 0, max: 60, unit: "min" }))}
    ${row("Merge fuel into a break or meal within", num("breaks.fuel.merge_minutes", { step: 5, min: 0, max: 120, unit: "min" }), "A fuel stop this close to a break or meal becomes part of it")}
    <div class="derived">Fuel is due by mile <b>${Math.round(due)}</b> after each fill-up, with <b>${miles(f.range_miles - due)}</b> in reserve.</div>
  </div>`;
}

const ORDER_WORDS = { rest_area: "Rest area", service_plaza: "Service plaza", services: "Exit or town with fuel and food", any: "Any exit or town" };

function whereCard() {
  const s = source().breaks.settings;
  const order = s.stop_order || STOP_ORDER;
  return `<div class="card"><h4>📍 Where to stop</h4>
    <div class="ladder" id="ladder">${order.map((k, i) => `<div draggable="true" data-kind="${k}"><span class="h">⠿</span><span class="i">${i + 1}</span><span>${ORDER_WORDS[k]}</span></div>`).join("")}</div>
    <div class="derived">Drag to change which kind of place wins when several are close to the target time. Each step down costs a little (${[4, 4, 8].map((c) => `${c}`).join(", ")} minutes of window), so a rest area 8 minutes early still beats an exit with services on time.</div>
    ${row("Detour, each way, at most", num("breaks.settings.max_detour_each_way", { step: 1, min: 0, max: 60, unit: "min" }), `A place that adds more than ${2 * s.max_detour_each_way} min there and back is over the limit`)}
    ${row("Look this far from the route", num("search_miles", { step: 0.5, min: 0.5, max: 10, unit: "mi" }), "Places farther than this are not candidates. A larger number finds more but slows the first plan.")}
  </div>`;
}

let brandInfo = null; // /api/lodging-brands, fetched once

function lodgingCard() {
  const l = source().breaks.lodging;
  const days = source().breaks.days;
  const share = brandInfo ? Math.round(brandInfo.share * 100) : 45;
  const chips = l.brands.map((b, i) => `<span class="chip acc">${escapeHtml(b)} <button data-brand-del="${i}" aria-label="Remove ${escapeHtml(b)}">✕</button></span>`).join("") || `<span class="dim">no brands chosen: every lodging counts</span>`;
  return `<div class="card"><h4>🛏 Lodging</h4>
    ${row("A place to stay has at least", `${num("breaks.days.min_lodging", { step: 1, min: 1, max: 50, unit: "lodgings" })}`, "Counted at the exit or town, as the places were grouped when they were imported")}
    <div class="fr"><span>Brands<span class="help">A name matches any brand that contains it: “Hampton” finds “Hampton Inn &amp; Suites”.</span></span><span class="ctl"><input class="fld" id="brand-in" list="brand-list" placeholder="Hilton, Marriott…" style="width:130px"><button class="btn sm" id="brand-add">＋ Add</button></span></div>
    <datalist id="brand-list">${(brandInfo?.brands || []).map((b) => `<option value="${escapeHtml(b.brand)}">${b.count}</option>`).join("")}</datalist>
    <div class="brands">${chips}</div>
    ${row("Brand rule", seg("breaks.lodging.rule", [["prefer", "Prefer"], ["only", "Only these"]]), l.rule === "prefer" ? "A place with one of these brands wins close calls" : "Only lodgings with these brands count toward the minimum")}
    <div class="note-warn">Brand tags are patchy: about <b>${share}%</b> of the lodging in the places data has one${brandInfo ? ` (${brandInfo.branded.toLocaleString()} of ${brandInfo.lodging.toLocaleString()})` : ""}. “Only these” can leave a small town with no place to stay; “Prefer” never does.</div>
    <div class="derived">Overnights are chosen among places with at least <b>${days.min_lodging}</b> lodging${days.min_lodging === 1 ? "" : "s"}${l.brands.length && l.rule === "only" ? ` of ${l.brands.map(escapeHtml).join(" or ")}` : ""}.</div>
  </div>`;
}

function roadsCard() {
  const pace = source().pace;
  return `<div class="card"><h4>🛣 Roads</h4>
    ${row("Avoid toll roads", toggle("options.avoid_tolls", "Avoid toll roads"))}
    ${row("Avoid ferries", toggle("options.avoid_ferries", "Avoid ferries"))}
    ${row("Avoid unpaved roads", toggle("options.avoid_unpaved", "Avoid unpaved roads"))}
    ${row("Warn about roads closed for winter", toggle("breaks.warn_closures", "Warn about closures"), "Checked against each trip date; Trail Ridge Road is the usual one")}
    ${row("Alternate routes to show", seg("options.alternates", [[0, "0"], [1, "1"], [2, "2"]]), "Only for trips with two waypoints (a Valhalla limit)")}
    ${row("Pace", `× ${num("pace", { step: 0.05, min: 0.5, max: 2, unit: "" })}`, `Driving times run ${pace >= 1 ? Math.round((pace - 1) * 100) + "% slower" : Math.round((1 - pace) * 100) + "% faster"} than the router's estimate`)}
  </div>`;
}

let status = null; // /api/status

function dataCard() {
  const s = status;
  if (!s) return `<div class="card wide"><h4>🗺 Map data</h4><div class="derived">Reading the status…</div></div>`;
  const v = s.valhalla || {}, p = s.pois || {}, d = s.data || {};
  const tiles = v.tileset_last_modified ? new Date(v.tileset_last_modified * 1000).toISOString().slice(0, 10) : "unknown";
  const c = p.counts?.pois || {};
  const n = (k) => (c[k] || 0).toLocaleString();
  const total = Object.entries(c).filter(([k]) => k !== "place").reduce((a, [, x]) => a + x, 0);
  return `<div class="card wide"><h4>🗺 Map data <span class="help" style="margin-left:6px">read-only</span></h4>
    <div class="svc"><span><b>Routing</b> · Valhalla ${escapeHtml(v.version || "")}</span><span class="${v.up ? "ok-word" : "dot-bad"}">${v.up ? "● running" : "● down"}</span>
      <span class="meta">${escapeHtml(d.region || "unknown region")} · tiles built ${tiles} from OpenStreetMap data of ${escapeHtml(d.osm_date || "unknown date")}${d.pbf_mb ? ` (${d.pbf_mb} MB extract)` : ""}${d.tiles_mb ? ` · ${d.tiles_mb} MB of tiles in data/valhalla` : ""}</span></div>
    <div class="svc"><span><b>Places</b> · pois.sqlite</span><span class="${p.up ? "ok-word" : "dot-bad"}">${p.up ? "● ready" : "● missing"}</span>
      <span class="meta">${p.up ? `built ${escapeHtml(p.built_at || "")} · ${total.toLocaleString()} places: ${n("rest_area")} rest areas, ${n("service_plaza")} service plazas, ${n("exit")} exits, ${n("fuel")} fuel, ${n("food")} food, ${n("lodging")} lodging, ${(p.counts?.places ? Object.values(p.counts.places).reduce((a, b) => a + b, 0) : 0).toLocaleString()} towns and villages` : escapeHtml(p.error || "")}</span></div>
    <div class="svc"><span><b>Basemap</b></span><span class="dim">online tiles</span><span class="meta">The map background needs the internet; routing and places work without it.</span></div>
    <div class="derived">To update, run these on the host (the app container has no access to Docker, on purpose):
      ${(d.commands || []).map((c) => `<div><code>${escapeHtml(c.command)}</code> ${escapeHtml(c.does)}</div>`).join("")}</div>
  </div>`;
}

// ---------- the page ----------

// How many settings differ from the defaults, for the heading.
function leaves(obj, prefix = "") {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return { [prefix]: JSON.stringify(obj) };
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)));
}
function differences() {
  if (!state.defaults) return [];
  const pick = (t) => ({ pace: t.pace, search_miles: t.search_miles, options: t.options, breaks: { ...t.breaks, pins: undefined, skips: undefined } });
  const a = leaves(pick(state.trip)), b = leaves(pick(state.defaults));
  return Object.keys(a).filter((k) => a[k] !== b[k] && !k.endsWith("pins") && !k.endsWith("skips"));
}

export function renderSettings() {
  const el = $("view-settings");
  if (state.ui.view !== "settings") { el.hidden = true; return; }
  el.hidden = false;
  if (!state.defaults) { el.innerHTML = `<div class="empty">Reading the defaults…</div>`; return; }
  const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const keep = active ? { path: active.dataset.path || active.id || active.dataset.depart, start: active.selectionStart, end: active.selectionEnd } : null;
  const diffs = scope() === "trip" ? differences() : [];
  el.innerHTML = `<div class="set-head"><button class="btn quiet" id="set-back">← Back to map</button><h3>Settings</h3>
      <span class="seg"><button data-scope="trip" class="${scope() === "trip" ? "on" : ""}">This trip</button><button data-scope="defaults" class="${scope() === "defaults" ? "on" : ""}">Defaults for new trips</button></span>
      <span class="sub">${scope() === "trip" ? `Changes re-plan “${escapeHtml(state.trip.name || "the trip")}” right away.${diffs.length ? ` ${diffs.length} setting${diffs.length === 1 ? " differs" : "s differ"} from the defaults.` : " Same as the defaults."}` : `Saved to trips/defaults.json${state.ui.defaultsSaved ? ` at ${state.ui.defaultsSaved}` : ""}. They change nothing in the trips you already have.`}</span>
      <span class="grow"></span>
      <button class="btn sm" id="set-reset">${scope() === "trip" ? "Reset this trip to the defaults" : "Reset the defaults to the built-in ones"}</button></div>
    <div class="sgrid">${scheduleCard()}${breaksCard()}${mealsCard()}${fuelCard()}${whereCard()}${lodgingCard()}${roadsCard()}${dataCard()}</div>`;
  wire(el);
  if (keep?.path) {
    const next = el.querySelector(`[data-path="${keep.path}"], [data-depart="${keep.path}"], #${CSS.escape(keep.path)}`);
    if (next) { next.focus(); try { next.setSelectionRange(keep.start, keep.end); } catch { /* number inputs have no selection */ } }
  }
}

function wire(el) {
  el.querySelector("#set-back").addEventListener("click", () => updateUi((u) => { u.view = "map"; }));
  el.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => updateUi((u) => { u.settingsScope = b.dataset.scope; })));
  el.querySelector("#set-reset").addEventListener("click", resetSettings);
  el.querySelectorAll("input[data-path]").forEach((i) => i.addEventListener("change", () => {
    if (!i.value) return;
    if (i.type === "number") {
      let v = parseFloat(i.value);
      if (isNaN(v)) return;
      v = (v + parseFloat(i.dataset.offset)) / parseFloat(i.dataset.scale);
      set(i.dataset.path, Math.round(v * 10000) / 10000);
    } else set(i.dataset.path, i.value);
  }));
  el.querySelectorAll("[data-depart]").forEach((i) => i.addEventListener("change", () => {
    const [d, t] = (state.trip.depart || "T").split("T");
    const date = i.dataset.depart === "date" ? i.value : d, tm = i.dataset.depart === "time" ? i.value : t || "08:00";
    set("depart", date ? `${date}T${tm}` : null);
  }));
  el.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => set(b.dataset.toggle, !getIn(source(), b.dataset.toggle))));
  el.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => set(b.dataset.seg, JSON.parse(b.dataset.value))));
  el.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", () => updatePlan((x) => { x[b.dataset.clear] = []; })));
  wireLadder(el);
  wireBrands(el);
}

function wireLadder(el) {
  const ladder = el.querySelector("#ladder");
  ladder.querySelectorAll("div").forEach((d) => {
    d.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", d.dataset.kind); e.dataTransfer.effectAllowed = "move"; });
    d.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = e.offsetY > d.offsetHeight / 2;
      d.classList.toggle("drop-after", after);
      d.classList.toggle("drop-before", !after);
    });
    d.addEventListener("dragleave", () => d.classList.remove("drop-after", "drop-before"));
    d.addEventListener("drop", (e) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("text/plain");
      const order = [...(source().breaks.settings.stop_order || STOP_ORDER)].filter((k) => k !== kind);
      let at = order.indexOf(d.dataset.kind) + (d.classList.contains("drop-after") ? 1 : 0);
      order.splice(at, 0, kind);
      set("breaks.settings.stop_order", order);
    });
  });
}

function wireBrands(el) {
  const add = () => {
    const input = el.querySelector("#brand-in");
    const name = input.value.trim();
    if (!name) return;
    const cur = source().breaks.lodging.brands;
    if (!cur.some((b) => b.toLowerCase() === name.toLowerCase())) set("breaks.lodging.brands", [...cur, name]);
    else input.value = "";
  };
  el.querySelector("#brand-add").addEventListener("click", add);
  el.querySelector("#brand-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  el.querySelectorAll("[data-brand-del]").forEach((b) => b.addEventListener("click", () => {
    set("breaks.lodging.brands", source().breaks.lodging.brands.filter((_, i) => i !== parseInt(b.dataset.brandDel, 10)));
  }));
}

async function resetSettings() {
  const toTrip = scope() === "trip";
  const ok = await confirmDialog({
    title: toTrip ? "Reset this trip's settings?" : "Reset the defaults?",
    body: toTrip ? "Breaks, meals, fuel, days, lodging, roads and pace go back to the defaults. Waypoints, zones, pins and skips stay." : "The defaults go back to the built-in settings (a break every 2 h, lunch 11:30–13:30 …). Existing trips are not changed.",
    ok: "Reset", danger: true,
  });
  if (!ok) return;
  const base = toTrip ? structuredClone(state.defaults) : { pace: 1.05, search_miles: 2, options: { ...DEFAULT_OPTIONS }, breaks: { settings: { ...DEFAULT_BREAKS }, meals: structuredClone(DEFAULT_MEALS), fuel: { ...DEFAULT_FUEL }, days: { ...DEFAULT_DAYS }, lodging: { ...DEFAULT_LODGING }, warn_closures: true } };
  if (toTrip) {
    updateTrip((t) => {
      t.pace = base.pace; t.search_miles = base.search_miles; t.options = base.options;
      const { pins, skips } = t.breaks;
      t.breaks = { ...base.breaks, pins, skips };
    });
  } else {
    adoptDefaults(base);
    saveDefaultsSoon();
    updateUi(() => {});
  }
}

export async function loadSettingsData() {
  try {
    status = await (await fetch("/api/status")).json();
  } catch { status = null; }
  try {
    const r = await fetch("/api/lodging-brands");
    if (r.ok) brandInfo = await r.json();
  } catch { /* the brand list is a convenience */ }
  renderSettings();
}
