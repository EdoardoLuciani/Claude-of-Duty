# Independent WebGPU renderer experiment

An **offline, isolated benchmark**, not a replacement game renderer. No production
code, dependency, quality setting or world asset changes. The direct page imports
**zero Three.js modules**; it implements transforms, skeletal palettes, culling,
GPU resources, WGSL and draw submission itself.

## Comparable workload, not the complete game

The exporter takes real geometry and 120 frames of local transforms, visibility
and cameras from the existing living-combat fixture. Both renderers consume the
same binary input. This records **scene inputs, not GPU commands**. Clip sampling,
AI and gameplay simulation run during export, not during either benchmark.

Both paths render:

- Actual opaque level geometry, instancing, animated soldiers and first-person
  weapon/hands. Bounds and indexed material groups are shared.
- Simple albedo/ambient/directional lighting with shared WGSL lighting functions.
- Three fixed orthographic 1024² shadow maps, world beauty and first-person beauty
  with cleared depth; 1920×1080 output, no MSAA.

Both omit original PBR/textures, alpha-tested/transparent surfaces, sky meshes,
particles/casings, postprocessing, temporal history and the game's complete CSM
policy. Consequently **do not compare these timings to full-game timings to
calculate a game speedup**. The references have matching feature scope, not
identical shader instructions or a command-for-command GPU workload. Three.js's
shadow targets also have color attachments, whereas the direct shadow passes are
depth-only. Canvas depth formats differ (Three.js default versus direct
`depth32float`); shadow depth is float32 in both. These implementation differences
are additional reasons not to attribute the throughput delta solely to CPU code.

The Three.js path reconstructs native meshes, skeletons and materials. Importantly,
it preserves the game's existing `StorageInstancedBufferAttribute` representation
for all 161 immutable world instance sets. An earlier reconstruction accidentally
lost that optimization; those pilot measurements are not used below.

The direct path uses flat draw records, resident static data, shared storage tables,
one palette publication per frame, sparse dynamic object uploads, cached bindings
and one submission. Unchanged transforms are genuinely immutable for the lifetime
of this **recorded input**, unlike arbitrary objects in the live game.

`raw-unbatched` deliberately issues object/pose writes while visiting draws and
submits each pass separately. It retains the direct renderer's shared buffers and
pipelines, so it is **not an exact replay of Three.js calls**. Repeated publications
within a frame contain identical values; this control does not overwrite a pending
draw with a different pose.

## Results

Source and game base: `9518d13d34b56c4cfd95725b166c3901552ac7c2`.
AMD RDNA-4 hardware adapter, Ryzen 9 9950X, Chromium **153.0.8010.12**, Linux.
Nonfallback WebGPU/Vulkan; headless page compositing is **software**, not a
GPU-composited desktop FPS test.

Four independent uninstrumented runs per renderer/population, rotating execution
order and alternating population order. Each has 120 warmup + 900 measured frames,
repeating the 120-frame recorded sequence. Every run is retained. Values below are
**medians of run means**, in ms per frame.

| Enemies | Renderer             | Renderer-process CPU | GPU-process CPU | Render-call wall time | Benchmark elapsed/frame |
| ------: | -------------------- | -------------------: | --------------: | --------------------: | ----------------------: |
|       5 | Three.js             |                1.328 |           0.983 |                 1.206 |                   1.333 |
|       5 | Direct, batched      |                0.283 |           0.361 |                 0.741 |                   0.906 |
|       5 | Direct, call-heavier |                0.539 |           1.061 |                 1.585 |                   2.042 |
|      12 | Three.js             |                1.783 |           1.311 |                 1.660 |                   1.766 |
|      12 | Direct, batched      |                0.339 |           0.372 |                 0.650 |                   0.951 |
|      12 | Direct, call-heavier |                0.783 |           1.411 |                 2.545 |                   2.674 |

CPU columns use CDP process CPU-time deltas, summed across threads (and renderer
processes), divided by measured frames. They are **not pure JavaScript self time**.
GPU-process CPU is browser/driver work, **not GPU execution duration**. Processes
and the GPU overlap: do not add these columns to estimate frame time. Render-call
wall time includes waits/backpressure inside WebGPU; it is not CPU utilization.
Elapsed/frame includes rAF pacing and queue completion at measurement boundaries.

Batched direct throughput is **1.47× / 1.86×** the matched Three.js benchmark.
Renderer-process CPU consumption is **4.69× / 5.26× lower**, but that does not mean
4.69× / 5.26× more FPS. The call-heavier direct implementation is _slower_ than
Three.js in elapsed/frame despite consuming less renderer-process CPU.

All primary render-call run means, including variation:

| Enemies | Round | Three.js | Direct batched | Direct call-heavier |
| ------: | ----: | -------: | -------------: | ------------------: |
|       5 |     1 |  1.19486 |        0.74084 |             1.58564 |
|       5 |     2 |  1.21977 |        0.73424 |             1.58517 |
|       5 |     3 |  1.20401 |        0.74021 |             1.57392 |
|       5 |     4 |  1.20752 |        0.74886 |             1.59537 |
|      12 |     1 |  1.65846 |        0.60279 |             2.54117 |
|      12 |     2 |  1.66239 |        0.67559 |             2.53426 |
|      12 |     3 |  1.65521 |        0.62363 |             2.56824 |
|      12 |     4 |  1.68781 |        0.69208 |             2.54964 |

