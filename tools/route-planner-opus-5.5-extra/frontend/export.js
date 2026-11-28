// The export page (design screen 7): printable day sheets, a GPX file, and
// Google Maps links. All three work on the trip as it is on screen, saved or
// not: the page POSTs the trip, and the server plans it from the same cache
// /api/plan fills (backend/app/export/).

import { state, subscribe, updateUi, planBody } from "./state.js";
import { flash } from "./dialog.js";
import { escapeHtml, hm, miles } from "./edits.js";

const $ = (id) => document.getElementById(id);

// What the user picked here. Kept for the session, not in the trip.
const pick = { days: null, exits: true, strip: true, warnings: true, platform: "mobile", includeStops: true };
let sheetHtml = null; // the day sheets for the current picks, also shown in the preview
let links = null; // the Google Maps answer for the current picks
let loadedFor = null; // the key of the picks and trip the two above were made for
let busy = false;
let seq = 0;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (iso) => DAY_NAMES[new Date(`${iso}T12:00`).getDay()];
const plan = () => state.stops?.plan;
const drivingDays = () => (plan()?.days || []).filter((d) => d.driving);
const chosen = () => drivingDays().filter((d) => pick.days === null || pick.days.includes(d.day));

function body() {
  const days = chosen().map((d) => d.day);
  return {
    ...planBody(state.trip), name: state.trip.name || "Road trip", only_days: pick.days === null ? null : days,
    parts: { exits: pick.exits, strip: pick.strip, warnings: pick.warnings }, platform: pick.platform, include_stops: pick.includeStops,
  };
}

async function post(path) {
  const resp = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error?.message || JSON.stringify(e.detail || e) || resp.statusText);
  }
  return resp;
}

const keyOf = () => JSON.stringify([state.rev, pick, state.stops ? 1 : 0]);

// Fetch what the page shows (the sheet preview and the links) for the current picks.
async function refresh() {
  if (!plan() || state.ui.view !== "export") return;
  const key = keyOf();
  if (key === loadedFor || busy && key === refresh.asked) return;
  refresh.asked = key;
  const mine = ++seq;
  busy = true;
  render();
  try {
    const [sheet, gm] = await Promise.all([post("/api/export/sheet").then((r) => r.text()), post("/api/export/gmaps").then((r) => r.json())]);
    if (mine !== seq) return;
    sheetHtml = sheet;
    links = gm;
    loadedFor = key;
    refresh.error = null;
  } catch (e) {
    if (mine !== seq) return;
    refresh.error = e.message;
  }
  busy = false;
  render();
}

// ---------- the three outputs ----------

function openSheets() {
  if (!sheetHtml) return;
  const url = URL.createObjectURL(new Blob([sheetHtml], { type: "text/html" }));
  const w = window.open(url, "_blank");
  if (!w) flash("The browser blocked the new tab. Allow pop-ups for this page and try again.", "bad");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function saveGpx() {
  try {
    const resp = await post("/api/export/gpx");
    const name = /filename="([^"]+)"/.exec(resp.headers.get("content-disposition") || "")?.[1] || "trip.gpx";
    const url = URL.createObjectURL(await resp.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    flash(`Saved ${name}`);
  } catch (e) {
    flash(`Could not make the GPX file: ${e.message}`, "bad");
  }
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  const was = button.textContent;
  button.textContent = "✓ Copied";
  setTimeout(() => { button.textContent = was; }, 1500);
}

// ---------- the page ----------

const WAYPOINT_TYPES = ["start", "through", "break", "lunch", "dinner", "fuel", "stop", "overnight", "end"];

