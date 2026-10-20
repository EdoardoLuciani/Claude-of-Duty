#!/usr/bin/env bash
# Optional GPU/SDK integration check; not part of the native runtime.
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
data=${1:?Usage: validate.sh DATA_DIR [OUTPUT_DIR]}
output=${2:-$(mktemp -d)}
binary=${NATIVE_WGPU_BIN:-$here/target/release/cod-native-wgpu-lab}
mkdir -p "$output"
# WGPU's safe-API errors and Vulkan-layer messages have different channels.
# A successful process / errors:[] alone does NOT prove Vulkan validation passed.
vulkaninfo --summary > "$output/vulkaninfo.log" 2>&1
if ! grep -q VK_LAYER_KHRONOS_validation "$output/vulkaninfo.log"; then
  echo 'Install the Vulkan validation layer before running this diagnostic.' >&2
  exit 1
fi
for agents in 5 12; do
  log="$output/validation-$agents.log"
  "$binary" --data="$data" --agents="$agents" --benchmark --validation \
    --warmup=120 --frames=120 --out="$output/validation-$agents.json" > "$log" 2>&1
  if grep -E 'VUID-|Validation (Error|Warning)' "$log"; then
    echo "Vulkan-layer validation failed; retained log: $log" >&2
    exit 1
  fi
done
echo "Vulkan validation passed for both recorded scenes; logs: $output"
