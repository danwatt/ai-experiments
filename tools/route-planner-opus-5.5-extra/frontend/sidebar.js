// The right sidebar: trip summary, and the Itinerary, Waypoints and Zones tabs.
// Each render rebuilds the open tab from `state`; handlers change the trip
// through edits.js.

import { state, updateTrip, updateUi } from "./state.js";
import {
  letter, appendWaypoint, insertWaypoint, newWaypoint, removeWaypoint, moveWaypoint, parseCoordinates, setZone, removeZone,
  zoneType, zoneTone, zoneSize, describeWaypoint, waypointName, hm, miles, escapeHtml,
  togglePin, clockOf, breakRuleText, pinKind, mealText, avoidClosure, ZONE_TYPES,
} from "./edits.js";
import { selectWaypoint, selectZone, panToWaypoint, panToZone, toggleZoneEdit, selectBreak } from "./map.js";
import { DEFAULT_BREAKS, updatePlan } from "./state.js";
import { whatIf, importGeojson } from "./library.js";

const $ = (id) => document.getElementById(id);

export function initSidebar() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => updateUi((u) => { u.tab = t.dataset.tab; })));
}

export function renderSidebar() {
  renderSummary();
  renderBreakFooter();
  renderTabs();
  const tab = state.ui.tab;
  for (const name of ["itinerary", "waypoints", "zones"]) $(`tab-${name}`).hidden = name !== tab;
  // Re-render the Waypoints tab only when focus is not in one of its fields,
  // so typing is never interrupted.
  if (tab === "itinerary") renderItinerary();
  if (tab === "waypoints" && !$("tab-waypoints").contains(document.activeElement)) renderWaypoints();
  if (tab === "zones") renderZones();
}

// ---------- summary ----------

function departText(trip) {
  if (!trip.depart) return "No departure time";
  const d = new Date(trip.depart);
  if (isNaN(d)) return trip.depart;
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${date} · depart ${trip.depart.slice(11, 16)}`;
}

function renderSummary() {
  const { trip, route } = state;
  $("sum-title").textContent = trip.name || "Trip";
  const legs = route?.legs.length || 0;
  $("sum-chip").textContent = legs ? `${legs} leg${legs === 1 ? "" : "s"}` : "no route";
  $("sum-sub").textContent = `${departText(trip)} · pace ×${(trip.pace || 1.05).toFixed(2)}`;
  const plan = state.stops?.plan;
  if (plan) $("sum-chip").textContent = `${plan.days.length} day${plan.days.length === 1 ? "" : "s"}`;
  $("sum-stats").innerHTML = route && plan
    ? `<span><b>${miles(route.total.miles)}</b>mi</span><span><b>${hm(route.total.minutes)}</b>driving</span>` +
      (plan.summary.nights ? `<span><b>${plan.summary.nights}</b>night${plan.summary.nights === 1 ? "" : "s"}</span>` : "") +
      `<span><b>${plan.summary.breaks + plan.summary.meals + plan.summary.auto_nights}</b>stops</span><span><b>${plan.summary.arrive.slice(11, 16)}</b>arrive</span>`
    : route
    ? `<span><b>${miles(route.total.miles)}</b>mi</span><span><b>${hm(route.total.minutes)}</b>driving</span><span><b>${trip.waypoints.length}</b>waypoints</span>`
    : `<span><b>–</b>mi</span><span><b>–</b>driving</span><span><b>${trip.waypoints.length}</b>waypoints</span>`;
}

function renderTabs() {
  const on = state.trip.zones.filter((z) => z.enabled).length;
  const labels = {
    itinerary: "Itinerary",
    waypoints: `Waypoints · ${state.trip.waypoints.length}`,
    zones: `Zones · ${on} on`,
  };
  document.querySelectorAll(".tab").forEach((t) => {
    t.textContent = labels[t.dataset.tab];
    t.classList.toggle("on", t.dataset.tab === state.ui.tab);
  });
}

// ---------- itinerary ----------

function mileAt(wp) {
  const pos = state.route?.waypoint_positions?.[wp.id];
  return pos === undefined ? null : state.route.cumulative_miles[pos];
}

function renderItinerary() {
  const el = $("tab-itinerary");
  const { trip, route, error } = state;
  const parts = [];
  if (error) parts.push(`<div class="panel"><div class="err">⚠ ${escapeHtml(error.message)}</div></div>`);
  if (trip.waypoints.length < 2) {
    parts.push(`<div class="empty">Pick <b>📍 Waypoint</b> on the map and click to add places: the first is the start and the last is the end. Or right-click the map. Or open a saved trip or an example from the trip menu at the top.</div>`);
  } else if (!route && !error) {
    parts.push(`<div class="empty">Routing…</div>`);
  }
  if (route) {
    (state.stops?.closures || []).forEach((c, i) => parts.push(closureRow(c, i)));
    const plan = state.stops?.plan;
    if (plan) parts.push(...planRows(plan));
    else parts.push(...legRows(route));
    for (const w of route.warnings) parts.push(`<div class="row note"><div class="t"></div><div>${escapeHtml(w)}</div></div>`);
    if (route.alternates.length) {
      parts.push(`<div class="row note"><div class="t"></div><div>${route.alternates.length} alternate route${route.alternates.length === 1 ? "" : "s"} in grey on the map: ${route.alternates.map((a) => `${miles(a.miles)} mi, ${a.extra_minutes >= 0 ? "+" : "−"}${hm(Math.abs(a.extra_minutes))}`).join("; ")}. Click one to use it.</div></div>`);
    }
    parts.push(`<div class="row note"><div class="t"></div><div>${stopsSummary()}</div></div>`);
    parts.push(`<div class="row note"><div class="t"></div><div>Driving times are Valhalla's, slowed for tight curves, times your pace (×${(trip.pace || 1.05).toFixed(2)}). Valhalla alone says ${hm(route.total.valhalla_minutes)}.</div></div>`);
  }
  el.innerHTML = parts.join("");
  el.querySelectorAll("[data-wp]").forEach((r) => r.addEventListener("click", () => { selectWaypoint(r.dataset.wp); panToWaypoint(r.dataset.wp); }));
  el.querySelectorAll("[data-brk]").forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.closest("[data-pin]")) return;
    selectBreak(r.dataset.brk, { pan: true });
  }));
  el.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", () => togglePin(b.dataset.pin, b.dataset.name, b.dataset.kind)));
  el.querySelectorAll("[data-day]").forEach((h) => h.addEventListener("click", () => updateUi((u) => { u.day = parseInt(h.dataset.day, 10); })));
  el.querySelectorAll("[data-avoid]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const c = (state.stops?.closures || [])[parseInt(b.dataset.avoid, 10)];
    if (c?.avoid_ring) avoidClosure(c);
  }));
}

