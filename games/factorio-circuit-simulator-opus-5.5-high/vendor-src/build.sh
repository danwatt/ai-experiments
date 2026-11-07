#!/bin/sh
# Rebuilds ../vendor/rete-bundle.js inside Docker (nothing installed on the host).
set -e
cd "$(dirname "$0")"
docker run --rm -v "$PWD/..":/w -w /w/vendor-src node:22-alpine sh -c '
  npm ci --no-audit --no-fund >/dev/null &&
  npx esbuild entry.js --bundle --format=esm --minify --target=es2020 \
    --define:process.env.NODE_ENV=\"production\" \
    --legal-comments=eof --outfile=../vendor/rete-bundle.js'
