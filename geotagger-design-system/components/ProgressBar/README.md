The 10px track that shows how far through the library a long job has got.

`field` track, 5px radius, an `accent` fill whose width animates over 0.3s, and an 11px `ink-muted` label beneath giving the real numbers. The fill is the app's only use of solid `accent` as a large area.

## When to use

Inside a `Card`, for a ratio over the whole library: photos geotagged, photos face-scanned. Always pair it with `.progress-label` — the bar gives the shape, the label gives the count, and a person managing 48,000 photos needs the count.

Long server work is driven as a client loop (POST a batch, read `remaining`, repeat), so update the width and label on each round-trip. The button that started the job rewrites its own label alongside; there is no spinner and no modal.

## What the consumer provides

The percentage for the width and the formatted label ("12,880 of 48,201 · 27%"). Never show the bar without a number, and never show a percentage without its absolute counts.

## Don't

- Don't use it for an indeterminate wait — there is no indeterminate variant, by design.
- Don't colour the fill by status; that is `CoverageBar`'s job.
- Don't animate anything but the width.
