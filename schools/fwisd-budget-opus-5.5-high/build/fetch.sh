#!/usr/bin/env bash
# Download the raw inputs for build_data.py into RAW_DIR (default: ./raw; about 400 MB of zips, don't commit).
# Keeps only Fort Worth ISD rows (TEA district 220905, TDA contracting entity 01020).
#   build/fetch.sh /tmp/fwisd-raw && python3 build/build_data.py /tmp/fwisd-raw index.html
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
  curl -sSL -A "$UA" -o "$RAW/zip/a${line%%|*}.zip" "${line#*|}" &
done
curl -sSL -A "$UA" -o "$RAW/zip/b2026.zip" "$T/data-reports/financial-reports/school-finance-reports-and-data/budget2026.zip" &
curl -sSL -A "$UA" -o "$RAW/zip/summarized.xlsx" "$T/media/423296" &
wait
for z in "$RAW"/zip/*.zip; do
  n=$(basename "$z" .zip)
  unzip -p "$z" | awk -F, 'NR==1 || $1=="220905"' > "$RAW/tea/$n.csv"
done
python3 -I - "$RAW" <<'EOF'
import json, sys, openpyxl
raw = sys.argv[1]
ws = openpyxl.load_workbook(f"{raw}/zip/summarized.xlsx", read_only=True).worksheets[0]
rows = ws.iter_rows(values_only=True); hdr = next(rows)
out = [dict(zip(hdr, r)) for r in rows if r[0] and "220905" in str(r[0])]
json.dump(out, open(f"{raw}/tea/summ_fw.json", "w"), default=str)
EOF

# Texas Department of Agriculture meal reimbursement claims (data.texas.gov Socrata ids, by program year end)
W='$where=ceid=%2701020%27&$limit=50000'
get() { curl -sSL "https://data.texas.gov/resource/$2.json?$W" -o "$RAW/tda/$1.json" & }
for p in snp2016:6jgk-yvdf snp2017:szyy-bf94 snp2018:464k-6uwc snp2019:uuki-47ik snp2020:c9s4-hrvh snp2021:i674-5yp3 \
         snp2022:9bfr-4jjm snp2023:t9bs-zxkh snp2024:kde6-bnft snp2025:i9vs-cqmu snp2026:hqb9-8dh4 \
         sso2016:j3sb-ukcg sso2017:nxre-3isy sso2018:jvsu-enxn sso2019:rbdj-agw7 sso2020:krb3-22yq sso2021:kvxp-4a2s \
         sso2022:ti35-mz6c sso2023:iyyi-2unc sso2024:2npc-xpe8 sso2025:u4fj-has6 sso2026:9rha-ukk6 \
         cacfp2017:an2k-6aqb cacfp2018:ejee-db7j cacfp2019:2a57-dx4w cacfp2020:wjcz-ucbn cacfp2021:x2cn-nq8j \
         cacfp2022:edk4-hma7 cacfp2023:nxc9-4zzd cacfp2024:pp75-3tt8 cacfp2025:3m3y-swtq cacfp2026:y9zm-iygj; do
  get "${p%%:*}" "${p#*:}"
done
wait
echo "raw data in $RAW"
