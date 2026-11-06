# Texas congressional maps: 2026 House vote reconstruction

Open **[report.html](report.html)** for the maps, results, caveats, and download links.

See **[FOLLOW_UP.md](FOLLOW_UP.md)** for the remaining county-data queue, known source
issues, and the steps for retrying downloads in coming days and weeks.

This is a **November 5, 2026 snapshot**, using **November 2026 U.S. House votes only**.
All returns are unofficial. It retabulates party votes geographically; it does not
predict which candidates would have run or how voters would have behaved under a
different map.

## What is ready

- Official shapefiles for the previous **PLANC2193** and the 2025 **PLANC2333** plans.
- Their complete 2020 Census-block equivalency files: **668,757 identical block IDs**.
- Official 2026 House candidate totals for **all 254 counties and all 38 districts**.
- Downloaded precinct returns for **Bastrop, Bexar, Denton, Harris, Tarrant, Travis,
  and Williamson**. Only reconciled county/district/party cells are used.
- The latest published statewide precinct geography, **2026 primary**, plus the
  2024 general vintage for reference.
- Census block geography and 2020 population/voting-age population for split-unit estimates.
- Auditable CSVs, vote-conservation checks, and a self-contained HTML report.

## Current result

The observed new-map House snapshot contains **9,780,054 votes**, with **24 Republican
and 14 Democratic district leads**.

Following the requested approach, **missing major-party precinct data is not modeled**.
There are **eight reportable provisional old-map estimates**:

| Old district | Estimated party lead | Estimated two-party margin |
|---|---|---:|
| 10 | Republican | R +9.03 |
| 12 | Republican | R +6.29 |
| 18 | Democratic | D +60.98 |
| 19 | Republican | R +38.97 |
| 27 | Republican | R +13.20 |
| 29 | Democratic | D +59.21 |
| 37 | Democratic | D +59.08 |
| 38 | Republican | R +4.76 |

**The other 30 old districts remain pending. There is no statewide old-map seat count.**
The 5 Republican / 3 Democratic leads above are an incomplete subset, not a projection
for the delegation. They cannot establish the redraw's statewide seat effect.

All eight retain the same leading party under voting-age-population, total-population,
and area allocations. Old TX-38 is the closest of the eight: approximately R +4.75
to R +4.76 across those scenarios. This is a sensitivity comparison, **not a confidence
interval**. It excludes other sources of error, including unverified November precinct
changes and the six-year gap between Census population and election turnout.

## How precincts enter the calculation

Congressional districts and voting precincts are different geographies. County officials
can change precincts independently of redistricting. A precinct may keep its shape and
change congressional district; it can also be split by the old map's boundaries.

1. Join both plans by **2020 Census block ID**, never by district number alone.
2. For each county/new-district reporting cell, identify the possible old districts.
   If there is only one, all that cell's votes can be assigned without a precinct model.
3. Where precinct returns are available, require their county/new-district/party sums
   to equal the state snapshot exactly. Other cells remain at county detail.
4. Normalize numeric precinct formatting within each county. Do not strip suffixes,
   match across counties, or assume an old precinct number identifies a current shape.
5. Intersect a reporting precinct with its actual new district and then the old map.
   Single-old-district pieces are assigned directly.
6. For split pieces, allocate each party's actual votes in proportion to Census
   voting-age population. Inhabited blocks are assigned to primary precincts by an
   interior point; official block files supply their old/new congressional districts.
   This treats the party vote as uniform within the reporting unit after population
   weighting. Total population and land area provide sensitivity scenarios.
7. Keep missing county detail unresolved. A district with missing major-party county
   detail remains pending even when the votes already located suggest a leader.

The model allocates **6,236,936** votes to old districts and retains **3,543,118** votes
without an allocation. Those figures sum to the actual statewide House count in every
scenario. Approximately **2,371 split-unit votes** use an area fallback because the
population crosswalk provides no applicable weight.

## Checks and limits

- Every state's-feed House candidate total equals the sum of its county rows.
- All 38 district major-party totals agree with the state's separate HTML summary.
- Each parsed precinct source is checked against its own choice/method totals.
- Each county/district/party cell must match the state snapshot to be used at precinct detail.
  Bexar's major-party totals do not yet match and stay unresolved. Minor-party and write-in
  label/snapshot differences in other counties are also retained as uncertainty.
