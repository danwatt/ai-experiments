# Resuming the Texas old-map reconstruction

Last handoff: **November 5, 2026**. Read [README.md](README.md) for the method and
[report.html](report.html) for the current results. These notes record the state of
collection on that date; they do not claim that the missing files are unpublished.

## Preserve the user's choices

- Analyze **November 2026 U.S. House votes only**.
- Estimate the division of votes within precincts cut by old congressional boundaries,
  clearly label estimates, and test sensitivity in close seats.
- **Leave districts missing usable major-party precinct returns pending.** Do not run
  the optional `--model-missing-counties` mode or substitute historical election votes.
- Reaggregate party votes. Different new districts had different candidate slates, so
  an old-map party lead is not a hypothetical victory for a named candidate.

No recurring download or reminder has been scheduled. This is a manual resumption guide.

## Baseline to compare with later updates

- Old plan: **PLANC2193**. New plan: **PLANC2333**.
- State feed election ID: **53815**, downloaded version **enr/53815/117/**.
- Unofficial observed House votes: **9,780,054**; new-map leads: **24 R / 14 D**.
- All county candidate totals reconcile exactly to the state totals for all 38 districts.
- Precinct sources downloaded: Bastrop, Bexar, Denton, Harris, Tarrant, Travis, Williamson.
- Eight old districts have reportable provisional estimates: **10, 12, 18, 19, 27, 29,
  37, 38**. The other **30 remain pending**. No statewide old-map seat count is available.
- Split-precinct allocation puts **6,236,936** votes in old districts; **3,543,118** votes
  remain unallocated. Every allocation scenario conserves their combined total.

## Highest-value collection queue

This table counts **major-party votes in county/new-district cells that span multiple
old districts**. It is not a count of all votes in each county. An affected old district
can also need data from other counties. Recompute this queue from `retabulation_units.csv`
after updating sources.

| County | Votes needing finer returns | Potential old districts affected |
|---|---:|---|
| Dallas | 770,973 | 5, 6, 24, 30, 32, 33 |
| Bexar | 643,511 | 20, 21, 23, 28, 35 |
| Collin | 435,709 | 3, 4, 32 |
| Fort Bend | 267,646 | 7, 9, 22 |
| Montgomery | 256,425 | 2, 8 |
| El Paso | 215,031 | 16, 23 |
| Hidalgo | 200,266 | 15, 34 |
| Brazoria | 140,570 | 9, 14, 22 |
| Hays | 117,816 | 21, 35 |
| Bell | 97,677 | 11, 31 |
| Comal | 88,524 | 21, 35 |
| Jefferson | 71,885 | 14, 36 |
| Guadalupe | 69,612 | 15, 28 |
| Johnson | 44,448 | 6, 25 |
| Wise | 30,440 | 13, 26 |
| Bowie | 27,388 | 1, 4 |
| Walker | 21,217 | 8, 17 |
| Upshur | 15,440 | 1, 5 |
| Hunt | 11,366 | 3, 4 |
| Freestone | 7,291 | 6, 17 |
| Red River | 4,220 | 1, 4 |

`remaining_county_work.csv` is a different, broader queue: its conservative geometric
bounds include split precincts already handled by the estimation model. Do not treat
every entry in that file as a county with missing returns.

## Where to check in coming days and weeks

1. **County election offices:** look for precinct returns, statement of votes cast,
   canvass reports, or certified results. Prefer structured CSV/XML/XLSX exports; a PDF
   may require another parser. Need candidate votes by **residential voting precinct**,
   preferably with ballot-style/subprecinct detail. Vote-center turnout and voter
   participation rosters cannot substitute for candidate vote totals.
2. **Texas Legislative Council:** check its [elections catalog](https://data.capitol.texas.gov/topic/elections)
   and [election-data description](https://data.capitol.texas.gov/topic/about/elections)
   for a 2026 general-election precinct/VTD dataset. On November 5 the published catalog
   used in this project stopped at 2024 election data. A later statewide compilation
   could replace much of the county-by-county collection.
3. **November precinct geography:** check the [precinct dataset](https://data.capitol.texas.gov/dataset/precincts)
   for `Precincts26G.zip` or another general-election vintage. The current analysis uses
   **Precincts26P**, the primary map. Check county maps/crosswalks if statewide November
   geography is not available.
4. **State return revisions/certification:** revisit the [Secretary of State results](https://goelect.txelections.civixapps.com/ivis-enr-ui/races)
   and its [historical results directory](https://www.sos.state.tx.us/elections/historical/index.shtml).
   Reconcile new precinct files to the appropriate county/state snapshot; a newer
   retrieval date does not imply the source's counts changed.

Useful county entry points already found:

- [Dallas November 2026 page](https://www.dallascountyvotes.org/election-results/historical/november-3-2026-general-and-joint-election/)
  — earlier attempts returned access errors or an empty response. Retry through the
  county's visible results navigation if direct downloading still fails.
- [Collin results](https://www.collincountytx.gov/Elections/election-results) — search
  results exposed a November 2026 **precinct results report**, but it was not downloaded
  or parsed in this run. This is a known collection lead, not necessarily missing publication.
- [Bexar official election links](https://gov.bexar.org/) — the report already downloaded
  is very close to the state snapshot; a revised precinct file may unlock multiple districts.
- [Harris results](https://app.harrisvotes.com/electionresults/electionday)
- [Tarrant November 2026 sources](https://www.tarrantcountytx.gov/en/elections/past-election-information/2026-archives/november-3--2026--joint-general-and-special-election-results.html)
- [Travis results directory](https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/)

## Known reconciliation and geography issues

- **Bexar:** downloaded Clarity election **127291**, version **385501**, timestamp
  November 4, 1:30:04 a.m. CST. Its House major-party totals are collectively **105 votes
  below** the state county snapshot, across districts 20, 21, 23, and 35. Those party cells
  are excluded from precinct-level use. The independently reconciled minor-party cell
  does not establish that the county's R/D data are ready.
- **Bastrop:** district 27 write-in total is 48 votes above the state snapshot.
- **Travis:** district 27 write-in total is 23 votes above the state snapshot.
- **412 votes** have labels absent from the precinct shapefile, including F99 suffixes.
  Find an official explanation/crosswalk or finer returns; do not simply remove suffixes.
- **79 accepted votes** conflict with the primary precinct/new-district geometry.
  Inspect `incompatible_precinct_geometry.csv` against November maps before resolving them.
- Numeric leading-zero differences are already normalized **within county**. Preserve
  original labels and reject ambiguous identifier matches.
- Tiny positive polygon overlaps remain in the conservative bounds. These may be
  boundary precision artifacts; large bound widths are not statistical error estimates.

See `data/processed/precinct_source_reconciliation.csv` for the exact cells and source
timestamps, and the unmatched-label/geometry diagnostic CSVs for individual records.

## Downloader and parser limitations to address

- `fetch_sources.py` caches files. Without `--refresh`, mutable state feeds, county
  indexes, and version pointers can remain stale.
- **Tarrant is pinned** to election **127297**, version **385548**. Even `--refresh`
  re-downloads that same version. Check the vendor's `current_ver.txt` and update the
  source/version handling before claiming Tarrant has been refreshed.
- The public Clarity county `elections.json` indexes were incomplete or stale for many
  counties, including counties with known current elections. A 404, empty index, or
  absent November entry does **not** establish that precinct results are unavailable.
  Follow links from county election pages rather than inventing election IDs.
- Existing adapters cover the downloaded Clarity XML and Harris JSON formats. New
  CSV/XLSX/PDF/vendor formats need explicit adapters and reconciliation before use.
- Merely saving a new file in `data/raw/` does not necessarily activate it in the pipeline.
  Check `precinct_returns()` in `scripts/analyze.py` and the accepted-cell diagnostics.
- The downloader recognizes `precincts26g.zip` if it appears, but **the analysis and
  population-weight code still explicitly read `precincts26p.zip`**. Update those
  references, provenance, and report labels when adopting November geography. Rebuild
  the geographic crosswalk; do not just relabel the old shapes.
- The HTML report builder and README include **snapshot-specific dates, counts, and
  narrative**, including the eight-district table and TX-38 discussion. Update these
  after a successful new run; regenerating HTML alone will not refresh all prose.
- The independent `theoelections.com` compilation's data downloads returned access
  errors during discovery. None of its estimates or vote data are used here.

## Safe refresh sequence

1. **Preserve this baseline first.** Archive the current `report.html`, README, these
   notes, `data/processed/`, and mutable raw election files **with their `.source.json`
   sidecars** into a dated snapshot. Static map/Census archives need not be duplicated.
   The refresh command overwrites cached mutable files and their retrieval metadata.
2. Check source pages, revised county versions, a statewide 2026 dataset, and November
   geography. Record every attempt, including failed URLs and source timestamps.
3. Download newly available sources and add/update adapters as necessary. Avoid mixing
   election years, primary/general returns, or polling-place and residential-precinct data.
4. From this project directory, the existing broad refresh/rebuild commands are:

   ```sh
   rtk proxy .venv/bin/python scripts/fetch_sources.py --refresh --county-indexes
   rtk proxy .venv/bin/python scripts/analyze.py
   rtk proxy .venv/bin/python scripts/estimate.py
   rtk proxy .venv/bin/python scripts/build_report.py
   ```

   **Bandwidth note:** the broad refresh also re-downloads the approximately 389 MB
   Census block archive and other static inputs. A future selective “mutable sources
   only” refresh would be useful, but that option is not implemented. Fix the pinned
   Tarrant source separately. Do not pass `--model-missing-counties`.
5. Review reconciliation output. All state House candidate totals must equal their
   county sums. Use precinct detail only for matching county/district/party cells.
   Investigate revisions rather than forcing mismatches to disappear.
6. Check `estimate_vote_conservation.csv`: allocated plus unallocated votes must equal
   actual 2026 House votes in every scenario. Keep missing major-party districts pending.
7. Review close-seat sensitivity, primary/general geography, special precinct labels,
   and any new population-allocation fallbacks. Check source hashes and local downloads.
8. Update snapshot-specific report text, visually inspect the maps/table, and record
   what changed from this baseline: new sources, newly resolved districts, revised
   margins, and remaining gaps. Do not report a statewide seat effect before supported.

## Next-attempt log

Append an entry after each collection attempt, even when no new usable data is found.

```text
Attempt date/time (America/Chicago):
County/dataset:
Source page and exact download URL:
Election ID / version / source's own update time:
Retrieved filename / SHA-256 sidecar:
Outcome (downloaded / unchanged / inaccessible / not found):
Reconciliation differences and geographic vintage:
Adapter or crosswalk changes:
Newly resolved old districts / margin changes:
Remaining blocker and next lead:
```
