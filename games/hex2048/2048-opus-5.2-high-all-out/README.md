# Hex 2048 ×2

2048 on a hexagonal board, built twice: once with **PlayCanvas** ("Tabletop") and once with **BabylonJS** ("Nightglass"). Both share one set of rules, one HUD, one input layer, one synth and one save slot, so the only difference between them is the 3D engine and its art direction. Start a game in one, switch to the other from the menu, and your board comes with you.

Open `index.html` (or serve the folder, e.g. `python3 -m http.server`). Engines and fonts load from CDNs.

## Layout

```
core/engine.js   rules, seeded RNG, undo records, save format, expectimax hint (no DOM; runs in Node too)
core/kit.js      shared renderer helpers: hex mesh builders, TileField animation brain, camera framing
core/app.js      HUD, keyboard / drag-follow / arrows, sound, saving, end cards
core/app.css     HUD styles, one token set per variant
playcanvas/      Tabletop renderer + page
babylon/         Nightglass renderer + page
tools/test.mjs   engine tests          node tools/test.mjs
tools/tune.mjs   goal tuning with the hint bot
```

A renderer only builds meshes and copies transforms. `TileField` (in `kit.js`) turns engine transitions, drag previews, hints and nudges into per-tile position / scale / hop every frame, so both engines animate identically.

## What was kept from the earlier hex-2048 games, and what changed

- **Board on its point** (flat-topped cells): slides are up, down and four diagonals on Q W E / A S D. Every version that tried the other orientation needed awkward left/right keys.
- **Seeded spawns + unlimited undo** (from the Opus max version), now animated in reverse: merged pairs split apart and the spawned tile fades out.
- **Drag-follow** (from Facet) is reworked: tiles move *with* the finger until they reach their destination, instead of moving a fraction of their path, and a tile about to absorb another swells. Direction matching uses the projected on-screen directions, so it stays exact under the 3D camera tilt.
- **Stones** (from Facet), with an extra rule: a layout is rejected if it would leave any open cell with fewer than two open neighbours.
- **Hint** is an expectimax search with iterative deepening inside a time budget; the tiles lean toward the pick.
- **Goals**: checked with `tools/tune.mjs`. Six-way sliding is forgiving, so only Mini is set by difficulty (128, or 64 with a stone); Classic keeps 2048 and Grand's 4096 is set by game length.
- Dropped: bot autoplay, replays, badges, multiple timed modes. The game is the focus; the extras are the board sizes and stones.

## Engine-specific

| | PlayCanvas · Tabletop | BabylonJS · Nightglass |
|---|---|---|
| Look | walnut board, glazed ceramic tiles, river-stone blockers, green baize | obsidian mirror, neon glass slabs, amethyst blockers, starfield |
| Light | PCSS soft shadows, procedural studio IBL, clearcoat | glow layer, emissive faces, coloured point lights |
| Post | CameraFrame: SSAO, depth of field, bloom, vignette, grading | DefaultRenderingPipeline: bloom, ACES, vignette, grain, chromatic aberration |
| Celebration | 3D confetti chips that bounce and settle on the table | particle sparks per merge, fireworks at the goal |
| Rendering | on demand (idle board draws nothing) | continuous (tiles float and breathe) |
| Sound voice | marimba | glass bells |
