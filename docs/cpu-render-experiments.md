# CPU rendering experiments

## Scope and outcome

Investigation of `75929d38a9788684def3ce300ab42ce6d74a6017` using a fresh
`npm ci` and production build. No runtime optimization is included in this report.
The experiments used temporary browser hooks, not dependency edits or a shipping
renderer patch. Preserve current quality, shadows, materials and gameplay.

**Best candidate:** combine compatible opaque soldier material groups into one
shadow draw per soldier/cascade. This consistently reduced CPU submission time,
especially with twelve enemies. Static flags, matrix-update deduplication,
small-buffer upload coalescing and shadow ordering did not establish useful,
repeatable improvements in this investigation.

## Method

- Ryzen 9 9950X; RX 9070 XT selected with `MESA_VK_DEVICE_SELECT=1002:7550!`.
- Hardware WebGPU, full headless Chromium 153, uncapped, High, 1920×1080, DPR 1.
- `living-combat-v1`: moving/firing/reloading player and five or twelve living
  high-HP enemies. Not unrestricted waves, grenades or radio strikes.
- Each run: 120 uncredited warmup frames, then 900 measured frames.
- Repeated comparisons alternate fresh control/trial browsers. GPU runs are
  sequential. All reported successful runs passed the profiler's combat gates.
- CPU submission is synchronous render-method time, not GPU time. GPU timestamps
  cover render + compute passes, excluding copies, queue waits and presentation.
  Diagnostic GPU runs are reported separately, not pooled into ordinary runs.
- No node-builder activity occurred during the measured intervals.

Canonical control command (choose an unused port):

```sh
npm ci
npm run build
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --production=1 --port=5389 --frames=900 --warmup=120 \
  --w=1920 --h=1080 --dpr=1 --quality=high --agents=5 \
  --out=/tmp/control.json
```

Repeat with `--agents=12`; use `--gpu=1` only for separate GPU diagnostics.
See [profiling methodology](profiling.md).

## Why the CPU cost is high

An additional instrumented five-enemy control attributed exclusive scene-render
costs as follows. Nested shadow renders are subtracted from their parent pass.
These are averages from that diagnostic, not independent percentile components.

| Work                              | Draws/frame | CPU ms/frame |
| --------------------------------- | ----------: | -----------: |
| Three directional shadow cascades |      621.46 |        2.707 |
| World beauty                      |      140.12 |        1.866 |
| Depth/normal/velocity prepass     |      118.55 |        0.999 |
| First person                      |       32.22 |        0.469 |

The full frame averaged 931.41 draws, 758.72 `writeBuffer` calls,
844.55 `setBindGroup` calls, 2025.64 `setVertexBuffer` calls and 535.92
`setPipeline` calls. Bind-group creation averaged only 0.01/frame: this is mostly
steady-state update/submission work, not repeated resource creation.

Five soldiers contribute 45 skinned draws to **each** shadow cascade: one per
material group, not one per soldier. Instanced props contribute another 384.54
shadow draws/frame across the cascades. Native shadow-frustum culling and world
instancing already exist; the finding is not that either feature is absent.

## Trials

| Trial                              | Experimental change                                                                                                                                                              | Observation / decision                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Static world                       | Set world meshes' native `object.static` flag                                                                                                                                    | No improvement in initial screening; do not retain. Node materials force FULL refresh before the static check. |
| Scene matrices                     | Update each scene's world matrices at most once per application frame, suppressing automatic repeats within that frame                                                           | No clear improvement in initial screening; do not retain.                                                      |
| Soldier shadow groups              | For compatible opaque skinned material arrays, submit the full indexed range once and skip remaining groups, only in CSM shadow renders; cache eligibility per application frame | Repeatable CPU improvement; candidate for a separately hardened implementation.                                |
| Small uniform uploads              | For uniform groups ≤4 KiB, upload the complete current CPU buffer once instead of multiple disjoint changed ranges                                                               | Writes fell 758.72 → 480.63/frame, but CPU rendering did not improve over three trials. Do not retain.         |
| Shadow ordering                    | Preserve group/render order, then sort opaque CSM items by material/geometry before depth; restore the comparator after each shadow render                                       | One fast run did not repeat. No established win; do not retain.                                                |
| Constant opaque-world shadow color | Supply a constant black/opaque cast-shadow node for audited opaque world materials                                                                                               | Initial screening did not improve CPU rendering. Do not retain.                                                |

