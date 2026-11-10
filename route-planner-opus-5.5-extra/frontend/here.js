// "Start from here, now": use the planner during the trip.
//
// Takes the car's position (the browser's geolocation, or a click on the map)
// and asks the server what that does to the trip (backend/app/here.py): the
// position becomes the new start, departing now; waypoints and stops already
// passed go; the rest, with the settings, zones, pins and skips ahead, stays.
// Nothing changes until the user confirms.

import { state, updateTrip, updateUi, planBody } from "./state.js";
import { choose } from "./dialog.js";
import { flash } from "./dialog.js";
import { pickOnMap, fitTrip } from "./map.js";
import { escapeHtml, miles } from "./edits.js";

const $ = (id) => document.getElementById(id);

export function initHere() {
  $("btn-here").addEventListener("click", startFromHere);
}

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("this browser has no geolocation"));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), (e) => reject(new Error(e.message || "no position")), { enableHighAccuracy: true, timeout: 15000 });
  });
}

async function ask(lat, lon, mile) {
  const resp = await fetch("/api/trip/start-from-here", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip: planBody(state.trip), lat, lon, now: new Date().toISOString(), mile: mile ?? null }),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error?.message || JSON.stringify(body.detail || body));
  return body;
}

export async function startFromHere() {
  if (!state.route || state.trip.waypoints.length < 2) { flash("Plan a route first: there is nothing to start from yet.", "bad"); return; }
  updateUi((u) => { u.view = "map"; });
  const how = await choose({
    title: "Start from here, now",
    body: "Make where you are the new start of the trip, leaving now. Waypoints and stops you have passed are dropped. The rest of the trip, the settings, and the pins, skips and zones ahead stay as they are.<br><span class='dim'>Nothing changes until you confirm on the next screen.</span>",
    buttons: [{ label: "📍 Use my position", value: "gps", kind: "primary" }, { label: "🖱 Click the route", value: "click" }, { label: "Cancel", value: null, kind: "quiet" }],
  });
  if (!how) return;
  let spot;
  if (how === "gps") {
    try {
      spot = await position();
    } catch (e) {
      flash(`Could not get your position (${e.message}). Choose “Click the route” instead.`, "bad");
      return;
    }
  } else {
    spot = await pickOnMap("<b>Start from here</b> · click the map where you are (Esc cancels)");
    if (!spot) return;
  }
  try {
    let out = await ask(spot.lat, spot.lng);
    if (out.ambiguous) {
      const mile = await choose({
        title: "Which pass of the route?",
        body: "The route goes through this spot more than once (a loop). Where are you on it?",
        buttons: [...out.passes.map((p, i) => ({ label: `Mile ${miles(p.mile)} · ${i === 0 ? "first" : i === 1 ? "second" : `pass ${i + 1}`} pass`, value: p.mile, kind: i === 0 ? "primary" : "" })), { label: "Cancel", value: null, kind: "quiet" }],
      });
      if (mile === null) return;
      out = await ask(spot.lat, spot.lng, mile);
    }
    await confirmChange(out, spot);
  } catch (e) {
    flash(e.message, "bad");
  }
}

async function confirmChange(out, spot) {
  const d = out.dropped;
  const list = (title, items) => (items.length ? `<li>${title}: ${items.map(escapeHtml).join(", ")}</li>` : "");
  const when = new Date(out.depart);
  const body = `<ul>
      <li>You are at mile <b>${miles(out.mile)}</b>${out.off_m > 300 ? ` (${(out.off_m / 1609.344).toFixed(1)} mi from the route line)` : ""}; <b>${miles(out.miles_left)} mi</b> to go.</li>
      <li>The trip starts at your position and leaves <b>now</b>, ${isNaN(when) ? out.depart : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} local time there.</li>
      ${list("Waypoints dropped (already passed)", d.waypoints)}${list("Pins dropped", d.pins)}${list("Skips dropped", d.skips)}
      <li>${out.waypoints.length - 1} waypoint${out.waypoints.length === 2 ? "" : "s"} ahead stay. The tank is assumed full.</li>
    </ul><div class="dim" style="margin-top:6px">The trip then counts as changed: Save overwrites the saved file, Save as keeps the original too.</div>`;
  const ok = await choose({ title: "Start from here?", body, buttons: [{ label: "Start from here", value: true, kind: "primary" }, { label: "Cancel", value: null, kind: "quiet" }] });
  if (!ok) return;
  updateTrip((t) => {
    t.waypoints = out.waypoints;
    t.depart = out.depart;
    t.breaks.pins = out.pins;
    t.breaks.skips = out.skips;
  });
  updateUi((u) => { u.day = 1; u.selected = null; });
  setTimeout(fitTrip, 600);
  flash("The trip now starts from your position, leaving now.");
}
