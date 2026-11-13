One tunable knob on the Settings page: its name, the control, the sentence explaining it, and the env-var default it overrides.

Rows stack inside a `.settings-group` — a `Card` by another name — separated by a `rule` bottom border that the last row drops. The name is `label` weight 500 in `ink`; the help is 11px `ink-soft` at 1.4 line-height; the control sits in its own flex row.

## When to use

For every entry in the backend's `SETTINGS_SPEC`. These settings are persisted to the database and applied live, so the row must say so rather than implying a restart.

Its parts:
- `.setting-label` — the name, with a small reset `Button` pushed to the right edge.
- `.setting-help` — one or two sentences, ending with the env-var default in the form the backend names it (`GEOTAGGER_FACE_MATCH_THRESHOLD`, default 0.42).
- `.setting-control` — a number input (110px), a checkbox (18px, `accent-color: accent`), or a select.
- `.setting-saved-flash` — an 11px `success` "Saved" that fades in on write and out again. It is the only save feedback; there is no save button.
- `.setting-error` — 11px `danger-text` under the control when a value is rejected.

## What the consumer provides

The spec entry: name, help sentence, control type, bounds, and the env-var default to quote. Writes go out per change; nothing is batched.

## Don't

- Don't add a Save button — it would contradict "changes apply immediately".
- Don't hide the env-var default; it is how a person reconciles the UI with their shell.
- Don't let the help text exceed two sentences.
