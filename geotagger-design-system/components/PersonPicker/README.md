The "assign this face to…" typeahead — a small centred dialog on desktop, a bottom sheet on touch.

`overlay` panel, `accent` border, `radius-8`, `shadow-float`, 260px wide and 60vh tall, opened 12vh down the viewport at `z-picker` over a `scrim` backdrop. A search field, then a scrolling list of rows, each with the person's name left and a `pp-count` of their faces right.

## When to use

Anywhere a face gets a name: the People toolbar, the People detail pane, the quick-action popup on a tile. It is deliberately the same dialog in all three, so the interaction is learned once.

Row states:
- resting — `field` fill, `panel-border`.
- `.pp-hl` — the keyboard cursor: `accent-fill` and an `accent` border. Arrow keys move it, Enter picks it.
- `.pp-new` — "Create <typed name>", `accent-fill` with `on-accent-bright`, always last so it never steals the highlight from a real match.
- `.pp-empty` — `ink-dim`, centred, when nothing matches and nothing is typed.

On a phone the same list becomes a bottom sheet: full width, `radius-16` on the top corners only, 80dvh tall, rows at 14px padding and `touch-body` 16px, with `env(safe-area-inset-bottom)` added to the bottom padding.

## What the consumer provides

The candidate list already sorted by likelihood, the face counts, the filter, and handlers for pick and create. Keep the search field focused on open.

## Don't

- Don't use the desktop dialog's compact sizes on a touch page — use the sheet.
- Don't put the create row anywhere but last.
- Don't open it without a way out: the `×`, the backdrop and `Escape` all close it.
