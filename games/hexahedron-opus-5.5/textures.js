// Procedural canvas textures. Every wall texture tiles once per cell side.
import * as THREE from 'three';

const SIZE = 128;

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Tileable value noise with a few octaves.
function noiseField(seed, period) {
  const r = rng(seed);
  const g = new Float32Array(period * period).map(() => r());
  const at = (x, y) => g[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const fx = x / SIZE * period, fy = y / SIZE * period;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}
function fbm(seed) {
  const o = [noiseField(seed, 4), noiseField(seed + 1, 8), noiseField(seed + 2, 16), noiseField(seed + 3, 32)];
  return (x, y) => o[0](x, y) * 0.5 + o[1](x, y) * 0.25 + o[2](x, y) * 0.15 + o[3](x, y) * 0.1;
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')];
}
function pixels(ctx, fn) {
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const [r, g, b] = fn(x, y);
    const i = (y * SIZE + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function bevel(ctx, x, y, w, h, light = 0.18, dark = 0.55) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(0,0,0,${dark})`;
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${light})`;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
}
function rivets(ctx, pts) {
  for (const [x, y] of pts) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + 0.7, y + 0.7, 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(220,225,235,0.55)'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
  }
}
function stripes(ctx, x, y, w, h, a = '#d8b020', b = '#1a1a1a') {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = b; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = a;
  for (let i = -h; i < w + h; i += 16) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 8, y + h); ctx.lineTo(x + i + 8 + h, y); ctx.lineTo(x + i + h, y); ctx.fill(); }
  ctx.restore();
}

