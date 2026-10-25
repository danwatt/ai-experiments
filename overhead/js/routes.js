// Origin / destination: fetched per callsign from the backend (community route
// databases), then checked against what the aircraft is actually doing. Flight
// numbers are reused across legs and days, so the database answer is a guess.
import { haversine, bearing, angleDiff, R_EARTH } from "./geo.js";

const RETRY_ERROR_MS = 5 * 60e3;
const BATCH = 25;

export class RouteBook {
  constructor() {
    this.entries = new Map(); // callsign -> {status, candidates?, at}
    this.queue = new Set();
    this.busy = false;
  }

  entry(cs) {
    return this.entries.get(cs);
  }

  want(cs) {
    const e = this.entries.get(cs);
    if (!e || (e.status === "error" && Date.now() - e.at > RETRY_ERROR_MS)) this.queue.add(cs);
  }

  async pump() {
    if (this.busy || !this.queue.size) return;
    const batch = [...this.queue].slice(0, BATCH);
    for (const cs of batch) {
      this.queue.delete(cs);
      this.entries.set(cs, { status: "pending", at: Date.now() });
    }
    this.busy = true;
    try {
      const res = await fetch(`/api/routes?callsigns=${encodeURIComponent(batch.join(","))}`);
      const body = await res.json();
      for (const cs of batch) this.entries.set(cs, { ...(body.routes?.[cs] || { status: "error" }), at: Date.now() });
    } catch {
      for (const cs of batch) this.entries.set(cs, { status: "error", at: Date.now() });
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Pick the candidate leg that best fits the aircraft's state and grade it.
 * st: {lat, lon, alt (ft), heading, vrate (fpm), ground}
 * Returns null when there is nothing to assess.
 */
export function assessRoute(entry, st) {
  if (!entry || entry.status !== "ok" || !st) return null;
  let best = null;
  for (const cand of entry.candidates) {
    const ap = cand.airports.filter((a) => a.lat != null && a.lon != null);
    for (let i = 0; i < ap.length - 1; i++) {
      const r = scoreLeg(ap[i], ap[i + 1], st);
      if (!best || r.score > best.score) best = { ...r, origin: ap[i], dest: ap[i + 1], source: cand.source };
    }
  }
  if (!best) return null;
  const sameLeg = (c) => c.airports.some((a, i) =>
    i < c.airports.length - 1 && a.icao === best.origin.icao && c.airports[i + 1].icao === best.dest.icao);
  best.sources = entry.candidates.filter(sameLeg).map((c) => c.source);
  if (best.sources.length > 1) {
    best.score += 0.5;
    best.why.push("sources agree");
  }
  best.confidence = best.score >= 2 ? "likely" : best.score >= 1 ? "possible" : "unlikely";
  best.alternatives = entry.candidates
    .map((c) => c.airports.map(apCode).join("→"))
    .filter((r, i, all) => all.indexOf(r) === i);
  return best;
}

function scoreLeg(A, B, st) {
  const D = haversine(A.lat, A.lon, B.lat, B.lon);
  const dA = haversine(A.lat, A.lon, st.lat, st.lon);
  const dB = haversine(st.lat, st.lon, B.lat, B.lon);
  const nearA = dA < 40e3, nearB = dB < 40e3;
  const vr = st.vrate || 0;
  let score = 0;
  const why = [];

  // Distance off the great circle A→B, and how far along it.
  const d13 = dA / R_EARTH, dt = ((bearing(A.lat, A.lon, st.lat, st.lon) - bearing(A.lat, A.lon, B.lat, B.lon)) * Math.PI) / 180;
  const xtd = Math.asin(Math.sin(d13) * Math.sin(dt)) * R_EARTH;
  const atd = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xtd / R_EARTH)))) * R_EARTH * Math.sign(Math.cos(dt) || 1);
  const within = (m) => atd > -m && atd < D + m;
  if (Math.abs(xtd) < Math.max(30e3, D * 0.06) && within(30e3)) { score += 1; why.push("on the way"); }
  else if (Math.abs(xtd) > Math.max(120e3, D * 0.2) || !within(150e3)) { score -= 2; why.push("off the route"); }

  // Low and close to one end of the leg: almost certainly departing or arriving there.
  const nearEnd = Math.min(dA, dB) < 80e3;
  if (st.ground) {
    if (Math.min(dA, dB) > 20e3) { score -= 2; why.push("on the ground elsewhere"); }
  } else if (nearEnd && st.alt < 18000) { score += 1; why.push(`low near ${dA < dB ? "origin" : "destination"}`); }
  else if (!nearEnd && st.alt < 8000 && D > 300e3) { score -= 1; why.push("low, far from either airport"); }

  // Heading toward the destination (skipped near airports, where it manoeuvres).
  if (!st.ground && !nearA && !nearB && st.heading != null) {
    const off = Math.abs(angleDiff(st.heading, bearing(st.lat, st.lon, B.lat, B.lon)));
    if (off < 45) { score += 1; why.push("heading toward destination"); }
    else if (off > 120) { score -= 2; why.push("flying away from destination"); }
  }

  // Flight phase: descending into the destination, climbing out of the origin.
  if (dB < 150e3 && (st.ground || vr < -300 || st.alt < 10000)) { score += 1; why.push("descending near destination"); }
  if (dA < 150e3 && (st.ground || vr > 300)) { score += 1; why.push("climbing out of origin"); }
  if (dB < 150e3 && dA > 150e3 && vr > 1000 && st.alt > 5000) { score -= 1; why.push("climbing away near destination"); }

  return { score, why, dA, dB, D };
}

export function apCode(a) {
  return a?.iata || a?.icao || "?";
}

export function routeText(r) {
  return r ? `${apCode(r.origin)}→${apCode(r.dest)}` : "";
}

/** A route good enough to show without caveats. */
export function shownRoute(r) {
  return r && r.confidence !== "unlikely" ? r : null;
}
