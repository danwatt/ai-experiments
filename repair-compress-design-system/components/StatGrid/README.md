The key / value / note readout grid that reports what a codec run cost. Hand-written from `demo.html` (`.stat-grid`, `.stat .k`, `.stat .v`, `.stat .n`).

**When to use it.** Inside a `Panel`, to report the numbers a run produced. Four to six stats read well; beyond that the columns get thin.

**What it gives you.** `repeat(auto-fit, minmax(150px, 1fr))` columns with `space-7` row and `space-9` column gaps. Keys are 10px uppercase `ink-soft`, tracked 0.06em. Values are 19px in tabular figures, `ink` by default. Notes are 10px `ink-soft`.

**What you supply.** `stats`, each `{ k, v, n?, tone? }`. `tone` colours the value by what it means: `good` for a win, `warn` for a cost, `hot` for the figure the section is about. Leave it off for a plain measurement — the tones are signals, not decoration. Format numbers before you pass them; the component only sets tabular figures so columns line up.

Props: `stats`, `className`.
