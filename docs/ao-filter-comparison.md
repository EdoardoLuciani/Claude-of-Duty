# AO filter comparison

## Decision

Keep GTAO raster and reuse the pinned Three `depthAwareBlur` pixel function in
our existing two raster RTTs. Preserve full-resolution R8 intermediates, neutral
cleared sky and depth-relative rejection. Do not adopt the compute prototype.

This is a small hardware-specific GPU saving and a reduction in locally owned
shader code, **not a demonstrated combat FPS improvement**. The filter changes
from the legacy seven-tap weighting to an approximately width-matched five-tap
Gaussian; output is not bit-identical.

The helper is already shipped by our pinned Three `9681657f7`. Its upstream
[implementation and review](https://github.com/mrdoob/three.js/pull/33921) use the
same function in `SSAONode`. No dependency update, vendored GTAO algorithm or
private builder hooks are needed. GTAO radius, samples, strength, half-resolution
output and temporal configuration remain unchanged.

Raw pass-query records, combat samples, quality metrics and source hashes:
[measurement evidence](https://gist.github.com/EdoardoLuciani/79403cb0d0ee026325e5f97f1837ddcc).
GPU records retain original timestamps and a SHA-256 of their full local audit;
unrelated pass/shader records are omitted from the published extracts.

## GPU measurements

RX 9070 XT / AMD RDNA4, nonfallback WebGPU, Chromium 153, high quality,
1280×720, DPR 1, existing Mesa cache. Each variant has three fresh runs with
120 warmup frames and 24 timestamped frames. Values are medians of per-run
medians of **horizontal + vertical** GPU timestamps, not whole-frame times.

| Filter | Taps per axis | Output | Pair GPU ms |
|---|---:|---|---:|
| Existing depth-relative filter | 7 | R8 | 0.08070 |
| Three `depthAwareBlur`, defaults | 5 | R8 | 0.04412 |
| Three `BilateralBlurNode`, sigma=0.5, sigmaColor=0.1 | 7 | RGBA8 | 0.04848 |
| Three `BilateralBlurNode`, default sigma=4, sigmaColor=0.1 | 21 | RGBA8 | 0.11758 |
| Existing math, native compute prototype | 7 | RGBA8 | 0.08420 |

A separate final paired batch using the actual selected runtime helper gives
existing **0.08084/0.08084/0.08088 ms**, selected
**0.04694/0.04686/0.04688 ms**. Median **0.08084 → 0.04688 ms** saves
**0.03396 ms / 42.01%** of this pass.

The color-guided node filters luminance, not geometry depth. Its R8 source
samples RGB as `(AO, 0, 0)`, so its default color threshold acts on red-channel
luminance. It uses `resolutionScale=2` to produce full-resolution output from
half-resolution GTAO; defaults alone would filter at half resolution. Earlier
input-sized color runs are excluded, not pooled. The review harness now asserts
two 1280×720 blur draws per measured frame for every raster comparison.

## Quality

All candidate AO buffers use the **same frozen raw GTAO and depth textures** in
hero, interior and night scenes. Simulation time/frame must not advance during
probes; owned textures must return to the original count. A 128-sample GTAO
reference uses the captured jittered projection and unchanged radius/thickness,
strength and resolution. It is a higher-sample proxy, **not physical ground truth**.

The defaults leave more high-frequency same-depth variation. The 21-tap color
filter smooths strongly but widens silhouettes and loses fine contact detail.
Neither stock helper enforces the application's neutral-sky contract when
half-resolution AO interpolation has already contaminated background pixels.

The selected adapter uses a 1.65-pixel step to approximate the previous spatial
variance (~2.57 px²). `radius=max(0.1, linearDepth)*2/22`, with sharpness 2,
retains the old depth-relative rejection scale. A final center-depth gate writes
1 for cleared sky. The helper samples hardware depth, so this is not the exact
same half-float linear-depth rejection arithmetic as before.

For a seeded synthetic signal containing flat noise, a thin contact shadow,
opaque depth discontinuity and sky:

| Metric | Existing | Selected | Lower is better? |
|---|---:|---:|---|
| Whole opaque RMSE | 0.03212 | 0.03250 | yes |
| Flat-surface RMSE | 0.03129 | 0.03167 | yes |
| Depth-edge mean absolute error | 0.02998 | 0.03065 | yes |
| Contact contrast (ideal 0.32) | 0.25826 | 0.25782 | closer to ideal |
| Minimum sky visibility | 1 | 1 | must be 1 |

Thus the selected filter is a close trade-off, not universally superior quality:
synthetic error is slightly higher and real same-depth curvature is ~6–7% higher.
Its error against the higher-sample proxy is slightly lower in all three scenes,
and contact contrast is essentially unchanged. Matched final screenshot RGB
mean absolute differences are **0.0094/0.0071/0.0001 bytes** for
hero/interior/night, with maxima **2/5/1 bytes**, respectively. More than 97% of
pixels in each final capture are unchanged. These scenes do not prove all content
or motion behavior is indistinguishable.

The compute prototype is slower and differs by up to one red-channel byte from
the R8 raster reference. Its RGBA8 output also costs four times the intermediate
texture storage. It does not justify adoption here.

## Living combat

Three fresh runs each for existing, stock depth, seven-tap color and selected;
120 settle + 1,800 measured frames per run (21,600 accepted frames). Original
orders rotated; color runs were repeated later after correcting their output
size. Treat combat numbers as descriptive, not a balanced statistical ranking.
No other benchmark GPU process ran concurrently. Every run has 50 player shots,
427 AI shots, four reloads/switches and zero late node builders.

| Filter | Frame p50 / p95 / p99 / median max ms | CPU render-submit p50 ms |
|---|---|---:|
| Existing | 8.6 / 10.7 / 14.9 / 26.9 | 6.5 |
| Stock depth | 8.5 / 10.7 / 15.3 / 26.5 | 6.5 |
| Seven-tap color | 8.5 / 10.7 / 14.8 / 26.3 | 6.4 |
| Selected depth adapter | 8.6 / 11.0 / 15.3 / 26.9 | 6.5 |

No reliable frame-time or CPU-submit improvement was observed. Selected tails
were slightly worse in this batch. No statistical significance or cross-hardware
claim is made.

## Code and validation

Runtime AO helper: **36 → 22 lines**. Including the additional raw-depth/camera
arguments in the pipeline, runtime net **−13 lines**. Reference blur math and
compute ownership/dispatch remain review-only fixtures in `tools/`, not runtime.

Smoke tests, lint/build, native final fixture, clustered-lighting checks,
renderer failure/device-loss/lifetime checks and low/medium/high/ultra fog parity
pass. Existing AO smoke checks pass for hero at 480×270 and interior at 1280×720.
Interior at the smoke script's default 480×270 fails on **both old and new** code:
the selected ROI has raw curvature 0.41268, below its required >0.5 noise floor.
The test was not weakened or changed.
A negative sky-guard mutation fails the review's neutral-sky assertion.

Reproduce from a clean install, with no competing GPU benchmark:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=gpu --filter=current --out=/tmp/current.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=gpu --filter=depth-tuned --out=/tmp/selected.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=profile --filter=depth-tuned --out=/tmp/combat.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=quality --filter=current --out=/tmp/ao-quality
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=captures --filter=depth-tuned --out=/tmp/ao-captures
# Expected failure, confirming background-policy coverage:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ao-filter-review.mjs --phase=quality --negative=sky --out=/tmp/ao-negative
```

Other filter choices: `depth`, `color`, `color-default`, `compute`. All alternatives
are supplied through review-only HTTP response mutations. Normal gameplay has
one filter, no selector and no compute-AO path.
