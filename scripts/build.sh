#!/usr/bin/env bash
# Full pipeline: frames -> audio -> mp4 -> contact sheet + poster.
# usage: scripts/build.sh [en|fr]   (en -> out/, fr -> out/fr/)
set -euo pipefail
cd "$(dirname "$0")/.."
LANG_CODE=${1:-en}
OUT=out; [ "$LANG_CODE" != en ] && OUT=out/$LANG_CODE
mkdir -p "$OUT"
FRAMES=${FRAMES:-out/frames}
rm -rf "$FRAMES"
node scripts/render.mjs --out "$FRAMES" --workers "${WORKERS:-4}" --lang "$LANG_CODE"
python3 scripts/audio.py out/audio.wav
ffmpeg -y -v error -framerate 60 -i "$FRAMES/f_%05d.png" -i out/audio.wav \
  -c:v libx264 -preset slow -crf 12 -tune animation -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT/final.mp4"
POSTER=$(python3 -c "import json; print(round((json.load(open('src/timeline.json'))['duration'] - 1.5) * 60))")
cp "$FRAMES/f_$(printf %05d "$POSTER").png" "$OUT/poster.png"
python3 scripts/contact.py "$OUT/final.mp4" "$OUT/contact.png" 10 360
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of compact "$OUT/final.mp4"
