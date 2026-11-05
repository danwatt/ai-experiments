#!/usr/bin/env python3
"""Download Texas Legislative Council 2026 precincts; export Tarrant as TopoJSON (default).

Usage:
    uv run python scripts/build_precincts.py
    uv run python scripts/build_precincts.py --zip /path/to/Precincts26P.zip
    uv run python scripts/build_precincts.py --from-geojson data/tarrant_precincts_2026.geojson
    uv run python scripts/build_precincts.py --format geojson
"""
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import zipfile

from pyproj import CRS, Transformer
import shapefile

from geojson_to_topojson import to_topology, convert_file, DEFAULT_QUANTIZATION

SOURCE_URL = (
    "https://data.capitol.texas.gov/dataset/"
    "d04c72b9-16c4-4ab2-8c6d-c666d41e04b7/resource/"
    "33ec5b30-ee4d-424f-9769-57b87cb5e311/download/precincts26p.zip"
)
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ZIP = ROOT / "data" / "source" / "precincts26p.zip"


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    print(f"Downloading official shapefile to {dest} ...", file=sys.stderr)
    try:
        req = Request(url, headers={"User-Agent": "tarrant-2026-boundaries/2.0"})
        with urlopen(req, timeout=90) as response, tmp.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        with zipfile.ZipFile(tmp) as z:
            if z.testzip() is not None:
                raise ValueError("Downloaded ZIP failed its CRC check")
        tmp.replace(dest)
    except (URLError, HTTPError, OSError, zipfile.BadZipFile, ValueError):
        tmp.unlink(missing_ok=True)
        raise


def shapefile_components(z: zipfile.ZipFile):
    """Find one shapefile dataset in a ZIP, even if files are nested."""
    names = {n.lower(): n for n in z.namelist() if not n.endswith("/")}
    roots = sorted((n[:-4] for n in names if n.endswith(".shp")),
                   key=lambda n: ("precinct" not in n, len(n)))
    for root in roots:
        if root + ".dbf" in names and root + ".shx" in names:
            return tuple(z.read(names[root + ext]) for ext in (".shp", ".shx", ".dbf")), (
                z.read(names[root + ".prj"]).decode("utf-8-sig", "replace")
                if root + ".prj" in names else None
            )
    raise ValueError("No complete .shp/.shx/.dbf shapefile found in ZIP")


def tarrant(properties: dict) -> bool:
    """Match Tarrant in either county-name or county-FIPS schemas.

    Texas Legislative Council precinct *shapefiles* use numeric CNTY,
    whereas its related precinct/district spreadsheet uses FIPS/COUNTY.
    Both identify Tarrant as county FIPS 439 (full GEOID 48439).
    """
    props = {str(k).upper(): str(v).strip() for k, v in properties.items() if v is not None}
    county = props.get("COUNTY", "").upper()
    if county in {"TARRANT", "TARRANT COUNTY"}:
        return True
    for field in ("CNTY", "FIPS", "COUNTYFP", "COUNTY_FIPS", "CNTY_FIPS", "GEOID"):
        raw = props.get(field, "")
        if raw.isdigit() and int(raw) in (439, 48439):
            return True
    return False


def reproject_geometry(geometry: dict, transformer: Transformer) -> dict:
    def coords(value):
        if value and isinstance(value[0], (int, float)):
            x, y = transformer.transform(float(value[0]), float(value[1]))
            if not (math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90):
                raise ValueError(f"Invalid WGS84 transformed coordinate: ({x}, {y})")
            # Six decimal places are ~0.1 m or better in Tarrant County.
            return [round(x, 6), round(y, 6)]
        return [coords(item) for item in value]
    return {"type": geometry["type"], "coordinates": coords(geometry["coordinates"])}


