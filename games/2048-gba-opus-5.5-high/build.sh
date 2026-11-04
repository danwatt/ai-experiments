#!/bin/sh
# Builds hex2048.gb inside Docker (RGBDS + Node), so only Docker is needed.
#   ./build.sh          build the ROM and rom.js
#   ./build.sh --test   build, then run the headless rules test
set -e
cd "$(dirname "$0")"
IMAGE=hex2048-gb-build
docker build -q -t "$IMAGE" - < Dockerfile > /dev/null
run() { docker run --rm -v "$PWD":/src -w /src -u "$(id -u):$(id -g)" "$IMAGE" "$@"; }
run sh tools/build-rom.sh
if [ "$1" = "--test" ]; then
  run node tools/test.cjs 2000
fi
