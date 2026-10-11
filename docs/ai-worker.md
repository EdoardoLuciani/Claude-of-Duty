# Static physical eligibility worker

## Ownership and proof contract

- AI owns one preinitialized module worker, bounded queues, controller scratch,
  revisions and lifetime. Physics owns collision snapshot construction
  (`query-snapshot.js`); transfer chunked copies, never live buffers.
- Authoring and runtime share `attachment.js`, `StaticWorld` and the native
  character controller. No approximate collision or synchronous failure fallback.
- Proof keys contain ordered exact endpoints, radius, height and the original
  step budget. No rounding, reverse aliases or shortened rejection budgets.
  The 512-entry completed-proof cache belongs to one collision generation.
  World replacement/revision, controller/options, gravity or mask changes
  invalidate proofs, including cached failures.
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

## Timing and known limitations

Exact frozen-query answers do **not** guarantee identical combat trajectories.
Tactical admission is asynchronous: fixed input/seed/step does not promise
same-tick combat replay. The capture `deterministic` flag freezes configuration,
not worker scheduling. Recorded-admission replay is separate, unimplemented work.

The unchanged `blind-upper` zero-friendly-hit gate failed on both the synchronous
baseline and worker candidate. Penetration deflection can hit a teammate after
the straight actor-only firing ray was clear. Different trajectories do not
establish equal severity; baseline failure does not waive candidate acceptance.
This worker design neither fixes that firing-policy issue nor establishes
exhaustive fairness/responsiveness, normal-health waves or weaker-CPU performance.
Track acceptance and remaining renderer/AI work in
[#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

Historical investigations and evidence:
[worker/review #396](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/396),
[readiness/friendly fire](https://gist.github.com/EdoardoLuciani/39579ee04f3c7efd51a056e6add939f9),
[cycle/batching trial](https://github.com/EdoardoLuciani/Claude-of-Duty/commit/ed8e3e2),
[rejected continuation reuse](https://gist.github.com/EdoardoLuciani/87f6b0a9ad8653ad6a083f74b5eafb5e).
Closed experiments belong there, not in the runtime or another diagnostic subsystem.

## Validation

```sh
node tools/ai-worker-check.mjs --port=5445
node tools/ai-worker-check.mjs --port=5445 --delay=120 --frames=900
# Must fail the collision-revision oracle, not boot/import:
node tools/ai-worker-check.mjs --port=5445 --negative=version --frames=900
node tests/e2e/ai-observation-e2e.mjs
node tests/e2e/ai-pressure-e2e.mjs
```

The oracle replays actual frozen browser proofs with the original native function,
including immediate prefixes, and drains under a five-second deadline. Keep
revision/replacement, dimension/direction, pause/cancellation, failure/disposal,
pending-search expiry and delayed route-admission regressions.
For frame/decision measurements use [profiling.md](profiling.md), not oracle timing.
