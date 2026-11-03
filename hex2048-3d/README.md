# Hex 2048 (3D)

A 2048-style sliding puzzle on a hexagonal board, rendered in 3D with Three.js. One self-contained `index.html`, no build step.

## Run

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

Needs internet on first load (Three.js and the Fredoka font come from CDNs).

## Play

- Six slide directions, mapped to the keyboard block:
  `Q` NW · `W` N · `E` NE · `A` SW · `S` S · `D` SE
  (numpad 7/8/9/1/2/3 and Up/Down arrows also work)
- Swipe or mouse-drag on the board; the closest of the six directions wins.
- Tap/click the floating key caps around the board.
- `Z` / `U` / Backspace: undo one move.
- Board sizes: Small (19 cells), Medium (37), Large (61).

Equal tiles that collide merge; each tile merges once per move. A new 2 (or sometimes a 4) spawns after every move. Reach 2048 to win, then keep going if you want. Tiles get taller and change color as their value grows.

Game state and best score per board size are saved in `localStorage` when the browser allows it.
