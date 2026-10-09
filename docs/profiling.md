# Living-combat baseline

```sh
npm ci
node tools/profile.mjs --port=5389 --frames=1800 --warmup=120 \
  --w=1280 --h=720 --dpr=1 --quality=high --out=/tmp/combat-profile.json
```

The script owns an HMR-free Vite server and closes it/browser on success or failure.
Choose an unused port. Full managed Chromium is preferred on Linux; override with
`--executable=/path/to/chrome`. Hardware WebGPU is required, never software fallback.
On multi-GPU Mesa systems choose the adapter explicitly (e.g.
`MESA_VK_DEVICE_SELECT=1002:7550!` for the measured RX 9070 XT).

## Fixture and acceptance

`tools/lib/profile-combat.js` is the shared `living-combat-v1` fixture. Capture
lockstep fixes simulation at 60 Hz; each engine step runs on a real rAF. Normal
AI perception/navigation/firing and actual player inputs, weapons, collision,
damage and effects execute. Five non-staged soldiers occupy validated clear lanes.
Both sides start with 10,000 HP; grenades are disabled. Health is not replenished,
damage is not intercepted, and actors are not revived mid-run.

Every 900-frame cycle walks forward/back with small camera turns, fires the rifle,
reloads, switches to pistol, fires/reloads it, then switches back. Default: two
cycles (30 simulated seconds) after 120 uncredited settle frames. `--frames` accepts
900/1800/2700/3600; `--warmup` accepts 0..600. Keep both fixed when comparing runs.
An elapsed 180-second measurement deadline cancels a pending rAF on timeout.

The run fails on death/staged AI/engine or browser errors; each 300-frame block
must retain living players, active AI contact, enemy shots and actual movement.
Completed reload/switch, player fire, camera motion, impact and incoming-damage
gates reject idle, obstructed or post-death runs. Measurement/coverage failures
overwrite JSON with the `failure` reason, collected samples/coverage and `summary: null`,
then exit nonzero. Missing final intervals stay `null`, never fabricated. Accepted
runs have `failure: null`. Boot/setup failures or lost browser contexts remain stderr-only.
No hard cross-hardware frame-time threshold is imposed.

`node tests/e2e/profile-failure-e2e.mjs` checks actual warmup/mid-loop rejection,
partial-report replacement and cleanup on hardware WebGPU.

## Interpreting results

JSON includes revision/dirty state, browser/device, effective quality/resolution,
boot/prewarm data, combat coverage, every measured frame and percentile/hitch summaries.
Frame interval includes scheduling/GPU backpressure; CPU step/render submit measure
synchronous JS only. The ending interval is assigned to the step that preceded it,
including the final measured frame. GPU timestamps are **unavailable**, not zero.
`nodeBuilders` counts native builder callbacks, **not GPU pipelines, compilation
milliseconds or proof of the cause of a hitch**. Telemetry reports `dNodeBuilders`;
historical WebGL `programs/dPrograms` remain separate and unavailable native counts
are `null`. Native capture counters likewise do not invent WebGL program zeros.

Run comparisons sequentially, at least three repeats, with the same GPU/browser,
quality, resolution, fixture, frame count and power/load conditions. Compare p50,
p95, p99, max and hitch records—not just average FPS. Preserve reports externally;
closed experiments belong in PR/Git history, not another harness.

This is a controlled sustained-gunfight baseline, not unrestricted waves, normal
survival difficulty, low-health/death rendering, grenade/radio coverage or a real-time
input-latency measurement. Large HP changes health-triggered retreat/death behaviour.
Lockstep simulation duration is not measured wall or GPU time. Startup timing is
reported separately; a faster boot is not evidence of faster combat rendering.

## Startup coverage

World/view materials warm through the renderer's actual zero-range graph, not
camera-pose or direct scene compiles. Those used different lighting/pass contexts;
removing only render's direct compiles let the later world hook recreate the work.
Keep material registration, scratch-target isolation for the remaining FX compiles,
awaited hidden-variant hooks, haze's private RG target and failure restoration.
Do not remove a graph warm merely because another subsystem already ran one.

```sh
node tests/e2e/startup-e2e.mjs --quality=high # also low/ultra
node tests/e2e/startup-e2e.mjs --negative=weapons # must fail: rifle late builders
node tools/render-motion-check.mjs --phases=haze
node tools/render-motion-check.mjs --negative=haze # must fail on haze builders
```

