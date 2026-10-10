# Static physical eligibility worker (#370)

Replacement for the unmerged #392/#394 direction. This branch incorporates #392's
frame-pacing diagnostics, not a dependency on either PR. It does not close #370.

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

Final paired measurements, validation and kernel findings are recorded below once
complete. No Rust/Wasm speedup, cross-vendor result, physical-display timing or
exhaustive gameplay-quality claim is implied.
