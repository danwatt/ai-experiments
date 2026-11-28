# Pump & Poll

A buildless, accessible DFW election-year gasoline price explorer. Serve `dist/` with any static web server. Run `npm start` for a local preview and `npm test` for calculation and source-coverage checks. No dependencies or API keys are required.

## Data and interpretation

The calendar uses the Tuesday after the first Monday in November. Historical prices are BLS November metro averages, **monthly proxies rather than daily election-day observations**. The federal filter selects even years; presidential selects years divisible by four. The all-years option applies the same Tuesday calendar rule without calling off-years federal elections.

The checked-in snapshot is dated November 4, 2026. Price, CPI, and hourly earnings are BLS observations distributed by FRED. The four original series are included as CSV files in `dist/data/`, together with `observations.json`. `fetch-data.py` records public source data, reads all rows including FRED's extra-row section, rejects truncated sources, and leaves missing historical observations empty. DFW November CPI readings start in 1998; the U.S. CPI option supports earlier years. This snapshot should be intentionally reviewed before any future refresh; the as-of date and projection year are explicit in the code.

2026 estimates hold each unavailable November input flat at its latest published month. These estimates are labeled, dashed on the chart, removable using the preliminary-data switch, and identified in CSV downloads. This is a scenario, not a forecast or an official November release. Hourly earnings start in 2007; no earlier wage is fabricated.

Inflation-adjusted cost = price × reference CPI / year CPI. Wage-adjusted cost = price × reference wage / year wage. Minutes per gallon = 60 × price / gross hourly earnings. Gallons per hour = gross hourly earnings / price. A full tank is 14.5 gallons. Work metrics use nominal prices and wages from the same year.

## Sources

- [DFW regular gasoline · APUS37A74714](https://fred.stlouisfed.org/series/APUS37A74714)
- [DFW CPI-U · CUURA316SA0](https://fred.stlouisfed.org/series/CUURA316SA0)
- [U.S. CPI-U · CPIAUCNS](https://fred.stlouisfed.org/series/CPIAUCNS)
- [DFW average hourly earnings · SMU48191000500000003](https://fred.stlouisfed.org/series/SMU48191000500000003)

The explorer includes price and work metrics, line/bar views, two-year comparisons, source notes, keyboard-accessible chart points, filtered CSV exports, and URL-persisted controls.
