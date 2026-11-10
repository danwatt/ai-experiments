// Saved trips: the toolbar's trip picker, Save, Save as, New, and the dialogs
// that guard unsaved work. The file API is in backend/app/trips.py.

import { state, subscribe, updateUi, replaceTrip, markSaved, touchTrip, emptyTrip, tripToFile, tripFromFile } from "./state.js";
import { choose, confirmDialog, askText, flash } from "./dialog.js";
import { loadLibrary } from "./library.js";
import { escapeHtml, hm, miles } from "./edits.js";

const $ = (id) => document.getElementById(id);

// 'Colorado loop!' -> 'colorado-loop' (the same rule as trips.slugify on the server)
export function slugify(name, taken = new Set()) {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "trip";
  if (base === "zones" || base === "defaults") base += "-trip";
  let slug = base, n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

async function api(path, options) {
  const resp = await fetch(path, options);
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error?.message || JSON.stringify(body.detail || body));
  return body;
}

const put = (path, doc) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });

export async function refreshFiles() {
  try {
    const { trips, examples } = await api("/api/trips");
    state.files = { trips, examples, loaded: true };
  } catch (e) {
    state.files = { trips: [], examples: [], loaded: true, error: e.message };
  }
  renderPicker();
}

// ---------- unsaved work ----------

// True when it is fine to replace the working trip: nothing unsaved, or the
// user chose to save it or throw it away.
export async function discardOk() {
  if (!state.file.dirty) return true;
  const what = await choose({
    title: "This trip has unsaved changes",
    body: `“${escapeHtml(state.trip.name || "Trip")}” changed since it was ${state.file.id ? "saved" : "started"}. Going on replaces it.`,
    buttons: [{ label: "Save, then go on", value: "save", kind: "primary" }, { label: "Discard the changes", value: "discard", kind: "danger" }, { label: "Cancel", value: null, kind: "quiet" }],
  });
  if (what === "save") return saveTrip();
  return what === "discard";
}

// ---------- save ----------

export async function saveTrip() {
  if (!state.file.id) return saveTripAs();
  return write(state.file.id);
}

async function write(id) {
  try {
    const saved = await put(`/api/trips/${id}`, tripToFile(state.trip));
    markSaved(id);
    flash(`Saved “${saved.name}” to trips/${id}.json`);
    refreshFiles();
    return true;
  } catch (e) {
    flash(`Could not save: ${e.message}`, "bad");
    return false;
  }
}

export async function saveTripAs() {
  const name = await askText({ title: "Save trip as", body: "The name also decides the file name (trips/<name>.json).", value: state.trip.name || "", ok: "Save", placeholder: "Trip name" });
  if (!name) return false;
  await refreshFiles();
  const ids = new Set(state.files.trips.map((t) => t.id));
  const id = slugify(name);
  if (ids.has(id) && id !== state.file.id) {
    const ok = await confirmDialog({ title: "Replace a saved trip?", body: `trips/${id}.json already exists. Saving here replaces it.`, ok: "Replace it", danger: true });
    if (!ok) return false;
  }
  state.trip.name = name;
  return write(id);
}

// ---------- open, new, copy, delete ----------

export async function newTrip() {
  if (!(await discardOk())) return;
  replaceTrip(emptyTrip(state.defaults));
  updateUi((u) => { u.view = "map"; });
}

export async function openTrip(id) {
  if (state.file.id === id && !state.file.dirty) return;
  if (!(await discardOk())) return;
  try {
    const doc = await api(`/api/trips/${id}`);
    await loadLibrary();
    const trip = tripFromFile(doc);
    replaceTrip(trip, { id, saved: true });
    if (trip.missingLibrary.length) flash(`${trip.missingLibrary.length} library zone${trip.missingLibrary.length === 1 ? "" : "s"} this trip used ${trip.missingLibrary.length === 1 ? "is" : "are"} no longer in the library`, "bad");
    updateUi((u) => { u.view = "map"; });
  } catch (e) {
    flash(`Could not open the trip: ${e.message}`, "bad");
  }
}

// An example opens as a new, unsaved trip: "Save" asks for a name.
export async function openExample(id) {
  if (!(await discardOk())) return;
  try {
    const doc = await api(`/api/examples/${id}`);
    await loadLibrary();
    replaceTrip(tripFromFile(doc));
    updateUi((u) => { u.view = "map"; });
  } catch (e) {
    flash(`Could not open the example: ${e.message}`, "bad");
  }
}

export async function copyExample(id) {
  try {
    const { id: newId, trip } = await api(`/api/examples/${id}/copy`, { method: "POST" });
    flash(`Copied to trips/${newId}.json`);
    await refreshFiles();
    return newId;
  } catch (e) {
    flash(`Could not copy the example: ${e.message}`, "bad");
  }
}

