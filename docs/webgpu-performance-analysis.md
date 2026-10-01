# WebGPU performance diagnosis

## Scope and method

This is a diagnosis, not performance or visual acceptance. The initial findings
below describe `0aabf2d` / `3b931e7`, before optimization. Production remains at
Three.js 0.186.1 with temporary half-resolution GTAO. The first landed optimization
and its dedicated-GPU measurements are recorded at the end of this document.

Compared migration `0aabf2d` with legacy WebGL `5c033cd` (Three.js 0.186.0), using
the same managed Chromium 153, Linux Vulkan/ANGLE flags, GPU selector, 960×540
viewport, DPR 1, and high quality. Each run stages a capture-seeded firefight,
enables movement, turns the camera, moves forward, and fires periodically.
Capture simulation uses deterministic frame timing; measured frame intervals
are real rAF intervals. This is not an unscripted normal-gameplay benchmark.
900 frames/run, 60 warmup, 840 measured. No page/shader errors in the valid runs.

Three complementary measurements:

- Frame-only timing for end-to-end distributions.
- Light wrappers for subsystem/pass CPU wall time and upload/draw counts.
- GPU timestamp queries for selected render passes every 30 frames: 28 measured
  frames/run. WebGPU queries are resolved after sampling, without a per-frame
  queue fence. WebGL uses `EXT_disjoint_timer_query_webgl2`; disjoint results are
  rejected. Render-pass sums exclude untimed copies, uploads and inter-pass
  idle time, and are **not total GPU frame latency**.

CPU wall time includes native API blocking/backpressure, not just active JS
execution. CPU and GPU overlap: **do not add their tables**. Deep per-draw
wrappers substantially increase CPU cost; their timings are diagnostic only,
not the production frametime budget. Configurations have single-run results,
with additional instrumentation/control runs, not a repeated acceptance study.
Integrated-GPU tails varied substantially across runs.

## Same-browser frame comparison

Frame-only runs, milliseconds:

| GPU | Renderer | Mean | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| RX 9070 XT | Legacy WebGL | 10.09 | 10.0 | 10.9 | 11.7 |
| RX 9070 XT | Current WebGPU | 29.50 | 22.1 | 84.6 | 158.6 |
| Ryzen 9950X integrated | Legacy WebGL | 73.52 | 73.5 | 76.3 | 77.4 |
| Ryzen 9950X integrated | Current WebGPU | 133.61 | 127.6 | 231.8 | 346.5 |

The light-instrumented stock WebGPU runs measured p50/p95/p99
21.9/84.3/150.7 ms discrete and 125.7/176.6/220.7 ms integrated. This variation
is why isolated percentile changes are not acceptance or speedup claims.

## CPU/submission breakdown by function

Means in milliseconds from light instrumentation. These buckets partition the
measured synchronous engine step; wrapped child functions are subtracted.
The prepass bucket includes native shadow submission, which is not separately
wrapped here. GPU waits can surface in either scene pass's upload calls.

| Function/bucket | RX 9070 XT | Integrated |
|---|---:|---:|
| Prepass `updateBefore()` excluding wrapped children | 9.89 | 48.98 |
| World `updateBefore()` excluding wrapped children | 7.10 | 61.82 |
| `NodeManager.getForRender()` / runtime node construction | 8.45 | 8.27 |
| Weapon `updateBefore()` excluding wrapped children | 0.59 | 1.10 |
| Other renderer/post work | 0.74 | 2.50 |
| Gameplay, HUD and remaining engine work | 1.37 | 1.57 |
| **Synchronous engine step** | **28.14** | **124.24** |

Separately partitioning `renderer.render()` invocations, discrete-GPU CPU wall
means were: prepass 10.15 ms, world 11.22 ms, three shadow cascades combined
3.64 ms, weapon 0.59 ms, raw GTAO 0.27 ms, AO horizontal/vertical filters
0.10/0.12 ms. These are an alternate view of the same time, not additional
costs to add to the function table. Typical gameplay costs were AI 0.44 ms,
UI late update 0.29 ms, physics fixed updates 0.24 ms and weapons late update
0.17 ms.

