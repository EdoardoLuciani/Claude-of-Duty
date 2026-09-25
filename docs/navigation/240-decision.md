# #240 decision spike: prefer offline Recast + Detour, with a blocking feasibility gate

## Decision

**Select Recast baking + Detour queries as the recommended technical direction. Do
not switch production navigation yet.** Neither evaluated implementation passes
all authored-stair/controller cases. Runtime dependency approval is also still
required. #240 stays open.

The custom multilayer grid is not a small extension of the current grid once
capsule clearance, stairs, floor attachment, smoothing and bounded search are
included. The prototype is substantially larger/slower in data and still admits
routes the soldier cannot execute. Recast gives better results with less query
code, but it is not a drop-in fix for the controller or map clearance.

This PR contains **tools, regressions and measurements only**. No production code,
package manifest, generated world asset or shipped behaviour was changed.

## Reproduction and provenance

```bash
npm ci
node tools/smoke-nav240.mjs

# Optional comparison dependency, outside project manifests/node_modules.
# Explicit install for research only; normal tests/build need no Recast/network.
npm install --prefix /tmp/nav240-recast --no-save --package-lock=false recast-navigation@0.43.1
node --expose-gc tools/nav240/run.mjs \
  --recast /tmp/nav240-recast/node_modules/recast-navigation \
  --recast-cells 0.2,0.1,0.09 --fine-grid --out /tmp/nav240.json
node tools/nav240/summarize.mjs /tmp/nav240.json docs/navigation/240

# No optional dependency:
node tools/nav240/run.mjs --baseline-only --out /tmp/nav240-baseline.json
```

- Baseline checkout: `dafcec6` (current `develop` when the worktree was created).
- Asset source fingerprint: `e664fe94fc90bdd0`. Visual, collision and nav asset
  filenames **match the issue's recorded assets**, despite the source fingerprint
  differing. This does not establish the original telemetry's unknown code revision.
- Collision loaded through GLTFLoader and registered in the real PhysicsSystem:
  327,544 nondegenerate triangles. Manifest validation counts 327,545 cooked triangles.
- Node v22.23.1, AMD Ryzen 9 9950X. Results are local Node timings, not target-browser
  frame-time claims. The tool source hash and exact asset names are in the JSON.
- [Metrics/provenance](240-results.json), [per-case outcomes](240-traversal.csv).
  Full runner output additionally contains paths, final positions, recovery records
  and 5 Hz physical traces; it is intentionally not committed as a multi-MB file.

## What the harness actually exercises

`tools/nav240/harness.mjs` uses production `Agent._goTo`, `_move`,
`_tickNoProgress` and `CharacterController.move`. It omits meshes, animator work,
perception, shooting and behaviour selection. A small request facade implements
candidate queries and the existing two-solves/frame contract; this is **not a
full AiSystem scheduler or playtest**. Fixed goals use the combat/move query path,
not patrol/search's existing pre-projection. Candidate runs deliberately retain
legacy `_unstickDest` grid projection and behaviour-driven recovery; only their
path-query producer is swapped. Sidestep/repath failures therefore also expose
integration gaps, and are not all attributable to a candidate solver. No result
certifies the unreplaced patrol/search/cover call sites.

There are 62 map cases: five recorded positions × eight authored anchors, the
first entrance of each of ten enterable buildings, and ascent/descent of six
first stair flights. Nine synthetic cases cover ground under a roof, upper floor,
wrong-storey goals, a prop-top trap, stairs in both directions, a narrow corner,
disconnected ground and a crouch-only passage.

Every case runs with shipped vanguard capsule settings, and again with the
largest variant and corrected degree-to-radian slope conversion. The sensitivity
run changes **two variables**, so differences cannot be attributed to slope alone.
The prototypes bake a standing profile covering the largest variant: radius
0.36 m, height 1.8245 m, step 0.42 m, slope 48 degrees. They **reject crouch-only
routes**; stance transitions remain implementation work.

Arrival requires a successful query, physical feet within 0.5 m horizontally and
0.18 m vertically of the requested goal, and no emergency snap. X/Z waypoint
exhaustion is not arrival. A run stops at its first recorded emergency snap and
never credits that relocation. Runs last at least 15 seconds when movement remains
active, with a path-length-based upper limit capped at 240 seconds. This matters:
some coarse Recast routes take over 120 simulated seconds to finish. These tests
use geometric floor proximity, not a production persisted surface-ID contract.

The smoke test verifies the harness itself: synthetic valid/invalid traversal,
wrong-storey fake successes at all five map coordinates, actual W5 doorway
movement, the collision jam near enemy 12, and bounded/fair initial request service.
It does **not** assert that current production navigation already passes #240.

## Measurements

Same input collision, repeated byte-identical candidate bakes on this machine.
Decimal MB; query figures include the prototypes' physical endpoint attachment
checks. Five timed queries per case after an input warmup, mixed reachable,
invalid and disconnected goals. Two bake timings, not a bake-time distribution.

