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
| `dist/bluebonnet-charts.js` | ES module of chart colors for TanStack Charts: `palette`, `extendedPalette`, `theme`, `categorical()`, `sequential`, `diverging`. |
| `charts.js` | The four example charts on the demo page, with the import map in `index.html` that loads TanStack Charts from jsDelivr. |
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
  - `paintbrush` (Indian paintbrush) is the one warm accent: a single highlighted action per screen (`Button variant="accent"`), a "featured" marker.
  - `firewheel` (the gold tip of the Indian blanket) is a fill only, with `on-firewheel` text. It is also the text-selection color.
  - `winecup` is, through `link-visited`, the color of visited links. A bluebonnet's white banner spot turns wine-red once a bee has visited it; links do the same.
- Status colors are separate from the flowers: `success`, `warning` and `danger`, each on its `-soft` ground. Never use `paintbrush` to mean an error. Status always carries an icon or a word as well as color.
- Borders: `line` for hairline dividers, `line-strong` for anything a person operates (inputs, checkboxes, secondary buttons). `line-strong` holds 3:1 against both surfaces.
- Dark theme is a night sky over the same field: grounds go to deep blue-black, and each flower lightens so it keeps 4.5:1 as text. Fills that lighten take dark `on-` text, which is why every fill has its own `on-` token.
- Charts have their own `chart-*` tokens; see [Charts](#charts). The flowers appear there in chart-safe steps, so don't paint data with the UI tokens.

## Charts

### Series colors

Eight series colors in a fixed order, plus four more you opt into. Assign them in order, starting at `chart-1`, and never skip or cycle.

| Token | Flower | Light | Dark |
| --- | --- | --- | --- |
| `chart-1` | bluebonnet | `#3149a3` | `#5f80e0` |
| `chart-2` | paintbrush | `#c93f24` | `#e36045` |
| `chart-3` | agave | `#0a938e` | `#079a94` |
| `chart-4` | firewheel | `#e2a520` | `#bf8909` |
| `chart-5` | winecup | `#8e2a6b` | `#b6508e` |
| `chart-6` | live oak | `#448335` | `#58994a` |
| `chart-7` | verbena | `#7750b1` | `#835cbe` |
| `chart-8` | primrose | `#dc7d94` | `#d2748b` |
| `chart-9` | mesquite (opt-in) | `#848f1e` | `#798205` |
| `chart-10` | blue sky (opt-in) | `#50a9d9` | `#439ccc` |
| `chart-11` | lantana (opt-in) | `#f28e42` | `#d67523` |
| `chart-12` | horsemint (opt-in) | `#a864a2` | `#9b5896` |
| `chart-other` | | `#8f95ad` | `#666c8a` |

- Light `chart-1`, `chart-2` and `chart-5` are the UI's `bluebonnet`, `paintbrush` and `winecup`. The other steps were picked so that every series sits in one lightness band and holds its color. That is why the dark steps are deeper than the dark UI flowers.
- The order is what keeps neighbors apart. Each adjacent pair stays distinct under protanopia and deuteranopia simulation (OKLab ΔE ≥ 11 in both themes, target 8) and for full color vision (ΔE ≥ 18, floor 15). For example, the old order (paintbrush next to winecup) fell below the floor in dark mode.
- **Eight by default, twelve when you opt in.** `chart-9` to `chart-12` were added after slot 8 without changing slots 1–8, and every neighbor pair from 8 through 12 passes the same checks in both themes. Each of them has a near-twin among the first eight, though: lantana reads like paintbrush or firewheel to colorblind readers, horsemint like winecup in dark mode, mesquite like live oak, blue sky like agave. Over all twelve, 11 of 66 pairs look alike in light mode and 18 of 66 in dark, against 4 of 28 and 8 of 28 for the first eight. So:
  - Use slots 9–12 only in stacked bars and areas, where each segment sits beside its neighbors in a fixed order, or in line charts with every line labeled directly. Never in scatterplots, maps or unlabeled lines.
  - Give every chart that uses them a tooltip and a data table.
  - Ask for them on purpose: `categorical(domain, { extended: true })`. Without it, `categorical()` throws past eight, and with it, past twelve.
  - Past twelve, fold the rest into Other (`chart-other`) or use small multiples.
- Scatterplots, maps and small multiples put any two colors side by side, not just neighbors. Only the first three slots stay distinct in every pairing, so cap those forms at three series plus Other.
- `chart-4` firewheel, `chart-8` primrose, `chart-10` blue sky and `chart-11` lantana are under 3:1 on light grounds. A chart that uses them needs direct labels or a data table.
- Color follows the entity, not its rank. If a filter removes Hill Country, Coastal Bend keeps its color; fix the domain with `categorical()`.
- Series colors are for identity only. A series that means good or bad (error rate, pass/fail) uses `success`, `warning` and `danger`, always with an icon or a word.
- Text never takes a series color. Values, labels and legends stay `ink` or `ink-muted`; the mark beside them carries the color.

### Ramps

- `chart-seq-1` to `chart-seq-7` are a single bluebonnet hue for magnitude (counts, rates, heatmaps), from low to high. Step 6 is `bluebonnet`. In dark mode the ramp runs dark to light, so low values recede into the night ground.
- `chart-div-1` to `chart-div-7` run from paintbrush to a neutral gray at `chart-div-4` to bluebonnet, for values around a real center: change from normal, above or below a target. Put the bad or "less" side on paintbrush. Never use a hue at the midpoint.
- Bin ramps with a threshold scale and fixed cut points, so the same value gets the same color in every chart.

### Marks and layout

- Lines 2px. Bars and stacked segments get a 1px `surface-raised` stroke so neighbors separate, and 4px rounding on the value end only.
- Grid and axes stay quiet: TanStack draws them in `currentColor` at low opacity, so put the chart inside `.bb-chart` (which sets `color: var(--ink)`).
- With two or more series, show a legend. With four or fewer, also label the lines directly. One series needs no legend; the title names it.
- Write the title as the finding ("Peak bloom moves north through April"), with the measure and units in the note below it.
- Every chart gets a tooltip and a data table (`<details>` under the plot), so no value depends on color alone.
- One y-axis per chart. Two measures with different units go in two charts.

### With TanStack Charts

`dist/bluebonnet.css` maps TanStack's `--ts-chart-1` to `--ts-chart-6` palette slots and its tooltip variables onto Bluebonnet tokens, so a chart on a Bluebonnet page is styled with no extra setup. To use all eight series colors and fixed domains, import the helper:

```js
import { colorLegend, defineChart, lineY, mountChart } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { categorical, theme } from "./dist/bluebonnet-charts.js";

const chart = defineChart({
  marks: [lineY(rows, { x: "week", y: "reports", z: "region", strokeWidth: 2 })],
  scales: {
    x: { scale: () => scalePoint().padding(0.1) },
    y: { scale: scaleLinear, nice: true, grid: true, axis: { label: "Reports per week" } },
  },
  color: categorical(["Hill Country", "Brazos Valley", "Coastal Bend"], { legend: colorLegend() }),
  focus: "group-x",
  theme,
  tooltip,
});

mountChart(document.querySelector("#reports"), { definition: chart, height: 320, ariaLabel: "Field reports per week by region" });
```

```html
<figure class="bb-chart">
  <h3 class="bb-chart__title">Peak bloom moves north through April</h3>
  <p class="bb-chart__note">Field reports per week by region.</p>
  <div class="bb-chart__plot" id="reports"></div>
  <p class="bb-chart__source">Source: Texas wildflower field reports</p>
</figure>
```

In React, pass the same definition to `<Chart definition={chart} height={320} ariaLabel="…" />` from `@tanstack/charts/react`. For ramps, use `scaleThreshold` from `d3-scale` with `range: sequential` or `range: diverging`. The tokens are CSS `var()` references, so a chart switches with the page theme without being rebuilt. `charts.js` has all four demo charts: a line chart, a stacked bar chart, a heatmap and diverging bars.

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
