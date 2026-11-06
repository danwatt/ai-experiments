#!/usr/bin/env python3
"""Build a self-contained, offline research report from audited outputs."""
from collections import Counter
import csv
from html import escape
import json
from pathlib import Path

from analyze import ROOT, OUT, read_shapes


def read_csv(name):
    with (OUT / name).open() as stream:
        return list(csv.DictReader(stream))


def margin(value):
    value = float(value)
    return f"{'D' if value > 0 else 'R'} +{abs(value):.2f}"


def map_svg(plan, leaders, title):
    records = list(read_shapes(plan))
    left = min(g.bounds[0] for _, g, _ in records)
    bottom = min(g.bounds[1] for _, g, _ in records)
    right = max(g.bounds[2] for _, g, _ in records)
    top = max(g.bounds[3] for _, g, _ in records)
    scale = min(940 / (right - left), 850 / (top - bottom))
    def xy(x, y):
        return ((x - left) * scale + 25, (top - y) * scale + 25)
    paths = []
    colors = {'REP': '#bf514b', 'DEM': '#426ca5', 'PENDING': '#d6d8db'}
    for props, geom, _ in records:
        district = int(props['District'])
        party = leaders.get(district, 'PENDING')
        geom = geom.simplify(700, preserve_topology=True)
        polygons = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
        commands = []
        for polygon in polygons:
            for ring in [polygon.exterior, *polygon.interiors]:
                points = [xy(x, y) for x, y in ring.coords]
                commands.append('M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in points) + ' Z')
        label = {'REP': 'Republican lead', 'DEM': 'Democratic lead', 'PENDING': 'Pending'}[party]
        paths.append(f'<path d="{" ".join(commands)}" fill="{colors[party]}" stroke="#fff" stroke-width="1" fill-rule="evenodd"><title>District {district}: {label}</title></path>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{escape(title)}" viewBox="0 0 1000 910"><title>{escape(title)}</title>{"".join(paths)}</svg>'


def main():
    summary = json.loads((OUT / 'analysis_summary.json').read_text())
    model = json.loads((OUT / 'estimate_summary.json').read_text())
    actual = read_csv('house_2026_actual_districts.csv')
    download_urls = {plan: json.loads((ROOT / 'data' / 'raw' / (plan + '.zip.source.json')).read_text())['url']
                     for plan in ['planc2193', 'planc2333']}
    estimates = read_csv('house_2026_old_map_estimates.csv')
    complete = [r for r in estimates if r['status'] != 'PENDING']
    pending = [r for r in estimates if r['status'] == 'PENDING']
    units = read_csv('retabulation_units.csv')
    missing = Counter()
    for row in units:
        if row['unit'] == 'county' and ';' in row['old_districts'] and row['party'] in {'REP', 'DEM'}:
            missing[row['county']] += int(row['votes'])
    missing_rows = ''.join(f'<tr><td>{escape(name)}</td><td>{n:,}</td></tr>' for name, n in missing.most_common())
    old_map = map_svg('planc2193', {int(r['old_district']): r['estimated_party_lead'] for r in complete}, 'Old congressional map: provisional estimates; gray districts pending')
    new_map = map_svg('planc2333', {int(r['district']): r['leading_party'] for r in actual}, '2025 redraw: observed 2026 House party leads')
    maps = ROOT / 'maps'
    maps.mkdir(exist_ok=True)
    (maps / 'old_map.svg').write_text(old_map)
    (maps / 'new_map.svg').write_text(new_map)
    table = []
    for row in complete:
        values = [float(row[k]) for k in ['voting_age_dem_minus_rep_pp', 'population_dem_minus_rep_pp', 'area_dem_minus_rep_pp']]
        endpoints = [min(values), max(values)]
        if max(values) < 0:
            endpoints.reverse()
        sensitivity = margin(endpoints[0]) + ' to ' + margin(endpoints[1])
        if margin(endpoints[0]) == margin(endpoints[1]):
            sensitivity = margin(endpoints[0])
        table.append(f"<tr><td>TX-{row['old_district']}</td><td>{round(float(row['estimated_republican_votes'])):,}</td><td>{round(float(row['estimated_democrat_votes'])):,}</td><td><b>{margin(row['voting_age_dem_minus_rep_pp'])}</b></td><td>{sensitivity}</td><td>{int(row['unlocated_votes_max']):,}</td></tr>")
    ledger = read_csv('estimate_vote_conservation.csv')[0]
    assigned = round(float(ledger['geographically_allocated_votes']))
    unassigned = int(ledger['votes_left_unallocated'])
    report = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Texas congressional redraw — 2026 House vote reconstruction</title>
<style>
:root{{--ink:#202b35;--muted:#5e6870;--paper:#f7f5f0;--line:#d6d4ce;--blue:#426ca5;--red:#bf514b}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,sans-serif}}main{{max-width:1180px;margin:0 auto;padding:48px 28px 70px}}h1{{font:600 clamp(30px,4.5vw,52px)/1.12 Georgia,serif;max-width:850px;margin:12px 0 22px}}h2{{font:600 27px/1.3 Georgia,serif;margin:36px 0 14px}}h3{{font-size:19px;margin:18px 0 8px}}p{{max-width:880px}}a{{color:#235a88}}.eyebrow{{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}}.lede{{font-size:20px;max-width:860px}}.notice{{padding:18px 22px;background:#fff5d9;border-left:4px solid #ac812e}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}}.card{{border:1px solid var(--line);padding:20px;background:#fff}}.value{{font:600 32px/1.15 Georgia,serif;margin:8px 0}}.muted,small,figcaption{{color:var(--muted)}}.maps{{display:grid;grid-template-columns:1fr 1fr;gap:22px}}figure{{margin:0;background:#fff;border:1px solid var(--line);padding:18px}}figure svg{{display:block;width:100%;max-height:460px}}figcaption{{font-size:13px}}.legend{{display:flex;gap:20px;margin:12px 0;font-size:14px}}.swatch{{display:inline-block;width:12px;height:12px;margin-right:6px}}table{{border-collapse:collapse;width:100%;background:#fff;font-size:14px}}th,td{{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}}th:first-child,td:first-child{{text-align:left}}th{{font-size:12px;color:var(--muted);background:#eeece6}}.scroll{{overflow:auto}}.downloads{{display:flex;flex-wrap:wrap;gap:10px}}.downloads a{{padding:9px 13px;background:#fff;border:1px solid var(--line);text-decoration:none}}.columns{{display:grid;grid-template-columns:1fr 1fr;gap:30px}}li{{margin:8px 0}}code{{font-size:13px}}footer{{border-top:1px solid var(--line);margin-top:36px;padding-top:16px;font-size:13px;color:var(--muted)}}@media(max-width:760px){{main{{padding:28px 18px}}.cards,.maps,.columns{{grid-template-columns:1fr}}.cards{{gap:10px}}figure svg{{max-height:420px}}}}
</style></head><body><main>
<div class="eyebrow">Public-records analysis · November 5, 2026 · Unofficial returns</div>
<h1>What would the 2026 House vote look like under Texas’s old map?</h1>
<p class="lede">The downloads and initial reconstruction are ready. Eight old districts have provisional estimates. Thirty remain pending because the available records do not yet support a complete reconstruction.</p>
<p class="notice"><strong>The statewide seat effect is not determined.</strong> The observed new-map result has 24 Republican and 14 Democratic leads. The old-map estimates below cover only part of the state and cannot be compared with that full-state seat count.</p>
<div class="cards"><div class="card"><div class="muted">Observed 2026 House votes</div><div class="value">{summary['house_votes']:,}</div><small>All 254 county returns reconcile to 38 district totals.</small></div><div class="card"><div class="muted">Old districts estimated</div><div class="value">8 / 38</div><small>5 Republican and 3 Democratic leads within this incomplete subset.</small></div><div class="card"><div class="muted">Old districts still pending</div><div class="value">30</div><small>Missing major-party precinct data stays unresolved.</small></div></div>
<h2>Same votes, different boundaries</h2>
<div class="legend"><span><i class="swatch" style="background:var(--red)"></i>Republican lead</span><span><i class="swatch" style="background:var(--blue)"></i>Democratic lead</span><span><i class="swatch" style="background:#d6d8db"></i>Pending</span></div>
<div class="maps"><figure><h3>Old map · PLANC2193</h3>{old_map}<figcaption>Only districts with a reportable provisional estimate are colored. Gray means pending, not tied.</figcaption></figure><figure><h3>2025 redraw · PLANC2333</h3>{new_map}<figcaption>Observed 2026 House leads: 24 Republican, 14 Democratic. Unofficial state snapshot from November 4.</figcaption></figure></div>
<p class="muted"><small>Hover over a district for its number. District area does not represent population or seat count. Display geometry is simplified; the downloaded shapefiles retain the original detail.</small></p>
<h2>Provisional old-map estimates</h2>
<p>Votes are regrouped by <strong>party</strong>, since an old district may contain voters who faced different candidate slates in 2026. These are geographic retabulations of votes actually cast, holding voting behavior fixed.</p>
<div class="scroll"><table><thead><tr><th>Old district</th><th>Estimated R votes</th><th>Estimated D votes</th><th>Two-party margin</th><th>Allocation scenarios</th><th>Unlocated votes, max.</th></tr></thead><tbody>{''.join(table)}</tbody></table></div>
<p><strong>Close-seat check:</strong> old TX-38 is estimated at R +4.76 points. The three allocation scenarios span approximately R +4.75 to R +4.76. None of these eight district leaders changes across the tested allocations. This narrow scenario spread is <strong>not a confidence interval</strong> and does not measure every possible error.</p>
<p class="muted"><small>Margins use Republican and Democratic votes only. Vote counts are rounded estimates and omit any votes still unlocated. The last column is a conservative maximum that could belong to the district; maxima across districts must not be added. The small remaining unlocated counts in reportable districts cannot reverse their lead under the selected allocation.</small></p>
<h2>Do precincts stay the same?</h2>
<p>Sometimes. Counties can redraw, split, merge, or renumber voting precincts independently of congressional districts. A voter can also keep the same precinct while changing congressional district. We therefore need the precinct boundaries used for the election whose votes we are counting. <a href="https://data.capitol.texas.gov/dataset/precincts">The legislature publishes separate precinct vintages.</a></p>
<p>Even if a 2026 precinct is wholly inside a new district, an old district boundary can cut through it. A precinct vote total alone does not reveal how each side voted. Smaller reporting units or ballot-style records may resolve the split; otherwise it requires an estimate.</p>
<h2>What was calculated</h2>
<ol><li>Downloaded the official old and new <a href="https://data.capitol.texas.gov/dataset/planc2193">PLANC2193</a> and <a href="https://data.capitol.texas.gov/dataset/planc2333">PLANC2333</a> shapefiles and their Census-block assignments.</li>
<li>Matched the same 668,757 Census blocks across both plans. District numbers changed for blocks in 73 counties. Block counts are geographic bookkeeping, not voter or population counts.</li>
<li>Downloaded <a href="https://goelect.txelections.civixapps.com/ivis-enr-ui/races">official 2026 House returns</a> for every county. All candidate totals sum exactly to the state totals for all 38 districts and agree with the state's separate HTML summary.</li>
<li>Downloaded precinct returns for Bastrop, Bexar, Denton, Harris, Tarrant, Travis, and Williamson. Only county/district/party cells matching the state snapshot exactly enter the precinct reconstruction. Unmatched cells retain county-level uncertainty; this includes Bexar’s major-party returns.</li>
<li>Assigned a whole reporting unit directly when it belongs to one old district. For split precincts, used <a href="https://data.capitol.texas.gov/dataset/2020-census-geography">2020 Census voting-age population</a>, with total population and land area as sensitivity checks. Each populated Census block is placed in a precinct using a point inside the block; its old and new congressional districts come from the official block assignments. This is an allocation model, not measured within-precinct voting.</li>
<li>Left districts missing major-party precinct data pending, as requested. No statewide model fills those gaps, and no 2024 votes substitute for 2026 votes.</li></ol>
<p>The estimate assigns <strong>{assigned:,}</strong> votes to old districts and retains <strong>{unassigned:,}</strong> votes without an old-district allocation. Their sum is exactly <strong>{summary['house_votes']:,}</strong> in each scenario. Some districts with an allocation still remain pending because not all their major-party votes are located.</p>
<h2>What remains uncertain</h2>
<ul><li><strong>Precinct vintage:</strong> the legislature’s latest published boundaries are from the 2026 primary. They need confirmation against the November election. Congress/precinct geometry conflicts affecting 79 accepted votes are left unresolved.</li>
<li><strong>Special precinct labels:</strong> 412 votes have source labels absent from the shapefile, including F99 suffixes. The suffixes were not stripped to invent a geographic match.</li>
<li><strong>Population allocation:</strong> 2020 residents, including voting-age residents, are not the 2026 electorate. New construction, turnout, and within-precinct party differences can matter. About 2,371 split-unit votes require an area fallback where the available population crosswalk supplies no weight.</li>
<li><strong>Incomplete precinct collection:</strong> the downloaded and reconciled files cover only part of the necessary counties. Some other reports may be available but have not been obtained and adapted here. Missing data is not assumed to be zero.</li>
<li><strong>Counterfactual behavior:</strong> an election actually held under old boundaries could have different candidates, campaigns, turnout, and voter choices. This exercise cannot recover those changes.</li></ul>
<details><summary>Counties with major-party votes still requiring finer geographic returns</summary><p>Counts below include only county/new-district cells that span multiple old districts. They do not include precinct splits already modeled.</p><div class="scroll"><table><thead><tr><th>County</th><th>Votes needing precinct detail</th></tr></thead><tbody>{missing_rows}</tbody></table></div></details>
<h2>Downloads</h2>
<div class="downloads"><a href="{escape(download_urls['planc2193'], quote=True)}" download>Old-map shapefile</a><a href="{escape(download_urls['planc2333'], quote=True)}" download>New-map shapefile</a><a href="data/processed/house_2026_county_candidates.csv" download>2026 House county votes</a><a href="data/processed/house_2026_actual_districts.csv" download>Actual district totals</a><a href="data/processed/house_2026_old_map_estimates.csv" download>Old-map estimates and pending districts</a><a href="data/processed/precinct_source_reconciliation.csv" download>Precinct-source reconciliation</a><a href="data/processed/house_2026_old_map_bounds.csv" download>Conservative vote bounds</a><a href="data/processed/estimate_vote_conservation.csv" download>Vote-conservation checks</a></div>
<p><a href="README.md">Methods, sources, and reproduction instructions</a></p>
<footer>All election returns are unofficial. This report uses the state feed version {escape(summary['state_feed_version'])}; source timestamps and retrieval hashes are retained alongside each download. Prepared November 5, 2026.</footer>
</main></body></html>'''
    (ROOT / 'report.html').write_text(report)
    print(f'Wrote {ROOT / "report.html"}')


if __name__ == '__main__':
    main()
