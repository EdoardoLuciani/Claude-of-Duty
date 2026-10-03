# Reassessment: steady frame cost and the worst hitches have different causes

Reference: `4fb77c3`, after reverting the FX increment. **No production or
installed dependency changes in this investigation.** PR #316 remains draft.

## Conclusions

1. **Steady throughput is primarily limited by active main-thread preparation
   of scene draws**, especially Three's full node/binding refresh, not by FX
   transfer volume or GPU shading. In the matched moving fixture, removing all
   buffer writes saves about 0.6 ms; suppressing all draw submissions still
   leaves about 9.0 ms of engine wall work. Skipping warmed scene binding updates
   removes about 4 ms, despite retaining node updates and attribute uploads.
2. **The largest repeatable hitches in that fixture are not renderer hitches.**
   They are synchronous AI navigation attachment simulations inside cover and
   firing-position decisions. Two frames execute **1,620 / 1,502 character
   controller moves** in the navigation probe, taking about **25 ms each**.
   The two-path-solves/frame budget does not govern these operations.
3. These are different targets: reducing navigation bursts addresses latency
   tails; reducing per-draw preparation addresses the ~10–13 ms frame floor.
   Neither result justifies a quality cut, a generic private cache bypass, or
   an upload-count-based optimization. No single GPU/upload bottleneck explains
   both. No fresh legacy-parity or human/unscripted acceptance is claimed.

### Assumptions corrected

- Fewer bytes/writes do **not** imply proportionally less renderer CPU work.
  Traversal, node callbacks, uniform comparisons, texture/sampler checks and
  command preparation still execute.
- Average renderer cost does **not** identify the source of the worst frames.
  The largest sampled spikes remain with rendering completely disabled.
- A "two path solves per frame" limit does **not** bound all navigation work.
  Physical attachment/straight-walk checks bypass that scheduler.
- A whole CPU recording includes staging/warmup. In the new profile, unfiltered
  `writeBuffer` samples total ~738.5 ms, but only ~208.0 ms fall inside the marked
  steady window. Node `build` samples outside that window do not establish
  steady shader rebuilding. All accepted measured windows have zero builders.

## Method and limits

RX 9070 XT only, actual renderer device `amd / rdna-4 / nonfallback`, Chrome
153/Vulkan, pinned Three 0.186.1, high960×540/DPR1. The new runner uses lockstep
capture: no engine frames advance during driver round trips. It pumps 60 initial
frames, applies the usual firefight stage/input script, then runs 30 settling
frames plus 300 measured frames (360 in the sampled trace). These are **not**
the previous hero-start900/60 performance fixture; compare controls within this
investigation, not their absolute means against old migration/legacy numbers.

`tools/webgpu-frame-isolation.mjs` has two modes:

- Default moving engine: fixed simulation timestep, moving/turning/firing input;
  separate boot for matched trajectories. `--agents=normal` releases the staged
  agents into normal AI decisions/motion from the same deterministic starting
  positions. It is still a scripted fixture, not unscripted play.
- `--live=0`: simulation and camera held at the settled combat shot; interleave
  controls and restored stock in one warmed browser. This scene has fewer visible
  objects and no staged world soldiers, so it is a structural control, not a
  substitute gameplay benchmark.

All suppression controls are **intentionally invalid images**, not shipping
candidates. The runner counts candidate draw parameters before optional draw
suppression (including zero-count draws), not proof of equal GPU execution or
image correctness. Sparse exposure draws can differ by a tiny count as async
meter completion moves. Do not add control deltas: scopes overlap and changed
GPU work/clocks can change throughput. No power/clock settings were changed.

An initial unscoped skip-bindings control produced Bloom texture read/write
validation errors. That run is **excluded**. The accepted control only skips
already-warmed world/view scene objects, retaining initialization and all
fullscreen/ping-pong texture updates. Accepted runs had no validation/page errors.

## 1. Moving whole-app controls

300 measured frames, baseline bookends, same starting scene/input/seed:

| Control | Engine wall mean | Render wall mean | Frame interval mean |
|---|---:|---:|---:|
| Stock, first | 10.141 | 7.892 | 10.850 |
| No draw submissions; retain preparation | 8.960 | 6.771 | 9.612 |
| Skip warmed scene binding refresh | 6.172 | 4.041 | 6.817 |
| No native buffer writes | 9.527 | 7.294 | 10.249 |
| Stock, last | 10.062 | 7.832 | 10.774 |
| No rendering | 1.950 | 0 | 2.330 |

Times are milliseconds. Candidate workload stock/no-draw/no-binding is identical
per measured frame: means **952.237 draws / 21,152,202.71 index-or-vertex instances**.
No-write has one fewer optional meter draw across the window; scene workload is
unchanged. Stock has about1,658 write attempts/frame. Suppressing draws removes
both GPU geometry execution and CPU draw dispatch, yet most engine time remains.
This is stronger evidence against GPU shading as the primary floor than merely
noticing that selected GPU timestamps are small.

