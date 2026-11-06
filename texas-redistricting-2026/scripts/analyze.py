#!/usr/bin/env python3
"""Audit downloaded House returns and build a geography-aware partial retabulation.

No votes are distributed by land area, census-block count, or precinct centroid.
County/district cells with one possible old district can be reassigned exactly.
Other cells remain explicitly unresolved. Tarrant's precinct returns refine its cells.
"""
from collections import Counter, defaultdict
import base64
import csv
import io
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

from bs4 import BeautifulSoup
import shapefile
from shapely import make_valid
from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'data' / 'processed'
HOUSE = re.compile(r'U\. S\. REPRESENTATIVE DISTRICT (\d+)')


def precinct_key(fips, precinct):
    """Normalize formatting only; never strip suffixes or match across counties."""
    county = str(int(fips)).zfill(3)
    precinct = str(precinct).strip()
    return county + ':' + (str(int(precinct)) if precinct.isdigit() else precinct)


def write_csv(name, rows):
    rows = list(rows)
    if not rows:
        return
    with (OUT / name).open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def decode(value):
    return json.loads(base64.b64decode(value)) if isinstance(value, str) else value


def county_names():
    with (RAW / 'census_counties.txt').open() as stream:
        rows = list(csv.DictReader(stream, delimiter='|'))
    return {r['COUNTYFP']: r['COUNTYNAME'].removesuffix(' County')
            for r in rows if r['STATEFP'] == '48'}


def load_blocks(plan):
    with zipfile.ZipFile(RAW / f'{plan}_blk.zip') as archive:
        with archive.open(archive.namelist()[0]) as stream:
            return {r['SCTBKEY']: int(r['DISTRICT'])
                    for r in csv.DictReader(io.TextIOWrapper(stream))}


def block_crosswalk(names):
    old, new = load_blocks('planc2193'), load_blocks('planc2333')
    assert old.keys() == new.keys(), 'Plan block universes differ'
    counts = Counter((key[2:5], old[key], new[key]) for key in old)
    write_csv('block_transition_counts.csv', [
        dict(county_fips=c, county=names[c], old_district=o, new_district=n,
             census_blocks=count) for (c, o, n), count in sorted(counts.items())])
    cells = defaultdict(set)
    counties = defaultdict(lambda: {'old': set(), 'new': set(), 'changed': 0, 'total': 0})
    for (c, o, n), count in counts.items():
        cells[c, n].add(o)
        counties[c]['old'].add(o)
        counties[c]['new'].add(n)
        counties[c]['changed'] += count if o != n else 0
        counties[c]['total'] += count
    write_csv('county_boundary_changes.csv', [
        dict(county_fips=c, county=names[c], old_districts=';'.join(map(str, sorted(v['old']))),
             new_districts=';'.join(map(str, sorted(v['new']))),
             blocks_changing_district=v['changed'], total_blocks=v['total'],
             needs_precinct_returns=any(len(cells[c, n]) > 1 for n in v['new']))
        for c, v in sorted(counties.items())])
    return cells, {'blocks_per_plan': len(old),
                   'blocks_changing_district': sum(v['changed'] for v in counties.values()),
                   'counties_changing_district': sum(bool(v['changed']) for v in counties.values())}


