#!/usr/bin/env python3
"""Cache public Texas redistricting data and election-return source pages.

Only downloads public files. A manifest preserves URLs, retrieval times and hashes.
Run from any directory; existing downloads are reused unless --refresh is supplied.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import gzip
import csv
import json
import io
import zipfile
from collections import defaultdict
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
BASE = 'https://data.capitol.texas.gov'


def get(url, path, refresh=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists() or path.stat().st_size == 0:
        req = urllib.request.Request(url, headers={'User-Agent': 'Texas-map-comparison/1.0 (public research)'})
        with urllib.request.urlopen(req, timeout=120) as response:
            data = response.read()
        if data[:2] == b'\x1f\x8b' and path.suffix not in {'.gz', '.zip'}:
            data = gzip.decompress(data)
        if not data:
            raise ValueError('Empty download')
        if path.suffix == '.json':
            json.loads(data)
        if path.suffix == '.zip':
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                assert archive.namelist(), 'Empty ZIP archive'
        path.write_bytes(data)
        fetched = datetime.now(timezone.utc).isoformat()
        path.with_suffix(path.suffix + '.source.json').write_text(json.dumps({
            'url': url, 'retrieved_utc': fetched, 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
        }, indent=2) + '\n')
    print(f'{path.relative_to(ROOT)}: {path.stat().st_size:,} bytes', flush=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--county-indexes', action='store_true', help='Look up public vendor indexes for counties needing precinct returns')
    args = parser.parse_args()
    jobs = []
    for plan in ['planc2193', 'planc2333', 'precincts', 'vtds', '2020-census-geography']:
        path = get(BASE + '/api/3/action/package_show?id=' + plan,
                   RAW / (plan + '_metadata.json'), args.refresh)
        dataset = json.loads(path.read_text())['result']
        for resource in dataset['resources']:
            name = resource.get('name', '').lower()
            selected = name in {
                'planc2193.zip', 'planc2193_blk.zip', 'planc2333.zip', 'planc2333_blk.zip',
                'precincts26p.zip', 'precincts24g.zip', 'precincts26g.zip',
                'blocks.zip', 'blocks_pop.zip',
            }
            # Preserve the legislature's existing two-map comparison for validation.
            selected |= 'vs_planc2193_r340_election24g' in name
            if selected:
                jobs.append((resource['url'], RAW / name))
    jobs += [
        ('https://electionresults.sos.state.tx.us/results.html', RAW / 'sos_2026_results.html'),
        ('https://data.capitol.texas.gov/topic/elections', RAW / 'tlc_elections.html'),
        ('https://www.tarrantcountytx.gov/en/elections/past-election-information/2026-archives/november-3--2026--joint-general-and-special-election-results.html', RAW / 'tarrant_2026_sources.html'),
        ('https://results.enr.clarityelections.com/TX/Tarrant/127297/385548/reports/detailxml.zip', RAW / 'tarrant_2026_detailxml.zip'),
        ('https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/election/53815', RAW / 'sos_civix_election.json'),
        ('https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/election/countyInfo/53815', RAW / 'sos_civix_counties.json'),
        ('https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt', RAW / 'census_counties.txt'),
        ('https://app.harrisvotes.com/electionresults/electionday', RAW / 'harris_2026_sources.html'),
        ('https://votetravis.gov/current-election-information/', RAW / 'travis_2026_sources.html'),
        ('https://results.enr.clarityelections.com/TX/Bexar/127291/current_ver.txt', RAW / 'bexar_2026_version.txt'),
        ('https://results.enr.clarityelections.com/TX/Travis/', RAW / 'travis_clarity.html'),
        ('https://appfiles.harrisvotes.com/harrisvotes/prd/Data/1126/resultsbyballot.json', RAW / 'harris_2026_summary.json'),
    ]
    def download(job):
        try:
            return str(get(*job, refresh=args.refresh))
        except Exception as error:
            print(f'FAILED {job[0]}: {error}', flush=True)
            return {'url': job[0], 'error': str(error)}
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(download, jobs))
    if args.county_indexes:
        # Derive required counties from source block files, including on a fresh run.
        def blocks(plan):
            with zipfile.ZipFile(RAW / f'{plan}_blk.zip') as archive:
                with archive.open(archive.namelist()[0]) as stream:
                    return {r['SCTBKEY']: int(r['DISTRICT'])
                            for r in csv.DictReader(io.TextIOWrapper(stream))}
        old, new = blocks('planc2193'), blocks('planc2333')
        assert old.keys() == new.keys()
        cells = defaultdict(set)
        for key in old:
            cells[key[2:5], new[key]].add(old[key])
        needed = {c for (c, _), districts in cells.items() if len(districts) > 1}
        with (RAW / 'census_counties.txt').open() as stream:
            names = {r['COUNTYFP']: r['COUNTYNAME'].removesuffix(' County')
                     for r in csv.DictReader(stream, delimiter='|') if r['STATEFP'] == '48'}
        index_jobs = [(f"https://results.enr.clarityelections.com/TX/{names[c].replace(' ', '')}/elections.json",
                       RAW / f'clarity_index_{c}.json') for c in sorted(needed)]
        with ThreadPoolExecutor(max_workers=5) as pool:
            results.extend(pool.map(download, index_jobs))
    detail_jobs = []
    for index in RAW.glob('clarity_index_???.json'):
        fips = index.stem.rsplit('_', 1)[-1]
        for election in json.loads(index.read_text()):
            if not election['Date'].startswith('11/3/2026 '):
                continue
            base = f"https://results.enr.clarityelections.com/TX/{election['County']}/{election['EID']}/"
            path = RAW / f'clarity_{fips}_version.txt'
            result = download((base + 'current_ver.txt', path))
            results.append(result)
            if path.exists() and path.read_text().strip().isdigit():
                version = path.read_text().strip()
                detail_jobs.append((base + version + '/reports/detailxml.zip', RAW / f'clarity_{fips}_{version}_detailxml.zip'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        results.extend(pool.map(download, detail_jobs))
    version_path = RAW / 'bexar_2026_version.txt'
    if version_path.exists():
        version = version_path.read_text().strip()
        if version.isdigit():
            results.append(download((f'https://results.enr.clarityelections.com/TX/Bexar/127291/{version}/reports/detailxml.zip',
                                     RAW / f'bexar_2026_{version}_detailxml.zip')))
    summary_path = RAW / 'harris_2026_summary.json'
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
        for contest in summary['contests']:
            if 'representative' in contest['t'].lower() and ('united states' in contest['t'].lower() or 'u.s.' in contest['t'].lower()):
                contest_id = contest['i']
                results.append(download((f'https://appfiles.harrisvotes.com/harrisvotes/prd/Data/1126/pv-{contest_id}.json',
                                         RAW / f'harris_2026_precinct_{contest_id}.json')))
    (RAW / 'fetch_status.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
