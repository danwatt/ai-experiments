// Soft synthesized sounds (Web Audio). No audio files, nothing to download.

let ctx = null, master = null, noise = null;
let enabled = true;

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function setSound(on) {
  enabled = on;
}
export function unlock() {
  if (!enabled) return;
  const c = init();
  if (c && c.state === 'suspended') c.resume();
}

function ready() {
  if (!enabled) return null;
  const c = init();
  if (!c) return null;
  if (c.state === 'suspended') c.resume();
  return c;
}

function burst(t, { dur = 0.05, freq = 2500, q = 1.2, gain = 0.4, type = 'bandpass' } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(t, freq, { dur = 0.4, type = 'sine', gain = 0.2, attack = 0.005, slide = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function bell(t, freq, gain = 0.16, dur = 0.9) {
  tone(t, freq, { dur, gain });
  tone(t, freq * 2.01, { dur: dur * 0.6, gain: gain * 0.35 });
  tone(t, freq * 3.02, { dur: dur * 0.3, gain: gain * 0.15 });
}

const PENTA = [0, 2, 4, 7, 9];
const note = (n) => 523.25 * 2 ** ((PENTA[n % 5] + 12 * Math.floor(n / 5)) / 12);

export const sfx = {
  place() {
    if (!ready()) return;
    const t = ctx.currentTime;
    burst(t, { dur: 0.045, freq: 1800 + Math.random() * 600, gain: 0.35 });
    tone(t, 140, { dur: 0.05, gain: 0.12 });
  },
  flip() {
    if (!ready()) return;
    const t = ctx.currentTime;
    burst(t, { dur: 0.03, freq: 3200, gain: 0.22, type: 'highpass' });
    burst(t + 0.035, { dur: 0.04, freq: 2400, gain: 0.25 });
  },
  deal(n = 1) {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (let k = 0; k < n; k++) burst(t + k * 0.055, { dur: 0.04, freq: 2200 + Math.random() * 900, gain: 0.22 });
  },
  shuffle() {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (let k = 0; k < 26; k++) burst(t + k * 0.022 + Math.random() * 0.01, { dur: 0.03, freq: 2600 + Math.random() * 1500, gain: 0.12 });
  },
  invalid() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(t, 220, { dur: 0.14, type: 'triangle', gain: 0.12 });
    tone(t + 0.09, 175, { dur: 0.18, type: 'triangle', gain: 0.1 });
  },
  home(rank = 1) {
    if (!ready()) return;
    const t = ctx.currentTime;
    burst(t, { dur: 0.04, freq: 2000, gain: 0.25 });
    bell(t + 0.01, note(rank + 2), 0.09, 0.6);
  },
  select() {
    if (!ready()) return;
    tone(ctx.currentTime, 660, { dur: 0.12, gain: 0.07, type: 'triangle' });
  },
  chain(n) {
    if (!ready()) return;
    const t = ctx.currentTime;
    bell(t, note(Math.min(n + 3, 18)), 0.09, 0.5);
  },
  pair() {
    if (!ready()) return;
    const t = ctx.currentTime;
    burst(t, { dur: 0.12, freq: 1200, q: 0.7, gain: 0.25 });
    bell(t + 0.02, note(7), 0.08, 0.5);
    bell(t + 0.08, note(9), 0.07, 0.6);
  },
  run() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [0, 2, 4, 5, 7, 10].forEach((n, k) => bell(t + k * 0.075, note(n + 2), 0.1, 0.9));
  },
  fanfare() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const seq = [[0, 0], [0.12, 2], [0.24, 4], [0.36, 5], [0.6, 7]];
    for (const [d, n] of seq) bell(t + d, note(n), 0.14, 1.2);
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(t + 0.6, f, { dur: 2.2, gain: 0.05, type: 'triangle', attack: 0.08 }));
  },
  pop() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(t, 900 + Math.random() * 400, { dur: 0.08, gain: 0.18, slide: 0.3 });
    burst(t, { dur: 0.06, freq: 3000, gain: 0.2 });
  },
  boom() {
    if (!ready()) return;
    const t = ctx.currentTime;
    burst(t, { dur: 0.5, freq: 260, q: 0.6, gain: 0.45, type: 'lowpass' });
    for (let k = 0; k < 10; k++) burst(t + 0.15 + Math.random() * 0.5, { dur: 0.02, freq: 4000, gain: 0.08, type: 'highpass' });
  },
  whoosh() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(f).connect(g).connect(master);
    src.start(t, 0, 0.5);
  },
  bounce() {
    if (!ready()) return;
    tone(ctx.currentTime, 300 + Math.random() * 300, { dur: 0.06, gain: 0.05, type: 'triangle' });
  },
  sparkle() {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (let k = 0; k < 6; k++) bell(t + k * 0.05 + Math.random() * 0.03, note(10 + Math.floor(Math.random() * 6)), 0.04, 0.4);
  },
};
