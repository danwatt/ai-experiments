The centred dialog over a scrim — used for picking a month to jump to, and for the keyboard shortcuts sheet.

`scrim-heavy` backdrop at `z-modal`, an `overlay` panel with a `field-border`, `radius-8`, 20px padding, `shadow-modal`, capped at 600px wide and 80vh tall and scrolling inside. The title is `heading-modal` in `ink-strong`; the close affordance is a floated 28px `×` in `ink-muted` that goes white on hover.

## When to use

Sparingly. GeoTagger runs long jobs without blocking, so a modal is only for a *choice* — jump to a month, read the shortcuts — never for progress, confirmation of a running job, or an error. An error belongs in the status bar or a `Toast`.

The shortcuts variant is narrower (380px), 70vh, and takes an `accent` border instead of `field-border` because it opens over a dense page and has to announce itself.

Rows inside a picker are `.month-item`: a flex row on `overlay` with a `panel-border`, going `field` + `accent` border on hover, with the name left and its `Chip` counts right.

## What the consumer provides

The content, a close handler on the `×`, the backdrop and `Escape`, and focus management. The panel itself traps nothing.

## Don't

- Don't use a modal to confirm a destructive action that a click already made explicit.
- Don't stack two modals.
- Don't put a long job behind one.
