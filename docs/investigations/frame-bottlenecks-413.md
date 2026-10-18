# Frame bottleneck investigation — #413

## Finding

**The leading unpaced steady-state limit is the CPU render/submission path**, not
CPU gameplay or the measured GPU passes, on this machine/fixture. Rendering takes
82.7–82.8% of synchronous step time in three baseline runs. CPU sampling points to
per-object bindings/uniform updates and submission. With browser pacing restored,
the observed cadence instead caps at approximately 60 Hz. This is not a physical
presentation or input-latency measurement.

**A reproducible baseline hitch bottleneck was not found.** All three baseline
runs have zero profiler hitches. One low-resolution run contains substantial
render-call stalls; their internal cause remains unresolved. See the evidence and
required instrumentation below. No optimization or runtime change is included;
optimization follow-up: [#458](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/458).

## Conditions and reproduction

Measured **2026-10-18**, clean revision
`eac84e93517ae95cf4a22a1b430abe60109f2645` (all 18 runs report `dirty: false`):

- Ryzen 9 9950X; RX 9070 XT, selected with `MESA_VK_DEVICE_SELECT=1002:7550!`.
  Native adapter reports `amd / rdna-4`, `fallback: false`; Vulkan identifies
  `AMD Radeon RX 9070 XT (RADV GFX1201)`, Mesa RADV 26.2.4.
- Fedora 44, Linux 7.2.11-200.fc44.x86_64; Node 24.18.0; Playwright-installed
  **Chrome for Testing 153.0.8010.12**, `chromium-1243/chrome-linux64/chrome`.
- `npm ci`, production build/preview, owned HMR-free server on port 5389.
  New browser/context/server per run, sequential GPU jobs. OS/driver caches not
  cleared; clocks, CPU affinity and power limits not pinned. No concurrent game
  browser was running at the initial process check; background OS load was not traced.
- `living-combat-v1`: five real soldiers, finite 10,000 HP, real damage/FX,
  grenades disabled, two 900-frame input cycles; **120 uncredited warmup frames,
  1,800 measured frames**. Lockstep advances 1/60 s per rAF (30 simulated seconds),
  not realtime gameplay. Every run passes the existing combat coverage gates.
- Baseline: **1280×720, DPR 1, high**, drawing buffer/target both 1280×720.
  Three 2048 shadow cascades; TAA/GTAO/volumetrics/bloom on, SSR off.
  Unpaced flags: `--disable-frame-rate-limit --disable-gpu-vsync`.
  `paced-*` only removes these two flags; it remains headless lockstep.

One baseline invocation, from the measured checkout after building:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --port=5389 --production=1 --frames=1800 --warmup=120 \
  --w=1280 --h=720 --dpr=1 --quality=high \
  --out=/tmp/base-1.json
```

[reproduce.sh](issue-413/reproduce.sh) records all options and the original run
order. To reproduce against the fixed code, invoke that script by absolute path
from a separate worktree checked out at the measured revision; choose an output
directory outside the checkout. The script pins the browser path; set
`CHROMIUM_PATH` only to an equivalent installed binary. Hardware/driver differences
invalidate a matched comparison.

**Raw evidence:** [captures.tar.gz](issue-413/captures.tar.gz) (1.5 MiB), SHA-256
`af2bee65000ad9bf20538ba5a3f3adb388693e426d1fe3979ac7775dab74ff40`.
It contains all 18 full JSON captures and stdout/stderr logs, two CDP CPU profiles,
install/build/test logs, host details, and `manifest.json` with ordered run IDs,
completion times, summaries, combat coverage and lockfile/built-entry hashes.
No failed runs were omitted; all runs completed successfully.

```sh
mkdir -p /tmp/413-evidence
tar -xzf docs/investigations/issue-413/captures.tar.gz -C /tmp/413-evidence
# Read summary; raw per-frame samples and instrumentation are retained alongside it.
node -e 'const d=require(process.argv[1]); console.log(d.summary)' \
  /tmp/413-evidence/issue-413-captures/base-1.json
```

## Baseline results

All times are milliseconds. Percentiles use the existing profiler's floor-index
method. Callback-start intervals are attributed to the preceding engine step;
nominal rAF intervals can shift hitch attribution. Keep these distinct.

| Run    | Callback p50 / p95 / p99 / max | Nominal rAF p50 / p95 / p99 / max | CPU step p50 / p95 | CPU render p50 / p95 | CPU game p50 / p95 |
| ------ | ------------------------------ | --------------------------------- | ------------------ | -------------------- | ------------------ |
| base-1 | 8.9 / 11.3 / 12.8 / 15.5       | 8.9 / 11.4 / 12.9 / 15.1          | 8.0 / 10.4         | 6.7 / 8.5            | 1.3 / 2.0          |
| base-2 | 9.1 / 11.5 / 12.8 / 16.0       | 9.1 / 11.6 / 12.9 / 16.2          | 8.3 / 10.5         | 6.9 / 8.6            | 1.3 / 2.2          |
| base-3 | 8.7 / 11.1 / 12.6 / 15.0       | 8.7 / 11.2 / 12.7 / 14.8          | 7.9 / 10.1         | 6.6 / 8.4            | 1.3 / 2.0          |

Across these 5,400 frames: zero CPU steps over 16.667 ms, zero nominal/callback
hitches, zero node builders. A hitch is strictly greater than
`max(2 × run median, run median + 8 ms)`, separately for each interval series;
this is not a fixed 50 ms rule. Native calls/draws per step are 24–25 / 708–977.

## Controlled experiments (not fixes)

Only the stated option changes from baseline. Values below are per-run, not
pooled. Instrumented captures are excluded from both tables above and below.

| Condition / runs                | Callback p50       | Callback p95       | Callback max       | CPU render p50  | CPU game p50    | Callback hitches |
| ------------------------------- | ------------------ | ------------------ | ------------------ | --------------- | --------------- | ---------------- |
| 640×360: half-1 / 2 / 3         | 8.3 / 8.0 / 7.9    | 12.2 / 10.0 / 10.4 | 39.2 / 16.2 / 14.7 | 6.3 / 6.0 / 5.9 | 1.2 / 1.2 / 1.2 | 12 / 1 / 0       |
| 12 soldiers: actors12-1 / 2 / 3 | 11.0 / 11.4 / 11.8 | 13.8 / 14.0 / 14.9 | 18.7 / 17.5 / 17.5 | 8.5 / 8.8 / 9.0 | 1.7 / 1.8 / 1.8 | 0 / 0 / 0        |
| Browser paced: paced-1 / 2 / 3  | 16.7 / 16.7 / 16.7 | 16.8 / 16.8 / 16.8 | 19.9 / 20.0 / 20.2 | 7.2 / 7.4 / 7.7 | 1.5 / 1.5 / 1.6 | 0 / 0 / 0        |

Quartering pixels improves median callback intervals only about 7–11% relative
to the median baseline result (8.9 ms). Increasing actors raises CPU render cost
much more than gameplay cost; it is a load-scaling test, not isolated AI cost
(three squads also change geometry, fire and FX). Restoring pacing caps cadence
despite CPU headroom. Together these support a CPU render-path limit when unpaced
and a browser-pacing limit when paced, not a pixel-throughput limit at baseline.

### Separate GPU diagnostics

`gpu-1/2/3` add **only** `--gpu=1`. All returned render frame IDs match the
requested native frame; compute IDs also match whenever returned. Counts are
sparse, approximately one in three application frames, not exhaustive hitch coverage.

| Run                                          | Matched samples | Render-pass sum p50 | Compute-pass sum p50 | Combined pass sums p50 / p95 / p99 / max |
| -------------------------------------------- | --------------- | ------------------- | -------------------- | ---------------------------------------- |
| gpu-1                                        | 601             | 2.299               | 0.594                | 2.889 / 3.234 / 3.302 / 3.358            |
| gpu-2                                        | 599             | 2.290               | 0.596                | 2.895 / 3.236 / 3.314 / 3.348            |
| gpu-3                                        | 601             | 2.293               | 0.595                | 2.885 / 3.239 / 3.307 / 3.342            |
| half-gpu-1 (640×360, single exploratory run) | 599             | 1.373               | 0.171                | 1.548 / 1.719 / 1.755 / 4.416            |

Combined percentiles are computed from each sample's sum, not summed percentiles.
CPU render-call duration is **not GPU execution time**. CPU/GPU overlap; never
add them. These native GPU pass sums exclude copies, queue waits and presentation;
**complete GPU-frame time remains unavailable**. Lower resolution materially
reduces timed GPU work, but does not proportionately improve uninstrumented frame
throughput. No named-pass GPU drilldown is justified as the leading target here.

### Separate CPU/system and worker diagnostics

`detail-1/2` add `--detail=1 --worker-profile=1 --cpu-profile=PATH`; no GPU queries.
Their callback medians are 8.7 / 9.3 ms. Do not pool them with baseline results.

- AI `update`: p50 0.4 / 0.5, p95 1.1 / 1.1, max 4.1 / 3.6 ms.
  Cover `pick` reaches 3.5 / 3.1 ms **inside** AI time; it is not additive.
  UI `lateUpdate`, weapons `lateUpdate` and physics `fixedUpdate` have medians
  0.3, 0.2 and 0.2 ms/frame respectively in both runs (physics includes two ticks).
- Weighted CDP self samples, aggregated by function/source location, show
  `Bindings._update` at 9.2%, `Bindings.updateForRender` at 6.6–6.7%, uniform-group
  `update` at 5.0–5.1%, native `writeBuffer` at 5.3%, and `_renderObjectDirect` at
  4.6–5.1% of sampled wall time. These profiles include fixture setup/warmup and
  native/idle samples; they are localization clues, not exact baseline costs or
  proof that API stalls are pure JavaScript work. No GC or pipeline cause is inferred.
- Worker snapshots report 100 completed queries per detailed run, no outstanding
  jobs/decisions or dropped samples at capture end. Query execution p50 0.3 ms,
  p95 4.5 / 4.2 ms; round-trip p50 9.5 / 9.6 ms, p95 18.4 / 19.7 ms.
  Snapshot counters/history include warmup. Nested kernel costs overlap.
  Maximum decision ages 663 / 696 ms span 86 application frames: **AI admission
  latency, not a main-thread frame stall**. Baseline worker snapshots likewise
  have no unfinished jobs/decisions; this does not establish scheduling fairness.

## Hitches, confidence and remaining gaps

- **High confidence in the measured limiting path**, moderate confidence in
  binding/uniform work as an optimization target. Three matched baselines,
  resolution/actor/pacing controls and independent CPU/GPU diagnostics agree.
  No claim extends to weaker GPUs/CPUs, ultra quality, normal-health waves,
  grenade/radio workloads, realtime input, startup, or physical presentation.
- **Hitch cause unresolved.** Retained `half-1`, frame 1269: nominal interval
  45.1 ms, callback interval 39.2 ms, CPU step 36.0 ms, CPU render call 33.9 ms,
  gameplay 2.1 ms. Another stall at 1271 has a 29.3 ms callback interval and
  23.7 ms render call. These localize the delay to the render-call path, but
  cannot distinguish CPU scheduling, GC/native driver work or GPU backpressure.
  Node-builder deltas are zero and live resource counts at these frames remain
  352 geometries / 199 textures; that does **not** rule out pipeline compilation,
  uploads, GC or synchronization. Later low-resolution runs do not reproduce
  the severe stalls. `half-2` has one small threshold hitch (16.2 ms callback at
  frame 8), not a >50 ms event. No run observes a >50 ms interval.
- **Next instrumentation if pursuing hitches:** longer matched runs with a
  bounded CDP/Perfetto trace including JS stacks, V8 GC, renderer/GPU-process
  tasks, scheduling and frame/submit markers. Correlate callback-start frame IDs
  with queue submission/completion and full GPU timeline/copy/wait boundaries;
  use named-pass timestamp ranges only if that trace implicates GPU execution.
  Current sparse pass readbacks and CPU sampling cannot explain an uncaptured
  outlier; zero late node builders is not evidence of zero GPU pipeline work.
- Hardware clocks/temperature and background scheduling were not logged; one
  low-resolution GPU diagnostic and two CPU profiles are corroboration, not
  three-run performance acceptance. Fresh browsers do not imply cold driver
  caches. Any optimization belongs in #458 with fresh matched measurements,
  correctness and visual checks, not in this investigation.
