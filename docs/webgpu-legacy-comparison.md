# Fresh shared-asset WebGL / WebGPU comparison

## Conclusion

WebGPU is competitive at low resolution and substantially faster at 1080p in
this fixture. The strongest comparison is three **ordinary-AI, 1920×1080** pairs:
**19.260 → 12.777 ms/frame**, equivalent to **51.9 → 78.3 FPS**, **33.7% lower
interval / 50.7% higher throughput**. Every pair improves, including p95/p99.

This supports moving from throughput optimization toward finalisation checks,
**not marking PR #316 ready or merging it**. The controlled WebGPU runs restore
one missing startup RNG reservation through a test-only route. Production is
unchanged. A separate staged-actor audit still finds differing muzzle/impact
payloads after that restoration. Final visual quality, startup responsiveness,
latest-develop integration and unscripted acceptance remain open.

The subsequent [matched final-frame review](webgpu-visual-comparison.md) finds
**visual parity fails**: M4/arm appearance, ground shading, night readability and
combat haze/glare differ substantially beyond repeat-capture variation. The
throughput result must not be described as an equal-visual-quality win.

## Reference and measurement scope

- Native runtime: `3bc1ba7`, Three.js **0.186.1**.
- Fresh legacy checkout: `53f3d4c`, Three.js **0.186.0**, installed with `npm ci`.
  This is the migration's shared develop base, not historical `5c033cd`.
- `git diff --quiet 53f3d4c 3bc1ba7 -- assets public tools/worldgen` passes:
  committed assets/world source are byte-identical. A filesystem SHA-256 census
  also matches all **58 public/model files and 28 authored asset files**, with
  no extra/missing files, covering generated/ignored runtime models too.
  Develop has since advanced
  to `d0b2b36` with additional world/weapon changes; this is **not a benchmark
  against that newer content**. No installed dependency or production source
  was patched for this comparison.
- RX 9070 XT only, `MESA_VK_DEVICE_SELECT=1002:7550!`. Each run checks the actual
  WebGPU renderer device (`amd`, `rdna-4`, nonfallback), or actual WebGL context
  (`ANGLE … AMD Radeon RX 9070 XT … RADV GFX1201`). No separate adapter request
  is used as a substitute for the renderer's device.
- Same managed HeadlessChrome **153.0.0.0**, Vulkan/ANGLE, DPR 1, high preset,
  identical viewport and deterministic simulation/input schedule. Browser flags
  disable frame limiting/vsync. All GPU runs are sequential, in fresh browsers.
- Combat-start scene; 60 initial frames, then restage the firefight. Ordinary-AI
  runs clear `agent.staged`, leaving normal AI decisions active afterward.
  Move forward, turn `.006` radians/frame, fire for 30 of every 90 frames.
  An additional 30 moving frames settle before 600 recorded samples. There are
  **599 frame intervals**, 600 engine/render wall samples per run.
- Paired order reverses in pair 2. The staged 540p series additionally includes
  unmodified WebGPU in three interleaved triplets. No power/clock settings changed.
- Only outer frame/render timers and native builder callback are installed in
  timing runs. No per-draw, node, binding, upload, GPU-query or event wrappers.
  `--audit=1` runs are separate and excluded from timing claims.
- Frame intervals include scheduling/backpressure. Engine-step and render
  synchronous wall time are not pure JS CPU or GPU execution time and overlap
  the interval. **Do not add them.**
- No page/shader errors; zero measured WebGPU builders. Legacy program-object
  counts increase during traversal: in the ordinary-AI series, 233 before
  moving settlement, 245 at the first measured frame, 246 at the end. Staged
  ends at 247. Thus legacy tails include first-use work; its shipping warmup is
  retained rather than replaced with native's much longer warmup.

This compares the two application pipelines, **not equal GPU commands or an
isolated WebGL-vs-WebGPU API test**. The shared high preset is not visual parity:
legacy has 2× MSAA on the separate weapon target; native deliberately has none.
Native retains temporary half-resolution GTAO, different AO/contact/temporal
behavior and known final-image differences. The 1080p world and weapon HDR
sizes are explicitly checked at 1920×1080, not just the canvas dimensions.
Both world roots contain 386 meshes / 15,234 instances, including non-rendered
collision representation; these counts are **not submitted draw/work counts**.

## Main result: ordinary AI at 1920×1080

WebGPU here uses the startup RNG-reservation control described below.

