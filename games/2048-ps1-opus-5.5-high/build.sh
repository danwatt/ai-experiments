#!/bin/sh
# Build hex2048.exe with a throwaway Docker toolchain (Debian's mipsel GCC).
set -e
cd "$(dirname "$0")"
docker build -q -t hex2048-ps1-toolchain . >/dev/null
docker run --rm -v "$PWD":/work -w /work hex2048-ps1-toolchain make "$@"
