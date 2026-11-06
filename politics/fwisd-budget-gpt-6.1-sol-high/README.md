# Fort Worth ISD budgets

Open `index.html` directly in a browser. The file is about 78 KB and contains all
data, CSS, JavaScript, and SVG charts. It needs no server, libraries, fonts, or
network connection. Only the links to source PDFs need internet access.

## Coverage

- Food Service Fund, fiscal years ended June 30, **2016–2025**: original budget,
  final amended budget, and actual revenue and operating expenses.
- Federal nutrition program detail: school breakfast, school lunch, USDA donated
  commodities, afterschool snacks, and separately stated other federal revenue.
- Actual federal revenue in **all governmental funds**, FY2016–2025, from each
  annual report's Exhibit C-3. The enterprise Food Service Fund is separate.
- Published three-fund budget plans, **2022–23 through 2026–27**, by revenue
  classification and expenditure function. This scope includes the General,
  Food Service, and Debt Service funds, not separate grant and bond construction
  funds.

The interface has independent controls for the focused nutrition year, reporting
basis, comparison year, years included in the nutrition trend, dollar/index view
of the wider federal trend, and district budget year. The Sankey shows pooled
resources; it does not assign particular grants to particular expenses.

The page can export the complete dataset as JSON, nutrition as CSV, and budget
plans as CSV. It also exposes exact values in accessible tables and links every
series to one-based PDF file pages.

## Findings and important distinctions

In FY2025, actual federal revenue in the Food Service Fund was **$43,481,142**,
up **$696,659 (1.6%)** from FY2024. That includes $3,252,490 in donated USDA food.
Governmental federal revenue was **$89,203,687**, down **41.6%** from FY2024's
$152,733,854. These are distinct fund scopes, not two competing estimates of the
same measure. Some nutrition grants are reported outside the enterprise fund.

SNAP household grocery benefits are separate from district school meal revenue.
The page explains the eligibility connection and links to primary program
sources. This analysis cannot quantify household SNAP benefits within school
district boundaries or establish the effect of a specific SNAP policy change.

Do not infer funding cuts from inconsistent summary tables:

- The 2025–26 short adopted posting is **General Fund only** ($869,731,863 of
  expenditures), although the website's general description says adopted
  budgets include three funds. The budget book's p. 16 gives the three-fund
  total ($1,066,212,639), used here. Food/debt details are labeled proposed;
  a separate adoption certification for those figures was not located.
- Some later books move food service **Other Resources** into the summary's
  federal revenue line, even though the aggregate contains nonfederal items.
  The audited program-level nutrition series avoids that classification break.
- The 2025–26 food/debt tables have incorrect column-year headings. Their values
  agree with that book's all-funds table and the prior-year book.
- The later unaudited historical governmental revenue table has discrepancies:
  the FY2018 federal total is $54,551,341 there, versus **$79,660,375** in the
  FY2018 audited C-3. The explorer uses each year's own financial statements.
- The 2023–24 budget book's published revenue and expenditure totals each exceed
  their component sums by $1. Published totals are retained and residuals are
  explicit in the dataset; amounts have not been silently adjusted.

All dollar values are nominal. No enrollment, meals-served, or inflation
adjustment is made. No missing detailed program amounts are inferred for
FY2026 or FY2027. A program absent as a separate line in an earlier nutrition
schedule contributes zero to this *stated-line sum*, not a claim of zero district
awards for that program across all funds.

## Primary sources

- [FWISD adopted budget postings](https://www.fwisd.org/departments/budget/budget-documents/adopted-budgets)
- [Official budget books](https://www.fwisd.org/departments/budget/budget-documents/official-budget-books)
- [Annual financial reports, with archives back to 2007](https://www.fwisd.org/departments/financial-services/financial-required-postings/annual-comprehensive-financial-reports-acfr)

Full document URLs, download hashes, and page locators are in `data.json` and
`source-manifest.json`, and are embedded in the HTML. Snapshot: November 6, 2026.

## Rebuild

Requirements: Python 3 with `requests` and `beautifulsoup4`; Poppler's
`pdftotext`/`pdftoppm`; and Tesseract for image-only tables.

```sh
python3 extract.py
python3 build_data.py
python3 build_html.py
```

Run these from this directory, or use absolute script paths. `extract.py`
downloads primary PDFs into the ignored `sources/` folder and preserves
layout-aware text. It also renders/OCRs the critical image-only tables.
`build_data.py` applies documented transcription corrections and exact-dollar
reconciliation checks. `build_html.py` embeds the validated data into
`template.html`, producing the final portable `index.html`.

The 2025–26 all-funds table is explicitly transcribed in `build_data.py` rather
than trusting OCR of its dense grid. Its three fund totals and all expenditure
functions reconcile exactly. The FY2017 OCR misread `900,000` as `g00,000`; the
correction is explicit. The FY2018 schedule has blank zero cells and one wrapped
disposal-gain row; these values are assigned explicitly from the source page.

## Validation

- Exact component-to-total checks for all **30 nutrition year/basis combinations**:
  nonoperating revenue, operating expenses, and net change in position.
- Governmental federal totals checked against C-3 totals/continuation pages.
- Five budget plans checked against revenue, function, and available fund totals,
  with the documented $1 source residuals preserved.
- Image-only source tables visually inspected.
- All 30 nutrition year/basis controls and five budget views exercised in a real
  browser; comparison controls, year filters, index view, and JSON export checked.
- Seven SVG views rendered, no browser console errors, no overflowing SVG labels
  in the checked desktop view, and no external display resources.
