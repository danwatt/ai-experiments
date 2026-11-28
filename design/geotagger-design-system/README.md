GeoTagger is a local-first desktop web app for putting a photo library in its place: geotag
photos on a map, reverse-geocode them offline, detect and name faces, sync camera clocks,
and search across the lot. Everything — the SQLite index, the thumbnails, the face models —
stays on the machine. It is a tool for one person working through tens of thousands of their
own photographs, and the interface is built for that: dense, dark, keyboard-driven, and
happy to put a hundred thumbnails on screen at once.

Design for the photographs, not around them. Every surface here is a shade of near-black so
that the only saturated colour on screen belongs to the image the person is looking at. When
you reach for a colour, ask first whether the interface needs one at all.

## Content fundamentals

- **Plain, lowercase-ish, no shouting.** Headings are sentence case: "Reverse geocoding
  (place names)", "Detect faces", "Run backfill". Never Title Case A Whole Label.
- **Say the count.** The app is about quantity, so numbers lead: "48,201 photos · 12,880
  geotagged". Put the number in `display-number` or `ink-strong` and the noun in `ink-dim`.
- **Name the action, not the dialog.** Buttons are verb phrases — "Detect faces", "Recompute
  representative faces", "Run backfill", "Open Geocode view" — not "OK" or "Submit".
- **Second person, no personality.** "Changes apply immediately — no restart needed." The
  app does not apologise, congratulate or use "we".
- **An em dash joins a claim to its caveat**, the way the settings intro does. Prefer it over
  parentheses for asides that matter.
