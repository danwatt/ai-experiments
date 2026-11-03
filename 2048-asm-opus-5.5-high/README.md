# Hex 2048 (x86 assembly)

2048 on a 19-cell hexagonal board, written in 16-bit x86 assembly as a DOS `.COM` file (VGA mode 13h, 386+). `index.html` runs it in the browser with DOSBox compiled to WebAssembly (js-dos 8.5.3 `emulators` package).

## Files

| File | What it is |
| --- | --- |
| `hex2048.asm` | The game. NASM syntax, one file. |
| `HEX2048.COM` | Built binary (2,869 bytes). Runs in DOSBox or real DOS. |
| `index.html` | Generated page that boots the `.COM` in js-dos. Don't edit it by hand. |
| `wdosbox.*`, `wlibzip.*` | js-dos runtime (WASM + loaders), copied from `js-dos@8.5.3/dist/emulators/`. The page fetches them from its own folder. |
| `tools/template.html` | Source for `index.html`. |
| `tools/build.py` | Assembles the `.asm` and regenerates `index.html` (embeds the binary and highlighted source). |
| `tools/test.py` | Fuzz test: 3,000 random moves in an emulator, each checked against a Python reference. |
| `tools/harness.py` | Tiny real-mode DOS/VGA harness on Unicorn used by the test; saves screenshots. |
| `tools/gen.py` | Generates the geometry tables in the `.asm` (cell centres, slide lines, hex scanline widths). |

## Build and test

```bash
brew install nasm
pip install unicorn pillow     # for the test only
python3 tools/build.py         # -> HEX2048.COM + index.html
python3 tools/test.py          # -> "errors 0", plus tools/shot_*.png
```

Run the page from a static server; `file://` can't fetch the WASM:

```bash
python3 -m http.server 8799 -d 2048-asm-opus-5.5-high
```

Or run the binary directly: `dosbox HEX2048.COM`.

## Play

Flat-top hexes, so tiles slide six ways:

```
     W            8
  Q     E      7     9
  A     D      1     3
     S            2
```

Home/Up/PgUp/End/Down/PgDn on the numpad also work. `R` starts a new game, `Esc` quits to DOS.

## How it works

- Board: 19 bytes, one exponent per cell (0 = empty, 1 = 2, 11 = 2048).
- Moves: for each of 6 directions, a precomputed table lists 5 lines of cell indices, front first. Each line is compacted, equal neighbours merged once, and written back.
- Game over: no empty cell and no equal neighbours along any of the 3 axes.
- Drawing: everything goes to a back buffer in the next 64K segment, then is copied to `A000h` on vertical retrace. Hexes are filled scanline by scanline from width tables. Text uses the BIOS 8x8 font (`int 10h, AX=1130h`), drawn at any pixel position and at 1x or 2x scale.
- Palette: custom VGA DAC entries using the classic 2048 tile colours.

## Status

- The game logic is verified by `tools/test.py`.
- **The browser page is not confirmed working yet.** Hosted as a claude.ai artifact, both `dosboxDirect` and `dosboxWorker` froze the Chrome tab before the first frame. The likely cause is the artifact sandbox's CSP, since js-dos loads its runtime with `eval` and `fetch`. Here it is served as plain static files, which may simply fix it. If not, check DevTools first, then consider swapping to v86.
