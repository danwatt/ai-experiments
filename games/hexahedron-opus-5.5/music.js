// Procedural soundtrack in the spirit of early-90s MIDI mine-crawler music: four-bar minor
// progressions, driving pick-bass, saw pads, square-lead riffs with a tempo-synced echo, and
// a rock kit. All patterns are original and synthesized live with WebAudio.

// Chords are [bass midi note, 'm' | 'M']. kick/snare are 16th-step positions in a bar.
const SONGS = {
  1: { bpm: 124, chords: [[40, 'm'], [36, 'M'], [38, 'M'], [35, 'm']], bass: 0, lead: [0, 1], kick: [0, 6, 8, 11], snare: [4, 12] },
  2: { bpm: 132, chords: [[38, 'm'], [34, 'M'], [36, 'M'], [33, 'M']], bass: 1, lead: [2, 3], kick: [0, 3, 8, 10], snare: [4, 12] },
  3: { bpm: 140, chords: [[42, 'm'], [38, 'M'], [40, 'M'], [37, 'M']], bass: 2, lead: [4, 5], kick: [0, 4, 8, 11, 12], snare: [4, 12] },
  4: { bpm: 150, chords: [[43, 'm'], [39, 'M'], [41, 'M'], [38, 'M']], bass: 2, lead: [3, 6], kick: [0, 3, 6, 8, 11, 14], snare: [4, 12] },
  escape: { bpm: 164, chords: [[42, 'm'], [43, 'M'], [42, 'm'], [40, 'M']], bass: 3, lead: [6, 6], kick: [0, 4, 8, 12, 14], snare: [4, 12] },
};
const _ = null;
// Bass lines: semitones above the chord root, one entry per 16th.
const BASS = [
  [0, _, 0, _, 12, _, 0, _, 0, _, 12, _, 0, _, 10, _],
  [0, 0, 12, _, 0, 0, 12, _, 0, 0, 12, _, 7, _, 10, _],
  [0, _, 0, 12, 0, _, 0, 12, 0, _, 0, 12, 7, 7, 10, 12],
  [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 7, 10, 12],
];
// Lead riffs: indexes into the chord's tones (root, third, fifth, octave, ...), one per 16th.
const LEAD = [
  [0, _, _, 2, _, _, 3, _, 2, _, 1, _, 0, _, _, _],
  [1, _, _, 2, _, _, 4, _, 3, _, 2, _, 1, _, 2, _],
  [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
  [0, 2, 3, 5, 3, 2, 0, 2, 3, 5, 4, 3, 2, 3, 2, 1],
  [3, _, 3, 2, 3, _, 4, _, 5, _, 4, 3, 2, _, _, _],
  [2, _, 2, 1, 2, _, 3, _, 4, 3, 2, 1, 0, _, _, _],
  [0, 2, 3, 2, 0, 2, 3, 4, 0, 2, 3, 2, 5, 4, 3, 2],
];
const TONES = { m: [0, 3, 7, 12, 15, 19, 24], M: [0, 4, 7, 12, 16, 19, 24] };
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function createMusic(ctx, out) {
  const bus = ctx.createGain(); bus.gain.value = 0.42; bus.connect(out);
  const leadBus = ctx.createGain(); leadBus.connect(bus);
  const echo = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
  fb.gain.value = 0.42; wet.gain.value = 0.35;
  leadBus.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(bus);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function osc(type, f, t, dur, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, filterType, freq, vol) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = filterType; f.frequency.value = freq;
    env(g, t, 0.002, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  const kick = (t) => {
    const g = ctx.createGain(); env(g, t, 0.003, 0.55, 0.22); g.connect(bus);
    const o = osc('sine', 150, t, 0.22, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  };
  const snare = (t, v = 1) => {
    noise(t, 0.16, 'bandpass', 1900, 0.28 * v);
    const g = ctx.createGain(); env(g, t, 0.002, 0.12 * v, 0.09); g.connect(bus); osc('triangle', 210, t, 0.09, g);
  };
  const hat = (t, v) => noise(t, 0.035, 'highpass', 7500, v);
  function bass(n, t, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
    env(g, t, 0.004, 0.17, dur);
    f.connect(g); g.connect(bus);
    osc('sawtooth', hz(n), t, dur, f); osc('square', hz(n - 12), t, dur, f);
  }
  function pad(notes, t, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.25);
    g.gain.setValueAtTime(0.045, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(bus);
    for (const n of notes) { osc('sawtooth', hz(n), t, dur, f, -7); osc('sawtooth', hz(n), t, dur, f, 7); }
  }
  function lead(n, t, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 2600;
    env(g, t, 0.006, 0.06, dur);
    f.connect(g); g.connect(leadBus);
    osc('square', hz(n), t, dur, f); osc('sawtooth', hz(n + 12), t, dur, f, 5);
  }

  let song = SONGS[1], wanted = SONGS[1], step = 0, bar = 0, next = 0, timer = null;
  function playStep(t) {
    const sp = 60 / song.bpm / 4;
    const [root, q] = song.chords[bar % 4];
    const tones = TONES[q];
    const phase = Math.floor(bar / 4) % 4;          // 0: groove only, 1-3: riffs on top
    const fill = bar % 4 === 3 && step >= 12;
    if (song.kick.includes(step) && !fill) kick(t);
    if (song.snare.includes(step) || (fill && phase > 0)) snare(t, fill ? 0.7 : 1);
    if (step % 2 === 0) hat(t, step % 4 === 2 ? 0.09 : 0.05);
    else if (phase === 3 || song === SONGS.escape) hat(t, 0.035);
    const b = BASS[song.bass][step];
    if (b !== null) bass(root + b, t, sp * 1.7);
    if (step === 0) pad(tones.slice(0, 3).map(x => root + 24 + x), t, sp * 16);
    if (phase > 0) {
      const riff = LEAD[song.lead[(bar >> 1) & 1]];
      const li = riff[step];
      if (li !== null) {
        let len = 1; while (step + len < 16 && riff[step + len] === null && len < 4) len++;
        lead(root + 36 + tones[li], t, sp * len * 0.9);
      }
    }
  }
  function tick() {
    while (next < ctx.currentTime + 0.15) {
      playStep(next);
      next += 60 / song.bpm / 4;
      step = (step + 1) % 16;
      if (step === 0) {
        bar++;
        if (wanted !== song) { song = wanted; bar = 0; }
        echo.delayTime.setValueAtTime(60 / song.bpm * 0.75, next);
      }
    }
  }
  return {
    start() {
      if (timer) return;
      next = ctx.currentTime + 0.1; step = 0; bar = 0;
      echo.delayTime.value = 60 / song.bpm * 0.75;
      bus.gain.setValueAtTime(0.42, ctx.currentTime);
      timer = setInterval(tick, 25);
    },
    stop(fade = 1.5) {
      if (!timer) return;
      clearInterval(timer); timer = null;
      bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    },
    setSong(name) { if (SONGS[name]) wanted = SONGS[name]; },
    setVolume(v) { bus.gain.setTargetAtTime(0.42 * v, ctx.currentTime, 0.2); },
    get playing() { return !!timer; },
    pump: tick,   // schedule ahead by hand (offline rendering / tests)
  };
}
