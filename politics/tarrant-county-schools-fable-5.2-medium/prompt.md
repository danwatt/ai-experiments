# Prompts

- **Model:** claude-fable-5-2
- **Effort:** medium
- **Session(s):** e71f64b1-16d9-447f-a62b-ec100217afa3
- **Tokens:** input 74, output 85653, cache read 7867681, cache write 312958
- **Cost (tokscale estimate):** $10.01

## You

Take a look at the several pages that were made to investigate Texas schools. Is there a way we can efficiently combine some of these?

## Claude

Yes. Four of five pages already one family, built by copy-paste.

## What exist

| Page | Grain | Unique thing |
|---|---|---|
| `texas-isd-statewide-opus-5.5-high` | 1,019 districts | county map, peer groups, recapture, property wealth |
| `tarrant-isd-compare-opus-5.5-high` | 16 districts | nothing much (see below) |
| `fwisd-budget-opus-5.5-high` | 1 district | Sankey, adopted budgets FY2023–27 (hand-transcribed), monthly meal claims |
| `fort-worth-area-schools-opus-5.5-high` | 178 campuses, 4 districts | campus-level spending, NCES directory, Leaflet map |
| `fwisd-budget-gpt-6.1-sol-high` | 1 district | different source (audited annual report PDFs), different model |

## Overlap

- **Fetch:** four Opus `fetch.sh` download same ~400 MB TEA actual zips, same TDA claims, same `summarized.xlsx`. Already half-shared by "reuse zips in `RAW/zip`" convention.
- **Build:** `fund_group`, `fed_cat`, `COVID_FUNDS`, `ARRA_FUNDS`, `CPI`, function-code map duplicated across four `build_data.py`.
- **Page JS:** `svgRoot`, `ticks`, `niceMax`, `money`, `legend`, `showTip`, `stackedBars`, `hbars`, `lineMany`, `setSeg`, `drawYearBtns` copied in each `index.html`.
- **Content:** Tarrant page sections (revenue by level, federal share, federal programs, meals, spending by function, enrollment, table) all exist in statewide page. Pick Fort Worth, peer group = county, get same view. Only loss: Tarrant-specific findings prose.

## Options, cheap to big

1. **Shared pipeline only.** One `politics/texas-schools-shared/` with one `fetch.sh` and one Python module for fund/program classification. Each page keeps own `build_data.py` for its slice. Pages unchanged. Low risk, kills drift (a COVID fund fix now needs four edits).
2. **Fold Tarrant into statewide.** Add `#220905/county` style deep link opening statewide page on Tarrant peer group. Tarrant card on landing page points there. Removes one page, 195 KB.
3. **District drill-down.** Statewide page gains Sankey per district (data already there: source, fund, function). FWISD budget page shrinks to what is truly FWISD-only: adopted budgets and monthly meals. Costs payload: Sankey needs fund × function cross, statewide page already 2.1 MB.
4. **One site, three zooms** (state, district, campus) with lazy-loaded JSON per district. Biggest rework. Breaks "one self-contained `index.html`" property all four READMEs advertise, and campus data only exists for four districts.

## Recommend

Do 1 + 2. Skip 3 and 4 for now: payload cost and big rewrite for small gain.

Leave alone:
- **Campus page.** Different grain, different sources (NCES, Leaflet). Shares only fetch and classification code, which option 1 covers.
- **GPT page.** Different source documents, and it is the model-comparison pair for Opus FWISD page.

## Caveats

- Each demo carries own `prompt.md` as record of one session's work. Merging pages blurs that record; folded Tarrant page should stay in git history with prompt kept or linked.
- Statewide directory has uncommitted changes (README, build scripts, `index.html`). Commit or stash before any refactor there.
- Did not run builds or diff outputs. Subset claim for Tarrant based on READMEs, section headings and function lists, not rendered comparison.

## You

Lets do this

Leave the GPT 6.1 alone, and lets leave the state-wide one alone as well

Lets combine the three that are more specific to tarrant county. We will need to pull in school-level data for the other districts within the county

Lets keep the original prompts / screenshots around, and then use this one to document the combining.

## Claude

Reading three pages' source before writing combined build. Bit more reading, then build.

Reading done. Now writing combined fetch script and starting ~400 MB download in background.

Build script written; cleaning one line, then assembling the combined page while data downloads.

Page skeleton written. Now assembling it with the reusable chart code from the three originals.

New data matches originals (only trivial diffs). Opening page in browser to verify three views.

![screenshot 1](prompt-assets/001.webp)

![screenshot 2](prompt-assets/002.webp)

![screenshot 3](prompt-assets/003.webp)

![screenshot 4](prompt-assets/004.webp)

![screenshot 5](prompt-assets/005.webp)

![screenshot 6](prompt-assets/006.webp)

![screenshot 7](prompt-assets/007.webp)

![screenshot 8](prompt-assets/008.webp)

![screenshot 9](prompt-assets/009.webp)

Page verified. Now landing-page card, screenshot, README, then prompt.md.

Combined page built: [politics/tarrant-county-schools-fable-5.2-medium/index.html](politics/tarrant-county-schools-fable-5.2-medium/index.html). Checked in browser, no console errors. Nothing committed.

## What it is

One page, three views sharing district, year and dollar units:

- **County** (`#county/220905`): old Tarrant comparison, same charts.
- **District** (`#district/220905`): old Fort Worth budget page, now works for any of 16 districts. Fort Worth-specific text now computed from selected district. Adopted budgets stay Fort Worth only.
- **Schools** (`#schools/all`): old four-district map, now all 16 districts. 568 campuses, 505 open in FY2025, 500 mapped.

One `fetch.sh` and one `build_data.py` replace three of each. Page is 1.5 MB.

## Checked against originals

- County: revenue, spending, enrollment match exactly for all 16 districts and 15 years.
- District: Fort Worth sources, uses and adopted budgets match. One money-flow link under $500 in FY2012 now dropped.
- Schools: all 206 campuses from four-district page match on spending and enrollment. One school name capitalized differently.

## Originals and landing page

- Three old directories kept with prompts and screenshots. Only change: one pointer line at top of each README.
- [demos.js](demos.js): three old cards replaced by one combined card, which links to each original page and its prompt.
- GPT 6.1 and statewide pages untouched. Statewide still shows your earlier uncommitted changes.
- Added `politics` preview server entry to `.claude/launch.json`.

## Know before commit

- **Directory name says `medium`**: effort read from session transcript. Rename if wrong.
- **prompt.md** generated, but written before this final reply. Rerun to capture it:

```bash
scripts/prompt-md.sh politics/tarrant-county-schools-fable-5.2-medium e71f64b1-16d9-447f-a62b-ec100217afa3
```

- **Three schools missing**: 2024-25 NCES rows for Baylor Elementary and two listed as "New" could not be matched to TEA campus.
- **Five "Unnamed Campus 699" rows** appear in tables with no coordinates. Likely catch-all organization codes, not real schools. Not filtered.
- **16 boundary colors** generated, so neighbors can look alike.
- **Meal comparison in district view** now uses months claimed in both years, not full-year totals. Fort Worth numbers unchanged ($38.7M to $32.7M).
- Phone-width layout and dark theme not checked on combined page.

## You

Commit the working tree changes with a sensible message.
