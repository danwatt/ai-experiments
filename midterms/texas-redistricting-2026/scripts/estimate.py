#!/usr/bin/env python3
"""Estimate split reporting units using Census population; preserve all vote totals.

Default: missing county precinct returns remain pending. --model-missing-counties
also allocates county/new-district totals by population. That extra model assumes
uniform party preferences within those much larger units and is substantially weaker.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree

from analyze import RAW, OUT, load_blocks, precinct_key, read_shapes, write_csv


def load_units():
    with (OUT / 'retabulation_units.csv').open() as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        for field in ['votes', 'new_district']:
            row[field] = int(row[field])
        row['old_districts'] = [int(d) for d in row['old_districts'].split(';')]
    return rows


def population_weights(units):
    keys = sorted({precinct_key(u['county_fips'], u['precinct'])
                   for u in units if u['unit'] == 'precinct' and len(u['old_districts']) > 1})
    fingerprint = hashlib.sha256(json.dumps([
        keys, *[json.loads((RAW / (name + '.source.json')).read_text())['sha256']
                for name in ['blocks.zip', 'blocks_pop.zip', 'precincts26p.zip',
                             'planc2193_blk.zip', 'planc2333_blk.zip']],
        'population-point-crosswalk-v1',
    ]).encode()).hexdigest()
    cache = OUT / 'population_weights.json'
    if cache.exists():
        value = json.loads(cache.read_text())
        if value.get('fingerprint') == fingerprint:
            return value

    old, new = load_blocks('planc2193'), load_blocks('planc2333')
    populations = {}
    county = defaultdict(lambda: [0.0, 0.0, 0.0])
    with zipfile.ZipFile(RAW / 'blocks_pop.zip') as archive:
        with archive.open(archive.namelist()[0]) as stream:
            for row in csv.DictReader(io.TextIOWrapper(stream)):
                key = row['SCTBKEY']
                assert key not in populations
                pop, vap, area = int(row['total']), int(row['vap']), float(row['Shape_Ar_1'])
                populations[key] = (pop, vap)
                weights = county[key[2:5], new[key], old[key]]
                weights[0] += pop
                weights[1] += vap
                weights[2] += area
    assert populations.keys() == old.keys() == new.keys()
    assert sum(p[0] for p in populations.values()) == 29145505
    assert sum(p[1] for p in populations.values()) == 21866700

    wanted = set(keys)
    precincts = {}
    crs = None
    for props, geom, projection in read_shapes('precincts26p'):
        key = precinct_key(props['CNTY'], props['PREC'])
        if key in wanted:
            assert key not in precincts
            precincts[key] = geom
            crs = projection
    ids = list(precincts)
    geoms = [precincts[key] for key in ids]
    tree = STRtree(geoms)
    wanted_counties = {key.split(':')[0] for key in ids}
    precinct = defaultdict(lambda: [0.0, 0.0, 0.0])
    examined = assigned = 0
    # Stream the large shapefile. Only inhabited blocks in relevant counties
    # need geometry; block-to-congress assignments come from official block files.
    with zipfile.ZipFile(RAW / 'blocks.zip') as archive:
        files = {n.rsplit('.', 1)[-1].lower(): n for n in archive.namelist()}
        assert archive.read(files['prj']).decode().strip() == crs
        with archive.open(files['shp']) as shp, archive.open(files['dbf']) as dbf, archive.open(files['shx']) as shx:
            reader = shapefile.Reader(shp=shp, dbf=dbf, shx=shx)
            for i, record in enumerate(reader.iterRecords(fields=['SCTBKEY', 'CNTY'])):
                block = record['SCTBKEY']
                if record['CNTY'].zfill(3) not in wanted_counties:
                    continue
                pop, vap = populations[block]
                if pop == 0:
                    continue
                point = shape(reader.shape(i).__geo_interface__).representative_point()
                hits = tree.query(point, predicate='within')
                examined += 1
                if len(hits) == 1:
                    pk = ids[hits[0]]
                    weights = precinct[pk, new[block], old[block]]
                    weights[0] += pop
                    weights[1] += vap
                    assigned += 1
                if examined % 25000 == 0:
                    print(f'Examined {examined:,} inhabited blocks; {assigned:,} in split reporting precincts', flush=True)

    old_shapes = list(read_shapes('planc2193'))
    new_shapes = {int(p['District']): g for p, g, _ in read_shapes('planc2333')}
    for unit in units:
        if unit['unit'] != 'precinct' or len(unit['old_districts']) <= 1:
            continue
        pk = precinct_key(unit['county_fips'], unit['precinct'])
        piece = precincts[pk].intersection(new_shapes[unit['new_district']])
        for props, geom, _ in old_shapes:
            district = int(props['District'])
            if district in unit['old_districts']:
                precinct[pk, unit['new_district'], district][2] = piece.intersection(geom).area
    value = dict(fingerprint=fingerprint,
                 county=[[c, n, o, *w] for (c, n, o), w in county.items()],
                 precinct=[[p, n, o, *w] for (p, n, o), w in precinct.items()],
                 inhabited_blocks_examined=examined, inhabited_blocks_in_split_precincts=assigned,
                 method='Census block population assigned to primary precincts by a point inside the block; official block equivalency determines old/new congressional districts')
    cache.write_text(json.dumps(value, separators=(',', ':')) + '\n')
    return value


def estimate(units, weights, model_counties):
    county = {(c, n, o): (pop, vap, area) for c, n, o, pop, vap, area in weights['county']}
    precinct = {(p, n, o): (pop, vap, area) for p, n, o, pop, vap, area in weights['precinct']}
    result = {method: defaultdict(Counter) for method in ['population', 'voting_age', 'area']}
    unknown = defaultdict(Counter)
    missing_county_major = Counter()
    modeled_county = defaultdict(float)
    modeled_split = defaultdict(float)
    allocation_rows = []
    unallocated_actual = Counter()
    for index, unit in enumerate(units):
        options = unit['old_districts']
        party = unit['party'] if unit['party'] in ['REP', 'DEM'] else 'OTHER'
        if len(options) == 1:
            for method in result:
                result[method][options[0]][party] += unit['votes']
            continue
        kind = unit['unit']
        if kind != 'precinct' and not model_counties:
            for method in result:
                unallocated_actual[method] += unit['votes']
            for district in options:
                unknown[district][party] += unit['votes']
                if kind == 'county' and party in {'REP', 'DEM'}:
                    missing_county_major[district] += unit['votes']
            continue
        if kind == 'precinct':
            key = precinct_key(unit['county_fips'], unit['precinct'])
            raw = {d: precinct.get((key, unit['new_district'], d), (0, 0, 0)) for d in options}
        else:
            raw = {d: county.get((unit['county_fips'], unit['new_district'], d), (0, 0, 0)) for d in options}
        for method, position in [('population', 0), ('voting_age', 1), ('area', 2)]:
            amounts = {d: raw[d][position] for d in options}
            fallback = ''
            if sum(amounts.values()) == 0:
                amounts = {d: raw[d][0] for d in options}
                fallback = 'total population'
            if sum(amounts.values()) == 0:
                amounts = {d: raw[d][2] for d in options}
                fallback = 'area: zero 2020 population'
            if sum(amounts.values()) == 0:
                unallocated_actual[method] += unit['votes']
                for district in options:
                    if method == 'voting_age':
                        unknown[district][party] += unit['votes']
                continue
            denominator = sum(amounts.values())
            assert denominator > 0
            for district, amount in amounts.items():
                votes = unit['votes'] * amount / denominator
                result[method][district][party] += votes
                if method == 'voting_age':
                    (modeled_split if kind == 'precinct' else modeled_county)[district] += votes
                    allocation_rows.append(dict(unit=index, county=unit['county'], precinct=unit['precinct'],
                                                new_district=unit['new_district'], old_district=district,
                                                party=party, estimated_votes=votes, source_unit=kind,
                                                fallback=fallback))
    write_csv('estimated_vote_allocations.csv', allocation_rows)
    rows = []
    for district in range(1, 39):
        base = result['voting_age'][district]
        margins, winners = {}, set()
        for method in result:
            counts = result[method][district]
            total = counts['REP'] + counts['DEM']
            margins[method] = 100 * (counts['DEM'] - counts['REP']) / total if total else 0
            winners.add('DEM' if counts['DEM'] > counts['REP'] else 'REP')
        incomplete = sum(unknown[district].values())
        lead = 'DEM' if base['DEM'] > base['REP'] else 'REP'
        could_flip_unknown = (base['DEM'] - base['REP'] <= unknown[district]['REP']
                              if lead == 'DEM' else base['REP'] - base['DEM'] <= unknown[district]['DEM'])
        pending = missing_county_major[district] > 0 or (incomplete > 0 and could_flip_unknown)
        rows.append(dict(old_district=district, status='PENDING' if pending else 'ESTIMATE',
                         estimated_republican_votes=round(base['REP'], 2), estimated_democrat_votes=round(base['DEM'], 2),
                         estimated_other_votes=round(base['OTHER'], 2),
                         estimated_party_lead='' if pending else lead,
                         voting_age_dem_minus_rep_pp=round(margins['voting_age'], 6),
                         population_dem_minus_rep_pp=round(margins['population'], 6),
                         area_dem_minus_rep_pp=round(margins['area'], 6),
                         allocation_changes_leading_party=len(winners) > 1,
                         unlocated_votes_max=incomplete,
                         missing_county_major_party_votes_max=missing_county_major[district],
                         estimated_from_county_totals=round(modeled_county[district], 2),
                         estimated_from_split_precincts=round(modeled_split[district], 2)))
    write_csv('house_2026_old_map_estimates.csv', rows)
    actual = sum(u['votes'] for u in units)
    ledger = []
    for method, counts in result.items():
        allocated = sum(sum(v.values()) for v in counts.values())
        assert abs(allocated + unallocated_actual[method] - actual) < 0.01, f'{method}: lost or duplicated votes'
        ledger.append(dict(allocation=method, actual_2026_house_votes=actual,
                           geographically_allocated_votes=round(allocated, 6),
                           votes_left_unallocated=unallocated_actual[method]))
        if model_counties:
            assert abs(allocated - actual) < 0.01, f'{method}: vote total not preserved'
        else:
            assert allocated <= actual + 0.01
    write_csv('estimate_vote_conservation.csv', ledger)
    summary = dict(model_missing_counties=model_counties,
                   modeled_party_leads=dict(Counter(r['estimated_party_lead'] or 'PENDING' for r in rows)),
                   allocation_sensitive_districts=[r['old_district'] for r in rows if r['status'] != 'PENDING' and r['allocation_changes_leading_party']],
                   close_districts=[r['old_district'] for r in rows if r['status'] != 'PENDING' and abs(r['voting_age_dem_minus_rep_pp']) < 5],
                   warning='Allocation scenarios are assumptions, not confidence intervals. Estimates hold actual 2026 House voting behavior fixed. 2020 population may misrepresent 2026 growth and turnout. Primary precinct geography needs November validation. A district with unlocated votes can show an estimated party lead only if those unlocated votes cannot reverse it under that allocation scenario.')
    (OUT / 'estimate_summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-missing-counties', action='store_true')
    args = parser.parse_args()
    units = load_units()
    weights = population_weights(units)
    estimate(units, weights, args.model_missing_counties)


if __name__ == '__main__':
    main()