const painters = {
  metal(ctx) {
    const n = fbm(11), r = rng(5);
    pixels(ctx, (x, y) => { const v = n(x, y) * 34 + r() * 10; return [84 + v, 90 + v, 100 + v]; });
    bevel(ctx, 1, 1, SIZE - 2, SIZE / 2 - 2); bevel(ctx, 1, SIZE / 2 + 1, SIZE - 2, SIZE / 2 - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(20, 76, 88, 34);
    bevel(ctx, 20, 76, 88, 34, 0.12, 0.4);
    rivets(ctx, [[7, 7], [121, 7], [7, 57], [121, 57], [7, 71], [121, 71], [7, 121], [121, 121]]);
  },
  tech(ctx) {
    const n = fbm(21), r = rng(9);
    pixels(ctx, (x, y) => { const v = n(x, y) * 26 + r() * 8; return [62 + v, 70 + v, 84 + v]; });
    bevel(ctx, 1, 1, SIZE - 2, SIZE - 2);
    ctx.fillStyle = '#2a313c'; ctx.fillRect(16, 14, 96, 64);
    bevel(ctx, 16, 14, 96, 64, 0.1, 0.6);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#3b4452' : '#333b48'; ctx.fillRect(20, 18 + i * 10, 88, 8); }
    const leds = ['#4cf0ff', '#ffb340', '#4cf0ff', '#ff4a4a', '#7dff6a'];
    leds.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(22 + i * 18, 90, 8, 5); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(23 + i * 18, 91, 3, 2); });
    ctx.fillStyle = '#4b5462'; ctx.fillRect(0, 104, SIZE, 10);
    bevel(ctx, 0, 104, SIZE, 10, 0.2, 0.5);
    rivets(ctx, [[8, 120], [120, 120], [8, 8], [120, 8]]);
  },
  floor(ctx) {
    const n = fbm(31), r = rng(3);
    pixels(ctx, (x, y) => { const v = n(x, y) * 22 + r() * 8; return [70 + v, 72 + v, 76 + v]; });
    for (let y = 8; y < SIZE; y += 16) for (let x = 8; x < SIZE; x += 16) {
      const alt = ((x + y) / 16) % 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(alt ? 0.8 : -0.8);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-5, -1, 11, 3.5);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-5.5, -1.5, 11, 2.2);
      ctx.restore();
    }
    bevel(ctx, 1, 1, SIZE - 2, SIZE - 2, 0.15, 0.7);
  },
  grate(ctx) {
    pixels(ctx, () => [16, 18, 22]);
    const r = rng(7);
    for (let i = 0; i < SIZE; i += 16) {
      ctx.fillStyle = '#5c6470'; ctx.fillRect(i, 0, 5, SIZE); ctx.fillRect(0, i, SIZE, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(i, 0, 1, SIZE); ctx.fillRect(0, i, SIZE, 1);
    }
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.3})`; ctx.fillRect(r() * SIZE, r() * SIZE, 2, 2); }
    ctx.fillStyle = '#6a7380'; ctx.fillRect(0, 0, SIZE, 6); ctx.fillRect(0, SIZE - 6, SIZE, 6);
    bevel(ctx, 0, 0, SIZE, 6); bevel(ctx, 0, SIZE - 6, SIZE, 6);
  },
  rock(ctx) {
    const n = fbm(41), m = fbm(47), r = rng(2);
    pixels(ctx, (x, y) => {
      const v = n(x, y), w = m(x, y);
      const crack = Math.abs(w - 0.5) < 0.018 ? -40 : 0;
      const k = v * 80 + r() * 12 + crack;
      return [58 + k, 60 + k * 0.95, 58 + k * 0.85];
    });
  },
  lavarock(ctx) {
    const n = fbm(51), m = fbm(57), r = rng(4);
    pixels(ctx, (x, y) => {
      const v = n(x, y), w = m(x, y);
      const k = v * 70 + r() * 10;
      if (Math.abs(w - 0.5) < 0.014 && v > 0.48) return [200 + r() * 40, 70 + r() * 30, 10];
      return [52 + k, 34 + k * 0.6, 28 + k * 0.45];
    });
  },
  lava(ctx) {
    const n = fbm(61), m = fbm(67);
    pixels(ctx, (x, y) => {
      const v = n(x, y) * 0.65 + m(x, y) * 0.35;
      const t = Math.min(1, Math.max(0, (v - 0.3) * 2.2));
      if (t < 0.25) return [70 + t * 300, 10 + t * 40, 0];
      if (t < 0.7) return [150 + (t - 0.25) * 230, 30 + (t - 0.25) * 220, 0];
      return [255, 130 + (t - 0.7) * 400, 30 + (t - 0.7) * 300];
    });
  },
  light(ctx) {
    pixels(ctx, () => [60, 64, 72]);
    ctx.fillStyle = '#20242a'; ctx.fillRect(14, 14, 100, 100);
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c8d0d8');
    ctx.fillStyle = g; ctx.fillRect(20, 20, 88, 88);
    ctx.strokeStyle = 'rgba(80,90,100,0.6)'; ctx.lineWidth = 2;
    for (let i = 20; i <= 108; i += 22) { ctx.beginPath(); ctx.moveTo(i, 20); ctx.lineTo(i, 108); ctx.moveTo(20, i); ctx.lineTo(108, i); ctx.stroke(); }
    bevel(ctx, 1, 1, SIZE - 2, SIZE - 2);
  },
  hazard(ctx) {
    const n = fbm(71), r = rng(6);
    pixels(ctx, (x, y) => { const v = n(x, y) * 30 + r() * 8; return [80 + v, 82 + v, 86 + v]; });
    stripes(ctx, 0, 0, SIZE, 18); stripes(ctx, 0, SIZE - 18, SIZE, 18);
    bevel(ctx, 0, 18, SIZE, SIZE - 36);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(30, 40, 68, 48); bevel(ctx, 30, 40, 68, 48, 0.12, 0.5);
    ctx.fillStyle = '#ff4030'; ctx.fillRect(58, 56, 12, 16);
  },
};

function doorPainter(main, accent) {
  return (ctx) => {
    const n = fbm(81), r = rng(8);
    const [mr, mg, mb] = main;
    pixels(ctx, (x, y) => { const v = n(x, y) * 26 + r() * 8; return [mr + v, mg + v, mb + v]; });
    for (const x0 of [0, SIZE / 2]) {
      bevel(ctx, x0 + 2, 2, SIZE / 2 - 4, SIZE - 4, 0.25, 0.7);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 12, 14, SIZE / 2 - 24, 40); bevel(ctx, x0 + 12, 14, SIZE / 2 - 24, 40, 0.15, 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 12, 74, SIZE / 2 - 24, 40); bevel(ctx, x0 + 12, 74, SIZE / 2 - 24, 40, 0.15, 0.5);
    }
    stripes(ctx, 0, 58, SIZE, 12, accent, '#141414');
    ctx.fillStyle = '#000'; ctx.fillRect(SIZE / 2 - 1, 0, 2, SIZE);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(SIZE / 2, 64, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#141414'; ctx.beginPath(); ctx.arc(SIZE / 2, 64, 7, 0, 7); ctx.fill();
  };
}
painters.door = doorPainter([84, 92, 104], '#e0b020');
painters.door_red = doorPainter([120, 34, 30], '#ff3a2a');
painters.door_exit = doorPainter([40, 96, 52], '#50ff70');

export function makeTextures(renderer) {
  const out = {};
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const [name, paint] of Object.entries(painters)) {
    const [c, ctx] = canvas();
    paint(ctx);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    out[name] = t;
  }
  // soft round sprite for glows and particles
  const [c, ctx] = canvas();
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
  out.glow = new THREE.CanvasTexture(c);
  out.glow.colorSpace = THREE.SRGBColorSpace;
  return out;
}
