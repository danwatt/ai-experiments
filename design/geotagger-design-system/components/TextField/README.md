The single-line text input, and the labelled field that wraps it in a form.

`field` fill, `field-border`, `radius-4`, 4px/7px padding, `ink-strong` text, and `outline: none` with the border going `accent` on focus — the border *is* the focus indicator, so never remove it.

## When to use

Any free text: a library folder, a place search, a person's name, a filename filter. Widths are set per use and are always explicit — `#dir-input` is 280px, `#location-input` 180px — because these sit in flex toolbars that would otherwise collapse them.

In a form, wrap it in `.search-field`: a column with a 3px gap and an 11px `ink-soft` label above. In a toolbar, use the bare input with an `aria-label`.

On the touch pages the field is larger — 12px padding, 16px text (`touch-body`), `radius-10`, on `canvas` rather than `field` — so iOS does not zoom on focus.

## What the consumer provides

The label text, placeholder, width, and any typeahead behaviour. A typeahead list is `PersonPicker`'s markup positioned under the field.

## Don't

- Don't rely on the placeholder as the label.
- Don't restore the default focus ring on top of the border change.
- Don't put a text input on `chrome` without its `field` fill — the two are close enough that the input would disappear.
