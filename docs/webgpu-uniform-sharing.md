# Native uniform lifetime and layout sharing

Issue #312 / draft PR #316. This increment follows the [structural attribution](webgpu-structural-attribution.md). It changes supported TSL uniform grouping, not Three.js internals, lighting coefficients, quality, geometry, history or draw ordering.

## Fresh post-rebase reference

The migration was rebased onto `develop` at `53f3d4c`. Reference `55ec7c0` includes the merged authored M4 and sleeve-blood compatibility ports to native node materials. The measurements below compare against **that reference**, not the older pre-rebase WebGPU build or legacy asset set.

New validation uses the RX 9070 XT only (`MESA_VK_DEVICE_SELECT=1002:7550!`), hardware WebGPU `amd / rdna-4 / isFallbackAdapter:false`, Chrome 153, 960×540, DPR 1, high quality, identical seeded move/turn/fire input. Standard draw/work accounting includes actual nonzero GPU commands rather than relying solely on `renderer.info`.

## Mechanism and supported changes

1. **Immutable room arrays.** `UniformArrayNode.updateType = 'none'` prevents repeated CPU packing but does not stop an object-group buffer's GPU upload. Both arrays now use one owner-local `sharedUniformGroup('owRooms', 1, 'none')`. Once authored rooms are ready, already-allocated arrays are packed and the group version advances once. New variants still initialize their buffers; an explicitly versioned edit still publishes them. No per-frame room repacking or publication was added.
2. **AO viewport identity.** Native `screenUV` constructs a size uniform in each builder. Those different node identities fragment otherwise equivalent render groups, including camera uniforms in CSM's inherited AO context. The world AO sample now uses `screenCoordinate / aoSize`, where one render-updated `Vector2` uniform supplies the current target dimensions (or drawing-buffer dimensions without a target). This preserves the native sample coordinates and permits native shared binding caching.
3. **Light positions.** Camera-relative light positions were mixed into different material/shadow uniform layouts. Public `lightViewPosition`, `lightPosition` and `lightTargetPosition` uniform accessors now use an owner-local render-updated shared group. Existing scene tagging performs the assignment, and disposal restores the original groups of Three.js's cached accessors. Light colour, range, decay, transforms, visibility and shadow behavior are unchanged.

Identical values alone do not imply identical layouts or shared GPU buffers. These changes address layout identities and upload lifetimes; they do **not** disable full material/node refresh or all remaining object updates.

## Repeated whole-app measurements

Three 900-frame runs per variant, first 60 frames excluded. Order was reference / rooms-only / combined in rounds 1 and 3, reversed in round 2. These plain runs have no deep binding wrappers or GPU timestamp instrumentation.

| Round | Reference mean / p95 / p99 ms | Rooms only mean / p95 / p99 ms | Combined mean / p95 / p99 ms |
|---|---|---|---|
| 1 | 13.636 / 17.4 / 34.6 | 12.201 / 19.6 / 34.5 | 11.642 / 14.4 / 16.9 |
| 2, reversed | 13.322 / 16.7 / 33.4 | 13.897 / 16.8 / 33.3 | 11.274 / 13.7 / 15.7 |
| 3 | 13.024 / 16.2 / 26.3 | 13.180 / 16.6 / 17.2 | 12.559 / 15.4 / 16.4 |

Across the equal-length runs, mean frame interval is **13.327 → 11.825 ms**, about **11.3% lower**. Each combined pair improved, but the third gain is much smaller. Rooms alone averages 13.093 ms and is slower in two pairs: **no established isolated room-fix timing gain**. These are scripted samples, not unscripted gameplay/human acceptance. Shader builders and reported errors were zero in each measured window.

Separate light instrumentation gives:

| Metric / frame | Reference | Rooms only | Combined |
|---|---:|---:|---:|
| Native `writeBuffer` calls | 6,941.692 | 6,587.720 | 2,147.893 |
| Upload bytes | 1,385,305.871 | 1,328,670.443 | 1,207,549.871 |
| Framework draw count | 1,075.187 | 1,075.187 | 1,075.187 |
| Actual nonzero GPU draw count | 1,074.187 | 1,074.187 | 1,074.187 |
| Submitted indices/vertices × instances | 23,504,093.250 | 23,504,093.250 | 23,504,093.250 |
| Synchronous engine wall ms | 14.760 | 14.335 | 13.449 |

**69.1% fewer writes, 12.8% fewer bytes**, with zero per-frame draw/work mismatches between reference and combined in the 840 measured frames. Light instrumentation perturbs timings; its engine wall includes native calls/waits and is not thread CPU. Do not substitute its means for the plain measurements or add them to GPU times.

### GPU timestamps and clocks: unresolved comparison

