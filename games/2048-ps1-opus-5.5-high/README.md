# Hex 2048 · PlayStation

2048 on a 19-cell hexagonal board, built as a PlayStation 1 executable (`hex2048.exe`, 42 KB)
and played in the browser through [EmulatorJS](https://emulatorjs.org/) running the
PCSX-ReARMed core with its built-in HLE BIOS (no Sony BIOS needed).

## How it's made

Bare-metal C plus a few lines of MIPS assembly. There's no SDK and no BIOS calls: the game
drives the hardware registers itself.

| File | What it does |
|------|--------------|
| `src/crt0.s` | Entry point. Sets the stack, masks interrupts, clears `.bss`, calls `main` |
| `src/gpu.c` | 320×240 double buffer. Primitives go into a DMA linked list that is sent once per frame. Gouraud quads for hexes, textured quads for scalable text |
| `src/font.c` | 5×7 ASCII font and 8×10 bold digits, expanded into a 15-bit texture atlas in VRAM at boot |
| `src/pad.c` | Polls the digital pad over SIO0 (0x01/0x42 protocol, waits for /ACK on IRQ7) |
| `src/spu.c` | Uploads the sound bank, sets up hardware reverb, runs the music sequencer on voices 0–9 and sound effects on voices 16–23 |
| `src/audio.h` | Layout of the generated sound bank, instruments and songs |
| `music/hexsong.py` | The soundtrack, written as data: chords, melodies, arpeggio cells, drum patterns |
| `tools/gen_audio.py` | Synthesises the instruments, encodes them to SPU-ADPCM and writes the songs as C tables |
| `src/game.c` | Board logic in axial hex coordinates, slide/merge/spawn animations, title, pause, win and game-over screens, undo |
| `tools/mkexe.py` | Adds the 2 KB `PS-X EXE` header |

The vblank, DMA completion and pad /ACK are all polled from `I_STAT`, so nothing depends on
interrupt handlers.

## Music

The PS1 sound chip (SPU) only plays back samples. It has 24 voices and 512 KB of
sound RAM, and every voice has its own pitch, volume, ADSR envelope and optional
reverb. The music here works the way most PS1 games did it: a small instrument
bank in sound RAM, plus a sequencer on the CPU that starts and stops notes every frame.

- **Instruments.** `tools/gen_audio.py` builds them at compile time. Lead, bell,
  arpeggio pluck, pad and bass are single-cycle waveforms made from sine
  harmonics; the pluck uses exactly six. Kick, snare and hi-hat are short synthesised one-shots.
  Everything is encoded to the SPU's 4-bit ADPCM, for an 8.5 KB bank in total.
- **Song format.** Each track is a list of `(row, note, velocity, length, pan)`
  events bound to one voice. A row is a sixteenth note, and the sequencer moves one
  row every 6 frames (150 bpm). Key-on and key-off requests are gathered during
  the frame and written to the SPU together.
- **Reverb.** The hardware reverb uses the "Studio Medium" preset from the psx-spx documentation.
- **In game.** The music adds layers as your best tile grows: pad, bass and drums from the start,
  the arpeggio at 16, the lead melody at 64 and a bell counter-line at 256. It
  ducks while paused, fades out on game over, and can be switched off in the pause menu.

The soundtrack leans on the number six:

- 6/4 time. The drums split each bar 3+3 while the bass walks 2+2+2 under them (a hemiola).
- The melody uses a six-note scale, A B C D E G.
- The arpeggio repeats a six-note cell that runs across the four-sixteenth beat, and pans
  each of its six notes to a different spot in the stereo field.
- Phrases are six bars long, and the in-game song is six phrases.
- The bridge ends on D–F♯–A♯ and E–G♯–C. Those two augmented chords together make the
  six-note whole-tone scale, and E–G♯–C resolves back to A minor.

## Build

You need Docker, nothing else. The image is Debian's `gcc-mipsel-linux-gnu`, used with
`-march=r3000 -msoft-float -mno-abicalls -G0`.

```bash
./build.sh
```

The output is `hex2048.exe`, which runs in any PS1 emulator that loads PS-EXE files
(PCSX-ReARMed, DuckStation, PCSX-Redux, Mednafen) and on real hardware through a loader.

To play locally, serve this folder over HTTP (EmulatorJS won't load from `file://`):

```bash
python3 -m http.server 8791
```

## Controls

A flat-topped hex has six neighbours (N, NE, SE, S, SW, NW), so the slide directions are:

| Direction | Pad | Keyboard |
|-----------|-----|----------|
| N | Triangle, or Up | W, or ↑ |
| S | Cross, or Down | S, or ↓ |
| NW | L1, or Up+Left | Q, or ↑+← |
| NE | R1, or Up+Right | E, or ↑+→ |
| SW | L2, or Down+Left | A, or ↓+← |
| SE | R2, or Down+Right | D, or ↓+→ |
| Undo one move | Select | Backspace |
| Music on/off | pause menu | pause menu |
| Start / pause menu | Start | Enter |

When you press a D-pad direction, the game waits up to 5 frames for the other half of a
diagonal before it acts. Up or Down on its own slides N or S.
