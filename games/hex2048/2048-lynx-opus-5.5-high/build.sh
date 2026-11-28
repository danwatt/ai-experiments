#!/bin/sh
# Build hex2048.lnx in Docker (no local toolchain needed).
set -e
cd "$(dirname "$0")"
docker build -q -t hex2048-lynx-build . >/dev/null
mkdir -p build
docker run --rm -v "$PWD":/src -w /src hex2048-lynx-build make -B "$@"
