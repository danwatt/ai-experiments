#!/usr/bin/env python3
"""Convert precinct polygons from WGS84 GeoJSON to compact shared-arc TopoJSON.

Standalone pure-Python conversion (no additional dependencies):
    uv run python scripts/geojson_to_topojson.py data/tarrant_precincts_2026.geojson

Uses quantization, shared topological boundary arcs, and delta-encoded coordinates.
Does not simplify geometry, so existing precinct boundaries are not intentionally removed.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path

DEFAULT_QUANTIZATION = 1_000_000


def to_topology(geojson: dict, *, quantization: int = DEFAULT_QUANTIZATION) -> dict:
    """Create a valid TopoJSON topology with reusable boundary arcs for polygons."""
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        raise ValueError("Expected a GeoJSON FeatureCollection")
    features = geojson.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("No GeoJSON features to convert")
    if quantization < 1000 or quantization > 10_000_000:
        raise ValueError("Quantization must be between 1,000 and 10,000,000")

    points = []
    for feature in features:
        geom = feature.get("geometry") or {}
        typ = geom.get("type")
        if typ not in ("Polygon", "MultiPolygon"):
            raise ValueError(f"Unsupported geometry type: {typ}; only Polygon/MultiPolygon supported")
        polys = [geom["coordinates"]] if typ == "Polygon" else geom["coordinates"]
        for poly in polys:
            for ring in poly:
                for p in ring:
                    if len(p) < 2 or not math.isfinite(p[0]) or not math.isfinite(p[1]):
                        raise ValueError("Invalid ring coordinate")
                    points.append((p[0], p[1]))
    if not points:
        raise ValueError("No coordinates found")
    minx, miny = min(p[0] for p in points), min(p[1] for p in points)
    maxx, maxy = max(p[0] for p in points), max(p[1] for p in points)
    if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
        raise ValueError("Input is not longitude/latitude (EPSG:4326)")
    sx = (maxx - minx) / (quantization - 1) or 1
    sy = (maxy - miny) / (quantization - 1) or 1

    def quantize(pt):
        return (round((pt[0] - minx) / sx), round((pt[1] - miny) / sy))

    # Keep the full hierarchy: feature → polygon → ring → vertices. Close rings
    # after quantization and discard zero-length consecutive edges.
    geom_rings = []
    edge_owners = defaultdict(set)
    neighbor_vertices = defaultdict(set)
    for fi, f in enumerate(features):
        g = f["geometry"]
        polygons = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        fp = []
        for poly in polygons:
            p_rings = []
            for ring in poly:
                vertices = []
                for p in ring:
                    q = quantize(p)
                    if not vertices or vertices[-1] != q:
                        vertices.append(q)
                if len(vertices) > 1 and vertices[0] == vertices[-1]:
                    vertices.pop()
                if len(vertices) < 3 or len(set(vertices)) < 3:
                    raise ValueError(f"Feature {fi} has a collapsed or degenerate ring")
                for k, a in enumerate(vertices):
                    b = vertices[(k + 1) % len(vertices)]
                    key = (a, b) if a <= b else (b, a)
                    edge_owners[key].add(fi)
                    neighbor_vertices[a].add(b)
                    neighbor_vertices[b].add(a)
                p_rings.append(vertices)
            fp.append(p_rings)
        geom_rings.append(fp)

    # Split at intersections and at transitions between shared/unshared borders.
    # This allows adjacent precincts to reuse entire arcs, not just short edges.
    junctions = {p for p, neighbors in neighbor_vertices.items() if len(neighbors) != 2}
    for polygons in geom_rings:
        for poly in polygons:
            for ring in poly:
                n = len(ring)
                for i, p in enumerate(ring):
                    a, b = ring[i - 1], ring[(i + 1) % n]
                    left = (a, p) if a <= p else (p, a)
                    right = (p, b) if p <= b else (b, p)
                    if edge_owners[left] != edge_owners[right]:
                        junctions.add(p)

    arcs = []
    arc_index = {}

    def intern_arc(vertices):
        forward = tuple(vertices)
        backward = forward[::-1]
        canonical = forward if forward <= backward else backward
        reverse = forward != canonical
        if canonical not in arc_index:
            arc_index[canonical] = len(arcs)
            lastx = lasty = 0
            deltas = []
            for x, y in canonical:
                deltas.append([x - lastx, y - lasty])
                lastx, lasty = x, y
            arcs.append(deltas)
        index = arc_index[canonical]
        return ~index if reverse else index

    def ring_arcs(ring):
        # Every ring needs at least one split marker; the first point is a
        # safe synthetic marker for a free-standing exterior/island/hole ring.
        start = next((i for i, p in enumerate(ring) if p in junctions), 0)
        rotated = ring[start:] + ring[:start] + [ring[start]]
        out = []
        segment = [rotated[0]]
        for i, p in enumerate(rotated[1:], 1):
            segment.append(p)
            if i == len(rotated) - 1 or p in junctions:
                if len(segment) < 2:
                    raise ValueError("Invalid arc with fewer than two points")
                out.append(intern_arc(segment))
                segment = [p]
        return out

    geometries = []
    for fi, f in enumerate(features):
        polygon_arcs = [[ring_arcs(ring) for ring in poly] for poly in geom_rings[fi]]
        g = f["geometry"]
        geometry = {
            "type": g["type"],
            "arcs": polygon_arcs[0] if g["type"] == "Polygon" else polygon_arcs,
            "properties": f.get("properties", {}),
        }
        if "id" in f:
            geometry["id"] = f["id"]
        geometries.append(geometry)

    result = {
        "type": "Topology",
        "bbox": [minx, miny, maxx, maxy],
        "transform": {"scale": [sx, sy], "translate": [minx, miny]},
        "objects": {"precincts": {"type": "GeometryCollection", "geometries": geometries}},
        "arcs": arcs,
    }
    if geojson.get("metadata") is not None:
        result["metadata"] = geojson["metadata"]
    return result


def convert_file(input_file: Path, output_file: Path, *, quantization: int = DEFAULT_QUANTIZATION) -> int:
    geojson = json.loads(input_file.read_text(encoding="utf-8"))
    topojson = to_topology(geojson, quantization=quantization)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(topojson, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    count = len(topojson["objects"]["precincts"]["geometries"])
    print(f"Wrote {count:,} precinct polygons as TopoJSON to {output_file} ({output_file.stat().st_size:,} bytes, {len(topojson['arcs']):,} shared arcs)")
    print(f"Original GeoJSON size: {input_file.stat().st_size:,} bytes")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Source WGS84 GeoJSON file")
    parser.add_argument("--output", type=Path, help="Destination TopoJSON file (default: same stem .topojson)")
    parser.add_argument("--quantization", type=int, default=DEFAULT_QUANTIZATION, help="Coordinate grid size (default 1000000)")
    args = parser.parse_args()
    output = args.output or args.input.with_suffix(".topojson")
    convert_file(args.input, output, quantization=args.quantization)


if __name__ == "__main__":
    main()
