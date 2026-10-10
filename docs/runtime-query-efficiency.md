# Runtime physical-query efficiency trial

This follows [the worker latency experiment](worker-latency.md), on `bec6a54` of
**draft #396**, not current develop. Both optimizations are runtime-only. There
are **no new baked movement links, region certificates, approximate collision
checks, reduced step budgets, or runtime dependencies**.

## Result in brief

- Exact repeated-state rejection saves real collision work: **10.9% fewer motor
  moves and 12.8% less kernel time** on the request-weighted captured corpus.
  Deduplicating that corpus gives smaller savings: **6.1% / 7.8%**.
- Batching helps cover planning more than observation planning. In frozen cover
  tests, required waiting rounds fell **50 → 35 (30%)**, at the cost of **143 →
  148 physical requests**. Observation waiting rounds barely changed, **90 → 89**,
  although requests fell **789 → 653**.
- In two twelve-agent runs per condition, the longest completed decisions with
  **continuous caller retries** were **50.1–83.6 ms** with both changes disabled
  versus **34.4–34.5 ms** with both enabled. This is a useful observed planning
  improvement, **not** a universal two-frame bound or an equivalent-workload test.
- **No demonstrated frame-rate improvement.** Callback P99 was normally 16.8 ms;
  one combined run was worse at 17.1 ms and had eight CPU-budget misses.
- **Not a gameplay-equivalence or merge acceptance claim.** The existing
  blind-upper friendly-damage gate still fails. A fresh `bec6a54` baseline had
  one hit / **12.76 damage**; this trial had one hit / **44.34 damage**. The larger
  damage is retained, not dismissed because both runs fail the same assertion.

## Implementation and safety boundary

`attachment.js` compares exact position, grounded state, the loop's requested
vertical velocity, and clipped controller velocity at normal iteration
boundaries. The controller/world/configuration are unchanged during a synchronous
check. Contact reports and collision scratch are overwritten or do not feed
subsequent movement. If future controller changes introduce another persistent
motion input, the state tuple must change too.

Arrival checks and bounded-prefix yielding precede rejection; the initial
possibly overlapping pose is excluded. `Object.is` comparisons deliberately do
not round coordinates or equate very small progress with being stuck.
Brent-style checkpoints detect both fixed points and longer exact cycles with
constant storage and one state comparison per iteration. The remaining original
budget cannot escape a deterministic cycle whose visited states all failed the
arrival gates. Only the boolean proof is public; the scratch controller's final
pose is not a movement result. `repeatedStates` and `savedMoves` expose the work
removed. This does not promise the earliest possible detection of every cycle.

The first stationary-only experiment saved just **547 / 38,430 moves (1.4%)**
on the unique captured corpus. It is archived separately; it is not the version
used for the final browser series.

Batching is **bounded optimistic request discovery**, not accepting an unproved
walk. An explicit `lookAhead` planning scope can treat an unknown physical answer
as provisionally true *inside its scratch-only callback*, to discover additional
checks whose geometry is already known. A known failure remains false. The scope
still returns `NAV_PENDING` until its actual required proofs are available.

Only cover, peek and observation scans opt in. Provisional endpoints cannot enter
endpoint caches or trigger a Detour path solve; cover claims remain guarded;
pending observation scratch slots have a zero usable count. Every retry reruns
live filters/scoring. Movement still goes through the normal non-optimistic
`_goTo` route proof from the current foot. Unused requests are cancelled, and the
existing global queue limit, per-actor fairness and full physical budgets remain.
This can submit work a later failed prerequisite makes unnecessary; it cannot
remove genuine dependencies. It is not a general license to put side effects
inside a speculative callback.

## Controlled kernel replay

`tools/attachment-corpus.mjs` loads the cooked collision map and evaluates the
same ordered inputs with the original `checkAttachment` function extracted from
`bec6a54`, the new function disabled, and the new function enabled. The reference
source SHA-256 is
`228d8d236bb72f63b90a4eb353203d44d296521069ab63c1d11a22c77441e406`.

