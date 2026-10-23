# Static physical eligibility worker

## Ownership and proof contract

- AI owns one preinitialized module worker, bounded queues, controller scratch,
  revisions and lifetime. `attachment-queries.ts` owns planning/proof policy;
  `attachment-connection.ts` owns typed sending, wire validation, initialization
  deadlines and idempotent transport shutdown; `attachment-worker.ts` owns the
  native oracle and actor-fair queue. Transport has no AI planning state.
  Physics owns collision snapshot construction (`query-snapshot.js`): transfer
  chunked copies of used triangle/BVH ranges, never live buffers or spare capacity.
  Copying checks revision, counts and cancellation each chunk and yields at a
  cooperative 2 ms target (allocation/GC/a single chunk can exceed that target).
- Authoring and runtime share `attachment.js`, `StaticWorld` and the native
  character controller. No approximate collision or synchronous failure fallback.
- Proof keys contain ordered exact endpoints, radius, height and the original
  step budget. No rounding, reverse aliases or shortened rejection budgets.
  The 512-entry completed-proof cache belongs to one collision generation.
  World replacement/revision, controller/options, gravity or mask changes
  invalidate proofs, including cached failures.
- Restart/failure/disposal detach handlers and close transport before clearing
  policy state; shutdown settles pending initialization and cannot send further
  cancellations through a broken transport. Factory/send exceptions are terminal.
  Late events cannot restore readiness. Duplicate initialization/readiness and
  results before readiness are protocol errors. Source disposal and same-version
  world/controller replacement invalidate proofs, including during snapshot copy.
- Workers prove static geometry only. Live actors, Detour paths, sensing,
  firing safety, cover claims and tactical scoring remain main-thread authority.
- `NAV_PENDING` waits; `NAV_CANCELLED` means superseded, not unreachable.
  Retry live filters/scoring before admission. Pending attempts cannot claim
  cover or skip a better unresolved candidate; peek proof precedes squad tokens.
- Observation intents freeze their original foot/cue and candidate geometry.
  Moving toward a selected point still requires `_goTo`'s full route proof
  from the current foot. Pending routes neither steer toward an old target nor
  count as arrival; execution timeouts begin only after route admission.
  Search expiry is checked before retrying pending candidate construction.
- Zero-move successes are synchronous. A close live-origin prefix may execute
  at most one native move; unknown delegates the unchanged full worker budget.
- Exact repeated-state rejection runs after arrival/prefix gates, using position,
  grounded state, requested vertical velocity and clipped controller velocity.
  No quantization. Extend the tuple if future motor state affects continuation.
  Optimistic batching and successful-continuation caches are not implemented.
- At most 256 outstanding jobs, round-robin between actors. Cancellation runs
  between whole checks, not inside a motor step. Pause inhibits admission;
  death/reset, inactive scopes, collision rebuild and disposal cancel work.
  Worker loss, malformed results and ten-second initialization/query deadlines
  are terminal, not permission for unbounded main-thread physics.

## Runtime coverage: not all eligibility is off-main

`SurfaceNav.canAttach` delegates only inside an active `AttachmentQueries.run`
scope. Outside one, it runs the complete synchronous native oracle; a ready
worker alone does not change that. `project`, `sampleGround` and `lineOfWalk`
inherit this boundary, including their nested endpoint attachments.

Scoped runtime callers:

- `AiSystem.requestPath` → `SurfaceNav.findPath` → endpoint `project`.
- `CoverMap.pick/_pick` → `project`, `peekOffset` → `project/lineOfWalk`;
  `Agent._updatePeek` supplies the actor to the separately scoped `peekOffset`.
- `Agent._pickObservationPoints/_scanObservationPoints` →
  `project/sampleGround/lineOfWalk`.
- `Agent._buildSearchCandidates/_scanSearchCandidates` → initial `project`,
  direct and ring `sampleGround`, or `_scanObservationPoints` in the same scope.
  Ring draws are generated lazily and retained for the search intent, so delayed
  proofs do not reroll geometry or consume extra RNG. Pending/superseded scans
  do not admit movement, and expired/rebuilt searches cancel the scope.

