// Backend access. Normally the app talks to server.py; with no backend (static
// hosting such as GitHub Pages) or with ?demo in the URL it replays a recording
// shipped in demo/traffic.json, so everything still works offline from a server.

let impl = null;

export const api = {
  /** Recording metadata when in demo mode, otherwise null. */
  get demo() { return impl?.meta || null; },
  aircraft: (params) => impl.aircraft(params),
  routes: (callsigns) => impl.routes(callsigns),
  airports: (params) => impl.airports(params),
  heat: (params) => impl.heat(params),
  /** Snapshots for the last `seconds` of playback, to fill trails on start. */
  history: (seconds) => impl.history?.(seconds) || [],
  /** Wall-clock ms to use for the sun: the recording's own time of day in demo mode. */
  clock: () => impl?.clock?.() ?? Date.now(),
};

export async function connect() {
  const forced = new URLSearchParams(location.search).has("demo");
  if (!forced && (await backendUp())) {
    impl = live;
    return null;
  }
  const res = await fetch("demo/traffic.json");
  if (!res.ok) throw new Error(`No backend and no demo recording (${res.status})`);
  impl = replay(await res.json());
  return impl.meta;
}

async function backendUp() {
  try {
    const res = await fetch("api/providers", { cache: "no-store" });
    return res.ok && (res.headers.get("content-type") || "").includes("json");
  } catch {
    return false;
  }
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.status);
  return body;
}

const qs = (params) => new URLSearchParams(params).toString();

const live = {
  // aircraft bodies carry their own ok/error, so pass them through either way
  aircraft: async (p) => (await fetch(`api/aircraft?${qs(p)}`, { cache: "no-store" })).json(),
  routes: (callsigns) => json(`api/routes?callsigns=${encodeURIComponent(callsigns.join(","))}`),
  airports: (p) => json(`api/airports?${qs(p)}`),
  heat: (p) => json(`api/heat?${qs(p)}`),
};

/**
 * Loop the recording against the real clock. Sample times are re-based onto
 * "now" so the store, interpolation and trails behave exactly as with live data.
 */
function replay(doc) {
  const m = doc.meta;
  const LEAD = 120; // start two minutes in, so there is history for trails
  const began = Date.now() / 1000 - LEAD;

  const position = (real) => {
    const elapsed = real - began;
    const loop = Math.floor(elapsed / m.duration);
    return { loop, t: elapsed - loop * m.duration };
  };

  const snapshot = (real) => {
    const { loop, t } = position(real);
    const aircraft = [];
    for (const a of doc.aircraft) {
      const s = latestAt(a.s, t);
      if (!s || t - s[0] > 30) continue; // not heard from for a while: gone
      aircraft.push({
        hex: a.hex, flight: a.flight, reg: a.reg, type: a.type, desc: a.desc, owner: null, year: a.year,
        cat: a.cat, mil: a.mil, src: a.src, squawk: a.squawk, navAlt: a.navAlt, emergency: a.emergency,
        lat: s[1], lon: s[2], alt: s[3], gs: s[4], track: s[5], vrate: s[6], ground: !!s[7],
        posTime: real - (t - s[0]),
      });
    }
    return {
      ok: true, demo: true, loop, provider: "demo", providerName: `${m.provider} recording`,
      license: m.license, providerUrl: m.providerUrl, now: real, interval: m.interval, aircraft,
    };
  };

  return {
    meta: m,
    aircraft: async () => snapshot(Date.now() / 1000),
    history: (seconds) => {
      const now = Date.now() / 1000, out = [];
      for (let back = Math.min(seconds, LEAD); back > 0; back -= m.interval) out.push(snapshot(now - back));
      return out.filter((b) => b.loop === position(now).loop);
    },
    routes: async (callsigns) => ({
      routes: Object.fromEntries(callsigns.map((cs) => [cs, doc.routes[cs] || { status: "none" }])),
    }),
    airports: async () => ({ airports: doc.airports }),
    heat: async () => ({ bins: doc.heat, cell: 0.005, recordingSince: m.start }),
    clock: () => (m.start + position(Date.now() / 1000).t) * 1000,
  };
}

/** Last sample at or before t (samples are sorted by time). */
function latestAt(samples, t) {
  let lo = 0, hi = samples.length - 1;
  if (hi < 0 || samples[0][0] > t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return samples[lo];
}
