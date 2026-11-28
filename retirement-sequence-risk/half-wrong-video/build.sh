#!/usr/bin/env bash
# Rebuild half-wrong.mp4, poster.png and half-wrong.srt from the repo's data.
#   ./build.sh [WORK_DIR]
# WORK_DIR holds voice clips, the voice track and video segments (default: a temp dir, deleted afterwards
# unless you pass your own; passing the same dir again reuses cached voice clips).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
if [ $# -ge 1 ]; then WORK="$1"; KEEP=1; else WORK="$(mktemp -d)"; KEEP=0; fi
mkdir -p "$WORK"

# puppeteer-core lives in the work dir, not the repo
if [ ! -d "$WORK/node_modules/puppeteer-core" ]; then
  (cd "$WORK" && npm init -y >/dev/null && npm install --silent puppeteer-core@24.10.0)
fi
export NODE_PATH="$WORK/node_modules"

node compute.js                       # facts.json: every number, from ../data.js and ../explainer-4/funds.js
python3 voice.py --work "$WORK"       # timing.json, half-wrong.srt, $WORK/narration.wav (Voicebox must be running)
node render.js --work "$WORK"         # $WORK/video.mp4, frames piped from headless Chrome
node render.js --poster poster.png

ffmpeg -y -loglevel error -i "$WORK/video.mp4" -i "$WORK/narration.wav" -i half-wrong.srt \
  -map 0:v -map 1:a -map 2:s -c:v copy -c:a aac -b:a 160k -ar 48000 -c:s mov_text \
  -metadata title="What if I'm half wrong?" -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng \
  -movflags +faststart half-wrong.mp4

ffprobe -v error -show_entries format=duration,size -of default=nw=1 half-wrong.mp4
[ "$KEEP" = 1 ] || rm -rf "$WORK"
