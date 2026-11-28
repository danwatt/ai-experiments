The tinted wrapper that fences one day, event or cluster of tiles off from its neighbours.

A `tint-border` outline, `radius-5`, a `FaceGroupHeader` flush at the top, and a tile grid beneath it on one of six cycling tints (`group-tint-0` … `group-tint-5`). The tints are 9% alpha — just enough that two adjacent days read as two things without a hard rule between them.

## When to use

Wherever a flat grid would run two unrelated groups together: day and event groups in the photo grid, suggested-person runs in the unlabeled face queue, clusters on Discover, near-duplicate runs on Representatives.

Cycle the tint by group index modulo 6 — the tint carries no meaning of its own, only difference from the group above. The header's own colour (`green`, `amber`, `blue`, `grey`) is what carries meaning.

## What the consumer provides

The header (title, meta, buttons) and the tiles. In a queue where the first tile of each run must start a fresh row, tag it `.row-break` — CSS grid auto-placement cannot backfill, so the previous row's tail stays empty and becomes the visual break.

## Don't

- Don't raise the tint opacity; at 9% it sits under a photograph without colouring it.
- Don't use the tint to encode state. Two green groups can be tinted differently and still both mean "labeled".
- Don't nest sections.
