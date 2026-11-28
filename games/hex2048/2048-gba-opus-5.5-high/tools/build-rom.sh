#!/bin/sh
# Builds hex2048.gb. Runs inside the Docker image (see build.sh), or anywhere
# RGBDS 1.0 and Node are installed.
set -e
cd "$(dirname "$0")/.."
node tools/gen.mjs
mkdir -p build
rgbasm -I src -o build/main.o src/main.asm
rgblink -n build/hex2048.sym -m build/hex2048.map -o hex2048.gb build/main.o
rgbfix -v -p 0xFF -m MBC1+RAM+BATTERY -r 2 -t HEX2048 hex2048.gb
echo "built hex2048.gb"
# Embed the ROM so the page also works from file://
printf 'window.HEX2048_ROM = "%s";\n' "$(base64 < hex2048.gb | tr -d '\n')" > rom.js
echo "wrote rom.js"
