# Fort Worth ISD budget explorer

`index.html` is one self-contained page (no external scripts, data inlined). Open it directly.

## What's in it

- **Money flow (Sankey)** for every year: revenue source, then fund, then spending function. Two data sets:
  - *Actual, all funds* FY2011–FY2025: TEA PEIMS audited actuals for every fund, including federal grant funds.
  - *Adopted budget* FY2023–FY2027: the district's adopted budgets, which cover only the General, Food Service and Debt Service funds.
- **Revenue by level of government**, **federal money by program** and **spending by function** over time. Every chart can show nominal dollars, fiscal-2026 dollars (CPI-U) or dollars per student.
- **School meals**: USDA child-nutrition revenue, meals claimed, the CEP free-claiming rate and monthly reimbursement from Texas Department of Agriculture claims, SY2015-16 to 2025-26.

## Main findings

- Federal money was 12% of revenue before the pandemic, peaked at 24% (FY2022, ESSER) and was back to 11% in FY2025. COVID relief totaled about $382M over FY2020–FY2025.
- USDA school meals bring in about $43–46M a year, which makes them the steadiest large federal stream after Title I.
- In 2025-26 the district's CEP claiming rate fell from 93.75% free to 80% free, which implies the identified-student percentage dropped from about 58.6% to 50%. That share comes mainly from SNAP direct certification. School-year USDA reimbursement fell 15% ($38.7M to $32.7M), and the FY2027 adopted budget cuts food service to $49.4M from $58.9M.

## Rebuilding

```bash
build/fetch.sh /tmp/fwisd-raw
python3 build/build_data.py /tmp/fwisd-raw index.html
```

`fetch.sh` downloads about 400 MB of statewide TEA zips and keeps only FWISD rows. Adopted-budget figures are transcribed from the district PDFs in `build_data.py`, with the source document recorded for each year.

## Caveats

- Fiscal years end June 30 (FY2025 = 2024-25).
- Bond proceeds, refundings and transfers between funds aren't treated as revenue. They show up only as the balancing node in the Sankey.
- Budget documents aren't consistent from year to year. Food-service USDA money is booked as "Other Resources" in the FY2023–FY2024 books (reclassified as federal here), the posted FY2026 adopted budget covers only the General Fund, and FY2027 has no fund split.
- The ISP is inferred (free share ÷ 1.6). The district hasn't published the figure.