Two oppositely ordered 900-frame timestamp pairs (28 selected-pass samples/run) give reference/combined selected GPU sums **1.725 / 3.103 ms** and **2.375 / 3.082 ms**. Those increases must not be omitted.

A short 300/60 follow-up with read-only 200 ms sysfs telemetry gives selected sums **1.923 / 2.795 ms** (8 samples). During the active section the reference clock readings are mostly around **2.4 GHz**, combined around **1.57 GHz**; device-wide busy readings also differ. These readings show a clock/workload confound, not a fixed-clock kernel comparison or an individually attributed upload budget. No clock/voltage/power settings were changed. **No GPU speedup is claimed, and telemetry alone does not establish that all of the increase is harmless DVFS.** The repeated whole-app gains are the useful performance evidence here; selected queries are not total GPU frame latency.

Cold graph warmup remains roughly 12–13 seconds: reference **11.785–12.064 s**, combined **12.160–13.138 s** in the plain runs. This change does not solve cold-start responsiveness or establish legacy performance parity. The historical 10.09 ms legacy mean predates the rebase/asset changes and is not a new matched reference.

## Correctness and lifetime gates

- Seven fixed high-quality scenes (hero, interior, night, combat, ADS, weapon, muzzle): current HDR, MRT normal/depth/velocity and raw/filtered AO are byte-exact against `55ec7c0`. Final screenshots are **not** byte-exact: RGB MAE approximately 0.018–0.680 across all seven recorded screenshot comparisons, maximum byte difference up to 13. No assumption that equal current buffers guarantees identical temporal output.
- Nine sampled 256×256 CSM depth maps (hero/combat/night × three cascades) hash-identical. This is a sampled comparison, not every shadow texel.
- Ultra hero/combat current HDR, all MRT attachments (including SSR surface) and sampled cascade depths hash-identical.
- `tools/webgpu-uniform-check.mjs`: checks actual GPU room boxes/heights against authored data, zero steady uploads/builders, shared world light and CSM camera binding identities, explicitly versioned publication (one upload per array in the probe context), settled owner resize, and original light-group restoration after disposal. High, medium, low and ultra lifetime runs pass; final strengthened two-array GPU readback passes high.
- Negative controls separately restore object-updated rooms, builder-local AO viewport identity, or original light groups. Each fails its corresponding lifetime/sharing assertion. They are test-only route substitutions, never gameplay options.
- Smoke test covers early CPU array allocation before world readiness, one publication, repeated-update immutability, fresh restart ownership, idempotent light tagging and cached-accessor restoration.
- Existing high gameplay cache/warmup/unlit-prepass/AO-filter/resize/day-night/haze lifecycle checks pass. Native sleeve E2E passes real damage/armour/healing/cancellation/respawn/restart, seven weapons, reload/ADS, stable arm resources, mask versions and GPU texture handles.

Final `npm test` (58 smoke tests), lint, Vite build, committed-world validation,
and fresh-port standard hero capture pass.

The sleeve E2E was updated from WebGL program counts to native builder counts and native screenshot readback. Its old global texture-growth assertion counted the **held `Bandage_coil` texture's first GPU allocation**, not a blood-effect resource. The replacement verifies actual skin/mask texture identities, versions **and GPU handles**, while retaining the arm mesh/material/geometry identity assertion and all gameplay checks. Diagnostic global counts were 203 → 204. This is a resource-scope correction, not permission for arm-effect leaks; the headless swapchain's black screenshots were also fixed with the same LDR readback/under-HUD overlay used by standard capture.

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --quality=ultra
# Each must FAIL for the specific restored defect:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=rooms
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=viewport
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=lights
node tests/smoke/smoke-render-uniforms.mjs
```

Paired temporary profiler outputs: `/tmp/cod-uniform-paired-{uniform-before,uniform-rooms,stock}-{1,2,3}{,-raw}.json`; binding/work outputs `/tmp/cod-uniform-final-light-*`; GPU/clock outputs `/tmp/cod-uniform-gpu-*`, `/tmp/cod-uniform-clock-*`. Reference substitutions replace only the three render source bodies from `55ec7c0`. Those private diagnostics are not production code. The independent standalone [structure probe](webgpu-structural-attribution.md) remains a non-game fixture, not evidence of game workload equivalence.

## Conclusion and open gates

**Excessive repeated camera/light binding processing and uploads are a real contributor**, with a supported correction and repeated whole-app gain. That does not make every remaining uniform update redundant or establish an intrinsic WebGPU cost/browser defect. Full node refresh, dynamic/skinned object updates, CPU/native service work, GPU clock behavior and cold startup remain relevant. PR #316 stays draft: human/unscripted review, temporal/final output differences, half-resolution AO contacts, the earlier combined exposure fixture and medium capture fixture failures, and final performance acceptance remain open.