This is **Node 24.18 / V8 CPU timing**, not a worker-message, browser-frame or
live-world-snapshot benchmark. Nine balanced rotating-order passes follow
verification and warmup. Medians below are whole-corpus execution times.

| Corpus | Checks / accepted | Original → optimized moves | Original → optimized time |
|---|---:|---:|---:|
| Unique captured keys | 740 / 602 | 38,430 → 36,074 | 627.1 → 578.2 ms |
| Delivered requests, duplicates retained | 1,443 / 1,058 | 60,303 → 53,714 | 1,195.0 → 1,042.4 ms |
| Synthetic floors/stairs/walls, sizes and budgets | 1,008 / 38 | 48,636 → 26,996 | 96.7 → 56.7 ms |

All answers matched the original. Disabled-function medians were 629.1, 1,193.7
and 96.9 ms respectively: the new disabled control did not show a material kernel
overhead in these runs. The synthetic suite benefits much more than the game
corpus; its ~41% time saving is **not** the game performance claim.

Inputs come from the nine retained traced/echo reports in the earlier latency
study (four five-agent and five twelve-agent runs). Only query inputs are combined,
not their historical timing distributions. The unique corpus includes requested
but undelivered keys; the weighted corpus includes only delivered requests,
including settling frames and stale deliveries. This selected mix is not an
estimate of all gameplay workloads. Source hashes and the exact corpus files are
retained. The cooked-map replay is not a snapshot of every runtime collider;
the separate native oracle below validates the running browser world.

## Frozen planner comparison

At a fixed live scene, with no AI/world advancement between modes, compare full
synchronous physical answers against asynchronous serial and batched discovery.
The worker is drained between attempts; these are **dependency/waiting-round
counts**, not frame-time measurements. Caches are cleared between cases/modes.

| Planner | Frozen cases | Waiting rounds, serial → batch | Requests, serial → batch |
|---|---:|---:|---:|
| Cover | 36 | 50 → 35 | 143 → 148 |
| Observation | 72 | 90 → 89 | 789 → 653 |

All 216 asynchronous results matched their synchronous reference selections.
The cover population included only four successful selections; the remainder
were matching rejections. Observation cases produced 125 shortlisted points in
each mode. Cover's maximum fell from two waiting rounds to one; observation's
maximum fell from three to two, but some cases needed more rounds and aggregate
rounds barely improved. This supports batching cover checks, not a blanket claim
that every observation chain collapses.

## Production browser series

One built candidate supports four explicit modes: `base`, `repeat`, `batch`,
`both`. Base disables both optimizations in this build; it is not an untouched
`bec6a54` bundle. Every mode restarts the worker before the fixture, so its boot
measurement is not a production startup comparison. Main-thread prefix acceptance
and normal queue/collision budgets remain unchanged.

Hardware: Ryzen 9950X / RX 9070 XT, native RDNA4 WebGPU, high 1280×720 DPR1.
Fresh sequential browsers; 120 settling + 1,800 measured paced variable-dt frames;
latency tracing enabled, no per-frame echo messages. No own builds/tests ran during
these screens. This remains a shared desktop, not an isolated performance lab.
Order: B12,R12,T12,C12,C12,T12,R12,B12, then B5,R5,T5,C5.

### Twelve agents — ranges over two runs, not pooled percentiles

| Mode | AI update P99 | Callback P99 / max | CPU-budget misses | Longest continuously retried decision |
|---|---:|---:|---:|---:|
| Base | 2.4–2.5 ms | 16.8 / 20.7–21.7 ms | 1–4 | 50.1–83.6 ms |
| Repeat only | 2.5 ms | 16.8 / 19.8–20.5 ms | 0 | 50.8–51.1 ms |
| Batch only | 2.2–2.5 ms | 16.8 / 20.5–21.4 ms | 0–3 | 34.0–39.5 ms |
| Both | 2.5–2.6 ms | 16.8–17.1 / 20.4–21.6 ms | 1–8 | 34.4–34.5 ms |