function gpxSummary() {
  const days = chosen();
  const rows = new Set();
  const key = (r) => (["break", "lunch", "dinner", "fuel"].includes(r.type) ? `${r.type}:${r.id}:${r.mile}` : r.id);
  for (const d of days) {
    for (const r of plan().rows) {
      if (WAYPOINT_TYPES.includes(r.type) && r.mile >= d.start_mile - 0.01 && r.mile <= d.end_mile + 0.01) rows.add(key(r));
    }
  }
  const slug = (state.trip.name || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trip";
  return `${slug}.gpx · ${days.length} track${days.length === 1 ? "" : "s"} · ${rows.size} waypoints`;
}

const check = (on, label, attr, dim = false) => `<div class="ck ${dim ? "dim" : ""}" ${dim ? "" : `data-ck="${attr}"`}><i class="${on ? "on" : ""}">${on ? "✓" : ""}</i>${label}</div>`;

function sheetsCard() {
  const days = plan().days;
  const dayRows = days.map((d) => d.driving
    ? check(pick.days === null || pick.days.includes(d.day), `Day ${d.day} · ${dayName(d.date)} · ${escapeHtml(d.start)} → ${escapeHtml(d.end)}`, `day:${d.day}`)
    : check(false, `Day ${d.day} · ${dayName(d.date)} · no driving${d.at ? ` (${escapeHtml(d.at)})` : ""}`, "", true)).join("");
  const n = chosen().length;
  return `<div class="card"><h4>🖨 Day sheets</h4>${dayRows}
    <div style="border-top:1px solid var(--rule);margin:6px 0 4px"></div>
    ${check(pick.exits, "Exit numbers and what is there", "exits")}${check(pick.strip, "Mile strip", "strip")}${check(pick.warnings, "Road notes and heads-ups", "warnings")}
    <div class="acts"><button class="btn primary" id="exp-sheets" ${n && sheetHtml ? "" : "disabled"}>🖨 Open ${n} day sheet${n === 1 ? "" : "s"} to print</button>
      <span class="sub">opens a new tab; use the browser's Print there</span></div></div>`;
}

function gpxCard() {
  return `<div class="card"><h4>📍 GPX file</h4>
    <div class="txt">The route as a track (one per driving day) and every stop and waypoint as a waypoint with its local arrival time, for a phone app or a Garmin.</div>
    <div class="acts"><button class="btn" id="exp-gpx" ${chosen().length ? "" : "disabled"}>💾 Save GPX</button><span class="sub">${escapeHtml(gpxSummary())}</span></div></div>`;
}

function mapsCard() {
  const limit = pick.platform === "mobile" ? 3 : 9;
  const days = (links?.days || []).map((d) => {
    const rows = d.links.map((l, i) => `<div class="linkrow"><span>${d.links.length > 1 ? `Part ${i + 1} of ${d.links.length}` : "Link"}<small>${escapeHtml(l.from)} → ${escapeHtml(l.to)}${l.waypoints ? ` · ${l.waypoints} stop${l.waypoints === 1 ? "" : "s"} in between` : ""}</small></span>
        <span class="acts" style="padding:0"><button class="btn sm" data-copy="${escapeHtml(l.url)}">⧉ Copy link</button><a class="btn sm" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">Open ↗</a></span></div>`).join("");
    return `<div style="padding-top:6px"><b>Day ${d.day}</b> <span class="sub">· ${escapeHtml(d.title.split("· ")[1] || "")} · ${d.stops} stop${d.stops === 1 ? "" : "s"}</span>${d.note ? `<div class="help" style="color:var(--warn-text)">${escapeHtml(d.note)}</div>` : ""}${rows}</div>`;
  }).join("");
  return `<div class="card"><h4>🗺 Google Maps</h4>
    <div class="txt">One link per driving day, for turn-by-turn on the phone. Your through points are sent as waypoints so Google drives the same roads.</div>
    <div class="fr stack"><span>Open the links on<span class="help">Google takes up to <b>3</b> waypoints per link on a phone browser and <b>9</b> elsewhere (<a href="https://developers.google.com/maps/documentation/urls/get-started" target="_blank" rel="noopener" style="color:var(--accent-text)">Maps URLs documentation</a>). A longer day is split into links that follow each other.</span></span>
      <span class="seg"><button data-platform="mobile" class="${pick.platform === "mobile" ? "on" : ""}">Phone (3)</button><button data-platform="desktop" class="${pick.platform === "desktop" ? "on" : ""}">Computer (9)</button></span></div>
    <div class="fr"><span>Include the planned breaks, meals and fuel<span class="help">Off: only your own waypoints and through points</span></span><button class="tg ${pick.includeStops ? "on" : ""}" data-includestops aria-pressed="${pick.includeStops}" aria-label="Include planned stops"></button></div>
    ${days || `<div class="sub" style="padding-top:6px">${busy ? "Making the links…" : "No links yet."}</div>`}
    <div class="note-warn">Google may still route between the points differently from this planner: it has its own roads, speeds and traffic. With ${limit} waypoints per link the links keep it close; the day's route on the map here is the one this plan's times are for.</div></div>`;
}

function fileCard() {
  const f = state.file;
  return `<div class="card"><h4>📂 Trip file</h4>
    <div class="txt">${f.id ? `trips/${escapeHtml(f.id)}.json` : "Not saved yet"}</div>
    <div class="sub">${f.dirty ? "These exports use the trip as it is on screen, including its unsaved changes." : f.id ? "Saved: the exports match the file. It is plain JSON, safe to keep in git." : "Exports work on an unsaved trip too."}</div></div>`;
}

export function renderExport() {
  const el = $("view-export");
  if (state.ui.view !== "export") { el.hidden = true; return; }
  el.hidden = false;
  const p = plan();
  const side = !p
    ? `<div class="card"><div class="txt">${state.stopsLoading || state.routing ? "Planning the trip…" : "There is no plan to export yet: add at least two waypoints on the map."}</div></div>`
    : sheetsCard() + gpxCard() + mapsCard() + fileCard();
  const preview = !p ? "" : refresh.error ? `<div class="none"><div class="err">⚠ ${escapeHtml(refresh.error)}</div></div>` : sheetHtml ? "" : `<div class="none">Making the day sheets…</div>`;
  if (!el.firstChild || !el.querySelector("iframe")) {
    el.innerHTML = `<div class="preview"><iframe title="Day sheets preview" id="exp-frame"></iframe><div id="exp-msg"></div></div><div class="expside" id="exp-side"></div>`;
  }
  $("exp-msg").innerHTML = preview;
  const frame = $("exp-frame");
  frame.hidden = !sheetHtml;
  if (sheetHtml && frame.dataset.for !== loadedFor) { frame.srcdoc = sheetHtml; frame.dataset.for = loadedFor; }
  $("exp-side").innerHTML = `<div class="set-head" style="margin:0"><button class="btn quiet" id="exp-back">← Back to map</button></div><h3>Export · ${escapeHtml(state.trip.name || "Trip")}</h3>${side}`;
  wire();
}

function wire() {
  $("exp-back").addEventListener("click", () => updateUi((u) => { u.view = "map"; }));
  $("exp-sheets")?.addEventListener("click", openSheets);
  $("exp-gpx")?.addEventListener("click", saveGpx);
  document.querySelectorAll("#exp-side [data-ck]").forEach((c) => c.addEventListener("click", () => {
    const k = c.dataset.ck;
    if (k.startsWith("day:")) {
      const n = parseInt(k.slice(4), 10);
      const all = drivingDays().map((d) => d.day);
      const cur = pick.days === null ? all : pick.days;
      const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b);
      pick.days = next.length === all.length ? null : next;
    } else pick[k] = !pick[k];
    refreshSoon();
    render();
  }));
  document.querySelectorAll("[data-platform]").forEach((b) => b.addEventListener("click", () => { pick.platform = b.dataset.platform; refreshSoon(); render(); }));
  document.querySelector("[data-includestops]")?.addEventListener("click", () => { pick.includeStops = !pick.includeStops; refreshSoon(); render(); });
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, b)));
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 150);
}

const render = renderExport;

export function initExport() {
  subscribe(() => {
    if (state.ui.view === "export") { renderExport(); refreshSoon(); }
    else $("view-export").hidden = true;
  });
}

// For the toolbar: open the page, and ask for what it shows.
export function showExport() {
  updateUi((u) => { u.view = "export"; });
  refreshSoon();
}
