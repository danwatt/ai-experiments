# Tarrant County ISDs compared

`index.html` is one self-contained page (no external scripts, data inlined). Open it directly.

It compares the 16 independent school districts in Tarrant County on the same measures as the [Fort Worth ISD explorer](../fwisd-budget-opus-5.5-high/), using the same fund and program categories.

## What's in it

- **Revenue by level of government** for each district and year (FY2011–FY2025): local, state, federal and USDA school meals, as dollars or as a share of revenue.
- **Federal share over time**: every district as a gray line, the chosen district highlighted, and the county as a dashed line.
- **Federal money by program**: USDA meals, Title I, IDEA, COVID relief, Medicaid, the 2009 stimulus and other grants.
- **School meals**:
  - The share of students claimed at the free rate in 2024-25 and 2025-26.
  - USDA school-year reimbursement for the months each district claimed in both years.
  - The free-rate share since 2015-16.
  - USDA revenue per student.
- **Spending by function** as a shaded table, sorted by operating spending.
- **Enrollment**, indexed to FY2011.
- A data table.

You can show dollars as nominal or in fiscal-2026 dollars, and as totals or per student.

## Main findings

- **Revenue per student, FY2025:** it ran from $14,640 in Mansfield to $20,482 in Carroll. Fort Worth took in $16,678, 7th of 16.
- **Federal share, FY2025:** 8.1% countywide, down from a 16.5% peak in FY2022. The highest were Castleberry (14.3%), Fort Worth (11.3%) and Arlington (10.6%); the lowest were Grapevine-Colleyville (4.2%) and Carroll (2.1%).
- **Free-rate share, 2025-26:** Fort Worth's CEP claiming rate fell from 93.6% to 79.9%, and its school-year USDA reimbursement fell 15% ($38.7M to $32.7M). The other 14 districts in the program went up 1.1% together.
  - Everman, Lake Worth and Castleberry stayed at 100% free.
  - Crowley's free share rose 9 points.
- **Carroll ISD:** it isn't in the National School Lunch Program, so it has no USDA claims.
- **Enrollment:** Fort Worth fell about 14% from FY2011 to FY2025, while the county overall was nearly flat. That raises Fort Worth's per-student figures even when its budget doesn't grow.

## Rebuilding

```bash
build/fetch.sh /tmp/tarrant-raw
python3 build/build_data.py /tmp/tarrant-raw index.html
```

`fetch.sh` downloads about 400 MB of statewide TEA zips (it reuses any zips already in `RAW/zip`) and keeps the rows for districts 2209xx. It also downloads TDA claims for contracting entities 01017–01032, one year at a time.

## Caveats

- Fiscal years end June 30 (FY2025 = 2024-25).
- Districts book food service in different funds: enterprise fund 701, special revenue fund 240, General Fund-group fund 101 (Everman) or summer-feeding fund 242 (pandemic meals in Arlington and HEB). All four count as child nutrition here.
- Bond proceeds, refundings and transfers between funds aren't revenue.
- Debt and construction spending swing with bond programs. That's why the spending table sorts by operating spending.
- 2020-21 and 2021-22 meal claims are skipped. Universal free-meal waivers mean those October counts don't measure eligibility.
- The "CEP" tag means every school in the district claimed no reduced-price students in October. CEP schools have none.
- Only districts based in Tarrant County are included. Northwest, Aledo, Burleson and others that reach into the county aren't, and neither are charter schools.