Stock WebGPU averaged about 1,079 draws, **12,428 `GPUQueue.writeBuffer()` calls**
and **3.07 MB uploaded per frame**. The deep trace and CDP samples identify
binding/uniform management, native buffer writes, and node construction as
hot paths. Deep wrappers increased discrete mean frame time to 42.48 ms, so
an apparent 11.50 ms exclusive `writeBuffer()` time must **not** be presented
as its uninstrumented cost.

## GPU render-pass breakdown

Selected-pass means, milliseconds. Fog includes the new fog/weapon composite
versus legacy march/history work; this is a workload comparison, not identical
kernel timing. AO includes native bilateral filtering. Legacy contact shadows
are separate and absent from production WebGPU.

| GPU work | Discrete legacy | Discrete WebGPU | Integrated legacy | Integrated WebGPU |
|---|---:|---:|---:|---:|
| Volumetric fog | 0.16 | 0.82 | 4.43 | **57.86** |
| World shading | 1.34 | 0.92 | 29.98 | 33.92 |
| Three shadow cascades | 1.48 | 0.47 | 13.52 | 5.56 |
| Depth/normal/velocity prepass | 0.33 | 0.26 | 2.06 | 6.22 |
| AO | 0.31 | 0.11 | 6.57 | 3.95 |
| Weapon | 0.26 | 0.14 | 3.88 | 2.67 |
| **All measured render-pass work** | **4.14** | **2.84** | **64.39** | **112.18** |

### Main integrated-GPU regression: fog

`src/sky/volumetrics.js` builds the march inline in a full-resolution graph
RTT. Legacy marches at half resolution and temporally resolves/upsamples it.
More importantly, TSL expressions described in JS as once-per-ray are lazy:
without explicit variables, ray reconstruction, phase/ambient evaluation and
both expensive cloud-shadow evaluations are emitted **inside the 20-step
loop**. JS declaration placement does not imply shader evaluation placement.

Captured WGSL confirms this: the stock shader's loop starts at character
13,653 of 66,615, with the bulk of the cloud calculations inside it.
A test-only override adds `.toVar()` to ray, dither, cosine, phase, ambient and
near/far cloud-shadow expressions. Its loop starts at character 56,661 of
64,032, leaving only about 7.4 KB after the loop begins.

This changes expression evaluation placement, not march count, radius,
lighting parameters or resolution. Nevertheless, visual equivalence still
requires validation before shipping it.

| Diagnostic | Discrete fog GPU ms | Integrated fog GPU ms | Integrated frame p50/p95/p99 ms |
|---|---:|---:|---:|
| Stock | 0.82 | 57.86 | 125.7 / 176.6 / 220.7 (light run) |
| Explicit once-per-ray variables | 0.29 | **13.69** | **81.0 / 128.0 / 170.4** |
| Fog disabled | — | — | **67.4 / 117.7 / 165.6** |

Hoisted total measured integrated render-pass work was 68.03 ms, near legacy
64.39 ms, but tails and CPU submission are still not acceptable. Disabling
fog is causal isolation, **not an acceptable optimization**. A quarter-pixel
march workload at half resolution suggests remaining headroom, but no
half-resolution WebGPU fog speed or visual result was measured here.

### Main discrete-GPU regression: submission and runtime construction

Raster work itself is below the measured legacy pass sum. The CPU path is
not. The normal prepass uses lit production node materials, bringing lighting
setup/uniform work into a pass that only needs normals, linear depth and
velocity. Native rendering also keeps the full punctual-light roster visible
for stable TSL light identities. Legacy `_cullLights()` hides distance-faded
lights; native does not implement that culling path.

Controlled tests, discrete frame p50/p95/p99:

