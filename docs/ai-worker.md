# Static physical eligibility worker (#370)

Replacement for the unmerged #392/#394 direction. This branch incorporates #392's
frame-pacing diagnostics, not a dependency on either PR. It does not close #370.

Follow-ups: [runtime repeated-state and batching trial](runtime-query-efficiency.md),
and [worker latency decomposition and controlled messaging benchmarks](worker-latency.md)
separate microsecond-scale idle transport from main-frame delivery, worker queueing
and subsequent AI retries. Round-trip time is not a byte-copying measurement.

## Ownership and correctness contract

- One preinitialized module worker uses the existing `StaticWorld`,
  `CharacterController` and shared `attachment.js` oracle. No Rust port, alternate
  collision approximation, rendering-policy change or new dependency.
- `query-snapshot.js` copies collision arrays in bounded chunks, yielding between
  chunks, then transfers the copies. Main-thread buffers remain owned by physics.
  The current level copies 48,526,720 bytes (46.28 MiB), excluding object overhead.
  Runtime revision changes invalidate proofs and prepare a new snapshot without
  one synchronous whole-world structured clone. Dirty/replaced worlds and changed
  controller identity/options, gravity or character mask are checked at use.
- Proof identity is the ordered, exact xyz endpoints, radius, height and original
  step budget. No quantization, reversed-key alias or reduced acceptance budget.
  A bounded 512-entry completed-proof cache belongs to the collision generation.
  Actual movement, Detour paths, sensing, firing safety, claims and decisions
  remain on the main thread. Static queries do not include live actor blockers.
- Planning scopes discover independent queries, return `NAV_PENDING`, then rerun
  live scoring/filtering when retried. An unfinished attempt cannot claim a cover
  or leapfrog a pending better candidate. `NAV_CANCELLED` means superseded, not
  physically blocked: it does not blacklist the old candidate as unreachable.
- Local observation/reposition intents freeze their original foot and sample
  geometry. Otherwise settling/separation changes all 24 samples on each retry.
  Threat, friend-lane, visibility and travel filters are live. The local straight
  walk proof is for the **intent's original foot**, not falsely advertised as a
  proof for a changed foot. Before movement, `_goTo` separately obtains the full
  accepted route from the **current** foot through the existing path scheduler.
- Paths/cover retain live-origin applicability. A superseded pending origin ends
  that request; cover keeps its normal retry cadence, paths remain deferred.
  Pending steering holds the old route's progression while gravity, collision and
  local separation still run. Peek proof precedes squad-token acquisition.
- Native zero-move successes remain synchronous. A close live-origin attachment
  can run at most one native controller move. Its unknown result is `null`, not
  failure; the worker then runs the complete original check. This is not a
  synchronous failure fallback or a smaller motor budget.
- At most 256 outstanding jobs; round-robin worker service between actor queues.
  Cancellation is serviced between complete attachment checks, not during a
  motor step. No hard real-time guarantee for a single query. Worker loss,
  malformed results and ten-second initialization/query deadlines are terminal;
  no expensive main-thread fallback. Pause inhibits admission; reset, death,
  inactive scopes, collision rebuild and disposal cancel/invalidate work.

## Timing / replay boundary

Exact frozen-query booleans do **not** imply identical combat trajectories.
Worker completion is asynchronous; admission occurs when the owning AI next
retries. Seeded lockstep input alone therefore no longer guarantees same-tick
AI decisions. This PR must remain a draft until that gameplay/replay contract is
accepted or a recorded-admission replay policy is implemented. It is not valid to
claim deterministic equivalence with the synchronous baseline.

Measure both frame tails and response latency. A returned proof can wait while
its caller pursues another action. `gapFrames` reports intervals without a retry;
these are included in decision latency, not subtracted to improve the headline.
Report unfinished decisions as well as unfinished worker jobs. Query timing
includes queueing/delivery; worker execution timing is separate. Nested kernel
costs are inclusive and must not be summed. Samples are bounded to 2,048;
`droppedSamples` exposes truncation. Counters include settling unless explicitly
filtered by frame.

