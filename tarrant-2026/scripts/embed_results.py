#!/usr/bin/env python3
"""Embed compact gzip precinct votes into the offline standalone HTML."""
import argparse
import base64
import gzip
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent.parent

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--html',type=Path,default=ROOT/'index.html')
    ap.add_argument('--data',type=Path,default=ROOT/'data/precinct_results_2026.json.gz')
    ap.add_argument('--output',type=Path,default=ROOT/'dist/index.html')
    a=ap.parse_args()
    raw=a.data.read_bytes()
    obj=json.loads(gzip.decompress(raw))
    if not obj.get('rows'):
        raise SystemExit('No votes to embed. Refusing to produce a misleading map.')
    html=a.html.read_text(encoding='utf-8')
    encoded=base64.b64encode(raw).decode('ascii')
    marker=r'(<script id="embedded-precinct-results-gzip" type="text/plain">)(.*?)(</script>)'
    html,count=re.subn(marker,lambda m:m.group(1)+encoded+m.group(3),html,count=1,flags=re.S)
    if count!=1:
        raise SystemExit('HTML is missing embedded-precinct-results-gzip hook; use this package\'s index.html')
    # Ensure a newly built packed file is authoritative over stale uncompressed data.
    html,count=re.subn(r'(<script type="application/json" id="embedded-precinct-results">)(.*?)(</script>)',
                       r'\g<1>null\g<3>',html,count=1,flags=re.S)
    if count!=1:raise SystemExit('Missing existing embedded votes tag')
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(html,encoding='utf-8')
    print(f'Wrote {a.output}: {len(obj["rows"]):,} vote rows, {len(encoded):,} compressed/base64 characters, {a.output.stat().st_size:,} HTML bytes')

if __name__=='__main__':main()
