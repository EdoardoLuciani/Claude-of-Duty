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

## Second optimization: unlit opaque prepass

`prePass.lighting` now owns a separate Three.js `Lighting` manager with
`enabled = false`. PassNode scopes and restores it; production materials are
neither cloned nor swapped. Their normal/alpha/vertex nodes and the existing MRT
channels remain intact, but lighting, diffuse IBL, shadow sampling and their
bindings no longer enter the prepass. World and weapon lighting are unchanged.
The dedicated manager also isolates render-list/light caches, avoiding the
historical empty-prepass/shared-world-light-cache failure.

Native CSM submission moves from the prepass to the world pass. Its shadow
camera now explicitly selects layer1 before cascade cameras are cloned. Without
this, Three inherits the world camera's layers and adds39 caster draws/frame;
that diagnostic changed HDR. The production fix preserves the former opaque
caster set, and draw counts match exactly at1079.22/frame in the scripted test.

Validation is **RX 9070 XT only**, Three.js 0.186.1, Chrome 153, 960x540/DPR1/high.
The fog hoist remains enabled in both versions; the baseline is `9591f9a`. Three
paired 900-frame runs discard 60 warmup frames and move/turn/fire in 840 measured
frames each. Run 2 reverses configuration order. All report zero errors.

| Run | Before mean / p50 / p95 / p99 ms | After mean / p50 / p95 / p99 ms |
|---|---:|---:|
|1|28.33 / 21.9 / 85.9 / 159.1|21.83 / 17.6 / 61.2 / 95.3|
|2|29.29 / 22.7 / 84.8 / 153.2|23.41 / 19.0 / 65.6 / 101.6|
|3|28.79 / 21.7 / 83.5 / 152.2|21.15 / 16.3 / 62.3 / 103.2|

Mean intervals across these runs fall 28.81 -> 22.13 ms (~23%). This is a repeated
scripted whole-app improvement, **not final unscripted performance acceptance**;
legacy same-browser medians/tails remain substantially better.

Separate light-instrumented runs show queue writes 12426.91 -> 7699.36/frame
(~38% fewer), uploaded bytes 3.072 -> 2.969 MB/frame, and synchronous engine wall
time 29.14 -> 20.42 ms. That wall time includes native waits/backpressure, not pure
CPU execution. Prepass/world `updateBefore` exclusive wall scopes move
10.39/7.34 -> 1.83/10.67 ms; the world now includes the CSM submission formerly in
the prepass. **All 510 post-warmup builders remain**. This is not a cache/hitch fix.
Separate timestamp runs (28 sampled frames each) show measured pass sums
2.368 -> 2.667 ms and prepass 0.265 -> 0.296 ms: **no GPU-pass speedup is claimed**.
Do not add CPU wall and GPU times, or infer shader cost from the perturbed runs.

`PREPASS=1` exercises the real graph with original materials and compares settled
lit/unlit MRTs. Normals, positive depth, velocity and ultra SSR surface data are
byte-identical. The probe checks isolated/restored lighting, unchanged source
materials, fewer compiled fragment bindings (27 ->14 high, 29 ->14 ultra for a
mapped material), no shadow texture bindings, and mask 2 on all cascade
cameras. Run with `MESA_VK_DEVICE_SELECT=1002:7550! PREPASS=1 WIDTH=960 HEIGHT=540
QUALITY=high SHOT=combat node tools/webgpu-game/run.mjs` (also `QUALITY=ultra`).
Negative controls re-enabling lighting or removing the caster-layer pin
fail. It yields native rAF frames while settling history: synchronous draws and
shader-debug compilation are not interchangeable with history frames.

Seven matched high scenes have byte-identical world HDR, normals, positive
depth and raw/filtered AO. Velocity is exact in six scenes, **not ADS**:3271
half-float channels (2241 pixels) differ, maximum NDC delta0.0043945. An explicit
node-frame-clock diagnostic reproduces the difference; do not dismiss it as
capture scheduling noise. A draw trace shows equal previous model/camera
matrices and current bone buffers, but a different previous-bone snapshot for
one soldier when CSM and prepass exchange order. Other soldiers' bone buffers
match. Settled velocity tests pass; this transition is not bit-exact temporal
parity and stays disclosed for visual review. Ultra hero/combat surface,
velocity and HDR buffers match exactly.

