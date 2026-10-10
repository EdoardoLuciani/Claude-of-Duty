# AI physical eligibility: reuse and rejection-order experiments

Issue [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).
Baseline **4412f86**, candidate `experiment/ai-eligibility-370`.
[Raw reports, experimental harnesses, hashes and chronological ledger](https://gist.github.com/EdoardoLuciani/8f00a23c86bf3024e36c8a7965648986).

## Decision

Keep two small synchronous changes:

1. Cache **failed static attachments**, not Detour routes or tactical decisions.
2. In observation searches, reject sight/friendly-lane failures before walking
   the capsule route. Every accepted local point still passes the full walk check.

No candidate-count, motor-step, collision, complete-route, firing-clearance,
resolution, sampling, rendering, asset-appearance or dependency changes. Candidate
ordering, scores and claims remain unchanged. No worker or asynchronous scheduler.

## Why this cache

The initial trace (including120 settling frames) has683 attachment calls,
343 distinct exact inputs,5768 motor moves and160.6ms attachment time. Repeats
account for340calls/76.4ms (47.6%); same-frame repeats account for only79calls/2.7ms
(1.7%). Offline capacity64 LRU estimates capture58.8ms with all results and59.4ms
with failures only. This estimate does not measure the final FIFO implementation.

Screened frame-local reuse, persistent all-result reuse, failure-only reuse,
exact stable-state stopping, cheap-check reordering, and combinations. Single-run
screen callback P99/max, milliseconds:

| Variant | P99 | max |
|---|---:|---:|
| unchanged/observe |14.6|27.0|
| frame-local |14.9|26.2|
| persistent all results,64 |13.9|25.7|
| failures only,64 |13.9|25.4|
| stable grounded-state stopping |15.0|28.4|
| cheap-check ordering only |14.6|25.5|
| ordering + failure reuse |13.5|19.8|
| ordering + all-result reuse |13.8|19.9|
| final numeric failure FIFO + ordering |13.4|18.9|

These screens are exploratory, not final speedup estimates. All combinations,
including worse runs and expensive correctness-only oracles, are in the ledger.
Stable-state stopping passed683 native boolean/final-pose comparisons but did
not resolve the biggest first-time scan and was not adopted. All-result caching
added little here; failure-only reuse is the smaller policy.

### Exactness and ownership

`SurfaceNav` owns64 FIFO entries: nine Float64 values each (4.5KiB), with no
per-query key allocation. Keys include ordered exact from/to coordinates,
radius, height and maximum step count—no quantization, epsilon or reverse-link
alias. Successful attachments always run the original motor checks.

Invalidate on static-world/probe identity, dirty collision, collision version,
gravity, character mask, and probe step height/slope/snap/iteration/mask/enabled
changes. Nonfinite inputs and aliases of mutable probe/scratch vectors bypass
reuse. Dispose clears borrowed world/probe references. Native attachment logic
is unchanged in `_checkAttachment`; `attachmentCacheHits` is separate from
existing projection `cacheHits`, and `endpointChecks` still counts actual checks.

Current `checkCapsule` and the navigation motor query the static BVH, not moving
actors. Threat visibility, allies, hitboxes and claims remain live and uncached.
If physics gains dynamic motor blockers, its revision/invalidation contract must
be extended before those checks can participate in this reuse.

## Repeated default combat results

AMD RX9070XT/RDNA4, Chromium153, Mesa, nonfallback WebGPU; high1280×720/DPR1,
Vite development build, existing driver cache, fresh sequential browsers. No
concurrent GPU jobs observed. Each run:120 settling +1800 measured frames, fixed
60Hz simulation with uncapped callbacks, five living soldiers, finite10000HP,
movement/sensing/fire/reload/switch/collision/FX; grenades disabled.

Order B1,C1,C2,B2,B3,C3. Actual callback intervals (not nominal rAF), milliseconds:

| Run | P50 | P95 | P99 | max | AI P99 | AI max | CPU >16.667ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| B1 |8.8|11.1|15.1|26.4|4.8|16.4|5|
| C1 |9.1|11.5|15.0|20.0|3.6|9.5|4|
| C2 |8.7|10.8|13.6|19.3|3.6|10.0|2|
| B2 |8.6|10.8|14.7|26.4|4.6|16.4|5|
| B3 |8.9|11.3|15.0|27.7|4.4|16.6|5|
| C3 |8.8|11.1|14.0|19.3|3.7|9.5|4|

Medians of the three run statistics, **not pooled percentiles**:

- Callback P50/P95 unchanged8.8/11.1ms; P9915.0→14.0ms (**6.7% lower**);
  maximum26.4→19.3ms (**26.9% lower**).
- AI P994.6→3.6ms (**21.7% lower**); max16.4→9.5ms (**42.1% lower**).
- Motor moves5693→3381 (**40.6% fewer**) in every measured replay.
- CPU game P995.5→4.6ms; CPU step max25.5→18.4ms.

C1 has worse P50/P95 and essentially unchanged P99. Its render-submit P99/max
are10.1/14.4ms vs B1's8.9/10.0ms. Retain this run; the data does not isolate a
renderer mechanism or justify claiming a universal FPS increase.

Combat reports,1800 selected AI state snapshots and1800 corresponding call/draw
records match B1 exactly in all six runs. Zero measured node builders, not a
pipeline-compilation count. Inclusive detailed timings must not be summed;
motor timing remains null. GPU frame/presentation time was not measured here.

## Important limitation: expensive misses still exist

Separate native-variable-dt, approximately60Hz headless paced runs are **not
identical replays**. Baseline simulation29.9988sec, player/AIshots/impacts51/452/827;
candidate30.0154sec,51/477/836. Callback P95/P99/max16.8/16.9/26.0→16.8/16.8/40.0ms.
CPU-budget misses13→6, **but the maximum is worse**.

Candidate i715: CPU39.0ms, AI28.8ms, observation27.4ms,1634motor moves, render8.9ms,
nominal dt33.4ms. This large first-time/miss scan is not removed by caching.
Changed trajectories prevent an isolated regression/improvement inference; do
not hide the result or claim that #370's broader hitch work is complete.

Next: evaluate bounded continuation or isolated collision jobs for misses, with
explicit cancellation, stale-result revalidation, live claims/threat checks and
response-latency tests. This requires a separate gameplay-scheduling design; no
worker speedup or production/display/cross-vendor/exhaustive-content claim here.

## Correctness and asset provenance

`tools/ai-eligibility-check.mjs` runs source-local old-order/native-motor reference,
candidate and native-oracle replays in fresh pages, comparing event totals,
selected AI states and call/draw records.662 fixed-dt native query comparisons
pass; a separate3600-frame variable-dt oracle passes760 comparisons. Oracles do
duplicate physics work and must not be used as performance runs.

Smoke controls cover exact keys/direction/dimensions/budgets, controller options,
gravity/masks, bounded eviction, nonfinite bypass, successful-check nonreuse,
physical traversal and collision rebuilds. Hardware collision control passes;
disabling version invalidation fails with
`collision rebuild retained stale failed eligibility`.

Navigation source participates in the world-authoring hash. `npm run world`
changed only sourceHash metadata and its envelope/checksums/filename/manifest.
**Navigation, component and cover payload bytes are identical**, as are all
mesh/collision assets; see `nav-payload-proof.json`. Updated the smoke asset-hash
pin only after this comparison; all305 production traversal fixtures still run
with unchanged expected outcomes and physical limits.

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-eligibility-check.mjs --port=5432 --collision-control=1
# Intended failure; proves stale-version control observes the fault:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-eligibility-check.mjs --port=5432 --negative=version
```

The exploratory profiler snapshots in the evidence reuse #392's timing boundary
and add selected AI snapshots/probes. They are not committed as a duplicate
profiling implementation. #392 does not have to be merged for this candidate.
