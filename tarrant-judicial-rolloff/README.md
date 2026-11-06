# Tarrant County judicial ballot skipping, 2010–2026

A self-contained research report covering all nine even-year November general elections in the requested 16-year period. Open `index.html` directly; it embeds its data and uses no network services or external libraries. `REPORT.md` is the written version.

The report compares President, U.S. Senate, and Governor votes with all judicial races, contested races, and uncontested races. It includes every voted judicial contest, an election summary, precinct-level party associations, source links, CSV downloads, and explicit treatment of the 2022 offices declared elected without a vote.

## Main findings

- In the unofficial 2026 snapshot, 47.0% of uncontested countywide judicial ballot opportunities were blank, versus 2.8% of contested opportunities. All 21 unopposed countywide judicial candidates were Republican.
- Higher opposing-party precinct support is closely associated with more skipping throughout the period. This is consistent with partisan selection, but aggregate results cannot establish voter anger or identify individual behavior.
- Unopposed Republican trial judges averaged 386,364 votes in 2026, exceeding the matching Republican Senate and Governor vote by 34.4% and 25.9%, respectively.
- Comparability changes when straight-ticket voting ends in 2020. In 2022, 29 judicial offices were declared elected with no vote to measure. This rule was repealed before 2024.

## Reproduce

Python 3.11+ and Poppler’s `pdftotext` are required. Install the dependencies listed in `requirements.txt` in your preferred environment, then run from this directory:

```sh
python3 scripts/fetch_sources.py
python3 scripts/analyze.py
python3 scripts/verify.py
python3 scripts/build_report.py
```

Downloads are cached per election. To fetch a newer 2026 snapshot use `python3 scripts/fetch_sources.py --refresh 2026`, then rerun analysis, verification, and report generation. **The narrative findings in `scripts/build_report.py` and `report-template.html` describe the saved November 4 snapshot and require editorial review after a refresh.** Tables and charts derive from the embedded data.

## Sources and outputs

- `data/sources.json`: exact county archive, tally, PDF, and Clarity URLs; retrieval timestamps; original download hashes. The 2026 Clarity version is frozen at 385548, timestamp November 4, 2026, 2:53:24 a.m. CST. Its county cumulative PDF is unofficial, timestamped 2:37 a.m.
- `data/raw/` (not committed; recreate with `python3 scripts/fetch_sources.py`): compressed original tally text, original cumulative PDFs, 2026 Clarity ZIPs, and the two 2022 declaration certifications. CSV-formatted historical text is compressed losslessly to keep the experiment smaller.
- `data/declared_elected_2022.csv`: 29 offices with no vote held, transcribed from the county and state certifications. They are excluded from voted-race denominators and never treated as zero participation.
- `outputs/year_summary.csv.zip`: summary by election, benchmark, court scope, and contest status.
- `outputs/contests.csv.zip`: 324 judicial/executive/benchmark contests, with candidate names, eligibility, votes, blanks, and ballot-accounting residuals.
- `outputs/candidates.csv.zip`: individual candidate totals, including identified write-in accounting buckets.
- `outputs/comparisons.csv.zip`: each judicial/executive contest against each available benchmark, matching reporting units and eligibility exactly.
- `outputs/precinct_uncontested.csv.zip`: race-by-precinct observations used for party analysis, after the stated minimum-size filter.
- `outputs/precinct_relationships.csv.zip`: descriptive weighted correlations, slopes, intercepts, and fitted rates at 50% opposing-party support for each race/benchmark.
- `outputs/verification.csv.zip`: all 324 named-candidate vote totals independently checked against the separately published cumulative PDFs.

## Important distinctions

The main scope includes countywide trial and appellate races, using Tarrant votes only. The County Judge executive office and subcounty justices of the peace have their own views. “Contested” means two or more named candidates; a separate R–D group requires both major parties. A named write-in counts as opposition even with zero votes; rejected/unassigned buckets do not.

Blank rate is reported undervotes / eligible ballots. Retention is named judicial votes / named benchmark votes on matching ballots. Rejected/unassigned write-ins are excluded from both named-vote measures and preserved separately for accounting. Rates pool separate ballot opportunities across races, not unique voters. They do not imply that the same person skipped all the races.

Repeated candidate-level ballot and undervote fields are counted only once per contest and reporting unit. Precinct splits are aggregated within a year; precincts are not matched across years. Every judicial unit must match a benchmark unit with the same eligible ballot count. Ballot-weighted precinct models are descriptive; races share many of the same voters and are not treated as independent samples.

Some source accounting fields differ: 2026 Senate CSV/XML blanks differ from the PDF by 1,159 despite matching named-candidate totals; other 2026 contests have smaller residuals. One 2018 JP contest has a −1 residual. All differences are retained. No unexplained residual becomes an inferred skipped vote. See the report for details.