- **412 votes** have unmatched precinct labels, including F99 suffixes. No geographic
  interpretation is invented for them.
- **79 accepted votes** conflict with the primary precinct/new-district geometry and
  are left unresolved.
- All positive old-map polygon overlaps are retained for conservative bounds, even tiny
  slivers. Bounds may therefore be much wider than plausible errors. They are not
  statistical intervals and district-specific maxima cannot be summed.
- The primary precinct map still needs confirmation against November boundaries.
- Census weights represent **2020 residents**, not 2026 voters. They cannot measure
  within-precinct party differences, new development, or turnout changes.
- No 2024 election vote is used in the 2026 reconstruction. The legislature's downloaded
  2024 two-plan comparison is reference material only.

## Files

| File | Content |
|---|---|
| `data/raw/planc2193.zip`, `planc2333.zip` | Original official district shapefiles |
| `data/raw/planc2193_blk.zip`, `planc2333_blk.zip` | Official block-to-district assignments |
| `data/raw/precincts26p.zip` | Latest published statewide precinct shapes; primary vintage |
| `data/raw/blocks.zip`, `blocks_pop.zip` | Census geography and demographic allocation weights |
| `data/processed/house_2026_county_candidates.csv` | All official county House candidate totals |
| `data/processed/house_2026_actual_districts.csv` | Observed new-map district totals |
| `data/processed/house_2026_old_map_estimates.csv` | Estimated old-map votes and explicit pending status |
| `data/processed/house_2026_old_map_bounds.csv` | Conservative geography-based vote envelopes |
| `data/processed/precinct_source_reconciliation.csv` | Source snapshot differences and cells accepted/rejected |
| `data/processed/accepted_house_precincts.csv` | Only precinct vote cells that match the state snapshot |
| `data/processed/retabulation_units.csv` | Each actual vote unit and possible old districts |
| `data/processed/estimated_vote_allocations.csv` | Fractional estimated assignments and fallback flags |
| `data/processed/estimate_vote_conservation.csv` | Actual = allocated + unallocated, for every scenario |
| `data/processed/remaining_county_work.csv` | Strict unresolved geography, including modeled splits |
| `data/raw/*.source.json` | Download URL, retrieval time, size, SHA-256 |

`PCTKEY` in the normalized analysis is `county-FIPS:precinct`, with numeric leading
zeroes removed from the precinct portion only. Original precinct labels are preserved.

## Reproduce

From this directory:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_sources.py --county-indexes
.venv/bin/python scripts/analyze.py
.venv/bin/python scripts/estimate.py
.venv/bin/python scripts/build_report.py
```

Existing sources are cached. `fetch_sources.py --refresh --county-indexes` re-downloads
mutable sources and can change the snapshot. County vendor indexes are incomplete;
failed/index-missing downloads are recorded, not interpreted as absence of results.
Some published county reports may require additional collection and parsers.

The population-weight cache is keyed to source hashes and the required precincts.
The large Census block shapefile is streamed rather than loaded into memory as one map.

The optional `--model-missing-counties` estimator mode is **not used in this report**;
it would impose a separate and much weaker within-county population-allocation model.

## Primary sources

- [Old congressional plan, PLANC2193](https://data.capitol.texas.gov/dataset/planc2193)
- [2025 congressional plan, PLANC2333](https://data.capitol.texas.gov/dataset/planc2333)
- [Texas redistricting plans in effect](https://redistricting.capitol.texas.gov/)
- [Texas precinct boundaries and vintage descriptions](https://data.capitol.texas.gov/dataset/precincts)
- [2020 Census geography and population](https://data.capitol.texas.gov/dataset/2020-census-geography)
- [Texas Secretary of State results](https://goelect.txelections.civixapps.com/ivis-enr-ui/races)
- [Separate state HTML summary](https://electionresults.sos.state.tx.us/results.html)
- [Tarrant County November 2026 sources](https://www.tarrantcountytx.gov/en/elections/past-election-information/2026-archives/november-3--2026--joint-general-and-special-election-results.html)
- [Harris County live results](https://app.harrisvotes.com/electionresults/electionday)
- [Travis County results directory](https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/)
- [Bexar County election links](https://gov.bexar.org/)

Discovery included an independent statewide precinct compilation, but its data downloads
were inaccessible. None of that compiler's estimates or vote data enter this report.