| Pair | WebGL mean | WebGPU mean | WebGL p95 / p99 | WebGPU p95 / p99 |
|---|---:|---:|---:|---:|
| 1: GL → GPU | 19.227 ms | 13.076 ms | 21.5 / 25.1 ms | 15.1 / 17.5 ms |
| 2: GPU → GL | 19.265 ms | 12.619 ms | 20.8 / 25.9 ms | 14.8 / 16.1 ms |
| 3: GL → GPU | 19.288 ms | 12.637 ms | 20.9 / 23.1 ms | 15.0 / 18.5 ms |
| Mean of equal-length runs | **19.260 ms** | **12.777 ms** | | |

All three pairs have identical sampled initial/final frame, camera position and
quaternion, engine/AI/player/weapon/FX/viewmodel RNG states, active weapon/mag,
and actor ID/alive/health/state/position/move target/path-length/flags. This is
not a full world serialization, per-frame event equivalence or unscripted test.

The unmodified native runtime's additional 1080p ordinary-AI cross-check is
**12.633 ms** mean, p95 **14.6**, p99 **16.6**. It supports the general throughput
result, but its shifted RNG streams make it a less controlled comparison. Its
maximum interval is **72.8 ms** (maximum engine-step wall 22.2 ms); the timing
alone does not identify that outlier's cause. Do not claim hitch-free gameplay.

Despite the frame-rate win, native synchronous submission remains slower:

| Mean wall metric, three controlled pairs | WebGL | WebGPU |
|---|---:|---:|
| Engine step | 6.542 ms | 11.657 ms |
| Render submission | 4.173 ms | 9.269 ms |

This does not establish a particular GPU kernel gain or browser bottleneck;
there are no GPU timestamps or new CPU profiles in this comparison.

## Resolution/workload cross-checks

**Ordinary AI, 960×540**, one controlled pair:

| | WebGL | WebGPU |
|---|---:|---:|
| Mean interval | 11.069 ms | 11.297 ms |
| p95 / p99 | 12.5 / 15.1 ms | 13.0 / 15.3 ms |
| Render wall | 3.506 ms | 8.254 ms |

Essentially level in this single pair, with native 2.1% slower. Initial/final
sampled state matches, including all sampled RNGs. Do not claim a universal
native win or treat this one pair as a comprehensive low-resolution gate.

**Staged actors, 960×540**, three triplets:

| Run | Legacy | Native as-is | Native RNG-restored |
|---|---:|---:|---:|
| 1: GL → as-is → restored | 11.278 ms | 9.647 ms | 13.042 ms |
| 2: restored → as-is → GL | 11.044 ms | 9.926 ms | 9.434 ms |
| 3: as-is → GL → restored | 10.853 ms | 10.009 ms | 9.933 ms |
| Mean | **11.059 ms** | **9.861 ms** | **10.803 ms** |

The slower first restored run remains included; its cause is not established.
As-is appears 10.8% lower in interval, but has different RNG/actor outcomes.
The restored aggregate is only 2.3% lower, with mixed per-pair results. Neither
supports a strong low-resolution superiority claim. The earlier 19.8% CSM gain
was against the preceding **native** runtime with the same seed-stream layout;
that optimization result is not a fresh legacy comparison.

**Staged actors, 1920×1080**, three controlled pairs:

| Pair | Legacy mean / p95 / p99 | Native restored mean / p95 / p99 |
|---|---:|---:|
| 1 | 20.195 / 21.0 / 34.8 ms | 10.264 / 11.7 / 13.3 ms |
| 2, reversed | 20.296 / 21.0 / 35.7 ms | 9.771 / 11.3 / 12.7 ms |
| 3 | 20.285 / 21.2 / 35.9 ms | 10.897 / 13.2 / 14.8 ms |
| Mean interval | **20.259 ms** | **10.311 ms** |

An unmodified native 1080p staged cross-check is 10.091 ms. This larger staged
win is **not the headline**: ordinary AI is more representative, and staged
muzzle/impact payloads still diverge between renderers as described next.

## Newly exposed determinism gaps

Legacy `RenderSystem.init()` consumes `ctx.rng.fork()` even though its private
stream is unused afterward. Native init dropped that reservation, shifting the
physics/world/player/weapon/FX/AI/UI/audio seed streams. The same capture seed
and input sequence therefore do **not** imply the same gameplay workload.

`--align-rng=1` inserts only that reservation through a browser source route,
before native renderer initialization. It is diagnostic, not production code,
a cache bypass, a render-quality change or a seeded answer replay. In the
ordinary-AI runs it restores the sampled initial/final state equality above.
A real stream-order fix and regression test remain required before finalisation.

The staged fixture still needs investigation after the reservation is restored:

