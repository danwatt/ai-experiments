The transient lozenge that confirms a write, or reports that one failed.

A `control` pill at `radius-pill`, 9px/18px padding, `ink-strong`, centred and pinned near the bottom edge — 24px up on People Manager, 92px up on Quick Tag so it clears the action bar. `pointer-events: none`, so it never intercepts the next tap. `.err` swaps the fill for `toast-error` and nothing else.

## When to use

For the result of a small write that the person can already see the effect of: a face tagged, a family renamed, a person deleted. It confirms, it does not ask.

For anything the person must act on, use the status bar, a `.hint` inside the relevant `Card`, or an error line beside the failing control. For a long-running job, use `ProgressBar` and the button's own label.

## What the consumer provides

One short line — a sentence fragment, no punctuation at the end — and a dismiss timer. Capped at 86% of the viewport so a long filename cannot span the screen.

## Don't

- Don't queue toasts; replace the current one.
- Don't put a button or a link in it — it is `pointer-events: none`.
- Don't use it for an error the person has to do something about.
