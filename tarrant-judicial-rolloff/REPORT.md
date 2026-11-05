# Tarrant County judicial ballot skipping, 2010–2026

Nine November general elections. Historical results are official county reports; 2026 is an unofficial snapshot dated 11/4/2026 2:53:24 AM CST.

## Findings

Uncontested judicial races consistently receive fewer votes. In 2026, voters left 47.0% of countywide judicial ballot opportunities blank in uncontested races, versus 2.8% in contested races. For local trial courts alone, the figures are 47.2% and 3.4%. All 21 uncontested countywide judicial candidates in 2026 were Republicans.

The party pattern is strong, but it is longstanding. In every observed election, precincts with a larger opposing-party vote share have higher blank-vote rates in uncontested local trial races. The mean ballot-weighted within-race correlation ranges from 0.986 to 0.994 across elections using the primary benchmark. In 2026 it is 0.990. These are descriptive geographic relationships, not measurements of individual voter choices or anger.

The average unopposed Republican trial judge received 386,364 votes in 2026. That is 34.4% more than the Republican Senate candidate and 25.9% more than the Republican Governor candidate received on matching ballots. They receive votes beyond the Republican benchmark total; the excess can include Democratic, minor-party, or top-race nonvoters.

Raw trial-court skipping rose from 36.7% in 2024 to 47.2% in 2026. Using the Senate benchmark in both years, the average fitted skip rate at a precinct with 50% opposing-party two-party support rose from 36.6% to 38.7%. That descriptive adjustment suggests much of the raw increase accompanies the electorate’s partisan shift. Different judges, turnout, ballot position, and precinct populations prevent a causal interpretation.

**Conclusion:** The evidence supports party-related skipping of unopposed judges. It does not establish that anger caused the skipping, or that 2026 represents an exceptional protest against judges.

## Election-by-election comparison

Countywide judiciary means trial courts and appellate courts appearing across the county, using Tarrant votes only. Justices of the peace and the County Judge executive office are reported separately in the HTML and CSVs. Rates below are blank votes divided by eligible ballot opportunities, pooled across races. Each race creates a separate opportunity; these are not counts of distinct people.

| Year | Main benchmark | Benchmark named votes | Judicial races voted | All judges blank | Contested blank | Uncontested blank | Uncontested votes retained vs benchmark |
|---|---|---:|---:|---:|---:|---:|---:|
| 2010 | Governor | 347,489 | 41 | 30.2% | 10.4% | 36.6% | 64.2% |
| 2012 | President | 610,890 | 22 | 33.8% | 20.0% | 39.0% | 61.8% |
| 2014 | U.S. Senate | 367,270 | 39 | 32.3% | 10.6% | 38.8% | 62.7% |
| 2016 | President | 668,514 | 20 | 26.7% | 3.7% | 39.1% | 62.2% |
| 2018 | U.S. Senate | 627,894 | 42 | 35.2% | 5.8% | 43.3% | 57.1% |
| 2020 | President | 834,697 | 22 | 9.5% | 3.8% | 35.3% | 65.0% |
| 2022 | Governor | 591,368 | 15 | 2.1% | 2.1% | n.a. | n.a. |
| 2024 | President | 823,312 | 23 | 23.5% | 3.7% | 36.3% | 64.1% |
| 2026 | U.S. Senate | 728,630 | 44 | 23.9% | 2.8% | 47.0% | 53.4% |

“Contested” means two or more named candidates, including declared write-ins. Some older contested appellate races had no Democratic nominee. Use the HTML’s “R–D contested” view to restrict the comparison to races with both major parties.

## Rules that interrupt the trend

- Straight-ticket voting was available through 2018 and ended in 2020. A party selection could previously record votes for multiple judges. Comparing before and after 2020 does not hold the voting process constant. [Texas SOS advisory](https://www.sos.state.tx.us/elections/laws/advisory2020-29.shtml).
- In 2022, 29 judicial offices serving Tarrant County were declared elected without a vote: 23 local trial seats, one statewide appellate seat, and five JP seats. They are listed in `data/declared_elected_2022.csv`. Their participation is unavailable, not zero and not 100% skipped. [County archive and certifications](https://www.tarrantcountytx.gov/en/elections/past-election-information/2022-archives/november-8-2022--joint-general-and-special-election-results.html).
- The declaration rule was repealed before 2024, restoring votes in unopposed state/county races. [Texas SOS advisory](https://www.sos.texas.gov/elections/laws/advisory2024-26.shtml).

## Measurement and limitations

The primary benchmark hierarchy is President, then U.S. Senate, then Governor. All available Senate/Governor alternatives are preserved. Judicial votes are compared with benchmark votes in exactly the same reporting units and on the same eligible ballots. This excludes federal-only limited ballots from local comparisons. Candidate-level repeated ballot and undervote totals are counted once per contest/reporting unit. Named votes exclude rejected/unassigned write-in accounting buckets. Named write-in candidates count as opposition even if they received no votes.

Blank rate = reported undervotes / eligible ballots. Retention = judicial named-candidate votes / benchmark votes on matching ballots. Rolloff = 1 − retention. Retention and blank rate use different denominators and need not sum to 100%. Summary rates pool ballot opportunities, rather than adding candidates across races and comparing that sum to a single top race.

Precinct analysis combines splits within the same election and fits a ballot-weighted descriptive line separately for each uncontested race and benchmark, retaining precincts with at least 100 ballots and 50 Republican-plus-Democratic benchmark votes. Opposing-party share uses R+D votes only. Reported mean correlations and fitted rates average the race-level estimates, without treating races as independent observations. Precincts are not joined across years.

All 324 analyzed contest totals were independently matched to the named-candidate cast-vote totals in the county’s cumulative PDFs. The 2026 CSV/XML Senate blank-vote total (3,496) differs from the PDF (4,655), although named-candidate vote totals agree. Other small accounting residuals are retained in `contests.csv`; no residual is silently reclassified as a skipped vote. The 2026 results are unofficial. The 2018 JP Precinct 6 export has a −1 ballot accounting residual.

Every observed unopposed countywide judicial candidate in this period was Republican, so an equivalent comparison with Democratic countywide judges is unavailable. Democratic JP races cover different electorates. Countywide totals and precinct patterns cannot link a person’s top-of-ticket vote to a blank judicial choice. A ballot-level CVR analysis could measure that joint behavior directly, but still could not establish anger without other evidence. The [county ballot verifier](https://ballotverifier.tarrantcountytx.gov/search) is the next source to investigate for recent elections.

## Historical data access

The [county election archive](https://www.tarrantcountytx.gov/en/elections/past-election-information.html) links each year’s November election. “Tally Export formatted in comma-delimited text” provides 2010–2022 CSV-formatted text and a ZIP containing CSV for 2024. The 2026 county tally ZIP was a placeholder when downloaded. For that year, Clarity’s `current_ver.txt` resolved to version 385548, whose `reports/summary.zip` contains `summary.csv` and whose `reports/detailxml.zip` supplies precinct results. Exact URLs, retrieval timestamps, and SHA-256 hashes are in `data/sources.json`.

See the interactive HTML report for every race, party, benchmark comparison, precinct scatterplot, source links, and downloadable CSVs.