Final high images with fixed exposure have RGB MAE 0.0024-1.1484 /255, maximum
channel difference 9. With the node-frame diagnostic, MAE is 0.0045-0.1186 /255,
maximum 15. Hero/combat pairs were visually inspected; this is not human migration
sign-off. High odd resize,
AO linkage, day/night, haze, medium/ultra, analytic low, moving reload/glint and
disposal pass. All51 smoke tests, lint, build, world validation and standard
hero capture pass. Medium resize/capture and upstream GTAO remain unchanged;
PR316 stays draft, with overall visual/performance and temporal review open.

Evidence: `/tmp/cod-unlit-prepass-{profile,game,trace}.mjs`,
`/tmp/cod-unlit-prepass-plain-{before,stock}-{1,2,3}.json`,
`/tmp/cod-unlit-prepass-{light,gpu}-{before,stock}{,-raw}.json`,
`/tmp/cod-unlit-prepass-{game-dgpu-fixed,ultra-game,node-frame,trace}/`,
`/tmp/cod-unlit-prepass-image-diff.json` and `/tmp/cod-unlit-prepass-*.log`.
All routing/private instrumentation remains diagnostic-only.

## Third optimization: schedule AO once, warm native contexts, retain instance matrices

Baseline `83ade85` retains the fog hoist and unlit prepass. Three changes preserve
quality and use the pinned Three.js 0.186.1 public rendering/TSL APIs:

- World AO samples the bilateral output through a plain texture node. An explicit
  fullscreen `Fn` dependency schedules the native AO/filter update chain before
  world lighting. New mesh builders no longer traverse producers that replace
  GTAO/RTT material contexts and invalidate their fullscreen builder states.
  Scheduling alone removes 276 redundant AO/filter builders, leaving 234
  first-use world/prepass builders. A scoped black prepass clear preserves the
  original cleared normals instead of inheriting GTAO's white clear.
- With explicit user approval, boot runs the real nested graph with world/view
  geometry draw ranges zeroed and hidden static variants made reachable. No
  simulation, gameplay time or RNG advances. Visibility, culling, layers, draw
  ranges, pass flags and renderer target are restored. `compileAsync()` alone
  misses these states: render-context keys include attachment/MRT state and
  nested render-call depth (the same instance UUID/material/context compiled at
  startup gets a different native render context during gameplay).
  The first empty pass primes pipeline/TAA callbacks before scene shaders build,
  so velocity uses the unjittered projection. Complete the pinned TRAA 32-phase
  cycle without private resets, then use public `setSize(1, 1)` to force history
  initialization from the first real beauty frame. No scene vertices are drawn.
- Authored `owStatic` instance matrices use `StorageInstancedBufferAttribute`,
  retaining the original CPU array and usage/attribute semantics. Native storage
  uploads are versioned; small arrays no longer become per-object uniform-buffer
  uploads in every pass. Dynamic FX/weapon attributes are not converted. Explicit
  `needsUpdate` edits still upload once, then remain resident.

**Cold-start cost:** graph warmup takes 12.261-12.275 seconds in the final paired
runs (290 unique scene/view geometries), in addition to other startup work.
This moves compilation to loading, not a claim that shader construction became
free. The loading UI can stall during the cold native build; startup optimization
is a separate remaining concern. Replaying an already-warm graph takes roughly
0.5-0.8 seconds. No dependency edits, shader-source rewriting or private renderer
cache/uniform-limit overrides ship.

RX 9070 XT only (`MESA_VK_DEVICE_SELECT=1002:7550!`), Chrome153, 960x540/DPR1/high,
three paired 900/60-frame move/turn/fire profiles, run2 reversed order, zero errors:

| Run | Before mean / p50 / p95 / p99 ms | After mean / p50 / p95 / p99 ms |
|---|---:|---:|
|1|25.44 /20.1 /67.4 /108.0|13.95 /14.0 /17.8 /34.8|
|2|21.43 /16.6 /65.9 /90.4|14.44 /13.8 /33.3 /35.0|
|3|20.53 /15.7 /64.6 /89.1|13.02 /13.5 /17.2 /34.1|

