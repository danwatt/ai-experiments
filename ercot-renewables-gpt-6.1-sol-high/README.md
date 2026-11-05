# Gridshift — The changing Texas energy mix

A single-page, buildless HTML/CSS/JavaScript visualization of **237 actual months of ERCOT generation, January 2007–September 2026**. The bundled snapshot was retrieved November 4, 2026. No API key, build step, JavaScript library, or backend is needed.

The Grid Control Room theme uses charcoal instrument panels, condensed headings, monospaced readouts, cyan wind/renewable accents, and amber solar/selection accents. The generation monitor comes first, followed by long-term indicators and a cyan seasonal matrix. The archive is explicitly marked as historical, not live telemetry.

Open `index.html` directly in a browser, or serve the folder:

```sh
npm start
```

Visit http://127.0.0.1:4174. Any static file server or static hosting service also works.

## Interactions

- Monthly stacked generation columns, with annual aggregation as an alternative.
- Toggle between percentage shares and electricity generated in TWh.
- All-history, 10-calendar-year, and 5-calendar-year presets, plus start/end year selectors.
- Hover or tap a column to inspect the complete eight-source breakdown. A keyboard-accessible slider and previous/next controls provide precise selection.
- Click a legend item to highlight a source. Other sources are dimmed; percentages retain the original total denominator.
- A 20-year × 12-month heatmap shows seasonal patterns. Switch among renewables, wind, solar, coal, gas, and nuclear; click a square to inspect the month above. Arrow keys navigate the heatmap spatially.
- Download all monthly observations as CSV. The export includes signed storage load and settlement status.

## Official source data

[ERCOT Generation / Fuel Mix Reports](https://www.ercot.com/gridinfo/generation/index.html) publishes actual generation by fuel for each 15-minute settlement interval and includes monthly and annual summaries.

Reports used for this snapshot:

- [2007–2024 historical workbook archive](https://www.ercot.com/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip)
- [2025 Fuel Mix Report](https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx)
- [2026 Fuel Mix Report](https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx)

`data.js` contains the browser-ready monthly snapshot, its source URLs, processing method, and SHA-256 hashes for each source workbook. `ercot-monthly.csv` contains the same numerical series for independent analysis. Raw workbooks are downloaded to a temporary cache, not bundled with the page.

## Method and definitions

- **2008–2026:** use the reports’ published monthly summary values. Do not interpolate annual shares or synthesize monthly observations.
- **2007:** the annual tab does not have monthly columns. Sum the published **Daily MWH** column of each month’s sheet by fuel, then divide by 1,000 to obtain GWh. Each fuel’s annual sum is checked against the annual summary tab.
- **Units:** older reports (2008–2016) use MWh; newer summary tabs use GWh. All stored numerical energy values are normalized to GWh. Charts and month details divide by 1,000 again to display TWh.
- **Natural gas:** combine `Gas` and `Gas-CC`. Older reports’ `Wnd` and `Oth` become Wind and Other.
- **Renewables:** Wind + Solar + Hydro + separately reported Biomass. Nuclear remains a separate source. Early workbooks do not report solar and biomass separately, so the harmonized fields are zero then; some such generation may be part of Other. The early renewable series is therefore the identifiable renewable share, not an estimate of unclassified renewables.
- **Storage:** preserve the signed `WSL` figure as `storageNet`. ERCOT includes this (generally negative storage charging load) in its published Total. The visualization’s generation denominator sums the eight primary generation categories and **excludes WSL**, rather than dividing generation by a total reduced by charging. Therefore generation shares can differ from those derived using ERCOT’s reported net Total. The detail panel reports WSL separately whenever nonzero. This is net storage load, not a measurement of gross battery discharge or charge efficiency.
- **Signed energy:** a few historical Other values are slightly negative. Preserve them in the dataset and percentage calculations; the SVG uses a signed baseline for them. They are usually too small to distinguish at chart scale.
- **Annual shares:** sum each source’s monthly GWh, then divide by annual generation. Never average monthly percentages. Headline comparisons use the latest **complete** year, 2025. The 2026 annual column covers **January–September only** and is labeled YTD.
- **Missing months:** October–December 2026 have no published observations in this snapshot. They are hatched in the heatmap, omitted from the charts and CSV, and never treated as zero generation.
- **Settlement:** an asterisk on a modern monthly summary column denotes Final settlements; unstarred published modern columns are Initial. September and August 2026 remain Initial in this snapshot. Older files without the modern indicator are labeled Historical.
- **Coverage:** the ERCOT grid region, not the entirety of Texas; no emissions or installed capacity claims are inferred from generation.

## Refreshing the snapshot

The page deliberately uses a saved snapshot. It does not make live API requests when opened. To regenerate the bundled files from ERCOT:

```sh
python3 -m pip install openpyxl xlrd
python3 fetch-data.py --refresh
```

The script discovers the currently linked fuel-mix reports on ERCOT’s page, caches them in `/tmp/ercot-source`, extracts monthly values, checks them against published totals (including WSL reconciliation), and rewrites `data.js` and `ercot-monthly.csv`. Omit `--refresh` to reuse cached files. Source access requires an internet connection. Update the snapshot-specific month-count and final-month expectations in `data.test.cjs` when extending the data.

## Verification

```sh
npm test
node --check app.js
```

The data checks verify contiguous monthly history, source/category reconciliation, renewable totals, gas category combination, exact source values, 2007 annual reconciliation, and settlement indicators. Browser checks cover desktop and narrow layouts, chart controls, source highlighting, month selection, heatmap navigation, annual YTD labels, and console errors.

## Files

`index.html`, `styles.css`, `app.js`, and `data.js` are the page. `favicon.svg` is a local vector icon. Google Fonts are optional visual enhancements; system fallbacks keep the page usable offline. Everything needed for data and interactions is bundled locally.
