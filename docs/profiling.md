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

| Option / field | Meaning |
|---|---|
| `--realtime=1` | Native variable-dt step; input edges survive fractional/skipped ticks. Separate elapsed-time fixture, not equivalent lockstep replay. |
| `--paced=1` | Keep browser pacing/vsync flags; headless cadence is not physical display presentation. |
| `--detail=1` | Inclusive system/method costs and counts. Nested nav/controller costs overlap: do not sum. |
| `--cpu-profile=PATH` | CDP sampling (500 μs, including warmup), with clock alignment metadata. |
| `--worker-profile=1` | Nested worker kernel timing; don't pool with uninstrumented runs. |
| `--query-trial=base\|repeat` | Fresh worker/cache with exact-cycle rejection disabled/enabled; ordinary gameplay enables it. |
| `frameTimeMs` | Nominal rAF timestamps; they can mask/shift CPU hitch attribution. |
| `callbackIntervalMs` | Callback-start to next callback-start, attributed to the earlier step. |
| `cpuMs / renderMs / gameMs` | Synchronous step / CPU render submission / difference, not GPU times. |
| `callbackLagMs` | Delay between nominal rAF timestamp and callback start. |
| `cpuBudgetMissCount` | Steps exceeding the explicit 16.667 ms budget; independent of hitch thresholds. |

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

`window.__PREWARM__.hooks` is the canonical report, published before the terminal
failure gate even if `__ENGINE__/__READY__` are not. `?prewarm=0` reports disabled.
Warm real zero-range world/view variants plus hidden weapon/optic/grenade/ammo,
AI flashlight, radio and private haze variants; don't remove distinct contexts.

```sh
node tests/e2e/production-boot.mjs
node tests/e2e/startup-e2e.mjs --quality=high # also low/ultra
node tests/e2e/startup-e2e.mjs --negative=weapons # must fail on late builders
node tests/e2e/startup-e2e.mjs --failure=prewarm # checks failed report/no readiness
node tests/e2e/profile-failure-e2e.mjs
node tools/webgpu-review-check.mjs
node tools/webgpu-final-check.mjs --fixture=1
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