// Before the plan arrives: the legs, with driving time only.
function legRows(route) {
  const { trip } = state;
  const parts = [];
  const index = Object.fromEntries(trip.waypoints.map((w, i) => [w.id, i]));
  let elapsed = 0;
  route.legs.forEach((leg, k) => {
    const a = trip.waypoints[index[leg.from]], b = trip.waypoints[index[leg.to]];
    if (!a || !b) return;
    parts.push(`<div class="dayh"><span>Leg ${k + 1} · ${letter(index[leg.from])} → ${letter(index[leg.to])}</span><span class="r">${miles(leg.miles)} mi · ${hm(leg.minutes)}</span></div>`);
    if (k === 0) parts.push(itinRow(a, index[a.id], 0, "Depart"));
    for (const id of leg.through) parts.push(itinRow(trip.waypoints[index[id]], index[id], null, "Through"));
    elapsed += leg.minutes;
    parts.push(itinRow(b, index[b.id], elapsed, "Arrive"));
  });
  parts.push(`<div class="row note"><div class="t"></div><div>${state.stopsLoading ? "Planning breaks…" : ""}</div></div>`);
  return parts;
}

// ---------- the plan: days, breaks and clock times ----------

const dayName = (isoDate) => new Date(`${isoDate}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const WARN_CODES = new Set(["long_gap", "over_detour", "no_lunch", "no_dinner", "fuel_late", "day_over_limit", "day_late", "after_dark"]);

function planRows(plan) {
  const parts = [];
  for (const w of plan.warnings) {
    const cls = WARN_CODES.has(w.code) ? "check" : "open";
    parts.push(`<div class="row closure ${cls}"><div class="t">${cls === "check" ? "⚠" : "ℹ"}</div><div>${escapeHtml(w.message)}</div></div>`);
  }
  const rows = plan.rows;
  for (const day of plan.days) {
    const chips = (day.chips || []).map((c) => `<span class="chip ${c.tone}">${escapeHtml(c.text)}</span>`).join("");
    const head = day.driving
      ? `<span class="r">${miles(day.miles)} mi · ${hm(day.driving_minutes)}</span><span class="d2">${escapeHtml(day.start)} → ${escapeHtml(day.end)} · ${clockOf(day.depart)}–${clockOf(day.arrive)}${chips ? ` <span class="chips in">${chips}</span>` : ""}</span>`
      : `<span class="r">no driving · ${escapeHtml(day.at)}</span>`;
    // Several days fold: only the day picked (here or in the day strip) shows its rows.
    const many = plan.days.length > 1, open = !many || state.ui.day === day.day;
    parts.push(`<div class="dayh${many && open ? " on" : ""}${open ? "" : " closed"}" data-day="${day.day}"><span>Day ${day.day} · ${dayName(day.date)}</span>${head}</div>`);
    if (!day.driving || !open) continue;
    let tz = null;
    for (const r of rows) {
      let side = null;
      if (r.type === "overnight" && r.depart_day === day.day) side = "leave";
      else if (r.day === day.day && !(r.type === "overnight" && r.depart_day === day.day)) side = "arrive";
      if (!side) continue;
      const zone = side === "leave" ? r.depart_tz : r.tz;
      parts.push(planRow(r, side, zone !== tz ? zone : null));
      tz = zone;
    }
    if (day.next_due) parts.push(dueNote(day));
  }
  return parts;
}

function dueNote(day) {
  const due = day.next_due.clock, end = day.arrive;
  const after = Math.round((new Date(due) - new Date(end)) / 60000);
  const rel = Math.abs(after) <= 5 ? "as you arrive" : after > 0 ? `${hm(after)} after you arrive` : `${hm(-after)} before you arrive`;
  return `<div class="row note"><div class="t"></div><div>The next break would be due at ${clockOf(due)}, ${rel} (${breakRuleText(state.stops.plan.settings)} after ${escapeHtml(day.next_due.after)}).</div></div>`;
}

const KIND_WORD = { rest_area: "rest area", service_plaza: "service plaza", exit: "exit", town: "town", other: "roadside group" };

// "Fairplay · US 285 · mile 85 · +1.4 min · 10 food · 3 fuel"
function placeMeta(r) {
  const bits = [];
  if (r.kind === "exit" && r.ref) bits.push(`Exit ${escapeHtml(r.ref)}${r.road ? ` · ${escapeHtml(r.road)}` : ""}`);
  else if (r.road) bits.push(escapeHtml(r.road));
  if (r.near && r.near !== r.name && (r.kind === "rest_area" || r.kind === "service_plaza" || r.kind === "exit" || r.kind === "other")) bits.push(`near ${escapeHtml(r.near)}`);
  bits.push(`mile ${miles(r.mile)}`);
  bits.push(r.detour_min === null ? "no way in from this side" : r.detour_min < 1 ? "on the way" : `+${r.detour_min} min detour`);
  const food = r.food && (r.type === "lunch" || r.type === "dinner")
    ? `${r.food} food${r.food_sitdown || r.food_fast ? ` (${[r.food_sitdown && `${r.food_sitdown} sit-down`, r.food_fast && `${r.food_fast} fast`].filter(Boolean).join(", ")})` : ""}`
    : r.food && `${r.food} food`;
  const have = [food, r.fuel && `${r.fuel} fuel`, r.lodging && `${r.lodging} lodging`].filter(Boolean);
  if (r.kind === "rest_area" || r.kind === "service_plaza") have.unshift(r.toilets ? "toilets" : KIND_WORD[r.kind]);
  if (have.length) bits.push(have.join(" · "));
  else bits.push("nothing mapped");
  return bits.join(" · ");
}

const STOP_ICON = { break: "☕", lunch: "🍴", dinner: "🍴", fuel: "⛽", overnight: "🛏" };
const STOP_WORD = { break: "Break", lunch: "Lunch", dinner: "Dinner", fuel: "Fuel", overnight: "Overnight" };

// Chips every planned stop can carry: pinned, moved by a zone, merged fuel, limits.
function stopChips(r) {
  const chips = [];
  if (r.pinned) chips.push(`<span class="chip acc">📌 pinned</span>`);
  if (r.moved) chips.push(`<span class="chip ${r.moved.startsWith("⭐") ? "ok" : "warn"}">${escapeHtml(r.moved)}</span>`);
  else if (r.prefer) chips.push(`<span class="chip ok">⭐ ${escapeHtml(r.prefer)}</span>`);
  if (r.fuel_note) chips.push(`<span class="chip acc">${escapeHtml(r.fuel_note)}</span>`);
  if (r.over_limit && r.type !== "overnight") chips.push(`<span class="chip bad">over the detour limit</span>`);
  if (r.level && r.level !== "rules kept" && !r.pinned) chips.push(`<span class="chip warn">${escapeHtml(r.level)}</span>`);
  if (r.also?.length) chips.push(`<span class="chip">also here: ${escapeHtml(r.also.slice(0, 2).join(", "))}${r.also.length > 2 ? "…" : ""}</span>`);
  if (r.spread) chips.push(`<span class="chip">${r.spread.kept} of ${r.spread.of} places in this group</span>`);
  return chips;
}

// The time column: the clock, and the zone's abbreviation where it changes.
const timeCell = (t, tz) => `<div class="t">${t}${tz ? `<small>${escapeHtml(tz)}</small>` : ""}</div>`;

// "sunset 19:03 · 2 h 33 of daylight to spare" for the row that ends a day.
function sunsetText(r) {
  if (!r.sunset) return "";
  const spare = Math.round((new Date(r.sunset) - new Date(r.arrive)) / 60000);
  return spare >= 0 ? `sunset ${clockOf(r.sunset)} · ${hm(spare)} of daylight to spare` : `sunset ${clockOf(r.sunset)}`;
}

function nightChips(r) {
  const chips = [];
  if (r.hotel_dinner) chips.push(`<span class="chip ok">🍴 dinner near the hotel</span>`);
  if (r.after_dark) chips.push(`<span class="chip bad">arrive after dark</span>`);
  else if (r.sunset) chips.push(`<span class="chip">🌇 sunset ${clockOf(r.sunset)}</span>`);
  if (r.fill_up) chips.push(`<span class="chip">⛽ fill up</span>`);
  return chips;
}

function planRow(r, side, tz) {
  const t = side === "leave" ? clockOf(r.depart) : clockOf(r.type === "start" ? r.depart : r.arrive);
  if (r.type === "break" || r.type === "lunch" || r.type === "dinner" || r.type === "fuel") {
    const sel = state.ui.selectedBreak === r.stop_key ? " sel" : "";
    const chips = stopChips(r);
    const fuel = r.refuel && r.type !== "fuel" ? ` + ⛽ <b>fuel</b>` : "";
    const why = r.type === "fuel" ? "" : `<br><span class="why">${escapeHtml(r.reason)}</span>`;
    return `<div class="row brk${sel}" data-brk="${r.stop_key}">${timeCell(t, tz)}<div>
      <div class="what">${STOP_ICON[r.type]} <b>${STOP_WORD[r.type]}</b>${fuel} · ${hm(r.dwell)}${r.detour_min >= 1 ? ` <small class="dim">(${r.stay_minutes} + ${hm(r.detour_min)} detour)</small>` : ""}</div>
      <div class="meta"><b>${escapeHtml(r.name)}</b> · ${placeMeta(r)}${why}</div>
      ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}</div>
      <div class="acts">${r.type === "fuel" ? "" : pinButton(r)}</div></div>`;
  }
  if (r.type === "clock") {
    const dir = r.shift_minutes > 0 ? "forward" : "back";
    return `<div class="row note clockrow">${timeCell(t, r.tz)}<div>🕐 <b>Clock change</b> · into ${escapeHtml(r.name)} time (${escapeHtml(r.tz)}): clocks go ${dir} ${hm(Math.abs(r.shift_minutes))} · it was ${clockOf(r.before)} ${escapeHtml(r.before_tz)} · mile ${miles(r.mile)}</div></div>`;
  }
  if (r.type === "overnight" && r.auto) {
    const sel = state.ui.selectedBreak === r.stop_key ? " sel" : "";
    if (side === "leave") {
      return `<div class="row brk${sel}" data-brk="${r.stop_key}">${timeCell(t, tz)}<div><div class="what">🛏 <b>Leave ${escapeHtml(r.name)}</b></div>
        <div class="meta">after 1 night · the day starts at ${escapeHtml(state.stops.plan.day_settings.start)}${r.fill_up ? " · full tank" : ""}</div></div><div></div></div>`;
    }
    const chips = [...nightChips(r), ...stopChips(r)];
    if (r.best_other) chips.push(`<span class="chip">${escapeHtml(r.best_other)}</span>`);
    return `<div class="row brk night${sel}" data-brk="${r.stop_key}">${timeCell(t, tz)}<div>
      <div class="what">🛏 <b>Overnight</b>${r.fill_up ? " + ⛽ <b>fill up</b>" : ""} · ${r.pinned ? "your pick" : "chosen by the planner"}</div>
      <div class="meta"><b>${escapeHtml(r.name)}</b> · ${placeMeta(r)}<br><span class="why">${escapeHtml(r.reason)}</span></div>
      <div class="chips">${chips.join("")}</div></div>
      <div class="acts">${pinButton(r)}</div></div>`;
  }
  const i = state.trip.waypoints.findIndex((w) => w.id === r.id);
  const wp = state.trip.waypoints[i];
  if (!wp) return "";
  const icon = r.type === "through" ? `<span class="wpd thru"></span>` : `<span class="wpd">${letter(i)}</span>`;
  let what, meta = [`mile ${miles(r.mile)}`], chips = [];
  const during = r.events?.during || [];
  if (r.type === "start") what = `${icon} <b>Depart ${escapeHtml(waypointName(wp))}</b>`;
  else if (r.type === "end") { what = `${icon} <b>Arrive ${escapeHtml(waypointName(wp))}</b>`; if (r.sunset) meta.push(sunsetText(r)); if (r.after_dark) chips.push(`<span class="chip bad">arrive after dark</span>`); }
  else if (r.type === "through") { what = `${icon}<b>Through ${escapeHtml(waypointName(wp))}</b> (${letter(i)})`; meta.push("no stop"); }
  else if (r.type === "stop") {
    what = `${icon} <b>${escapeHtml(waypointName(wp))}</b> · stop ${hm(r.dwell)}`;
    meta.push(`leave ${clockOf(r.depart)}`, "the break clock starts again here");
    for (const m of during) chips.push(`<span class="chip ok">🍴 ${m} during this stop</span>`);
  } else if (side === "leave") {
    what = `🛏 <b>Leave ${escapeHtml(waypointName(wp))}</b>`;
    meta = [`after ${r.nights} night${r.nights === 1 ? "" : "s"}`, `the day starts at ${escapeHtml(state.stops.plan.day_settings.start)}`];
    if (r.fill_up) meta.push("full tank");
  } else {
    what = `${icon} <b>Arrive ${escapeHtml(waypointName(wp))}</b>`;
    meta.push(`🛏 ${r.nights} night${r.nights === 1 ? "" : "s"}`);
    chips = nightChips(r);
  }
  const bad = state.error?.waypoint_id === wp.id ? ` <span class="chip bad">inside an avoid zone</span>` : "";
  return `<div class="row ${state.ui.selected === wp.id ? "sel" : ""}" data-wp="${wp.id}">${timeCell(t, tz)}<div><div class="what">${what}${bad}</div><div class="meta">${meta.join(" · ")}</div>${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}</div><div></div></div>`;
}

function pinButton(r) {
  return `<button class="ib ${r.pinned ? "on" : ""}" data-pin="${r.stop_key}" data-kind="${pinKind(r)}" data-name="${escapeHtml(r.name)}" title="${r.pinned ? "Unpin" : "Pin this stop"}">📌</button>`;
}

// ---------- the settings chips under the sidebar ----------
// A summary of the rules in force. Every chip opens the settings page, which
// edits all of them (settings.js); there are no separate editors here.

export function renderBreakFooter() {
  const el = $("side-foot");
  if (!el) return;
  const s = { ...DEFAULT_BREAKS, ...(state.trip.breaks?.settings || {}) };
  const { meals, fuel, days } = state.trip.breaks;
  const pins = state.trip.breaks?.pins.length || 0, skips = state.trip.breaks?.skips.length || 0;
  const mealChip = ["lunch", "dinner"].filter((n) => meals[n].on).map((n) => mealText(n, meals[n])).join(" · ") || "no meals";
  const chip = (text) => `<button class="chip lnk-chip" data-settings>${text}</button>`;
  el.innerHTML = chip(`☕ ${breakRuleText(s)}`) + chip(`${hm(s.minutes)} each`) + chip(`≤ ${s.max_detour_each_way} min off route`) + chip(`🍴 ${mealChip}`) +
    chip(`⛽ ${fuel.on ? `by ${Math.round(fuel.range_miles * fuel.refuel_after)} mi` : "off"}`) +
    chip(`${hm(days.driving_minutes)} a day · ${days.start}–${days.arrive_by}${days.stop_at_sunset ? " · 🌇" : ""}`) +
    (pins ? `<span class="chip acc">📌 ${pins}</span>` : "") + (skips ? `<span class="chip">⏭ ${skips} skipped</span>` : "") +
    `<span class="foot-lnks"><button class="lnk" data-settings>⚙ All settings…</button></span>`;
  el.querySelectorAll("[data-settings]").forEach((b) => b.addEventListener("click", () => updateUi((u) => { u.view = "settings"; u.settingsScope = "trip"; })));
}

// One seasonal road: red when the trip's dates are inside its closure, amber
// when the dates are unclear, grey when it is open on them.
// A road closed on the trip's dates offers "Avoid this road": an avoid zone
// around its ways, so the route goes another way.
function closureRow(c, i) {
  const icon = { closed: "⛔", check: "⚠", open: "ℹ" }[c.level];
  const where = c.miles ? `mile ${miles(c.miles[0])}${c.miles[1] - c.miles[0] >= 1 ? `–${miles(c.miles[1])}` : ""} · ` : "";
  const act = c.avoid_ring ? `<div class="chips"><button class="btn sm" data-avoid="${i}">⛔ Avoid this road</button><span class="dim">adds an avoid zone around it; the route changes</span></div>` : "";
  return `<div class="row closure ${c.level}"><div class="t">${icon}</div><div>${escapeHtml(c.message)}<small>${where}OSM: ${escapeHtml(c.tags)}</small>${act}</div></div>`;
}

function stopsSummary() {
  const s = state.stops;
  if (state.stopsError) return `Stops: ${escapeHtml(state.stopsError.message)}`;
  if (!s) return state.stopsLoading ? "Finding stops along the route and checking detours…" : "";
  const over = s.candidates.filter((c) => c.over_limit).length;
  const d = s.timing.detours;
  const planned = s.plan ? ` Planned from ${s.plan.summary.choices} choices (places within 2 mi of each other merged) in ${s.plan.plan_ms} ms.` : "";
  return `<b>${s.candidates.length}</b> candidate stops within 2 mi of the route, ${over} over the detour limit (${s.limit_minutes / 2} min each way, ${s.limit_minutes} min there and back).${planned} ` +
    `Detours for ${d.candidates} stops in ${(s.timing.total_ms / 1000).toFixed(1)} s${s.from_cache ? " (remembered)" : d.cached ? ` (${d.cached} remembered)` : ""}.`;
}

function itinRow(wp, i, elapsedMinutes, verb) {
  const n = state.trip.waypoints.length;
  const thru = wp.type === "through" && i > 0 && i < n - 1;
  const mile = mileAt(wp);
  const icon = thru ? `<span class="wpd thru"></span>` : `<span class="wpd">${letter(i)}</span>`;
  const what = thru ? `${icon}<b>Through ${escapeHtml(waypointName(wp))}</b> (${letter(i)})` : `${icon} <b>${verb} ${escapeHtml(waypointName(wp))}</b>`;
  const t = elapsedMinutes === null ? "" : `${clock(elapsedMinutes)}<small>driving</small>`;
  const metaParts = [];
  if (mile !== null) metaParts.push(`mile ${miles(mile)}`);
  if (!thru && i > 0 && i < n - 1) metaParts.push(describeWaypoint(wp, i, n));
  if (thru) metaParts.push("no stop");
  const bad = state.error?.waypoint_id === wp.id ? ` <span class="chip bad">inside an avoid zone</span>` : "";
  return `<div class="row ${state.ui.selected === wp.id ? "sel" : ""}" data-wp="${wp.id}"><div class="t">${t}</div><div><div class="what">${what}${bad}</div><div class="meta">${metaParts.join(" · ")}</div></div><div></div></div>`;
}

// Driving time so far as h:mm, for the narrow time column.
function clock(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- waypoints ----------

function renderWaypoints() {
  const el = $("tab-waypoints");
  const { trip } = state;
  const n = trip.waypoints.length;
  const rows = trip.waypoints.map((wp, i) => {
    const thru = wp.type === "through" && i > 0 && i < n - 1;
    const mk = thru ? `<span class="mk thru"><span>${letter(i)}</span></span>` : `<span class="mk ${wp.type === "overnight" && i > 0 && i < n - 1 ? "night" : ""}">${letter(i)}</span>`;
    const cls = [state.ui.selected === wp.id ? "sel" : "", state.error?.waypoint_id === wp.id ? "bad" : ""].join(" ");
    const mile = mileAt(wp);
    return `<div class="wprow ${cls}" draggable="true" data-i="${i}" data-wp="${wp.id}">
      <span class="h" title="Drag to reorder">⠿</span>${mk}
      <div><div class="n">${escapeHtml(waypointName(wp))}</div><div class="meta">${describeWaypoint(wp, i, n)}${mile !== null ? ` · mile ${miles(mile)}` : ""}</div></div>
      <button class="ib" data-remove="${wp.id}" title="Remove">✕</button></div>`;
  }).join("");
  const o = trip.options;
  const tg = (key, label) => `<div class="optrow">${label} <button class="tg ${o[key] ? "on" : ""}" data-opt="${key}" aria-label="${label}" aria-pressed="${o[key]}"></button></div>`;
  const altSeg = [0, 1, 2].map((k) => `<button data-alts="${k}" class="${o.alternates === k ? "on" : ""}">${k}</button>`).join("");
  const [date, time] = (trip.depart || "T").split("T");
  el.innerHTML = `${rows || `<div class="empty">No waypoints yet.</div>`}
    <div class="panel">
      <div style="display:flex;gap:6px"><div class="search" style="flex:1"><input class="fld wide" id="paste" autocomplete="off" placeholder="🔎 Search a place, or paste 39.7392, -104.9903"><div class="search-results" id="search-results" hidden></div></div><button class="btn" id="paste-add">Add</button></div>
      <div class="meta" id="paste-msg">Search finds towns, rest areas and exits by name; the pick becomes the new end. Drag rows to reorder. The order is yours; the planner never reorders waypoints. Pasted coordinates become the new end too; one pair per line adds several.</div>
    </div>
    <div class="panel">
      <h6>Roads</h6>
      ${tg("avoid_tolls", "Avoid toll roads")}
      ${tg("avoid_ferries", "Avoid ferries")}
      ${tg("avoid_unpaved", "Avoid unpaved roads")}
      <div class="optrow">Show alternate routes <span class="seg">${altSeg}</span></div>
      <div class="meta">Alternates are shown for trips with two waypoints only (a Valhalla limit).</div>
    </div>
    <div class="panel" style="border-bottom:0">
      <h6>Departure and pace</h6>
      <div class="optrow">Leave ${escapeHtml(trip.waypoints[0] ? waypointName(trip.waypoints[0]) : "")} <span><input class="fld" type="date" id="dep-date" value="${date}"> <input class="fld" type="time" id="dep-time" value="${time}"></span></div>
      <div class="optrow">Pace: times × <input class="fld num" type="number" id="pace" min="0.5" max="2" step="0.05" value="${(trip.pace || 1.05).toFixed(2)}"></div>
      <div class="meta">1.05 means you drive about 5 % slower than the estimate. The date matters for roads with timed closures.</div>
    </div>`;
  wireWaypoints(el);
}

// ---------- place search ----------

const RESULT_GLYPH = { city: "🏙", town: "🏘", village: "🏘", hamlet: "🏘", rest_area: "🅿", service_plaza: "🅿", exit: "↱", other: "•" };
let found = []; // the results on screen
let active = -1; // which one the arrow keys are on
let searchSeq = 0;
let searchTimer = null;

function renderResults(message) {
  const box = $("search-results");
  if (!box) return;
  if (!found.length && !message) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = found.length
    ? found.map((r, i) => `<button data-i="${i}" class="${i === active ? "on" : ""}"><span>${RESULT_GLYPH[r.kind] || "•"}</span><span>${escapeHtml(r.name)}<small>${escapeHtml(r.detail)}</small></span></button>`).join("")
    : `<div class="none">${escapeHtml(message)}</div>`;
  box.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pickResult(parseInt(b.dataset.i, 10)); }));
}

function pickResult(i) {
  const r = found[i];
  if (!r) return;
  found = [];
  active = -1;
  searchSeq++;
  $("paste").value = "";
  $("paste").blur(); // so the tab re-renders with the new row
  const wp = insertWaypoint(state.trip.waypoints.length, newWaypoint(r.lat, r.lon, "stop", { name: r.name }));
  panToWaypoint(wp.id);
}

function wireSearch() {
  const input = $("paste");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2 || parseCoordinates(q).length) { searchSeq++; found = []; renderResults(); return; }
    searchTimer = setTimeout(async () => {
      const mine = ++searchSeq;
      try {
        const data = await (await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`)).json();
        if (mine !== searchSeq) return;
        found = data.results || [];
        active = found.length ? 0 : -1;
        renderResults(data.error ? data.error.message : `No place called “${q}”.`);
      } catch {
        if (mine === searchSeq) { found = []; renderResults("Search is not reachable."); }
      }
    }, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!found.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
      renderResults();
    } else if (e.key === "Enter") {
      if (parseCoordinates(input.value).length) $("paste-add").click();
      else pickResult(Math.max(active, 0));
    } else if (e.key === "Escape") {
      found = [];
      renderResults();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => { found = []; renderResults(); }, 120));
}

