// Traffic store: polls the backend, keeps a short position history per
// aircraft, and answers "where was aircraft X at time T?" with smooth
// interpolation (delayed mode) or dead reckoning (live mode).
import { classify } from "./classify.js";
import { api } from "./api.js";
import { toLocal, fromLocal, lerpAngle, angleDiff, haversine, destination, MS_PER_KT } from "./geo.js";

const DROP_AFTER = 75;          // seconds unseen before a track is removed
const MAX_KT = 1400;            // reject position jumps faster than this (bad decodes)

export class TrafficStore {
  constructor() {
    this.tracks = new Map();
    this.keepSeconds = 15 * 60; // history kept for trails / delay; raised to fit trail settings
    this.offset = 0;            // serverTime - Date.now()/1000
    this.offsetReady = false;
    this.meta = null;           // last response metadata
    this.lastOk = 0;            // client ms of last good response
    this.error = null;
    this.interval = 2;
    this.onUpdate = () => {};
    this._timer = null;
    this._gen = 0;
  }

  serverNow() {
    return Date.now() / 1000 + this.offset;
  }

  configure({ provider, lat, lon, radius }) {
    const sameArea = this.cfg && this.cfg.provider === provider &&
      haversine(this.cfg.lat, this.cfg.lon, lat, lon) < 2000 && this.cfg.radius === radius;
    this.cfg = { provider, lat, lon, radius };
    if (!sameArea) this.tracks.clear();
    this._gen++;
    clearTimeout(this._timer);
    this._poll(this._gen, 0);
  }

  stop() {
    this._gen++;
    clearTimeout(this._timer);
  }

  async _poll(gen, failures) {
    if (gen !== this._gen) return;
    const { provider, lat, lon, radius } = this.cfg;
    let delay = this.interval;
    try {
      const body = await api.aircraft({ provider, lat: lat.toFixed(2), lon: lon.toFixed(2), radius: Math.round(radius) });
      if (gen !== this._gen) return;
      if (body.aircraft?.length || body.ok) this.ingest(body);
      this.error = body.ok ? null : body.error || "Upstream error";
      if (body.ok) this.lastOk = Date.now();
      this.interval = Math.max(2, body.interval || 2);
      delay = body.ok ? this.interval : Math.min(60, this.interval * 2 ** (failures + 1));
      failures = body.ok ? 0 : failures + 1;
    } catch (e) {
      if (gen !== this._gen) return;
      this.error = "Backend unreachable — is server.py running?";
      failures++;
      delay = Math.min(30, 2 * 2 ** failures);
    }
    this.onUpdate(this);
    this._timer = setTimeout(() => this._poll(gen, failures), delay * 1000);
  }

  ingest(body) {
    const now = body.now;
    // A demo recording that wrapped around: aircraft jump back to where they started.
    if (body.loop != null && body.loop !== this.loop) {
      this.loop = body.loop;
      this.tracks.clear();
    }
    // Clock offset: server snapshot time vs our receipt time, lightly smoothed.
    // Stale (cached-after-error) bodies carry an old `now`, so skip those.
    const est = now - Date.now() / 1000;
    if (body.ok) {
      if (!this.offsetReady || Math.abs(est - this.offset) > 5) this.offset = est;
      else this.offset += (est - this.offset) * 0.15;
      this.offsetReady = true;
    }
    this.meta = body;

    for (const a of body.aircraft) {
      if (!a.hex) continue;
      classify(a);
      let tr = this.tracks.get(a.hex);
      if (!tr) {
        tr = { hex: a.hex, samples: [], firstSeen: now };
        this.tracks.set(a.hex, tr);
      }
      if (a.alt == null && tr.info) a.alt = tr.info.alt;
      tr.info = a;
      tr.lastSeen = now;
      const s = tr.samples, last = s[s.length - 1];
      if (last && a.posTime <= last.t + 0.1) continue;
      if (last) {
        const dt = a.posTime - last.t;
        const kt = haversine(last.lat, last.lon, a.lat, a.lon) / dt / MS_PER_KT;
        if (kt > MAX_KT && dt < 120) continue;
      }
      s.push({ t: a.posTime, lat: a.lat, lon: a.lon, alt: a.alt ?? 0, track: a.track, gs: a.gs, vrate: a.vrate || 0, ground: a.ground });
      while (s.length > 2 && s[0].t < now - this.keepSeconds) s.shift();
    }
    for (const [hex, tr] of this.tracks) {
      if (tr.lastSeen < now - DROP_AFTER - 90) this.tracks.delete(hex);
    }
  }

