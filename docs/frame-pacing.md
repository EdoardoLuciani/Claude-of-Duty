# Gameplay frame-pacing attribution (#370)

Investigation of runtime `807395a` (merged #390), not a performance fix. Only
profiling tools/tests/docs change. Runtime code, assets, resolution, sampling,
collision acceptance rules, AI policy and shader budgets are untouched.

## Conditions and measurement scopes

High, 1280×720 DPR1; nonfallback AMD RDNA4/RX 9070 XT, Chromium 153,
existing Mesa cache, Vite development build. Runs use fresh browser processes,
sequential GPU work and the existing living-combat lane: finite high HP, real
sensing/movement/fire/reload/switch/physics/hit FX, no staged AI. This does not
cover every map, weapon, effect, production build, vendor or display mode.

- Default: fixed 60 Hz simulation, uncapped browser callbacks. Three baseline
  runs, 120 settling + 1,800 measured frames each, gave nominal rAF P95
  **11.5–12.5 ms**, P99 **15.6–16.9 ms**, max **26.9–29.0 ms**.
- `callbackIntervalMs`: actual callback-start to next callback-start interval,
  attributed to the work executed in the first callback. Historical `dt` /
  `frameTimeMs` remain nominal rAF timestamp intervals, not renamed aliases.
- `cpuMs`, `renderMs`, `gameMs`: engine step, CPU render submission, and their
  difference. None is GPU time. Input fixture and browser work outside the step
  contribute to callback intervals. `callbackLagMs` exposes timestamp/start lag.
- `--detail=1`: optional inclusive system/method times and call counts. Nested
  `cover.pick`, `peekOffset`, `project`, `canAttach`, `lineOfWalk` overlap: **do not
  sum them**. Attachment-controller moves are counted, not timed (`ms: null`).
  Only actors present at fixture creation get the specialized observation hook.
- `--cpu-profile=PATH`: optional CDP sampling at 500 µs, including warmup;
  NavigationStart/clock metrics and performance time origin retain alignment.
- `--gpu=1`: separate diagnostic mode with native timestamp queries, not a
  baseline pacing comparison. Asynchronous resolution never blocks the loop;
  only one resolution pair is pending. Recorded render/compute native frame IDs
  must match the requested renderer frame. Missing compute time stays null.
  Pass sums exclude copies, queue wait and presentation. Whole-frame
  `gpuTimeMs` remains null. No GPU-tail percentile equivalence is claimed.
- `--realtime=1`: bypass only capture's fixed-step wrapper, using the real engine
  step and incoming rAF timestamp. Inputs follow elapsed simulation time; edge
  crossings survive fractional/skipped ticks. This is a different fixture,
  `living-combat-realtime-v1`, **not an equivalent gameplay replay**. Coverage
  requires complete elapsed 15-second input cycles plus the existing per-block
  living/sensing/fire/movement gates; partial-cycle events remain in the report.
- `--paced=1`: omit the benchmark's uncapping/vsync-disable flags. The observed
  headless cadence is approximately 60 Hz, not a physical display presentation
  measurement. `cpuBudgetMissCount` uses an explicit **16.667 ms CPU-step budget**;
  legacy hitch thresholds (max of 2×median and median+8 ms) remain unchanged.

## Dominant repeated outliers: AI physical eligibility checks

Both CPU sampling and direct method timing identify these chains:

```
Agent._combat / Squad._updateElevation
  → CoverMap.pick → peekOffset → SurfaceNav.project / lineOfWalk
  → canAttach → CharacterController.move
  → overlap/depenetrate/sweep/drop/ground probe → BVH/triangle math

Agent._breakFriendlyPeek → _startReposition → _pickObservationPoints
  → sampleGround / lineOfWalk → the same physical attachment/controller checks
```

A detailed repeat without CPU sampling (`detail-2.json`) recorded:

| Replay frame | Actual callback interval | AI update | Main decision | Attachment moves |
|---|---:|---:|---|---:|
| 806 | 25.6 ms | 16.0 ms | observation search 14.9 ms | 846 |
| 1144 | 26.6 ms | 16.2 ms | cover pick 15.7 ms | 404 |
| 1307 | 18.6 ms | 10.5 ms | cover pick 9.8 ms | 354 |
| 1409 | 21.1 ms | 11.4 ms | two cover picks 9.9 ms total | 401 |
| 1552 | 20.4 ms | 11.9 ms | cover pick 11.3 ms | 359 |

These five frames fire no player or AI shots. The 500 µs sampled run reaches
these same physics chains at the corresponding replay frames. GC samples inside
frames 1144/1409 total approximately .55/.48 ms respectively; none occurs in the
other three windows. Sampling is approximate, but GC does not explain the
17 ms AI outliers here. All measured runs report zero new **node builders**;
that is not a separate GPU-pipeline-compilation measurement.

The current guards are per-operation, not a full per-frame work budget:
`coverCandidates=8`, `observationProbes=24`, attachment checks up to 80 motor
steps, and longer `lineOfWalk` checks budget the complete continuation distance.
The existing **two path solves/frame** scheduler does not budget cover/peek and
observation physical validation. `findPath` costs 0–.1 ms on these detailed
frames, so simply lowering the Detour solve budget targets the wrong work.

In `detail-2`, 14/18 actual-callback P99-tail frames have ≥4 ms AI update;
8/9 CPU steps above 16.667 ms do too. Not every tail is AI-dominated.

## Normal variable timestep confirms the cause

The 3,600-frame uncapped variable-step run (`realtime-1`) has actual-callback
P50/P95/P99/max **8.3/10.9/13.2/23.2 ms**. Its worst CPU step is **22.3 ms**,
with **14.1 ms AI update and 689 attachment moves**. Nine of ten steps exceeding
16.667 ms have ≥4 ms AI update. Different trajectories shift the spike frames.

Two paced variable-step runs reproduce the expensive decisions:
- `paced-1`: actual-callback max **31.1 ms**; worst CPU step **30.0 ms**, including
  **18.8 ms AI update**, 409 attachment moves, and 10.1 ms render submission.
- `paced-final`: actual-callback P50/P95/P99/max **16.7/16.8/16.9/28.1 ms**;
  worst CPU step **27.2 ms**, including **16.8 ms AI update** and 1,079 attachment
  moves. Its nominal rAF maximum is only **16.8 ms**.

Percentiles can hide rare budget overruns. Nominal rAF timestamps can also mask
or shift attribution: replay frame 1261 has nominal delta 8.4 ms, actual callback
interval 17.7 ms and CPU step 16.8 ms in `detail-1`. Do not join CPU causes to the
same-index nominal-rAF tail list without checking callback/start timestamps.

## Broader P95 pressure: CPU render submission

Baseline run 1 CPU render-submit P50/P95/P99/max is **7.0/8.7/9.3/12.5 ms**.
In `detail-2`, draw-count bands 700–799 / 800–899 / 900–999 have render-submit
medians **5.9 / 6.7 / 7.5 ms** (419 / 594 / 727 samples). CPU sampling shows
ordinary native render-object/binding/uniform update work through world/shadow
passes. This is measured association and sampling evidence, not an isolated
proof of one renderer mechanism or a reason to force SHARED material refresh.

The frame-ID-validated GPU diagnostic (`gpu-validated`) captures 600 native
frames: render+compute pass-sum P50/P95/P99/max **2.900/3.228/3.309/3.347 ms**.
This supports CPU-focused investigation on this setup; unsampled frames and
queue/copy/presentation stalls are not ruled out by those GPU measurements.

## Follow-up, not implemented here

1. Address synchronous cover/observation physical-query bursts first. Investigate
   reuse of identical eligibility checks with correct geometry/pose/dimension
   invalidation, or bounded continuation of the existing decisions. Preserve
   collision, complete-route and firing-clearance guards; do not just lower probe
   counts, motor steps or omit failed checks. Scheduling changes need gameplay
   tests for claims, threat changes, cancellation and retained decisions.
2. Independently attribute render submission by pass/binding/object work before
   changing batching or observer eligibility. Pending Three instancing fixes are
   not proof that they remove this cost.
3. Keep remaining #370 hitch attribution open: grenades/radio, other weapons,
   deaths/waves, other scenes/quality settings and real display presentation are
   not exhaustively covered. No speedup or gameplay-equivalence claim for the
   alternate timestep fixtures is made.

## Reproduce

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5420 \
  --frames=1800 --warmup=120 --out=/tmp/baseline.json
# Separate diagnostic runs, not pooled with baselines:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5420 \
  --detail=1 --cpu-profile=/tmp/cpu.json --out=/tmp/detail.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5420 \
  --detail=1 --gpu=1 --out=/tmp/gpu.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5420 \
  --frames=3600 --detail=1 --realtime=1 --out=/tmp/realtime.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5420 \
  --detail=1 --realtime=1 --paced=1 --out=/tmp/paced.json
```

Default-final has identical combat JSON and all 1,800 corresponding call/draw
records versus baseline-1. This checks the retained default fixture, not timing
equivalence. Diagnostic runs carry their actual dirty/source provenance; they
are not falsely labeled as clean committed measurements. Source grounding:
`src/ai/{nav.js,agent.js,tuning.ts,index.js}`, `src/physics/{character.js,bvh.js,
math.js}`, `src/core/engine.js`, `src/dev/shots.js`, pinned Three
`9681657f7` `Backend.js` timestamp frame APIs and
`WebGPUTimestampQueryPool.js` (last-frame totals, not a batch average).
The same-commit official `examples/webgpu_performance.html` installs Inspector;
`Inspector.js` enables `backend.trackTimestamp` after init and
`RendererInspector.js` uses native resolution/frame APIs. We reuse that API
boundary, not its graph-wide interception or UI framework.
