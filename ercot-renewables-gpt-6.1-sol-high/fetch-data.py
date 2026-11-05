#!/usr/bin/env python3
"""Fetch official ERCOT fuel-mix workbooks and extract published monthly energy.

Requires Python 3, openpyxl and xlrd. The browser does not need these packages.
Run: python3 fetch-data.py [--cache /tmp/ercot-source] [--refresh]
"""
import argparse
import calendar
import concurrent.futures
import csv
import hashlib
import json
import re
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import openpyxl
import xlrd

ROOT = Path(__file__).resolve().parent
PAGE = 'https://www.ercot.com/gridinfo/generation/index.html'
FUELS = ['wind', 'solar', 'hydro', 'biomass', 'nuclear', 'gas', 'coal', 'other']
ALIASES = {'wnd': 'wind', 'wind': 'wind', 'oth': 'other', 'other': 'other',
           'gas': 'gas', 'gas-cc': 'gas', 'gas_cc': 'gas', 'gas_gt': 'gas',
           'coal': 'coal', 'hydro': 'hydro', 'biomass': 'biomass',
           'solar': 'solar', 'nuclear': 'nuclear', 'wsl': 'storageNet'}


def extract(cache):
    records, provenance = [], []
    by_year = {}
    for path in sorted(cache.glob('*.xls*')):
        match = re.search(r'(20\d{2})$', path.stem)
        if match:
            # Prefer the official filename over a locally renamed cache copy.
            by_year[int(match[1])] = path
    for year, path in sorted(by_year.items()):
        provenance.append({'year': year, 'file': path.name,
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        if path.suffix == '.xls':
            book = xlrd.open_workbook(path)
            if year == 2007:
                # The 2007 annual tab has no monthly columns. Sum Daily MWH,
                # never the interval columns (which are already interval energy).
                for month in range(1, 13):
                    sheet = book.sheet_by_name(f'{calendar.month_abbr[month]}2007')
                    r = {'date': f'{year}-{month:02}', **dict.fromkeys(FUELS, 0),
                         'storageNet': 0, 'settlement': 'Historical'}
                    for i in range(1, sheet.nrows):
                        label, value = sheet.row_values(i)[:2]
                        if not isinstance(value, (int, float)):
                            continue
                        fuel = ALIASES[str(label).rsplit(' - ', 1)[-1].strip().lower()]
                        r[fuel] += value / 1000
                    records.append(r)
                annual = book.sheet_by_name('2007')
                for i in range(1, 7):
                    fuel = ALIASES[annual.cell_value(i, 0).lower()]
                    assert abs(sum(r[fuel] for r in records) - annual.cell_value(i, 1)/1000) < .01
                continue
            sheet = book.sheet_by_name('2015 Summary' if year == 2015 else str(year))
            rows = [sheet.row_values(i) for i in range(min(30, sheet.nrows))]
            unit = 1000  # MWh -> GWh
        else:
            book = openpyxl.load_workbook(path, read_only=True, data_only=True)
            sheet = book['Summary' if 'Summary' in book.sheetnames else str(year)]
            rows = list(sheet.iter_rows(max_row=35, max_col=15, values_only=True))
            unit = 1000 if year == 2016 else 1
        header = next(r for r in rows if any(str(c).startswith('Jan') for c in r))
        columns = [next(i for i, c in enumerate(header) if str(c).startswith(calendar.month_abbr[m]))
                   for m in range(1, 13)]
        total = next(r for r in rows if str(r[0]).lower() == 'total')
        fuel_rows = [r for r in rows if str(r[0]).lower() in ALIASES]
        for month, col in enumerate(columns, 1):
            if not isinstance(total[col], (float, int)) or total[col] <= 0:
                continue  # Unpublished months remain missing, not zero.
            record = {'date': f'{year}-{month:02}', **dict.fromkeys(FUELS, 0), 'storageNet': 0,
                      'settlement': 'Final' if '*' in str(header[col]) else ('Initial' if year >= 2017 else 'Historical')}
            for row in fuel_rows:
                record[ALIASES[str(row[0]).lower()]] += (row[col] or 0) / unit
            # ERCOT's reported Total includes signed WSL. Keep WSL separate:
            # it represents charging load, not a primary generation source.
            record['reportedTotal'] = total[col] / unit
            assert abs(sum(record[k] for k in FUELS) + record['storageNet'] - record['reportedTotal']) < .002, record
            records.append(record)
        if path.suffix == '.xlsx':
            book.close()
    records.sort(key=lambda r: r['date'])
    for record in records:
        for key in FUELS + ['storageNet', 'reportedTotal']:
            if key in record:
                record[key] = round(record[key], 6)
        record['total'] = round(sum(record[k] for k in FUELS), 6)
        record['renewables'] = round(sum(record[k] for k in ['wind', 'solar', 'hydro', 'biomass']), 6)
    assert len({r['date'] for r in records}) == len(records)
    return records, provenance


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('/tmp/ercot-source'))
    parser.add_argument('--refresh', action='store_true', help='Redownload source reports and replace cached annual files')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    html = urllib.request.urlopen(PAGE).read().decode()
    urls = list(dict.fromkeys(re.findall(r'href="([^"]+(?:IntGen|FuelMix)[^"]*)', html, re.I)))
    urls = [u for u in urls if u.lower().endswith(('.zip', '.xlsx'))]

    def download(url):
        name = 'history.zip' if url.endswith('.zip') else url.rsplit('/', 1)[-1]
        destination = args.cache / name
        if args.refresh or not destination.exists():
            temporary = destination.with_suffix(destination.suffix + '.download')
            urllib.request.urlretrieve(url, temporary)
            temporary.replace(destination)
        if destination.suffix == '.zip':
            with zipfile.ZipFile(destination) as archive:
                for member in archive.infolist():
                    if Path(member.filename).name != member.filename:
                        raise ValueError('Unexpected archive path')
                    if args.refresh or not (args.cache / member.filename).exists():
                        archive.extract(member, args.cache)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, urls))
    records, provenance = extract(args.cache)
    data = {'metadata': {'title': 'ERCOT monthly generation by fuel', 'unit': 'GWh',
                        'retrieved': date.today().isoformat(), 'sourcePage': PAGE, 'sources': urls,
                        'workbooks': provenance,
                        'method': 'Published monthly totals; 2007 sums daily MWh. Gas combines Gas and Gas-CC. Generation excludes signed WSL (storage load). Renewables = wind + solar + hydro + separately reported biomass. Unreported fuel categories remain zero in the harmonized series; they may be included in Other in early years. Other preserves signed source values.'},
            'months': records}
    (ROOT / 'data.js').write_text('/* Official ERCOT fuel-mix snapshot. See fetch-data.py and README.md. */\nwindow.ERCOT_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    with (ROOT / 'ercot-monthly.csv').open('w') as f:
        columns = ['date', *FUELS, 'storageNet', 'total', 'renewables', 'settlement']
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(records)
    print(f'{len(records)} months: {records[0]["date"]} to {records[-1]["date"]}')
    for year in [2007, 2015, 2025, 2026]:
        rs = [r for r in records if r['date'].startswith(str(year))]
        total = sum(r['total'] for r in rs)
        print(year, len(rs), 'months', round(total/1000, 2), 'TWh', round(100*sum(r['renewables'] for r in rs)/total, 2), '% renewables')


if __name__ == '__main__':
    main()
