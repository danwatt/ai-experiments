The 22px rail along the bottom of a page, carrying the result of the last thing that happened.

Height and line-height are both `bar-status` (22px) so the text centres with no padding. `rail` fill, `hairline` top rule, `meta` at 11px in `ink-dim`. On the map-first pages it sits on `chrome-alt` instead and runs at 12px in `ink-soft`.

## When to use

One per page, last element, outside the scrolling area. It reports state — a count, a scan result, the last save — not progress; progress belongs in `ProgressBar` or in a button label.

`.error` switches the text to `danger-text` and nothing else. The bar never changes its own background.

## What the consumer provides

A single line of text, replaced outright on each update. Keep it short enough not to wrap — the bar has no room to grow.

## Don't

- Don't put a control in it.
- Don't use it for anything the person must act on; it is too quiet to be a prompt.
