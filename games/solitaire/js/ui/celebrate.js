// Win celebrations. One is picked at random each time (never the same as the
// last few), and once in a while a rare golden one turns up.
import { sfx } from './sound.js';

export const HEADLINES = [
  'You did it!', 'Splendid!', 'Well played!', 'Magnificent!', 'Bravo!', 'Brilliant!',
  'What a game!', 'Superb!', 'Marvelous!', 'Wonderful!', 'Hooray!', 'Beautifully done!',
];
export const KINDS = ['cascade', 'fireworks', 'confetti', 'heart', 'balloons', 'fountain', 'spiral'];
export const KIND_NAMES = {
  cascade: 'Bouncing cards', fireworks: 'Fireworks', confetti: 'Confetti', heart: 'Card heart',
  balloons: 'Balloons', fountain: 'Card fountain', spiral: 'Card galaxy', golden: 'Golden win',
};

const PARTY = ['#ff5a5f', '#ffb400', '#00a699', '#7b61ff', '#ff7ac6', '#3ec1ff', '#8bd346', '#ffffff'];
const GOLD = ['#ffd700', '#ffec8b', '#f5c242', '#fff3c4', '#e6a817', '#ffffff'];

const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pick = (a) => a[(Math.random() * a.length) | 0];
const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) ** 3);

export function pickKind(recent = []) {
  const pool = KINDS.filter((k) => !recent.slice(-3).includes(k));
  return pick(pool.length ? pool : KINDS);
}

/** Rasterize card art once, so drawing every frame stays cheap. */
async function rasterize(cards, dpr) {
  const cache = new Map();
  await Promise.all(
    cards.map(async (c) => {
      if (cache.has(c.src)) return;
      cache.set(c.src, null);
      const img = new Image();
      img.src = c.src;
      try { await img.decode(); } catch { return; }
      const cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(c.w * dpr * 1.2));
      cv.height = Math.max(2, Math.round(c.h * dpr * 1.2));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cache.set(c.src, cv);
    })
  );
  for (const c of cards) c.img = cache.get(c.src);
  return cards.filter((c) => c.img);
}

/**
 * Play a celebration over the whole window.
 * cards: [{ src, x, y, w, h, pile }] in page coordinates, pile order, top card last.
 */