Across-run mean intervals fall **22.47 ->13.80ms (~39%)**. All runs have
**510 ->0 post-warmup builders** and identical 1079.22 draws/frame. This is a
repeated scripted improvement, not unscripted gameplay acceptance: matched
legacy remains faster (10.09ms mean, 11.7ms p99), and whole-app tail gates stay open.

Separate light instrumentation: writes **7699.36 ->6939.79/frame (~10% fewer)**,
bytes **2.969 ->1.337MB/frame (~55% lower)**, engine wall **19.33 ->13.28ms**.
Wall includes native waits/backpressure and is not pure JavaScript CPU time.
Separate GPU timestamps (28 sampled frames) sum selected passes **2.890 ->2.301ms**;
world 1.165 ->0.905ms, prepass .312 ->.264ms. These selected samples exclude
uploads/copies/idle and are not isolated proof of a shader-kernel speedup. Do not
add them to CPU wall or whole-app intervals.

`RENDER_CACHE=1` checks no late authored static builders, resident matrix uploads,
prepass ->filtered AO ->world submission order, and a new instance UUID producing
world/prepass builders without rebuilding AO/filter materials. A versioned matrix
edit uploads exactly once. `GRAPH_WARM=1` replays the warmup and instruments public
scene drawing: all scene geometry draw ranges are zero (39029 object submissions
in the combat replay), source flags/materials/ranges restored, frame and RNG
unchanged. Negative controls restoring per-mesh AO traversal, uniform matrices,
skipping boot graph warmup or leaving geometry live all fail the intended checks.

Seven matched high scenes are byte-identical to `83ade85` in current world HDR,
normals, positive depth, velocity and raw/filtered AO. Ultra hero/combat also match
SSR surface data. This does **not** repair the earlier unlit-prepass ADS transition
relative to `9591f9a` or establish legacy temporal parity. Final fixed-exposure
images are not exact: high RGB MAE .041-1.069/255, maximum28. A diagnostic explicit
node-frame clock preserves the same exact current buffers but leaves final MAE
.034-.920/255, maximum29. Ultra final MAE .089/.445, maximum29/5. Hero/combat were
visually inspected; human temporal/visual sign-off remains pending.

High odd resize/AO linkage, lighting/haze lifecycle, high/ultra cache/warm/prepass
probes, medium cache/AO, analytic low, moving reload/glint/disposal, 51 smoke tests,
lint/build/world validation and fresh-port standard hero capture pass. Calibrated
indirect/exposure probes pass separately. Combining runtime warm/cache fixtures,
resize and the indirect exposure bounds still fails (hero exposure ~4.0 outside
3.2-3.7); that combined fixture assertion is not weakened or claimed fixed.
`FOG=1` requires marched high/ultra; analytic low has no marched shader to capture.
Pre-existing medium resize/capture, half-AO contacts and upstream GTAO are unchanged.
PR316 remains draft. No integrated-GPU tests were run.

Evidence: `/tmp/cod-runtime-{profile,game,negative}.mjs`,
`/tmp/cod-runtime-paired-{before,stock}-{1,2,3}.json`,
`/tmp/cod-runtime-final-{light,gpu}-{before,stock}{,-raw}.json`,
`/tmp/cod-runtime-{game-dgpu-fixed,node-frame,ultra}/`,
`/tmp/cod-runtime-image-diff.json`, `/tmp/cod-runtime-compare.png`,
`/tmp/cod-runtime-capture.png` and `/tmp/cod-runtime-*.log`.

## Fullscreen pass inventory (audit only)

The [GPU-level fullscreen audit](webgpu-fullscreen-audit.md) records actual
attachments, bound texture consumers, history copies and shader bodies for all
four quality presets and an active low-health probe. Recurring fullscreen draws:
high/medium20, low15, ultra26, plus sparse64x64 metering. Native bloom contributes
12 of these; pointwise low-health/exposure/tone-map/LUT operations are already
fused. Two removable-boundary candidates are identified, starting with the
high/medium TAA identity RTT. A diagnostic public-texture prototype removes that
one pass (20 ->19) while retaining native history copies, but image parity and
whole-app gains are **not yet validated**. Production remains unchanged by the
audit; no compute conversion or rendering optimization is claimed.