In the first stock run, interval vs engine-wall Pearson correlation is **0.9993**;
mean outside-step gap is **0.711 ms**. Worst intervals38.2/37.8 ms have engine
wall37.5/37.1 ms, but render wall only8.8/9.2 ms. Their remaining28.7/27.9 ms
is inside simulation, not browser presentation waiting.

### Main-thread/native evidence

A separately instrumented moving trace spans4.169 s of marked steady work:
renderer animation-callback wall~3.870 s and reported thread CPU~3.898 s track
closely. The slight impossible CPU-over-wall discrepancy prevents exact wait
subtraction, but is inconsistent with dominant sleeping/backpressure.

Within this same window, steady main-thread self samples include uniform-group
`update`7.3%, `Bindings._update`6.0%, `_updateBindings`6.0%, native `writeBuffer`5.0%,
and many smaller node/value/matrix checks. These are sampled shares, not additive
causal millisecond budgets. Node builder count is zero.

GPU-process `DawnCommands` totals~1.319 s wall/~1.281 s thread CPU, concurrent
with renderer-thread work. It is **CPU service work, not GPU execution**, and
cannot be added to renderer wall. Client flush scopes are small compared with
the frame; this does not establish a browser validation defect or justify an
unsafe validation flag.

## 2. Why native draw preparation is expensive here

Pinned source chain:

1. `NodeMaterialObserver.needsRefresh()` immediately returns `FULL` for custom
   material/context nodes, skinning, dynamic instancing or velocity. It does so
   before its immutable/static/bundle shortcuts.
2. `Renderer._renderObjectDirect()` consequently runs node-before, geometry,
   node-update, binding-update, pipeline and draw work for each render object.
3. `Bindings._update()` walks each binding, checks group versions, compares
   uniform values, checks sampled textures/samplers/storage and constructs
   texture cache-key data. Not uploading a changed range skips only the final
   upload, not all this preparation.
4. The world's large render-group layout varies across material/geometry/context
   variants. Shared node values are not one canonical shared GPU buffer/layout.
   The three shadow passes and MRT prepass multiply per-object preparation.

One moving-frame census (script index30); binding/field counters cover
`updateForRender`, not the separate shared-only fast path:

| Pass | Candidate draws | Node update entries visited | Bindings checked | Uniform fields compared |
|---|---:|---:|---:|---:|
| World | 164 | 15,932 | 4,320 | 15,590 |
| CSM0 | 225 | 2,800 | 3,200 | 1,942 |
| CSM1 | 228 | 2,836 | 3,251 | 1,972 |
| CSM2 | 230 | 2,860 | 3,285 | 1,992 |
| Prepass | 140 | 1,990 | 1,802 | 1,963 |
| Weapon | 38 | 1,475 | 520 | 927 |
| Post | 20 | 105 | 105 | 124 |
| **Total** | **1,045** | **27,998** | **16,483** | **24,510** |

The binding/field totals are thus not an exhaustive count of the shared-only
weapon fast path; all world/CSM rows take the full path. Entries visited are
not necessarily actual node-update callbacks: FRAME/RENDER
nodes can skip their body after a cache check. Every world and CSM draw has
`hasNode=true`; prepass129/140 do too, with remaining skinning/velocity paths.
World render-group comparisons include **9,002 visits to just75 light-uniform
IDs** (colors/attenuation fields), up to127 visits to one node. These are repeated
comparisons, not9,002 native writes and not all removable with a safe frame-wide
skip. The previous position/camera sharing did not unify all world layouts.

Separate fixed-scene interleaved controls narrow this further:

| Control | Nearby stock renderer wall | Controlled renderer wall |
|---|---:|---:|
| Skip scene uniform-group comparisons | ~5.09 | 3.94 |
| Skip scene texture/sampler checks | ~4.94 | 4.14 |
| Skip scene update-node traversal | ~4.91 | 4.07 |
| Skip all warmed scene binding refresh | ~4.76 | 2.50 |
| Half drawing-buffer width/height | ~4.03 | 4.03 |
| Freeze all CSM updates | ~3.99 | 2.02 |
| Disable asynchronous exposure meter | ~3.94 | 3.93 |

These are different short runs, not additive components. Shadow freezing removes
494 candidate draws but only about3 queue writes in this fixed scene. Thus its
~2 ms effect cannot plausibly be explained by upload count; it removes traversal,
checks, dispatch and GPU work together. Freezing shadows is not a quality proposal.

## 3. Exact root of the repeatable large hitches

Stacks identify:

- `Squad._updateElevation()` → `CoverMap.pick()` → `peekOffset()` / `project()`.
- `Agent._startReposition()` → `_pickObservationPoints()` → `lineOfWalk()`.
- Both reach `SurfaceNav.canAttach()` → the diagnostic character controller's
  `move()` → depenetration, lift/slide/drop/ground sweeps and triangle tests.

