#!/usr/bin/env bash
# Download the raw inputs for build_data.py into RAW_DIR (default: ./raw; about 400 MB of zips, don't commit).
# Keeps only the 16 Tarrant County ISDs (TEA county-district numbers 2209xx; charters, 2208xx, are dropped).
# Zips already in RAW_DIR/zip are reused.
#   build/fetch.sh /tmp/tarrant-raw && python3 build/build_data.py /tmp/tarrant-raw index.html
set -euo pipefail
RAW=${1:-raw}
mkdir -p "$RAW/tea" "$RAW/tda" "$RAW/zip"
UA="Mozilla/5.0"
T=https://tea.texas.gov

# TEA PEIMS district actual financial data (one CSV per fiscal year, all Texas districts)
ACT="
2011|https://rptsvr1.tea.texas.gov/school.finance/forecasting/downloads/Actual_Singlefile/2011Actual.zip
2012|$T/data-reports/financial-reports/school-finance-reports-and-data/district-final-actual-data-2011-12.zip
2013|$T/WorkArea/linkit.aspx?LinkIdentifier=id&ItemID=25769810372
2014|$T/WorkArea/linkit.aspx?LinkIdentifier=id&ItemID=25769820605
2015|$T/WorkArea/linkit.aspx?LinkIdentifier=id&ItemID=25769825543
2016|$T/sites/default/files/ACTget2016.zip
2017|$T/sites/default/files/ACTget2017.zip
2018|$T/sites/default/files/ACTget2018.zip
2019|$T/sites/default/files/ACTget2019.zip
2020|$T/sites/default/files/actget2020.zip
2021|$T/about-tea/state-funding/state-funding-reports-and-data/actget2021.zip
2022|$T/about-tea/state-funding/state-funding-reports-and-data/actget2022.zip
2023|$T/data-reports/financial-reports/school-finance-reports-and-data/actget2023.zip
2024|$T/data-reports/financial-reports/school-finance-reports-and-data/actget2024.zip
2025|$T/media/423221
"
for line in $ACT; do
  z="$RAW/zip/a${line%%|*}.zip"
  [ -s "$z" ] || curl -sSL -A "$UA" -o "$z" "${line#*|}" &
done
[ -s "$RAW/zip/summarized.xlsx" ] || curl -sSL -A "$UA" -o "$RAW/zip/summarized.xlsx" "$T/media/423296" &
wait
for z in "$RAW"/zip/a20*.zip; do
  n=$(basename "$z" .zip)
  unzip -p "$z" | awk -F, 'NR==1 || $1 ~ /^2209/' > "$RAW/tea/$n.csv" &
done
wait
python3 -I - "$RAW" <<'EOF'
import json, sys, openpyxl
raw = sys.argv[1]
ws = openpyxl.load_workbook(f"{raw}/zip/summarized.xlsx", read_only=True).worksheets[0]
rows = ws.iter_rows(values_only=True); hdr = next(rows)
out = [dict(zip(hdr, r)) for r in rows if r[0] and str(r[0]).strip("'").startswith("2209")]
json.dump(out, open(f"{raw}/tea/summ.json", "w"), default=str)
EOF

# Texas Department of Agriculture school meal claims (data.texas.gov Socrata ids, by program year end)
# Contracting-entity ids 01017-01032 are the 16 Tarrant ISDs (older datasets lack countydistrictcode)
W="\$where=ceid between '01017' and '01032'&\$limit=200000"
for p in snp2016:6jgk-yvdf snp2017:szyy-bf94 snp2018:464k-6uwc snp2019:uuki-47ik snp2020:c9s4-hrvh snp2021:i674-5yp3 \
         snp2022:9bfr-4jjm snp2023:t9bs-zxkh snp2024:kde6-bnft snp2025:i9vs-cqmu snp2026:hqb9-8dh4; do
  # one at a time: data.texas.gov drops parallel connections
  curl -sSG --retry 3 "https://data.texas.gov/resource/${p#*:}.json" --data-urlencode "${W%%&*}" --data-urlencode "${W#*&}" \
    -o "$RAW/tda/${p%%:*}.json"
done
echo "raw data in $RAW"
