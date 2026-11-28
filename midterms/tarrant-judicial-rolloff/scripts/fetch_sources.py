"""Download official Tarrant November general-election exports, 2010–2026."""
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import argparse
import hashlib
import io
import json
import re
import time
import zipfile
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
ARCHIVE = 'https://www.tarrantcountytx.gov/en/elections/past-election-information.html'

def get(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1)

def collect(item):
    year, page = item
    soup = BeautifulSoup(get(page), 'html.parser')
    links = [(a.get_text(' ', strip=True), urljoin(page, a['href'])) for a in soup.select('a[href]')]
    tally = next(u for t, u in links if 'tally export' in t.lower())
    pdf = next(u for t, u in links if t in ('Cumulative Report', 'Cumulative Election Results'))
    content = get(tally)
    original_hash = hashlib.sha256(content).hexdigest()
    if content[:2] == b'PK':
        archive = zipfile.ZipFile(io.BytesIO(content))
        content = archive.read(next(n for n in archive.namelist() if n.lower().endswith(('.txt', '.csv'))))
    path = RAW / f'{year}-tally.txt.gz'
    path.write_bytes(gzip.compress(content, mtime=0))
    info = dict(year=year, archive_page=page, tally_url=tally, cumulative_pdf=pdf,
                original_sha256=original_hash, tally_file=str(path.relative_to(ROOT)),
                retrieved_utc=datetime.now(timezone.utc).isoformat(), tally_available=b'Contest' in content[:1500])
    if year == 2026:
        base = next(u for t,u in links if 'clarityelections' in u).rstrip('/') + '/'
        version = get(base + 'current_ver.txt').decode().strip()
        info['clarity_version'] = version
        for kind in ('summary', 'detailxml'):
            url = f'{base}{version}/reports/{kind}.zip'
            data = get(url)
            out = RAW / f'{year}-{kind}.zip'
            out.write_bytes(data)
            info[kind + '_url'] = url
            info[kind + '_sha256'] = hashlib.sha256(data).hexdigest()
        summary_json_url = f'{base}{version}/json/en/summary.json'
        (RAW / '2026-summary.json').write_bytes(get(summary_json_url))
        info['summary_json_url'] = summary_json_url
    # Independent, human-readable control totals and certification status.
    (RAW / f'{year}-cumulative.pdf').write_bytes(get(pdf))
    (RAW / f'{year}-source.json').write_text(json.dumps(info, indent=2) + '\n')
    print(f'{year}: tally {len(content):,} bytes, available={info["tally_available"]}', flush=True)
    return info

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', type=int, nargs='*', default=[], help='Election year(s) to download again')
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    soup = BeautifulSoup(get(ARCHIVE), 'html.parser')
    pages = {}
    for a in soup.select('a[href]'):
        href = a['href']
        match = re.search(r'/(20\d\d)-archives/november', href)
        if match and int(match[1]) in range(2010, 2027, 2):
            pages[int(match[1])] = urljoin(ARCHIVE, href)
    assert set(pages) == set(range(2010, 2027, 2)), pages
    sources = []
    pending = []
    for year, page in pages.items():
        saved = RAW / f'{year}-source.json'
        if saved.exists() and year not in args.refresh:
            sources.append(json.loads(saved.read_text()))
        else:
            pending.append((year, page))
    with ThreadPoolExecutor(max_workers=9) as pool:
        sources.extend(pool.map(collect, pending))
    sources.sort(key=lambda x:x['year'])
    (ROOT / 'data' / 'sources.json').write_text(json.dumps(sources, indent=2) + '\n')

if __name__ == '__main__':
    main()