export async function celebrate({ kind, golden, cards, headline, onStart }) {
  const layer = document.getElementById('celebrate');
  const canvas = layer.querySelector('canvas');
  const banner = layer.querySelector('.banner');
  const cont = layer.querySelector('.continue');
  const dpr = devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  cards = await rasterize(cards.map((c) => ({ ...c })), dpr);
  if (!cards.length) return;
  const env = { ctx, W, H, cards, s: Math.min(W, H) / 900, cw: cards[0].w, ch: cards[0].h };

  if (golden) kind = 'golden';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && kind !== 'golden') kind = 'confetti';
  const effects = {
    cascade: () => [cascade(env)],
    fireworks: () => [fireworks(env, PARTY)],
    confetti: () => [confetti(env, PARTY)],
    heart: () => [heart(env)],
    balloons: () => [balloons(env, canvas)],
    fountain: () => [fountain(env)],
    spiral: () => [spiral(env)],
    golden: () => [fireworks(env, GOLD), confetti(env, GOLD, true)],
  }[kind]();

  layer.className = 'show kind-' + kind + (golden ? ' golden' : '');
  banner.innerHTML = golden ? `<small>★ A rare golden win ★</small>${headline}` : headline;
  cont.hidden = true;
  onStart?.();
  sfx.fanfare();

  return new Promise((resolve) => {
    let t0 = performance.now(), last = t0, raf = 0, done = false;
    const interactive = kind === 'balloons';
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      layer.removeEventListener('pointerdown', onTap);
      cont.removeEventListener('click', finish);
      layer.className = '';
      ctx.clearRect(0, 0, W, H);
      effects.forEach((e) => e.stop?.());
      resolve();
    };
    const onTap = (e) => {
      if (e.target === cont) return;
      if (interactive) return;
      if (performance.now() - t0 > 600) finish();
    };
    layer.addEventListener('pointerdown', onTap);
    cont.addEventListener('click', finish);
    setTimeout(() => (cont.hidden = false), 1200);
    const frame = (now) => {
      const t = now - t0, k = Math.min(3, (now - last) / 16.67);
      last = now;
      const clear = effects[0].clear;
      if (clear === 'clear') ctx.clearRect(0, 0, W, H);
      else if (clear === 'fade') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      let alive = false;
      for (const e of effects) if (e.frame(t, k)) alive = true;
      if (!alive || t > 20000) return finish();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

function drawCard(ctx, c, x, y, rot = 0, sc = 1, alpha = 1) {
  const w = c.w * sc, h = c.h * sc;
  ctx.globalAlpha = alpha;
  if (!rot) ctx.drawImage(c.img, x - w / 2, y - h / 2, w, h);
  else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(c.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---- Bouncing cards that leave a trail behind them ----
function cascade(env) {
  const { ctx, W, H, s } = env;
  const piles = new Map();
  for (const c of env.cards) {
    if (!piles.has(c.pile)) piles.set(c.pile, []);
    piles.get(c.pile).push(c);
  }
  const stacks = [...piles.values()];
  for (const st of stacks) {
    const t = st[st.length - 1];
    ctx.drawImage(t.img, t.x, t.y, t.w, t.h);
  }
  let flying = [], turn = 0, lastLaunch = -1e9, lastBounce = 0;
  const g = 0.42 * s;
  return {
    clear: 'none',
    frame(t, k) {
      const left = stacks.some((st) => st.length);
      if (left && flying.length < 3 && t - lastLaunch > 260 && t < 14000) {
        let st;
        for (let n = 0; n < stacks.length; n++) {
          st = stacks[turn++ % stacks.length];
          if (st.length) break;
        }
        const c = st.pop();
        ctx.clearRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
        const nt = st[st.length - 1];
        if (nt) ctx.drawImage(nt.img, nt.x, nt.y, nt.w, nt.h);
        const dir = c.x + c.w / 2 < W / 2 ? 1 : -1;
        const low = c.y > H * 0.45;
        flying.push({ c, x: c.x, y: c.y, vx: dir * rnd(2.2, 5.2) * s * (Math.random() < 0.25 ? -1 : 1), vy: -rnd(1, 7) * s - (low ? rnd(9, 15) * s : 0) });
        lastLaunch = t;
      }
      for (const f of flying) {
        f.vy += g * k;
        f.x += f.vx * k;
        f.y += f.vy * k;
        if (f.y + f.c.h > H) {
          f.y = H - f.c.h;
          f.vy = -f.vy * 0.8;
          if (Math.abs(f.vy) > 3 && t - lastBounce > 90) { sfx.bounce(); lastBounce = t; }
        }
        ctx.drawImage(f.c.img, f.x, f.y, f.c.w, f.c.h);
      }
      flying = flying.filter((f) => f.x + f.c.w > 0 && f.x < W);
      return left || flying.length > 0;
    },
  };
}

// ---- Fireworks ----
function fireworks(env, palette) {
  const { ctx, W, H, s } = env;
  let rockets = [], sparks = [], next = 200, finale = false;
  const shapes = ['sphere', 'ring', 'heart', 'double', 'willow', 'sphere', 'heart'];
  const explode = (x, y, color) => {
    const shape = pick(shapes);
    const v = 4.2 * s * rnd(0.85, 1.2);
    const n = shape === 'ring' ? 60 : 96;
    const c2 = pick(palette);
    for (let i = 0; i < n; i++) {
      let vx, vy, life = rnd(55, 85), col = color, g = 0.035 * s;
      if (shape === 'sphere') { const a = rnd(Math.PI * 2), m = v * Math.sqrt(Math.random()); vx = Math.cos(a) * m; vy = Math.sin(a) * m; }
      else if (shape === 'ring') { const a = (i / n) * Math.PI * 2; vx = Math.cos(a) * v; vy = Math.sin(a) * v * 0.9; }
      else if (shape === 'double') { const a = (i / n) * Math.PI * 4, m = i % 2 ? v : v * 0.55; vx = Math.cos(a) * m; vy = Math.sin(a) * m; col = i % 2 ? color : c2; }
      else if (shape === 'willow') { const a = rnd(Math.PI * 2), m = v * 0.8 * Math.sqrt(Math.random()); vx = Math.cos(a) * m; vy = Math.sin(a) * m; life = rnd(90, 130); g = 0.05 * s; col = '#ffd27a'; }
      else {
        const tt = (i / n) * Math.PI * 2;
        vx = (16 * Math.sin(tt) ** 3) / 16 * v;
        vy = -(13 * Math.cos(tt) - 5 * Math.cos(2 * tt) - 2 * Math.cos(3 * tt) - Math.cos(4 * tt)) / 16 * v;
        col = pick(['#ff5a7a', '#ff8fab', '#ffd1dc']);
      }
      sparks.push({ x, y, vx, vy, life, age: 0, color: col, g });
    }
    sfx.boom();
  };
  const launch = () => {
    rockets.push({ x: W * rnd(0.15, 0.85), y: H + 10, vx: rnd(-1, 1) * s, vy: -H * 0.0125 * rnd(0.8, 1.05) * (60 / 60), color: pick(palette) });
  };
  return {
    clear: 'fade',
    frame(t, k) {
      if (t > next && t < 6500) { launch(); next = t + rnd(280, 640); }
      if (!finale && t > 6600) { finale = true; for (let i = 0; i < 5; i++) setTimeout(launch, i * 90); }
      ctx.globalCompositeOperation = 'lighter';
      for (const r of rockets) {
        r.vy += 0.1 * s * k;
        r.x += r.vx * k;
        r.y += r.vy * k;
        ctx.fillStyle = '#fff2c0';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.4 * Math.max(0.6, s), 0, 7);
        ctx.fill();
        if (r.vy > -1.2 * s) { r.dead = true; explode(r.x, r.y, r.color); }
      }
      rockets = rockets.filter((r) => !r.dead);
      for (const p of sparks) {
        p.age += k;
        p.vy += p.g * k;
        p.vx *= 0.986;
        p.vy *= 0.986;
        p.x += p.vx * k;
        p.y += p.vy * k;
        const a = Math.max(0, 1 - p.age / p.life);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * Math.max(0.7, s) * (0.5 + a * 0.6), 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      sparks = sparks.filter((p) => p.age < p.life);
      return t < 7200 || rockets.length > 0 || sparks.length > 0;
    },
  };
}

// ---- Confetti cannons and a shower from the top ----
function confetti(env, palette, quiet = false) {
  const { ctx, W, H, s } = env;
  const bits = [];
  const add = (x, y, vx, vy) =>
    bits.push({ x, y, vx, vy, rot: rnd(6), vr: rnd(-0.2, 0.2), flip: rnd(6), vf: rnd(0.08, 0.2), w: rnd(6, 12) * s + 3, h: rnd(10, 18) * s + 4, color: pick(palette), round: Math.random() < 0.25 });
  const cannon = () => {
    for (let i = 0; i < 110; i++) {
      add(-10, H * 0.95, rnd(6, 15) * s, -rnd(12, 22) * s);
      add(W + 10, H * 0.95, -rnd(6, 15) * s, -rnd(12, 22) * s);
    }
    if (!quiet) sfx.pop();
  };
  cannon();
  let second = false;
  return {
    clear: 'clear',
    frame(t, k) {
      if (!second && t > 1300) { second = true; cannon(); }
      if (t > 1600 && t < 4600) for (let i = 0; i < 3; i++) add(rnd(W), -20, rnd(-1, 1), rnd(1, 3) * s);
      for (const b of bits) {
        b.vy += 0.28 * s * k;
        b.vx *= 0.985;
        b.vy *= 0.985;
        if (b.vy > 3.4 * s + 1) b.vy = 3.4 * s + 1;
        b.x += (b.vx + Math.sin(b.flip) * 0.8) * k;
        b.y += b.vy * k;
        b.rot += b.vr * k;
        b.flip += b.vf * k;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.scale(1, Math.cos(b.flip));
        ctx.fillStyle = b.color;
        if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.w / 2, 0, 7); ctx.fill(); }
        else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].y > H + 40) bits.splice(i, 1);
      return t < 5000 || bits.length > 0;
    },
  };
}

// ---- Cards fly into a big heart, it beats, then bursts ----
function heart(env) {
  const { ctx, W, H, s } = env;
  const cards = env.cards.length > 52 ? env.cards.filter((_, i) => i % 2 === 0).slice(0, 52) : env.cards;
  const N = cards.length;
  const R = Math.min(W * 0.028, H * 0.019);
  const cx = W / 2, cy = H * 0.56 - 2.75 * R;
  const sc = Math.min(0.55, (Math.min(W, H) * 0.085) / env.ch);
  const pts = cards.map((c, i) => {
    const t = (i / N) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const dx = 48 * Math.sin(t) ** 2 * Math.cos(t), dy = 13 * Math.sin(t) - 10 * Math.sin(2 * t) - 6 * Math.sin(3 * t) - 4 * Math.sin(4 * t);
    return {
      c, i, x0: c.x + c.w / 2, y0: c.y + c.h / 2, tx: cx + x * R, ty: cy + y * R,
      rot: Math.atan2(dy, dx) + Math.PI / 2, mx: cx + rnd(-W * 0.3, W * 0.3), my: rnd(-H * 0.1, H * 0.25),
      vx: 0, vy: 0, spin: rnd(-0.2, 0.2),
    };
  });
  let burst = false, beats = 0;
  sfx.whoosh();
  return {
    clear: 'clear',
    frame(t) {
      const beatT = t - 2200;
      let pulse = 1;
      if (beatT > 0 && beatT < 2400) {
        const ph = (beatT % 1000) / 1000;
        pulse = 1 + 0.08 * Math.max(0, Math.sin(ph * Math.PI * 4)) * (ph < 0.5 ? 1 : 0);
        const b = Math.floor(beatT / 1000);
        if (b >= beats) { beats = b + 1; sfx.home(beats * 2); }
      }
      if (!burst && t > 4600) {
        burst = true;
        sfx.boom();
        sfx.sparkle();
        for (const p of pts) {
          const a = Math.atan2(p.ty - cy, p.tx - cx);
          const m = rnd(6, 14) * s;
          p.vx = Math.cos(a) * m;
          p.vy = Math.sin(a) * m - 4 * s;
          p.x = p.tx; p.y = p.ty;
        }
      }
      let alive = false;
      for (const p of pts) {
        let x, y, rot, scl = sc;
        if (!burst) {
          const q = ease((t - p.i * 26) / 1100);
          const u = 1 - q;
          x = u * u * p.x0 + 2 * u * q * p.mx + q * q * p.tx;
          y = u * u * p.y0 + 2 * u * q * p.my + q * q * p.ty;
          rot = p.rot * q;
          scl = 1 + (sc - 1) * q;
          x = cx + (x - cx) * pulse;
          y = cy + (y - cy) * pulse;
          alive = true;
        } else {
          p.vy += 0.4 * s;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.spin;
          x = p.x; y = p.y; rot = p.rot;
          if (y < H + env.ch) alive = true;
        }
        drawCard(ctx, p.c, x, y, rot, scl);
      }
      if (!burst && t > 2200) {
        ctx.font = `${Math.round(44 * s + 12)}px serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,90,122,.9)';
        ctx.fillText('♥', cx, cy + R * 1.5);
      }
      return alive || t < 5000;
    },
  };
}

// ---- Balloons to pop ----
function balloons(env, canvas) {
  const { ctx, W, H, s } = env;
  const colors = ['#ff5a5f', '#ffb400', '#00a699', '#7b61ff', '#ff7ac6', '#3ec1ff', '#8bd346'];
  const glyphs = ['♠', '♥', '♦', '♣'];
  const r0 = Math.min(W, H) * 0.05;
  const list = Array.from({ length: 20 }, (_, i) => ({
    x: rnd(W * 0.06, W * 0.94), y: H + r0 * 2 + i * r0 * 0.9 + rnd(r0 * 3), vy: -rnd(1.6, 2.8) * s - 0.6,
    r: r0 * rnd(0.85, 1.2), sway: rnd(6.28), color: pick(colors), g: pick(glyphs), popped: false,
  }));
  const bits = [];
  let popped = 0;
  const onDown = (e) => {
    const x = e.clientX, y = e.clientY;
    for (const b of list) {
      if (b.popped) continue;
      const bx = b.x + Math.sin(b.sway) * 12;
      if ((x - bx) ** 2 / (b.r * 0.9) ** 2 + (y - b.y) ** 2 / (b.r * 1.15) ** 2 < 1.4) {
        b.popped = true;
        popped++;
        sfx.pop();
        for (let i = 0; i < 26; i++) {
          const a = rnd(6.28), m = rnd(2, 7) * s;
          bits.push({ x: bx, y: b.y, vx: Math.cos(a) * m, vy: Math.sin(a) * m, life: rnd(30, 55), age: 0, color: pick([b.color, '#fff', '#ffe28a']) });
        }
        break;
      }
    }
  };
  canvas.closest('#celebrate').addEventListener('pointerdown', onDown);
  return {
    clear: 'clear',
    stop() { canvas.closest('#celebrate').removeEventListener('pointerdown', onDown); },
    frame(t, k) {
      let alive = false;
      for (const b of list) {
        if (b.popped) continue;
        b.y += b.vy * k;
        b.sway += 0.03 * k;
        const x = b.x + Math.sin(b.sway) * 12;
        if (b.y > -b.r * 3) alive = true;
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, b.y + b.r * 1.15);
        ctx.quadraticCurveTo(x + Math.sin(b.sway * 2) * 10, b.y + b.r * 2, x, b.y + b.r * 3);
        ctx.stroke();
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.ellipse(x, b.y, b.r * 0.9, b.r * 1.15, 0, 0, 7);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 5, b.y + b.r * 1.22);
        ctx.lineTo(x + 5, b.y + b.r * 1.22);
        ctx.lineTo(x, b.y + b.r * 1.1);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.beginPath();
        ctx.ellipse(x - b.r * 0.35, b.y - b.r * 0.45, b.r * 0.18, b.r * 0.32, -0.5, 0, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.font = `${Math.round(b.r * 0.9)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.g, x, b.y + b.r * 0.08);
      }
      for (const p of bits) {
        p.age += k;
        p.vy += 0.2 * s * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
      ctx.globalAlpha = 1;
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].age > bits[i].life) bits.splice(i, 1);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.font = `600 ${Math.round(16 * s + 12)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 6;
      ctx.fillText(popped ? `Popped ${popped}${popped === list.length ? ' – every one!' : '!'}` : 'Click the balloons to pop them!', W / 2, H * 0.27);
      ctx.shadowBlur = 0;
      return alive || bits.length > 0;
    },
  };
}

// ---- A fountain of spinning cards ----
function fountain(env) {
  const { ctx, W, H, s } = env;
  const flying = [];
  let last = -1e9;
  const sparks = [];
  return {
    clear: 'clear',
    frame(t, k) {
      if (t < 4400 && t - last > 55) {
        last = t;
        const c = pick(env.cards);
        flying.push({ c, x: W / 2 + rnd(-20, 20), y: H + env.ch, vx: rnd(-1, 1) * W * 0.0045, vy: -H * rnd(0.021, 0.028), rot: rnd(6.28), vr: rnd(-0.15, 0.15), sc: rnd(0.55, 0.85) });
        for (let i = 0; i < 3; i++) sparks.push({ x: W / 2, y: H, vx: rnd(-3, 3), vy: -rnd(6, 14) * s, age: 0, life: rnd(30, 60) });
        if (Math.random() < 0.3) sfx.deal(1);
      }
      const g = H * 0.00042;
      for (const f of flying) {
        f.vy += g * k;
        f.x += f.vx * k;
        f.y += f.vy * k;
        f.rot += f.vr * k;
        drawCard(ctx, f.c, f.x, f.y, f.rot, f.sc);
      }
      ctx.fillStyle = '#ffe28a';
      for (const p of sparks) {
        p.age += k;
        p.vy += 0.25 * s * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let i = flying.length - 1; i >= 0; i--) if (flying[i].y > H + env.ch * 2 && flying[i].vy > 0) flying.splice(i, 1);
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].age > sparks[i].life) sparks.splice(i, 1);
      return t < 4500 || flying.length > 0;
    },
  };
}

// ---- Cards swirl into a spinning galaxy, then fly apart ----
function spiral(env) {
  const { ctx, W, H, s } = env;
  const cards = env.cards.length > 60 ? env.cards.filter((_, i) => i % 2 === 0) : env.cards;
  const N = cards.length;
  const R = Math.min(W, H) * 0.42;
  const cx = W / 2, cy = H / 2;
  const sc = Math.min(0.5, (Math.min(W, H) * 0.1) / env.ch);
  const pts = cards.map((c, i) => {
    const d = (i + 4) / (N + 4);
    return { c, i, x0: c.x + c.w / 2, y0: c.y + c.h / 2, a0: (i % 3) * ((Math.PI * 2) / 3) + d * Math.PI * 3, r: d * R };
  });
  let theta = 0, omega = 0, out = false;
  sfx.whoosh();
  return {
    clear: 'clear',
    frame(t, k) {
      omega = t < 4200 ? 0.004 + (t / 4200) * 0.05 : omega;
      theta += omega * k;
      if (!out && t > 4200) { out = true; sfx.boom(); sfx.sparkle(); }
      let alive = false;
      for (const p of pts) {
        const q = ease((t - p.i * 22) / 1300);
        let r = p.r;
        if (out) r = p.r * (1 + ((t - 4200) / 600) ** 2 * 1.5);
        const a = p.a0 + theta;
        const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r * 0.82;
        const x = p.x0 + (tx - p.x0) * q, y = p.y0 + (ty - p.y0) * q;
        const scl = 1 + (sc * (0.6 + p.r / R) - 1) * q;
        if (x > -100 && x < W + 100 && y > -100 && y < H + 100) alive = true;
        drawCard(ctx, p.c, x, y, a + Math.PI / 2, scl);
      }
      if (t < 4200) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.25);
        g.addColorStop(0, `rgba(255,240,190,${0.5 * Math.min(1, t / 2000)})`);
        g.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      return alive || t < 4300;
    },
  };
}
