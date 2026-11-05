# Hexahedron 64

The [Hexahedron](../hexahedron-opus-5.5/) 6DOF mine run rebuilt as a Nintendo 64 ROM
(`hexahedron64.z64`, 4 MiB) and played in the browser through
[EmulatorJS](https://emulatorjs.org/) running the mupen64plus-next core.

Three missions from the browser game (Prospect Station, Hexahedron Deep Works,
Overseer Citadel), three robot types (drone, leech, brute), three weapons (twin laser,
spreadfire, homing missiles), blue / yellow / red key doors, a reactor (or the
Overseer's core) with an escape countdown, lava, shield pickups and an automap.
The PIG/HOG Descent 1 importer and the extra robots and weapons of the browser version
are left out: wasps, sentries and phantoms become drones, minelayers and wardens
become brutes, and plasma/fusion pickups become missiles.

## Play

Serve this folder over HTTP and open `index.html` (EmulatorJS fetches the ROM), then
click **Start Game**. Keyboard: arrows look, W/S thrust, A/D and R/F slide, Q/E roll,
Space fire, X missile, C switch weapon, M automap, Enter pause. A gamepad also works.

## Build

```bash
./build.sh
```

Needs only Docker. It runs two containers:

1. `node:22-alpine` runs `tools/export.mjs`, which imports
   `../hexahedron-opus-5.5/level.js` (the browser game's level generator), builds all
   three missions and writes them as big-endian binaries into `filesystem/`: cells and
   their neighbours, wall quads with baked vertex lighting, doors, a spatial hash for
   collision, and the robot/pickup spawns. The geometry is identical to the browser
   version.
2. The image from `Dockerfile` (Debian plus libdragon's prebuilt MIPS64 GCC toolchain)
   compiles the game and assembles the ROM with `tools/mkrom.py`.

## How it works

The game is bare-metal C: no SDK, no libc, interrupts off, everything polled.

| File | What it does |
| --- | --- |
| `boot/ipl3.S` | Boot code in the ROM header area. Copies the program to RDRAM 0x400 with one PI DMA, detects 4/8 MiB, jumps in. |
| `src/crt0.S` | Sets up the FPU, clears `.bss`, installs a crash handler on the exception vectors. |
| `src/rdp.c` | RDP command lists written by the CPU and started with `DPC_START/END` (the RSP is never used). Triangle edge / shade / texture / Z coefficients are computed on the CPU, adapted from libdragon's public-domain `rdpq_tri.c`. |
| `src/render.c` | Portal walk from the camera's cell (each open face narrows a screen rectangle), per-vertex lighting (baked light + headlight + muzzle and explosion flashes, faded by distance), view-space clipping, textured walls sorted by texture, sliding doors, low-poly robots, additive glows, HUD text from an I4 font. |
| `src/level.c` | Loads a mission from ROM; cell lookup, sphere-vs-triangle collision and ray casts. |
| `src/game.c` | Player physics, robot AI (wake on sight, chase along a BFS flow field when sight is lost), weapons, doors and keys, reactor and countdown, automap, menus. |
| `src/audio.c` | A small synth (square / saw / triangle / noise voices with sweeps) mixed into 22 kHz buffers for the AI. |
| `src/textures.c` | Procedural 32x32 RGBA16 wall textures generated at boot. |
| `src/pad.c`, `src/video.c` | Controller reads over the PIF, VI setup with three frame buffers. |

### Emulator notes

These are the things that had to change to run in EmulatorJS:

- libdragon's own IPL3 and runtime don't boot on the EmulatorJS N64 cores, which is
  why the game is bare metal with its own boot code.
- parallel_n64 in EmulatorJS ignores the Angrylion plugin option and renders with
  Glide64, which ignores the colour combiner for CPU-built RDP lists. mupen64plus-next
  renders them with GLideN64, which handles combiners, shading, alpha and fill
  rectangles, so the page uses that core. Its options are written into RetroArch's
  options file before the core boots.
- GLideN64 drops flat-bottom triangles (two lowest vertices on the same sub-scanline),
  so `rdp_triangle` moves the last vertex down by one sub-scanline.
- `VI_V_INTR` must be on a real line: the core ends each frame on the VI interrupt.
- Game time comes from CP0 Count, calibrated at boot against the VI interrupt (polled
  in `MI_INTR`), because the core doesn't tick Count at the hardware's 46.875 MHz.
- Audio runs from boot so RetroArch can pace the emulator to real time. The page
  starts the emulator from a click, since browsers block audio until one.