| Test-only change | Result ms | Meaning |
|---|---:|---|
| Stock light run | 21.9 / 84.3 / 150.7 | Reference |
| Prepass material clones with `lights=false` | 19.9 / 64.9 / 93.0 | Uploads fall to 7,757/frame; promising minimal-prepass direction, not validated visual equivalence |
| All point/spot lights disabled | 15.7 / 66.1 / 112.1 | Uploads fall to 4,543/frame; lighting cost isolation, **not a shippable change** |
| Uniform dirty writes coalesced | 21.2 / 83.4 / 154.4 | Writes fall to 2,730, bytes rise to 3.41 MB; reducing call count alone does not remove the regression |
| Instance matrices forced to vertex-attribute path | 20.4 / 80.7 / 145.7 | Bytes fall to 1.44 MB but writes remain 11,669/frame; transfer volume alone is not the main culprit |

Three's small-instance path uses uniform `buffer()` matrices. `Buffer.update()`
returns true and their default group is per-object, so static transforms are
re-uploaded across passes. The attribute-path test is useful evidence, but its
private builder-limit override must not ship. Any production fix needs a
supported representation and moving-instance/velocity checks.

### Separate hitch source: node builders during combat

After warmup, **510 node-builder creations** were recorded: 124 world,
110 prepass, and 92 each for GTAO and the two AO filters. Instanced render-object
cache keys include object UUIDs, so shared material/geometry does not imply
shared node-builder state. GTAO/RTT setup also replaces internal fragment/context
nodes and marks internal materials dirty; the AO trace shows changing fragment
IDs and material versions despite a stable renderer context ID.

On discrete GPU, light-run frames with >1 ms in `getForRender()` numbered 148:
mean frame interval 71.63 ms versus 19.89 ms for the other 692 frames. Fragment
program creation counts were very low (~0.007/frame), so this is primarily
CPU TSL construction/state churn, not 510 new GPU shader compilations.

A forced all-mesh visible/non-frustum-culled pre-render diagnostic and decoupled
AO sampling diagnostic both retained all 510 builder events. Merely adding a
compile call or changing the AO dependency is therefore not a demonstrated fix.
The exact cache/prewarm/scheduling correction needs a focused follow-up.

## Recommended implementation order

1. Explicitly hoist invariant fog expressions, with matched HDR/final captures.
   Then restore a half-resolution march and depth-aware temporal resolve without
   fogging the separate weapon pass or darkening the scene.
2. Replace the lit normal prepass with a genuinely minimal variant preserving
   mapped normals, skinning, instancing, alpha testing and velocity. Do not
   recreate the earlier empty-light-context cache poisoning.
3. Fix runtime node-builder/auxiliary-material churn and verify final-pass
   prewarm with late props, transparent faces and combat effects. Require a
   builder-event trace, not just a successful `compileAsync()`.
4. Reduce per-object binding work with proper uniform lifetimes and a bounded,
   stable light-slot scheme. Preserve authored nearby/muzzle/practical lighting;
   do not toggle light identities every frame. Evaluate static-instance buffer
   representation only through supported APIs.
5. Repeat same-browser runs on both GPUs, validate normal gameplay as well as
   this scripted workload, and complete visual acceptance before undrafting #316.

AO and CSM are **not the leading measured GPU regressions**. Do not reduce
shadow/AO quality or blanket-darken lighting to hit the target. Current AO is
already a temporary compromise, and several legacy visual features remain
absent, so matching these frametimes alone would not establish parity.

## Local evidence

Standalone diagnostic harness: `/tmp/cod-perf-analyze.mjs`.

Artifacts use `/tmp/cod-perf-{webgpu,webgl}-{7550,13c0}-*`: JSON summaries,
`-raw.json` per-frame/pass/builder records, logs and selected `.cpuprofile`
traces. Main modes: `plain`, `light`, `gpu-named` (WebGPU), `gpu` (WebGL).
Controls: `fog-hoisted`, `no-fog`, `unlit-prepass`, `no-points`, `coalesce`,
`instance-attributes`, `prewarm`, `decoupled`. The earlier `gpu900-invalid`
artifacts exceeded the timestamp query limit and are explicitly excluded.
All interception/private overrides are isolated diagnostic code, not production
shader rewriting or edits to installed Three.js.

