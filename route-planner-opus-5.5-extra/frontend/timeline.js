// The day strip under the map: one day of the plan on a clock axis. Driving
// blocks, stop blocks (breaks, meals, fuel and timed stops), the lunch and
// dinner windows, the start and end (an overnight as a 🛏 block), through
// points, clock changes, sunset, when each break falls due, and the open
// picker's window. A chip per day on the left switches days. The axis is
// local time; after a clock change it jumps with the clock.

import { state, updateUi } from "./state.js";
import { letter, hm, clockOf, escapeHtml } from "./edits.js";
import { selectBreak } from "./map.js";

const $ = (id) => document.getElementById(id);
const LEFT = 104, RIGHT = 14;
const PLANNED = {
  break: { icon: "☕", cls: "", word: "Break" },
  lunch: { icon: "🍴", cls: "meal", word: "Lunch" },
  dinner: { icon: "🍴", cls: "meal", word: "Dinner" },
  fuel: { icon: "⛽", cls: "fuel", word: "Fuel" },
};

// Minutes since midnight of `date` ("2027-09-24") for a local ISO time.
const minutesOf = (iso, date) => (new Date(iso) - new Date(`${date}T00:00`)) / 60000;

// The rows of one day, in order: from the start (or leaving an overnight) to
// the end (or arriving at the next overnight).
function dayRows(plan, day) {
  return plan.rows.filter((r) => (r.type === "overnight" ? r.day === day || r.depart_day === day : r.day === day));
}

