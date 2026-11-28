#!/usr/bin/env bash
# Download the raw inputs for build_data.py into RAW_DIR (default: ./raw; about 400 MB of zips, don't commit).
#   build/fetch.sh /tmp/tarrant-schools-raw && python3 build/build_data.py /tmp/tarrant-schools-raw index.html
# Keeps the 16 Tarrant County ISDs: TEA county-district numbers 2209xx (charters, 2208xx, are dropped),
# TDA contracting entities 01017-01032, and the NCES/Census district ids in LEAS below.
# Files already in RAW_DIR are reused, so a second run only fetches what is missing.
set -uo pipefail
RAW=${1:-raw}
mkdir -p "$RAW/zip" "$RAW/tea" "$RAW/tda" "$RAW/nces" "$RAW/geo"
UA="Mozilla/5.0"
T=https://tea.texas.gov
# Arlington, Birdville, Everman, Fort Worth, Grapevine-Colleyville, Keller, Mansfield, Lake Worth, Crowley, Kennedale,
# Azle, Hurst-Euless-Bedford, Castleberry, Eagle Mountain-Saginaw, Carroll, White Settlement
LEAS="4808700 4810230 4818810 4819700 4821660 4825260 4828920 4826490 4815910 4825500 4809200 4824060 4813170 4817700 4813020 4845540"
LEA_SQL=$(printf "'%s'," $LEAS); LEA_SQL=${LEA_SQL%,}

# 1. TEA PEIMS district actual financial data (one CSV per fiscal year, all Texas districts).
#    FIN_UNIT is the campus number; 7xx-999 are district-wide units.
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
  [ -s "$z" ] || curl -sSL --retry 3 -A "$UA" -o "$z" "${line#*|}" &
done
[ -s "$RAW/zip/summarized.xlsx" ] || curl -sSL --retry 3 -A "$UA" -o "$RAW/zip/summarized.xlsx" "$T/media/423296" &
wait
for z in "$RAW"/zip/a20*.zip; do
  unzip -p "$z" | awk -F, 'NR==1 || $1 ~ /^2209/' > "$RAW/tea/$(basename "$z" .zip).csv" &
done
wait
# district names and fall enrollment
python3 -I - "$RAW" <<'EOF'
import json, sys, openpyxl
raw = sys.argv[1]
ws = openpyxl.load_workbook(f"{raw}/zip/summarized.xlsx", read_only=True).worksheets[0]
rows = ws.iter_rows(values_only=True); hdr = next(rows)
out = [dict(zip(hdr, r)) for r in rows if r[0] and str(r[0]).strip("'").startswith("2209")]
json.dump(out, open(f"{raw}/tea/summ.json", "w"), default=str)
EOF

# 2. Texas Department of Agriculture meal claims (data.texas.gov Socrata ids, by program year end):
#    snp = school breakfast/lunch/snack, one row per school per month; sso = Seamless Summer Option;
#    cacfp = after-school supper. One request at a time: data.texas.gov drops parallel connections.
W="ceid between '01017' and '01032'"
for p in snp2016:6jgk-yvdf snp2017:szyy-bf94 snp2018:464k-6uwc snp2019:uuki-47ik snp2020:c9s4-hrvh snp2021:i674-5yp3 \
         snp2022:9bfr-4jjm snp2023:t9bs-zxkh snp2024:kde6-bnft snp2025:i9vs-cqmu snp2026:hqb9-8dh4 \
         sso2016:j3sb-ukcg sso2017:nxre-3isy sso2018:jvsu-enxn sso2019:rbdj-agw7 sso2020:krb3-22yq sso2021:kvxp-4a2s \
         sso2022:ti35-mz6c sso2023:iyyi-2unc sso2024:2npc-xpe8 sso2025:u4fj-has6 sso2026:9rha-ukk6 \
         cacfp2017:an2k-6aqb cacfp2018:ejee-db7j cacfp2019:2a57-dx4w cacfp2020:wjcz-ucbn cacfp2021:x2cn-nq8j \
         cacfp2022:edk4-hma7 cacfp2023:nxc9-4zzd cacfp2024:pp75-3tt8 cacfp2025:3m3y-swtq cacfp2026:y9zm-iygj; do
  f="$RAW/tda/${p%%:*}.json"
  [ -s "$f" ] || curl -sSG --retry 3 --max-time 600 "https://data.texas.gov/resource/${p#*:}.json" \
    --data-urlencode "\$where=$W" --data-urlencode '$limit=500000' -o "$f"
done

# 3. NCES Common Core of Data school directory (Urban Institute Education Data API), school years 2010-11 to 2023-24:
#    state school id (links to the TEA campus number), coordinates, enrollment, free/reduced counts, teachers
for y in $(seq 2010 2023); do
  for l in $LEAS; do
    f="$RAW/nces/dir_${y}_$l.json"
    [ -s "$f" ] || curl -sS --retry 3 --max-time 300 -o "$f" "https://educationdata.urban.org/api/v1/schools/ccd/directory/$y/?leaid=$l" &
  done
  wait
done
#    2024-25 from NCES EDGE (newest year, not yet in the Urban API)
curl -sSG --max-time 300 "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1/query" \
  --data-urlencode "where=LEAID IN ($LEA_SQL)" --data-urlencode "outFields=*" \
  --data-urlencode "returnGeometry=false" --data-urlencode "f=json" -o "$RAW/nces/edge_2425.json"

# 4. District boundaries (Census TIGERweb, current unified school districts), simplified on the server
curl -sSG --max-time 300 "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School/MapServer/0/query" \
  --data-urlencode "where=GEOID IN ($LEA_SQL)" --data-urlencode "outFields=GEOID,NAME" \
  --data-urlencode "outSR=4326" --data-urlencode "maxAllowableOffset=0.0004" --data-urlencode "geometryPrecision=4" \
  --data-urlencode "f=geojson" -o "$RAW/geo/districts.json"
echo "raw data in $RAW"
