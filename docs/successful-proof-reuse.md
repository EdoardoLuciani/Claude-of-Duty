# Successful physical-proof reuse: opportunity check

## Recommendation

**Keep the existing exact proof cache and cycle rejection. Do not add a successful
continuation cache, another worker cache, or a larger cache on this evidence.**

This is an analysis of the repeat-only worker runtime at `ed8e3e2`, not a new AI
optimization. No files under `src/` or `public/` changed. The optional diagnostic
records live requests, then tests caches **after combat has stopped**. No
prototype answer is returned to a live planner, and no batching was restored.
The investigation harness is archived in Git at
[`0db3fab`](https://github.com/EdoardoLuciani/Claude-of-Duty/commit/0db3faba7da01b0680bdc31c7f3cc59eef97f22a),
then removed from the current tree: a closed experiment should not add a
permanent profiling subsystem or maintenance burden.

[Raw captures, controls, summary, hashes, archived source and validation](https://gist.github.com/EdoardoLuciani/87f6b0a9ad8653ad6a083f74b5eafb5e).
The `.json.gz.b64` files decode with `base64 --decode FILE | gzip -d`; hashes
refer to decompressed JSON. All six runs and the negative control are retained.

## What current AI actually reuses

Four fresh, sequential production captures used the existing living-combat
fixture: 5 actors for 1,800 and 3,600 measured frames; 12 actors for two 3,600-frame
captures. Each had 120 settling frames, variable-dt paced execution, high quality,
1280×720/DPR1, native AMD RDNA4 WebGPU (RX 9070 XT host, Ryzen 9950X), Chrome 153.
There were no concurrent author builds/tests during these runs. Two separate
capture-disabled controls were retained, not pooled with the captures.

Cache/query counts below include setup, settling and drain. Frame statistics
exclude settling. These are roughly 30/60-second screens, not long-session,
all-map, weaker-CPU or exhaustive gameplay coverage.

| Capture | Successful cache reads | Failed cache reads | Peak of 512 entries | Submitted / returned queries | Successful returned queries |
|---|---:|---:|---:|---:|---:|
| `reuse5-1` | 247 | 102 | 88 | 87 / 87 | 56 |
| `reuse5-2` | 754 | 616 | 377 | 271 / 271 | 197 |
| `reuse12-1` | 1,115 | 519 | 375 | 354 / 353 | 263 |
| `reuse12-2` | 1,112 | 539 | 335 | 306 / 306 | 221 |

- **3,228 successful cache reads**, including 2,203 in a different planning
  episode from the producer, 500 first cached reads in the producing episode,
  and 525 later reads in that same episode. An episode is one `run()` invocation
  and its pending retries, not necessarily a distinct tactical goal. Counts
  include consuming original results: they are **not** 3,228 independently
  measured expensive walks avoided.
- **Zero evictions, zero cache clears, zero re-submissions of already-published
  proofs**, and zero submitted cases eligible for a previously published
  successful proof differing only in step budget. More capacity or LRU would
  not address the observed misses. This does not establish capacity sufficiency
  over a long game session.
- 135 submissions shared an earlier successful destination/dimensions/budget
  but changed their origin; 883 had no earlier successful matching destination
  family. The 5-actor long capture contained 95 height-only origin changes,
  including eight nearest-origin differences below one micrometre. These remain
  different inputs, not permission to round positions or relax collision tests.
- One cancelled observation job in `reuse12-1` had no reply. It is retained as
  unreturned, not credited with work or a successful proof. Replay covers the
  **1,017 returned queries**, including stale replies.

## Could a new query join an already-solved continuation?

The replay uses the actual browser collision world and native controller after
capture, with the game paused. The shared `checkAttachment` source is compiled
unchanged for the reference and instrumented at the pre-move boundary for state
capture/prototype lookup. **Every reference boolean and move count matched the
actual worker reply.** This is not a replay against an approximately equivalent
cooked map. Intermediate states are collected in the replay, not inside the live
worker.

The matched state contains exact position, requested vertical velocity,
grounded flag and clipped controller velocity. Context includes the exact goal,
radius/height, immutable world/configuration and original `from.y`; the latter
matters because the native algorithm bounds vertical excursion relative to the
original start. No rounding is used; signed zero is retained in diagnostic keys.
The existing service's actual string identity is logged separately.

The prototype stores only successful continuations, after their proof completes.
The cached number of remaining moves must leave an iteration for the native
arrival check. Initial stand/arrival gates still run, and checkpoints are after
the ordinary arrival/budget/cycle gates. Tests show that removing either the
original-height context or remaining-budget guard can incorrectly return true.
This relies on the same deterministic relevant-state assumption as the existing
cycle detector; it is not a generic cache for future controller implementations.

Four variants were replayed with fresh caches per pass, one warmup each, then
**eight rotating-order timed passes per variant**:

1. Native repeat-only function.
2. A second, worker-local 512-entry cache of successful **whole** queries.
3. That whole-query cache plus 4,096 successful intermediate states.
4. That whole-query cache plus 65,536 intermediate states.

**Result: zero additional successful-tail hits, at either capacity.**

There were 32,754 observed motor steps, 22,001 on successful queries. The extra
whole-query cache saved **one** motor step: two actors submitted the same
one-move elevation proof before its first result reached the main thread
(`reuse12-1`, jobs 107/108, frame 948). It showed no meaningful timing benefit.

Worker-start timestamps can tie at timer resolution; the replay retains posting
order for ties. To rule out an ordering or conservative-height-key explanation
for the negative result, a separate diagnostic admits **all successful donors,
even future ones**, excludes identical whole queries, and optionally ignores
original start height. Even this overly permissive pool found **zero**
different-query tail matches. It is an opportunity upper bound, not an acceptable
runtime proof rule. Sessions are kept separate; no cross-session proof seeding.

### Cost rather than benefit

Median complete replay time, milliseconds; these are **post-capture main-thread
Chrome kernel comparisons, not live worker or frame-time measurements**:

| Capture | Native | Extra whole cache | Whole + 4,096 states | Whole + 65,536 states |
|---|---:|---:|---:|---:|
| `reuse5-1` | 60.80 | 60.80 | 62.70 | 62.85 |
| `reuse5-2` | 91.55 | 91.35 | 94.00 | 94.15 |
| `reuse12-1` | 277.95 | 278.05 | 296.30 | 291.35 |
| `reuse12-2` | 190.75 | 190.75 | 198.35 | 197.15 |

The straightforward string-keyed continuation prototype was **2.7–6.6% slower**
with the 4,096-entry limit. The larger variant retained up to 13,373 states with
2,227,490 key characters and no extra hit; key characters are not a precise heap
byte measurement. A custom allocation-free hash could reduce overhead, but
cannot manufacture the missing reuse opportunity in these traces.

Unlike within-query cycle detection, cross-query continuation reuse requires
retaining many states, validating query context and remaining work, and managing
storage. Here that complexity buys no observed saving. Approximate nearby-path
reuse would be a different algorithm/acceptance contract and was not tried.

## Activity and limitations

The four capture runs fired 451/872/1,729/1,739 AI shots; all sustained-combat
checks passed, with no unfinished decision scopes at the end. The 5/12-actor
controls fired 450/1,736 shots. Callback P99 was 16.8 ms in all six runs, with
capture maxima 17.0/23.5/20.6/20.5 ms versus control 17.0/20.9 ms. CPU-step P99 was
12.4/11.8/14.0/13.6 ms versus 12.9/13.8 ms. All had zero CPU-budget misses and zero
late node builders. The 23.5 ms callback gap is retained, not hidden.

These small, non-replay-equivalent controls do not prove zero observer overhead
or gameplay equivalence. Allocation and worker tracing can change admission
timing and therefore the captured trajectories. No in-game optimization was
installed, so there is **no measured FPS improvement** to claim. A faster worker
answer would also still face main-thread delivery/retry scheduling.

This does not resolve pending-search expiry, friendly-fire acceptance, async
replay/admission semantics, develop integration or independent review of #396.
It remains a draft; #370 remains open. Revisit successful reuse only if new
workloads show actual proof eviction/recomputation or exact continuation overlap.

## Archived tools and validation

The `--proof-reuse` option is available in the investigation commit, **not** the
current tree. Reproduce from a dedicated archived checkout:

```sh
git worktree add --detach /tmp/cod-proof-reuse-repro 0db3faba7da01b0680bdc31c7f3cc59eef97f22a
cd /tmp/cod-proof-reuse-repro
npm ci
npm run build
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --production=1 --paced=1 --realtime=1 --detail=1 \
  --agents=12 --frames=3600 --proof-reuse=1 \
  --port=5474 --out=/tmp/proof-reuse.json
node tools/analyze-proof-reuse.mjs /tmp/proof-reuse.json
```

Use the current repeat-state mode, not `--query-trial=base`; do not combine this
with `--worker-latency`. The observer restores method ownership on cleanup,
checks worker/world/configuration continuity, bounds events/jobs/states, and
retains unreturned work. The profiler's normal failure output applies.
`reuseKernelHash` hashes the shared function source supplied to replay, not every
browser fetch or the whole bundle. The captured source hash is
`5156194dce16fd5dd80f031716b9c4f7e0e7ed4584c915c292e39764ef8d3d7a`.

At the investigation commit, clean install, 96 smoke tests, typecheck, lint,
build and world validation passed.
Synthetic positive controls exercise both whole-proof and genuine tail reuse;
negative controls remove the height/budget guards and produce oracle mismatches.
Capture/cache analysis and idempotent ownership cleanup are tested. A native
unsupported-mode run exited 1 with `reuse capture requires repeat-state mode`,
replacing a seeded stale-success file. The explicit unsupported-mode guard and
analysis/tests/docs were finalized after collection; timed replay logic and
runtime source were unchanged. After archiving the temporary tools and their
own tests, the retained tree passed its original 95 tests, typecheck, lint, build
and world validation; `src/`, `public/`, `tools/` and `tests/` are identical to
`ed8e3e2`. No new independent review is claimed.
