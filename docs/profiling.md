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

## Compute fog trial (#370, experimental branch only)

**Recommendation: keep raster fog on develop.** Compute is a valid implementation,
not a simplification or a substantial combat-performance improvement. This trial
branch enables it for marched fog only; analytic low-quality fog stays raster.
No resolution, step count, shadow taps, noise, exposure or gameplay tuning changed.

Baseline: `0669b68`, pinned Three `9681657f7`. RX 9070 XT, nonfallback RDNA4,
Chromium 153, high 1280×720 DPR1, existing Mesa shader cache. Three sequential
pairs, ordered raster/compute, compute/raster, raster/compute. Each combat run
uses the existing profiler: 120 settle + 1,800 measured living-combat frames.
Other GPU browser work was paused; earlier overlapping runs are excluded.

| Median across three runs | Raster | Compute | Change |
|---|---:|---:|---:|
| Combat frame p50 | 9.8 ms | 9.7 ms | −1.0% |
| Combat frame p95 | 12.6 ms | 12.2 ms | −3.2% |
| Combat frame p99 | 16.6 ms | 16.0 ms | −3.6% |
| Per-run maximum, median | 28.3 ms | 28.5 ms | +0.7% |
| CPU render-submit p50 | 7.7 ms | 7.6 ms | −1.3% |
| Static hero fog GPU p50 | 0.77056 ms | 0.73140 ms | −5.1% |

Combat frame p50 by pair: 9.8→9.7, 10.0→9.7, 9.8→9.7 ms.
Hitch counts: raster 6/8/6, compute 6/5/6. All 10,800 frames passed, with
identical combat coverage (50 player shots, 427 AI shots, four completed reloads,
four switches) and zero late builders. Median boot was 13.11→13.09 s, not a
meaningful startup improvement. These frame intervals include scheduling;
CPU submit is not GPU time. No statistical significance or cross-hardware win
is claimed for the small end-to-end difference.

GPU pass timing is **separate static-scene evidence**, not combat GPU time:
the existing graph audit now records compute-pass timestamps too. Both revisions
used the same audit script, 1280×720, 120 settle + 24 recorded frames per run.
Raster fog p50s: 0.76340/0.77056/0.77276 ms; compute:
0.73232/0.73120/0.73140 ms. The ~0.039 ms saving is too small to justify the
additional integration burden here. Audit instrumentation is not used in the
combat profiler; whole-frame combat GPU time remains unavailable.

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-graph-audit.mjs \
  --port=5391 --w=1280 --h=720 --warmup=120 --frames=24 --verify=1
node tests/e2e/fog-compute-e2e.mjs --out=/tmp/fog-compute
node tests/e2e/fog-compute-e2e.mjs --raster --out=/tmp/fog-raster
node tests/e2e/fog-compute-e2e.mjs --quality=ultra
# Each negative must fail its named check, not boot/readiness:
node tests/e2e/fog-compute-e2e.mjs --negative=pixel
node tests/e2e/fog-compute-e2e.mjs --negative=callbacks
node tests/e2e/fog-compute-e2e.mjs --negative=dispose
```

Quality/lifetime: high and ultra frozen-input fog readbacks are identical across
outdoor/interior/night and full/odd/portrait/resized output sizes. High final
captures match exactly outdoors/night; the interior differs by one 8-bit level
in a few channels. No retained probe textures or borrowed-input disposal;
three compute-graph rebuild/resize cycles return texture accounting to zero.
Readiness/all-weapon startup checks, haze motion and native failure/lifetime
checks pass. These are controlled cases, not unrestricted visual acceptance.

Two rejected implementation mistakes matter: storage textures must disable
unused mipmaps, and upstream dependencies must build in the **render graph**.
Hiding TRAA inside the compute builder loses its jitter callbacks even when
frozen fog math matches. Explicit graph dependencies retain callbacks; the
compute kernel samples plain nodes around borrowed upstream textures. Both
unnecessary-mipmap and no-jitter prototype timings are excluded from this table.

Code size against baseline: runtime **+69/−9 lines, net +60**, including a
42-line compute helper. The fog math is shared, but native RTT's automatic
scheduling/lifetime is replaced with storage sizing, bounds/dispatch handling,
explicit dependencies and a WGSL comparison-sampler helper (Three's TSL depth
comparison is fragment-only). Tests/audit extensions add maintenance code too;
this is a larger diff, not a code-quality win. Raw runs, captures and failed
controls are retained with the draft PR, not a new historical harness.
