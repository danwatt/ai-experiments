"""Fetch the public BLS/FRED observations used by the static explorer."""
import csv
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen

SERIES = {
    'gas': 'APUS37A74714',
    'cpiDfw': 'CUURA316SA0',
    'cpiUs': 'CPIAUCNS',
    'wage': 'SMU48191000500000003',
}
ROOT = Path(__file__).parent / 'dist' / 'data'
ROOT.mkdir(exist_ok=True, parents=True)

def fetch(item):
    key, series = item
    url = f'https://fred.stlouisfed.org/data/{series}'
    raw = urlopen(url, timeout=20).read().decode('utf-8-sig')
    pairs = re.findall(r'(\d{4}-\d{2}-\d{2})\s*</td>\s*<td[^>]*>\s*([\d.]+)', raw)
    if not pairs:
        pairs = re.findall(r'(\d{4}-\d{2}-\d{2})\s*</th>\s*<td[^>]*>\s*([\d.]+)', raw)
    pairs += re.findall(r'#(\d{4}-\d{2}-\d{2})\|([\d.]+)', raw)
    observations = {date: float(value) for date, value in pairs if value != '.' and '1978-01-01' <= date <= '2026-11-04'}
    if len(observations) < 100:
        raise ValueError(f'Unexpected observation count: {series}: {len(observations)}')
    if max(observations) < '2026-01-01':
        raise ValueError(f'Truncated source table: {series}')
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['observation_date', series])
    writer.writerows(observations.items())
    (ROOT / f'{series}.csv').write_text(output.getvalue())
    print(key, len(observations), list(observations.items())[-2:])
    return key, observations

if __name__ == '__main__':
    values = dict(fetch(item) for item in SERIES.items())
    result = {'asOf': '2026-11-04', 'series': SERIES, 'observations': values}
    (ROOT / 'observations.json').write_text(json.dumps(result, separators=(',', ':')))
