# Bluebonnet design system

Calm, legible interfaces in the colors of a Texas roadside in April: bluebonnet blue for everything that matters, with Indian paintbrush, firewheel gold and winecup used sparingly, the way they grow scattered through a field of blue.

Bluebonnet follows the Pico CSS approach. A classless base layer in `components/bundle.css` makes plain semantic HTML (`h1`–`h3`, `p`, `a`, `code`, `pre`, `hr`, `small`) look right with no classes, and a short set of `bb-` components covers controls. Every base rule sits inside `:where()`, so it has zero specificity and any class you write wins.

- **Demo and specimen page:** [index.html](index.html)
- **Claude design system:** [Bluebonnet on claude.ai](https://claude.ai/artifact/ErAUuMP6rR6fDjwrewPu7m) (private until shared). Point Claude at it when you want a page built in this style.

## Use it

Plain HTML: link one stylesheet. It includes the tokens, the classless base layer and the `bb-` component classes, and loads the fonts from Google Fonts.

```html
<link rel="stylesheet" href="dist/bluebonnet.css">

<button class="bb-btn bb-btn--primary">Save report</button>
<span class="bb-badge bb-badge--success"><span class="bb-badge__dot"></span>Peak bloom</span>
```

The theme follows the OS. Set `data-theme="light"` or `data-theme="dark"` on `<html>` to force one.

React 18: load React, then `dist/bluebonnet.js`, which assigns `window.Bluebonnet`.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="dist/bluebonnet.js"></script>
<script>
  const { Button, Alert } = window.Bluebonnet;
</script>
```

Only need the variables (for Tailwind, another component library, or native apps)? Use `dist/bluebonnet-tokens.css`, or read `tokens.json` directly.

## Files

| Path | What |
| --- | --- |
| `tokens.json` | Source of truth: colors per theme, type styles, spacing, radii, shadows, each with a usage note. |
| `src/components.css` | Classless base layer and `bb-` component styles. Edit this, not `dist/`. |
| `dist/bluebonnet.css` | Built: tokens + `src/components.css`. |
| `dist/bluebonnet-tokens.css` | Built: custom properties and `text-*` classes only. |
| `dist/bluebonnet.js`, `dist/bluebonnet.d.ts` | React components (`Button`, `Field`, `Choice`, `Badge`, `Alert`, `Tabs`, `Table`) and their prop types. |
| `components/README.md` | Usage guidelines for each component. |
| `build.py` | Rebuilds `dist/*.css` from `tokens.json` and `src/`. |

After changing `tokens.json` or `src/components.css`, run `python3 build.py`. Keep the Claude design system in step by sending the same `tokens.json`, `components.css` (as `bundle.css`) and `bluebonnet.js` (as `bundle.js`).

## Content fundamentals

- Write in plain, friendly English, the way a knowledgeable neighbor would explain it. Address the reader as "you"; the product says "we" only when a person on the team is speaking.
- Sentence case for everything: headings, buttons, tabs, labels. "Save report", not "Save Report".
- Lead with the fact, then the detail: "Peak bloom is about 10 days out." Then where the reports came from.
- Use real units and formats: "38.2 mi", "Mar 30, 2026", "2.5 acres". Numbers are digits, never spelled out in data.
- Errors say what happened and how to fix it, with no apology: "The photo is larger than 20 MB. Choose a smaller file and try again."
- No emoji in UI copy. No "y'all", cowboy hats or lone stars as decoration; the Texas character comes from the colors and the content, not costume.

## Color

- Ground every page in `surface`; put inputs, tables and panels on `surface-raised`; use `surface-sunken` for code and header rows.
- Body text is `ink`. Secondary text is `ink-muted`. Both read at 6:1 or better on all three surfaces in both themes.
- `bluebonnet` is the brand and the only color for primary actions, links, the selected tab and the focus ring. Hover and pressed states use `bluebonnet-deep`. Text on a bluebonnet fill is `on-bluebonnet`.
- Keep the wildflower accents rare. On any one screen, `bluebonnet` should outweigh all other hues combined.
  - `paintbrush` (Indian paintbrush) is the one warm accent: a single highlighted action per screen (`Button variant="accent"`), a "featured" marker, the second chart series.
  - `firewheel` (the gold tip of the Indian blanket) is a fill only, with `on-firewheel` text. It is also the text-selection color.
  - `winecup` is the third chart series and, through `link-visited`, the color of visited links. A bluebonnet's white banner spot turns wine-red once a bee has visited it; links do the same.
- Status colors are separate from the flowers: `success`, `warning` and `danger`, each on its `-soft` ground. Never use `paintbrush` to mean an error. Status always carries an icon or a word as well as color.
- Borders: `line` for hairline dividers, `line-strong` for anything a person operates (inputs, checkboxes, secondary buttons). `line-strong` holds 3:1 against both surfaces.
- Dark theme is a night sky over the same field: grounds go to deep blue-black, and each flower lightens so it keeps 4.5:1 as text. Fills that lighten take dark `on-` text, which is why every fill has its own `on-` token.
- Chart series order: `bluebonnet`, `paintbrush`, `winecup`, `firewheel`, then `ink-muted`.

## Typography

- Headings use `--font-display` (Bricolage Grotesque): `text-h1` for page titles, `text-h2` for sections, `text-h3` for subsections and dialog titles. `text-display` appears at most once per page.
- All running text uses `--font-body` (Public Sans) at `text-body`, 16/26. Keep lines near 65 characters. Captions and hints use `text-small`.
- `text-label` is the uppercase eyebrow and table-header style. Write the source text in sentence case and let CSS uppercase it.
- `--font-mono` (IBM Plex Mono) is for code, coordinates and IDs. Numbers in tables stay in Public Sans with tabular figures; the base layer turns `tabular-nums` on for the whole page.
- Fonts load from Google Fonts through the `@import` at the top of `bundle.css`. Each family has a system fallback, so nothing breaks offline.

## Space, shape and depth

- Spacing runs on a 4px base: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48. Lay out groups with flex or grid `gap` using these steps instead of margins.
- Page gutters are at least `space-4` on phones and `space-6` from tablet width up.
- Corners: `radius-sm` for checkboxes, badges and inline code; `radius-md` for buttons, inputs, alerts and tables; `radius-lg` for dialogs; `radius-pill` for radios and dots. Never round a full-width panel more than `radius-md`.
- Separate things with a `line` border or a change of surface. Shadows are only for things that float above the page: `shadow-1` for menus and popovers, `shadow-2` for dialogs.

## States and motion

- Focus: a solid 2px `bluebonnet` outline with a 2px offset on every interactive element. It reads at 3:1 or better on every surface in both themes. Never remove it.
- Hover darkens fills to `bluebonnet-deep` or tints quiet controls with `bluebonnet-soft`. Disabled is 50% opacity with a not-allowed cursor.
- Motion is limited to 120ms color transitions. Nothing slides, bounces or fades in. Honor `prefers-reduced-motion` by turning transitions off.

## Iconography

- Bluebonnet ships no icon set or logo. Set the name "Bluebonnet" in `--font-display` at weight 700 where a mark is needed.
- For product icons, use Lucide at 20px with a 1.75px stroke, colored with `currentColor` so they follow the text token. Pair every icon that carries meaning with a visible word or an `aria-label`.
- The four alert glyphs (info, success, warning, danger) are built into `Alert` as filled 20px SVGs.
- No emoji as icons or decoration.