def transform(shp_zip: Path, output: Path, *, output_format: str = "topojson", quantization: int = DEFAULT_QUANTIZATION) -> int:
    with zipfile.ZipFile(shp_zip) as zip_file:
        parts, prj_text = shapefile_components(zip_file)
    if not prj_text:
        raise ValueError("Shapefile has no .prj coordinate reference file; cannot safely reproject to WGS84")
    source_crs = CRS.from_wkt(prj_text)
    transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)
    print(f"Shapefile CRS: {source_crs.to_string()} -> EPSG:4326", file=sys.stderr)
    with shapefile.Reader(shp=io.BytesIO(parts[0]), shx=io.BytesIO(parts[1]), dbf=io.BytesIO(parts[2]), encoding="utf-8", encodingErrors="replace") as r:
        field_names = [field[0] for field in r.fields[1:]]
        print(f"Shapefile fields: {', '.join(field_names)}; total records: {len(r):,}", file=sys.stderr)
        features = []
        seen = set()
        sample_properties = []
        for rec in r.iterShapeRecords():
            props = rec.record.as_dict()
            if len(sample_properties) < 3:
                sample_properties.append(props)
            if not tarrant(props) or rec.shape.shapeType == 0:
                continue
            precinct = str(props.get("PREC", props.get("PRECINCT", ""))).strip()
            if not precinct:
                raise ValueError("Found a Tarrant polygon with no PREC/PRECINCT attribute")
            geometry = rec.shape.__geo_interface__
            if geometry.get("type") not in ("Polygon", "MultiPolygon"):
                raise ValueError(f"Unexpected geometry type: {geometry.get('type')}")
            geometry = reproject_geometry(geometry, transformer)
            props["precinct"] = precinct
            # Feature id follows the shapefile's unique identifier when present.
            feature_id = str(props.get("PCTKEY") or f"439-{precinct}")
            if feature_id in seen:
                raise ValueError(f"Duplicate precinct key: {feature_id}")
            seen.add(feature_id)
            features.append({"type": "Feature", "id": feature_id, "properties": props, "geometry": geometry})
    if not features:
        raise ValueError(
            "No Tarrant County precinct polygons matched COUNTY=Tarrant or "
            "CNTY/FIPS=439. "
            f"Shapefile fields: {field_names}. "
            f"Sample attributes: {sample_properties}"
        )
    features.sort(key=lambda f: (f["properties"]["precinct"], f["id"]))
    geojson = {
        "type": "FeatureCollection",
        "name": "Tarrant County 2026 Primary Voting Precincts",
        "metadata": {
            "source": SOURCE_URL,
            "source_description": "Texas Legislative Council, 2026 primary (26P) precincts",
            "county": "Tarrant",
            "fips": "48439",
            "crs": "EPSG:4326",
            "note": "Primary 2026 boundaries; verify against November 2026 general-election precincts before joining results",
        },
        "features": features,
    }
    if output_format == "topojson":
        content = to_topology(geojson, quantization=quantization)
    else:
        content = geojson
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(features)} Tarrant features to {output} ({output.stat().st_size:,} bytes, {output_format})")
    print("Precinct examples:", ", ".join(f["properties"]["precinct"] for f in features[:10]))
    return len(features)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zip", type=Path, help="Use an already-downloaded source ZIP instead of downloading")
    parser.add_argument("--output", type=Path, help="Output path (default: data/tarrant_precincts_2026.topojson)")
    parser.add_argument("--format", choices=("topojson", "geojson"), default="topojson", help="Output format (default: topojson)")
    parser.add_argument("--from-geojson", type=Path, help="Convert an existing GeoJSON instead of reading the shapefile ZIP")
    parser.add_argument("--quantization", type=int, default=DEFAULT_QUANTIZATION, help="TopoJSON quantization grid (default: 1000000)")
    parser.add_argument("--force-download", action="store_true", help="Redownload even if ZIP is cached")
    args = parser.parse_args()
    zip_path = args.zip or DEFAULT_ZIP
    output = args.output or (ROOT / "data" / f"tarrant_precincts_2026.{args.format}")
    try:
        if args.from_geojson:
            if args.format == "topojson":
                convert_file(args.from_geojson, output, quantization=args.quantization)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(args.from_geojson.read_bytes())
                print(f"Copied GeoJSON to {output}")
        else:
            if not args.zip and (args.force_download or not zip_path.is_file()):
                download(SOURCE_URL, zip_path)
            transform(zip_path, output, output_format=args.format, quantization=args.quantization)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
