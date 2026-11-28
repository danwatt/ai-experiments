# Fort Worth area schools

> Merged into the [Tarrant County schools](../tarrant-county-schools-fable-5.2-medium/) page (schools view, now all 16 districts). This page is kept as it was built, with its original prompt.

School-by-school spending, federal grants and USDA school meals for four districts in northwest Tarrant County: Fort Worth, Eagle Mountain-Saginaw, Lake Worth and Castleberry. It covers FY2011–FY2025, with meal claims through 2025-26.

`index.html` holds all the data (about 0.33 MB). The map loads [Leaflet](https://leafletjs.com/) from cdnjs and base-map tiles from Esri, so it needs an internet connection. Everything else works offline.

## What's in it

- **Map:**
  - every school, with circle size showing enrollment and color showing one of ten measures;
  - district boundaries on Esri's light or dark gray base map, which shows roads and city names;
  - a district switcher (all four, or one district) and a school-level filter.
- **School panel:** click a school to see its enrollment, spending per student by funding source, federal grants and Title I, free/reduced-price share, students per teacher, meal participation, the 2024-25 → 2025-26 change in USDA reimbursement, and history charts.
- **Ranking:** spending per student at every school, split by funding source (state and local, Title I, IDEA, COVID relief, other federal, child nutrition) or by function.
- **Over time:** spending per student for the selected schools, or for one school.
- **School meals table:** enrollment, free share, lunch and breakfast participation, and reimbursement, school by school.
- **All schools:** a sortable table.

The URL keeps the district and the selected school, for example `#220905/220905010` for Paschal High School.

## Main findings (FY2025)

- **Spending at schools:** the 178 schools that have both spending and enrollment spent $10,454 per student from money coded to them. District-wide costs add about $3,239 per student.
- **Median per student at regular schools (200+ students):** elementary $10,830, middle $10,446, high $10,089.
- **Federal grants:** $612 per student, $350 of it Title I. Title I is concentrated in high-poverty Fort Worth schools: Daggett Middle ($1,147), Mitchell Boulevard Elementary ($1,009) and A M Pate Elementary ($925).
- **USDA school-year reimbursement:** fell 8.5% in 2025-26 across these schools.
  - Fort Worth −13.6%: its CEP claiming rate dropped for every school at once.
  - Eagle Mountain-Saginaw +3.2%, Lake Worth +16.8%, Castleberry −0.1%.
- **Lunch participation in Fort Worth high schools:** low, mostly 15–33% of enrolled students, compared with about 37–47% at Eagle Mountain-Saginaw high schools.

## Rebuilding

```bash
build/fetch.sh /tmp/fw-schools-raw
python3 build/build_data.py /tmp/fw-schools-raw index.html
```

`fetch.sh` gathers:
- the statewide TEA zips (reusing any already in `RAW/zip`), filtered to the four districts;
- TDA meal claims by school;
- NCES school directories for 2010-11 to 2024-25 (the Urban Institute Education Data API, plus NCES EDGE for 2024-25);
- Census district boundaries.

## Method and caveats

- **School spending** is every expenditure coded to a campus organization code (001–699). It covers the General Fund, grant funds and food service. Debt service, construction and internal-service funds are left out.
  - Costs coded district-wide (7xx–999) aren't assigned to schools: central administration, most transportation and maintenance, and some special-education services.
  - That's 77% school-coded in Fort Worth, 87% in Castleberry and 68% in Lake Worth (FY2025).
- **Matching:** TEA campus numbers link to NCES schools through the state school id, and to TDA meal claims through the site id.
- **Per-student figures** divide by NCES enrollment for the same school year.
- **Small campuses:** special-education, alternative, juvenile-justice and early-childhood campuses have high costs per student. The ranking hides campuses under 150 students unless you ask for them.
- **Free share:** Fort Worth claims CEP as one district-wide group, so every Fort Worth school shows the same share. The free/reduced-price eligible share from NCES is a separate measure.
- **Participation** is average daily lunches (or breakfasts) ÷ October enrollment in the meal claim.