- **State an uncertainty as an uncertainty.** The face matcher guesses; copy says so ("could
  be", "suggested", "ambiguous") and always offers the reject affordance beside the accept.
- **Emoji are functional, not decorative.** They are this app's icon set — see Iconography.
  Never put an emoji in body copy or a heading.

## Visual foundations

### Colour

Four groups, in this order of reach:

1. **Surfaces** step from `canvas` (#1a1a1a) up through `pane`, `card`, `chrome` to `overlay`.
   Each step is a few points of lightness — the hierarchy is read through 1px rules, not
   through contrast. Put content panes on `pane`, furniture on `chrome`, floating things on
   `overlay`, and the status rail on `rail`.
2. **Ink** runs `ink` → `ink-strong` for emphasis and down through `ink-secondary`,
   `ink-muted`, `ink-soft`, `ink-dim` for supporting copy. Stop at `ink-dim` for anything a
   person must read: `ink-faint`, `ink-ghost` and `ink-placeholder` fall below 4.5:1 on
   `canvas` and are annotation and empty-state only.
3. **One accent, blue.** `accent` is every focus ring, selection ring and active border;
   `accent-text` is every heading, link and active label; `accent-fill` is every filled
   active or primary control. On a filled accent use `on-accent`, never `accent-text` —
   `accent-text` on `accent-fill` is only 4.3:1 and the source uses it at 12px.
4. **Status colours carry a word.** `success` means geotagged or labeled, `warn` means partly
   done or ambiguous, `danger` means missing. Never let the hue be the only signal: the
   coverage bar has a legend, the count badges have the words "geotagged" and "not
   geotagged", the ambiguous ring sits under a chip that names both candidates.

Two known contrast exceptions, kept exactly as the app has them and flagged in their token
notes: `danger` on `card` (3.9:1 at 11px) and `accent-text` on `accent-fill` (4.3:1 at 12px).
Anything you add meets 4.5:1 for text and 3:1 for a border, ring or icon that means something.

The Contexts screen is the one page that uses `context-accent` green instead of `accent`.
It predates the blue. Do not spread it; do not "fix" it either without changing that page
whole.

### Type

One stack, the system's own: `ui` (`system-ui, sans-serif`) on desktop, `touch`
(`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) on the phone pages. No font
files ship, and none should — this app runs offline and loads nothing from a CDN except the
map.

The desktop base is **13px** (`body`), which is small on purpose: it buys two more rows of
thumbnails. Most interactive text is `control` at 12px, most annotation `meta` at 11px, and
overlay captions `micro` at 10px. Reserve `display-number` for the single headline figure on
a card. On the touch pages step everything up — `touch-body` is 16px so iOS does not zoom the
picker's search field on focus.

### Spacing and layout

There is no abstract scale; use the even steps the app uses. `space-4` is the photo grid gap,
`space-8` the default gap between controls, `space-10` a pane's padding, `space-16` a card's.
`space-24` separates top-level sections.

Grids are always `repeat(auto-fill, minmax(var(--face-size), 1fr))` with `face-size` at 120px
— photo grids, face grids and cluster strips all share it, so a face crop and a photo
thumbnail are the same size everywhere in the app. Reading columns are capped:
`measure-settings` (720px) for settings, `measure-page` (960px) for management tables.

Panes are fixed-width flex or grid columns — `pane-people`, `pane-detail`, `pane-contexts`,
`pane-sidebar` — with the media pane taking the remainder. Toolbars and status bars are
`flex-shrink: 0`; the pane between them scrolls.

### Borders, radii and shadows

**Borders do the work shadows do elsewhere.** `hairline` under every toolbar and above every
status bar, `rule` between table rows, `field-border` around inputs, `control-border` around
buttons. A shadow appears only when something genuinely floats: `shadow-control` for a map
control, `shadow-popup` for a marker popup, `shadow-modal` for a centred dialog,
`shadow-float` for a menu under the pointer.

`radius-4` is the default for buttons, inputs and rows. `radius-3` for image tiles,
`radius-8` for cards and modals, `radius-12` for touch buttons, `radius-pill` for chips and
toasts, `radius-16` for the top of a bottom sheet.

### States

- **Focus** is `accent` on the border (`.gt-input:focus`). Keyboard focus on a button gets a
  2px `accent` outline at 1px offset.
- **Hover** lifts the fill one step: `control` → `control-hover`, `field` → `#3a3a3a`. Row
  affordances (a rename pencil, a delete ×) are `visibility: hidden` until the row is hovered.
- **Selection** is a 2px `accent` border on a tile, an `accent-fill` background on a row.
- **Uncertainty** is a `warn-ring` inset ring. **Ignored** is `opacity-ignored` plus
  grayscale. **Deferred** is `opacity-come-back` plus sepia — dimmer than normal, brighter
  than ignored, because it means "not yet", not "no".
- **Transitions** are short and only on colour or width: `0.1s` for a border,
  `0.15s` for a background or opacity, `0.3s` for a progress width. Nothing moves or scales.

### Imagery

Photographs are the content; the chrome never tints, filters or rounds them beyond
`radius-3`. Always give an image container `media-well` so a slow tile is a dark hole rather
than a flash of pane, and `object-fit: cover` with `aspect-ratio: 1` so the grid stays
regular. Text over a photo needs `caption-scrim` behind it; a marker drawn over a photo needs
`shadow-bbox`, a dark ring, so its `accent-text` border survives a light background.

### Long operations

Server work that could run for an hour is driven as a client loop: the page POSTs a batch,
reads how many remain, and repeats, rewriting the button's own label as it goes ("Detect
faces" → "Detecting… 3,410 left") with a `danger` Stop button beside it. Do not open a modal,
do not block the page, do not add a spinner. Progress lives in `progress-bar` or in the
button label.

## Iconography

**There is no icon font and no SVG icon set. The icons are emoji**, written as literal
characters in the markup — 🏠 Home, 🔎 Search, 📍 Geocode, ⚡ Quick Geocode, 🌍 Places DB,
🕐 Time Sync, 🙂 People, ⭐ Representatives, 🗺️ Contexts, ⚙ Settings. State badges over a
thumbnail work the same way: 📍 for geotagged, 🚫 for excluded from geotagging. They are set
in the UI font at the surrounding size, and over an image they get
`text-shadow: 0 0 3px #000`.

This is a deliberate consequence of the app's constraints — no build step, no npm, nothing
loaded from a CDN — and it means an icon renders in whatever the operating system provides.
Keep to widely-supported single glyphs, always pair one with its label in the same element
(`⚡ Quick Geocode`), and never rely on an emoji alone to carry a meaning. Where an icon-only
control is unavoidable, the app uses a single character in a `.button.icon-btn` — ✓ accept,
✕ unassign, 🚫 ignore — with a `title` attribute.

## Consuming this system

No JavaScript ships with this system: GeoTagger's frontend is vanilla DOM with no framework,
no bundler and no npm, so its components are **CSS classes over plain markup**. Load
`tokens.css`, then `components/bundle.css`, and write the markup each component's card shows.
Class names and values are the repository's own; the literal hex and px values have been
replaced by the `var(--token)` that names them, and nothing else was changed.

Where a preview uses a class prefixed `gt-` (`gt-toolbar`, `gt-input`, `gt-meta-table`), the
app styles that element through an id instead (`#toolbar`, `#toolbar input[type="text"]`,
`#detail-meta`); the rule is identical, the hook is not.
