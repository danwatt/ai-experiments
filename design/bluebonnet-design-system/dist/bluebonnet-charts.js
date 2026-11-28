// Bluebonnet chart colors for TanStack Charts (@tanstack/charts). Plain ES module, no dependencies.
//
//   import { theme, categorical, sequential, diverging } from "./bluebonnet-charts.js";
//
// Every value is a CSS var() reference to a token in dist/bluebonnet.css, so a chart follows the
// page's light or dark theme without being rebuilt. Hand-maintained: keep in step with tokens.json.

const v = (name) => `var(--${name})`;
const steps = (prefix, n) => Object.freeze(Array.from({ length: n }, (_, i) => v(`${prefix}-${i + 1}`)));

/** The eight categorical series colors, in their fixed order. Assign in order; never skip or cycle. */
export const palette = steps("chart", 8);

/**
 * All twelve series colors. Slots 9–12 are opt-in: each sits close to one of the first eight, so use
 * them only in stacked bars and areas or in line charts with direct labels, never in scatterplots or maps.
 */
export const extendedPalette = steps("chart", 12);

/** The neutral for an "Other" bucket. */
export const other = v("chart-other");

/** Seven-step bluebonnet ramp for magnitude, low to high. */
export const sequential = steps("chart-seq", 7);

/** Seven-step paintbrush–gray–bluebonnet ramp for values around a meaningful center. Index 3 is the midpoint. */
export const diverging = steps("chart-div", 7);

/** Pass as `theme` in defineChart so automatic color uses all eight slots. Text and grid follow currentColor. */
export const theme = Object.freeze({ palette });

/**
 * Fixed color mapping for named series: `color: categorical(["Hill Country", "Coastal Bend"])`.
 * Colors follow the entity, not its rank, so keep the domain in the same order when data is filtered.
 * Name an `other` key to paint that series with the neutral. Past eight named series it throws, unless
 * you pass `extended: true` (up to twelve, with direct labels or a table). Past that, fold the rest into
 * "Other" or split the chart into small multiples.
 */
export function categorical(domain, { other: otherKey, legend, extended = false } = {}) {
  const colors = extended ? extendedPalette : palette;
  const named = domain.filter((d) => d !== otherKey);
  if (named.length > colors.length) {
    const hint = extended ? "" : " Pass extended: true for up to 12 in stacked bars or labeled lines,";
    throw new RangeError(`Bluebonnet has ${colors.length} series colors here; got ${named.length}.${hint} or fold the rest into "Other" or use small multiples.`);
  }
  let i = 0;
  const range = domain.map((d) => (d === otherKey ? other : colors[i++]));
  return legend ? { domain, range, legend } : { domain, range };
}
