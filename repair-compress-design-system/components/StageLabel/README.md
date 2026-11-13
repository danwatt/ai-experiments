The numbered label that heads each step of a walkthrough. Hand-written from `demo-search.html` (`.stage-label`).

**When to use it.** Above a section that is one step in a sequence — reading the corpus, building the dictionary, encoding, decoding. For the label above a page title use the `eyebrow` type style directly; this component is the section-level one, and it carries a number and a right-aligned aside.

**What it gives you.** Pixel face at 10px, uppercased, tracked 0.1em, in `dmg-3`, with `space-6` beneath it. The number is `hot`. The hint drops back to the mono face at 11px in `ink-soft`, un-uppercased, pushed to the right edge with `margin-left: auto`.

**What you supply.** The label text as children; `num` and `hint` are optional. Keep the hint to one short clause — it shares a baseline with the label and does not wrap gracefully.

Note: `dmg-3` on `panel` is 4.3:1 in the Dark theme, just under 4.5:1. That is how the repository ships it. On a panel, prefer `ink-soft` for anything a reader must read.

Props: `num`, `children`, `hint`, `className`.
