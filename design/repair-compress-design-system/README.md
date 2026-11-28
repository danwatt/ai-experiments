# RPR1 / YLK1 Codec Lab

The look of the six demo pages in `danwatt/repair-compress-demo` — an instrument panel for two text codecs, built to make a 1993 Game Boy's compression legible. Dark ground, two faces, one blue ramp, and one amber accent that marks whatever the reader is meant to look at. Everything here was read out of the repository at `master@3ec24b3`.

Build like the instrument, not like a product page: flat panels on a dark field, hairlines instead of shadows, tabular figures, colour reserved for encoding meaning.

## Surfaces and text

- `ground` is the page. `panel` is the only raised surface — one level, never a panel inside a panel.
- Separate things with a 1px `rule` border. This system has no elevation: use `shadow-*` only for the physical objects it names (the device, the LCD, the modal) and the two inset rules (`shadow-tab-current`, `shadow-sticky-head`).
- `ink` for body text, `ink-soft` for everything secondary — theses, labels, table headers, notes, hints, footers. Muted text is the default in prose; `ink` is for the sentence that matters.
- Corners are `radius-sm`. Reach past it only for what the source does: `radius-md` for the LCD glass and the stream modal, `radius-xl` for the bezel, `radius-device` for the case, `radius-xs` for a 10px legend swatch.

## Type

Two families, no third. `mono` (IBM Plex Mono) carries all prose, data and controls. `pixel` (Silkscreen) is structural only: `page-title`, `section-head`, `tab-label`, `eyebrow`. Never set a sentence in `pixel` — it exists to date-stamp the interface, and it is unreadable in quantity.

- Titles and eyebrows: `page-title`, then `eyebrow` above it, uppercased in CSS with its tracking left as the token has it.
- Body is `body` (14px). Drop to `body-sm` inside tables, chips and readouts, `micro` for labels and legends, `micro-caps` for a stat key.
- Any number a reader compares to another number gets `font-variant-numeric: tabular-nums`. `stat-value` and `figure` assume it.
- `page-title` and `figure` are the ceilings of the source's `clamp()` — `clamp(20px, 4.4vw, 34px)` and `clamp(30px, 7vw, 48px)`. Keep the clamp when you rebuild those two; the tokens cannot hold it.

## Colour, which means something here

`hot` is the accent and it is scarce: links, the current tab, the one number a section is about, inline code. If two things on a screen are `hot`, one of them is wrong.

The blue ramp `dmg-1` → `dmg-4` is depth, not a palette. `dmg-4` is the brightest and belongs to titles, headline figures and words in a table; `dmg-3` labels sections; `dmg-2` and `dmg-1` are fills. Do not use a ramp step as a hover tint for something unrelated.

Signals: `good` for a win, `warn` for a cost, `pink` for a structural boundary in decoded text. Never signal with `hot` — it means "look here", not "this is fine".

The `sym-*` colours are an encoding, one hue per symbol kind, and they are only legible with a `Legend` beside them:

| family | what it marks |
| --- | --- |
| `sym-word`, `sym-rule`, `sym-esc` | RPR1 stream: a dictionary word, a Re-Pair rule, an escaped literal |
| `sym-direct`, `sym-delta`, `sym-terminal`, `sym-shortcut` | YLK1 cells: what the reader finds when it lands on one |
| `*-lo` / `*-hi` pairs | the two ends of a ramp, for a gradient — use both or neither |
| `chapter-marker`, `verse-marker`, `chain` | boundaries and chains drawn over text, as 2–3px inset shadows |

Reference these as `var(--sym-word)`, never as hex, so the Light theme follows.

## Themes

`dark` is the primary theme and the one the repository ships; `light` is derived here, not in the source — say so if a consumer asks. Two rules hold in both: the seven physical colours (`lcd`, `lcd-well`, `lcd-ink`, `lcd-dim`, `lcd-bezel`, `case`, `case-edge`, `case-face`) are the same in each, because a plastic case does not change colour when a page does; and `lcd-dim` is deliberately 2.1:1 on the glass — it is an unlit segment, never text.

Two pairs fail 4.5:1 and are kept as the source has them: `dmg-3` on `panel` in Dark (4.3:1) and `good` on `ground` in Dark (4.4:1). Use `ink-soft` for small text on a panel, and pair `good` with a label rather than relying on the colour alone. In Light, `hot-soft` is a fill and marker colour only (3.1:1 on panel).

## Spacing

`space-5` (10px) is the default gap between elements in a row; `space-7` (14px) is a panel's padding and a stat grid's row gap; `space-8` (18px) separates panels in a two-column grid; `space-9` (20px) is the page gutter and a stat grid's column gap. Below that, `space-1`–`space-4` are for chips, swatches and tab internals. The source declares no spacing or radius variables — these steps are the values its stylesheets use, named here.

## Components

Six, on `window.CodecLab`: `Panel`, `TabBar`, `StageLabel`, `StatGrid`, `Legend`, `LcdScreen`. The repository has no component library, so all six were written by hand from its CSS, class for class; each one's README names the file it came from. Read that README before using it. They are React function components over `React.createElement` with no state beyond what a prop drives, and they style themselves from `bundle.css` on tokens alone.

Compose them the way the pages do: `TabBar` at the top of the wrapper, then `StageLabel` above each section, `Panel` for the section body, `StatGrid` and `Legend` inside a panel, `LcdScreen` on its own.

## Iconography

There is none. The repository ships no marks, icon set or logo — its interface is type, hairlines and colour fields. Do not introduce an icon font or a mark to fill the gap: label controls in words, as the source does (`SEARCH`, `LOOKUP`, `NEXT`). `assets/Screenshots` holds the one image the repository contains, the README's screenshot of the RPR1 lab.

## Not synced

- **Font files.** Both faces load from Google Fonts in every page (`Silkscreen:wght@400;700`, `IBM+Plex+Mono:wght@400;500;600`). No binaries are committed, so `type.fonts` is empty and the families name the stacks only. Fetch the faces from Google Fonts, or drop the `.woff2` files on this page to pin them.
- **The second theme.** `light` is derived, not read: the repository declares one `:root` block per page and no light palette, no `[data-theme]`, no `prefers-color-scheme`. Every Light value here is a judgement, contrast-checked against `ground` and `panel`.
- **Spacing and radius names.** Values are observed in the CSS; the names are ours. The repository names no spacing or radius variable.
- **The six `color-mix()` values.** `sym-esc-lo/hi`, `sym-rule-lo/hi`, `sym-delta-lo/hi` are `color-mix(in oklab, …)` in the source, which the token format cannot hold. They are resolved to hex here, computed in oklab; the Light ends are the same mixes against the Light ground and black.
- **The LCD font.** `lcd-font.js` draws the curved segment glyphs of US 4,982,181 on a canvas. It is a renderer, not a style, and no token or component captures it — `LcdScreen` sets mono text on the glass instead.
- **Two literals no token holds.** The glass highlight (`#ffffff22`) and the case's top light (`#3b4560`, inside `shadow-device`) stay inside the rules that use them.
- **`DETAILS.md`.** Left out by decision: it documents the codec's format and benchmarks, not the brand.
- **Components not built.** None. The repository has no component library to build from; the six here are hand-written, and the route was chosen deliberately rather than forced by a failure.
