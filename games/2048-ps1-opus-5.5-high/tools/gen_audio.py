#!/usr/bin/env python3
"""Build the SPU sound bank and song tables as C source.

Instruments are synthesised here (single-cycle waveforms and three drum
one-shots), encoded to SPU-ADPCM, and written out with the event lists
from music/hexsong.py. Usage: gen_audio.py > build/audio_data.c
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "music"))
import hexsong  # noqa: E402

BANK_ADDR = 0x1010                      # must match SPU_BANK_ADDR in audio.h
FILTERS = [(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)]

INST_LOOP, INST_REVERB, INST_VIBRATO = 1, 2, 4


# ------------------------------------------------------------ synthesis

def additive(length, partials, peak=0.85):
    """One cycle of a waveform built from {harmonic: amplitude}."""
    out = [sum(a * math.sin(2 * math.pi * n * i / length) for n, a in partials.items())
           for i in range(length)]
    m = max(abs(x) for x in out)
    return [x / m * peak for x in out]


def normalise(xs, peak=0.9):
    m = max(abs(x) for x in xs)
    return [x / m * peak for x in xs]


def kick(sr=22050, dur=0.32):
    rnd = random.Random(6)
    out, phase = [], 0.0
    for i in range(int(sr * dur)):
        t = i / sr
        f = 45 + 110 * math.exp(-t / 0.035)
        phase += 2 * math.pi * f / sr
        x = math.sin(phase) * math.exp(-t / 0.11)
        if t < 0.004:
            x += rnd.uniform(-0.35, 0.35)
        out.append(x)
    return normalise(out)


def snare(sr=22050, dur=0.22):
    rnd = random.Random(66)
    out, prev = [], 0.0
    for i in range(int(sr * dur)):
        t = i / sr
        n = rnd.uniform(-1, 1)
        hp, prev = n - 0.6 * prev, n                # brighten the noise a little
        x = hp * 0.8 * math.exp(-t / 0.055) + 0.6 * math.sin(2 * math.pi * 185 * t) * math.exp(-t / 0.03)
        out.append(x)
    return normalise(out)


def hat(sr=44100, dur=0.06):
    rnd = random.Random(666)
    out, p1, p2 = [], 0.0, 0.0
    for i in range(int(sr * dur)):
        t = i / sr
        n = rnd.uniform(-1, 1)
        x = n - 2 * p1 + p2                          # second difference: high-pass
        p2, p1 = p1, n
        out.append(x * math.exp(-t / 0.015))
    return normalise(out, 0.8)


# ------------------------------------------------------------ ADPCM

def encode_block(samples, state, allow_filter):
    """Best (header, nibbles, new_state) for 28 samples, by exhaustive search."""
    best = None
    for f in (range(5) if allow_filter else (0,)):
        f0, f1 = FILTERS[f]
        for r in range(13):
            shift = 12 - r
            old, older = state
            err, nibs = 0, []
            for x in samples:
                p = (old * f0 + older * f1 + 32) >> 6
                q = (x - p) / (1 << shift)
                n = max(-8, min(7, int(round(q))))
                s = max(-32768, min(32767, (n << shift) + p))
                err += (x - s) ** 2
                nibs.append(n & 15)
                older, old = old, s
                if best and err >= best[0]:
                    break
            else:
                if not best or err < best[0]:
                    best = (err, (f << 4) | r, nibs, (old, older))
    return best[1], best[2], best[3]


def encode(xs, loop):
    pcm = [max(-32768, min(32767, int(round(x * 32767)))) for x in xs]
    pcm += [0] * (-len(pcm) % 28)
    nblocks = len(pcm) // 28
    out, state = bytearray(), (0, 0)
    for b in range(nblocks):
        # a loop restarts with whatever the decoder state happens to be, so the
        # first block of a looping sample must not depend on it
        hdr, nibs, state = encode_block(pcm[b * 28:(b + 1) * 28], state, not (loop and b == 0))
        flags = 0
        if loop and b == 0:
            flags |= 4                               # loop start
        if b == nblocks - 1:
            flags |= 3 if loop else 1                # end+repeat / end+mute
        out += bytes([hdr, flags]) + bytes(nibs[i] | (nibs[i + 1] << 4) for i in range(0, 28, 2))
    return bytes(out)


# ------------------------------------------------------------ instruments

def pitch_for(rate, cycle_len=None):
    """Pitch register for MIDI note 69: looping cycles play A4, one-shots play
    at their recorded rate."""
    if cycle_len:
        return round(440.0 * cycle_len * 4096 / 44100)
    return round(rate * 4096 / 44100)


def instruments():
    pulse = {n: math.sin(math.pi * n * 0.25) / n for n in range(1, 13)}
    six_odd = {n: 1.0 / n ** 1.3 for n in (1, 3, 5, 7, 9, 11)}     # six harmonics
    saw = {n: 1.0 / n ** 1.15 for n in range(1, 11)}
    bell = {1: 1.0, 2: 0.35, 3: 0.12, 5: 0.06}
    bass = {1: 1.0, 2: 0.22, 3: 0.2, 4: 0.06, 5: 0.07}
    # name: (samples, loop, rate, cycle, adsr1, adsr2, vol, flags)
    return [
        ("sfx",   additive(56, {1: 1.0}), True, 44100, 56, 0x000F, 0xC92A, 0x1000, 0),
        ("lead",  additive(56, pulse), True, 44100, 56, 0x24AB, 0xCF2C, 0x1500, INST_REVERB | INST_VIBRATO),
        ("bell",  additive(56, bell), True, 44100, 56, 0x00D6, 0xD02D, 0x0E00, INST_REVERB | INST_VIBRATO),
        ("pluck", additive(56, six_odd), True, 44100, 56, 0x00B5, 0xCE2A, 0x0C00, INST_REVERB),
        ("pad",   additive(56, saw, 0.7), True, 44100, 56, 0x30FD, 0x562D, 0x0700, INST_REVERB),
        ("bass",  additive(112, bass), True, 44100, 112, 0x14C9, 0xCF2A, 0x1E00, 0),
        ("kick",  kick(), False, 22050, None, 0x000F, 0x0000, 0x2C00, 0),
        ("snare", snare(), False, 22050, None, 0x000F, 0x0000, 0x1600, INST_REVERB),
        ("hat",   hat(), False, 44100, None, 0x000F, 0x0000, 0x0A00, 0),
    ]


# ------------------------------------------------------------ output

def c_bytes(data, indent="    "):
    lines = []
    for i in range(0, len(data), 16):
        lines.append(indent + ",".join("0x%02X" % b for b in data[i:i + 16]) + ",")
    return "\n".join(lines)


def main():
    insts = instruments()
    names = [i[0] for i in insts]
    assert names[0] == "sfx"
    bank, table = bytearray(), []
    for name, xs, loop, rate, cycle, a1, a2, vol, flags in insts:
        addr = BANK_ADDR + len(bank)
        bank += encode(xs, loop)
        table.append((name, addr // 8, pitch_for(rate, cycle), a1, a2, vol,
                      flags | (INST_LOOP if loop else 0)))

    o = ["/* Generated by tools/gen_audio.py from music/hexsong.py - do not edit. */",
         '#include "../src/audio.h"', ""]
    o.append("const u32 spu_bank_size = %d;" % len(bank))
    o.append("const u8 spu_bank[] __attribute__((aligned(4))) = {\n%s\n};\n" % c_bytes(bank))
    o.append("const Inst instruments[] = {")
    for name, addr, pitch, a1, a2, vol, flags in table:
        o.append("    { 0x%04X, %5d, 0x%04X, 0x%04X, 0x%04X, %d }, /* %s */"
                 % (addr, pitch, a1, a2, vol, flags, name))
    o.append("};\n")

    for s, (rows, tracks) in enumerate(hexsong.SONGS):
        used = [(n, ev) for n, ev in tracks.items() if ev]
        for name, ev in used:
            o.append("static const Event s%d_%s[] = {" % (s, name))
            for row, note, vel, ln, pan in sorted(ev):
                o.append("    { %d, %d, %d, %d, %d }," % (row, note, vel, ln, pan))
            o.append("};")
        o.append("static const Track s%d_tracks[] = {" % s)
        for name, ev in used:
            voice, inst, layer = hexsong.TRACKS[name]
            o.append("    { s%d_%s, %d, %d, %d, %d }," % (s, name, len(ev), names.index(inst), layer, voice))
        o.append("};\n")
    o.append("const Song songs[] = {")
    for s, (rows, tracks) in enumerate(hexsong.SONGS):
        n = sum(1 for ev in tracks.values() if ev)
        o.append("    { s%d_tracks, %d, %d, %d }," % (s, n, rows, hexsong.FRAMES_PER_ROW))
    o.append("};")
    print("\n".join(o))
    print("audio bank: %d bytes, %d instruments" % (len(bank), len(table)), file=sys.stderr)


if __name__ == "__main__":
    main()
