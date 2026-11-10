// Edits to the trip that the map, the menu and the sidebar share.

import { state, uid, updateTrip, updateUi, updatePlan, updateStopZones } from "./state.js";
import { saveLibrarySoon } from "./library.js";
import { confirmDialog } from "./dialog.js";

export const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

export function newWaypoint(lat, lon, type = "stop", extra = {}) {
  return { id: uid(), name: "", lat: round6(lat), lon: round6(lon), type, minutes: 30, nights: 1, ...extra };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Straight-line distance in km, good enough to choose where a point goes.
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Where a new middle waypoint goes when the user did not say: between the
// pair of neighbours it adds the least straight-line distance to.
export function bestInsertIndex(waypoints, p) {
  if (waypoints.length < 2) return waypoints.length;
  let best = 1, bestCost = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const cost = km(a, p) + km(p, b) - km(a, b);
    if (cost < bestCost) { best = i + 1; bestCost = cost; }
  }
  return best;
}

// Where a point dragged off the route goes: after the last waypoint that
// comes before the grabbed spot (route coordinate index `j`).
export function insertIndexForRouteIndex(j) {
  const pos = state.route?.waypoint_positions || {};
  let index = 1;
  state.trip.waypoints.forEach((wp, i) => {
    if (pos[wp.id] !== undefined && pos[wp.id] <= j) index = i + 1;
  });
  return Math.min(Math.max(index, 1), Math.max(state.trip.waypoints.length - 1, 1));
}

export function insertWaypoint(index, wp, { select = false } = {}) {
  updateTrip((t) => t.waypoints.splice(index, 0, wp));
  if (select) updateUi((u) => { u.selected = wp.id; });
  return wp;
}

// Map click with the waypoint tool, or a pasted coordinate: becomes the new end.
export const appendWaypoint = (lat, lon) => insertWaypoint(state.trip.waypoints.length, newWaypoint(lat, lon));

export function addMiddle(lat, lon, type, extra = {}) {
  const wp = newWaypoint(lat, lon, type, extra);
  const t = state.trip;
  // With fewer than two waypoints there is no middle yet: it becomes the end.
  const index = t.waypoints.length < 2 ? t.waypoints.length : bestInsertIndex(t.waypoints, wp);
  return insertWaypoint(index, wp);
}

export const makeStart = (lat, lon) => insertWaypoint(0, newWaypoint(lat, lon));
export const makeEnd = appendWaypoint;

export function removeWaypoint(id) {
  updateTrip((t) => { t.waypoints = t.waypoints.filter((w) => w.id !== id); });
  updateUi((u) => { if (u.selected === id) u.selected = null; });
}

export function moveWaypoint(from, to) {
  updateTrip((t) => {
    const [wp] = t.waypoints.splice(from, 1);
    t.waypoints.splice(to, 0, wp);
  });
}

export function setWaypoint(id, changes) {
  updateTrip((t) => Object.assign(t.waypoints.find((w) => w.id === id), changes));
}

// Adopting an alternate: a through point at a spot only it passes.
export function adoptAlternate(alt) {
  const wp = newWaypoint(alt.adopt.lat, alt.adopt.lon, "through", { name: "Alternate route" });
  insertWaypoint(1, wp);
}

// "39.7392, -104.9903", "39.7392 -104.9903" or one pair per line.
export function parseCoordinates(text) {
  const out = [];
  for (const line of text.split(/[\n;]+/)) {
    const nums = line.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) continue;
    const lat = parseFloat(nums[0]), lon = parseFloat(nums[1]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon });
  }
  return out;
}

// ---------- stops: pins, skips, settings ----------
// Keys are "cluster id#pass" (stop_key). A pin also says what the stop is for:
// "break", "lunch", "dinner" or "overnight". Each change re-plans without a new route.

export const isPinned = (key) => state.trip.breaks.pins.some((p) => p.key === key);

// The pin kind for a plan row: a meal pins as that meal, an automatic overnight
// as "overnight", anything else (a break, a fuel stop) as a break.
export const pinKind = (row) => (row.type === "lunch" || row.type === "dinner" ? row.type : row.type === "overnight" ? "overnight" : "break");

export function togglePin(key, name, kind = "break") {
  updatePlan((b) => {
    if (b.pins.some((p) => p.key === key)) b.pins = b.pins.filter((p) => p.key !== key);
    else { b.pins.push({ key, name, kind }); b.skips = b.skips.filter((p) => p.key !== key); }
  });
}

// Put `key` in the place of the stop `replacing`: pin the new one for the same
// purpose, and drop the old one's pin if it had one. For an overnight this is
// "stay here instead".
export function useStop(key, name, replacing, kind = "break") {
  updatePlan((b) => {
    b.pins = b.pins.filter((p) => p.key !== replacing && p.key !== key);
    b.pins.push({ key, name, kind });
    b.skips = b.skips.filter((p) => p.key !== key);
  });
  updateUi((u) => { u.selectedBreak = key; u.pickerFocus = key; });
}

