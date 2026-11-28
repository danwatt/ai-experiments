"""Build an offline HTML research report and concise Markdown companion."""
from pathlib import Path
import json
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]

def main():
    data=json.loads((ROOT/'outputs/report-data.json').read_text())
    template=(ROOT/'report-template.html').read_text()
    # All report data is embedded so the report works from disk, with no network calls.
    html=template.replace('__REPORT_DATA__',json.dumps(data,separators=(',',':')).replace('</','<\\/'))
    (ROOT/'index.html').write_text(html)
    summary=pd.DataFrame(data['year_summary'])
    contests=pd.DataFrame(data['contests'])
    comparison=pd.DataFrame(data['comparisons'])
    lines=['# Tarrant County judicial ballot skipping, 2010–2026','',
           'Nine November general elections. Historical results are official county reports; 2026 is an unofficial snapshot dated '+data['snapshot']+'.','',
           '## Findings','',
           'Uncontested judicial races consistently receive fewer votes. In 2026, voters left 47.0% of countywide judicial ballot opportunities blank in uncontested races, versus 2.8% in contested races. For local trial courts alone, the figures are 47.2% and 3.4%. All 21 uncontested countywide judicial candidates in 2026 were Republicans.','',
           'The party pattern is strong, but it is longstanding. In every observed election, precincts with a larger opposing-party vote share have higher blank-vote rates in uncontested local trial races. The mean ballot-weighted within-race correlation ranges from 0.986 to 0.994 across elections using the primary benchmark. In 2026 it is 0.990. These are descriptive geographic relationships, not measurements of individual voter choices or anger.','',
           'The average unopposed Republican trial judge received 386,364 votes in 2026. That is 34.4% more than the Republican Senate candidate and 25.9% more than the Republican Governor candidate received on matching ballots. They receive votes beyond the Republican benchmark total; the excess can include Democratic, minor-party, or top-race nonvoters.','',
           'Raw trial-court skipping rose from 36.7% in 2024 to 47.2% in 2026. Using the Senate benchmark in both years, the average fitted skip rate at a precinct with 50% opposing-party two-party support rose from 36.6% to 38.7%. That descriptive adjustment suggests much of the raw increase accompanies the electorate’s partisan shift. Different judges, turnout, ballot position, and precinct populations prevent a causal interpretation.','',
           '**Conclusion:** The evidence supports party-related skipping of unopposed judges. It does not establish that anger caused the skipping, or that 2026 represents an exceptional protest against judges.','',
           '## Election-by-election comparison','',
           'Countywide judiciary means trial courts and appellate courts appearing across the county, using Tarrant votes only. Justices of the peace and the County Judge executive office are reported separately in the HTML and CSVs. Rates below are blank votes divided by eligible ballot opportunities, pooled across races. Each race creates a separate opportunity; these are not counts of distinct people.','',
           '| Year | Main benchmark | Benchmark named votes | Judicial races voted | All judges blank | Contested blank | Uncontested blank | Uncontested votes retained vs benchmark |',
           '|---|---|---:|---:|---:|---:|---:|---:|']
    pct=lambda x:'n.a.' if pd.isna(x) else f'{100*x:.1f}%'
    for year in range(2010,2027,2):
        g=summary[(summary.year==year)&summary.primary_benchmark&(summary.scope=='Countywide judiciary')].set_index('status')
        bm=g.iloc[0].benchmark
        base=contests[(contests.year==year)&(contests.benchmark==bm)].iloc[0]
        lines.append(f'| {year} | {bm} | {int(base.named_candidate_votes):,} | {int(g.loc["All","race_count"])} | {pct(g.loc["All","skip_rate"])} | {pct(g.loc["Contested","skip_rate"])} | {pct(g.loc["Uncontested","skip_rate"])} | {pct(g.loc["Uncontested","retention_vs_benchmark"])} |')
    lines += ['', '“Contested” means two or more named candidates, including declared write-ins. Some older contested appellate races had no Democratic nominee. Use the HTML’s “R–D contested” view to restrict the comparison to races with both major parties.','',
              '## Rules that interrupt the trend','',
              '- Straight-ticket voting was available through 2018 and ended in 2020. A party selection could previously record votes for multiple judges. Comparing before and after 2020 does not hold the voting process constant. [Texas SOS advisory](https://www.sos.state.tx.us/elections/laws/advisory2020-29.shtml).',
              '- In 2022, 29 judicial offices serving Tarrant County were declared elected without a vote: 23 local trial seats, one statewide appellate seat, and five JP seats. They are listed in `data/declared_elected_2022.csv`. Their participation is unavailable, not zero and not 100% skipped. [County archive and certifications](https://www.tarrantcountytx.gov/en/elections/past-election-information/2022-archives/november-8-2022--joint-general-and-special-election-results.html).',
              '- The declaration rule was repealed before 2024, restoring votes in unopposed state/county races. [Texas SOS advisory](https://www.sos.texas.gov/elections/laws/advisory2024-26.shtml).','',
              '## Measurement and limitations','',
              'The primary benchmark hierarchy is President, then U.S. Senate, then Governor. All available Senate/Governor alternatives are preserved. Judicial votes are compared with benchmark votes in exactly the same reporting units and on the same eligible ballots. This excludes federal-only limited ballots from local comparisons. Candidate-level repeated ballot and undervote totals are counted once per contest/reporting unit. Named votes exclude rejected/unassigned write-in accounting buckets. Named write-in candidates count as opposition even if they received no votes.','',
              'Blank rate = reported undervotes / eligible ballots. Retention = judicial named-candidate votes / benchmark votes on matching ballots. Rolloff = 1 − retention. Retention and blank rate use different denominators and need not sum to 100%. Summary rates pool ballot opportunities, rather than adding candidates across races and comparing that sum to a single top race.','',
              'Precinct analysis combines splits within the same election and fits a ballot-weighted descriptive line separately for each uncontested race and benchmark, retaining precincts with at least 100 ballots and 50 Republican-plus-Democratic benchmark votes. Opposing-party share uses R+D votes only. Reported mean correlations and fitted rates average the race-level estimates, without treating races as independent observations. Precincts are not joined across years.','',
              'All 324 analyzed contest totals were independently matched to the named-candidate cast-vote totals in the county’s cumulative PDFs. The 2026 CSV/XML Senate blank-vote total (3,496) differs from the PDF (4,655), although named-candidate vote totals agree. Other small accounting residuals are retained in `contests.csv`; no residual is silently reclassified as a skipped vote. The 2026 results are unofficial. The 2018 JP Precinct 6 export has a −1 ballot accounting residual.','',
              'Every observed unopposed countywide judicial candidate in this period was Republican, so an equivalent comparison with Democratic countywide judges is unavailable. Democratic JP races cover different electorates. Countywide totals and precinct patterns cannot link a person’s top-of-ticket vote to a blank judicial choice. A ballot-level CVR analysis could measure that joint behavior directly, but still could not establish anger without other evidence. The [county ballot verifier](https://ballotverifier.tarrantcountytx.gov/search) is the next source to investigate for recent elections.','',
              '## Historical data access','',
              'The [county election archive](https://www.tarrantcountytx.gov/en/elections/past-election-information.html) links each year’s November election. “Tally Export formatted in comma-delimited text” provides 2010–2022 CSV-formatted text and a ZIP containing CSV for 2024. The 2026 county tally ZIP was a placeholder when downloaded. For that year, Clarity’s `current_ver.txt` resolved to version 385548, whose `reports/summary.zip` contains `summary.csv` and whose `reports/detailxml.zip` supplies precinct results. Exact URLs, retrieval timestamps, and SHA-256 hashes are in `data/sources.json`.','',
              'See the interactive HTML report for every race, party, benchmark comparison, precinct scatterplot, source links, and downloadable CSVs.']
    (ROOT/'REPORT.md').write_text('\n'.join(lines)+'\n')
    print('Built index.html and REPORT.md')

if __name__=='__main__':main()
