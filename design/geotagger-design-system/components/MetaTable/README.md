The two-column key/value table in a detail pane, and its wider editable sibling on People Manager.

**Detail table** (`.gt-meta-table`, `#detail-meta` in the app): full width, collapsed borders, 12px, a `rule` under each row, keys in `ink-dim` at a fixed 40% column, values in `ink` and top-aligned so a long path wraps under itself rather than pushing the key around.

**Data table** (`.gt-data-table`, `#persons-table`): a real table of rows with 600-weight `ink-dim` headers over a `hairline`, rows on a `#2a2a2a` rule that light to `#282828` on hover, and explicit column widths so the name column does not collapse when a family name is long.

## When to use

The detail table for the metadata of one selected thing — filename, timestamp, camera, coordinates, place, people. The data table for a list of records a person edits in place.

Inline editing uses `.edit-input`: a transparent field that looks like text until hovered (a `field-border` outline appears) and focused (`accent` border, `canvas` fill). There is no edit mode and no save button; a blur writes.

`.gt-kbd` renders a key cap in a shortcuts table — `control` fill, `control-border`, inheriting the UI font so it matches its row.

## What the consumer provides

The rows. Format values before they arrive: coordinates to a fixed precision, timestamps in the library's own timezone, sizes already humanised.

## Don't

- Don't put a key in `ink-faint` or below — at 12px it stops being readable.
- Don't give the detail table a header row; the keys are the header.
- Don't use a data table where a list of `ThumbCell`s would do.
