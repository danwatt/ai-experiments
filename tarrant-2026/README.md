# Tarrant County 2026 — Election Intelligence Dashboard

Single-file HTML election analysis with 707 real precinct boundaries already embedded.
Precinct data and analysis work offline; the optional basemap uses online tiles.

## Basemap

The precinct explorer defaults to **Stamen Toner Lite** beneath translucent precinct
shading, with matching Web Mercator projection for boundaries and tiles. The basemap
follows pan, zoom, precinct search, and resizing. Choose **Precinct boundaries** under
Map color for an unfilled overlay, or **None (offline)** under Basemap to disable tiles.

Stamen tiles are hosted by Stadia Maps. Local previews at `localhost` or `127.0.0.1`
work without a key. For a published site, register its domain in a Stadia Maps account
using [domain authentication](https://docs.stadiamaps.com/authentication/).
If Stamen tiles fail, the map switches to a muted OpenStreetMap basemap and displays
a notice. If both services fail, precinct data and selection remain usable.
Attribution stays visible on the map. Offline HTML exports embed precinct data,
but do not download or embed basemap tiles.

The supplied HTML **does not contain precinct vote counts yet**. Clarity's detailed results
are converted by the script below on your computer. **Do not publish a filled precinct map
until the generated manifest has been checked** against the report and its timestamp.

## Data pipeline

```text
Clarity detailxml.zip (preferred) or detailxlsx.zip (fallback)
                │
                ▼
scripts/build_results.py      streamed XML/XLSX -> precinct, race, candidate, method
                │
                ├── data/precinct_results_manifest.json  (diagnostics/reconciliation)
                ▼
data/precinct_results_2026.json.gz  (compact integer-array rows)
                │
                ▼
scripts/embed_results.py      gzip bytes -> base64 script block
                │
                ▼
dist/index.html               embedded geometry + vote data, optional online basemap
```

## Quick start

From `~/git/ai-experiments/tarrant-2026`:

```bash
# Downloads the Clarity structured XML feed if the provider offers it;
# otherwise tries the linked detailxlsx.zip report. Both are cached.
uv run python scripts/build_results.py --inspect

# Verify data/precinct_results_manifest.json and its unmatched-cell counts.
# Once verified, package the vote rows into a standalone HTML file:
uv run python scripts/embed_results.py
open dist/index.html
```

If you already downloaded the archive to your Mac, skip network access:

```bash
uv run python scripts/build_results.py --source ~/Downloads/detailxlsx.zip --inspect
uv run python scripts/embed_results.py
open dist/index.html
```

If it is a very large archive, leave the ZIP under `data/source/` and pass its path;
we never copy the full XML into the HTML. For repeat builds, the original ZIP is cached.

### What the parser expects

1. **Clarity structured detail XML**: `ElectionResult → Contest → Choice → VoteType → Precinct`,
   as documented by the OpenElections Clarify project.
2. **SpreadsheetML XML or XLSX**: a tabular sheet with explicit columns for
   `precinct`, `contest`/`race`, `candidate`, and either `votes` + `method`,
   or `total`, `mail`, `early`, `day` columns.

If the XLSX is a *formatted, cross-tabbed report*, rather than a tabular sheet,
`build_results.py` refuses to fabricate matches. It records initial worksheet
rows and unmatched names in `data/precinct_results_manifest.json` to help create
an exact adapter for that specific export. **Upload the actual ZIP if this happens.**

The converter deliberately matches candidate names and dashboard contest titles
conservatively, excludes unrelated races and non-geographic totals, and rejects
duplicate precinct/candidate/method combinations to avoid double counting.
It only generates the compact file when at least one precinct result matches.

## Compact file format

Each array is:

```json
["4050", 7, 1, 120, 12, 90, 18]
```

The example above is **illustrative, not a real precinct tally**. Positions are
`[precinct, contest_id, candidate_index, total, mail, early, election_day]`.
Nullable vote-method counts remain `null` when unknown; zero is a reported zero.
The `.json.gz` also contains `schema`, `source`, and `rows` fields.
`gzip` removes repeated JSON structure, while candidate and contest names remain
in the HTML's existing embedded election metadata.

Alternatively, without rebuilding the page, **Load precinct vote totals** accepts
CSV, JSON, or the generated `.json.gz`. Once imported, use **Save offline HTML**;
that export also gzip-compresses rows inside the HTML.

## Validation and interpretation

- `data/precinct_results_manifest.json` reports accepted cells, unmatched
  precincts/contests/candidates, geographic coverage, and a sample of differences
  between aggregated precinct counts and the dashboard's older countywide snapshot.
- The existing headline/race tables are from the **Nov 4, 2026, 2:37 a.m.**
  cumulative snapshot. The detailed source may be **newer**. Do not assume
  those two report timestamps match. The new data only powers the precinct explorer.
- TopoJSON boundaries are from the **2026 primary precinct** file. Validate
  identifiers against the general-election report; if boundaries changed, reconcile
  them before interpreting the map.
- No votes are estimated or assigned from geography or voter history.
- Source archives are retained under `data/source/` and excluded from Git by default.
- The built `dist/index.html` needs **no server, external JS, libraries, or API keys**.
  The browser uses native `DecompressionStream` for the embedded gzipped vote rows.

## Source references

- [Tarrant County November 3, 2026 election reports](https://www.tarrantcountytx.gov/en/elections/past-election-information/2026-archives/november-3--2026--joint-general-and-special-election-results.html)
- [Clarity XLSX detail ZIP supplied for this project](https://results.enr.clarityelections.com/TX/Tarrant/127297/385548/reports/detailxlsx.zip)
- [OpenElections Clarify XML parser/schema](https://github.com/openelections/clarify)
- [Texas Legislative Council precinct GIS](https://data.capitol.texas.gov/dataset/precincts)

## Tests

```bash
uv run python -m unittest discover -s tests -v
```

Tests use synthetic precinct tallies and never ship those figures in `index.html`.
