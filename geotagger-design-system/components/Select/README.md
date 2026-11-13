The native dropdown, styled to match `TextField` and left native everywhere else.

`field` fill, `field-border`, `radius-4`, 4px/6px padding, `ink-strong`. The app never replaces it with a custom listbox — a native select gets keyboard behaviour, type-ahead and the OS picker on touch for free, and this is an offline single-user tool with no reason to reinvent it.

## When to use

For a closed set of options: camera, time window, family filter, an imprecise-drop radius. Cap the width where the option text can run long (`max-width: 240px` on the focus and unlabeled pickers) so one long place name cannot stretch a toolbar.

`.focus-active` marks a select whose choice is currently scoping the whole page — `accent` border over a `#24374d` fill. Use it only for a filter with page-wide reach, so it is obvious why the results look short.

## What the consumer provides

Options, the current value, and the change handler. Where a select scopes the page, also provide the note beside it saying what is in scope.

## Don't

- Don't build a custom dropdown to get a swatch or an icon into an option.
- Don't use `.focus-active` for every filter — it stops meaning anything.
- Don't leave a page-scoping select unlabelled.
