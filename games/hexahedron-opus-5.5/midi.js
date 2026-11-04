// Song files from a Descent HOG: HMI's HMP (the MIDI variant the game shipped with), plus plain
// Standard MIDI for good measure. They are parsed into one time-sorted event list and played on
// a small General MIDI-style WebAudio synth, so no sound fonts or samples are needed.

// ---------------------------------------------------------------- parsing
// Events: { t (seconds), s (status byte), a, b } for channel messages only.
export function parseSong(buf) {
  const u8 = new Uint8Array(buf);
  const tag = String.fromCharCode(...u8.subarray(0, 8));
  if (tag === 'HMIMIDIP') return parseHmp(u8);
  if (tag.startsWith('MThd')) return parseMid(u8);
  throw new Error('Not an HMP or MIDI file');
}

const le32 = (u8, p) => u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24);
const be32 = (u8, p) => ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;

// Walk one track's events. `vlq` reads a delta time and returns [value, next offset].
function readTrack(u8, p, end, vlq, onEvent, onTempo) {
  let tick = 0, status = 0;
  while (p < end) {
    const [d, q] = vlq(u8, p, end);
    p = q; tick += d;
    if (p >= end) break;
    let s = u8[p];
    if (s === 0xff) {                                    // meta
      const type = u8[p + 1];
      const [len, q2] = stdVlq(u8, p + 2, end);
      if (type === 0x2f) break;
      if (type === 0x51 && onTempo) onTempo(tick, (u8[q2] << 16) | (u8[q2 + 1] << 8) | u8[q2 + 2]);
      p = q2 + len;
      continue;
    }
    if (s === 0xf0 || s === 0xf7) {                     // sysex
      const [len, q2] = stdVlq(u8, p + 1, end);
      p = q2 + len;
      continue;
    }
    if (s & 0x80) { status = s; p++; } else s = status;   // running status
    if (!s) break;
    const two = (s & 0xe0) === 0xc0;                     // program change, channel pressure
    onEvent(tick, s, u8[p], two ? 0 : u8[p + 1]);
    p += two ? 1 : 2;
  }
}
function stdVlq(u8, p, end) {
  let v = 0;
  while (p < end) { const c = u8[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
  return [v, p];
}
// HMI stores delta times low group first, with the high bit marking the last byte.
function hmiVlq(u8, p, end) {
  let v = 0, shift = 0;
  while (p < end) { const c = u8[p++]; v += (c & 0x7f) * 2 ** shift; shift += 7; if (c & 0x80) break; }
  return [v, p];
}

function parseHmp(u8) {
  const nTracks = le32(u8, 0x30), rate = le32(u8, 0x38) || 120;   // ticks per second
  if (nTracks < 1 || nTracks > 32) throw new Error('Bad HMP track count');
  const events = [];
  let p = 0x308, length = 0;
  for (let i = 0; i < nTracks && p + 12 <= u8.length; i++) {
    const len = le32(u8, p + 4), end = Math.min(u8.length, p + len);
    // Track 0 holds only the song length (a delay before its end marker).
    let last = 0;
    readTrack(u8, p + 12, end, hmiVlq, (tick, s, a, b) => { events.push({ t: tick / rate, s, a, b }); last = tick; });
    if (i === 0) { const [d] = hmiVlq(u8, p + 12, end); length = d / rate; }
    length = Math.max(length, last / rate);
    p += len;
  }
  return finish(events, length);
}

function parseMid(u8) {
  const nTracks = (u8[10] << 8) | u8[11], div = (u8[12] << 8) | u8[13];
  if (div & 0x8000) throw new Error('SMPTE-timed MIDI is not supported');
  const raw = [], tempos = [[0, 500000]];
  let p = 14;
  for (let i = 0; i < nTracks && p + 8 <= u8.length; i++) {
    const len = be32(u8, p + 4);
    readTrack(u8, p + 8, Math.min(u8.length, p + 8 + len), stdVlq, (tick, s, a, b) => raw.push({ tick, s, a, b }), (tick, us) => tempos.push([tick, us]));
    p += 8 + len;
  }
  tempos.sort((x, y) => x[0] - y[0]);
  const toSec = (tick) => {
    let t = 0, at = 0, us = 500000;
    for (const [tk, u] of tempos) { if (tk >= tick) break; t += (tk - at) * us / div / 1e6; at = tk; us = u; }
    return t + (tick - at) * us / div / 1e6;
  };
  const events = raw.map(e => ({ t: toSec(e.tick), s: e.s, a: e.a, b: e.b }));
  return finish(events, events.length ? events[events.length - 1].t : 0);
}

function finish(events, length) {
  events.sort((x, y) => x.t - y.t);
  if (!events.length) throw new Error('Song has no notes');
  return { events, length: Math.max(length, events[events.length - 1].t + 0.5) };
}

// Descent's level songs: DESCENT.SNG lists the songs (title, briefing, end-level, end-game,
// credits, then the level songs); without one, the gameNN.hmp files in number order.
// Level n plays level song (n - 1) mod count; secret level -n plays song n mod count.
export function levelSongs(hogFiles) {
  const byName = new Map(hogFiles.map(f => [f.name.toLowerCase(), f.data]));
  let names = null;
  const sng = byName.get('descent.sng');
  if (sng) {
    const list = new TextDecoder('latin1').decode(sng).split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    names = list.slice(5).map(n => n.toLowerCase()).filter(n => byName.has(n));
  }
  if (!names || !names.length) {
    names = [...byName.keys()].filter(n => /^game\d+\.(hmp|mid)$/.test(n))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }
  const songs = {};
  for (const n of names) {
    try { parseSong(byName.get(n)); songs[n] = byName.get(n); } catch (err) { console.warn(n, err); }
  }
  names = names.filter(n => songs[n]);
  const forLevel = (levelName) => {
    if (!names.length) return null;
    const m = /^level(s?)(\d+)/i.exec(levelName);
    const n = m ? +m[2] : 1;
    return names[(m && m[1] ? n : n - 1) % names.length];
  };
  return { songs, forLevel };
}

// ---------------------------------------------------------------- synth
// One patch per General MIDI family of eight programs: oscillators (wave, octave, detune),
// envelope (attack, decay, sustain level, release), filter cutoff in multiples of the pitch, gain.
const P = (osc, a, d, s, r, cut, gain) => ({ osc, a, d, s, r, cut, gain });
const FAMILIES = [
  P([['triangle', 0, 0], ['square', 0, 4]], 0.004, 1.2, 0.25, 0.3, 6, 0.9),     // piano
  P([['sine', 0, 0], ['sine', 2, 0]], 0.002, 0.8, 0.0, 0.4, 0, 0.8),            // chromatic percussion
  P([['square', 0, 0], ['sine', 1, 0]], 0.01, 0.1, 0.9, 0.08, 8, 0.6),          // organ
  P([['sawtooth', 0, 0], ['square', 0, 6]], 0.003, 0.9, 0.35, 0.2, 5, 0.75),    // guitar
  P([['sawtooth', 0, 0], ['square', -1, 0]], 0.004, 0.6, 0.5, 0.1, 4, 1.1),     // bass
  P([['sawtooth', 0, -8], ['sawtooth', 0, 8]], 0.12, 0.4, 0.85, 0.4, 5, 0.5),   // strings
  P([['sawtooth', 0, -10], ['sawtooth', 0, 10]], 0.15, 0.5, 0.8, 0.5, 4, 0.45), // ensemble
  P([['sawtooth', 0, 0], ['sawtooth', 0, 5]], 0.03, 0.3, 0.75, 0.15, 6, 0.6),   // brass
  P([['square', 0, 0], ['triangle', 1, 0]], 0.03, 0.2, 0.8, 0.12, 4, 0.55),     // reed
  P([['sine', 0, 0], ['triangle', 1, 0]], 0.04, 0.2, 0.85, 0.15, 0, 0.7),       // pipe
  P([['square', 0, 0], ['sawtooth', 0, 7]], 0.005, 0.3, 0.75, 0.12, 7, 0.55),   // synth lead
  P([['sawtooth', 0, -12], ['triangle', 1, 9]], 0.25, 0.6, 0.8, 0.8, 3, 0.45),  // synth pad
  P([['triangle', 0, 0], ['sawtooth', 1, 15]], 0.05, 0.6, 0.6, 0.6, 4, 0.45),   // synth effects
  P([['triangle', 0, 0], ['square', 1, 0]], 0.002, 0.6, 0.1, 0.2, 5, 0.7),      // ethnic
  P([['sine', 0, 0], ['triangle', 0, 0]], 0.002, 0.4, 0.0, 0.2, 0, 0.9),        // percussive
  P([['triangle', 0, 0], ['sawtooth', -1, 30]], 0.05, 0.5, 0.5, 0.5, 3, 0.4),   // sound effects
];
// Distortion and overdriven guitars stay bright and sustained.
const OVERDRIVE = P([['sawtooth', 0, -6], ['square', 0, 6], ['sawtooth', -1, 0]], 0.004, 0.5, 0.7, 0.15, 9, 0.5);
const patchFor = (prog) => (prog === 29 || prog === 30 ? OVERDRIVE : FAMILIES[prog >> 3]);
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MAX_VOICES = 40, LOOKAHEAD = 0.25;

export function createSongPlayer(ctx, out, song) {
  const VOL = 0.42;
  const bus = ctx.createGain(); bus.gain.value = VOL; bus.connect(out);
  // Songs swing from one quiet track to a dozen loud ones; a compressor evens them out.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
  comp.connect(bus);
  const dry = ctx.createGain(); dry.gain.value = 0.7; dry.connect(comp);
  // A little room: two cross-fed delays.
  const room = ctx.createGain(); room.gain.value = 0.12;
  const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), fb = ctx.createGain(), damp = ctx.createBiquadFilter();
  d1.delayTime.value = 0.067; d2.delayTime.value = 0.113; fb.gain.value = 0.45; damp.type = 'lowpass'; damp.frequency.value = 2400;
  dry.connect(room); room.connect(d1); d1.connect(d2); d2.connect(damp); damp.connect(fb); fb.connect(d1); damp.connect(comp);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  let chans, voices, idx, loopStart, timer = null;
  const reset = () => {
    chans = Array.from({ length: 16 }, () => ({ prog: 0, vol: 100 / 127, expr: 1, pan: null, bend: 0, sustain: false, panner: null }));
    voices = []; idx = 0;
  };
  reset();
  const chanOut = (c) => {
    const ch = chans[c];
    if (!ch.panner) {
      ch.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      ch.panner.connect(dry);
    }
    return ch.panner;
  };

  function noteOn(c, n, vel, t) {
    const ch = chans[c];
    if (voices.length >= MAX_VOICES) release(voices[0], t, 0.03);
    const amp = (vel / 127) ** 1.6 * ch.vol * ch.expr;
    if (c === 9) return drum(n, amp, t, chanOut(c));
    const pt = patchFor(ch.prog);
    const g = ctx.createGain();
    const peak = Math.max(0.0002, amp * pt.gain * 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + pt.a);
    g.gain.setTargetAtTime(Math.max(0.0001, peak * pt.s), t + pt.a, pt.d / 3);
    let dest = g;
    if (pt.cut) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 1.5; f.frequency.value = Math.min(12000, hz(n) * pt.cut + 300);
      f.connect(g); dest = f;
    }
    g.connect(chanOut(c));
    const oscs = pt.osc.map(([type, oct, det]) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = hz(n + 12 * oct); o.detune.value = det + ch.bend;
      o.connect(dest); o.start(t);
      o.det = det;
      return o;
    });
    const v = { c, n, g, oscs, peak, r: pt.r, held: false, end: Infinity };
    // Percussive families fade on their own even if the note is held.
    if (pt.s === 0) { v.end = t + pt.a + pt.d * 1.2; oscs.forEach(o => o.stop(v.end + 0.05)); }
    voices.push(v);
  }
  function release(v, t, r = v.r) {
    if (v.end < t) return;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0.0001, t, r / 4);
    v.end = t + r;
    v.oscs.forEach(o => { try { o.stop(t + r + 0.05); } catch (e) { /* already stopped */ } });
  }
  function noteOff(c, n, t) {
    for (const v of voices) {
      if (v.c !== c || v.n !== n || v.end !== Infinity || v.held) continue;
      if (chans[c].sustain) v.held = true; else release(v, t);
      return;
    }
  }

  function burst(t, dur, type, freq, q, vol, dest) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function tone(t, f0, f1, dur, vol, dest, type = 'sine') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  // General MIDI percussion map, roughly.
  function drum(n, amp, t, dest) {
    const v = amp * 0.5;
    if (n === 35 || n === 36) tone(t, 140, 45, 0.25, v * 1.2, dest);
    else if (n === 38 || n === 40 || n === 39) { burst(t, 0.18, 'bandpass', 1800, 0.7, v * 0.8, dest); tone(t, 220, 160, 0.08, v * 0.4, dest, 'triangle'); }
    else if (n === 37) tone(t, 900, 700, 0.04, v * 0.4, dest, 'square');
    else if (n === 42 || n === 44) burst(t, 0.045, 'highpass', 7500, 0.7, v * 0.35, dest);
    else if (n === 46) burst(t, 0.3, 'highpass', 7000, 0.7, v * 0.3, dest);
    else if ([41, 43, 45, 47, 48, 50].includes(n)) { const f = 70 + (n - 41) * 14; tone(t, f * 1.6, f, 0.3, v * 0.9, dest); }
    else if (n === 49 || n === 57 || n === 52 || n === 55) burst(t, n === 55 ? 0.6 : 1.4, 'highpass', 4500, 0.5, v * 0.35, dest);
    else if (n === 51 || n === 59 || n === 53) { burst(t, 0.5, 'bandpass', 6000, 2, v * 0.25, dest); tone(t, 3100, 3000, 0.3, v * 0.06, dest, 'square'); }
    else if (n === 56) tone(t, 800, 790, 0.15, v * 0.25, dest, 'square');
    else if (n === 54 || n === 69 || n === 70) burst(t, 0.08, 'highpass', 9000, 0.7, v * 0.3, dest);
    else burst(t, 0.1, 'bandpass', 300 + n * 30, 1.5, v * 0.4, dest);
  }

  function control(c, a, b, t) {
    const ch = chans[c];
    if (a === 7) ch.vol = b / 127;
    else if (a === 11) ch.expr = b / 127;
    else if (a === 10) { chanOut(c); if (ch.panner.pan) ch.panner.pan.setValueAtTime((b - 64) / 64 * 0.8, t); }
    else if (a === 64) {
      ch.sustain = b >= 64;
      if (!ch.sustain) for (const v of voices) if (v.c === c && v.held) { v.held = false; release(v, t); }
    } else if (a === 120 || a === 123) for (const v of voices) if (v.c === c) release(v, t, 0.05);
  }

  function play(e, t) {
    const c = e.s & 15;
    switch (e.s & 0xf0) {
      case 0x90: if (e.b) noteOn(c, e.a, e.b, t); else noteOff(c, e.a, t); break;
      case 0x80: noteOff(c, e.a, t); break;
      case 0xb0: control(c, e.a, e.b, t); break;
      case 0xc0: chans[c].prog = e.a; break;
      case 0xe0: {
        const bend = (((e.b << 7) | e.a) - 8192) / 8192 * 200;   // +-2 semitones, in cents
        chans[c].bend = bend;
        for (const v of voices) if (v.c === c && v.end > t) v.oscs.forEach(o => o.detune.setValueAtTime(o.det + bend, t));
        break;
      }
    }
  }

  function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      if (idx >= song.events.length) {
        // Loop: let what is sounding ring out, then start over with fresh channel state.
        const at = loopStart + song.length;
        if (at > horizon) break;
        for (const v of voices) release(v, at, 0.1);
        reset(); loopStart = at;
        continue;
      }
      const e = song.events[idx], t = loopStart + e.t;
      if (t > horizon) break;
      play(e, Math.max(t, ctx.currentTime));
      idx++;
    }
    voices = voices.filter(v => v.end > ctx.currentTime - 0.1);
  }

  return {
    start() {
      if (timer) return;
      for (const v of voices) release(v, ctx.currentTime, 0.05);
      reset();
      loopStart = ctx.currentTime + 0.1;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(VOL, ctx.currentTime);
      timer = setInterval(tick, 25);
      tick();
    },
    stop(fade = 1.5) {
      if (!timer) return;
      clearInterval(timer); timer = null;
      bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      for (const v of voices) release(v, ctx.currentTime + fade, 0.05);
    },
    setSong() { /* one song per level, as in the original */ },
    setVolume(v) { bus.gain.setTargetAtTime(VOL * v, ctx.currentTime, 0.2); },
    get playing() { return !!timer; },
    pump: tick,
  };
}
