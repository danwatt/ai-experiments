# Tarrant County schools

One page for the 16 independent school districts in Tarrant County, Texas, FY2011–FY2025, with school-meal claims through 2025-26. It merges three earlier pages and extends the school-level data from four districts to all 16.

`index.html` holds all the data (about 1.4 MB). The map loads [Leaflet](https://leafletjs.com/) from cdnjs and base-map tiles from Esri, so it needs an internet connection. Everything else works offline.

## Three views, one state

The district, the year and the dollar units (nominal or fiscal-2026 dollars, total or per student) carry over when you change views.

- **County** (`#county/220905`): the 16 districts side by side.
  - Revenue by level of government, as dollars or as a share.
  - Federal share over time and federal money by program.
  - School meals: free-rate share in 2024-25 and 2025-26, and USDA reimbursement for the months claimed in both years.
  - Spending by function, enrollment, and a data table.
- **District** (`#district/220905`): one district.
  - Money flow (Sankey) for every year: revenue source, then fund, then spending function.
  - Revenue, federal programs and spending by function over time.
  - School meals: USDA revenue, meals claimed, free-rate share, monthly reimbursement.
  - Fort Worth ISD only: adopted budgets FY2023–FY2027 as a second data set.
- **Schools** (`#schools/all`, `#schools/220905`, `#schools/220905/220905010`): every campus.
  - A map with circle size showing enrollment and color showing one of ten measures, plus district boundaries.
  - A panel for the selected school with its history.
  - Spending per student ranked by school, split by funding source or by function.
  - Meals by school and a sortable table of all schools.
  - All 16 districts at once, or only the selected district.

## What came from where

| Earlier page | Now | What changed |
|---|---|---|
| [Tarrant County ISDs compared](../tarrant-isd-compare-opus-5.5-high/) | County view | Same charts and numbers. |
| [Fort Worth ISD budget explorer](../fwisd-budget-opus-5.5-high/) | District view | Works for any of the 16 districts. The text that was written for Fort Worth is now computed from the selected district's numbers. Adopted budgets stay Fort Worth only. |
| [Fort Worth area schools](../fort-worth-area-schools-opus-5.5-high/) | Schools view | 16 districts instead of 4: 568 campuses, 505 of them open in FY2025, 500 on the map. |

The three earlier pages are kept as they were, with their prompts and screenshots. `prompt.md` here records the merge.

The build is one `fetch.sh` and one `build_data.py` instead of three of each. One pass over the TEA files produces the district totals, the money-flow links and the school-level spending, so the fund and program categories can't drift apart between views.

## Main findings (FY2025)

- **Schools:** the 489 schools with both spending and enrollment spent $9,829 per student from money coded to them, $432 of it federal grants. District-wide costs add about $3,319 per student.
- **Revenue per student:** from $14,640 in Mansfield to $20,482 in Carroll. Fort Worth took in $16,678.
- **Federal share:** 8.1% countywide, down from a 16.5% peak in FY2022.
- **School meals, 2025-26:** Fort Worth's CEP claiming rate fell from 93.6% to 79.9%, and its school-year USDA reimbursement fell 15% ($38.7M to $32.7M, months claimed in both years). Across all schools in the program, reimbursement fell 2.5%.
- **Carroll ISD** isn't in the National School Lunch Program, so it has no meal claims.

## Rebuilding

```bash
build/fetch.sh /tmp/tarrant-schools-raw
python3 build/build_data.py /tmp/tarrant-schools-raw index.html
```

`fetch.sh` gathers:
- about 400 MB of statewide TEA zips (reusing any already in `RAW/zip`), filtered to districts 2209xx;
- TDA meal claims by school and month, plus Seamless Summer and after-school supper claims, for contracting entities 01017–01032;
- NCES school directories for 2010-11 to 2024-25 (the Urban Institute Education Data API, plus NCES EDGE for 2024-25);
- Census district boundaries.

`build_data.py` prints a line per district with its count of open campuses, mapped campuses and campuses with meal claims.

## Checked against the earlier pages

- County view: revenue, spending and enrollment for all 16 districts and 15 years match the Tarrant comparison page exactly, and so do the meal-claim fields the page uses.
- District view: Fort Worth's sources, uses and adopted budgets match the Fort Worth page. One money-flow link under $500 in FY2012 is now dropped.
- Schools view: all 206 campuses from the four-district page match on spending, enrollment and free/reduced-price counts. One school name is capitalized differently.

## Method and caveats

- Fiscal years end June 30 (FY2025 = 2024-25).
- **School spending** is every expenditure coded to a campus organization code (001–699) in the General Fund, grant funds and food service. Debt service, construction and internal-service funds are left out. Costs coded district-wide (7xx–999) aren't assigned to schools.
- **Matching:** TEA campus numbers link to NCES schools through the state school id, and to TDA meal claims through the site id. Three schools in the 2024-25 NCES file couldn't be matched to a TEA campus (Baylor Elementary and two listed as "New"), so they're missing.
- **Small campuses:** special-education, alternative and early-childhood campuses have high costs per student. The ranking hides campuses under 150 students unless you ask for them.
- **Meals in the district view** compare 2024-25 and 2025-26 over the months claimed in both years. The earlier Fort Worth page compared full-year totals; for Fort Worth the two agree.
- **Adopted budgets** exist only for Fort Worth ISD. The other 15 districts' budget documents haven't been transcribed.
- Bond proceeds, refundings and transfers between funds aren't revenue. Debt and construction spending swing with bond programs.
- Only districts based in Tarrant County are included. Northwest, Aledo, Burleson and others that reach into the county aren't, and neither are charter schools.
- The 16 boundary colors on the map are generated, so neighboring districts can look similar. The school panel names the district.