## First optimization: materialize fog invariants

`src/sky/volumetrics.js` now uses explicit TSL variables for ray reconstruction,
view/key cosine, phase, ambient, dither and both cloud-shadow taps. March-only
expressions stay inside the JS `march` branch, outside the shader loop; analytic
quality does not build unnecessary cloud taps. Resolution, 20/48 march steps,
parameters, density integration, sky bypass and separate weapon composition are
unchanged. No new passes, history, dependencies or per-frame allocations.

Validation and profiling for this change use **RX 9070 XT only**, at the user's
request. Previous integrated-GPU results above are historical, not validation of
this production change.

The opt-in `FOG=1` game probe captures the compiled WGSL, asserts the expected
20/48 steps, and rejects ray/dither, HG phase, ambient LUT and 2D cloud-noise
lattices inside the integration loop. A test-only negative control removing the
far cloud tap's `.toVar()` correctly fails the cloud-noise assertion. It is not a
production source-rewriting solution.

Fresh matched Chrome153, 960x540 high, 900 frames/60 warmup, same scripted
firefight/turn/move/fire workload:

| Run | Before p50/p95/p99 ms | After p50/p95/p99 ms |
|---|---:|---:|
|1|21.7 / 82.7 / 150.3|21.9 / 83.9 / 158.3|
|2|22.1 / 83.5 / 149.4|21.7 / 80.4 / 154.5|
|3|19.6 / 82.9 / 157.9|21.8 / 83.4 / 150.3|

Mean frame intervals before: 28.49/28.69/27.48 ms; after:
28.51/28.52/28.43 ms. **No established whole-app speedup on the dedicated GPU**;
CPU submission and all 510 runtime node builds remain. A follow-up all-group
visible/non-frustum-culled pre-render probe also retains the 510 builds.

Separate GPU-query runs (28 sampled frames/configuration) measure the fog/world-
weapon composite pass **0.821 -> 0.297 ms**, about 64% lower, and total measured
render-pass work **2.830 -> 2.368 ms**. These are GPU pass measurements, not
whole-app frame intervals; their single paired run is not a repeated GPU study.

Both versions' seven high scene captures have **byte-identical world HDR, raw
AO and filtered AO**. Final display images are not bit-identical: per-scene RGB
MAE is 0.029-0.945 /255, worst channel difference11. With fixed exposure the
range is 0.026-0.613 /255, worst13. These small differences are disclosed rather
than called exact final-frame parity. A controlled64x36 HDR fog fixture with
fixed camera/frame, depths0/3/30/60/120/300, density noise0/1 and marched/analytic
paths (24 comparisons) has maximum relative L1 error6.81e-8; maximum half-float
channel difference0.0001221. Cleared sky is exact. Captures were visually checked;
final overall migration human approval is still pending.

High odd resize, sky/AO linkage, day/night CSM, haze lifecycle, medium/ultra,
analytic low, moving-reload/glint/disposal probes and standard hero capture pass.
Smoke tests, lint and build pass. Medium's pre-existing resize/capture issues
are not claimed fixed. No upstream GTAO changes were backported.

Evidence: `/tmp/cod-fog-hoist-profile-{before,stock}-{1,2,3}.json`,
`/tmp/cod-fog-hoist-gpu-{before,stock}{,-raw}.json`,
`/tmp/cod-fog-hoist-game-dgpu{,-fixed}/`,
`/tmp/cod-fog-hoist-image-diff{,-fixed}.json`,
`/tmp/cod-fog-hoist-fixture.json`, and `/tmp/cod-fog-hoist-*.log`.
