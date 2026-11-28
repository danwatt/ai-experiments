// Airports, runways and which runways are in use. Activity is inferred from
// traffic: aircraft lined up on an extended centreline, descending on roughly a
// 3° path, count as arrivals; aircraft climbing out past the far end, aligned
// with the runway, count as departures.
import { haversine, toLocal, fromLocal, angleDiff, compassPoint, M_PER_NM, MS_PER_KT } from "./geo.js";
import { api } from "./api.js";

const WINDOW = 20 * 60;          // seconds of events that make a runway "active"
const KEEP = 30 * 60;
const GLIDE_FT_PER_M = 0.172;    // 3° glide path ≈ 318 ft per nm
const APPROACH_LEN = 10 * M_PER_NM;
const DEPARTURE_LEN = 4 * M_PER_NM;

export class RunwayWatch {
  constructor() {
    this.airports = [];
    this.ends = [];
    this.events = new Map(); // `${apIdent}|${rwy}|arr|dep` -> [{t, hex}]
    this.counted = new Map(); // `${hex}|${key}` -> t, so one aircraft counts once per pass
    this.key = null;
  }

  async load(lat, lon, radiusNm) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${radiusNm}`;
    if (key === this.key) return;
    this.key = key;
    try {
      const body = await api.airports({ lat: lat.toFixed(3), lon: lon.toFixed(3), radius: radiusNm });
      this.setAirports(body.airports || []);
    } catch (e) {
      this.key = null; // retry on next call
      console.warn("airports unavailable:", e);
    }
  }

  setAirports(list) {
    this.airports = list;
    this.ends = [];
    for (const ap of list) {
      for (const rw of ap.runways) {
        const lengthM = haversine(rw.le.lat, rw.le.lon, rw.he.lat, rw.he.lon);
        for (const [a, b] of [[rw.le, rw.he], [rw.he, rw.le]]) {
          this.ends.push({
            key: `${ap.ident}|${a.ident}`, ap, ident: a.ident, lat: a.lat, lon: a.lon, hdg: a.hdg,
            elevFt: a.elevFt ?? ap.elevFt ?? 0, far: b, lengthM, runway: rw,
          });
        }
      }
    }
  }

  /** states: [{hex, lat, lon, alt, heading, vrate, gs, ground, rotor}] at server time `now`. */
  update(states, now) {
    for (const st of states) {
      // helicopters don't need runways; slow movers are taxiing or hovering
      if (st.ground || st.rotor || st.heading == null || (st.gs || 0) < 50) continue;
      let best = null; // one runway per aircraft: the best-aligned centreline (parallel runways are close)
      for (const e of this.ends) {
        if (Math.abs(e.lat - st.lat) > 0.25 || haversine(e.lat, e.lon, st.lat, st.lon) > 25e3) continue;
        if (Math.abs(angleDiff(st.heading, e.hdg)) > 20) continue;
        const { d, xt } = alongCross(e, st.lat, st.lon);
        const agl = st.alt - e.elevFt, vr = st.vrate || 0;
        let kind = null;
        if (d > -18.5e3 && d < 300 && Math.abs(xt) < 500 + 0.06 * Math.abs(d) &&
            agl < GLIDE_FT_PER_M * Math.abs(d) * 1.6 + 500 && vr < 400) kind = "arr";
        else if (d > e.lengthM * 0.5 && d < e.lengthM + 12e3 && Math.abs(xt) < 600 + 0.08 * Math.max(0, d - e.lengthM) &&
            agl < 5000 && (vr > 200 || agl < 1500)) kind = "dep";
        if (kind && (!best || Math.abs(xt) < best.xt)) best = { k: `${e.key}|${kind}`, xt: Math.abs(xt) };
      }
      if (!best) continue;
      const seen = `${st.hex}|${best.k}`;
      if (now - (this.counted.get(seen) || 0) < 15 * 60) continue;
      this.counted.set(seen, now);
      if (!this.events.has(best.k)) this.events.set(best.k, []);
      this.events.get(best.k).push({ t: now, hex: st.hex });
    }
    for (const [k, list] of this.events) {
      while (list.length && list[0].t < now - KEEP) list.shift();
      if (!list.length) this.events.delete(k);
    }
    for (const [k, t] of this.counted) if (t < now - KEEP) this.counted.delete(k);
  }

  /** Per airport: runways in use for arrivals / departures in the last WINDOW seconds. */
  activity(now) {
    const byAp = new Map();
    for (const e of this.ends) {
      for (const kind of ["arr", "dep"]) {
        const n = (this.events.get(`${e.key}|${kind}`) || []).filter((x) => x.t > now - WINDOW).length;
        if (!n) continue;
        if (!byAp.has(e.ap.ident)) byAp.set(e.ap.ident, { ap: e.ap, arr: [], dep: [] });
        byAp.get(e.ap.ident)[kind].push({ ident: e.ident, n, end: e });
      }
    }
    const out = [...byAp.values()];
    for (const a of out) {
      a.arr.sort((x, y) => y.n - x.n);
      a.dep.sort((x, y) => y.n - x.n);
      a.total = [...a.arr, ...a.dep].reduce((s, x) => s + x.n, 0);
      const lead = a.arr.length ? a.arr : a.dep;
      a.flow = `${compassPoint(circularMean(lead.map((x) => [x.end.hdg, x.n])))} flow`;
    }
    return out.sort((x, y) => y.total - x.total);
  }

  /** Is home under an active approach or departure path? Nearest centreline wins. */
  overhead(home, active) {
    let best = null;
    for (const a of active) {
      for (const [kind, list] of [["arrival", a.arr], ["departure", a.dep]]) {
        for (const r of list) {
          const { d, xt } = alongCross(r.end, home.lat, home.lon);
          const onPath = kind === "arrival" ? d < 0 && d > -30e3 : d > r.end.lengthM && d < r.end.lengthM + 20e3;
          if (!onPath || Math.abs(xt) > 2500) continue;
          const out = kind === "arrival" ? -d : d - r.end.lengthM;
          if (!best || Math.abs(xt) < Math.abs(best.xt)) {
            best = { kind, ap: a.ap, ident: r.ident, xt, outNm: out / M_PER_NM,
              aglFt: kind === "arrival" ? Math.round((GLIDE_FT_PER_M * out) / 100) * 100 : null };
          }
        }
      }
    }
    return best;
  }

  /**
   * What's about to happen at one airport, for the spotter view: aircraft lined up
   * on final (with seconds to the threshold) and departures holding, lined up or
   * rolling. Looser than the runway-in-use test so arrivals show up while still
   * ~20 nm out. Returns [{hex, kind: "arr"|"dep", ident, end, eta, state}].
   */
  movements(states, apIdent) {
    const ends = this.ends.filter((e) => e.ap.ident === apIdent);
    const out = [];
    for (const st of states) {
      let best = null;
      for (const e of ends) {
        if (Math.abs(e.lat - st.lat) > 0.4) continue;
        const { d, xt } = alongCross(e, st.lat, st.lon);
        const gs = st.gs || 0;
        const aligned = st.heading != null && Math.abs(angleDiff(st.heading, e.hdg)) < (st.ground ? 25 : 30);
        if (!st.ground) {
          if (st.rotor || !aligned || d < -40e3 || d > 200) continue;
          if (Math.abs(xt) > 1500 + 0.05 * Math.abs(d)) continue;
          if (st.alt - e.elevFt > GLIDE_FT_PER_M * Math.abs(d) * 2 + 1500 || (st.vrate || 0) > 500) continue;
          const eta = Math.max(0, -d / Math.max(30, (gs || 140) * MS_PER_KT));
          const state = d > -300 ? "landing" : "final"; // over the threshold or just past it
          if (!best || Math.abs(xt) < best.xt) best = { kind: "arr", end: e, ident: e.ident, eta, xt: Math.abs(xt), state };
        } else {
          const onRunway = d > -60 && d < e.lengthM && Math.abs(xt) < 45;
          if (gs > 40 && onRunway && aligned) {
            best = { kind: "dep", end: e, ident: e.ident, eta: 0, state: "rolling" };
          } else if (!best && gs < 25 && haversine(e.lat, e.lon, st.lat, st.lon) < 400) {
            best = { kind: "dep", end: e, ident: e.ident, eta: null, state: onRunway && aligned ? "lined up" : "holding" };
          }
        }
      }
      if (best) out.push({ ...best, hex: st.hex });
    }
    const rank = (m) => (m.kind === "dep" ? (m.state === "rolling" ? -1 : m.state === "lined up" ? 30 : 200) : m.eta);
    return out.sort((a, b) => rank(a) - rank(b));
  }

  /** Dashed guide lines: final approach (sloping up at 3°) and initial climb-out. */
  guides(active) {
    const out = [];
    for (const a of active) {
      for (const r of a.arr) {
        const e = r.end, back = fromLocal(e.lat, e.lon, ...scale(dirOf(e.hdg), -APPROACH_LEN));
        out.push({ kind: "arr", ap: a.ap, ident: r.ident, n: r.n,
          path: [[back[0], back[1], e.elevFt + GLIDE_FT_PER_M * APPROACH_LEN], [e.lon, e.lat, e.elevFt]] });
      }
      for (const r of a.dep) {
        const e = r.end, f = e.far, ahead = fromLocal(f.lat, f.lon, ...scale(dirOf(e.hdg), DEPARTURE_LEN));
        out.push({ kind: "dep", ap: a.ap, ident: r.ident, n: r.n,
          path: [[f.lon, f.lat, e.elevFt], [ahead[0], ahead[1], e.elevFt + 2500]] });
      }
    }
    return out;
  }
}

function dirOf(hdg) {
  const r = (hdg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function scale([x, y], k) {
  return [x * k, y * k];
}

/** Along-track (towards landing direction) and cross-track metres from a runway threshold. */
function alongCross(e, lat, lon) {
  const [x, y] = toLocal(e.lat, e.lon, lat, lon), [ux, uy] = dirOf(e.hdg);
  return { d: x * ux + y * uy, xt: x * uy - y * ux };
}

function circularMean(weighted) {
  let sx = 0, sy = 0;
  for (const [deg, w] of weighted) {
    sx += Math.sin((deg * Math.PI) / 180) * w;
    sy += Math.cos((deg * Math.PI) / 180) * w;
  }
  return ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
}