function wireWaypoints(el) {
  el.querySelectorAll(".wprow").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      selectWaypoint(row.dataset.wp);
      panToWaypoint(row.dataset.wp);
    });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", row.dataset.i); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = e.offsetY > row.offsetHeight / 2;
      row.classList.toggle("drop-after", after);
      row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-after", "drop-before"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      let to = parseInt(row.dataset.i, 10) + (row.classList.contains("drop-after") ? 1 : 0);
      row.classList.remove("drop-after", "drop-before");
      if (from < to) to -= 1;
      if (!isNaN(from) && from !== to) moveWaypoint(from, to);
    });
  });
  el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => removeWaypoint(b.dataset.remove)));
  const addPasted = () => {
    const input = $("paste");
    const pts = parseCoordinates(input.value);
    if (!pts.length) { $("paste-msg").innerHTML = `<span style="color:var(--danger-text)">No coordinates found. Use “lat, lon”, e.g. 39.7392, -104.9903.</span>`; return; }
    input.value = "";
    input.blur();
    pts.forEach((p) => appendWaypoint(p.lat, p.lon));
  };
  $("paste-add").addEventListener("click", () => (parseCoordinates($("paste").value).length ? addPasted() : pickResult(0)));
  wireSearch();
  $("paste").addEventListener("paste", () => setTimeout(() => { if (parseCoordinates($("paste").value).length) addPasted(); }, 0));
  el.querySelectorAll("[data-opt]").forEach((b) => b.addEventListener("click", () => updateTrip((t) => { t.options[b.dataset.opt] = !t.options[b.dataset.opt]; })));
  el.querySelectorAll("[data-alts]").forEach((b) => b.addEventListener("click", () => updateTrip((t) => { t.options.alternates = parseInt(b.dataset.alts, 10); })));
  const setDepart = () => {
    const d = $("dep-date").value, t = $("dep-time").value || "08:00";
    updateTrip((trip) => { trip.depart = d ? `${d}T${t}` : null; });
  };
  $("dep-date").addEventListener("change", setDepart);
  $("dep-time").addEventListener("change", setDepart);
  $("pace").addEventListener("change", (e) => {
    const v = Math.min(2, Math.max(0.5, parseFloat(e.target.value) || 1.05));
    updateTrip((t) => { t.pace = v; });
  });
}

