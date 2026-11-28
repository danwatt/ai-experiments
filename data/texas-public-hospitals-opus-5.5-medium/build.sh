#!/bin/sh
# Rebuild everything from the official sources: download (cached in .sources/), then build.
# Needs python3 with pandas, openpyxl and xlrd (for the old .xls levy files), and pdftotext (poppler).
# Pass --refresh to download every file again.
set -e
cd "$(dirname "$0")"
python3 -I fetch_sources.py "$@"
python3 -I build_counties.py
python3 -I audited/check.py
python3 -I audited/locate_pages.py
python3 -I build_data.py
