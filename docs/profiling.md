# Profiling and native diagnostics

```sh
node tools/profile.mjs --port=5389 --frames=1800 --warmup=120 \
  --w=1280 --h=720 --dpr=1 --quality=high --out=/tmp/combat-profile.json
```

Choose an unused port. The profiler owns an HMR-free server/browser and closes
both on success/failure. Hardware WebGPU is required, not a software adapter.
Use `--executable=/path/to/chrome` if needed; on multi-GPU Mesa hosts select the
adapter explicitly (e.g. `MESA_VK_DEVICE_SELECT=1002:7550!` on the RX 9070 XT).
For `--production=1`, run `npm run build` first; preview serves existing dist.

## Fixture and acceptance

The shared `living-combat-v1` fixture executes real perception, navigation, fire,
reload/switch, physics, damage and FX. Five non-staged soldiers and the player
start with finite 10,000 HP; grenades are disabled, damage is not intercepted,
and actors are not revived. `--agents=12` uses three squads in validated lanes.

Default lockstep runs one 60 Hz engine step per real rAF. Each 900-frame cycle
walks/turns, fires/reloads rifle and pistol, then switches back. `--frames` accepts
900/1800/2700/3600; `--warmup` accepts 0..600 uncredited frames. Each 300-frame
block must retain living actors, active contact, enemy shots and player movement.
Fire, completed reload/switch, camera, impact and incoming-damage gates reject
idle/obstructed runs. The measurement deadline is 180 seconds, including waits.

Failures overwrite the report with the original error, partial samples and
`summary: null`; never leave stale success or invent missing intervals. Setup,
coverage, GPU capability and drain failures share cleanup. Lost browser contexts
or early boot failures may leave only the failure report/stderr. No universal
cross-hardware frame-time threshold is imposed.

## Modes and measurement scopes

| Option / field               | Meaning                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--realtime=1`               | Native variable-dt step; input edges survive fractional/skipped ticks. Separate elapsed-time fixture, not equivalent lockstep replay. |
| `--paced=1`                  | Keep browser pacing/vsync flags; headless cadence is not physical display presentation.                                               |
| `--detail=1`                 | Inclusive system/method costs and counts. Nested nav/controller costs overlap: do not sum.                                            |
| `--cpu-profile=PATH`         | CDP sampling (500 μs, including warmup), with clock alignment metadata.                                                               |
| `--submission=1`             | Count-only native binding/node/upload/draw-category diagnostics; keep separate from throughput acceptance.                            |
| `--cpu-core=N`               | Optional Linux renderer-main-thread affinity after boot; existing workers/GPU threads retain their affinity.                          |
| `--worker-profile=1`         | Nested worker kernel timing; don't pool with uninstrumented runs.                                                                     |
| `--query-trial=base\|repeat` | Fresh worker/cache with exact-cycle rejection disabled/enabled; ordinary gameplay enables it.                                         |
| `frameTimeMs`                | Nominal rAF timestamps; they can mask/shift CPU hitch attribution.                                                                    |
| `callbackIntervalMs`         | Callback-start to next callback-start, attributed to the earlier step.                                                                |
| `cpuMs / renderMs / gameMs`  | Synchronous step / CPU render submission / difference, not GPU times.                                                                 |
| `callbackLagMs`              | Delay between nominal rAF timestamp and callback start.                                                                               |
| `cpuBudgetMissCount`         | Steps exceeding the explicit 16.667 ms budget; independent of hitch thresholds.                                                       |

`--gpu=1` is a separate diagnostic. Native render/compute timestamp frame IDs
must match the requested frame; missing compute remains null. Never await
readback inside the pacing loop; at most one resolution pair is pending.
The final drain is bounded by five seconds or the remaining loop deadline.
Restore hooks/flags/step even on timeout; preserve the original failure and
record secondary `gpuFailure`. Late results cannot publish after cleanup.
Pass sums exclude copies, queue wait and presentation: whole-frame GPU time
remains unavailable, not zero.

Worker round trips include dispatch, queueing and main-thread delivery; execution
is separate. Returned proofs may wait for a caller retry while other combat runs.
Keep gap frames, unfinished jobs/decisions and dropped samples in reports.
Asynchronous admission is not seeded replay equivalence; see [ai-worker.md](ai-worker.md).

## CPU submission experiments

`tools/cpu-submission-profile.mjs` aligns CDP/document clocks and source maps,
filters measured-frame render stacks, and reports overlapping inclusive/exclusive
samples. Optional end-session Performance metrics include setup/warmup/export;
`ThreadTime` is main-thread CPU, not GPU time or a steady-frame duration.

`tools/cpu-submission-trial.mjs` applies exact-source-guarded offline prototypes,
builds fresh production, and restores source **and build** in `finally`. Outputs
must be outside the checkout. Never run trials concurrently or run pristine-source
smoke tests during mutation. CPU affinity is a separate recorded protocol, not a
runtime optimization. See [the #458 follow-up](investigations/cpu-submission-458.md)
for matched results, rejected pilots, scope caveats, and forced-stop recovery.
The standalone `batch-submission-probe.mjs` is a static development-module API toy;
its rAF cadence may remain paced despite launch flags. It is not combat/FPS acceptance.

## Refresh-policy and shader-dependency census

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=refresh-census --id=census --out=/tmp/458-refresh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=shadow-color-census --id=pruned-census --out=/tmp/458-refresh
```

