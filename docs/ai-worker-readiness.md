# Worker pre-review cleanup

This is the bounded correctness/integration follow-up to [the worker PR](ai-worker.md),
not another optimization experiment. Optimistic batching and positive continuation
caching remain absent. [Raw evidence, failures and temporary diagnostic scripts](https://gist.github.com/EdoardoLuciani/39579ee04f3c7efd51a056e6add939f9)
are archived separately; no permanent diagnostic subsystem was added.

## Changes

- Integrated `develop` at `631adbc` into the worker branch, including the upstream
  TypeScript migration. Preserved worker admission, live-foot validation and
  pending/reposition/search behavior in `agent.ts` and `index.ts`; updated physics
  imports in worker tooling/tests. No new dependency or synchronous fallback.
- Fixed the outstanding review finding: `_tickSearch()` now checks intent/travel
  expiry before retrying pending candidate construction. Exhaustion remains after
  construction so an empty pending list is not mistaken for a completed search.
  `_clearSearch()` cancels its pending observation scope.
- Added regressions for both `NAV_PENDING` and `NAV_CANCELLED`: wait before the
  deadline, expire exactly at it, cancel the scope once, and neither move nor
  record a physical failure. Both variants failed before the fix; they pass after.
- Clarified the capture-configuration comment: a fixed seed and disabled ambient
  automation do not make live worker admission synchronous/deterministic.

Navigation was regenerated through `npm run world`, not hand-edited. Worker base,
current develop and integrated output have identical **8,886,620-byte navigation
payloads**, SHA-256
`3265c1119424ba39faa7c1d46a4e75eb102ccc6ddc411a717236eeafc1ad41f8`.
Visual/collision asset references are unchanged. Source provenance legitimately
changed with the TypeScript/import migration: navigation hash
`4e99afcf7607bab85060759201b68ce5157bfda9e9ddf1cc694d5083d100e9d2`,
asset `level-nav.7d1aedf0c1e9.bin.gz`.

## Validation

Browser candidate: **`ea749e24da46ee96581e2d5a1378e3c8f9ef89c9`**. Subsequent
changes are documentation, a comment and an optional TypeScript declaration for
the lazily initialized alive-ID set; they do not change emitted gameplay logic.

- Clean install; **96 tests**, typecheck, lint, build and world validation passed.
- Native original-function oracle (`bec6a54` reference): **206 proofs**, including
  **12 immediate** checks; zero pending jobs and lifecycle checks passed.
- A separate 120 ms delayed-worker screen: **38 proofs**, including **3 immediate**
  checks; zero pending jobs and lifecycle checks passed.
- Collision-version negative control exited 1 with
  `changed collision retained stale worker success`, as expected.
- All five observation scenarios, gate and dedicated friendly-fire checks passed.
- Pressure flank, retreat, squad, elevated and suppressed scenarios passed.
  **Blind-upper still failed**, on both develop and the candidate; see below.
- Validate CI passed on `ea749e2`. Author checks are not independent review.

## Friendly-fire finding remains open

Fresh sequential blind-upper checks used the same existing test, first on
`develop` `631adbc`, then on the integrated repeat-only candidate:

| Population | Friendly hits | Friendly damage |
|---|---:|---:|
| Current develop | 1 | 7.215774614772386 |
| Integrated worker | 1 | 12.75946487527976 |

Separate diagnostic repetitions reproduced these damage totals. They are separate
runs, not additional repetitions of the uninstrumented acceptance population.
Temporary external scripts wrapped `fireBullet` and recorded the friendly damage,
original actor-only ray and resolved impacts; no diagnostic was installed in the
runtime or permanent tooling.

- Develop diagnostic: shooter 2 hit actor 3's arm at 16.9833 s.
- Worker diagnostic: shooter 3 hit actor 2's torso at 17.0833 s.
- In both, the original actor-only ray was clear. The resolved shot first entered
  and exited flesh, then struck the teammate with a changed incident direction.
  This matches the existing penetration-deflection mechanism in `penetration.ts`;
  the straight-line firing guard cannot account for that changed trajectory.

These are **different shots/trajectories**, not a matched-shot severity comparison.
The candidate nevertheless caused more friendly damage in this screen; a baseline
failure does not excuse it or establish safety equivalence. Nor does one screen
establish a general difference in incident rate. The zero-friendly-hit assertion
is unchanged and remains a failed acceptance check. Resolving the broader firing
policy/trajectory problem is outside this pending-search fix, not silently waived.

## Small planning-wait analysis

Two fresh sequential native WebGPU production screens (5 and 12 agents, each
120 settling + 1,800 measured paced variable-dt frames, high 1280x720 DPR 1) used
the retained trace tool. Own builds/tests did not overlap these captures. These
are finite high-HP screens on one AMD/RDNA4 host, **not a new speedup comparison**.

| | 5 agents | 12 agents |
|---|---:|---:|
| AI shots | 465 | 910 |
| Longest completed continuously retried measured-start scope | 36.0 ms | 67.4 ms |
| Longest completed scope with retry gaps | 217.3 ms | 1,133.9 ms |
| Unfinished scopes / pending jobs at capture end | 0 / 0 | 0 / 0 |
| Callback P99 / maximum | 16.8 / 17.0 ms | 16.8 / 20.3 ms |
| CPU-step budget misses | 0 | 1 |

The 12-agent 1,133.9 ms elevation scope had **67 skipped retry frames**, two jobs
submitted in one frame and 5.5 ms observed worker computation. At delivery and
retry, its owner was in `suppressed-engage`, wanted to fire and had no pending
route, reposition admission or search planning. A 1,032.1 ms cover scope had
61 skipped retry frames and 0.6 ms worker computation; its owner was already
cover-peeking at delivery, moved about half a metre by retry, and likewise had
no pending route/reposition/search flags at either snapshot. The five-agent long
elevation scope had 11 skipped retry frames and the same engaged/non-waiting
snapshot pattern.

These samples support optional planning not being retried while other combat
behavior runs, rather than owners parked for a second waiting on worker physics.
They are **endpoint snapshots**, not proof of every intervening frame or a
universal planning-latency bound. Cancelled/unreturned queries remain in raw
traces; they are not credited with successful proofs or measured computation.
No speculative optimization was added in response.

## Review/merge boundary

The known pending-search defect and develop conflicts are addressed. This pass
does **not** provide independent approval or a clean gameplay-safety acceptance.
Keep the PR draft pending resolution of the friendly-fire finding and an explicit
owner decision about asynchronous admission timing.

Recommended contract for this single-player worker design: exact static physical
acceptance, main-thread live authority, and intentionally asynchronous tactical
admission. Fixed input/seed/step alone does not promise same-tick combat replay.
The existing capture/telemetry `deterministic` flag describes configuration, not
an attestation of that replay property. This is a recommendation, **not recorded
owner acceptance**. If same-tick replay is required, recorded admission or another
scheduling design remains separate work; it was not implemented here.