`src/ai/nav.js` uses **1.5/60 =0.025 m per simulated step**. `canAttach()` defaults
to80 steps, but `lineOfWalk()` explicitly raises its budget to distance/0.025+1.
`_pickObservationPoints()` considers24 probes, with local radii1.2/2.5/5 m;
cover scoring has an8-candidate shortlist and up to5 peek positions. The lists
are finite, but the nested physical simulations all execute in one frame.
`AISystem.requestPath()` limits Detour path solves to2/frame, not these checks.
The culprit is **synchronous candidate validation**, not slow WASM path solving.

### Recorded-answer causal test

Record every `canAttach()` call's exact coordinates, optional radius/height/step
arguments, collision-world version and boolean result. In a separate identical
run, replay only those results, rejecting input/count mismatches. AI selection,
normal path solves and every renderer pass still run. This is an **oracle-style
fixture control, not a valid general-purpose navigation cache**: it avoids the
real work only because its answers were computed by the reference beforehand.

Final committed-tool pair, **212/212 identical inputs and answers**, all300
frames' candidate draw/work counts equal, final recorded camera, RNG and actor
positions/health/state/targets/path flags equal:

| Script frame | Probe controller moves | Attachment time | Engine wall reference → replay | AI update reference → replay |
|---|---:|---:|---:|---:|
| 181, elevated cover | 322 | 10.5 ms | 23.7 → 11.5 ms | 13.0 → 2.1 ms |
| 238, firing reposition | 1,620 | 25.3 ms | 40.1 → 11.9 ms | 28.3 → 2.8 ms |
| 241, firing reposition | 1,502 | 25.0 ms | 38.3 → 12.0 ms | 26.5 → 1.2 ms |

Frames238/241 have113/86 attachment calls,17/21 `lineOfWalk` calls, but only
**one actual path solve each (~0.0–0.1 ms)**. Replay executes zero probe moves.
Measured frame-interval p99 **24.5→14.5 ms**, maximum **40.9→16.9 ms**, means
**11.028→10.645 ms**. A preceding pair likewise removed the same spikes but its
aggregate means were essentially tied (11.358/11.390 ms), illustrating why the
large event-local saving must not be presented as a large average FPS gain.
Changing the first replay coordinate by0.01 fails with
`navigation replay input mismatch at 0`.

### Normal, non-staged AI cross-check

The standard staged fixture still calls live `_shoot()`/navigation but restricts
movement and can amplify blocked-position decisions. To avoid generalizing that
artificial frequency, a separate pair releases agents into normal behavior.
**136/136 query inputs/results**, final sampled gameplay state and per-frame
candidate draw/work counts match. Cover-decision frames76/258 do199/115 physical
probe moves; attachment time4.8/3.4 ms disappears on replay, and AI update drops
**9.3→3.8 / 5.3→2.8 ms**. Thus the same cost exists in normal decisions, but the
25 ms bursts are not universal. Overall means **12.643→13.521 ms** worsen as
render time varies; p99 **19.5→19.3 ms** is effectively unchanged. This pair
supports the event-local cause, **not a whole-app speedup or all-hitches claim**.

## What to address next—not changes made here

1. **Tail latency:** budget/schedule the physical candidate-validation work,
   not merely Detour solves. Preserve collision correctness and candidate
   semantics; do not silently return success, truncate valid routes or disable
   AI. Incremental searches need cancellation/revalidation when evidence,
   actor dimensions or collision state changes. Profile the ordinary AI path
   as well as staged fixtures.
2. **Steady throughput:** reduce per-draw full-refresh work, particularly
   repeated material texture checks and duplicated camera/light field scans
   across layouts/cascades. Target an actual reduction in CPU preparation,
   using supported lifetime/batching mechanisms or a narrowly justified upstream
   design—not another experiment that only reduces transferred bytes.
   Skinning/velocity, dynamic textures, pass cameras, alpha and shadows remain
   correctness requirements. Blindly forcing the static/SHARED fast path is unsafe.
3. Keep whole-app means/tails, engine/render wall, thread CPU and GPU service/
   execution measurements separate. Cold startup, legacy parity and visual
   acceptance remain independent open gates.

## Reproduction / validation

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --nav=1 --out=/tmp/nav-record
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --replay=/tmp/nav-record.json --out=/tmp/nav-replay
# Use --agents=normal on BOTH calls to exercise ordinary AI behavior.
# A one-frame structural census (timing perturbed):
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --frames=60 --census=1 --out=/tmp/frame-census
# Repeated fixed-scene controls, intentionally incorrect images:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --live=0 --frames=120 --controls=stock,no-writes,stock,no-bindings,stock \
  --out=/tmp/frame-controls
```

Committed runner record/replay, normal-AI record/replay, negative replay, census
and scoped controls passed their intended checks. `npm test`, lint, build and a
fresh standard capture pass. No world assets changed. Detailed local evidence:
`/tmp/cod-root-{live-*,scoped,loops,work,final-record,final-replay,normal-record,normal-replay}*`;
marked trace/profile: `/tmp/cod-root-live-profile.{trace.json,cpuprofile}`.