def official_returns(names):
    doc = json.loads((RAW / 'sos_civix_election.json').read_text())
    federal, home = decode(doc['Federal']), decode(doc['Home'])
    candidates, district_rows = [], []
    state = {}
    for race in federal['Races']:
        match = HOUSE.fullmatch(race['N'].strip())
        if not match:
            continue
        district = int(match[1])
        totals = Counter()
        for candidate in race['Candidates']:
            votes = int(candidate['V'])
            assert votes >= 0
            state[district, int(candidate['ID'])] = votes
            totals[candidate['P']] += votes
            candidates.append(dict(district=district, candidate_id=candidate['ID'],
                                   candidate=candidate['N'], party=candidate['P'], votes=votes))
        assert sum(totals.values()) == int(race['T'])
        winner = max(race['Candidates'], key=lambda c: c['V'])
        district_rows.append(dict(district=district, republican=totals['REP'], democrat=totals['DEM'],
                                  other=sum(v for k, v in totals.items() if k not in ['REP', 'DEM']),
                                  total=race['T'], leading_party=winner['P'], leading_candidate=winner['N'],
                                  source_updated=home['LastUpdatedTime']))
    assert {r['district'] for r in district_rows} == set(range(1, 39))
    write_csv('house_2026_candidates.csv', sorted(candidates, key=lambda r: (r['district'], r['candidate_id'])))
    write_csv('house_2026_actual_districts.csv', sorted(district_rows, key=lambda r: r['district']))

    # Independently check against the Secretary of State's separate HTML summary.
    soup = BeautifulSoup((RAW / 'sos_2026_results.html').read_text(), 'html.parser')
    html_totals = {}
    for heading in soup.select('div.election'):
        match = HOUSE.fullmatch(heading.get_text(' ', strip=True))
        if not match:
            continue
        totals = Counter()
        for row in heading.find_next('table').select('tr')[1:]:
            party = row.select_one('td.party').get_text(strip=True)
            votes = int(row.select_one('td.ballot').get_text(strip=True).replace(',', ''))
            totals[{'REPUBLICAN': 'REP', 'DEMOCRATIC': 'DEM'}.get(party, 'OTHER')] += votes
        html_totals[int(match[1])] = totals
    assert set(html_totals) == set(range(1, 39))
    html_deltas = [dict(district=r['district'],
                        republican_delta=r['republican'] - html_totals[r['district']]['REP'],
                        democrat_delta=r['democrat'] - html_totals[r['district']]['DEM'])
                   for r in district_rows]
    write_csv('sos_summary_snapshot_differences.csv', sorted(html_deltas, key=lambda r: r['district']))

    normalize_county = lambda name: re.sub(r'[^A-Z0-9]', '', name.upper())
    name_fips = {normalize_county(name): fips for fips, name in names.items()}
    assert len(name_fips) == 254
    county_doc = json.loads((RAW / 'sos_civix_counties.json').read_text())
    counties = decode(county_doc['upload'])
    county_rows, county_sums = [], Counter()
    for county in counties.values():
        fips = name_fips[normalize_county(county['N'])]
        for race in county['Races'].values():
            match = HOUSE.fullmatch(race['N'].strip())
            if not match:
                continue
            district = int(match[1])
            for candidate in race['C'].values():
                votes = int(candidate['V'])
                county_sums[district, int(candidate['id'])] += votes
                county_rows.append(dict(county_fips=fips, county=names[fips], district=district,
                                        candidate_id=candidate['id'], candidate=candidate['N'],
                                        party=candidate['P'], votes=votes))
    assert dict(county_sums) == state, 'County returns do not reconcile to statewide House totals'
    assert len(counties) == 254
    write_csv('house_2026_county_candidates.csv', sorted(county_rows, key=lambda r: (r['county_fips'], r['district'], r['candidate_id'])))
    return county_rows, district_rows, home, html_deltas


def read_shapes(name):
    with zipfile.ZipFile(RAW / (name + '.zip')) as archive:
        files = {n.rsplit('.', 1)[-1].lower(): n for n in archive.namelist()}
        reader = shapefile.Reader(**{ext: io.BytesIO(archive.read(files[ext]))
                                    for ext in ['shp', 'shx', 'dbf']})
        crs = archive.read(files['prj']).decode().strip()
        for record in reader.iterShapeRecords():
            polygon = shape(record.shape.__geo_interface__)
            if not polygon.is_valid:
                polygon = make_valid(polygon)
            yield record.record.as_dict(), polygon, crs


def canonical_party(party):
    return {'GRN': 'GRE', 'GREEN': 'GRE', 'L': 'LIB', 'I': 'IND', 'W': 'WRITEIN',
            'WI': 'WRITEIN', 'NON': 'WRITEIN', '': 'WRITEIN'}.get(party or '', party)


