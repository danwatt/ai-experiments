// Where the sun is, and what the scene should look like because of it.
const D2R = Math.PI / 180;

/** Solar azimuth (° from north, clockwise) and elevation (°) — low-precision almanac, ±0.5°. */
export function sunPosition(ms, lat, lon) {
  const d = ms / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const ha = (gmst + lon) * D2R - ra;
  const p = lat * D2R;
  const el = Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(p) - Math.sin(p) * Math.cos(ha));
  return { az: (az / D2R + 360) % 360, el: el / D2R };
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Lighting and sky for a sun elevation. Smoothly blends night → twilight →
 * golden hour → day so nothing pops as the sun moves.
 */
export function sunLook(el, darkMap) {
  const NIGHT = { sky: [5, 8, 16], horizon: [22, 32, 58], amb: [120, 140, 200], ambI: 0.75, sun: [255, 200, 150], sunI: 0 };
  const TWI = { sky: [24, 36, 72], horizon: [196, 98, 86], amb: [190, 170, 200], ambI: 0.6, sun: [255, 150, 110], sunI: 0.3 };
  const GOLD = { sky: [58, 96, 150], horizon: [245, 170, 96], amb: [255, 235, 215], ambI: 0.5, sun: [255, 190, 120], sunI: 1.4 };
  const DAY = { sky: [74, 144, 217], horizon: [190, 218, 242], amb: [255, 255, 255], ambI: 0.45, sun: [255, 250, 240], sunI: 1.8 };
  const [a, b, t] = el < -6 ? [NIGHT, NIGHT, 0] : el < 0 ? [NIGHT, TWI, (el + 6) / 6] : el < 8 ? [TWI, GOLD, el / 8]
    : [GOLD, DAY, (el - 8) / 12];
  const look = {
    phase: el < -6 ? "night" : el < 0 ? "twilight" : el < 8 ? "golden hour" : "day",
    sky: hex(mix(a.sky, b.sky, t)), horizon: hex(mix(a.horizon, b.horizon, t)),
    ambientColor: mix(a.amb, b.amb, t), ambient: a.ambI + (b.ambI - a.ambI) * t,
    sunColor: mix(a.sun, b.sun, t), sun: a.sunI + (b.sunI - a.sunI) * t,
  };
  look.fog = darkMap ? "#0d1726" : "#e6edf5";
  return look;
}
