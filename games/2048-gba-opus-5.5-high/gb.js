// A small Game Boy (DMG) emulator: SM83 CPU, PPU, timer, joypad, MBC1 and APU.
// Exposes `GameBoy` globally (and via module.exports under Node).
(function (global) {
  'use strict';

  const CLOCK = 4194304;
  const FRAME_CYCLES = 70224;
  const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;

  // ------------------------------------------------------------------ APU
  const DUTY = [0.125, 0.25, 0.5, 0.75];

  class APU {
    constructor(sampleRate) {
      this.rate = sampleRate || 44100;
      this.cyclesPerSample = CLOCK / this.rate;
      this.regs = new Uint8Array(0x30);
      this.ring = new Float32Array(16384);
      this.wr = 0;
      this.rd = 0;
      this.reset();
    }

    reset() {
      this.on = true;
      this.seqAcc = 0;
      this.seqStep = 0;
      this.sampleAcc = 0;
      this.ch = [0, 1, 2, 3].map(() => ({
        on: false, dac: false, len: 0, vol: 0, envDir: 0, envPace: 0, envTimer: 0,
        freq: 0, phase: 0, shadow: 0, sweepTimer: 0, lfsr: 0x7FFF, noiseAcc: 0,
      }));
    }

    setRate(rate) {
      this.rate = rate;
      this.cyclesPerSample = CLOCK / rate;
    }

    available() { return (this.wr - this.rd + this.ring.length) % this.ring.length; }

    // Drops queued samples beyond `max` to keep latency low.
    trim(max) {
      const n = this.available();
      if (n > max) this.rd = (this.rd + n - max) % this.ring.length;
    }

    pull(out) {
      for (let i = 0; i < out.length; i++) {
        if (this.rd === this.wr) { out[i] = 0; continue; }
        out[i] = this.ring[this.rd];
        this.rd = (this.rd + 1) % this.ring.length;
      }
    }

    read(a) {
      const r = a - 0xFF10;
      if (a === 0xFF26) {
        let v = 0x70 | (this.on ? 0x80 : 0);
        this.ch.forEach((c, i) => { if (c.on) v |= 1 << i; });
        return v;
      }
      if (a >= 0xFF30) return this.regs[r];
      const MASK = [0x80, 0x3F, 0x00, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF,
        0xFF, 0xFF, 0x00, 0x00, 0xBF, 0x00, 0x00];
      return (this.regs[r] | (MASK[r] === undefined ? 0xFF : MASK[r])) & 0xFF;
    }

    write(a, v) {
      const r = a - 0xFF10;
      if (a === 0xFF26) {
        this.on = !!(v & 0x80);
        if (!this.on) {
          this.regs.fill(0, 0, 0x16);
          this.ch.forEach(c => { c.on = false; });
        }
        return;
      }
      if (!this.on && a < 0xFF30) return;
      this.regs[r] = v;
      const ch = this.ch;
      switch (a) {
        case 0xFF11: ch[0].len = 64 - (v & 63); break;
        case 0xFF12: ch[0].dac = (v & 0xF8) !== 0; if (!ch[0].dac) ch[0].on = false; break;
        case 0xFF13: ch[0].freq = (ch[0].freq & 0x700) | v; break;
        case 0xFF14: ch[0].freq = (ch[0].freq & 0xFF) | ((v & 7) << 8); if (v & 0x80) this.trigger(0); break;
        case 0xFF16: ch[1].len = 64 - (v & 63); break;
        case 0xFF17: ch[1].dac = (v & 0xF8) !== 0; if (!ch[1].dac) ch[1].on = false; break;
        case 0xFF18: ch[1].freq = (ch[1].freq & 0x700) | v; break;
        case 0xFF19: ch[1].freq = (ch[1].freq & 0xFF) | ((v & 7) << 8); if (v & 0x80) this.trigger(1); break;
        case 0xFF1A: ch[2].dac = (v & 0x80) !== 0; if (!ch[2].dac) ch[2].on = false; break;
        case 0xFF1B: ch[2].len = 256 - v; break;
        case 0xFF1D: ch[2].freq = (ch[2].freq & 0x700) | v; break;
        case 0xFF1E: ch[2].freq = (ch[2].freq & 0xFF) | ((v & 7) << 8); if (v & 0x80) this.trigger(2); break;
        case 0xFF20: ch[3].len = 64 - (v & 63); break;
        case 0xFF21: ch[3].dac = (v & 0xF8) !== 0; if (!ch[3].dac) ch[3].on = false; break;
        case 0xFF23: if (v & 0x80) this.trigger(3); break;
      }
    }

    trigger(i) {
      const c = this.ch[i];
      const env = [0x02, 0x07, 0, 0x11][i];
      c.on = c.dac;
      if (c.len === 0) c.len = i === 2 ? 256 : 64;
      if (i !== 2) {
        const e = this.regs[env];
        c.vol = e >> 4;
        c.envDir = e & 8;
        c.envPace = e & 7;
        c.envTimer = c.envPace;
      }
      if (i === 0) {
        const s = this.regs[0];
        c.shadow = c.freq;
        c.sweepTimer = ((s >> 4) & 7) || 8;
        if ((s & 7) && this.sweepCalc() > 2047) c.on = false;
      }
      if (i === 3) c.lfsr = 0x7FFF;
      if (i === 2) c.phase = 0;
    }

    sweepCalc() {
      const c = this.ch[0], s = this.regs[0];
      const d = c.shadow >> (s & 7);
      return (s & 8) ? c.shadow - d : c.shadow + d;
    }

    sequence() {
      const step = this.seqStep;
      this.seqStep = (step + 1) & 7;
      const lenEnable = [this.regs[0x04], this.regs[0x09], this.regs[0x0E], this.regs[0x13]];
      if ((step & 1) === 0) {
        this.ch.forEach((c, i) => {
          if ((lenEnable[i] & 0x40) && c.len > 0 && --c.len === 0) c.on = false;
        });
      }
      if (step === 2 || step === 6) {
        const c = this.ch[0], s = this.regs[0], pace = (s >> 4) & 7;
        if (--c.sweepTimer <= 0) {
          c.sweepTimer = pace || 8;
          if (pace && c.on) {
            const f = this.sweepCalc();
            if (f > 2047) c.on = false;
            else if (s & 7) {
              c.shadow = c.freq = f;
              if (this.sweepCalc() > 2047) c.on = false;
            }
          }
        }
      }
      if (step === 7) {
        for (const i of [0, 1, 3]) {
          const c = this.ch[i];
          if (!c.envPace) continue;
          if (--c.envTimer <= 0) {
            c.envTimer = c.envPace;
            if (c.envDir && c.vol < 15) c.vol++;
            else if (!c.envDir && c.vol > 0) c.vol--;
          }
        }
      }
    }

    sample() {
      const ch = this.ch, rate = this.rate;
      const out = [0, 0, 0, 0];
      for (let i = 0; i < 2; i++) {
        const c = ch[i];
        if (!c.on) continue;
        const hz = 131072 / (2048 - c.freq);
        c.phase = (c.phase + hz / rate) % 1;
        const duty = DUTY[this.regs[i === 0 ? 0x01 : 0x06] >> 6];
        out[i] = (c.phase < duty ? 1 : -1) * c.vol / 15;
      }
      const w = ch[2];
      if (w.on) {
        const hz = 65536 / (2048 - w.freq);
        w.phase = (w.phase + hz / rate) % 1;
        const pos = Math.floor(w.phase * 32);
        const byte = this.regs[0x20 + (pos >> 1)];
        const nib = (pos & 1) ? byte & 15 : byte >> 4;
        const shift = [4, 0, 1, 2][(this.regs[0x0C] >> 5) & 3];
        out[2] = ((nib >> shift) / 7.5) - 1;
      }
      const n = ch[3];
      if (n.on) {
        const p = this.regs[0x12];
        const div = (p & 7) ? (p & 7) * 16 : 8;
        const hz = CLOCK / (div << (p >> 4));
        n.noiseAcc += hz / rate;
        let steps = Math.min(64, Math.floor(n.noiseAcc));
        n.noiseAcc -= Math.floor(n.noiseAcc);
        while (steps-- > 0) {
          const x = (n.lfsr ^ (n.lfsr >> 1)) & 1;
          n.lfsr = (n.lfsr >> 1) | (x << 14);
          if (p & 8) n.lfsr = (n.lfsr & ~0x40) | (x << 6);
        }
        out[3] = ((n.lfsr & 1) ? -1 : 1) * n.vol / 15;
      }
      const pan = this.regs[0x15], master = this.regs[0x14];
      let l = 0, r = 0;
      for (let i = 0; i < 4; i++) {
        if (pan & (0x10 << i)) l += out[i];
        if (pan & (1 << i)) r += out[i];
      }
      l *= (((master >> 4) & 7) + 1) / 8;
      r *= ((master & 7) + 1) / 8;
      return (l + r) * 0.15;
    }

    tick(cyc) {
      this.seqAcc += cyc;
      while (this.seqAcc >= 8192) { this.seqAcc -= 8192; this.sequence(); }
      this.sampleAcc += cyc;
      while (this.sampleAcc >= this.cyclesPerSample) {
        this.sampleAcc -= this.cyclesPerSample;
        const s = this.on ? this.sample() : 0;
        const next = (this.wr + 1) % this.ring.length;
        if (next === this.rd) this.rd = (this.rd + 1) % this.ring.length; // overrun: drop oldest
        this.ring[this.wr] = s;
        this.wr = next;
      }
    }
  }

  // ------------------------------------------------------------------ GameBoy
  class GameBoy {
    constructor(rom, opts = {}) {
      this.rom = rom;
      const type = rom[0x147];
      this.mbc = type >= 1 && type <= 3 ? 1 : 0;
      this.battery = type === 3;
      const ramSizes = { 0: 0, 1: 0x800, 2: 0x2000, 3: 0x8000 };
      this.eram = new Uint8Array(ramSizes[rom[0x149]] || 0);
      this.apu = new APU(opts.sampleRate);
      this.fb = new Uint8Array(160 * 144);
      this.lineBg = new Uint8Array(160);
      this.keys = 0;
      this.onSave = null;
      this.reset();
    }

    reset() {
      this.vram = new Uint8Array(0x2000);
      this.wram = new Uint8Array(0x2000);
      this.oam = new Uint8Array(0xA0);
      this.hram = new Uint8Array(0x7F);
      this.io = new Uint8Array(0x80);
      this.a = 0x01; this.f = 0xB0; this.b = 0x00; this.c = 0x13;
      this.d = 0x00; this.e = 0xD8; this.h = 0x01; this.l = 0x4D;
      this.sp = 0xFFFE; this.pc = 0x0100;
      this.ime = false; this.eiDelay = 0; this.halted = false;
      this.ie = 0; this.if = 0xE1;
      this.romBank = 1; this.ramBank = 0; this.ramEnabled = false; this.ramDirty = false;
      this.p1sel = 0x30;
      this.divCounter = 0xABCC; this.tima = 0; this.tma = 0; this.tac = 0;
      this.lcdc = 0x91; this.stat = 0; this.mode = 2; this.dots = 0;
      this.ly = 0; this.lyc = 0; this.scx = 0; this.scy = 0; this.wx = 0; this.wy = 0; this.winLine = 0;
      this.bgp = 0xFC; this.obp0 = 0xFF; this.obp1 = 0xFF;
      this.apu.reset();
    }

    // -------------------------------------------------------------- memory
    read(a) {
      if (a < 0x4000) return this.rom[a];
      if (a < 0x8000) return this.rom[(this.romBank * 0x4000 + a - 0x4000) % this.rom.length];
      if (a < 0xA000) return this.vram[a - 0x8000];
      if (a < 0xC000) {
        if (!this.ramEnabled || !this.eram.length) return 0xFF;
        return this.eram[(this.ramBank * 0x2000 + a - 0xA000) % this.eram.length];
      }
      if (a < 0xE000) return this.wram[a - 0xC000];
      if (a < 0xFE00) return this.wram[a - 0xE000];
      if (a < 0xFEA0) return this.oam[a - 0xFE00];
      if (a < 0xFF00) return 0xFF;
      if (a < 0xFF80) return this.readIO(a);
      if (a < 0xFFFF) return this.hram[a - 0xFF80];
      return this.ie;
    }

    write(a, v) {
      v &= 0xFF;
      if (a < 0x8000) {
        if (!this.mbc) return;
        if (a < 0x2000) {
          const en = (v & 0x0F) === 0x0A;
          if (this.ramEnabled && !en && this.ramDirty) this.flushSave();
          this.ramEnabled = en;
        } else if (a < 0x4000) {
          this.romBank = (this.romBank & 0x60) | ((v & 0x1F) || 1);
        } else if (a < 0x6000) {
          this.ramBank = v & 3;
        }
        return;
      }
      if (a < 0xA000) { this.vram[a - 0x8000] = v; return; }
      if (a < 0xC000) {
        if (this.ramEnabled && this.eram.length) {
          this.eram[(this.ramBank * 0x2000 + a - 0xA000) % this.eram.length] = v;
          this.ramDirty = true;
        }
        return;
      }
      if (a < 0xE000) { this.wram[a - 0xC000] = v; return; }
      if (a < 0xFE00) { this.wram[a - 0xE000] = v; return; }
      if (a < 0xFEA0) { this.oam[a - 0xFE00] = v; return; }
      if (a < 0xFF00) return;
      if (a < 0xFF80) { this.writeIO(a, v); return; }
      if (a < 0xFFFF) { this.hram[a - 0xFF80] = v; return; }
      this.ie = v;
    }

    flushSave() {
      this.ramDirty = false;
      if (this.battery && this.onSave) this.onSave(this.eram);
    }

    readIO(a) {
      switch (a) {
        case 0xFF00: {
          let lo = 0x0F;
          if (!(this.p1sel & 0x10)) lo &= ~(this.keys >> 4) & 0x0F;
          if (!(this.p1sel & 0x20)) lo &= ~this.keys & 0x0F;
          return 0xC0 | this.p1sel | lo;
        }
        case 0xFF04: return (this.divCounter >> 8) & 0xFF;
        case 0xFF05: return this.tima;
        case 0xFF06: return this.tma;
        case 0xFF07: return this.tac | 0xF8;
        case 0xFF0F: return this.if | 0xE0;
        case 0xFF40: return this.lcdc;
        case 0xFF41: return 0x80 | this.stat | (this.ly === this.lyc ? 4 : 0) | ((this.lcdc & 0x80) ? this.mode : 0);
        case 0xFF42: return this.scy;
        case 0xFF43: return this.scx;
        case 0xFF44: return this.ly;
        case 0xFF45: return this.lyc;
        case 0xFF47: return this.bgp;
        case 0xFF48: return this.obp0;
        case 0xFF49: return this.obp1;
        case 0xFF4A: return this.wy;
        case 0xFF4B: return this.wx;
      }
      if (a >= 0xFF10 && a < 0xFF40) return this.apu.read(a);
      return this.io[a - 0xFF00] | 0;
    }

    writeIO(a, v) {
      if (a >= 0xFF10 && a < 0xFF40) { this.apu.write(a, v); return; }
      switch (a) {
        case 0xFF00: this.p1sel = v & 0x30; return;
        case 0xFF04: this.divCounter = 0; return;
        case 0xFF05: this.tima = v; return;
        case 0xFF06: this.tma = v; return;
        case 0xFF07: this.tac = v & 7; return;
        case 0xFF0F: this.if = v & 0x1F; return;
        case 0xFF40: {
          const was = this.lcdc & 0x80;
          this.lcdc = v;
          if (was && !(v & 0x80)) { this.ly = 0; this.mode = 0; this.dots = 0; }
          if (!was && (v & 0x80)) { this.ly = 0; this.mode = 2; this.dots = 0; this.winLine = 0; }
          return;
        }
        case 0xFF41: this.stat = v & 0x78; return;
        case 0xFF42: this.scy = v; return;
        case 0xFF43: this.scx = v; return;
        case 0xFF44: return;
        case 0xFF45: this.lyc = v; return;
        case 0xFF46: {
          const src = v << 8;
          for (let i = 0; i < 0xA0; i++) this.oam[i] = this.read(src + i);
          return;
        }
        case 0xFF47: this.bgp = v; return;
        case 0xFF48: this.obp0 = v; return;
        case 0xFF49: this.obp1 = v; return;
        case 0xFF4A: this.wy = v; return;
        case 0xFF4B: this.wx = v; return;
      }
      this.io[a - 0xFF00] = v;
    }

    // -------------------------------------------------------------- timer / ppu
    tickTimer(cyc) {
      const old = this.divCounter;
      this.divCounter = (old + cyc) & 0xFFFF;
      if (!(this.tac & 4)) return;
      const period = [1024, 16, 64, 256][this.tac & 3];
      let n = Math.floor((old + cyc) / period) - Math.floor(old / period);
      while (n-- > 0) {
        if (++this.tima > 0xFF) { this.tima = this.tma; this.if |= 4; }
      }
    }

    setLY(v) {
      this.ly = v;
      if (v === this.lyc && (this.stat & 0x40)) this.if |= 2;
    }

    tickPPU(cyc) {
      if (!(this.lcdc & 0x80)) return;
      this.dots += cyc;
      for (;;) {
        if (this.mode === 2) {
          if (this.dots < 80) return;
          this.mode = 3;
        } else if (this.mode === 3) {
          if (this.dots < 252) return;
          this.renderLine();
          this.mode = 0;
          if (this.stat & 0x08) this.if |= 2;
        } else if (this.mode === 0) {
          if (this.dots < 456) return;
          this.dots -= 456;
          this.setLY(this.ly + 1);
          if (this.ly === 144) {
            this.mode = 1;
            this.if |= 1;
            if (this.stat & 0x10) this.if |= 2;
          } else {
            this.mode = 2;
            if (this.stat & 0x20) this.if |= 2;
          }
        } else {
          if (this.dots < 456) return;
          this.dots -= 456;
          if (this.ly === 153) {
            this.setLY(0);
            this.mode = 2;
            this.winLine = 0;
            if (this.stat & 0x20) this.if |= 2;
          } else {
            this.setLY(this.ly + 1);
          }
        }
      }
    }

    tileRow(id, row, signed) {
      const addr = signed ? 0x1000 + ((id << 24) >> 24) * 16 : id * 16;
      return [this.vram[addr + row * 2], this.vram[addr + row * 2 + 1]];
    }

    renderLine() {
      const ly = this.ly, lcdc = this.lcdc, vram = this.vram, fb = this.fb, bg = this.lineBg;
      const base = ly * 160;
      const signed = !(lcdc & 0x10);
      if (lcdc & 1) {
        const map = (lcdc & 0x08) ? 0x1C00 : 0x1800;
        const y = (ly + this.scy) & 0xFF;
        const rowBase = map + (y >> 3) * 32;
        for (let x = 0; x < 160; x++) {
          const px = (x + this.scx) & 0xFF;
          const [lo, hi] = this.tileRow(vram[rowBase + (px >> 3)], y & 7, signed);
          const bit = 7 - (px & 7);
          const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          bg[x] = c;
          fb[base + x] = (this.bgp >> (c * 2)) & 3;
        }
        if ((lcdc & 0x20) && this.wy <= ly && this.wx <= 166) {
          const wmap = (lcdc & 0x40) ? 0x1C00 : 0x1800;
          const y2 = this.winLine;
          const start = this.wx - 7;
          let drawn = false;
          for (let x = Math.max(0, start); x < 160; x++) {
            const px = x - start;
            const [lo, hi] = this.tileRow(vram[wmap + (y2 >> 3) * 32 + (px >> 3)], y2 & 7, signed);
            const bit = 7 - (px & 7);
            const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
            bg[x] = c;
            fb[base + x] = (this.bgp >> (c * 2)) & 3;
            drawn = true;
          }
          if (drawn) this.winLine++;
        }
      } else {
        bg.fill(0);
        fb.fill(0, base, base + 160);
      }

      if (lcdc & 0x02) {
        const h = (lcdc & 0x04) ? 16 : 8;
        const oam = this.oam;
        const list = [];
        for (let i = 0; i < 40 && list.length < 10; i++) {
          const sy = oam[i * 4] - 16;
          if (ly >= sy && ly < sy + h) list.push(i);
        }
        list.sort((p, q) => (oam[p * 4 + 1] - oam[q * 4 + 1]) || (p - q));
        for (let k = list.length - 1; k >= 0; k--) {
          const o = list[k] * 4;
          const sy = oam[o] - 16, sx = oam[o + 1] - 8, fl = oam[o + 3];
          let tile = oam[o + 2];
          let row = ly - sy;
          if (fl & 0x40) row = h - 1 - row;
          if (h === 16) tile &= 0xFE;
          const lo = vram[tile * 16 + row * 2], hi = vram[tile * 16 + row * 2 + 1];
          const pal = (fl & 0x10) ? this.obp1 : this.obp0;
          for (let p = 0; p < 8; p++) {
            const x = sx + p;
            if (x < 0 || x >= 160) continue;
            const bit = (fl & 0x20) ? p : 7 - p;
            const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
            if (!c || ((fl & 0x80) && bg[x])) continue;
            fb[base + x] = (pal >> (c * 2)) & 3;
          }
        }
      }
    }

    // -------------------------------------------------------------- cpu helpers
    get bc() { return (this.b << 8) | this.c; }
    set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
    get de() { return (this.d << 8) | this.e; }
    set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
    get hl() { return (this.h << 8) | this.l; }
    set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
    get af() { return (this.a << 8) | this.f; }
    set af(v) { this.a = (v >> 8) & 0xFF; this.f = v & 0xF0; }

    fetch() {
      const v = this.read(this.pc);
      this.pc = (this.pc + 1) & 0xFFFF;
      return v;
    }
    fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
    push(v) {
      this.sp = (this.sp - 1) & 0xFFFF; this.write(this.sp, v >> 8);
      this.sp = (this.sp - 1) & 0xFFFF; this.write(this.sp, v & 0xFF);
    }
    pop() {
      const lo = this.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
      const hi = this.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
      return (hi << 8) | lo;
    }

    getR(i) {
      switch (i) {
        case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
        case 4: return this.h; case 5: return this.l; case 6: return this.read(this.hl); default: return this.a;
      }
    }
    setR(i, v) {
      switch (i) {
        case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
        case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.write(this.hl, v); break; default: this.a = v;
      }
    }
    getRR(i) { return i === 0 ? this.bc : i === 1 ? this.de : i === 2 ? this.hl : this.sp; }
    setRR(i, v) {
      v &= 0xFFFF;
      if (i === 0) this.bc = v; else if (i === 1) this.de = v; else if (i === 2) this.hl = v; else this.sp = v;
    }
    cond(i) {
      switch (i) {
        case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
        case 2: return !(this.f & FC); default: return !!(this.f & FC);
      }
    }

    alu(k, v) {
      const a = this.a, cy = (this.f >> 4) & 1;
      let r, f = 0;
      switch (k) {
        case 0: r = a + v; f = ((a & 15) + (v & 15) > 15 ? FH : 0) | (r > 255 ? FC : 0); break;
        case 1: r = a + v + cy; f = ((a & 15) + (v & 15) + cy > 15 ? FH : 0) | (r > 255 ? FC : 0); break;
        case 2: case 7: r = a - v; f = FN | ((a & 15) < (v & 15) ? FH : 0) | (r < 0 ? FC : 0); break;
        case 3: r = a - v - cy; f = FN | ((a & 15) - (v & 15) - cy < 0 ? FH : 0) | (r < 0 ? FC : 0); break;
        case 4: r = a & v; f = FH; break;
        case 5: r = a ^ v; break;
        default: r = a | v; break;
      }
      r &= 0xFF;
      if (!r) f |= FZ;
      this.f = f;
      if (k !== 7) this.a = r;
    }

    addSP(e) {
      const sp = this.sp, s = (e << 24) >> 24;
      this.f = (((sp & 0x0F) + (e & 0x0F)) > 0x0F ? FH : 0) | (((sp & 0xFF) + (e & 0xFF)) > 0xFF ? FC : 0);
      return (sp + s) & 0xFFFF;
    }

    // -------------------------------------------------------------- cpu
    step() {
      if (this.eiDelay && --this.eiDelay === 0) this.ime = true;
      const pending = this.ie & this.if & 0x1F;
      if (pending) {
        this.halted = false;
        if (this.ime) {
          this.ime = false;
          const bit = pending & -pending;
          this.if &= ~bit;
          this.push(this.pc);
          this.pc = 0x40 + 8 * (31 - Math.clz32(bit));
          return 20;
        }
      }
      if (this.halted) return 4;
      return this.exec(this.fetch());
    }

    exec(op) {
      if (op >= 0x40 && op < 0x80) {
        if (op === 0x76) { this.halted = true; return 4; }
        const d = (op >> 3) & 7, s = op & 7;
        this.setR(d, this.getR(s));
        return d === 6 || s === 6 ? 8 : 4;
      }
      if (op >= 0x80 && op < 0xC0) {
        const s = op & 7;
        this.alu((op >> 3) & 7, this.getR(s));
        return s === 6 ? 8 : 4;
      }
      if (op < 0x40) {
        const y = (op >> 3) & 7;
        switch (op & 7) {
          case 4: {
            const v = (this.getR(y) + 1) & 0xFF;
            this.f = (this.f & FC) | (v ? 0 : FZ) | ((v & 15) === 0 ? FH : 0);
            this.setR(y, v);
            return y === 6 ? 12 : 4;
          }
          case 5: {
            const v = (this.getR(y) - 1) & 0xFF;
            this.f = (this.f & FC) | FN | (v ? 0 : FZ) | ((v & 15) === 15 ? FH : 0);
            this.setR(y, v);
            return y === 6 ? 12 : 4;
          }
          case 6:
            this.setR(y, this.fetch());
            return y === 6 ? 12 : 8;
        }
      }
      switch (op) {
        case 0x00: return 4;
        case 0x01: case 0x11: case 0x21: case 0x31:
          this.setRR(op >> 4, this.fetch16()); return 12;
        case 0x02: this.write(this.bc, this.a); return 8;
        case 0x12: this.write(this.de, this.a); return 8;
        case 0x22: this.write(this.hl, this.a); this.hl = (this.hl + 1) & 0xFFFF; return 8;
        case 0x32: this.write(this.hl, this.a); this.hl = (this.hl - 1) & 0xFFFF; return 8;
        case 0x0A: this.a = this.read(this.bc); return 8;
        case 0x1A: this.a = this.read(this.de); return 8;
        case 0x2A: this.a = this.read(this.hl); this.hl = (this.hl + 1) & 0xFFFF; return 8;
        case 0x3A: this.a = this.read(this.hl); this.hl = (this.hl - 1) & 0xFFFF; return 8;
        case 0x03: case 0x13: case 0x23: case 0x33:
          this.setRR(op >> 4, this.getRR(op >> 4) + 1); return 8;
        case 0x0B: case 0x1B: case 0x2B: case 0x3B:
          this.setRR(op >> 4, this.getRR(op >> 4) - 1); return 8;
        case 0x09: case 0x19: case 0x29: case 0x39: {
          const hl = this.hl, v = this.getRR(op >> 4), r = hl + v;
          this.f = (this.f & FZ) | (((hl & 0xFFF) + (v & 0xFFF)) > 0xFFF ? FH : 0) | (r > 0xFFFF ? FC : 0);
          this.hl = r & 0xFFFF;
          return 8;
        }
        case 0x07: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xFF; this.f = c ? FC : 0; return 4; }
        case 0x0F: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = c ? FC : 0; return 4; }
        case 0x17: { const c = this.a >> 7; this.a = ((this.a << 1) | ((this.f >> 4) & 1)) & 0xFF; this.f = c ? FC : 0; return 4; }
        case 0x1F: { const c = this.a & 1; this.a = (this.a >> 1) | (((this.f >> 4) & 1) << 7); this.f = c ? FC : 0; return 4; }
        case 0x08: {
          const addr = this.fetch16();
          this.write(addr, this.sp & 0xFF);
          this.write((addr + 1) & 0xFFFF, this.sp >> 8);
          return 20;
        }
        case 0x10: this.fetch(); return 4;
        case 0x18: { const e = (this.fetch() << 24) >> 24; this.pc = (this.pc + e) & 0xFFFF; return 12; }
        case 0x20: case 0x28: case 0x30: case 0x38: {
          const e = (this.fetch() << 24) >> 24;
          if (!this.cond((op >> 3) & 3)) return 8;
          this.pc = (this.pc + e) & 0xFFFF;
          return 12;
        }
        case 0x27: {
          let a = this.a, f = this.f;
          if (!(f & FN)) {
            if ((f & FC) || a > 0x99) { a += 0x60; f |= FC; }
            if ((f & FH) || (a & 0x0F) > 0x09) a += 0x06;
          } else {
            if (f & FC) a -= 0x60;
            if (f & FH) a -= 0x06;
          }
          a &= 0xFF;
          this.a = a;
          this.f = (f & (FN | FC)) | (a ? 0 : FZ);
          return 4;
        }
        case 0x2F: this.a ^= 0xFF; this.f |= FN | FH; return 4;
        case 0x37: this.f = (this.f & FZ) | FC; return 4;
        case 0x3F: this.f = (this.f & FZ) | ((this.f & FC) ^ FC); return 4;

        case 0xC0: case 0xC8: case 0xD0: case 0xD8:
          if (!this.cond((op >> 3) & 3)) return 8;
          this.pc = this.pop(); return 20;
        case 0xC1: this.bc = this.pop(); return 12;
        case 0xD1: this.de = this.pop(); return 12;
        case 0xE1: this.hl = this.pop(); return 12;
        case 0xF1: this.af = this.pop(); return 12;
        case 0xC2: case 0xCA: case 0xD2: case 0xDA: {
          const addr = this.fetch16();
          if (!this.cond((op >> 3) & 3)) return 12;
          this.pc = addr; return 16;
        }
        case 0xC3: this.pc = this.fetch16(); return 16;
        case 0xC4: case 0xCC: case 0xD4: case 0xDC: {
          const addr = this.fetch16();
          if (!this.cond((op >> 3) & 3)) return 12;
          this.push(this.pc); this.pc = addr; return 24;
        }
        case 0xC5: this.push(this.bc); return 16;
        case 0xD5: this.push(this.de); return 16;
        case 0xE5: this.push(this.hl); return 16;
        case 0xF5: this.push(this.af); return 16;
        case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE:
          this.alu((op >> 3) & 7, this.fetch()); return 8;
        case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
          this.push(this.pc); this.pc = op & 0x38; return 16;
        case 0xC9: this.pc = this.pop(); return 16;
        case 0xD9: this.pc = this.pop(); this.ime = true; return 16;
        case 0xCB: return this.execCB(this.fetch());
        case 0xCD: { const addr = this.fetch16(); this.push(this.pc); this.pc = addr; return 24; }
        case 0xE0: this.write(0xFF00 | this.fetch(), this.a); return 12;
        case 0xF0: this.a = this.read(0xFF00 | this.fetch()); return 12;
        case 0xE2: this.write(0xFF00 | this.c, this.a); return 8;
        case 0xF2: this.a = this.read(0xFF00 | this.c); return 8;
        case 0xE8: this.sp = this.addSP(this.fetch()); return 16;
        case 0xF8: this.hl = this.addSP(this.fetch()); return 12;
        case 0xE9: this.pc = this.hl; return 4;
        case 0xEA: this.write(this.fetch16(), this.a); return 16;
        case 0xFA: this.a = this.read(this.fetch16()); return 16;
        case 0xF3: this.ime = false; this.eiDelay = 0; return 4;
        case 0xFB: if (!this.ime) this.eiDelay = 2; return 4;
        case 0xF9: this.sp = this.hl; return 8;
        default: return 4; // unused opcodes
      }
    }

    execCB(op) {
      const r = op & 7, y = (op >> 3) & 7;
      let v = this.getR(r);
      switch (op >> 6) {
        case 0: {
          let c;
          const cy = (this.f >> 4) & 1;
          switch (y) {
            case 0: c = v >> 7; v = ((v << 1) | c) & 0xFF; break;
            case 1: c = v & 1; v = (v >> 1) | (c << 7); break;
            case 2: c = v >> 7; v = ((v << 1) | cy) & 0xFF; break;
            case 3: c = v & 1; v = (v >> 1) | (cy << 7); break;
            case 4: c = v >> 7; v = (v << 1) & 0xFF; break;
            case 5: c = v & 1; v = (v >> 1) | (v & 0x80); break;
            case 6: c = 0; v = ((v & 0x0F) << 4) | (v >> 4); break;
            default: c = v & 1; v >>= 1; break;
          }
          this.f = (v ? 0 : FZ) | (c ? FC : 0);
          this.setR(r, v);
          return r === 6 ? 16 : 8;
        }
        case 1:
          this.f = (this.f & FC) | FH | ((v >> y) & 1 ? 0 : FZ);
          return r === 6 ? 12 : 8;
        case 2:
          this.setR(r, v & ~(1 << y));
          return r === 6 ? 16 : 8;
        default:
          this.setR(r, v | (1 << y));
          return r === 6 ? 16 : 8;
      }
    }

    // -------------------------------------------------------------- driver
    runFrame() {
      let n = 0;
      while (n < FRAME_CYCLES) {
        const c = this.step();
        n += c;
        this.tickTimer(c);
        this.tickPPU(c);
        this.apu.tick(c);
      }
    }

    // mask bits: 7 Down, 6 Up, 5 Left, 4 Right, 3 Start, 2 Select, 1 B, 0 A
    setKeys(mask) {
      const pressed = mask & ~this.keys;
      this.keys = mask;
      if (pressed) this.if |= 0x10;
    }
  }

  GameBoy.CLOCK = CLOCK;
  GameBoy.FRAME_CYCLES = FRAME_CYCLES;
  global.GameBoy = GameBoy;
  if (typeof module !== 'undefined' && module.exports) module.exports = GameBoy;
})(typeof window !== 'undefined' ? window : globalThis);
