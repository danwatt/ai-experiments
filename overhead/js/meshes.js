// Procedural low-poly aircraft meshes for deck.gl SimpleMeshLayer.
// Model space: nose toward +X, left wing toward +Y, up +Z, length ≈ 1.
// Normals are flat and pushed away from each part's centre, so winding order
// does not matter.

function builder() {
  const pos = [], nrm = [];
  function tri(a, b, c, center) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((k) => k / len);
    const m = [(a[0] + b[0] + c[0]) / 3 - center[0], (a[1] + b[1] + c[1]) / 3 - center[1], (a[2] + b[2] + c[2]) / 3 - center[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = n.map((k) => -k);
    pos.push(...a, ...b, ...c);
    nrm.push(...n, ...n, ...n);
  }
  function quad(a, b, c, d, center) {
    tri(a, b, c, center);
    tri(a, c, d, center);
  }
  /** Body of revolution along X: profile = [[x, radius, zOffset?], ...] */
  function lathe(profile, sides = 8, cy = 0, sz = 1) {
    const ring = (x, r, z0 = 0) => Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      return [x, cy + Math.cos(a) * r, z0 + Math.sin(a) * r * sz];
    });
    for (let i = 0; i < profile.length - 1; i++) {
      const [x0, r0, z0 = 0] = profile[i], [x1, r1, z1 = 0] = profile[i + 1];
      const A = ring(x0, r0, z0), B = ring(x1, r1, z1);
      const center = [(x0 + x1) / 2, cy, (z0 + z1) / 2];
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        if (r0 < 1e-4) tri(A[k], B[k], B[k2], center);
        else if (r1 < 1e-4) tri(A[k], A[k2], B[k], center);
        else quad(A[k], A[k2], B[k2], B[k], center);
      }
    }
  }
  /** Flat polygon extruded by thickness t. map(u, v, w) -> xyz. */
  function slab(poly, t, map) {
    const top = poly.map(([u, v]) => map(u, v, t / 2));
    const bot = poly.map(([u, v]) => map(u, v, -t / 2));
    const cu = poly.reduce((s, p) => s + p[0], 0) / poly.length, cv = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const center = map(cu, cv, 0);
    for (let i = 1; i < poly.length - 1; i++) {
      tri(top[0], top[i], top[i + 1], center);
      tri(bot[0], bot[i], bot[i + 1], center);
    }
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      quad(top[i], top[j], bot[j], bot[i], center);
    }
  }
  const wingPair = (poly, t, z) => {
    slab(poly, t, (x, y, w) => [x, y, z + w]);
    slab(poly.map(([x, y]) => [x, -y]), t, (x, y, w) => [x, y, z + w]);
  };
  const final = () => ({
    positions: { value: new Float32Array(pos), size: 3 },
    normals: { value: new Float32Array(nrm), size: 3 },
  });
  return { tri, quad, lathe, slab, wingPair, final };
}

export function jetMesh() {
  const b = builder();
  b.lathe([[0.5, 0], [0.47, 0.025], [0.42, 0.045], [0.34, 0.055], [-0.22, 0.055], [-0.38, 0.04, 0.01], [-0.5, 0.012, 0.03]]);
  b.wingPair([[0.12, 0.05], [-0.13, 0.5], [-0.21, 0.5], [-0.06, 0.05]], 0.016, -0.02);
  b.wingPair([[-0.33, 0.03], [-0.44, 0.19], [-0.5, 0.19], [-0.46, 0.03]], 0.01, 0.025);
  b.slab([[-0.28, 0.04], [-0.44, 0.24], [-0.5, 0.24], [-0.5, 0.03]], 0.012, (x, z, w) => [x, w, z]);
  for (const y of [0.17, -0.17]) b.lathe([[0.14, 0.028, -0.05], [0.13, 0.032, -0.05], [0.03, 0.03, -0.05], [0.0, 0.02, -0.05]], 8, y, 1);
  return b.final();
}

export function lightMesh() {
  const b = builder();
  b.lathe([[0.5, 0.02], [0.46, 0.07], [0.3, 0.09, 0.01], [0.05, 0.08, 0.02], [-0.3, 0.035, 0.03], [-0.5, 0.015, 0.04]]);
  b.wingPair([[0.22, 0.06], [0.2, 0.62], [0.06, 0.62], [0.06, 0.06]], 0.022, 0.095);
  b.wingPair([[-0.36, 0.02], [-0.38, 0.22], [-0.48, 0.22], [-0.5, 0.02]], 0.012, 0.04);
  b.slab([[-0.3, 0.05], [-0.42, 0.24], [-0.5, 0.24], [-0.5, 0.04]], 0.014, (x, z, w) => [x, w, z]);
  b.slab([[0, -0.2], [0, 0.2], [0.01, 0.2], [0.01, -0.2]], 0.01, (x, y, w) => [0.5 + x, y, w]); // prop blur
  return b.final();
}

export function heliMesh() {
  const b = builder();
  b.lathe([[0.32, 0.02], [0.28, 0.1], [0.12, 0.14, 0.02], [-0.05, 0.12, 0.03], [-0.15, 0.05, 0.06], [-0.55, 0.025, 0.08], [-0.6, 0.02, 0.09]]);
  b.slab([[-0.5, 0.06], [-0.56, 0.2], [-0.62, 0.2], [-0.6, 0.06]], 0.012, (x, z, w) => [x, w, z]);
  for (const a of [0.4, 0.4 + Math.PI / 2]) {
    const c = Math.cos(a), s = Math.sin(a), hw = 0.025, L = 0.55;
    const blade = [[-L, -hw], [L, -hw], [L, hw], [-L, hw]].map(([u, v]) => [0.05 + u * c - v * s, u * s + v * c]);
    b.slab(blade, 0.008, (x, y, w) => [x, y, 0.2 + w]);
  }
  b.lathe([[0.06, 0.03, 0.15], [0.04, 0.03, 0.2]], 6);
  return b.final();
}
