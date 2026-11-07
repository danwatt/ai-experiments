#!/usr/bin/env bash
# Download the raw inputs for build_data.py into RAW_DIR (default: ./raw; don't commit).
#   build/fetch.sh /tmp/fw-schools-raw && python3 build/build_data.py /tmp/fw-schools-raw index.html
# Districts: Fort Worth (TEA 220905, NCES 4819700, TDA 01020), Lake Worth (220910, 4826490, 01024),
#            Castleberry (220917, 4813170, 01029), Eagle Mountain-Saginaw (220918, 4817700, 01030).
# TEA zips already in RAW_DIR/zip are reused (about 400 MB if downloaded).
set -euo pipefail
RAW=${1:-raw}
mkdir -p "$RAW/zip" "$RAW/tea" "$RAW/tda" "$RAW/nces" "$RAW/geo"
UA="Mozilla/5.0"
T=https://tea.texas.gov
TEA_IDS="220905|220910|220917|220918"
LEAS="4819700 4826490 4813170 4817700"

# 1. TEA PEIMS district actual financial data; FIN_UNIT is the campus number (7xx-999 = district-wide)
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
wait
for z in "$RAW"/zip/a20*.zip; do
  unzip -p "$z" | awk -F, -v re="^($TEA_IDS)\$" 'NR==1 || $1 ~ re' > "$RAW/tea/$(basename "$z" .zip).csv" &
done
wait

# 2. TDA school-meal claims, one row per school per month (one request at a time; data.texas.gov drops parallel ones)
W="ceid in('01020','01024','01029','01030')"
for p in snp2016:6jgk-yvdf snp2017:szyy-bf94 snp2018:464k-6uwc snp2019:uuki-47ik snp2020:c9s4-hrvh snp2021:i674-5yp3 \
         snp2022:9bfr-4jjm snp2023:t9bs-zxkh snp2024:kde6-bnft snp2025:i9vs-cqmu snp2026:hqb9-8dh4; do
  curl -sSG --retry 3 "https://data.texas.gov/resource/${p#*:}.json" --data-urlencode "\$where=$W" --data-urlencode '$limit=100000' \
    -o "$RAW/tda/${p%%:*}.json"
done

# 3. NCES Common Core of Data school directory (via the Urban Institute Education Data API), school years 2010-11 to 2023-24:
#    state school id (seasch) to link TEA campus numbers, coordinates, enrollment, free/reduced counts, teachers
for y in $(seq 2010 2023); do
  for l in $LEAS; do
    f="$RAW/nces/dir_${y}_$l.json"
    [ -s "$f" ] || curl -sS --retry 3 --max-time 300 -o "$f" "https://educationdata.urban.org/api/v1/schools/ccd/directory/$y/?leaid=$l"
  done
done
#    2024-25 from NCES EDGE (newest year, not yet in the Urban API)
curl -sSG --max-time 300 "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1/query" \
  --data-urlencode "where=LEAID IN ('4819700','4826490','4813170','4817700')" --data-urlencode "outFields=*" \
  --data-urlencode "returnGeometry=false" --data-urlencode "f=json" -o "$RAW/nces/edge_2425.json"

# 4. District boundaries (Census TIGERweb, current unified school districts), simplified on the server
curl -sSG --max-time 300 "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School/MapServer/0/query" \
  --data-urlencode "where=GEOID IN ('4819700','4826490','4813170','4817700')" --data-urlencode "outFields=GEOID,NAME" \
  --data-urlencode "outSR=4326" --data-urlencode "maxAllowableOffset=0.0003" --data-urlencode "geometryPrecision=5" \
  --data-urlencode "f=geojson" -o "$RAW/geo/districts.json"
echo "raw data in $RAW"