def read_clarity(path, fips, county):
    with zipfile.ZipFile(path) as archive:
        xml_names = [n for n in archive.namelist() if n.lower().endswith('.xml')]
        assert len(xml_names) == 1
        root = ET.fromstring(archive.read(xml_names[0]))
    assert root.findtext('ElectionDate') == '11/3/2026'
    rows = []
    for contest in root.findall('Contest'):
        match = re.fullmatch(r'(?:United States|U\.?\s*S\.?) Representative,? District (\d+)',
                             contest.get('text', ''), flags=re.I)
        if not match:
            continue
        district = int(match[1])
        for choice in contest.findall('Choice'):
            party = canonical_party(choice.get('party'))
            methods = choice.findall('VoteType')
            method_names = [v.get('name') for v in methods]
            assert len(method_names) == len(set(method_names))
            assert not (len(method_names) > 1 and any(n.lower() in {'total', 'total votes'} for n in method_names))
            by_precinct = Counter()
            for method in methods:
                method_sum, seen = 0, set()
                for precinct in method.findall('Precinct'):
                    name = precinct.get('name')
                    assert name not in seen, 'Duplicate precinct in vote method'
                    seen.add(name)
                    votes = int(precinct.get('votes'))
                    assert votes >= 0
                    by_precinct[name] += votes
                    method_sum += votes
                assert method_sum == int(method.get('votes'))
            assert sum(by_precinct.values()) == int(choice.get('totalVotes'))
            for precinct, votes in by_precinct.items():
                if votes:
                    rows.append(dict(county_fips=fips, county=county, precinct=precinct,
                                     pctkey=precinct_key(fips, precinct), district=district, party=party,
                                     candidate=choice.get('text'), votes=votes))
    assert rows, f'No House precinct returns found in {path.name}'
    return rows, root.findtext('Timestamp')


def read_harris():
    summary = json.loads((RAW / 'harris_2026_summary.json').read_text())
    rows = []
    for contest in summary['contests']:
        match = re.fullmatch(r'United States Representative, District (\d+)', contest['t'])
        if not match:
            continue
        data = json.loads((RAW / f"harris_2026_precinct_{contest['i']}.json").read_text())
        assert data['i'] == contest['i']
        assert len(data['p']) == len(data['v']) == len(set(data['p']))
        assert all(len(v) == len(contest['ca']) for v in data['v'])
        assert [sum(v[i] for v in data['v']) for i in range(len(contest['ca']))] == contest['tv']
        for precinct, counts in zip(data['p'], data['v']):
            for label, votes in zip(contest['ca'], counts):
                party = canonical_party(re.search(r'\(([^)]+)\)$', label)[1])
                if votes:
                    rows.append(dict(county_fips='201', county='Harris', precinct=precinct,
                                     pctkey=precinct_key('201', precinct), district=int(match[1]),
                                     party=party, candidate=label, votes=int(votes)))
    return rows, summary['dt']


def precinct_returns(county_rows, names):
    """Use only county/district/party cells matching the state snapshot exactly."""
    datasets = [('439', RAW / 'tarrant_2026_detailxml.zip')]
    for pattern in ['clarity_???_*_detailxml.zip', 'bexar_2026_*_detailxml.zip']:
        files = defaultdict(list)
        for path in RAW.glob(pattern):
            fips = '029' if path.name.startswith('bexar') else path.name.split('_')[1]
            files[fips].append(path)
        for fips, paths in files.items():
            datasets.append((fips, max(paths, key=lambda p: int(p.name.split('_')[-2]))))
    parsed = [(fips, *read_clarity(path, fips, names[fips]), path.name) for fips, path in datasets]
    parsed.append(('201', *read_harris(), 'harris_2026_summary.json'))
    expected = Counter()
    for row in county_rows:
        expected[row['county_fips'], row['district'], canonical_party(row['party'])] += row['votes']
    accepted, accepted_cells, reconciliation = [], set(), []
    for fips, rows, timestamp, source in parsed:
        counts = Counter()
        for row in rows:
            counts[row['county_fips'], row['district'], row['party']] += row['votes']
        keys = set(counts) | {k for k in expected if k[0] == fips}
        for key in sorted(keys):
            match = counts[key] == expected[key]
            if match:
                accepted_cells.add(key)
            reconciliation.append(dict(county_fips=fips, county=names[fips], new_district=key[1],
                                       party=key[2], state_votes=expected[key], precinct_votes=counts[key],
                                       state_minus_precinct=expected[key] - counts[key],
                                       use_for_retabulation=match, source=source, source_updated=timestamp))
        accepted.extend(r for r in rows if (r['county_fips'], r['district'], r['party']) in accepted_cells)
        write_csv(f"{names[fips].lower()}_2026_house_precincts.csv", rows)
    write_csv('precinct_source_reconciliation.csv', reconciliation)
    write_csv('accepted_house_precincts.csv', accepted)
    return accepted, accepted_cells, reconciliation


