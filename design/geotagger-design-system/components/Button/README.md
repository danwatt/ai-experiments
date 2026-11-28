The app's one button, in the five variants `style.css` defines: default, active, primary, danger and icon-only.

Every clickable control in GeoTagger is this button. It is deliberately small — 12px label, 4px/10px padding — because toolbars carry eight or ten of them at once and the photographs need the room.

## When to use

- **Default** for any ordinary action. `control` fill, `control-border`, `ink` label.
- **`.active`** for a toggle that is currently on, or the current page in the nav. `accent-fill` + `accent` border + `accent-text` label.
- **`.primary`** for the one action a panel exists to perform — "Apply this guess". Same fill as `.active`, hovering to `accent-fill-deep`. Never put two primaries in one group.
- **`.danger`** for a destructive or stop action. Border and label only; the fill stays neutral until hover, so a Stop button sitting beside a running job does not shout.
- **`.icon-btn`** for a single-glyph action (✓ ✕ 🚫) in a dense row. Always give it a `title`.

`<a class="button">` and `<button class="button">` are styled identically, so a link that navigates and a button that acts look the same — pick by what the element actually does.

## What the consumer provides

The label text (a verb phrase, sentence case), an optional leading emoji separated by a space, and `disabled` where it applies. For a long-running job, rewrite the label in place as the client loop progresses ("Detect faces" → "Detecting… 3,410 left") rather than adding a spinner.

## Don't

- Don't invent a size scale. The only variation is `.icon-btn`, and `.face-group-header .button` at 11px inside a group header.
- Don't use `.primary` for navigation.
- Don't set a background on `.danger` at rest — the hover `danger-surface` is the whole signal.
