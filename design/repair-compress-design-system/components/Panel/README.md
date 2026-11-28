The surface every section of a codec page sits on. Hand-written from `demo-search.html` (`.panel`) — the same three lines appear in all six demo pages.

**When to use it.** Any block of readouts, a chart, a table well, a control column. It is the only container the system has: there is no card with a shadow, no nested panel. Panels sit directly on `ground`, in a one- or two-column grid with `space-8` between them.

**What it gives you.** `panel` ground, a 1px `rule` border, `radius-sm`, `space-7` of padding, `ink` text in the mono family.

**What you supply.** Everything inside. Set `flush` when the content owns its own padding — a scrolling table well, or a bar that should meet the border. A panel does not scroll on its own: put `max-height` and `overflow: auto` on your inner element, as the source's `.table-wrap` does.

Props: `children`, `flush`, `className`.
