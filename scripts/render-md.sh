#!/usr/bin/env bash
# Render every prompt.md and README.md under <dir> to a sibling .html page.
# Used by the GitHub Pages build; also handy locally.
#
# Usage: scripts/render-md.sh [dir]   (default: current directory)
set -euo pipefail

root=${1:-.}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm init -y >/dev/null && npm i marked@12 >/dev/null 2>&1)

find "$root" \( -name node_modules -o -name '.*' -not -name . \) -prune -o \
  \( -name prompt.md -o -name README.md \) -type f -print | while read -r md; do
  out="${md%.md}.html"
  title=$(grep -m1 '^# ' "$md" | sed 's/^# //; s/&/\&amp;/g; s/</\&lt;/g')
  body=$(node --input-type=module -e "
    import {marked} from '$tmp/node_modules/marked/lib/marked.esm.js';
    import fs from 'fs';
    process.stdout.write(marked.parse(fs.readFileSync(process.argv[1], 'utf8')));
  " "$md")
  depth=$(printf '%s' "${md#"$root"/}" | tr -cd '/' | wc -c)
  up=$(printf '../%.0s' $(seq 1 $((depth + 1))))
  cat > "$out" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title:-$(basename "$(dirname "$md")")}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  img { max-width: 100%; height: auto; }
  pre { overflow-x: auto; padding: .75rem; background: color-mix(in srgb, CanvasText 8%, transparent); border-radius: 6px; }
  code { font-size: .9em; }
  blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid GrayText; color: GrayText; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid GrayText; padding: .25rem .6rem; }
</style>
</head>
<body>
<p><a href="${up}">&larr; All experiments</a></p>
$body
</body>
</html>
HTML
  echo "rendered $out"
done
