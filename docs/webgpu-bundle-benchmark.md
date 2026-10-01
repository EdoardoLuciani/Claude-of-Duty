# Native BundleGroup benchmark — diagnostic only

Baseline production: `6d40e1a` (WebGPU graph warmup/resident matrices and both
removed fullscreen boundaries). **No production renderer or installed Three.js
changes. No WebGL/integrated-GPU runs. PR316 stays draft.**

## Setup / candidates

RX9070XT only (`MESA_VK_DEVICE_SELECT=1002:7550!`), managed Chrome153/Vulkan,
960x540/DPR1/high, Three0.186.1. Seeded scripted move/turn/fire,900frames with60
excluded,840 measured. Six paired runs alternate launch order. Whole-app frame
intervals, synchronous engine wall and GPU pass timestamps remain separate.

Use public `BundleGroup` for203 authored opaque static leaf meshes. Dynamic
soldiers/FX/weapons, lights, transparent meshes and collision remain outside.
Wrappers preserve parent transforms; geometry/materials are not cloned or changed.

- **single:**203 groups, one mesh each. Recompute group visibility from the
  actual pass camera's original mesh frustum/layer/visibility tests. This keeps
  the executed geometry workload identical while retaining cached commands.
- **chunk:**12 sibling/spatial groups (24m cells), conservative group spheres,
  disable individual child frustum culling. This submits extra geometry and is
  not an equivalent-workload comparison. It also fails the image gate.

Boot-only Vite response injection installs the prototype before native warmup.
Invalidate bundles when the prime frame switches to geometry-enabled passes and
when zero draw ranges are restored; otherwise empty command bundles survive.
Also invalidate on mesh visibility/LOD, active sun, environment identity or target
size changes. These are prototype safeguards, **not a complete production
invalidation contract** (e.g. arbitrary material/texture changes).

## Whole-app frame intervals — per-mesh candidate

|Pair|Stock mean /p50 /p95 /p99 ms|Single mean /p50 /p95 /p99 ms|Mean reduction|
|---|---:|---:|---:|
|1|14.26 /14.4 /19.3 /33.2|12.72 /12.8 /15.9 /16.7|10.8%|
|2|21.25 /21.8 /32.5 /35.3|16.06 /15.5 /34.4 /35.3|24.4%|
|3|13.09 /13.5 /16.3 /17.1|12.97 /13.1 /16.5 /17.9|0.9%|
|4|14.91 /14.6 /18.2 /44.8|13.07 /13.1 /17.3 /21.0|12.3%|
|5|13.99 /14.1 /18.2 /34.8|12.33 /12.5 /15.4 /19.0|11.9%|
|6|13.47 /13.8 /17.1 /33.8|12.60 /13.0 /16.0 /17.4|6.5%|

Across-run means **15.16 ->13.29ms (~12.3%)**, median paired reduction11.3%.
Pair2 is much slower for both versions and inflates the average gain. Retaining
it in the primary result, a sensitivity calculation excluding that pair gives
**13.95 ->12.74ms (~8.6%)**. Do not silently discard it or promise12% everywhere:
per-pair gains .9-24.4%, p95/p99 do not improve in every pair. Zero errors/late
builders in measured steady frames. This is scripted evidence, not unscripted
acceptance or legacy parity. Graph warmup still costs roughly12seconds.

## Separate instrumentation: what actually improved

Full900/60 light runs (not the unwrapped interval runs above):

|Metric /frame|Stock|Single|Chunk|
|---|---:|---:|---:|
|Nonzero executed GPU draws|1076.22|1076.22|1156.24|
|Submitted index/vertex count x instances|23,402,994|23,402,994|24,709,739|
|Buffer writes|6939.79|6939.79|7339.10|
|Buffer bytes|1,337,004|1,337,004|1,349,091|
|Synchronous engine wall ms|13.12|12.32|11.69|
|Bundle replays|0|862.46|54.69|
|Bundle encodes|0|.274|.013|

The chunk wall value is one instrumented run, **not a paired speedup result**;
its short plain probe was slower, and visual/workload differences disqualify it.