Remaining unscoped tactical planning (movable with separately approved retry
state, frozen intent and live admission tests):

- Wounded retreat in `Agent._combat` → `sampleGround` before `_goTo`.
- Patrol alternatives in `Agent._pickNextPatrol/_pickLocalAlt` →
  `project/sampleGround`; the seeded wander currently returns a point or null.
- Recovery in `Agent._recoverMove/_unstickDest` →
  `project/sampleGround/canAttach`; attempts/timeouts currently commit same-tick.
- Squad wrapping in `Squad.pickWrapDest/_pickOffAxisRally` →
  `project/sampleGround`; callers are squad role assignment and
  `Agent._tryWrap/_goOffAxis`. This currently commits `hasWrapDest/wrapSide`.

Other synchronous boundaries, not equivalent to deferrable tactical planning:

- `Agent._rememberSafePosition` and `_rollback` → `project`: current physical
  checkpoint and exceptional rollback safety must not accept stale foot proofs.
- `Agent._tryVault` → `SurfaceNav.canVault` → both endpoint `project`, native
  full-arc motor simulation and continuation `lineOfWalk`. Deferring only its
  attachments would break the boolean same-tick admission contract.
- Wave creation `AiSystem.populate/startWave` → `_pickSpawnNear` (`sampleGround`)
  and `_usablePatrol` (`project`): synchronous publication/count and seeded spawn
  selection need an API/state-machine decision before asynchronous admission.
- Diagnostic composition `AiSystem._stageSlot` → `sampleGround`; direct
  authoring, smoke and browser-fixture calls intentionally use synchronous
  validation. They are not normal-play worker-coverage evidence.

**Can ALL runtime static physical eligibility checks safely move to the worker?**
Not as a drop-in scope change. The static oracle can run there, but these callers
cannot all return pending without changing safety or public synchronous semantics.
Keep real character movement and bounded immediate proofs synchronous. A separate
follow-up can scope remaining tactical planners; safety/vault/wave boundaries need
explicit approval and fresh-foot/revision tests. This search-first fix does not
claim complete off-main eligibility.

Detailed query/decision samples are opt-in: `collectSamples` (defaulting to
`profile`) enables the existing bounded history; normal play retains aggregate
counters without allocating sample objects or shifting the history. `tools/profile.mjs`
explicitly enables collection even without detailed worker profiling, preserving
its report. Per-scope unsent arrays and used-job sets are reused on retries.

## Timing and known limitations

Exact frozen-query answers do **not** guarantee identical combat trajectories.
Tactical admission is asynchronous: fixed input/seed/step does not promise
same-tick combat replay. The capture `deterministic` flag freezes configuration,
not worker scheduling. Recorded-admission replay is separate, unimplemented work.

