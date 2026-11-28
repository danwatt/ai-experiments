# Hex 2048 · Atari Lynx

2048 on a 19-cell hexagonal board, built as an Atari Lynx cartridge (`hex2048.lnx`)
in C with [cc65](https://cc65.github.io/). `index.html` runs it in the browser with
the Handy core from [EmulatorJS](https://emulatorjs.org/) (loaded from its CDN). No
Lynx BIOS needed: Handy falls back to its built-in boot emulation.

## Play

Serve this folder over HTTP (EmulatorJS fetches the ROM) and open `index.html`.

| Input | Action |
| --- | --- |
| `Q W E` / `A S D` | slide NW, N, NE / SW, S, SE |
| D-pad Up / Down | slide N / S |
| D-pad diagonals (Up+Left, ...) | slide NW / NE / SW / SE |
| Left / Right alone | slide NW / NE; hold B (`X`) for SW / SE |
| A (`Z`) | start, continue after 2048, retry after game over |
| Option 1 (`N`) | new game |

## Build

```bash
./build.sh
```

Builds a Debian image with the packaged cc65 and runs `make` inside it, writing
`hex2048.lnx` (and a linker map in `build/`). `./build.sh EXTRA=-DDEBUG` adds an
on-screen counter of frames per rendered image.

## How it works

- `src/main.c`: game logic and rendering. Board cells use axial hex coordinates;
  each of the six directions has precomputed lines of cells, front first, and a
  move is the usual 2048 compress-and-merge along each line.
- Rendering is all Suzy sprites. Every frame the CPU builds a chain of sprite
  control blocks: a 1bpp hex mask (recoloured per tile through the pen palette and
  scaled for the pop animations), 3x5 font glyphs (scaled 2x for big text) and a
  single packed pixel scaled into rectangles. The background, HUD and empty cells
  are cached and only rebuilt when the score changes. Suzy draws into a back buffer,
  then Mikey's display address is swapped to it at the next frame.
- `src/vbl.s`: a cc65 interruptor on timer 2 (the line counter, once per frame) that
  counts frames and ORs the joystick into a latch, so taps made during an animation
  still register.
- `src/header.s`: the 64-byte LNX header with the cart name.
