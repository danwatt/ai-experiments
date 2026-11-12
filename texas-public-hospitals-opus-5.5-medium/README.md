# Texas public hospitals: building the data

Everything on the page comes from `data.js` and `counties.js`, which are built from official sources:

```sh
./build.sh            # download what is missing into .sources/, then rebuild
./build.sh --refresh  # download every file again
```

Needs `python3` with `pandas`, `openpyxl` and `xlrd`, and `pdftotext` (poppler). Downloads are about 100 MB and are git-ignored.

| Step | Script | What it does |
|---|---|---|
| 1 | `fetch_sources.py` | Downloads the CMS cost report CSVs and finds each year's data-API id in the [data.cms.gov catalog](https://data.cms.gov/data.json). Downloads the Comptroller's special district levy spreadsheets: current years from [comptroller.texas.gov](https://comptroller.texas.gov/taxes/property-tax/rates/), older years from the Internet Archive. Downloads every audit PDF listed in `audited/*.json` and converts it to text. Downloads the county outlines. Writes `.sources/manifest.json`. |
| 2 | `build_counties.py` | Builds the Texas county map shapes in `counties.js`. |
| 3 | `audited/check.py` | Checks that every hand-entered audited year adds up. |
| 4 | `audited/locate_pages.py` | Finds the PDF page and line for each audited figure and writes `pages` into each `audited/*.json`. |
| 5 | `build_data.py` | Builds `data.js`. For each figure it records the CMS report id and the levy spreadsheet row and column, which the page uses to link each table cell to its source. |

## What is still manual

The audited figures in `audited/*.json` (`years`) are typed in from the PDFs. Each system lays out its statements differently, so a parser would be unreliable. To add a fiscal year:

1. Find the new audit.
   - Five systems: search the [Federal Audit Clearinghouse](https://app.fac.gov/dissemination/search/) by the district's name.
   - JPS: the [JPS website](https://www.jpshealthnet.org/).
2. Add its URL under `sources` in that system's JSON.
3. Type the year's figures under `years`, in thousands. The `notes` field in each file says how each figure is put together.
4. Run `./build.sh`. `check.py` flags any year that doesn't add up, and `locate_pages.py` finds the page numbers.

Also by hand, in `build_data.py`:
- `FIRST`/`LAST`: the year range shown.
- `EXCLUDE`, `ALIAS`, `SYSTEMS`, `TAX_UNIT`: which hospitals count as public, CCN changes, display names, and which tax district owns which hospital.

A newly opened public hospital or a new tax district needs an entry in these tables.
