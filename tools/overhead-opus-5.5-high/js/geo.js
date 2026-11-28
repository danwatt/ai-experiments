// Small geodesy helpers. Distances in metres unless noted.
export const R_EARTH = 6371008.8;
export const M_PER_NM = 1852;
export const M_PER_FT = 0.3048;
export const MS_PER_KT = 0.514444;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(lat, lon, brg, dist) {
  const d = dist / R_EARTH, b = brg * D2R, p1 = lat * D2R, l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 * R2D + 540) % 360) - 180, p2 * R2D];
}

/** Angle above the observer's horizon, accounting for earth curvature (with standard refraction k≈0.13). */
export function elevationAngle(groundDist, heightAboveObserver) {
  const drop = (groundDist * groundDist) / (2 * R_EARTH * 1.15);
  return Math.atan2(heightAboveObserver - drop, groundDist) * R2D;
}

/** Local tangent-plane metres (east, north) of a point relative to an origin. */
export function toLocal(lat0, lon0, lat, lon) {
  return [(lon - lon0) * Math.cos(lat0 * D2R) * 111320, (lat - lat0) * 110574];
}

export function fromLocal(lat0, lon0, x, y) {
  return [lon0 + x / (Math.cos(lat0 * D2R) * 111320), lat0 + y / 110574];
}

export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function lerpAngle(a, b, t) {
  return (a + angleDiff(a, b) * t + 360) % 360;
}

export function circle(lat, lon, radiusM, steps = 128) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(destination(lat, lon, (i / steps) * 360, radiusM));
  return pts;
}

export function compassPoint(deg) {
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(deg / 22.5) % 16];
}

/** n+1 points along the great circle between two positions, as [lon, lat]. */
export function greatCircle(lat1, lon1, lat2, lon2, n) {
  const p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [[lon1, lat1], [lon2, lat2]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([Math.atan2(y, x) * R2D, Math.atan2(z, Math.hypot(x, y)) * R2D]);
  }
  return pts;
}

/** Path from an aircraft to an airport, altitude (ft) falling linearly to field elevation. */
export function pathToAirport(st, ap) {
  const n = Math.max(2, Math.min(64, Math.round(haversine(st.lat, st.lon, ap.lat, ap.lon) / 20000)));
  const end = ap.elevFt || 0;
  return greatCircle(st.lat, st.lon, ap.lat, ap.lon, n).map(([lon, lat], i) => [lon, lat, st.alt + ((end - st.alt) * i) / n]);
}