The decision column excludes settling-started scopes and scopes with caller retry
gaps. It must not conceal the latter: completed decisions reached **1,134–1,350
ms** in several optimized runs. One combined run ended with an unfinished **1,782.7
ms / 106-frame cover scope**; its sampled owner was alert with no route,
reposition or search wait. That snapshot does not describe all intervening activity.

Worker totals include settling. Base used 146/218 requests and 147.1/218.2 ms
worker CPU; repeat-only used **302/292 requests and 170.9/194.3 ms** despite
shorter individual blocked checks. Batch-only used 246/194 and 173.0/140.7 ms;
both used 185/204 and 141.6/138.8 ms. Thus kernel savings do not guarantee lower
whole-session work: timing changes the subsequent gameplay/query workload.
Twelve-agent shots ranged 896–945. Every screen had zero late builders.

### Five agents — one screen per mode, exploratory

Base/repeat/batch/both callback maxima were 16.9/17.0/16.9/16.8 ms, all with zero
CPU-budget misses. AI P99 was **1.6/2.8/1.8/2.7 ms**, not a consistent improvement.
Continuously retried decision maxima were 50.8/50.3/50.7/34.2 ms; completed gapped
decisions reached 1,550.7 ms in base and 617.1 ms in repeat-only. Shots were
434/441/441/**399**. These different trajectories/activity counts preclude a
workload-equivalence or gameplay-quality-equivalence claim.

## Validation and remaining limits

- Clean install, 95 smoke tests, typecheck, lint, build and world validation pass.
- Original-function native oracle: **194 verified proofs, including 16 immediate**;
  delayed-delivery oracle: **83, including 39 immediate**, no ending pending jobs.
  Revision, pause, cancellation, failure and disposal controls pass.
- Frozen planner selection comparison above; unit cases cover exact cycles,
  tiny real progress, changing vertical velocity, changing clipped velocity,
  initial overlap arrival, partial results, known-failure pruning, stale replies,
  claim safety, endpoint-cache safety and no speculative Detour solve.
- All five observation scenarios, gate, dedicated friendly-fire and suppressed
  pressure pass. Pressure flank/retreat/squad/elevated pass; **blind-upper fails**.
- Fresh `bec6a54` blind-upper baseline reproduces one hit / 12.7595 damage. Trial
  and a separate diagnostic repeat both record one hit / **44.3411 damage**.
  Diagnostic: shooter 2 hits actor 3's head at t=32.15; incident direction differs
  from the fired direction and the sampled original actor ray is clear. This is
  consistent with the previously observed penetration-deflection problem, but
  does not establish equal severity or make the candidate acceptable.
- Navigation was legitimately regenerated for source provenance. All **8,886,620
  payload bytes** and visual/collision asset identities remain unchanged. There
  is no additional prebaked acceptance data.
- Same-tick replay equivalence, the outstanding pending-search expiry review
  finding, integration with newer develop, and independent review remain open.
  This experiment does not close #370 or make draft #396 merge-ready.

## Reproduction and raw evidence

[Raw reports, corpora, source patch, hashes and validation/failure logs](https://gist.github.com/EdoardoLuciani/df67da741c5ccd80ebe2426d97b46cc0).

```sh
npm ci && npm run typecheck && npm test && npm run lint && npm run build
npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --production=1 --paced=1 --realtime=1 --detail=1 --agents=12 \
  --frames=1800 --worker-latency=trace --query-trial=both \
  --port=5464 --out=/tmp/query-trial.json
node tools/analyze-worker-latency.mjs /tmp/query-trial.json
# Repeat separately with base, repeat and batch; do not overlap browsers.
node tools/attachment-corpus.mjs --reference=bec6a54 --rounds=9 \
  --corpus=/tmp/corpus-weighted.json --out=/tmp/kernel.json
MESA_VK_DEVICE_SELECT=1002:7550! node tools/ai-worker-check.mjs \
  --agents=12 --plans --reference=bec6a54 --port=5464 --out=/tmp/oracle.json
```
