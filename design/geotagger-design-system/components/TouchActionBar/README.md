The fixed bottom bar of thumb-sized answers on the phone pages (Quick Tag, Quick Geocode).

Quick Tag asks one question at a time — "is this Marion?" — and this bar is the whole answer surface. The buttons are 16px tall padding, `radius-12`, `touch-action` weight 700, and they fill the width evenly so a thumb never has to aim.

## When to use

Only on a single-question touch flow. A desktop pane uses `Button` instead.

Three roles, left to right:
- **`.skip`** — a fixed 80px escape hatch, lighter weight, `ink-secondary`. Always present, never primary.
- **`.act`** — neutral alternatives (`field` fill).
- **`.act.primary`** — the confirming answer, in `success-action` with `on-success-action`. Exactly one per bar.
- **`.act.danger`** — the destructive answer ("Not a face"), in `danger-action`.

## What the consumer provides

The labels, the disabled state while a request is in flight, and the safe-area padding — the bar already adds `env(safe-area-inset-bottom)` in the app, which the preview omits.

## Don't

- Don't exceed four buttons; a thumb loses the row.
- Don't put the destructive and the confirming button adjacent — the app keeps a neutral between them.
- Don't shrink the 16px vertical padding to fit another control.
