// The zone library: zones shared by every trip, kept by the server in
// trips/zones.json (backend/app/library.py).
//
// In the page a library zone is an ordinary zone in `trip.zones` with
// `lib: true` and this trip's switch in `enabled`. Changing a library zone's
// shape, name or type saves the library (after a short pause); switching it
// on or off is a change to the trip only. The trip file lists the library
// zones that are on (state.js, tripToFile).

import { state, mergeLibrary, updateTrip, updateStopZones, updateUi, planBody } from "./state.js";
import { confirmDialog, flash } from "./dialog.js";

async function api(path, options) {
  const resp = await fetch(path, options);
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error?.message || JSON.stringify(body.detail || body));
  return body;
}

const json = (method, doc) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });

function adopt(lib) {
  state.library = { zones: lib.zones, loaded: true, seeded: lib.seeded };
  let changed = false;
  updateStopZones((t) => { changed = mergeLibrary(t, lib.zones); });
  return changed;
}

export async function loadLibrary() {
  try {
    const lib = await api("/api/zones");
    adopt(lib);
    return lib.zones;
  } catch (e) {
    flash(`Could not load the zone library: ${e.message}`, "bad");
    return state.library.zones;
  }
}

// ---------- saving ----------

const libraryZones = () => state.trip.zones.filter((z) => z.lib).map(({ lib, enabled, ...z }) => z);
let timer = null;

export function saveLibrarySoon() {
  clearTimeout(timer);
  timer = setTimeout(saveLibrary, 500);
}

export async function saveLibrary() {
  clearTimeout(timer);
  try {
    const out = await api("/api/zones", json("PUT", { zones: libraryZones() }));
    state.library = { zones: out.zones, loaded: true, seeded: false };
    updateUi((u) => { u.libraryNote = `Library saved (${out.zones.length} zone${out.zones.length === 1 ? "" : "s"})`; });
  } catch (e) {
    flash(`Could not save the zone library: ${e.message}`, "bad");
  }
}

// A zone moves between "this trip only" and "the library".
export async function setZoneHome(id, home) {
  const z = state.trip.zones.find((x) => x.id === id);
  if (!z || !!z.lib === (home === "library")) return;
  if (home === "trip") {
    const ok = await confirmDialog({
      title: "Keep this zone in this trip only?",
      body: `“${z.name || "unnamed"}” leaves the shared library, so other trips lose it.`, ok: "Move to this trip", danger: true,
    });
    if (!ok) return;
  }
  updateStopZones((t) => { t.zones.find((x) => x.id === id).lib = home === "library"; });
  saveLibrarySoon();
}

// ---------- GeoJSON ----------

export async function importGeojson(file) {
  try {
    const doc = JSON.parse(await file.text());
    const out = await api("/api/zones/import", json("POST", doc));
    adopt(out.library);
    flash(`Added ${out.added.length} zone${out.added.length === 1 ? "" : "s"} to the library (off for this trip)`);
    updateUi((u) => { u.tab = "zones"; });
  } catch (e) {
    flash(`Could not import: ${e.message}`, "bad");
  }
}

// ---------- what would switching a zone on do ----------

// Asked for on request (one extra plan, or one extra route, per zone).
export async function whatIf(ids) {
  const rev = state.rev;
  updateUi((u) => { for (const id of ids) u.whatIf[id] = { text: "checking…", rev, busy: true }; });
  try {
    const { effects } = await api("/api/zones/what-if", json("POST", { ...planBody(state.trip), check: ids }));
    updateUi((u) => { for (const id of ids) u.whatIf[id] = { text: effects[id]?.text || "no answer", rev, blocked: !!effects[id]?.blocked }; });
  } catch (e) {
    updateUi((u) => { for (const id of ids) u.whatIf[id] = { text: `could not check: ${e.message}`, rev, blocked: true }; });
  }
}
