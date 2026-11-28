# Prompts

- **Model:** claude-fable-5-2
- **Effort:** medium
- **Session(s):** e71f64b1-16d9-447f-a62b-ec100217afa3
- **Tokens:** input 158, output 123224, cache read 15227422, cache write 450326
- **Cost (tokscale estimate):** $15.18

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

## Claude

Committed: `e560102` "Add combined Tarrant County schools page (Fable 5.2 medium)".

- **Branch:** was on `master`, so commit went on new branch `tarrant-county-schools`. Not pushed.
- **In commit:** new demo directory (page, build scripts, README, `prompt.md`, prompt screenshots), landing screenshot, `demos.js`, `.claude/launch.json`, pointer line in three original READMEs.
- **prompt.md:** regenerated first, so it includes previous reply. This turn not in it.
- **Left uncommitted:** statewide page changes, route-planner changes, `watt-logo-variations/`. All predate this work and belong to other tasks, so kept out of this commit.

## You

Merge to master

## Claude

Merged. `master` fast-forwarded to `e560102`; branch `tarrant-county-schools` deleted.

- Not pushed, so Pages site unchanged until push.
- Statewide, route-planner and `watt-logo-variations/` changes still uncommitted, untouched.

## You

Push

## Claude

Pushed. `origin/master` now at `e560102`, in sync with local.

- Pages workflow should trigger from push; build result not checked.
- Statewide, route-planner and `watt-logo-variations/` changes still local and uncommitted.

## You

Lets update these pages now to use the Bluebonnet design system that I just created.

## Claude

Tokens renamed to Bluebonnet names. Now restyling components (type, radii, controls, tables, callouts), then browser check.

![screenshot 10](prompt-assets/010.webp)

![screenshot 11](prompt-assets/011.webp)

![screenshot 12](prompt-assets/012.webp)

![screenshot 13](prompt-assets/013.webp)

![screenshot 14](prompt-assets/014.webp)

![screenshot 15](prompt-assets/015.webp)

![screenshot 16](prompt-assets/016.webp)

![screenshot 17](prompt-assets/017.webp)

![screenshot 18](prompt-assets/018.webp)

![screenshot 19](prompt-assets/019.webp)

![screenshot 20](prompt-assets/020.webp)

![screenshot 21](prompt-assets/021.webp)

![screenshot 22](prompt-assets/022.webp)

Restyle works in light and dark, no console errors. Checking map view, then docs.

![screenshot 23](prompt-assets/023.webp)

![screenshot 24](prompt-assets/024.webp)

![screenshot 25](prompt-assets/025.webp)

![screenshot 26](prompt-assets/026.webp)

Now README, then `prompt.md`.

Combined Tarrant page now on Bluebonnet. Nothing committed.

**Scope taken:** only [index.html](politics/tarrant-county-schools-fable-5.2-medium/index.html). "These pages" read as three merged views. Statewide, GPT 6.1 and three originals untouched, per earlier instruction.

**Changed**
- Page links `../../bluebonnet-design-system/dist/bluebonnet.css`. Own palette deleted; all colors now Bluebonnet tokens.
- Type: Bricolage Grotesque headings and tile numbers, Public Sans body, uppercase label style on control labels and table headers.
- Controls: selected view/year/option filled `bluebonnet`, `line-strong` borders, 2px focus ring, 120ms color transitions only.
- Callouts: tinted blocks, side stripe removed (Alert rule).
- Radii and spacing on Bluebonnet scale.
- Chart colors: local `bluebonnet`, state `firewheel`, federal `paintbrush`, USDA meals `winecup`.
- Landing thumbnail regenerated; [README.md](politics/tarrant-county-schools-fable-5.2-medium/README.md) gained Design section; `prompt.md` rerun ($13.61 so far).

**Deviations from Bluebonnet, know these**
- Charts with 6–7 series use half-strength tints of bluebonnet, paintbrush, winecup. System defines only five series colors.
- 16 district boundary colors on map still generated hsl. No 16-color set in system.
- `firewheel` documented as fill only; used here for state bars and some legend swatches, never text.
- Chart subheads 16px, not `text-h3` 19px; tables 14px. Kept dense for data.

**Behavior change**
- Page no longer standalone: must be served from repo root (Pages fine; `politics` preview server alone loses styling). Fonts need Google Fonts; offline falls back to system fonts.

**Verified:** county, district, schools views in light and dark; phone width without horizontal scroll; no console errors. Not checked: district view in dark, tablet width.

## You

Yes, statewide too

## Claude

Statewide CSS converted. Browser check now.

![screenshot 27](prompt-assets/027.webp)

![screenshot 28](prompt-assets/028.webp)

![screenshot 29](prompt-assets/029.webp)

![screenshot 30](prompt-assets/030.webp)

![screenshot 31](prompt-assets/031.webp)

![screenshot 32](prompt-assets/032.webp)

![screenshot 33](prompt-assets/033.webp)

Statewide page now on Bluebonnet. Nothing committed.

**Changed in [index.html](politics/texas-isd-statewide-opus-5.5-high/index.html)**
- Same treatment as Tarrant page: linked `bluebonnet.css`, own palette removed, Bluebonnet type, controls, callouts, tables, radii.
- Same chart mapping: local `bluebonnet`, state `firewheel`, federal `paintbrush`, USDA meals `winecup`; half tints for 6–7 series charts.
- County map ramp: `bluebonnet-soft` to `bluebonnet`; diverging measures paintbrush to bluebonnet.
- Thumbnail regenerated; [README.md](politics/texas-isd-statewide-opus-5.5-high/README.md) intro updated.

**Verified:** top, revenue, county map, federal programs, recapture sections; light and dark; 646px and 1100px widths without horizontal scroll; no console errors. Not checked: phone width, meals and enrollment sections, district search flow.

**Know before commit**
- Statewide `index.html` and `README.md` already had your uncommitted edits (plus `build_data.py`, `fetch.sh`). Restyle sits on top, same files. Splitting into separate commits needs hunk-level staging.
- Statewide page no longer opens standalone from file in styled form: needs repo-root serving, like Tarrant page.
- Statewide `prompt.md` left alone (Opus session record). Restyle recorded in Tarrant `prompt.md`, rerun now ($14.93); README points there. Rerun again after final prompt.
- Three original Opus pages and GPT 6.1 page still old style.

## You

lets commit what is here and push