The test observes the real first warmup: unchanged clock/camera/health/actor count,
no RNG draws (including forks), restored target, zero builders in the readiness
frames, then all seven weapons' equip/ADS/fire/completed-empty-reload paths.
Optional `--shot=/tmp/startup.png` captures only after the builder assertions;
an alternate readback target can legitimately introduce capture-only variants.
The motion harness counts actual haze draws and retains intro haze builds: AI can
trigger first use during settling, before per-phase counters reset. Negative controls
must confirm their mutation executed and fail on builders, not readiness or routing.
Also run the existing motion, radio/projection, day/night and native failure/lifetime
checks: the rifle/pistol combat benchmark alone cannot establish warmup coverage.

Pure material/sky noise helpers use explicit TSL layouts to reuse shader functions,
not fewer octaves or altered noise. `node tests/e2e/shader-noise-e2e.mjs` compares
17 noise/composite cases against the same arithmetic without layouts, on a 64×64
GPU sample grid. It includes negative coordinates and rectangular periods;
`--negative=period` must fail after narrowing a vector period to a scalar. Check
actual material/sky captures too: the numerical probe is not full visual coverage.

## Clustered lighting on pinned Three dev (#370)

Trial `ec197eb` against merged upgrade `0669b68`: world beauty only, default
cluster capacities, explicit pre-render drawing-buffer sizing and owned-node disposal.
Three alternating pairs per day/night condition, high 1280×720 DPR1, RX 9070 XT,
Chromium 153, existing Mesa cache. Time of day is set after normal boot measurement.

| Median across runs | Day: standard → clustered | Night: standard → clustered |
|---|---|---|
| Frame p50 | 10.8 → 9.9 ms (−8.3%) | 11.2 → 10.0 ms (−10.7%) |
| Frame p95 | 13.4 → 12.4 ms | 14.1 → 12.6 ms |
| Frame p99 | 18.1 → 16.1 ms | 18.1 → 16.2 ms |
| CPU render-submit p50 | 8.4 → 7.4 ms | 8.7 → 7.6 ms |

Combined startup median: 13.43 → 10.49 s (−21.9%). All 21,600 measured frames
passed with matched combat/settings/hardware and zero late builders; no runs excluded.
Frame intervals/CPU submission are not GPU timestamps, and this is not a cold-cache
or direct three-way comparison with r186. Six fixed-exposure captures have small,
nonzero differences (worst mean channel error 0.083/255, maximum 7).

**Not ready to adopt:** the unchanged projection/radio check fails after resizing;
standard lighting and clustered lighting booted at the final size pass. Three
alternating follow-up pairs on the same GPU/cache, resizing 960×540 → 1280×320:
- First-frame interval: 16.3 → 1,303.5 ms (103 builders, ~1,254.5 ms synchronous build time).
- Clustered settling: another 346–380 ms stall; cause not isolated.
- First radio-strike frame: 4.0 → 16.8 ms (~12 ms in three late builders).
These are instrumented CPU/rAF timings, not a loading-screen wait. Keep the failing
check: fixed-resolution combat does not prove post-resize readiness.
The graph resource test passes growth, DPR changes, non-tile-aligned sizes and three
recreations: zero retained storage, 18 reference readbacks within 0.000489. Removing
explicit sizing restores retention (3/6/9 buffers); omitting node disposal leaks textures.

## Pinned Three.js dev upgrade (#370)

The upgrade to Three commit `9681657f7` was measured at game `8d2469c` against
`206f4d0`, with lighting unchanged (no clustered lighting). Three alternating
pairs per cache condition, high 1280×720 DPR1, nonfallback RX 9070 XT / Chromium 153:

| Median across runs | Existing Mesa cache: base → upgrade | Isolated Mesa caches: base → upgrade |
|---|---|---|
| Startup | 16.70 → 13.20 s (−21.0%) | 21.16 → 17.32 s (−18.2%) |
| Frame p50 | 9.6 → 10.1 ms (+5.2%) | 9.4 → 10.0 ms (+6.4%) |
| Frame p95 / p99 | 12.1 / 15.8 → 12.9 / 16.7 ms | 12.1 / 16.0 → 12.7 / 16.3 ms |

All 21,600 accepted frames passed with identical combat coverage/settings/hardware
and zero late builders. Faster startup is **not** an overall performance win:
combat regressed on this machine. These are frame intervals/CPU measurements,
not GPU timestamps. An initial pair overlapped image analysis and was retained
but excluded; clean existing-cache pairs 2–4 and isolated pairs 1–3 are reported.
Full results and six fixed-exposure image comparisons are retained with the PR.

For startup comparisons, collect `bootMs` and `prewarm` from the normal profiling
command on both revisions in alternating fresh browser processes. Record browser,
GPU, quality and cache policy; a fresh browser is not a cold driver shader cache.
Use repeated end-to-end timings, not the sum of removed compile-call durations:
work/JIT costs can move to the remaining graph warm. Keep detailed ablation results
with the PR rather than retaining a second experimental benchmark runner.
