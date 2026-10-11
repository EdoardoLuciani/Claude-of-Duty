# Worker latency: transport, scheduling and consumption

Follow-up to [the worker integration](ai-worker.md), at gameplay revision
`2d7045e` (same runtime as `fa64ee5`). These are **diagnostic measurements**, not
new baseline-versus-worker performance claims. No gameplay, collision acceptance,
render quality, worker fairness or admission policy was changed.

[Raw reports, retained exclusions, source, hashes and validation logs](https://gist.github.com/EdoardoLuciani/8ced274bb3a2b24d497fb44d46f7c903).

## Result

The 10–28 ms request round trips are **not time spent copying a small message**.
Most typical latency is return delivery while the main thread is executing the
frame. Worker queueing contributes to tails, and AI retries/serial proof stages
add separate delay after delivery.

### Controlled messaging

A warmed, serial chain of 1,000 echo requests on the real collision worker, with
no gameplay stepping, took **10.3–16.9 ms total** across four fresh browsers:
**10–17 microseconds amortized per round trip**, including JS/Promise/timer
bookkeeping. This is an aggregate throughput/latency baseline, not individual
microsecond-resolution measurements or a native C++ thread comparison. Echoes
reply directly from the worker message handler, deliberately bypassing the
physical solver and actor queue; real-query tracing measures those separately.

Individual non-isolated browser timestamps are coarsened to approximately
0.1 ms. `performance.timeOrigin + performance.now()` puts worker/main observations
on a common epoch, but independent rounding produces small negative one-way
deltas (about −0.1 ms). Raw values are retained, not clamped or described as
negative physical latency. Clock/order errors exceeding 0.25 ms fail analysis.
The per-job pre-post stamp is inside the batch-post wrapper; tiny outbound and
post-call intervals also include its remaining bookkeeping. These are not precise
measurements of serialization, OS wakeup or memory bandwidth.

Positive controls send the same message and deliberately keep the main thread
busy for 2, 8 or 16 ms. Median round trips become approximately **2, 8 and 16 ms**,
respectively. The worker does not acquire that much extra computation.

During gameplay, paired echoes are posted immediately before and after each
`engine.step()` (1,800 measured pairs/run):

| Agents / retained runs | Before-step RTT median | After-step RTT median | After-step P95 |
|---|---:|---:|---:|
| Five / 2 |9.3–9.6 ms|0.8 ms|1.0–1.1 ms|
| Twelve / 3 |10.4–11.7 ms|0.8 ms|1.0–1.1 ms|

These are within-frame paired probes on the same worker, not different scene
benchmarks. The small post-frame remainder still includes browser frame handling,
task scheduling and messaging; it is not separately attributed to compositor,
serialization or OS wakeup. No claim that all non-compute time is main JS.

### Real queries without per-frame echo traffic

Two trace-only runs per actor count, 1,800 measured frames/run. Table cells are
ranges of **per-run** statistics, not pooled percentiles. Settling queries are
retained in raw data but excluded from this table.

| Phase | Five: median / P95 | Twelve: median / P95 |
|---|---:|---:|
| Request creation → batch posting |0.1–0.2 / 0.5–0.8 ms|0.2 / 0.7–0.8 ms|
| Posting → worker handler |~0–0.1 / ~0–0.2 ms|0.1 / 0.1–0.2 ms|
| Worker application queue |0.2–0.5 / 4.2–8.7 ms|0.2–1.0 / 8.2–10.5 ms|
| Native physical check |0.2 / 3.4–3.6 ms|0.5 / 3.1–3.5 ms|
| Result posting → main handler |7.9 / 10.3–10.6 ms|8.4–10.3 / 12.9–14.1 ms|
| Whole request round trip |9.2–9.7 / 11.3–11.6 ms|11.7–12.8 / 15.8–17.6 ms|

Independent percentiles are **not additive**. Every individual query's phase
intervals telescope to its whole round trip; the analyzer checks this.

Across these four runs, **89.1–90.2% of accumulated result-delivery wait overlapped
measured synchronous main-frame execution**. This is overlap attribution of
waiting queries, not extra CPU time (several queries can wait simultaneously).
Render submission is inside that main-frame interval. Thus the leading
explanation is directly supported, not inferred solely from similar averages.

Queueing is real too: the twelve-agent trace-only worker queue reached
**14.2–15.4 ms**, and whole-query maxima reached **27.0–28.1 ms**. Outbound dispatch
occasionally reached 2.4–2.5 ms; that interval includes waiting for a busy worker
to handle the incoming message, not just serialization. A separate echo run had
outbound P95 1.2 ms. The worker yields between complete checks, not within a check.

No collision arrays cross the boundary per query: only ordered scalar query
inputs/IDs, and result/diagnostic fields. The 46.28 MiB initialization snapshot
is separate. Normal operation emits none of the added trace fields unless the
profiler opts in.

## Delivery is not AI consumption

First subsequent attempts by the **same original scope** had median delivery-to-
retry delays of **3.3–6.7 ms** in trace-only runs: often the remaining time until
the next AI update. But we also retained retry delays up to **1,854.6 ms**.
Some scopes/results were never retried or used before the observation ended;
they are reported as censored, not zero or completed. Stale/cancelled responses
and jobs without replies also remain visible.

Version 2 adds exact scope-to-decision association and state snapshots. Examples:

- Twelve-agent cover decision: **67.8 ms / four frames**, eight jobs submitted
  over four successive frames, **1.3 ms total observed worker computation**,
  five attempts and no skipped retry frames. This is a serial frame-to-frame
  proof-discovery/admission chain, not a 67.8 ms kernel or transfer.
- Five-agent cover decision: **700.9 ms / 42 frames**, three jobs submitted in
  one frame, **0.3 ms computation**, two attempts and **41 gap frames**. One
  response arrived after 9.1 ms; the original caller retried about 690.5 ms
  after delivery. At delivery it was in `cover-peek`, with no pending route,
  reposition plan or search. At retry those pending flags were also false.
  This does not prove its behavior throughout the intervening interval, but
  does distinguish optional caller work from a worker occupied for 700 ms.

A physical proof may be read first by a different actor/scope. `consumed` records
its **first global cache read**, including cached false. `originalScopeConsumed`
says whether that first read was by the originating intent; it does not record
all later reads or prove tactical commitment. `firstRetry` requires the original
scope object and start time, and is recorded only when the planner actually runs
its callback. A replacement intent is not counted as an old intent retry.

## Implications

1. **Do not optimize byte copying first.** Idle round trips are tens of
   microseconds, not tens of milliseconds. Removing structured cloning alone
   cannot remove a busy main thread or a later AI retry.
2. **Target serial proof discovery/admission.** Investigate submitting already-
   known independent physical checks together, instead of discovering each
   stage on a new frame. Preserve live tactical filtering, ordering, complete
   collision budgets, bounded work and failure semantics. Do not blindly
   speculate all candidates or move tactical authority into the worker.
3. **Review caller retry/expiry policy separately.** Long optional scopes are
   not equivalent to blocked movement; neither should be hidden from metrics.
   The independent follow-up review also identified pending search bypassing
   expiry. This diagnostic change does not fix or approve that gameplay issue.
4. **Shared-memory polling would require an intentional consumption point.**
   It could expose ready results before `onmessage`, but does not interrupt main
   JS. Polling only at the next existing AI update may provide no benefit over
   a message already handled between frames. No SAB implementation or speedup
   claim is included; it also requires cross-origin isolation/deployment work.
5. **Rust/Wasm remains secondary.** Faster checks could reduce queue tails and
   matter more on weak CPUs. It cannot remove delivery/AI scheduling delays.
   No port or Rust benchmark was performed.

## Method and instrumentation limits

Production build, native RDNA4/Ryzen 9950X, Chromium, high 1280×720 DPR1, paced
variable-dt fixture; 120 settling plus 1,800 measured frames. Fresh sequential
browsers. One worker, unchanged round-robin scheduling and full native oracle.
No per-kernel nested timing was enabled. This remains a shared desktop, not an
isolated real-time machine, and is not physical-display or cross-vendor evidence.

- `--worker-latency=trace`: stamps real requests and cache reads, plus an idle
  control before fixture creation. No per-frame echo traffic.
- `--worker-latency=echo`: additionally posts before/after-step echo pairs.
- Disabled controls use the same instrumentable production bundle without
  enabling probes. They are worker controls, **not synchronous-baseline runs**.
- Clean control CPU-step P99: five 12.6 ms; twelve 14.0/15.9 ms. Trace-only:
  five 11.9/12.5 ms; twelve 14.0/16.1 ms. Shots and trajectories differ. These
  screens do not establish zero instrumentation overhead or equivalence.
- Raw reports distinguish measured frame indices from settling. All source
  instrumentation runs are dirty diagnostic builds based on `2d7045e`; the
  checkout revision alone is not build attestation. Source and bundle hashes
  accompany the evidence.
- V1/V2 have the same query-phase boundaries. V2 adds 1,000 idle echoes, actor
  state and completed-decision association. They are identified in raw data.
  An earlier exploratory run lacks the corrected scope-identity guard and is
  excluded from the headline analysis.
- `control5-1` and `echo5-1` overlapped our own smoke-test process. Both are
  retained but excluded from headline comparisons; fresh replacements were
  run after tests stopped. No other agent's processes were terminated.
- Bounded diagnostics fail visibly rather than truncating; hooks/listeners are
  restored and echo timers cleaned up. Drain does not advance AI: unfinished
  consumption stays unfinished. Pending service jobs are not proof that the
  worker has acknowledged all cancellations; missing replies remain marked.

## Reproduce

```sh
npm ci
npm run build
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --production=1 --paced=1 --realtime=1 --detail=1 \
  --agents=12 --frames=1800 --port=5454 --worker-latency=trace \
  --out=/tmp/latency.json
node tools/analyze-worker-latency.mjs /tmp/latency.json
```

Use `--worker-latency=echo` for paired/control probes; omit it for an uninstrumented
worker control. The analyzer checks clock/order consistency, per-query phase
closure, busy controls, completed drains and failure status. Smoke regressions
cover missing timestamps, bad clocks, a false busy-control result, censored
observations, cached-false consumption, scope replacement and hook/error cleanup.

Validation: clean install, 94 smoke tests, typecheck, lint, build and world
validation passed. A separate native twelve-agent oracle verified 204 proofs
(including 12 immediate checks), with no mismatches or pending service jobs;
revision, pause, cancellation, worker failure and disposal controls passed.
A missing-browser negative run exited 1, replaced a seeded stale-success report
with the original launch error, and cleaned up its server. This is not independent
approval of the diagnostic patch or the unresolved gameplay/replay contract.
