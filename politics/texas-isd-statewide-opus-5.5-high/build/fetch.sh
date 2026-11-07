#!/usr/bin/env bash
# Download the raw inputs for build_data.py into RAW_DIR (default: ./raw; about 450 MB, don't commit).
#   build/fetch.sh /tmp/tx-raw && python3 build/build_data.py /tmp/tx-raw index.html
# TEA zips are kept whole (build_data.py streams them); zips already in RAW_DIR/zip are reused.
# TDA school-meal claims are summarized on data.texas.gov: October site rows plus monthly totals per entity.
set -euo pipefail
RAW=${1:-raw}
mkdir -p "$RAW/zip" "$RAW/tda" "$RAW/geo"
UA="Mozilla/5.0"
T=https://tea.texas.gov

# TEA PEIMS district actual financial data (one CSV per fiscal year, every Texas district)
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
# TEA recapture paid by district, FY1994-FY2027 (FY2026 near-final, FY2027 preliminary)
curl -sSL -A "$UA" -o "$RAW/zip/recapture-paid.xlsx" "$T/about-tea/state-funding/state-funding-reports-and-data/recapture-paid-by-district.xlsx" &
# County outlines (Census, via plotly's sample GeoJSON); build_data.py keeps Texas (FIPS 48) only
[ -s "$RAW/geo/counties.json" ] || curl -sSL -o "$RAW/geo/counties.json" https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json &
wait

# Texas Department of Agriculture school meal claims (data.texas.gov Socrata ids, by program year end).
# 2016-2018 use older column names. One request at a time: data.texas.gov drops parallel connections.
q() { curl -sSG --retry 3 "https://data.texas.gov/resource/$1.json" --data-urlencode "\$select=$2" --data-urlencode "\$where=$3" \
        ${4:+--data-urlencode "\$group=$4"} --data-urlencode '$limit=500000' -o "$5"; }
ED="typeofagency='Educational Institution'"
for p in 2016:6jgk-yvdf 2017:szyy-bf94 2018:464k-6uwc 2019:uuki-47ik 2020:c9s4-hrvh 2021:i674-5yp3 \
         2022:9bfr-4jjm 2023:t9bs-zxkh 2024:kde6-bnft 2025:i9vs-cqmu 2026:hqb9-8dh4; do
  y=${p%%:*}; id=${p#*:}
  if [ "$y" -le 2018 ]; then F=freeeligibleqty R=reducedeligibleqty C="''"; else F=freeeligqty R=redceligqty C=countydistrictcode; fi
  q "$id" "ceid,cename,esc,cecounty,$C as cdc,enrollmentqty as e,$F as f,$R as r" "$ED AND date_extract_m(claimdate)=10" "" "$RAW/tda/oct$y.json"
  q "$id" "ceid,date_trunc_ym(claimdate) as m,sum(totalreimbursement::number) as reimb,sum(lunchtotal::number) as l,sum(breakfasttotal::number) as b" \
    "$ED" "ceid,m" "$RAW/tda/mon$y.json"
done
echo "raw data in $RAW"