Separate instrumented runs, **not used for timing**, record these public API calls:

| Enemies | Renderer            | Writes/frame | Bytes/frame | Submits/frame | Bind groups/frame | Draws/frame |
| ------: | ------------------- | -----------: | ----------: | ------------: | ----------------: | ----------: |
|       5 | Three.js            |          342 |     319,648 |             6 |            622.08 |      737.08 |
|       5 | Direct batched      |            5 |      72,288 |             1 |                12 |      737.08 |
|       5 | Direct call-heavier |       929.08 |  495,155.63 |             5 |                12 |      737.08 |
|      12 | Three.js            |          734 |     734,832 |             6 |            706.08 |      989.08 |
|      12 | Direct batched      |            5 |      85,280 |             1 |                12 |      989.08 |
|      12 | Direct call-heavier |     1,433.08 |  962,869.62 |             5 |                12 |      989.08 |

This supports substantial renderer preparation/publication overhead and a real
benefit from owning bulk data and submission structure. It **does not isolate all
of the gain as intrinsic Three.js overhead**, establish the fastest possible
Three.js implementation, or establish that replacing Three.js is worthwhile.
The call-heavier control also has more writes than Three.js, not identical API
traffic. A smaller library alone does not eliminate WebGPU validation, recording,
resource lifetime management or synchronization costs.

## Validation and limits

- Same dataset/source hashes, per-frame draws and triangle counts in **every pass**
  across all 24 primary runs: 21,600 frames / 108,000 pass samples. Separate API
  count runs also match. No browser/WebGPU errors or late Three.js node builders.
- Independent affine-math checks against Three.js, real-bounds frustum checks and
  mesh/input checks: 1,013 checks. These are explicit experiment checks, not an
  addition to the maintained Vitest test count.
- Nonblank GPU readbacks at poses 0, 60 and 119 for both populations. Direct versus
  Three.js differs on **0.129–0.335% of pixels**; maximum channel difference
  **117–158/255**, mean absolute channel delta **0.0039–0.0056/255**. Therefore
  **not pixel-exact**. Transform/depth representations differ and the residual
  differences have not been fully attributed. No every-frame image-parity claim.
- Batched versus call-heavier direct readbacks are **pixel-exact** at all six
  checkpoints. Freezing only bone-local inputs changes **38,683 pixels (1.8655%)**
  at pose 60; animation is not silently frozen in the positive comparison.
- No startup-time, desktop FPS, GPU timestamp-duration, device-loss, resize,
  exhaustive weapon/quality or full-game replacement claim. This owns resources
  for one benchmark page; closing its browser tears them down.

Local retained evidence: `/home/edoardo/Documents/direct-webgpu-lab` contains the
binary snapshots, all run JSON/logs, order manifest, count runs, readbacks, summary,
negative control and rejected pilots. Large generated snapshots are not committed.

## Reproduce

Use a full hardware-capable Chromium executable. The local installation used
`/home/edoardo/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`; the default
is Playwright's full Chromium executable, **not** its headless shell. Install that
browser separately if absent, or supply `--executable`. Do not silently substitute
software rendering. No system browser/security changes are required.

```sh
npm ci
npm run build
DATA=/tmp/direct-webgpu-data
CHROME=/path/to/full/chrome

# Offline extraction from the game. --root can select a separate clean checkout.
for n in 5 12; do
  MESA_VK_DEVICE_SELECT=1002:7550! node tools/direct-webgpu/export.mjs \
    --production --agents=$n --out=$DATA --executable=$CHROME
done
node tools/direct-webgpu/check.mjs "$DATA"

# Timing runs: omit --count. Repeat with rotated mode/population order.
for n in 5 12; do
  for mode in three raw raw-unbatched; do
    MESA_VK_DEVICE_SELECT=1002:7550! node tools/direct-webgpu/run.mjs \
      --data=$DATA --agents=$n --mode=$mode --frames=900 --warmup=120 \
      --executable=$CHROME --out=$DATA/$mode-$n-run.json
  done
done

# Separate counts and nonblank final GPU-output captures.
node tools/direct-webgpu/run.mjs --data=$DATA --mode=raw --agents=5 \
  --executable=$CHROME --count --out=$DATA/raw-5-count.json \
  --capture=$DATA/raw-5.png --poses=0,60,119
# Repeat for three/raw-unbatched and 12 enemies; compare samples[].draws/triangles.

# Negative animation input control (diagnostic, not a performance result).
node tools/direct-webgpu/run.mjs --data=$DATA --mode=raw --agents=5 \
  --executable=$CHROME --freeze --out=$DATA/negative-bones.json \
  --capture=$DATA/negative-bones.png
```

The AMD device selector is specific to this host; choose the actual hardware
adapter on another machine. API wrappers exist only behind `--count`, never in the
production game or the uninstrumented timing runs. Screenshots use explicit canvas
texture readback: ordinary post-frame headless screenshots initially returned
blank canvases and were rejected by the nonblank validation gate.
