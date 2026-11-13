// Geometry for the explainer: a seeded fake map stored as arcs (shared borders),
// Douglas–Peucker (plain, per ring, and constrained), and the checks a
// topology-preserving simplifier runs before it drops a point.
(function (root) {
  "use strict";

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    if (!L) return dist(p, a);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }

  // Midpoint displacement between a and b, bent toward a quadratic guide curve.
  function fractalLine(a, b, opts) {
    const { depth = 6, rough = 0.22, bend = 0, seed = 1 } = opts;
    const r = rng(seed);
    const len = dist(a, b);
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const ctrl = [(a[0] + b[0]) / 2 + nx * bend * len, (a[1] + b[1]) / 2 + ny * bend * len];
    const guide = (t) => {
      const u = 1 - t;
      return [u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1]];
    };
    let pts = [a.slice(), b.slice()];
    let ts = [0, 1];
    for (let d = 0; d < depth; d++) {
      const np = [pts[0]], nt = [0];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const tm = (ts[i] + ts[i + 1]) / 2;
        const mid = lerp(p, q, 0.5);
        const sl = dist(p, q);
        const ex = -(q[1] - p[1]) / sl, ey = (q[0] - p[0]) / sl;
        const off = (r() * 2 - 1) * rough * sl;
        np.push([mid[0] + ex * off, mid[1] + ey * off], q);
        nt.push(tm, ts[i + 1]);
      }
      pts = np; ts = nt;
    }
    // bend: add the guide curve's offset from the straight chord
    pts = pts.map((p, i) => {
      const g = guide(ts[i]), s = lerp(a, b, ts[i]);
      return [p[0] + g[0] - s[0], p[1] + g[1] - s[1]];
    });
    return pts;
  }

  // ---------- Douglas–Peucker ----------
  function dp(pts, tol, check) {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      if (j - i < 2) continue;
      let best = -1, bd = -1;
      for (let k = i + 1; k < j; k++) {
        const d = segDist(pts[k], pts[i], pts[j]);
        if (d > bd) { bd = d; best = k; }
      }
      if (bd > tol || (check && !check(i, j))) {
        keep[best] = 1;
        stack.push([i, best], [best, j]);
      }
    }
    return keep;
  }

  // Every decision DP makes, in order, for the animated walkthrough.
  function dpSteps(pts, tol) {
    const steps = [];
    const rec = (i, j, depth) => {
      if (j - i < 2) return;
      let best = -1, bd = -1;
      for (let k = i + 1; k < j; k++) {
        const d = segDist(pts[k], pts[i], pts[j]);
        if (d > bd) { bd = d; best = k; }
      }
      const keepIt = bd > tol;
      steps.push({ i, j, k: best, d: bd, keep: keepIt, depth });
      if (keepIt) { rec(i, best, depth + 1); rec(best, j, depth + 1); }
    };
    rec(0, pts.length - 1, 0);
    return steps;
  }

  // Closed ring (no repeated last point): split at the start point and the
  // point farthest from it, then run DP on both halves. This is what a
  // shape-at-a-time simplifier does to each polygon's boundary.
  function ringDP(ring, tol, minPts) {
    const n = ring.length;
    let f = 0, fd = -1;
    for (let k = 1; k < n; k++) { const d = dist(ring[0], ring[k]); if (d > fd) { fd = d; f = k; } }
    const a = ring.slice(0, f + 1), b = ring.slice(f).concat([ring[0]]);
    const ka = dp(a, tol), kb = dp(b, tol);
    const keep = new Uint8Array(n);
    for (let k = 0; k <= f; k++) keep[k] = ka[k];
    for (let k = f; k < n; k++) keep[k] = keep[k] || kb[k - f];
    let count = keep.reduce((s, v) => s + v, 0);
    if (minPts && count < minPts) {
      // add the points farthest from the current outline until we have enough
      while (count < minPts) {
        let bi = -1, bd = -1;
        for (let k = 0; k < n; k++) if (!keep[k]) {
          const d = distToKeptRing(ring, keep, k);
          if (d > bd) { bd = d; bi = k; }
        }
        if (bi < 0) break;
        keep[bi] = 1; count++;
      }
    }
    return keep;
  }

  function distToKeptRing(ring, keep, k) {
    const n = ring.length;
    let p = k, q = k;
    do { p = (p - 1 + n) % n; } while (!keep[p] && p !== k);
    do { q = (q + 1) % n; } while (!keep[q] && q !== k);
    return segDist(ring[k], ring[p], ring[q]);
  }

  // ---------- predicates ----------
  function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function segCross(a, b, c, d) {
    const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function segCrossPoint(a, b, c, d) {
    const r = sub(b, a), s = sub(d, c);
    const den = r[0] * s[1] - r[1] * s[0];
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    return [a[0] + t * r[0], a[1] + t * r[1]];
  }
  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function area(ring) {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return s / 2;
  }

  // Self-crossings in a closed ring; returns the crossing points.
  function ringCrossings(ring) {
    const out = [], n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = ring[j], d = ring[(j + 1) % n];
        if (segCross(a, b, c, d)) out.push(segCrossPoint(a, b, c, d));
      }
    }
    return out;
  }

  // ---------- constrained (topology-preserving) DP on an open line ----------
  // A chord i..j may replace pts[i..j] only if it crosses no other line and the
  // area it sweeps contains no point it must not pass over.
  function constrainedDP(pts, tol, others, guardPts) {
    const check = (i, j) => {
      const a = pts[i], b = pts[j];
      for (const line of others) {
        for (let k = 0; k < line.length - 1; k++) {
          const c = line[k], d = line[k + 1];
          if (segCross(a, b, c, d)) return false;
        }
      }
      // the line itself, outside i..j
      for (let k = 0; k < pts.length - 1; k++) {
        if (k >= i - 1 && k <= j) continue;
        if (segCross(a, b, pts[k], pts[k + 1])) return false;
      }
      if (guardPts && guardPts.length) {
        const swept = pts.slice(i, j + 1);
        for (const g of guardPts) if (pointInPoly(g, swept)) return false;
      }
      return true;
    };
    return dp(pts, tol, check);
  }

  // Ring version: split into two open halves and simplify each against the other.
  function constrainedRingDP(ring, tol, others, guardPts, minPts) {
    const n = ring.length;
    let f = 0, fd = -1;
    for (let k = 1; k < n; k++) { const d = dist(ring[0], ring[k]); if (d > fd) { fd = d; f = k; } }
    const a = ring.slice(0, f + 1), b = ring.slice(f).concat([ring[0]]);
    const ka = constrainedDP(a, tol, others.concat([b]), guardPts);
    const aS = a.filter((_, k) => ka[k]);
    const kb = constrainedDP(b, tol, others.concat([aS]), guardPts);
    const keep = new Uint8Array(n);
    for (let k = 0; k <= f; k++) keep[k] = ka[k];
    for (let k = f; k < n; k++) keep[k] = keep[k] || kb[k - f];
    let count = keep.reduce((s, v) => s + v, 0);
    while (minPts && count < minPts) {
      let bi = -1, bd = -1;
      for (let k = 0; k < n; k++) if (!keep[k]) { const d = distToKeptRing(ring, keep, k); if (d > bd) { bd = d; bi = k; } }
      if (bi < 0) break;
      keep[bi] = 1; count++;
    }
    return keep;
  }

  // Where each dropped vertex lands on its replacement chord, for morphing.
  function chordTargets(pts, keep, closed) {
    const n = pts.length, out = pts.map((p) => p.slice());
    const kept = [];
    for (let k = 0; k < n; k++) if (keep[k]) kept.push(k);
    if (kept.length < 2) { const c = pts[kept[0] || 0]; return pts.map(() => c.slice()); }
    const spans = [];
    for (let s = 0; s < kept.length - 1; s++) spans.push([kept[s], kept[s + 1]]);
    if (closed) spans.push([kept[kept.length - 1], kept[0] + n]);
    for (const [i, j] of spans) {
      let total = 0; const cum = [0];
      for (let k = i; k < j; k++) { total += dist(pts[k % n], pts[(k + 1) % n]); cum.push(total); }
      for (let k = i + 1; k < j; k++) out[k % n] = lerp(pts[i % n], pts[j % n], total ? cum[k - i] / total : 0);
    }
    return out;
  }

  // ---------- the map ----------
  // Four counties on one landmass. Nodes are where three borders meet.
  function buildMap() {
    const N = {
      C1: [470, 92], C2: [905, 300], C3: [610, 548], C4: [118, 330],
      J1: [430, 318], J2: [640, 352],
    };
    // [from, to, bend, rough, seed, coast?]
    const spec = [
      ["C4", "C1", -0.32, 0.3, 11, true],
      ["C1", "C2", -0.30, 0.3, 23, true],
      ["C2", "C3", -0.30, 0.3, 37, true],
      ["C3", "C4", -0.26, 0.3, 41, true],
      ["C1", "J1", 0.10, 0.26, 53, false],
      ["J1", "C4", 0.08, 0.26, 67, false],
      ["C2", "J2", -0.06, 0.26, 71, false],
      ["J2", "J1", 0.12, 0.26, 83, false],
      ["C3", "J2", -0.08, 0.26, 97, false],
    ];
    // Reseed any arc that crosses itself or an arc already placed.
    const crosses = (A, B, self) => {
      for (let a = 0; a < A.length - 1; a++)
        for (let b = self ? a + 2 : 0; b < B.length - 1; b++)
          if (segCross(A[a], A[a + 1], B[b], B[b + 1])) return true;
      return false;
    };
    const arcs = [];
    for (const [f, t, bend, rough, seed, coast] of spec) {
      let pts, s = seed;
      for (let tries = 0; tries < 400; tries++, s += 1009) {
        pts = fractalLine(N[f], N[t], { depth: coast ? 7 : 6, rough, bend, seed: s });
        if (!crosses(pts, pts, true) && !arcs.some((a) => crosses(pts, a.pts, false))) break;
      }
      arcs.push({ from: f, to: t, coast, pts });
    }
    // polygons: list of [arcIndex, reversed]
    const polys = [
      { name: "Bluff", arcs: [[0, false], [4, false], [5, false]] },
      { name: "Cedar", arcs: [[1, false], [6, false], [7, false], [4, true]] },
      { name: "Llano", arcs: [[2, false], [8, false], [6, true]] },
      { name: "Pecan", arcs: [[3, false], [5, true], [7, true], [8, true]] },
    ];
    return { nodes: N, arcs, polys };
  }

  function ringOf(map, poly, arcPts) {
    const ring = [];
    for (const [ai, rev] of poly.arcs) {
      let p = arcPts ? arcPts[ai] : map.arcs[ai].pts;
      if (rev) p = p.slice().reverse();
      for (let k = 0; k < p.length - 1; k++) ring.push(p[k]);
    }
    return ring;
  }

  // Shape-at-a-time: every polygon simplifies its own copy of each border.
  function naiveMap(map, tol) {
    return map.polys.map((poly) => {
      const ring = ringOf(map, poly);
      const keep = ringDP(ring, tol);
      return { ring, keep, out: ring.filter((_, k) => keep[k]) };
    });
  }

  // Topology first: simplify each arc once, nodes fixed, no crossings.
  function topoMap(map, tol) {
    const cur = map.arcs.map((a) => a.pts);
    const keeps = [];
    for (let pass = 0; pass < 2; pass++) {
      map.arcs.forEach((a, ai) => {
        const others = cur.filter((_, k) => k !== ai);
        const guard = [];
        map.arcs.forEach((b, bi) => { if (bi !== ai) for (let k = 1; k < b.pts.length - 1; k++) guard.push(b.pts[k]); });
        const keep = constrainedDP(a.pts, tol, others, guard);
        keeps[ai] = keep;
        cur[ai] = a.pts.filter((_, k) => keep[k]);
      });
    }
    return { arcKeeps: keeps, arcOut: cur };
  }

  // ---------- single-shape failure cases ----------
  function circleRing(c, r, n, wobble, seed, phase) {
    const R = rng(seed), out = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2 + (phase || 0);
      const rr = r * (1 + wobble * (R() * 2 - 1));
      out.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]);
    }
    return out;
  }


  // Walk a polyline through control points, densified, with a little noise.
  function densify(ctrl, step, wobble, seed) {
    const R = rng(seed), out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const a = ctrl[i], b = ctrl[i + 1];
      const n = Math.max(1, Math.round(dist(a, b) / step));
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, k / n);
        const w = k === 0 ? 0 : wobble;
        out.push([p[0] + (R() * 2 - 1) * w, p[1] + (R() * 2 - 1) * w]);
      }
    }
    return out;
  }
  const arcPts = (cx, cy, rx, ry, a0, a1, n) => {
    const o = [];
    for (let k = 0; k <= n; k++) { const t = a0 + (a1 - a0) * (k / n); o.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]); }
    return o;
  };

  // A. An island with a lake in a low headland. Dropping the headland leaves the lake outside.
  function lakeCase() {
    const bump = arcPts(0, 0, 60, 34, Math.PI, 2 * Math.PI, 14);
    const ctrl = [[-150, 232], [-150, 8], [-142, 0], [-60, 0]]
      .concat(bump, [[60, 0], [142, 0], [150, 8], [150, 232], [142, 240], [-142, 240], [-150, 232]]);
    const ring = densify(ctrl, 9, 2.2, 5);
    const lake = circleRing([0, -16], 9, 14, 0.08, 9);
    return { ring, holes: [lake], tol: 40 };
  }

  // B. A narrow inlet: a spit on one shore points across; the far shore curves around it.
  function inletCase(o) {
    o = Object.assign({ D: 170, rx: 26, S: 50, wy: 95, tol: 40, seed: 7 }, o || {});
    const left = [[-20, 0], [-20, o.wy - 55]].concat(arcPts(-20, o.wy, o.rx, 50, -Math.PI / 2, -3 * Math.PI / 2, 12)).concat([[-20, o.wy + 55], [-20, o.D]]);
    const right = [[20, o.D], [20, o.wy + 6], [20 - o.S + 4, o.wy + 3], [20 - o.S, o.wy], [20 - o.S + 4, o.wy - 3], [20, o.wy - 6], [20, 0]];
    const ctrl = [[-150, 232], [-150, 8], [-142, 0]].concat(left, right).concat([[142, 0], [150, 8], [150, 232], [142, 240], [-142, 240], [-150, 232]]);
    const ring = densify(ctrl, 8, 1.6, o.seed);
    return { ring, holes: [], tol: o.tol };
  }

  // C. A small islet next to a big coast.
  function isletCase() {
    const ring = circleRing([0, 120], 16, 18, 0.18, 3);
    return { ring, holes: [], tol: 40 };
  }

  function caseResults(c) {
    const naive = ringDP(c.ring, c.tol);
    const guard = c.holes.flat();
    const topo = constrainedRingDP(c.ring, c.tol, c.holes, guard, 3);
    const nOut = c.ring.filter((_, k) => naive[k]);
    const tOut = c.ring.filter((_, k) => topo[k]);
    return {
      naive, topo, nOut, tOut,
      nCross: ringCrossings(nOut), tCross: ringCrossings(tOut),
      nHoleOut: c.holes.map((h) => h.some((p) => !pointInPoly(p, nOut))),
      tHoleOut: c.holes.map((h) => h.some((p) => !pointInPoly(p, tOut))),
    };
  }

  const api = {
    rng, dist, lerp, segDist, fractalLine, dp, dpSteps, ringDP, constrainedDP, constrainedRingDP,
    chordTargets, segCross, segCrossPoint, pointInPoly, area, ringCrossings,
    buildMap, ringOf, naiveMap, topoMap, circleRing, lakeCase, inletCase, isletCase, caseResults,
  };
  root.Geo = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
