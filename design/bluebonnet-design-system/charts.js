// Example charts for the Bluebonnet specimen page, built with TanStack Charts (@tanstack/charts).
// The import map in index.html resolves the bare specifiers to the package's own ES modules on jsDelivr,
// so this file reads the same as it would in a bundled app. Sample data, not real field reports.

import { barX, barY, cell, colorLegend, defineChart, lineY, mountChart, ruleY, stack, text } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleThreshold } from "d3-scale";
import { categorical, diverging, sequential, theme } from "./dist/bluebonnet-charts.js";

const WEEKS = ["Mar 2", "Mar 9", "Mar 16", "Mar 23", "Mar 30", "Apr 6", "Apr 13", "Apr 20", "Apr 27", "May 4"];

// ---------- 1. Line: four series, legend plus direct labels ----------
const REGIONS = {
  "Hill Country": [6, 14, 29, 48, 66, 72, 58, 37, 19, 9],
  "Brazos Valley": [3, 9, 20, 37, 52, 63, 61, 44, 25, 12],
  "Coastal Bend": [18, 34, 52, 61, 55, 40, 26, 15, 8, 4],
  "North Texas": [1, 3, 7, 14, 26, 41, 54, 57, 43, 24],
};
const regionNames = Object.keys(REGIONS);
const reports = regionNames.flatMap((region) =>
  REGIONS[region].map((n, i) => ({ id: `${region}-${WEEKS[i]}`, region, week: WEEKS[i], reports: n })));
// Direct labels at each line's end, nudged apart so close finishes don't overprint (gap in data units).
const lastWeek = reports.filter((r) => r.week === WEEKS[WEEKS.length - 1]).sort((a, b) => a.reports - b.reports);
lastWeek.forEach((r, i) => { r.labelY = i ? Math.max(r.reports, lastWeek[i - 1].labelY + 7) : r.reports; });

const reportsChart = defineChart({
  marks: [
    lineY(reports, { x: "week", y: "reports", z: "region", strokeWidth: 2 }),
    text(lastWeek, { x: "week", y: "labelY", text: "region", anchor: "start", dx: 8, fontSize: 12, fontWeight: 600, fill: "var(--ink-muted)" }),
  ],
  scales: {
    x: { scale: () => scalePoint().padding(0.1) },
    y: { scale: scaleLinear, nice: true, grid: true, axis: { label: "Reports per week" } },
  },
  margin: { right: 100 },
  color: categorical(regionNames, { legend: colorLegend({ placement: "bottom" }) }),
  focus: "group-x",
  theme,
  tooltip,
});

// ---------- 2. Stacked bars: all twelve series (slots 9–12 are opt-in) ----------
const SPECIES = ["Bluebonnet", "Indian paintbrush", "Antelope horns", "Firewheel", "Winecup", "Prickly pear", "Prairie verbena", "Evening primrose", "Mesquite", "Blue curls", "Lantana", "Horsemint"];
const COUNTY_SIGHTINGS = {
  Llano: [142, 58, 22, 31, 27, 18, 24, 12, 14, 9, 11, 16],
  Washington: [128, 71, 15, 44, 19, 9, 13, 26, 8, 12, 17, 9],
  Burnet: [117, 49, 28, 22, 21, 24, 19, 10, 12, 7, 10, 13],
  Gillespie: [96, 37, 31, 18, 30, 27, 22, 8, 15, 10, 8, 14],
  Ellis: [81, 33, 12, 39, 11, 6, 17, 21, 6, 11, 9, 7],
  Brazos: [64, 41, 9, 27, 14, 5, 10, 19, 9, 8, 12, 6],
};
const sightings = Object.entries(COUNTY_SIGHTINGS).flatMap(([county, counts]) =>
  counts.map((n, i) => ({ id: `${county}-${SPECIES[i]}`, county, species: SPECIES[i], n })));

const sightingsChart = defineChart({
  marks: [
    barX(sightings, {
      x: "n", y: "county", color: "species",
      layout: stack({ order: SPECIES }),
      stroke: "var(--surface-raised)", strokeWidth: 1,
      radius: { end: 4 },
    }),
  ],
  scales: {
    x: { scale: scaleLinear, nice: true, grid: true, axis: { label: "Sightings reported" } },
    y: { scale: () => scaleBand().domain(Object.keys(COUNTY_SIGHTINGS)).padding(0.3) },
  },
  color: categorical(SPECIES, { extended: true, legend: colorLegend({ placement: "bottom" }) }),
  theme,
  tooltip,
});

