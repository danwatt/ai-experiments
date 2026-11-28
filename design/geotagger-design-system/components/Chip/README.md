The small lozenges that carry a selected filter, a group name, or a count.

Four related shapes, all rounded past `radius-8` so they read as tokens rather than buttons:

- **`.person-chip`** — a person added to a search filter: `accent-fill`, `accent` border, `on-accent` text, 12px radius, with a `✕` that removes it. This is the only chip a person dismisses.
- **`.family-chip`** — a family on People Manager: a muted blue `#2a3a4e` on `#4a6a8e`, `radius-pill`, with the name (click to rename in place) and a `.family-count` bubble.
- **`.person-count`** — the faces-per-person bubble in a list row: `control` fill, `ink-muted`, flush right, going `accent-fill-deep` when its row is active.
- **`.count-badge`** — a figure in a summary row, with `.count-geotagged` (`success`), `.count-not-geotagged` (`danger`) and `.count-total` (`ink-muted`, 600) saying which figure it is.

## When to use

A chip means *this is currently applied* or *this is how many*. If clicking it would perform an action rather than remove a filter, it is a `Button`.

Because `success` and `danger` sit close in lightness, a count chip always carries its own word — "geotagged", "not geotagged" — so the pair never depends on hue.

## What the consumer provides

The text, the removal handler on `.person-chip`, and the rename handler on `.family-chip`. Chips wrap in a flex row at a 4–8px gap; the container hides itself when empty (`#person-chips:empty { display: none }`).

## Don't

- Don't put a chip in a toolbar as a control — chips are output.
- Don't colour a count chip without its label word.
- Don't let a chip's text truncate silently; cap the name at 160px with an ellipsis and keep the count visible.
