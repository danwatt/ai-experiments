"""Download FWISD primary sources and preserve layout-aware text for auditability."""
import concurrent.futures, hashlib, json, pathlib, re, subprocess
import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent
SOURCES = ROOT / 'sources'
PAGES = {
    'adopted': 'https://www.fwisd.org/departments/budget/budget-documents/adopted-budgets',
    'book': 'https://www.fwisd.org/departments/budget/budget-documents/official-budget-books',
    'acfr': 'https://www.fwisd.org/departments/financial-services/financial-required-postings/annual-comprehensive-financial-reports-acfr',
}

def download(item):
    path = SOURCES / (item['id'] + '.pdf')
    if not path.exists():
        r = requests.get(item['url'], timeout=120)
        r.raise_for_status()
        assert r.content.startswith(b'%PDF'), item
        path.write_bytes(r.content)
    subprocess.run(['pdftotext', '-layout', str(path), str(path.with_suffix('.txt'))], check=True)
    item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    item['pdf_pages'] = len(path.with_suffix('.txt').read_text().split('\f')) - 1
    print(item['id'], item['pdf_pages'], flush=True)
    return item

def main():
    SOURCES.mkdir(exist_ok=True)
    items = []
    for kind, url in PAGES.items():
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, 'html.parser')
        for a in soup.select('a[href]'):
            label, link = a.get_text(' ', strip=True), a['href']
            if '.pdf' not in link.lower() or not re.search(r'Budget|Financial Report', label):
                continue
            years = re.findall(r'20\d\d', label)
            year = int(years[0])
            if kind == 'acfr' and year < 2016:
                continue
            items.append(dict(id=f'{kind}-{year}', kind=kind, year=year, label=label, url=link, index_url=url))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        items = list(pool.map(download, items))
    (ROOT / 'source-manifest.json').write_text(json.dumps(items, indent=2)+'\n')
    # These two tables are embedded images, so plain text extraction misses them.
    # The 2017 final snack amount has one OCR character corrected in build_data.py.
    for sid, page in [('acfr-2017',152),('book-2025',16),('book-2025',29)]:
        out=SOURCES/f'{sid}-p{page}'
        if out.with_suffix('.txt').exists():
            continue
        subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-scale-to','2200',
                        '-png','-singlefile',str(SOURCES/f'{sid}.pdf'),str(out)],check=True)
        subprocess.run(['tesseract',str(out)+'.png',str(out),'--psm','6'],check=True)

if __name__ == '__main__':
    main()