export function renderDayStrip() {
  const el = $("daystrip");
  const plan = state.stops?.plan;
  el.hidden = !plan || !state.route;
  if (el.hidden) return;
  const days = plan.days;
  const d = days.find((x) => x.day === state.ui.day) || days[0];
  const short = (x) => new Date(`${x.date}T12:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
  const chips = days.map((x) => `<button class="tl-day ${x.day === d.day ? "on" : ""} ${x.driving ? "" : "rest"}" data-day="${x.day}" title="${x.driving ? hm(x.driving_minutes) + " driving" : "no driving"}">Day ${x.day} · ${short(x)}</button>`).join("");
  const date = new Date(`${d.date}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  let h = `<div class="tl-left">${days.length > 1 ? chips : `<b>Day ${d.day}</b><span>${date}</span>`}</div>`;
  if (!d.driving) {
    el.innerHTML = h + `<div class="tl-empty">No driving: a day in ${escapeHtml(d.at)}.</div>`;
    wire(el);
    return;
  }

  const rows = dayRows(plan, d.day);
  const leaveOf = (r) => (r.type === "overnight" && r.depart_day === d.day ? r.depart : r.type === "start" ? r.depart : r.arrive);
  const first = minutesOf(leaveOf(rows[0]), d.date);
  const dueToday = plan.due.filter((x) => x.day === d.day);
  const lastDue = Math.max(...dueToday.map((x) => minutesOf(x.clock, d.date)), 0);
  const end = minutesOf(d.arrive, d.date);
  const from = Math.floor((first - 20) / 60) * 60, to = Math.max(end + 70, Math.min(lastDue + 10, end + 90));
  const W = el.clientWidth;
  const X = (t) => LEFT + ((t - from) / (to - from)) * (W - LEFT - RIGHT);

  // The meal windows, laid on the clock axis.
  const meals = plan.meals;
  for (const name of ["lunch", "dinner"]) {
    const m = meals[name];
    if (!m.on) continue;
    const a = Math.max(minutesOf(`${d.date}T${m.start}`, d.date), from), b = Math.min(minutesOf(`${d.date}T${m.end}`, d.date), to);
    if (b > a) h += `<div class="tl-meal" style="left:${X(a)}px;width:${X(b) - X(a)}px"><span>${name} ${m.start}–${m.end}</span></div>`;
  }
  const sel = state.ui.selectedBreak && plan.rows.find((r) => r.stop_key === state.ui.selectedBreak);
  if (sel?.window && sel.day === d.day) {
    const a = X(minutesOf(sel.window.earliest_clock, d.date)), b = X(minutesOf(sel.window.latest_clock, d.date));
    h += `<div class="tl-win" style="left:${a}px;width:${b - a}px"><span>${sel.window.meal || "break"} window ${clockOf(sel.window.earliest_clock)}–${clockOf(sel.window.latest_clock)}</span></div>`;
  }
  if (d.sunset) {
    const t = minutesOf(d.sunset, d.date);
    if (t <= to) h += `<span class="tl-sun" style="left:${X(t)}px"><span>🌇 ${clockOf(d.sunset)}</span></span>`;
  }

  let prevLeave = null;
  rows.forEach((r) => {
    const leaving = r.type === "overnight" && r.depart_day === d.day;
    const arrive = leaving || r.type === "start" ? null : minutesOf(r.arrive, d.date);
    if (prevLeave !== null && arrive !== null) {
      const w = X(arrive) - X(prevLeave);
      h += `<div class="tl-blk tl-drive" style="left:${X(prevLeave)}px;width:${Math.max(w - 1, 3)}px">${w > 48 ? hm(arrive - prevLeave) : ""}</div>`;
    }
    const i = state.trip.waypoints.findIndex((wp) => wp.id === r.id);
    const planned = PLANNED[r.type];
    if (planned || r.type === "stop") {
      const leave = minutesOf(r.depart, d.date);
      const cls = planned ? ["tl-stop", planned.cls, r.pinned ? "pinned" : "", state.ui.selectedBreak === r.stop_key ? "sel" : ""].join(" ") : "tl-stop wp";
      const width = X(leave) - X(arrive);
      const label = planned ? planned.icon + (r.refuel && r.type !== "fuel" ? "⛽" : "") + (width > 40 && r.type !== "break" ? ` ${hm(r.dwell)}` : "") : `${letter(i)} ${hm(r.dwell)}`;
      h += `<div class="tl-blk ${cls}" ${planned ? `data-brk="${r.stop_key}"` : ""} title="${escapeHtml(planned ? planned.word + " · " : "")}${escapeHtml(r.name)} · ${clockOf(r.arrive)}–${clockOf(r.depart)}" style="left:${X(arrive)}px;width:${Math.max(width - 1, 6)}px">${label}</div>`;
      prevLeave = leave;
    } else if (r.type === "clock") {
      h += `<span class="tl-clock" style="left:${X(arrive)}px" title="Clock change at mile ${r.mile}"><span>🕐 ${escapeHtml(r.tz)} (was ${clockOf(r.before)})</span></span>`;
      prevLeave = arrive;
    } else if (r.type === "through") {
      h += `<span class="tl-thru" style="left:${X(arrive)}px" title="${escapeHtml(r.name)}"></span>`;
      prevLeave = arrive;
    } else if (leaving || r.type === "start") {
      prevLeave = minutesOf(leaving ? r.depart : r.depart, d.date);
      h += `<span class="tl-end" style="left:${X(prevLeave)}px" title="${escapeHtml(r.name)}">${i >= 0 ? letter(i) : "🛏"}</span>`;
    } else if (r.type === "overnight") {
      h += `<span class="tl-night" ${r.auto ? `data-brk="${r.stop_key}"` : ""} style="left:${X(arrive)}px" title="${escapeHtml(r.name)}${r.hotel_dinner ? " · dinner near the hotel" : ""}">🛏 ${i >= 0 ? letter(i) : escapeHtml(r.name.split(" (")[0].slice(0, 12))}${r.hotel_dinner ? " 🍴" : ""}</span>`;
    } else {
      h += `<span class="tl-end" style="left:${X(arrive)}px" title="${escapeHtml(r.name)}">${letter(i)}</span>`;
    }
  });
  for (const due of dueToday) {
    const t = minutesOf(due.clock, d.date);
    if (t <= to) h += `<span class="tl-due" style="left:${X(t)}px"><span>due ${clockOf(due.clock)}</span></span>`;
  }
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) {
    h += `<span class="tl-tick" style="left:${X(t)}px">${String(Math.floor(t / 60) % 24).padStart(2, "0")}:00</span>`;
  }
  el.innerHTML = h;
  wire(el);
}

function wire(el) {
  el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => updateUi((u) => { u.day = parseInt(b.dataset.day, 10); })));
  el.querySelectorAll("[data-brk]").forEach((b) => b.addEventListener("click", () => selectBreak(b.dataset.brk, { pan: true })));
}
