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

Snapshot preparation transfers only used geometry/BVH ranges with cooperative
2 ms copy slices. Measurements and rejected backend experiments belong to
[#496](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/496), not this contract.
This is a browser Worker design, not a SharedArrayBuffer/native-thread backend;
no steady-state FPS or deterministic replay improvement is implied.

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