The historical `blind-upper` gate failed on synchronous and worker candidates:
penetration deflection could hit a teammate after a clear straight firing ray.
AI now resolves once and rejects teammate contacts before publishing fire/damage,
then reuses the accepted result. This safety policy is independent of worker
scheduling; the zero-friendly-hit acceptance gate remains unchanged.
Worker validation still does not establish exhaustive fairness/responsiveness,
normal-health waves or weaker-CPU performance.
Track acceptance and remaining renderer/AI work in
[#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

Historical investigations and evidence:
[worker/review #396](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/396),
[readiness/friendly fire](https://gist.github.com/EdoardoLuciani/39579ee04f3c7efd51a056e6add939f9),
[cycle/batching trial](https://github.com/EdoardoLuciani/Claude-of-Duty/commit/ed8e3e2),
[rejected continuation reuse](https://gist.github.com/EdoardoLuciani/87f6b0a9ad8653ad6a083f74b5eafb5e).
Closed experiments belong there, not in the runtime or another diagnostic subsystem.

## Issue #486 assessment and measurements

Retain one browser Worker with transferable private snapshots. The useful gain
was snapshot preparation, not a new threading backend. TypeScript now checks both
entrypoints and their connection against the existing protocol; native checks,
proof identity/order, scheduling and main-thread tactical authority are unchanged.
The planning host is smaller, but extracted transport, explicit TS types and new
failure guards increase combined runtime line count; this is not a net-LOC claim.

Baseline `afa6b75` vs this refactor, Linux/AMD RDNA4 (hardware WebGPU), Node 24.18.
Three fresh uninstrumented-profile browser runs per side, high 1280×720/DPR1,
`living-combat-v1`, 120 warmup + 900 measured lockstep frames; no worker kernel
profiling. Five-agent runs were sequential baseline then candidate; twelve-agent
runs alternated baseline/candidate. Combat used full Chromium 153; the separate
post-boot snapshot microexperiment used Chromium 155 on the same real world.
Ranges below are across runs, not confidence intervals or pooled percentiles.

| Snapshot experiment (three copies each) |      Bytes | Copy time range | Worker ready after copy |
| --------------------------------------- | ---------: | --------------: | ----------------------: |
| Original capacity + per-chunk timer     | 48,468,361 |  795.0–796.7 ms |            41.8–42.5 ms |
| Capacity + 2 ms slices only             | 48,468,361 |      8.0–8.3 ms |            38.8–42.1 ms |
| Used lengths + per-chunk timer only     | 32,569,705 |  537.3–539.2 ms |            37.1–40.6 ms |
| Used lengths + 2 ms slices (retained)   | 32,569,705 |      5.7–6.1 ms |            35.6–38.1 ms |

BVH capacity was 659,438 nodes for 162,605 used nodes. Trimming bounds/metadata
saves exactly 15,898,656 bytes (32.8%) per retained worker snapshot; source buffers
stay attached and every copied used element matches. This measures geometry
buffer bytes, **not total/peak process memory**, allocator retention or GPU memory.
A concurrent zero-delay timer's largest observed gap was 4.7–6.1 ms originally,
2.0–2.5 ms with both changes; this is not a universal hitch bound. Slice-only and
used-only trials bypassed Vite's stale-provenance check during experimentation;
retained code was regenerated and validated normally before combat measurements.

| Combat metric                     |                   Before |                    After |
| --------------------------------- | -----------------------: | -----------------------: |
| Five-agent whole boot             |            7.737–8.014 s |            6.990–7.087 s |
| Five-agent queue p95 / p99        |     1.7–2.1 / 2.8–3.0 ms |     2.0–2.3 / 2.9–3.0 ms |
| Five-agent round-trip p95 / p99   |   8.8–10.0 / 9.1–10.1 ms |   9.1–10.6 / 9.6–10.7 ms |
| Five-agent main CPU p99 / max     |  9.9–10.3 / 10.6–12.6 ms |  9.6–10.8 / 10.8–17.0 ms |
| Twelve-agent whole boot           |            7.567–7.668 s |            6.743–6.902 s |
| Twelve-agent queue p95 / p99      |   4.9–6.3 / 12.0–12.3 ms |   5.0–5.7 / 11.9–13.4 ms |
| Twelve-agent round-trip p95 / p99 | 10.0–13.0 / 28.9–30.7 ms | 10.6–11.5 / 29.9–31.1 ms |
| Twelve-agent main CPU p99 / max   |       9.6 / 11.0–11.3 ms |  9.4–10.2 / 10.7–12.2 ms |

Five-agent runs each submitted/completed 46 jobs (max pending four). The third
candidate had one 17 ms CPU-budget miss, four nominal-frame hitches and five
callback hitches; all other five-agent runs had zero. All twelve-agent runs had
zero budget misses/hitches, 96 submissions, max pending 17 and zero outstanding
jobs. Each retained one unconsumed elevation scope (431–460 ms old, 57 frames),
with no pending movement/search/reposition admission. Twelve-agent candidate
completions were 92/92/91 vs baseline 92/92/92; cancellation accounts for the rest.
No dropped samples. Small query counts make p99 noisy; **no steady-state FPS or
latency improvement is claimed**, nor deterministic combat-replay equivalence.

Reproduce combat with `tools/profile.mjs` as documented in [profiling.md](profiling.md),
using `--frames=900 --warmup=120` and `--agents=5` or `--agents=12`. To time only
snapshot preparation after game readiness, import `querySnapshot` in browser
DevTools, pass `__ENGINE__.ctx.get('physics').staticWorld`, measure around the
await, then inspect `bytes`; do not transfer live world buffers.

### Optional backends: not prerequisites

- **SharedArrayBuffer/Atomics:** not adopted or benchmarked. The tested browser
  deployment is not cross-origin isolated. [SAB sharing requires a secure,
  cross-origin-isolated context](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).
  A bounded design would publish immutable buffers per revision, give the worker
  private scratch, tag jobs/results with that revision, bound retained generations,
  and release old buffers only after reader completion/termination. An atomic
  publication/completion word cannot make concurrent mutation of BVH arrays safe.
  With today's ordinary source buffers it still needs an initial copy; eliminating
  that requires changing physics allocation/ownership. Neither these measurements
  nor historical delivery-wait evidence justify that deployment/lifetime complexity.
- **Node/Bun desktop:** optional transport adapters only if a desktop product is
  separately pursued; retain the same protocol, bounds, cancellation and parity
  suite. [Node worker_threads](https://nodejs.org/api/worker_threads.html) explicitly
  transfers ArrayBuffers or shares SABs. [Bun Workers](https://bun.sh/docs/api/workers)
  run a separate JS instance on a thread; packaging does not introduce Rust-style
  shared-state ownership. The Node smoke adapter already executes the real oracle,
  but is correctness evidence, not a native-backend performance benchmark.
- **Rust threads:** not pursued. They would require a native oracle port/bridge,
  numerical/revision parity and cancellation/lifetime validation while retaining
  the browser backend. [Native threads](https://doc.rust-lang.org/std/thread/index.html)
  do not by themselves remove main-thread delivery/retry waits. Reconsider only
  after an isolated kernel/transport bottleneck and a desktop requirement exist.

### Validation outcome and retained failures

145 smoke tests, typecheck/lint/format/build/world validation pass. Native browser
oracle: 49 proofs (three immediate); 120 ms delayed oracle: 37 proofs, zero pending
jobs. Revision negative fails at the intended stale-collision assertion. Native
ladder smoke retains 211 parity cases. Lifecycle regressions cover transport throws,
init timeout/restart/late messages, mid-copy invalidation, disposal before cached
ordinary proofs and duplicate init with queued work. All six pressure scenarios,
dedicated friendly-fire and twelve-agent gate checks pass. Production profiling
and minified boot/prewarm/render pass with the full Chromium used by the profiler;
the default managed headless binary failed GPU adapter creation on this machine.

Observation `arch`, `roof`, `hidden` pass. `search` and `search-move` fail the
unchanged "unreachable evidence must select observation alternatives" assertion
on both this branch and untouched `afa6b75`, with matching first-visibility/shot
and shot-count results (search: 0.717/1.383 s, 60 shots; search-move: 6.050/6.083 s,
79 shots). Do not call the entire observation suite green or weaken that gate.
Generated navigation changes only provenance/envelope checksums; all 8,897,464
Detour/component/cover payload bytes match the baseline, as do visual/collision
assets. The pinned surface-nav fixture hash was refreshed and its physical
execution assertions rerun, not removed.

## Validation

```sh
node tests/smoke/smoke-ai-search-worker.mjs
node tools/ai-worker-check.mjs --port=5508
node tools/ai-worker-check.mjs --port=5508 --delay=120 --frames=900
# Must fail the collision-revision oracle, not boot/import:
node tools/ai-worker-check.mjs --port=5508 --negative=version --frames=900
node tests/e2e/ai-observation-e2e.mjs
node tests/e2e/ai-pressure-e2e.mjs
```

The oracle replays actual frozen browser proofs with the original native function,
including immediate prefixes, and drains under a five-second deadline. Keep
revision/replacement, dimension/direction, pause/cancellation, failure/disposal,
pending-search expiry and delayed route-admission regressions.
For frame/decision measurements use [profiling.md](profiling.md), not oracle timing.