These are off-by-default, exact-source-guarded **count-only** diagnostics. The
collector is installed before boot/prewarm and records original short-circuit
refresh witnesses, compiled creation causes, nested pass identity, unique logical
objects versus RenderObjects/group visits, binding/upload counts and representative
WGSL. Stateful observer predicates are not rerun. Missing metadata or mismatched
frame/draw counts fail the report; diagnostic errors do not replace renderer errors.
Do not compare these runs' throughput or combine them with CPU/GPU/detail timing.
The profiler's internal `--refresh=1` requires matching instrumented native sources;
use the runner rather than manually modifying dependencies.

`shadow-color` is the separate, uninstrumented app-only dependency-removal control,
not a shipped optimization or a blanket node-refresh bypass. The two exact-default
shadow observer controls are retained as negative evidence. See
[refresh/shadow findings](investigations/refresh-policy-458.md) for eligibility,
limitations, nine natural-scheduler pairs and correctness checks. On forced stop,
recover only in the disposable worktree: restore the guarded application shader
and material files without losing unrelated work, reinstall dependencies, clear
Vite cache, and rebuild production. Never run pristine-source tests during a trial.

## Native counters and readback

`rendererCounters()` in `src/dev/render-info.ts` distinguishes native renderer
frame ID, cumulative render/compute calls, calls/draws since info reset, live
shader stages, and unavailable historical WebGL programs. Info reset does not
clear cumulative totals; its reset window is not necessarily one app frame.
Unavailable values are null. Existing native `calls/renderCalls` aliases remain
cumulative. Profiling measures explicit before/after deltas around each step.

`trackNodeBuilders()` preserves callback context/return/errors, counts each
observer once, and is inert after disposal. Repeated `verifyNative()` replaces
its prior observer; missing support fails verification. Builder activity is not
GPU pipeline count, compile time or proof of a hitch's cause.
`tools/lib/native-render.mjs` injects helpers into production preview, which
does not serve source URLs. `packedReadback()` validates exact element count,
without inferring padding or interpreting color/half-float values. Native Three
removes GPU row padding. Callers own decoding, output transforms and nonblank
checks; restore targets/face/mip and never dispose shared QuadMesh geometry.

## Startup and lifetime checks

The HTML shell covers module load → init → prewarm → first successful gameplay
render, without invented progress/minimum delays. Warmup does not dismiss it;
capture readiness remains frame three. Startup disables DOM/gamepad gameplay
input (including held axes), not script-injected capture snapshots. Entry/import
failures show HTML reload state; engine errors retain their terminal dialog.
See [architecture](../ARCHITECTURE.md#prewarm) for staging/cleanup invariants.

After building, test emitted HTML entry/import failures with:

```sh
node tests/e2e/loading-shell-e2e.mjs
node tests/e2e/loading-screen-e2e.mjs
node tests/e2e/loading-screen-e2e.mjs --normal=1 # ordinary rAF startup, no capture API
# Controlled dev-response mutations, never production fault-injection switches:
node tests/e2e/loading-screen-e2e.mjs --failure=entry # also import/init/prewarm/render
```

`loading-screen-e2e` holds actual entry/init/prewarm boundaries and checks
neutral held-gamepad commands at first render, next-frame resumption, DOM/ARIA/
reduced motion and frame-three readiness. `--out=/absolute/path` saves evidence.
Controlled pauses are instrumentation, not runtime delays. Console/page and
GPU/WGSL validation errors fail; general TSL warnings remain separate.
Headless submissions/screenshots do not prove physical presentation timing.

`window.__PREWARM__.hooks` is the canonical report, published before the terminal
failure gate even if `__ENGINE__/__READY__` are not. `?prewarm=0` reports disabled.
Preserve the distinct native contexts listed in the architecture's prewarm contract.

```sh
node tests/e2e/production-boot.mjs
node tests/e2e/startup-e2e.mjs --quality=high # also low/ultra
node tests/e2e/startup-e2e.mjs --negative=weapons # must fail on late builders
node tests/e2e/startup-e2e.mjs --failure=prewarm # checks failed report/no readiness
node tests/e2e/profile-failure-e2e.mjs
# Canonical sequential render suites (uniforms requires RX 9070 XT Mesa selection):
MESA_VK_DEVICE_SELECT=1002:7550! node tools/render-regression.mjs
node tools/render-regression.mjs --suite=effects --fixture=1
node tools/render-regression.mjs --suite=composition --negative=alpha # must fail
node tools/ao-filter-check.mjs # selected filter; negatives: sky/noise/contact
node tools/render-motion-check.mjs --phases=haze
node tests/e2e/shader-noise-e2e.mjs
```

Keep RNG/clock/camera/resource restoration, readiness and first-use assertions.
AO comparison evidence: [published audit](https://gist.github.com/EdoardoLuciani/79403cb0d0ee026325e5f97f1837ddcc).
The interior AO game-smoke ROI at 480×270 fails its raw-noise floor on both old
and selected filters; retain that gate and use 1280×720 for this scene's blur check.
GPU jobs run sequentially; compare at least three fresh runs on matched hardware,
browser, quality/resolution, fixture and cache/load policy. Record provenance,
p50/p95/p99/max and hitches. This high-HP gunfight fixture is not unrestricted
waves, grenade/radio, normal-health balance or real input latency acceptance.
Historical WebGL/upgrade/clustered/fog measurements remain in
[#316](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/316),
[#380](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/380),
[#381](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/381) and
[#382](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/382); they are not
measurements of the current combined runtime.
