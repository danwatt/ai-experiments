Says what each colour in a strip, chart or marked passage means. Hand-written from `demo.html` and `demo-search.html` (`.legend`, `.legend i`, `.legend i.ramp`, `.legend i.marker`).

**When to use it.** Directly under the thing it explains — a stream strip, a bar, a marked verse. Every coloured encoding in this system carries one: the `sym-*` colours mean nothing without it.

**What it gives you.** A wrapping row of swatch-plus-label pairs at 11px in `ink-soft`, `space-2` between rows and `space-8` between items. Three swatch shapes: a 10px solid square at `radius-xs`, a 34px gradient for a ramp, and an 18px panel chip with an inset underline for a text marker.

**What you supply.** `items`. Pass `color` for a solid, `ramp: [lo, hi]` for a gradient, or `marker` for an underline chip — as token references (`"var(--sym-word)"`), not raw hex, so both themes follow. Set `strong` on the item the reader should notice; it moves that label to `ink`.

Props: `items`, `className`.