def retabulate(cells, county_rows, precinct_rows, accepted_cells, names):
    """Conservative envelopes; do not assign split-precinct votes by surface area."""
    old_shapes = list(read_shapes('planc2193'))
    new_shapes = list(read_shapes('planc2333'))
    old_geoms = [row[1] for row in old_shapes]
    new_by_id = {int(p['District']): g for p, g, _ in new_shapes}
    tree = STRtree(old_geoms)
    old_ids = [int(row[0]['District']) for row in old_shapes]
    old_crs = old_shapes[0][2]
    assert all(r[2] == old_crs for r in old_shapes + new_shapes)
    precinct_keys = {r['pctkey'] for r in precinct_rows}
    overlaps, precinct_geoms = {}, {}
    for props, polygon, crs in read_shapes('precincts26p'):
        key = precinct_key(props['CNTY'], props['PREC'])
        if key not in precinct_keys:
            continue
        assert key not in precinct_geoms, 'Ambiguous normalized precinct identifier'
        assert crs == old_crs, 'Geometries use different coordinate reference systems'
        overlaps[key] = []
        precinct_geoms[key] = polygon
        for i in tree.query(polygon, predicate='intersects'):
            area = polygon.intersection(old_geoms[i]).area
            # Tiny positive slivers remain candidates, rather than silently dropped.
            if area > 0:
                overlaps[key].append((old_ids[i], area / polygon.area))
    unmatched = [r for r in precinct_rows if r['pctkey'] not in overlaps]
    write_csv('unmatched_precinct_labels.csv', unmatched)
    write_csv('precinct_old_map_overlap.csv', [
        dict(pctkey=key, old_district=d, area_fraction=f, geometry_vintage='2026 primary')
        for key, values in sorted(overlaps.items()) for d, f in values])
    units = []
    for row in county_rows:
        if (row['county_fips'], row['district'], canonical_party(row['party'])) in accepted_cells:
            continue
        candidates = cells[row['county_fips'], row['district']]
        assert candidates, 'No old district for county/new-district cell'
        units.append(dict(unit='county', county_fips=row['county_fips'], county=row['county'],
                          precinct='', new_district=row['district'], party=row['party'], votes=row['votes'],
                          old_districts=sorted(candidates)))
    incompatible = []
    for row in precinct_rows:
        if row['pctkey'] not in precinct_geoms:
            # For example, source labels ending in F99 have no polygon in the
            # published precinct shapefile. Keep their votes unresolved rather
            # than guessing that a numeric prefix is a residential precinct.
            units.append(dict(unit='unmatched precinct label', county_fips=row['county_fips'], county=row['county'],
                              precinct=row['precinct'], new_district=row['district'], party=row['party'],
                              votes=row['votes'], old_districts=sorted(cells[row['county_fips'], row['district']])))
            continue
        polygon = precinct_geoms[row['pctkey']]
        # If a precinct spans multiple new districts, each contest's votes belong
        # only to that contest's part. This avoids unnecessarily broad old-map bounds.
        piece = polygon.intersection(new_by_id[row['district']])
        candidates = [old_ids[i] for i in tree.query(piece, predicate='intersects')
                      if piece.intersection(old_geoms[i]).area > 0]
        if not candidates:
            incompatible.append(row)
            candidates = sorted(cells[row['county_fips'], row['district']])
        units.append(dict(unit='precinct', county_fips=row['county_fips'], county=row['county'], precinct=row['precinct'],
                          new_district=row['district'], party=row['party'], votes=row['votes'],
                          old_districts=sorted(set(candidates))))
    write_csv('retabulation_units.csv', [{**u, 'old_districts': ';'.join(map(str, u['old_districts']))}
                                         for u in units])
    write_csv('incompatible_precinct_geometry.csv', incompatible)
    lower, upper = defaultdict(Counter), defaultdict(Counter)
    fixed_votes, uncertain_votes = 0, 0
    for unit in units:
        party = unit['party'] if unit['party'] in ['REP', 'DEM'] else 'OTHER'
        if len(unit['old_districts']) == 1:
            lower[unit['old_districts'][0]][party] += unit['votes']
            fixed_votes += unit['votes']
        else:
            uncertain_votes += unit['votes']
        for district in unit['old_districts']:
            upper[district][party] += unit['votes']
    assert fixed_votes + uncertain_votes == sum(r['votes'] for r in county_rows)
    rows = []
    for district in range(1, 39):
        lo, hi = lower[district], upper[district]
        winner = 'UNRESOLVED'
        if lo['REP'] > max(hi['DEM'], hi['OTHER']):
            winner = 'REP'
        elif lo['DEM'] > max(hi['REP'], hi['OTHER']):
            winner = 'DEM'
        rows.append(dict(old_district=district, republican_min=lo['REP'], republican_max=hi['REP'],
                         democrat_min=lo['DEM'], democrat_max=hi['DEM'],
                         other_min=lo['OTHER'], other_max=hi['OTHER'], robust_party_lead=winner))
    write_csv('house_2026_old_map_bounds.csv', rows)
    pending = Counter()
    for u in units:
        if len(u['old_districts']) > 1:
            pending[u['county_fips']] += u['votes']
    write_csv('remaining_county_work.csv', [dict(county_fips=c, county=names[c],
                                               votes_without_unique_old_district=v,
                                               reason='See precinct reconciliation and geometry diagnostics')
                                          for c, v in pending.most_common()])
    return {'uniquely_assigned_votes': fixed_votes, 'unresolved_vote_locations': uncertain_votes,
            'old_map_robust_leads': dict(Counter(r['robust_party_lead'] for r in rows)),
            'matched_precincts_with_house_votes': len(overlaps),
            'unmatched_precinct_label_votes': sum(r['votes'] for r in unmatched),
            'votes_with_incompatible_primary_geometry': sum(r['votes'] for r in incompatible),
            'unresolved_counties': len(pending)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    names = county_names()
    cells, geometry = block_crosswalk(names)
    county_rows, districts, home, html_deltas = official_returns(names)
    precinct_rows, accepted_cells, reconciliation = precinct_returns(county_rows, names)
    partial = retabulate(cells, county_rows, precinct_rows, accepted_cells, names)
    summary = {
        'election': 'November 3, 2026 U.S. House only', 'results_status': 'unofficial',
        'new_plan': 'PLANC2333', 'old_plan': 'PLANC2193',
        'state_feed_version': json.loads((RAW / 'sos_civix_election.json').read_text())['Version'],
        'state_feed_last_updated_raw': home['LastUpdatedTime'],
        'house_votes': sum(r['votes'] for r in county_rows),
        'actual_new_map_party_leads': dict(Counter(r['leading_party'] for r in districts)),
        'county_to_state_reconciliation': 'All candidate totals match exactly across all 38 districts',
        'html_summary_districts_with_differences': sum(bool(r['republican_delta'] or r['democrat_delta']) for r in html_deltas),
        'precinct_counties_downloaded': len({r['county_fips'] for r in reconciliation}),
        'precinct_counties_used': len({r['county_fips'] for r in precinct_rows}),
        'precinct_reconciliation': 'Only cells with an exact county/new-district/party match to the state feed are used; other cells retain county-level uncertainty',
        'geometry': geometry, 'partial_retabulation': partial,
        'limitation': 'The statewide old-map result is not yet determined. Bounds use county/new-district totals and reconciled county precinct returns. Precinct geometry is 2026-primary vintage and needs general-election confirmation. Bounds condition on the geographic compatibility of that vintage; no surface-area vote allocation is used.',
    }
    (OUT / 'analysis_summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
