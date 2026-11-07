# Texas school district finances

`index.html` is one self-contained page (no external scripts, about 1.9 MB with the data inlined). Open it directly. Add `#<TEA district number>` to the URL to open on a district, for example `#101912` for Houston ISD.

It covers every Texas independent school district on the same measures, and with the same fund and program categories, as the [Fort Worth ISD](../fwisd-budget-opus-5.5-high/) and [Tarrant County](../tarrant-isd-compare-opus-5.5-high/) explorers.

## What's in it

- **Revenue over time:** revenue by level of government and federal money by program, FY2011–FY2025. You can show it for Texas, for the peer group or for the chosen district.
- **County map:** nine measures. Federal share, revenue per student, USDA meals per student, COVID relief per student, free-rate meal share, the change in free-rate share for 2025-26, enrollment change, recapture paid per student, and the estimated net recapture flow per student.
- **Peer comparisons:** pick a district and compare it with its county, its education service region, districts of similar size, or all of Texas. The comparisons cover:
  - revenue by level;
  - federal share over time;
  - federal programs;
  - school meals;
  - spending by function;
  - enrollment.
- **Long groups:** they show the top, the bottom, and the districts ranked near the chosen one.
- **School meals:**
  - the free-rate share in 2024-25 and 2025-26;
  - the largest drops statewide, with changes in CEP status;
  - USDA reimbursement for months claimed in both years;
  - trends since 2015-16.
- **Recapture ("Robin Hood"):**
  - statewide recapture paid, FY2011–FY2027;
  - the selected district's and county's payments, estimated share and net;
  - the districts or counties that pay the most and that gain the most, as totals or per student.
- **A table of all districts** that you can sort and filter.

## Main findings

- **Revenue:** $85.3B in FY2025 across 1,019 ISDs with 5.09 million students, or $16,741 per student.
- **Federal share:** 8.8% of revenue in FY2025, down from 17.1% in FY2022. COVID relief totaled $15.2B over FY2020–25.
  - Federal money matters most along the border (Webb 16.2%, Hidalgo 15.8%, El Paso 14.0%, Cameron 13.8%) and in Bell County (15.0%, Killeen's military-connected students).
  - It matters least in the fast-growing suburbs: Collin 3.4%, Rockwall 3.6%, Williamson 3.7%.
- **School meals, 2025-26:** statewide, almost nothing changed.
  - The free-rate share went from 64.7% to 64.4%.
  - School-year USDA reimbursement rose 1.0% ($2.54B to $2.57B, months claimed in both years).
  - Only 17 of 503 districts with 1,000+ students lost 5 points or more.
- **Fort Worth's drop is the outlier statewide:** 93.6% to 79.9%, $5.9M, the largest dollar drop in Texas. Houston is next at $2.0M (−1.8%).
- **CEP changes:** 10 districts moved most of their schools off CEP, and 28 moved most onto it.
  - The steepest drops in free-rate share come from leaving CEP. For example, Huffman ISD went from 94% to 41%.

- **Recapture:** districts paid $2.96B in FY2025, about 6% of all local revenue. That's down from a $4.53B peak in FY2023, and TEA puts FY2026 at $2.49B (near-final) and FY2027 at $2.18B (preliminary).
  - Austin ISD pays by far the most: $770M in FY2025, a quarter of the statewide total.
  - Next come Pecos-Barstow-Toyah ($198M), Plano ($136M), Wink-Loving ($123M) and Eanes ($93M).
- **Net recapture flow by county:** most counties come out ahead under the estimate. The sending counties are the oil-rich Permian Basin and Eagle Ford counties, plus Travis, Midland and Collin.
  - Tarrant County gains about $98M (+$300 per student), even though 16 of its districts include payers such as Carroll and Fort Worth.
  - Fort Worth ISD itself paid $5.2M (on its enrichment tax pennies) and gets back an estimated $38M.

## Rebuilding

```bash
build/fetch.sh /tmp/tx-raw
python3 build/build_data.py /tmp/tx-raw index.html
```

`fetch.sh` downloads:
- about 400 MB of statewide TEA zips (reusing any already in `RAW/zip`);
- the TEA enrollment summary;
- TEA's recapture-paid-by-district file;
- county outlines;
- TDA meal claims, summarized on data.texas.gov as October site rows plus monthly totals per entity, about 20 MB in all.

`build_data.py` streams the zips in parallel, which takes about 20 seconds.

## Caveats

- Fiscal years end June 30 (FY2025 = 2024-25). Amounts are stored rounded to $1,000.
- Charter schools (about 435,000 students) aren't in TEA's district actual-financial files, so they're left out.
- Bond proceeds, refundings and transfers between funds aren't revenue. Debt and construction spending swings with bond programs.
- Very small, property-rich districts can reach $50,000–$80,000 per student. Bar charts are scaled to the 95th percentile of each group, and bars that run past it fade out.
- Each district counts toward its home county on the map, though some cross county lines.
- Meal claims are matched to districts by county-district number, or by name before 2018-19.
  - About 20 districts have no claims of their own: they aren't in the National School Lunch Program (Carroll, Highland Park) or they claim through a cooperative.
  - 2020-21 and 2021-22 are left out because of the universal free-meal waivers.
- **Recapture paid** comes from TEA's [recapture paid by district](https://tea.texas.gov/about-tea/state-funding/state-funding-reports-and-data/recapture-paid-by-district.xlsx) file. It agrees with the Chapter 49 payments in district books (General Fund, function 91, mostly object 6224) to within about 1% a year.
- **What a district gets back from recapture is an estimate.** Each year's statewide recapture total is shared out in proportion to each district's Foundation School Program state aid (objects 5811 and 5812). The statewide net is zero by construction.
  - In practice the Legislature sets total state aid. Recapture lowers how much general revenue it has to put in, so no district's aid moves dollar for dollar with recapture.
- The "CEP" tag means every school in the district claimed no reduced-price students in October. CEP schools have none.