The upload trial increased uploaded bytes from 1,359,204 to 1,399,812/frame
(about 3%). Average CPU rendering was 6.46–6.55 ms versus 6.36–6.57 ms in
matched census controls. Fewer API calls alone were not a sufficient result.

Shadow ordering averaged 5.88, 6.38 and 6.42 ms, versus census controls of
6.40, 6.36 and 6.57 ms. The first trial also had unusually low GPU pass time;
subsequent runs did not reproduce the CPU/GPU gain. Do not present that outlier
as an optimization. Combining ordering and upload coalescing was also unhelpful
in initial screening.

An oracle consultation suggested the upload and ordering experiments and warned
against blanket FULL→SHARED refresh overrides and static render bundles. Those
would require additional correctness work for live uniforms, camera motion,
velocity, visibility/LOD and resource replacement; neither was installed.

## Repeatable shadow-group result

Ordinary profiles, three fresh interleaved control/trial pairs per actor count.
Values in the next table are per-run **mean CPU render-submission milliseconds**.

| Actors | Control runs          | Shadow-group trial runs | Mean reduction |
| ------ | --------------------- | ----------------------- | -------------: |
| 5      | 6.383 / 6.406 / 6.416 | 6.174 / 6.190 / 6.198   |          3.34% |
| 12     | 8.229 / 8.296 / 8.276 | 7.455 / 7.467 / 7.590   |          9.23% |

| Actors | Mean draws, control → trial | CPU render p50 range, control → trial | CPU render p95 range, control → trial |
| ------ | --------------------------- | ------------------------------------- | ------------------------------------- |
| 5      | 931.41 → 811.41             | 6.5 → 6.3 ms                          | 7.5–7.6 → 7.2–7.4 ms                  |
| 12     | 1238.74 → 950.74            | 8.2–8.3 → 7.5–7.6 ms                  | 9.4–9.6 → 8.6–8.8 ms                  |

Tail improvement is not universal: the highest twelve-enemy trial render sample
was 13.6 ms versus 11.4 ms among those ordinary controls. Lower average/p95
submission is not a guarantee against every stall.

Separate twelve-enemy GPU diagnostics retained the CPU improvement:
control mean render times 8.295 / 8.257 / 8.215 ms; trial
7.586 / 7.500 / 7.644 ms. GPU pass medians were
5.581 / 5.538 / 5.534 ms versus 4.731 / 5.537 / 5.557 ms.
There is **no consistent GPU speedup claim**: most pass medians are effectively
unchanged, with one faster trial. Complete GPU-frame latency remains unavailable.

## Visual checks and why the hook is not shipped

Isolated native captures at 1280×720, High, for hero/combat/night/interior:

- Unchanged control versus unchanged control: hero/night exact; combat differed
  on 0.0018% of pixels and interior on 0.0005%, maximum channel delta 1.
- Control versus shadow-group trial: hero/night exact; combat differed on
  0.0001% and interior on 0.0008%, maximum channel delta 2.

Both comparisons passed the existing image-diff epsilon gate, but **neither was
an all-shot bit-identical result**. Do not describe them as proof of exact parity.

Before retaining the candidate, validate depth-only equivalence for animated
soldiers with moving cameras, changing sun and flashlight shadows. Constrain
merging to compatible contiguous index groups and audit all source-material
shadow semantics (side, visibility, discard/masks, alpha, position/depth nodes,
displacement), draw ranges, callbacks and mutation invalidation. Preserve native
culling, prewarm, resource lifetime and noneligible paths. The experimental hook
is not a generic material-equivalence proof or a production design.

Local evidence is under `/tmp/cod-cpu-*` (control/trial reports, temporary hooks,
capture directories and image diffs) and `/tmp/cod-frame-*` (initial pass/API
census and CPU trace). These are local investigation artifacts, not committed
runtime assets. The tables preserve the relevant results for review.
