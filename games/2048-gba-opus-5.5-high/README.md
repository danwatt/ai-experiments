# Hex 2048 — Game Boy

2048 on a 19-cell hexagonal board, written in Game Boy (SM83) assembly. The
page runs the ROM in `gb.js`, a small Game Boy emulator written for this demo.

## Play

Open `index.html` (works from `file://` too; the ROM is embedded via `rom.js`).

- **W E / A D / Z X** — the six slide directions (they ring the S key).
- **Arrows** — Left/Right slide W/E; hold Up/Down plus Left/Right for diagonals.
- **K / J** — A / B. With Up/Down held, B picks the left diagonal and A the right.
- **Enter** — Start, **Shift** — Select (offers a new game).

`hex2048.gb` also runs on real hardware and other emulators. The best score is
stored in battery-backed cartridge RAM (MBC1+RAM+BATTERY); in the browser that
RAM is kept in `localStorage`.

## Files

| Path | What |
| --- | --- |
| `src/main.asm` | The game: input, slide/merge rules, spawning, drawing, sound. |
| `src/hardware.inc` | Register names used by the game. |
| `src/gfx.inc` | Generated: tiles, cell layout, per-direction line tables, neighbour pairs, BCD score table. |
| `tools/gen.mjs` | Generates `src/gfx.inc` (font, hex cell art, board geometry). |
| `tools/test.cjs` | Headless test: plays random moves and checks every board and score against a JS model of the rules. |
| `gb.js` | Emulator: SM83 CPU, PPU, timer, joypad, MBC1, APU (two squares, wave, noise). |
| `index.html` | Handheld-style page with a six-way touch pad. |

## Build

Needs [RGBDS](https://rgbds.gbdev.io/) (`brew install rgbds`) and Node.

```bash
./build.sh
```

```bash
node tools/test.cjs 3000
```

## How it works

- Cells store exponents (0 empty, 1 = 2, … 11 = 2048). Board, line buffers and
  the spawn list share one 256-byte-aligned WRAM page, so indexing is
  `ld h, HIGH(wBoard)` / `ld l, index`.
- Each direction has a table of five lines (lengths 3-4-5-4-3), listed from the
  cell furthest along the direction. A slide gathers a line, compacts and merges
  it once per pair, and writes it back, flagging any change.
- Score and best are 8-digit BCD, added with `daa`.
- Each cell is drawn as a 4×3 tile block (32×24 px); rows are offset by half a
  cell to make the hex layout. Only cells whose value changed are redrawn, with
  writes timed to the PPU's HBlank/VBlank.
- Diagonals: Left/Right wait four frames for Up/Down to join; Up/Down wait for a
  Left/Right or A/B before anything happens.