| Implementation | Nodes / polygons | Packed MB | Gzip MB | Bake seconds | Query p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
| Committed single-floor grid | 48,841 cells | 0.327 | 0.131 | not rebaked | 0.004 / 0.568 |
| Multilayer grid, 0.4 m | 232,971 nodes | 12.520 | 4.149 | 8.98 / 9.00 | 8.861 / 20.000 |
| Multilayer grid, 0.2 m | 930,257 nodes | 51.029 | 16.773 | 24.63 / 24.97 | 1.996 / 19.215 |
| Recast, 0.2 m | 8,466 polygons | 1.365 | 0.450 | 0.93 / 0.92 | 0.421 / 2.664 |
| Recast, 0.1 m | 19,271 polygons | 3.146 | 1.023 | 9.94 / 9.94 | 0.447 / 2.415 |
| Recast, 0.09 m | 21,251 polygons | 3.485 | 1.136 | 9.66 / 9.74 | 0.353 / 1.836 |

The legacy grid is fast partly because it immediately rejects many required
routes. Lower query latency is not evidence of correct navigation. The fine grid
also rejects more requests; its lower median is not a uniform speed improvement.

The custom grid samples multiple front-facing supports, uses raised-capsule
clearance/sweeps and sampled floor continuity, creates components and runs
Float64/stale-entry-filtered A*. It is a **prototype**, not a proven exact model of
step-offset physics. Its false successful routes demonstrate that limitation.
Its packed data includes points, CSR edges, components and column indexing, but
not a production versioned envelope, cover bake or loader. JS object working sets
remain allocation-heavy: approximately 94 MB / 383 MB retained heap for the two
resolutions, in addition to typed arrays. A production typed-array implementation
could improve that; claiming the measured JS heap is an unavoidable grid cost
would be incorrect. No comparable cold grid-loader benchmark is implemented.

Recast uses stock solo generation and Detour's real imported-bake query API,
not a triangulated mesh queried by our old A*. It preserves small regions to expose
rather than silently erase disconnected surfaces. Radius is rounded **up** to whole
voxels: 0.2/0.1 m configurations bake 0.40 m radius; 0.09 m bakes 0.36 m. Differences
therefore reflect radius quantization as well as resolution. No off-mesh links.

Fresh-process Recast load (no preceding bake): 21–23 ms total for module import,
WASM initialization, disk read, nav import and a 6,000-node query object. Nav/query
creation itself was 1.2–1.9 ms. This excludes browser fetch/decompression and engine
integration. Default WASM linear memory is **64 MiB**, with measured RSS increases
of approximately 20–31 MB. The combined benchmark's larger WASM heap is a bake
high-water mark, not runtime residency. The WASM compatibility module is 1,011,280
bytes / 237,718 gzip, before core JS and the nav asset. These costs require review.

### Work budget

Twelve spatially distinct authored entrance/stair starts, five synchronized
request bursts over 600 frames. All candidates served the initial burst in frames
`0,0,1,1,2,2,3,3,4,4,5,5`, never exceeding two solves/frame. No snap occurred in this
particular workload. Worst measured combined query/movement frame: 11–14 ms for
the multilayer grids, 1.8–2.2 ms for Recast, 1.2 ms for legacy. These mostly short
routes are **not** a worst-case combat workload or proof of long-session fairness.

Keep the two-solves/frame policy. The expensive short controller simulations in
prototype endpoint attachment must become cached/maintained surface attachments,
validated at spawn and on invalidation, not repeated blindly for equivalent goals.
Measure again with production callers before any scheduling change.

The search caps are intentionally bounded, but not identical units: old A* caps
pops, prototype grid A* caps non-stale expansions, and Detour caps node-pool size.
The historical solver concern is real: enemy-12 → anchor-2 performs 6,000 pops,
4,401 with the same node/cost already popped. Float64 scores alone reduce equivalent
repeats to 1,840, but the query still fails at 6,000. No heap-capacity drops occurred
in these probes. This neither explains isolated surfaces nor fixes the controller
jam. Replacing A* avoids investing in a production solver slated for removal.

## Outcome findings and remaining gates

1. **Recorded isolated surfaces:** the original failures reproduce. Both prototypes
   preserve stacked surfaces and floor-specific cover probes. At the same X/Z,
   legacy resolves ground cover to the roof; the candidates give different surface
   references and the appropriate chest/knee obstruction result. This is a cover
   probe, **not** an integrated floor-aware CoverMap implementation.
2. **Enemy 12:** six successful legacy anchor routes stall for 15–59 simulated
   seconds near the recorded position; the seventh exhausts waypoints on the wrong
   floor. Correcting slope units/largest capsule does not remove the jam. Inspection
   near the stalled capsule finds palm-trunk, planter and concrete contacts; it has
   not isolated one causal triangle. Recast rejects these distant routes instead
   of emitting false successes. **Rejection is not an escape or wave-finishability
   fix.** Safe placement and bounded execution/recovery remain necessary.
3. **Enemies 20/45/38:** Recast 0.1 m executes five distant-anchor routes from each
   of 20/45, and four of five from 38 with shipped settings; the fifth from 38 ends
   short. The corrected-profile sensitivity run arrives on that fifth route. Other
   anchors are explicitly invalid under the physical attachment check. Enemy 13
   remains disconnected/invalid, not magically freed by a navmesh.