## Reproduction

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-worker-check.mjs --port=5445
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-worker-check.mjs --port=5445 --delay=120 --frames=900
# Must fail the collision-revision oracle:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-worker-check.mjs --port=5445 --negative=version --frames=900
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5444 --frames=1800 --detail=1 --agents=12
```

`--agents=5` is the existing living-combat fixture; `12` uses three four-person
squads in an independently validated clear lane. Both use finite 10,000 HP to
keep the measured load alive, not normal-health wave coverage. `--realtime=1
--paced=1` measures a separate variable-dt workload. `--worker-profile=1` adds
nested diagnostic timing; do not mix its cost with uninstrumented worker runs.

## Retained developmental findings

The initial twelve-agent integration was unacceptable: 25,993 requests and
22.33 seconds of observed worker computation in 1,800 measured frames plus
settling. It chased changing origins/sample geometry. Supersession alone reduced
that to 5,441 requests / 3.57 seconds; freezing sample geometry alone still left
2,767 / 2.46 seconds. Freezing the actual observation intent, while independently
proving its eventual current-foot route, reduced the screen to 212 requests /
196.1 ms, 7 canceled jobs, 1 superseded request and no unfinished jobs. These are
chronological development screens, not a pooled performance series.

The same final screen completed 65 pending decisions; its longest was 503.3 ms
for elevation, including 42 frames without a retry. The longest observation
completion was 62.6 ms / four frames. These must not be described as a universal
one-to-three-frame response guarantee.

Native observation, gate, friendly-fire and most pressure scenarios passed during
development. `ai-pressure-e2e.mjs --scenario=blind-upper` failed its unchanged
no-friendly-damage assertion on **both** baseline and candidate. The baseline
recorded one hit / 7.22 damage, candidate one / 12.76; differing trajectories do
not establish equal severity. Candidate tracing showed penetration deflection:
the outgoing direction changed and the original actor-only ray was clear. No
firing guard or assertion was weakened to conceal this. An elevated-only baseline
probe was also retained but was not the failing scenario.

## Production measurements (pre-review runtime)

These retained measurements precede the two caller/cache corrections described
below. Do not relabel them as measurements of the corrected head.

Baseline `ac8b67c`, worker runtime `7d398dd`; Ryzen 9 9950X, RX 9070 XT/RDNA4,
Chromium 153/Mesa, native nonfallback WebGPU, high 1280×720 DPR1. Both checkouts
were built with `npm run build`, then measured using `--production=1 --realtime=1
--paced=1 --detail=1`: 120 settling and 1,800 measured frames per fresh browser.
The production option serves the existing build; callers must rebuild first.
The reported revision identifies the checkout, not an independently attested build.
GPU probes were sequential. Whole boot-to-readiness medians were 11.38 s baseline
and 12.26 s candidate (about 0.88 s longer); preinitialization is not free.
Chunk-copy yields and worker startup happen before readiness rather than during
normal combat. These whole-boot measurements do not isolate initialization cost.
Five-agent order: B1, C1, C2, B2, B3, C3; the separate
twelve-agent screen ran C then B. Do not pool these populations or developmental
runs. Actual callback gaps below are not physical-display presentation intervals.

| Run | Callback P95 | P99 | Max | Main AI P99 | AI max | CPU >16.667 ms | AI shots |
|---|---:|---:|---:|---:|---:|---:|---:|
| B5-1 |16.8|16.9|23.6|5.5|13.4|10|445|
| C5-1 |16.8|16.8|17.1|2.8|3.7|0|434|
| C5-2 |16.8|16.8|20.7|3.0|4.7|4|427|
| B5-2 |16.8|16.9|28.9|5.6|15.9|14|438|
| B5-3 |16.8|17.5|31.3|5.6|20.1|16|462|
| C5-3 |16.8|16.8|20.5|3.0|4.2|3|455|
| B12-1 |16.8|21.6|37.4|9.7|27.4|47|928|
| C12-1 |16.8|16.8|20.5|2.6|6.9|1|912|

Milliseconds except counts. Five-agent medians of per-run maxima: callback
28.9→20.5 ms (29.1% lower), AI 15.9→4.2 ms (73.6% lower). Median AI P99
5.6→3.0 ms (46.4% lower); CPU-budget misses 14→3. At approximately 60 Hz the
median/P95 callback interval is unchanged. These are workload observations, not
statistical equivalence or an isolated same-trajectory speedup. AI shots and draw
counts differ: baseline five-agent draws 1,549,463–1,577,928, candidate
1,542,582–1,569,246; twelve-agent draws 2,027,954→2,035,144. Rendering policy and
resolution are unchanged; all runs had zero late builders. Full GPU-frame timing
remains unavailable, not zero.

### Response latency, not just smooth frames

Five-agent query round-trip P95 was 11.8–13.6 ms, maximum 24.7 ms; worker execution
maxima 5.0–5.7 ms. Twelve-agent P95/max round trip was 16.3/26.7 ms, execution
max 3.9 ms, queue max 18.1 ms. Twelve-agent settling+measurement submitted 230
checks, completed 224, canceled six and superseded three intents; observed worker
execution totaled 184.1 ms. Every final production run ended with zero pending
jobs **and zero unfinished decisions**. No sample truncation in this series.

Completed decision latency still includes a **1,035.5 ms / 62-frame cover case**
with 61 frames without a retry, and a five-agent 1,000.1 ms case with 58 gap frames.
These are caller-admission delays, not one-second worker executions, and cannot be
removed from the report. Non-gap observations were several frames, not always one.
The gameplay tests exercise continuing fire/movement, but do not prove exhaustive
responsiveness/fairness across all content or weaker CPUs.

## Remaining collision cost / Rust-Wasm decision

A separate 3,600-frame, twelve-agent development CPU sample (500 μs target
interval) observed 676 active samples / 364.08 ms of active sampled time across
36.69 s. Aggregated self time, excluding `(idle)` and `(program)`:

| Function | Share of active sampled time |
|---|---:|
| `sweepCapsule` |23.26%|
| `queryAabb` |21.65%|
| `closestPtSegSeg` |16.35%|
| `segTriangleClosest` |13.26%|
| `closestPtPointTriangle` |11.37%|
| garbage collector |4.54%|

This is a sparse diagnostic sample, not an instruction/cache-counter analysis.
A separate nested-timing run observed 8,155 motor moves, 43,649 capsule sweeps and
60,637 AABB queries in 225.4 ms of worker checks. Sweep time 147.0 ms, overlap
56.6 ms and AABB 53.3 ms are **inclusive/overlapping**, not additive.

The work is CPU-intensive collision traversal and geometry, not primarily waiting
on GPU or I/O. Arithmetic versus branch/cache/memory limitation remains unproven.
Rust/Wasm is plausible for a shared whole-check kernel, but these measurements do
not establish a speedup. Current native-JS worker execution is already short;
remaining long decisions are predominantly admission gaps. Do **not** add a
parallel Rust collision implementation now. If weaker-CPU/queue latency later
justifies a prototype, preserve shared motor semantics, precision/tolerances and
batched JS/Wasm crossings, and benchmark end to end.

## Validation and remaining limits

Clean install: 93 smoke tests, lint, build and world validation passed. CI also
runs `npm run typecheck`: its first run caught four JS/TS boundary-inference
errors missed by those commands. They were reproduced locally and corrected with
explicit nullable/number annotations and a fail-fast invariant for an impossible
unknown result from the complete native wrapper; no assertion was cast away or
unknown converted to physical failure. The generated provenance was refreshed. All
8,886,620 navigation payload bytes (Detour, components, cover) and visual/collision
assets match the baseline; only regenerated provenance/envelope/checksums differ.
The shared helper is included in authoring provenance rather than bypassing hashes.

Native oracle runs compare completed frozen proofs, including the synchronous
prefix, against the full native controller: the final twelve-agent run checked
221 proofs (20 immediate prefixes); the 120 ms delayed-delivery run checked 40
(two immediate), both ending with zero outstanding jobs. The retained tool drains outstanding
results under a five-second deadline; delayed delivery, real floor/wall collision
rebuild, pause, cancellation, failure and disposal controls are included. The
version negative control fails `changed collision retained stale worker success`
and overwrites any previous success report.

Final observation (five scenarios), gate, dedicated friendly-fire and isolated
suppressed-pressure checks passed. The pressure suite passed flank, retreat, squad
and elevated before the unchanged blind-upper assertion stopped it; that baseline
failure remains disclosed above. Gate includes twelve normal-health agents and
two controlled deaths after spawning; it does not establish respawn/reset wave
coverage. Performance fixtures instead use high finite HP.
No assertion was weakened and no firing/penetration policy changed.

## Independent review corrections

The independent review of `443f6a9` requested changes, not approval. Both findings
were reproduced before fixes:

1. A deferred reposition to a point 2 m away was canceled as arrival at the old
   target underfoot. Route admission is now separate from execution: pending
   routes do not steer toward the old target, report arrival, start the execution
   timeout or blacklist the old target. Once a route is accepted, its execution
   timer starts; a real asynchronous rejection records the requested destination.
   Retained tests cover delayed admission, accepted arrival and rejected routes.
2. With a disabled probe or a same-version replacement collision world, an actor
   endpoint cache returned ref 1 while native attachment returned false. Endpoint
   caches now require the valid worker generation at use, even before restart,
   including cached failures. Radius, height and direction are also part of the
   endpoint proof's reuse contract. Both reproduced cases now return ref 0 and
   recover to ref 1 after restoration; dimension/direction changes force checks.

The reviewer independently validated 93 tests, native observation/oracle cases,
snapshot ownership, all navigation payload bytes and the reported arithmetic.
That is not approval of the later fixes; follow-up review is separate.

## Latest integration and develop follow-up

A subsequent `3929eb2` twelve-agent run exposed a **434.3 ms actively retried
observation** (27 attempts, no gap frames): 110 worker checks totaled only 39.6 ms.
Nonlocal search retries were still sampling around changing `lastKnown` rather
than their existing stored `_searchOrigin`. `536254a` uses that original cue and
cancels the old observation scope when the existing search policy rebuilds it.
A regression reproduced the changed cue (x=.1) replacing the intent (x=0).
This is query-admission/input churn, not evidence that Rust would solve it.

Develop then advanced via #397 to `4672132`. It was merged as `fa64ee5`; only
regenerated navigation assets and their test hash needed conflict resolution.
Fresh clean install, 93 tests, typecheck, lint, build and world validation passed.
All 8,886,620 navigation payload bytes still equal the **new** develop baseline.
CI build passed (3m19s); DeepScan reported zero new/two fixed issues. This restores
a mergeable branch, not permission to merge the unresolved replay contract.

Fresh **single pairs**, same production/native/paced 120+1,800-frame conditions,
now compare `4672132` with `fa64ee5`. Order B5,C5,C12,B12. These are separate from
all earlier series, not additional observations pooled into their medians.

| Run | Callback P99 | Max | Main AI P99 | AI max | CPU >16.667 ms | AI shots |
|---|---:|---:|---:|---:|---:|---:|
| Develop B5 |17.0|43.9|5.1|32.6|9|449|
| Worker C5 |16.8|18.0|2.8|6.8|1|452|
| Develop B12 |21.1|46.1|10.5|32.7|55|944|
| Worker C12 |16.8|19.8|2.2|3.9|0|929|

Callback median/P95 remain 16.7/16.8 ms. Draw totals were 1,564,782→1,569,693
(five) and 2,057,346→2,039,645 (twelve); all had zero late builders. Boot readiness
was 11.52→12.33 s and 11.33→11.97 s. Different combat trajectories and the small
sample size still preclude equivalence/statistical claims.

Query round-trip P95/max: 12.2/13.1 ms (five), 16.7/25.7 ms (twelve). Worker
execution totaled 75.1/146.1 ms including settling, with no outstanding jobs.
Longest completed decision: 67.1 ms / four frames (five), 116.7 ms / seven frames
(twelve, including five gap frames). The twelve-agent report also retains one
**unfinished 1,449.4 ms cover scope**. Its owner was in `close-engage`, with no
pending path, reposition plan or search; it was not awaiting that route. This is
still unfinished caller bookkeeping and is not silently counted as completion.
`pendingDecisions` now includes owner state/flags to distinguish these cases.

The full `postreview-prod-*` and `final-prod-*` intermediate series remain in the
evidence, including unfinished scopes and the 434.3 ms case. Latest pre-merge
native validation also passed all observation scenarios, gate, friendly-fire,
suppressed-pressure, and 205-proof twelve-agent / 38-proof delayed oracles (12/3
immediate prefixes, zero pending jobs). The unchanged blind-upper pressure failure
remained one friendly hit / 12.76 damage. No firing policy or test was weakened.

Still unverified: weaker hardware, cross-vendor behavior, exhaustive routes/waves,
statistical equivalence, physical-display presentation, and a deterministic
recorded-admission replay contract. A stalled/delayed-worker oracle is a correctness
stress test, not proof of acceptable response time. This remains a draft, not a
completed #370 hitch fix.
