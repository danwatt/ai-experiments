// Small in-game sparkle bursts and floating words, drawn on a canvas that
// covers the window and ignores the mouse.

const SUIT_CHARS = ['♠', '♥', '♦', '♣'];

export class FX {
  constructor(canvas, textLayer) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.textLayer = textLayer;
    this.parts = [];
    this.running = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const d = devicePixelRatio || 1;
    this.c.width = innerWidth * d;
    this.c.height = innerHeight * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  burst(x, y, { count = 22, colors = ['#ffe28a', '#fff', '#ffc94d'], speed = 4, gravity = 0.08, life = 46, size = 3, suits = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.75);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.3,
        g: gravity,
        life: life * (0.7 + Math.random() * 0.6),
        age: 0,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        glyph: suits ? SUIT_CHARS[(Math.random() * 4) | 0] : null,
        rot: Math.random() * 6,
      });
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.tick());
    }
  }

  tick() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.parts = this.parts.filter((p) => p.age < p.life);
    for (const p of this.parts) {
      p.age++;
      p.vy += p.g;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.x += p.vx;
      p.y += p.vy;
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      if (p.glyph) {
        ctx.font = `${p.size * 5}px serif`;
        ctx.fillText(p.glyph, p.x, p.y);
      } else {
        // four-point twinkle
        const s = p.size * (0.6 + 0.4 * Math.sin(p.age * 0.5 + p.rot));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 2);
        ctx.quadraticCurveTo(p.x, p.y, p.x + s * 2, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 2);
        ctx.quadraticCurveTo(p.x, p.y, p.x - s * 2, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (this.parts.length) requestAnimationFrame(() => this.tick());
    else {
      this.running = false;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  /** A word that floats up and fades, e.g. "Streak x5!". */
  say(x, y, text, cls = '') {
    // Keep words that pop up close together from landing on top of each other.
    const now = performance.now();
    if (this.lastSay && now - this.lastSay.t < 900 && Math.hypot(x - this.lastSay.x, y - this.lastSay.y) < 160) y = this.lastSay.y - 48;
    this.lastSay = { t: now, x, y };
    const e = document.createElement('div');
    e.className = 'float-text ' + cls;
    e.textContent = text;
    e.style.left = x + 'px';
    e.style.top = y + 'px';
    this.textLayer.append(e);
    setTimeout(() => e.remove(), 1800);
  }
}
