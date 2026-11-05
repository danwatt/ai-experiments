# Tarrant County 2026 Election Dashboard

Self-contained election analysis dashboard with precinct-map import support.

## Files

- `index.html` — standalone offline HTML dashboard; **TopoJSON, GeoJSON, ZIP, KML/KMZ** import, vote breakdowns, margin charts and analyses.
- `scripts/build_precincts.py` — downloads or reuses the Texas Legislative Council's 2026 precinct shapefile, selects **Tarrant County** and writes **TopoJSON** by default.
- `scripts/geojson_to_topojson.py` — dependency-free converter for a **GeoJSON file you have already generated**. Creates shared arcs and quantized/delta-encoded coordinates.
- `data/tarrant_precincts_2026.topojson` — generated from your local shapefile or GeoJSON (not included in this archive; source data lives on your Mac).

## Convert the GeoJSON you've already created

From your existing project directory:

```sh
cd ~/git/ai-experiments/tarrant-2026
uv run python scripts/geojson_to_topojson.py data/tarrant_precincts_2026.geojson
```

This outputs `data/tarrant_precincts_2026.topojson`. Your original GeoJSON is left untouched. No additional packages are needed for this conversion.

Alternatively, rerun the full builder (reuses the already-downloaded source ZIP; needs `pyshp` and `pyproj`):

```sh
uv run python scripts/build_precincts.py
```

The builder now **defaults to TopoJSON**. To regenerate GeoJSON instead:

```sh
uv run python scripts/build_precincts.py --format geojson
```

Or convert your existing GeoJSON using the builder:

```sh
uv run python scripts/build_precincts.py --from-geojson data/tarrant_precincts_2026.geojson
```

The converter quantizes coordinates to a million-step grid (sub-meter precision over Tarrant County), and deduplicates matching shared boundary arcs. It does **not** simplify polygons; map rendering applies a light visual simplification after import. To adjust precision, use `--quantization 2000000` (larger grid = finer coordinates, generally larger file).

## Load TopoJSON into the HTML

Open `index.html` in your browser, go to **Precinct Explorer**, click **Load boundaries**, and select `data/tarrant_precincts_2026.topojson`. No server or JavaScript libraries are required. To embed the loaded boundaries in a single offline HTML file, click **Save offline HTML**. Imported precinct candidate results (CSV/JSON) remain a separate dataset; TopoJSON contains boundaries, **not votes**.

## Sources and cautions

- Official source: [Texas Legislative Council 2026 Primary Election Voting Precincts](https://data.capitol.texas.gov/dataset/precincts)
- Download: [Precincts26P.zip](https://data.capitol.texas.gov/dataset/d04c72b9-16c4-4ab2-8c6d-c666d41e04b7/resource/33ec5b30-ee4d-424f-9769-57b87cb5e311/download/precincts26p.zip)
- The GIS source describes **2026 primary-election** precincts. Before joining November 3, 2026 general-election results, verify that the precinct IDs and boundaries were unchanged.
- Source field `PREC` is preserved, and a normalized `precinct` property is included. Geometry is WGS84 longitude/latitude after transformation. Retain source attribution when republishing.
