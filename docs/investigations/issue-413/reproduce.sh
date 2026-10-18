#!/usr/bin/env bash
# Run from the repository root at the measured revision; GPU jobs are sequential.
set -euo pipefail
out=${1:?Usage: bash docs/investigations/issue-413/reproduce.sh /absolute/output-directory}
mkdir -p "$out"
out=$(realpath "$out")
export MESA_VK_DEVICE_SELECT='1002:7550!'
chrome=${CHROMIUM_PATH:-$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome}
npm ci
npm run build

# Preserve the original run order, including the low-resolution stall outlier.
for run in base-1 base-2 half-1 base-3 half-2 half-3 gpu-1 detail-1 \
  actors12-1 paced-1 actors12-2 gpu-2 paced-2 actors12-3 gpu-3 paced-3 \
  half-gpu-1 detail-2; do
  w=1280; h=720; extra=()
  case "$run" in
    half-*) w=640; h=360 ;;
  esac
  case "$run" in
    gpu-*|half-gpu-*) extra=(--gpu=1) ;;
    detail-*) extra=(--detail=1 --worker-profile=1 "--cpu-profile=$out/$run.cpuprofile.json") ;;
    actors12-*) extra=(--agents=12) ;;
    paced-*) extra=(--paced=1) ;;
  esac
  node tools/profile.mjs --port=5389 --executable="$chrome" --production=1 \
    --frames=1800 --warmup=120 --w="$w" --h="$h" --dpr=1 --quality=high \
    "${extra[@]}" --out="$out/$run.json" > "$out/$run.log" 2>&1
done