4. **Resolution matters:** enemy 20 → anchor 0 takes ~113 m with Recast 0.2 m versus
   ~21 m with 0.1 m. Eventual arrival alone cannot approve such detours. At 0.09 m
   more doors/stairs connect, but new execution failures and node-limit outcomes
   appear. No configuration is selected as production tuning yet.
5. **Real stairs are the blocking counterexample:** direct corrected-profile
   controller traversal succeeds up/down W5 and W2, but both grid resolutions and
   the evaluated Recast configurations fail to connect them. Recast 0.09 m passes
   E5 and E1 flights; the grid passes E5. W4/E4 direct probes also fail, so those
   require endpoint/geometry/controller diagnosis rather than blaming the bake.
   Synthetic stair success was insufficient. Do not invent ladder/drop links,
   reduce radius below the real capsule, or add a second spatial authority to hide
   these failures.
6. **API/contract traps:** Detour success may include a partial path. The prototype
   checks the final polygon, node exhaustion and buffer truncation explicitly.
   Production `_move` ignores waypoint Y, local avoidance ignores vertical
   separation, and crouch-only grid flags do not command the controller to crouch.
   These must be addressed together with navigation integration.

## Retain / replace

| Existing code | Decision |
|---|---|
| `tools/export-world.mjs`, cooked collision input, committed hash pipeline | Retain; change only nav bake payload and validation |
| `src/ai/nav.js` single-floor storage, nearest, A*, lineOfWalk/string pull | Replace with one surface query implementation; no dual runtime fallback |
| `src/ai/index.js` budget/outcome boundary | Retain contract; add component/floor identity and limit reasons, measure fairness |
| `Agent._goTo`, patrol/search recovery and #274/#275 behaviour | Retain behaviour, replace ad hoc snapping with common physical endpoints |
| `CoverMap` live threat scoring, claims and squad spacing | Retain scoring; replace generation/indexing/peek reachability with floor-aware data |
| Spawn/patrol, squad wrap, combat cover, retreat and recovery call sites | Integrate the same endpoint/connectivity semantics everywhere |
| `CharacterController` | Retain; align capability units and test actual steps/clearance |
| `_move` and progress/recovery bookkeeping | Revise corridor following, floor-aware arrival/avoidance and bounded execution failure |
| Existing diagnostics, smoke tests and last-enemy assistance | Retain; add integration coverage and explicit recovery records |

## Dependency decision and rollout

Recommended dependency shape, **pending explicit owner approval**:
`@recast-navigation/core` + its WASM dependency at runtime, and
`@recast-navigation/generators` as offline tooling, pinned/reviewed against 0.43.1.
Serve all runtime code/assets locally; never generate nav online or fetch a CDN.
Core/package licenses and WASM delivery/memory need normal human review before a
manifest change. The spike installed nothing into the project manifest.

Offline Recast plus an in-house polygon/portal query implementation would preserve
Three as the sole runtime dependency, but requires maintaining nearest-surface,
corridor search, funneling, height sampling and surface-constrained movement.
That combination was **not implemented or benchmarked** here. It is not a free
way to adopt Recast while avoiding dependency approval; do not slip it in as an
unmeasured third architecture. If runtime dependencies are refused, reopen that
bounded decision explicitly rather than proceeding with Detour anyway.

Focused follow-up sequence:

1. **[#305](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/305): capability
   alignment and authored-stair feasibility gate.** Isolate profile/unit fixes,
   W5/W2 connectivity loss and remaining endpoint failures. Resolve dependency
   approval. This must pass before the runtime replacement is authorized.
2. **[#306](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/306): core bake,
   versioned validation/load, unified endpoints, floor-owned cover and queries.**
   Preserve budgets/outcomes, reject partial paths, commit reproducible assets and
   remove the old production representation at the switch.
3. **[#307](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/307): controller
   execution contract.** Correct-floor arrival, corridor-safe corners/avoidance,
   stance requirements, persistent progress detection and bounded last resort.
4. **[#308](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/308): production
   multi-agent and identifiable live validation.** Compare stranded intervals and
   wave finishability against the latest capture, not hit rate or difficulty.

The spike does not supply a new telemetry platform, full combat replay, production
cover integration, advanced traversal, or a live before/after navigation rollout.
Lost-contact policy, spawn-spacing policy and difficulty remain out of scope.

## Validation of this tools-only PR

Passed: `npm test` (42 smoke tests including the new controller harness),
`npm run build`, `npm run lint`, `npm run world:validate`, and
`node tools/capture.mjs --port=5188 --shot=hero --w=960 --h=540 --settle=15
--out=/tmp/nav240-boot.png`. The boot capture shows the unchanged production game,
not a claim that a prototype was integrated into the browser.

External API references: [Recast JS usage/dependency options](https://github.com/isaac-mason/recast-navigation-js),
[query implementation and partial-path handling](https://github.com/isaac-mason/recast-navigation-js/blob/main/packages/recast-navigation-core/src/nav-mesh-query.ts).
The experiment used installed package version 0.43.1, not a moving checkout.
