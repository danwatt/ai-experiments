The band of controls at the top of a pane or page, and the pattern for grouping them.

`chrome` fill, a `hairline` bottom rule, 6px/10px padding, an 8px gap, and `flex-wrap` so a narrow window stacks rather than scrolls. It never scrolls with the content — it is `flex-shrink: 0` above a scrolling pane, or `position: sticky` at the top of one.

## When to use

At the top of any page, and at the top of any pane that has its own controls (the grid pane's sticky header, the map pane's nav). Related controls go inside a `.toolbar-group` at a tighter 4px gap; a `.toolbar-spacer` pushes everything after it to the right edge.

## What the consumer provides

The controls themselves — `Button`, `TextField`, `Select`, checkboxes — and their grouping. A toolbar holds no copy of its own beyond a field label.

## Don't

- Don't nest a toolbar in a toolbar; use `.toolbar-group`.
- Don't let it grow past two wrapped rows — move the overflow into a panel.
- Don't put `chrome-alt` under a `chrome` toolbar. The map-first pages use `chrome-alt` throughout, the rest use `chrome` throughout.