// ---------- zones ----------

// What a zone did to this trip, from the plan (schedule.zone_effects).
function zoneEffect(z) {
  if (!z.enabled) return "";
  const fx = state.stops?.plan?.zone_effects?.[z.id];
  if (!fx) return state.stopsLoading ? "checking…" : "";
  return fx.join(" · ");
}

// What switching an off zone on would do: asked for on request, and only good
// while the trip has not changed since.
function offEffect(z) {
  const w = state.ui.whatIf[z.id];
  if (w && w.rev === state.rev) return `<span class="fx ${w.blocked ? "badtxt" : ""}">${escapeHtml(w.text)}</span>`;
  if (w?.busy) return `<span class="fx">checking…</span>`;
  return `<button class="lnk-btn" data-whatif="${z.id}">What would it do?</button>`;
}

function zoneRow(z) {
  const t = zoneType(z.type);
  const tone = zoneTone(z);
  const cls = [z.enabled ? "" : "off", state.error?.zone_id === z.id ? "bad" : ""].join(" ");
  const editing = state.ui.editingZone === z.id;
  const types = ZONE_TYPES.map((x) => `<button data-zt="${z.id}" data-type="${x.type}" class="${x.type === z.type ? "on" : ""}" title="${x.label}: ${x.note}">${x.icon} ${x.short}</button>`).join("");
  const effect = z.enabled ? zoneEffect(z) : "";
  const where = z.lib ? `<span class="chip acc" title="In the shared library">📚 library</span>` : `<span class="chip" title="Only in this trip's file">this trip only</span>`;
  return `<div class="zrow ${cls}" data-zone="${z.id}">
      <button class="tg ${z.enabled ? "on" : ""}" data-ztoggle="${z.id}" aria-label="Zone on" title="${z.enabled ? "On: click to turn off" : "Off: click to turn on"}"></button>
      <div><div class="n"><span class="ty ${tone === "off" ? "" : tone}">${t.icon} ${t.short}</span> · ${escapeHtml(z.name || "unnamed")} ${where}</div>
        <div class="meta">${z.shape === "rectangle" ? "Box" : "Polygon"} · ${zoneSize(z)}${effect ? ` · <span class="fx">${escapeHtml(effect)}</span>` : ""}${state.error?.zone_id === z.id ? ` · <span style="color:var(--danger-text)">${escapeHtml(state.error.message)}</span>` : ""}</div>
        ${z.enabled ? "" : `<div class="meta">${offEffect(z)}</div>`}
        <div class="seg zseg">${types}</div></div>
      <div class="acts"><button class="ib" data-zedit="${z.id}" title="${editing ? "Done editing" : "Edit shape"}">${editing ? "✓" : "✎"}</button><button class="ib" data-zdel="${z.id}" title="${z.lib ? "Delete from the library" : "Delete"}">✕</button></div>
    </div>`;
}

