#!/bin/sh
# Build everything in Docker (no local toolchain):
#  1. export the three missions from ../hexahedron-opus-5.5/level.js (node image)
#  2. compile the ROM with libdragon's MIPS toolchain (see Dockerfile)
set -e
cd "$(dirname "$0")"
docker run --rm -v "$PWD/..":/g -w /g/hexahedron-n64-opus-5.5 node:22-alpine node tools/export.mjs
docker build -q -t hexahedron-n64-build . >/dev/null
docker run --rm -v "$PWD":/src -w /src hexahedron-n64-build make "$@"