export function skipStop(key, name) {
  updatePlan((b) => {
    b.pins = b.pins.filter((p) => p.key !== key);
    if (!b.skips.some((p) => p.key === key)) b.skips.push({ key, name });
  });
}

export function unskipStop(key) {
  updatePlan((b) => { b.skips = b.skips.filter((p) => p.key !== key); });
}

// "lunch 11:30–13:30"
export const mealText = (name, m) => `${name} ${m.start}–${m.end}`;

// "every 2 h or 150 mi"
export function breakRuleText(s) {
  return `every ${hm(s.every_minutes)} or ${Math.round(s.every_miles)} mi`;
}

// "2027-09-24T09:37" -> "09:37"
export const clockOf = (iso) => (iso ? iso.slice(11, 16) : "");

// ---------- zones ----------

export const ZONE_TYPES = [
  { type: "avoid", icon: "⛔", label: "Avoid driving through", short: "Avoid", note: "The route goes around it." },
  { type: "no_stops", icon: "🚫", label: "No stops", short: "No stops", note: "Drive through, but no break, meal, fuel or overnight here." },
  { type: "no_overnight", icon: "🌙", label: "No overnight", short: "No overnight", note: "Breaks and meals are fine, no hotel." },
  { type: "no_meals", icon: "🍴", label: "No meals", short: "No meals", note: "Breaks and fuel are fine, no lunch or dinner." },
  { type: "prefer", icon: "⭐", label: "Prefer stops", short: "Prefer stops", note: "Stops here win close calls." },
];
export const zoneType = (type) => ZONE_TYPES.find((z) => z.type === type) || ZONE_TYPES[0];
export const zoneTone = (zone) => (!zone.enabled ? "off" : zone.type === "avoid" ? "avoid" : zone.type === "prefer" ? "prefer" : "other");

// A new zone starts in the library (shared by every trip, on for this one); its
// card asks whether it should stay in this trip only instead.
export function addZone(ring, shape) {
  const n = state.trip.zones.length + 1;
  const zone = { id: uid(), name: `Zone ${n}`, type: "avoid", shape, enabled: true, ring, lib: true };
  updateTrip((t) => t.zones.push(zone));
  saveLibrarySoon();
  updateUi((u) => { u.selectedZone = zone.id; u.tab = "zones"; });
  return zone;
}

// A zone change re-routes only when an avoid zone is involved (before or
// after the change); the other types only move stops.
export function setZone(id, changes) {
  const z = state.trip.zones.find((x) => x.id === id);
  const routes = z.type === "avoid" || changes.type === "avoid";
  (routes ? updateTrip : updateStopZones)((t) => Object.assign(t.zones.find((x) => x.id === id), changes));
  // The switch belongs to the trip; everything else about a library zone belongs to the library.
  if (z.lib && Object.keys(changes).some((k) => k !== "enabled")) saveLibrarySoon();
}

// "Avoid this road": an avoid zone around a road that is closed on the trip's dates.
export function avoidClosure(closure) {
  const zone = { id: uid(), name: `Closed: ${closure.road}`, type: "avoid", shape: "polygon", enabled: true, ring: closure.avoid_ring };
  updateTrip((t) => t.zones.push(zone));
  return zone;
}

export async function removeZone(id) {
  const z = state.trip.zones.find((x) => x.id === id);
  if (z?.lib) {
    const ok = await confirmDialog({
      title: "Delete this zone from the library?", body: `“${z.name || "unnamed"}” is shared: every trip that uses it loses it. To leave it out of this trip only, switch it off.`,
      ok: "Delete from the library", danger: true,
    });
    if (!ok) return;
    saveLibrarySoon();
  }
  updateTrip((t) => { t.zones = t.zones.filter((z) => z.id !== id); });
  updateUi((u) => {
    if (u.selectedZone === id) u.selectedZone = null;
    if (u.editingZone === id) u.editingZone = null;
  });
}

// Size in miles of a zone's bounding box, for labels.
export function zoneSize(zone) {
  const lats = zone.ring.map((p) => p[1]), lons = zone.ring.map((p) => p[0]);
  const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
  const mid = (s + n) / 2;
  const width = km({ lat: mid, lon: w }, { lat: mid, lon: e }) / 1.609344;
  const height = km({ lat: s, lon: w }, { lat: n, lon: w }) / 1.609344;
  return `${fmtMiles(width)} × ${fmtMiles(height)} mi`;
}
const fmtMiles = (m) => (m < 10 ? m.toFixed(1) : Math.round(m));

// ---------- formatting ----------

export function hm(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export const miles = (m) => (m >= 100 ? Math.round(m).toLocaleString() : m.toFixed(1));

export function describeWaypoint(wp, i, count) {
  if (i === 0) return "🏁 Start";
  if (i === count - 1) return "🏁 End";
  if (wp.type === "through") return "◇ Through · no stop";
  if (wp.type === "overnight") return `🛏 ${wp.nights} night${wp.nights === 1 ? "" : "s"}`;
  return `📍 Stop · ${hm(wp.minutes)}`;
}

export const waypointName = (wp) => wp.name || `${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}`;

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