async function deleteTrip(id, name) {
  const ok = await confirmDialog({ title: "Delete this trip?", body: `“${escapeHtml(name)}” (trips/${id}.json) is deleted for good.${state.file.id === id ? " The trip on the screen stays, as an unsaved trip." : ""}`, ok: "Delete", danger: true });
  if (!ok) return;
  try {
    await api(`/api/trips/${id}`, { method: "DELETE" });
    if (state.file.id === id) { state.file.id = null; state.file.saved = null; touchTrip(); }
    flash(`Deleted “${name}”`);
    refreshFiles();
  } catch (e) {
    flash(`Could not delete: ${e.message}`, "bad");
  }
}

// ---------- the picker ----------

let panelOpen = false;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateRange(depart, arrive) {
  if (!depart) return "no date";
  const a = new Date(`${depart.slice(0, 10)}T12:00`), b = arrive ? new Date(`${arrive.slice(0, 10)}T12:00`) : a;
  const first = `${MON[a.getMonth()]} ${a.getDate()}`;
  if (+a === +b) return `${first}, ${a.getFullYear()}`;
  return a.getMonth() === b.getMonth() ? `${first}–${b.getDate()}, ${b.getFullYear()}` : `${first} – ${MON[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}
function savedText(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : `saved ${MON[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const entryMeta = (t) => [dateRange(t.depart, t.arrive), t.miles ? `${miles(t.miles)} mi` : "", t.days ? `${t.days} day${t.days === 1 ? "" : "s"}` : "", savedText(t.saved_at)].filter(Boolean).join(" · ");

export function renderPicker() {
  const btn = $("trip-btn");
  if (!btn) return;
  btn.querySelector(".nm").textContent = state.trip.name || "Trip";
  btn.querySelector(".unsaved").hidden = !state.file.dirty;
  btn.title = state.file.dirty ? "Unsaved changes" : state.file.id ? `trips/${state.file.id}.json` : "Not saved yet";
  $("btn-save").classList.toggle("primary", state.file.dirty);
  const panel = $("trip-panel");
  panel.hidden = !panelOpen;
  if (!panelOpen || panel.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  const { trips, examples, error } = state.files;
  const row = (t, mine) => `<div class="tr ${mine && t.id === state.file.id ? "cur" : ""}" data-${mine ? "open" : "ex"}="${t.id}">
      <div><div class="n">${escapeHtml(t.name)}${t.error ? ` <span class="chip bad">damaged</span>` : ""}</div><div class="meta">${t.error ? escapeHtml(t.error) : escapeHtml(entryMeta(t))}</div></div>
      <div class="acts">${mine ? `<button class="ib" data-del="${t.id}" data-name="${escapeHtml(t.name)}" title="Delete">✕</button>` : `<button class="btn sm" data-copy="${t.id}">Copy to my trips</button>`}</div></div>`;
  panel.innerHTML = `<div class="ph"><div class="sub">Trip name</div><input class="fld wide" id="trip-name" value="${escapeHtml(state.trip.name || "")}" spellcheck="false" aria-label="Trip name">
      <div class="sub">${state.file.id ? `File: trips/${escapeHtml(state.file.id)}.json${state.file.dirty ? " · unsaved changes" : ""}` : "Not saved yet: Save asks for a name."}</div></div>
    <h6>My trips</h6>${trips.length ? trips.map((t) => row(t, true)).join("") : `<div class="none">${error ? escapeHtml(error) : "No saved trips yet."}</div>`}
    <h6>Examples (read-only)</h6>${examples.map((t) => row(t, false)).join("") || `<div class="none">No examples.</div>`}
    <div class="pf"><button class="btn" id="pk-new">＋ New trip</button><button class="btn" id="pk-saveas">Save as…</button></div>`;
  panel.querySelectorAll("[data-open]").forEach((r) => r.addEventListener("click", (e) => { if (e.target.closest("[data-del]")) return; closePanel(); openTrip(r.dataset.open); }));
  panel.querySelectorAll("[data-ex]").forEach((r) => r.addEventListener("click", (e) => { if (e.target.closest("[data-copy]")) return; closePanel(); openExample(r.dataset.ex); }));
  panel.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteTrip(b.dataset.del, b.dataset.name)));
  panel.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyExample(b.dataset.copy)));
  $("pk-new").addEventListener("click", () => { closePanel(); newTrip(); });
  $("pk-saveas").addEventListener("click", () => { closePanel(); saveTripAs(); });
  const name = $("trip-name");
  name.addEventListener("change", () => { state.trip.name = name.value.trim() || "Trip"; touchTrip(); });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
}

function closePanel() { panelOpen = false; renderPicker(); }

export function initPicker() {
  $("trip-btn").addEventListener("click", async () => {
    panelOpen = !panelOpen;
    renderPicker();
    if (panelOpen) await refreshFiles();
  });
  document.addEventListener("mousedown", (e) => { if (panelOpen && !e.target.closest(".pick-wrap")) closePanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panelOpen) closePanel(); });
  $("btn-new").addEventListener("click", newTrip);
  $("btn-save").addEventListener("click", saveTrip);
  subscribe(renderPicker);
  refreshFiles();
}
