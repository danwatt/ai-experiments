The segmented bar that splits the library four ways at once, with a legend whose swatches are the segments themselves.

A 14px flex track on `field`, its children sized by percentage: `.cov-full` (`success`, every face named), `.cov-partial` (`warn`, some named), `.cov-none` (`danger`, none named), `.cov-noface` (`control-hover`, no faces found). The legend reuses the same class on a 10px `.sw` square, so a segment and its key can never drift apart.

## When to use

For a whole-library breakdown into mutually exclusive states, on a `.card-full` tile. The month-bar variant does the same job over time: one 4px column per month, stacking `bar-tagged` (`success`) under `bar-untagged` (`control-hover`), scrolling horizontally with a year label floated above each January.

`success`, `warn` and `danger` sit close in lightness, so the legend is not optional — it is what makes the bar readable. Every segment's meaning is spelled out in words beside its swatch.

## What the consumer provides

The four percentages (they must total 100), the legend labels, and the counts. A segment at 0% should be omitted rather than rendered at hairline width.

## Don't

- Don't add a fifth segment; four is already at the limit of what 14px can distinguish.
- Don't ship it without the legend.
- Don't reuse these colours for anything that is not this four-way split.