- Separate 600-frame event audits record **798 FX events on both backends**.
- First exact payload difference: event index 619, moving-loop index **210**,
  an AI `weapon:fire` origin/direction. Origins differ by about 8 mm in X.
- First RNG/event-boundary difference: index 642, moving-loop index **228**, a
  metal impact. FX RNG is equal on entry but differs on exit; impact points
  differ by about 4.6 cm in Y and the incident directions also differ.
- Sampled final engine/AI/player/weapon/viewmodel RNG, camera and actor states
  match; FX RNG does not. Equal event counts/final actor positions do not prove
  identical shots, animation or effects.

The cause of the muzzle divergence is **not established**. Do not silently
normalize event answers or call the staged workload fully identical. These are
new finalisation findings, not fixes shipped by this report.

## Startup and remaining acceptance

Across the principal ordinary-AI 1080p pairs, **navigation-to-`__READY__`** takes
**2.68–2.73 seconds legacy versus 37.28–38.67 seconds native**. Other runs give
similar ranges. These are full dev-page readiness measurements, including asset
loading, initialization, procedural bakes, prewarm and initial frames. Vite was
already listening; fresh browser profiles were used, but OS/driver caches were
not cleared. They are **not disk-cold production-load benchmarks**.

The previously reported ~12–13 seconds described native graph warmup, a narrower
component; do not compare it directly with full page readiness or imply that
startup responsiveness is solved. No warmup coverage was removed for this test.

Before ready/merge:

1. Fix/test the missing RNG reservation; investigate the staged muzzle/impact
   divergence rather than assuming it is purely cosmetic.
2. Resolve or explicitly approve remaining material/lighting/AO/contact and
   temporal/ADS-history differences with human moving/reload/interior review.
   Current-buffer checks from native optimizations are not legacy visual parity.
3. Address startup responsiveness without sacrificing real shader-variant
   coverage or advancing simulation/RNG during warmup.
4. Integrate newer develop content, rerun relevant tests and matched performance,
   complete unscripted checks and obtain independent review. No new independent
   review is claimed here. Keep PR #316 draft.

## Reproduction and evidence

Create a separate legacy worktree at `53f3d4c` and run `npm ci` there. From the
migration worktree, run sequentially, reversing order in pair 2:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-benchmark.mjs \
  --root=/home/edoardo/Documents/Claude-of-Duty-webgl-matched-53f3 \
  --backend=webgl --agents=normal --width=1920 --height=1080 \
  --frames=600 --out=/tmp/legacy-normal1080
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-benchmark.mjs \
  --root=/home/edoardo/Documents/Claude-of-Duty-webgpu-migration \
  --backend=webgpu --align-rng=1 --agents=normal --width=1920 --height=1080 \
  --frames=600 --out=/tmp/native-normal1080
```

Omit `--align-rng=1` for current production seed streams; omit `--agents=normal`
for staged actors. Defaults are 960×540/high/600 frames. `--audit=1` records FX
payloads and RNG boundaries and **invalidates timing use**. `--live=0` is an
optional frozen-scene diagnostic, not used for the reported comparisons.

Original temporary driver: `/tmp/cod-legacy-comparison.mjs`. The committed runner
preserves the measurement/input sequence and adds cleanup/validation; early
raw files report legacy `builders: 0`, which means **not instrumented**, not no
legacy compilation. The committed runner correctly reports `null` for legacy.

Raw JSON/log families under `/tmp/`:

- `cod-legacy-normal1080-{webgl,webgpu}-{1,2,3}`: main repeated result.
- `cod-legacy-normal1080-current`: unmodified runtime cross-check.
- `cod-legacy-normal-{webgl,webgpu}`: single 540p ordinary-AI pair.
- `cod-legacy-{gl,gpu,aligned}-{1,2,3}`: 540p staged triplets.
- `cod-legacy-1080-{gl,aligned}-{1,2,3}` and `cod-legacy-1080-current`.
- `cod-legacy-audit-{webgl,webgpu}`: excluded-from-timing event diagnosis.
- `cod-legacy-pilot-{gl,gpu,aligned}`: short initial RNG probes, not headline timing.

Validation: the committed runner passes separate 60-frame ordinary-AI 1080p
checks on both actual renderer devices, including world/view target dimensions,
zero errors and identical sampled initial/final state. `npm test` (59 tests),
`npm run lint`, `npm run build` and `git diff --check` pass. No world assets
changed, so world regeneration/validation was not required for this report.

No runtime, dependency, generated asset, FX/bone upload or AI scheduling change
is included. PR remains draft; the original checkout's pre-existing modified
`package-lock.json` is untouched.