  /**
   * State of a track at server time T.
   * maxExtrap: how far past the newest sample we dead-reckon before holding.
   */
  stateAt(tr, T, maxExtrap) {
    const s = tr.samples, n = s.length;
    if (!n) return null;
    let st;
    if (T >= s[n - 1].t) {
      const dt = Math.min(T - s[n - 1].t, maxExtrap);
      st = deadReckon(s[n - 1], dt);
      st.age = T - s[n - 1].t;
    } else if (T <= s[0].t) {
      // Before our first sample: run it backwards so new arrivals glide in.
      if (s[0].t - T > 90) return null;
      st = deadReckon(s[0], Math.max(T - s[0].t, -60));
      st.age = 0;
    } else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (s[mid].t <= T) lo = mid; else hi = mid;
      }
      st = hermite(s[lo], s[hi], T);
      st.age = 0;
    }
    return st;
  }

  /** Trail points [lon, lat, altFt, t] from T0 up to the live head (inclusive). */
  trail(tr, T0, head) {
    const pts = [];
    for (const p of tr.samples) {
      if (p.t < T0) continue;
      if (p.t >= head.t) break;
      pts.push([p.lon, p.lat, p.alt, p.t]);
    }
    pts.push([head.lon, head.lat, head.alt, head.t]);
    return pts;
  }
}

/** Fade length: the configured trail, or the oldest point drawn when showing all history. */
export function trailSpan(items, len, now) {
  if (len) return len;
  return Math.max(1, ...items.map((d) => now - d.trail[0][3]));
}

function velocity(p) {
  if (p.gs == null || p.track == null) return null;
  const v = p.gs * MS_PER_KT, r = (p.track * Math.PI) / 180;
  return [v * Math.sin(r), v * Math.cos(r)];
}

function deadReckon(p, dt) {
  const v = p.gs && p.track != null && !p.ground ? p.gs * MS_PER_KT : (p.gs || 0) * MS_PER_KT;
  let lon = p.lon, lat = p.lat;
  if (v > 0.5 && p.track != null && dt !== 0) [lon, lat] = destination(p.lat, p.lon, p.track, v * dt);
  const vr = Math.abs(dt) > 30 ? 0 : p.vrate || 0;
  return {
    t: p.t + dt, lat, lon,
    alt: Math.max(0, p.alt + (vr * dt) / 60),
    heading: p.track ?? 0, gs: p.gs, vrate: p.vrate, ground: p.ground, turn: 0,
  };
}

// Cubic Hermite between two fixes using their reported velocities, so turns
// curve instead of zig-zagging. Falls back to linear when velocities disagree
// with the chord (MLAT noise, missing gs/track, long gaps).
function hermite(a, b, T) {
  const h = b.t - a.t, u = (T - a.t) / h;
  const p1 = toLocal(a.lat, a.lon, b.lat, b.lon);
  const chord = Math.hypot(p1[0], p1[1]);
  let v0 = velocity(a), v1 = velocity(b);
  let x, y, dx, dy;
  const ok = v0 && v1 && h < 90 && chord > 1 && (() => {
    const l0 = Math.hypot(v0[0], v0[1]) * h, l1 = Math.hypot(v1[0], v1[1]) * h;
    return l0 < chord * 2 + 60 && l0 > chord * 0.5 - 60 && l1 < chord * 2 + 60 && l1 > chord * 0.5 - 60;
  })();
  if (ok) {
    v0 = [v0[0] * h, v0[1] * h];
    v1 = [v1[0] * h, v1[1] * h];
    const u2 = u * u, u3 = u2 * u;
    const h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    x = h10 * v0[0] + h01 * p1[0] + h11 * v1[0];
    y = h10 * v0[1] + h01 * p1[1] + h11 * v1[1];
    const d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
    dx = d10 * v0[0] + d01 * p1[0] + d11 * v1[0];
    dy = d10 * v0[1] + d01 * p1[1] + d11 * v1[1];
  } else {
    x = p1[0] * u; y = p1[1] * u; dx = p1[0]; dy = p1[1];
  }
  const [lon, lat] = fromLocal(a.lat, a.lon, x, y);
  const moving = Math.hypot(dx, dy) / h > 3;
  const ta = a.track ?? b.track ?? 0, tb = b.track ?? ta;
  const heading = moving ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : lerpAngle(ta, tb, u);
  const s = u * u * (3 - 2 * u); // ease altitude so level-offs don't kink
  return {
    t: T, lat, lon,
    alt: a.alt + (b.alt - a.alt) * (Math.abs(b.alt - a.alt) > 50 ? u : s),
    heading,
    gs: a.gs != null && b.gs != null ? a.gs + (b.gs - a.gs) * u : a.gs ?? b.gs,
    vrate: (a.vrate || 0) + ((b.vrate || 0) - (a.vrate || 0)) * u,
    ground: u < 0.5 ? a.ground : b.ground,
    turn: angleDiff(ta, tb) / h, // deg/s, used for bank angle in 3D
  };
}