function renderZones() {
  const el = $("tab-zones");
  const zones = state.trip.zones;
  const on = zones.filter((z) => z.enabled), off = zones.filter((z) => !z.enabled);
  const lib = zones.filter((z) => z.lib).length;
  const unchecked = off.filter((z) => !(state.ui.whatIf[z.id] && state.ui.whatIf[z.id].rev === state.rev));
  el.innerHTML = `<div class="panel"><div class="hint">Draw a zone with <b>▭ Box zone</b> or <b>⬠ Polygon zone</b> on the map, or right-click → Draw a zone from here, then choose what it means and where it lives. <b>⛔ Avoid</b> changes the route; <b>🚫 No stops</b>, <b>🍴 No meals</b>, <b>🌙 No overnight</b> and <b>⭐ Prefer stops</b> only change where stops go. Zones in the <b>📚 library</b> are shared by every trip; each trip switches them on or off.</div></div>
    <div class="panel zhead"><h6>On for this trip</h6></div>
    ${on.map(zoneRow).join("") || `<div class="empty" style="padding:6px 12px 10px">No zones are on.</div>`}
    <div class="panel zhead"><h6>In the library, off for this trip</h6>${off.length > 1 && unchecked.length ? `<div><button class="lnk-btn" data-whatif-all>What would each one do?</button></div>` : ""}</div>
    ${off.map(zoneRow).join("") || `<div class="empty" style="padding:6px 12px 10px">Every zone is on for this trip.</div>`}
    <div class="panel zfoot"><div class="meta">${lib} zone${lib === 1 ? "" : "s"} in the library${state.library.seeded ? " (the starting set; saved to trips/zones.json when you change it)" : ""}. Off zones answer “what would it do?” on request, so a big library never slows planning.</div>
      <div class="acts"><label class="btn sm">Import GeoJSON<input type="file" id="zone-import" accept=".geojson,.json,application/geo+json,application/json" hidden></label><a class="btn sm" href="/api/zones/export.geojson" download="zone-library.geojson">Export library as GeoJSON</a></div></div>`;
  el.querySelectorAll("[data-zt]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); setZone(b.dataset.zt, { type: b.dataset.type }); }));
  el.querySelectorAll(".zrow").forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    selectZone(r.dataset.zone);
    panToZone(r.dataset.zone);
  }));
  el.querySelectorAll("[data-ztoggle]").forEach((b) => b.addEventListener("click", () => {
    const z = state.trip.zones.find((x) => x.id === b.dataset.ztoggle);
    setZone(z.id, { enabled: !z.enabled });
  }));
  el.querySelectorAll("[data-zedit]").forEach((b) => b.addEventListener("click", () => { toggleZoneEdit(b.dataset.zedit); panToZone(b.dataset.zedit); }));
  el.querySelectorAll("[data-zdel]").forEach((b) => b.addEventListener("click", () => removeZone(b.dataset.zdel)));
  el.querySelectorAll("[data-whatif]").forEach((b) => b.addEventListener("click", () => whatIf([b.dataset.whatif])));
  el.querySelector("[data-whatif-all]")?.addEventListener("click", () => whatIf(unchecked.slice(0, 12).map((z) => z.id)));
  $("zone-import").addEventListener("change", (e) => { if (e.target.files[0]) importGeojson(e.target.files[0]); e.target.value = ""; });
}