Native `renderer.info` counts encoding, not all replayed draws: it misleadingly
falls1077.22 ->275.03 with single. Intercept actual bundle encoder draw commands
and `executeBundles()` to recover executed work; count zero-instance commands
separately from nonzero geometry (one/frame explains1077.22 vs1076.22). **No real
~75% GPU draw reduction.** `single` matches stock's work frame-by-frame in the
traced run; it mainly avoids CPU command/pipeline/draw dispatch. Uploads remain.
Pinned `NodeMaterialObserver.needsRefresh()` returns FULL for node materials or
velocity, before its static-bundle shortcut, consistent with unchanged writes.

Separate28-sample timestamp runs selected GPU sums **2.355 ->2.402ms**: no GPU
speedup demonstrated. Do not add GPU sums to engine wall/frame intervals. The
remaining upload/TSL update work limits the opportunity; bundles are not batching.

## Correctness — not yet shippable

Seven matched high stills preserve positive world depth byte-for-byte. Velocity
matches six; muzzle has one half-float channel difference(max2.38e-7). Independent
256x256 sampled CSM depth outputs match **all three cascades** in hero/combat/night
(9 comparisons). Weapon corner alpha0, raw/filtered AO sky1, nonblank/strict-WebGPU
and disposal checks pass. Light/environment invalidation is necessary: without
it, night output diverged more. These shadow samples are not exhaustive full-map
or moving-shadow acceptance.

**Exact image parity fails.** Normal-buffer winners differ at1-22 pixels/scene,
with substantial local normal changes, despite identical depth. Reordered draw
submission is a plausible cause at ties/intersections, not established as the
sole cause. HDR/AO/final pixels consequently differ. With invalidation safeguards,
final RGB MAE .074-1.099/255 across seven stills, local max238/255; these maxima are
not harmless merely because average errors are small. Human temporal review,
draw-order preservation and broader resize/material/resource invalidation remain.
Chunk hero final MAE~11.28/255/max197: reject that prototype as implemented.

A deliberately frozen original-frustum bundle control changes31,812 hero and
133,916 combat depth channels. Cached visible lists without camera-correct
selection are invalid performance evidence, not an optimization.

## Reproduce

```sh
# Run from the migration worktree. --key=value syntax.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-bundle-benchmark.mjs \
  --variant=stock --out=/tmp/bundle-stock
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-bundle-benchmark.mjs \
  --variant=single --out=/tmp/bundle-single
# Separate, perturbing executed-work/write accounting:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-bundle-benchmark.mjs \
  --variant=single --mode=light --out=/tmp/bundle-light
```

The committed tool is diagnostic-only, with explicit boot/culling/invalidation
logic. No production toggle, private-clock reset, shader rewrite or dependency
patch ships. Initial benchmark/fixture scripts and full artifacts remain:
`/tmp/cod-bundle-{inject,profile,game,spy,shadow-game}.mjs`,
`/tmp/cod-bundle-paired-{stock,single}-{1,2,3,4,5,6}{,-raw}.json`,
`/tmp/cod-bundle-{light,gpu}-{stock,single}{,-raw}.json`,
`/tmp/cod-bundle-light-chunk{,-raw}.json`,
`/tmp/cod-bundle-{invalidated-seven,invalidated-chunk,shadow-single,frozen-game}/`,
`/tmp/cod-bundle-image-diff.json`, `/tmp/cod-bundle-tool-{stock,single,chunk}.json`.

All51 smoke tests, lint/build, the committed tool's stock/single/chunk light
smokes and plain single smoke, plus a fresh-port standard production hero capture
pass. These checks do **not** turn the prototype's failed image-parity gate into
a passing one. Before/after hero/combat pair inspected visually, not human approval.

**Recommendation:** worthwhile CPU-side candidate (~9-12% in this script), but
first solve draw-order/image parity and lifecycle invalidation; do not ship the
prototype or claim GPU/legacy-performance acceptance. Avoid coarse bundle/culling
changes as a shortcut to larger numbers.
