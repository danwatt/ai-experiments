The square image tile — a photo thumbnail or a face crop — and the full vocabulary of badges, chips and dimming layered over it.

One square (`aspect-ratio: 1`, `object-fit: cover`), `radius-3`, a 2px transparent border that becomes `accent` when selected, and `media-well` behind the image so a slow tile is a dark hole rather than a flash of pane. It is the densest thing in the app and the most heavily overloaded: every piece of state a photo or a face can be in shows here.

## When to use

In any grid of media. The grid is always `repeat(auto-fill, minmax(var(--face-size), 1fr))` with a 4px gap, so photo grids, face grids and cluster strips all agree on tile size.

**Selection and identity**
- `.selected` — 2px `accent` border.
- `.ambiguous` — a 2px inset `warn-ring`: the matcher could not choose between two people.

**Badges, pinned into corners**
- `.tagged` → 📍 bottom-right; `.geo-ignored` → 🚫 top-left plus `opacity-geo-ignored` on the image. Both get `text-shadow: 0 0 3px #000` to survive a light photo.
- `.face-score` — a 9px match score, top-right, on its own dark pad.
- `.cam-strip` — a 4px band across the top in the camera's legend colour.

**Captions along the bottom edge**, all on a scrim so they hold over any image:
- `.thumb-name` — the filename, `caption-scrim`, revealed on hover only.
- `.face-label` — a settled name, always visible.
- `.face-suggest` — a clickable proposal on `rgba(42,74,110,.85)`: a ✓ in green, the name, and a `.sug-reject` ✕ in `danger-quiet` that brightens to `danger-hot`. Accept and reject are always both present.
- `.face-alt` — an amber "or is it this person?" chip, stacked under the primary suggestion inside `.face-chips`.

**Dimming states**: `.ignored` (`opacity-ignored` + grayscale) for dismissed; `.come-back` (`opacity-come-back` + sepia) for deferred. The come-back state is deliberately brighter — it means "not yet", not "no".

## What the consumer provides

The `src`, the state classes, and a click handler on the cell (the `img` is `pointer-events: none` so a click always lands on the cell). Every chip needs its own handler; they stop propagation.

## Don't

- Don't stack more than two chips; beyond that the image is gone. Move the rest into the detail pane.
- Don't show a suggestion without its reject affordance.
- Don't put a caption on a tile without `caption-scrim` behind it.
