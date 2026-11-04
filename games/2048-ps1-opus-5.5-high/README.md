# Hex 2048 · PlayStation

2048 on a 19-cell hexagonal board, built as a PlayStation 1 executable (`hex2048.exe`, 18 KB)
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
| `src/spu.c` | Uploads a one-block looping ADPCM sine wave and plays pitched notes on 8 voices |
| `src/game.c` | Board logic in axial hex coordinates, slide/merge/spawn animations, title, pause, win and game-over screens, undo |
| `tools/mkexe.py` | Adds the 2 KB `PS-X EXE` header |

The vblank, DMA completion and pad /ACK are all polled from `I_STAT`, so nothing depends on
interrupt handlers.

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
| Start / pause menu | Start | Enter |

When you press a D-pad direction, the game waits up to 5 frames for the other half of a
diagonal before it acts. Up or Down on its own slides N or S.