// ---------- 3. Heatmap: sequential ramp ----------
const COUNTY_REGION = { Llano: ["Hill Country", 1.15], Burnet: ["Hill Country", 1.0], Gillespie: ["Hill Country", 0.9], Washington: ["Brazos Valley", 1.2], Brazos: ["Brazos Valley", 0.85], Ellis: ["North Texas", 1.1] };
const BLOOM_CUTS = [10, 25, 40, 55, 70, 85];
const bloom = Object.entries(COUNTY_REGION).flatMap(([county, [region, k]]) =>
  REGIONS[region].map((n, i) => ({ id: `${county}-${WEEKS[i]}`, county, week: WEEKS[i], pct: Math.min(96, Math.round(n * k * 1.2)) })));

const bloomChart = defineChart({
  marks: [cell(bloom, { x: "week", y: "county", color: "pct", inset: 1, radius: 2 })],
  scales: {
    x: { scale: () => scaleBand().domain(WEEKS).padding(0) },
    y: { scale: () => scaleBand().domain(Object.keys(COUNTY_REGION)).padding(0) },
  },
  color: {
    scale: scaleThreshold,
    domain: BLOOM_CUTS,
    range: sequential,
    legend: colorLegend({ label: "Roadside in bloom (%)", placement: "bottom" }),
  },
  tooltip,
});

// ---------- 4. Diverging bars: above and below a center ----------
const RAIN = [["Sep", -1.8], ["Oct", 2.4], ["Nov", 0.6], ["Dec", -0.9], ["Jan", -0.3], ["Feb", 1.1], ["Mar", -0.5]];
const rain = RAIN.map(([month, inches]) => ({ id: month, month, inches }));
const RAIN_CUTS = [-1.5, -0.75, -0.25, 0.25, 0.75, 1.5];

const rainChart = defineChart({
  marks: [
    barY(rain, { x: "month", y: "inches", color: "inches", radius: { end: 4 } }),
    ruleY([0], { stroke: "var(--line-strong)" }),
  ],
  scales: {
    x: { scale: () => scaleBand().domain(RAIN.map((r) => r[0])).padding(0.35) },
    y: { scale: scaleLinear, nice: true, grid: true, axis: { label: "Inches vs normal" } },
  },
  color: {
    scale: scaleThreshold,
    domain: RAIN_CUTS,
    range: diverging,
    legend: colorLegend({ label: "Drier ← → wetter (in)", placement: "bottom" }),
  },
  tooltip,
});

// ---------- mount ----------
const CHARTS = [
  ["chart-reports", reportsChart, 340, "Wildflower field reports per week by region, March 2 to May 4"],
  ["chart-sightings", sightingsChart, 380, "Sightings of twelve species in six counties, stacked"],
  ["chart-bloom", bloomChart, 300, "Share of surveyed roadside in bloom by county and week"],
  ["chart-rain", rainChart, 300, "Llano County rainfall compared with normal, September to March"],
];
for (const [id, definition, height, ariaLabel] of CHARTS) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ""; mountChart(el, { definition, height, ariaLabel, idPrefix: id }); }
}

// ---------- data tables (exact values without color) ----------
function table(caption, head, rows) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return `<details class="bb-chart__table"><summary>Show data table</summary><div class="bb-table-wrap"><table class="bb-table">
<caption>${esc(caption)}</caption><thead><tr>${head.map((h, i) => `<th${i ? ' class="bb-num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="bb-num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}
const TABLES = {
  "chart-reports": table("Reports per week", ["Week", ...regionNames], WEEKS.map((w, i) => [w, ...regionNames.map((r) => REGIONS[r][i])])),
  "chart-sightings": table("Sightings by species", ["Species", ...Object.keys(COUNTY_SIGHTINGS)], SPECIES.map((s, i) => [s, ...Object.values(COUNTY_SIGHTINGS).map((c) => c[i])])),
  "chart-bloom": table("Roadside in bloom (%)", ["Week", ...Object.keys(COUNTY_REGION)], WEEKS.map((w) => [w, ...Object.keys(COUNTY_REGION).map((c) => bloom.find((b) => b.county === c && b.week === w).pct)])),
  "chart-rain": table("Inches vs 1991–2020 normal", ["Month", "Inches"], RAIN.map(([m, n]) => [m, (n > 0 ? "+" : "") + n.toFixed(1)])),
};
for (const [id, html] of Object.entries(TABLES)) {
  document.getElementById(id)?.closest(".bb-chart")?.insertAdjacentHTML("beforeend", html);
}
