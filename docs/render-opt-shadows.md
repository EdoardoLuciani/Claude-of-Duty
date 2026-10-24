# Authored small-clutter shadow policy

## Scope

Implementation commit: `ade1769cc5e18481e63ad323ec62db9e23f511ab`, based on
`022459670c90deb4d2739d06561d6aef07d5bcd4`. Subsequent documentation does not
change the measured runtime or world source.

Disable cast shadows in the authored prototype options for `brick_a`, `brick_b`,
`plank_a`, `plank_b`, `slab_shard`, `rock_a` and `conduit_box`. The latter is
registered in `tools/worldgen/dressing.js`; its single policy field is an approved
extension of the original `props.js` ownership. No runtime mesh-name matching,
geometry edits, collision simplification, receive-shadow/prepass changes or actor
changes are included. Larger cover remains a caster.

`npm run world` regenerated the visual asset and source provenance. Comparison
against the exact clean control proves:

- Only **26 visual-node `castShadow` booleans** differ in the decompressed GLB
  JSON. Every other JSON field and the entire visual binary chunk are identical.
- Collision gzip bytes are identical, SHA256
  `4b294863a3f231707b8d4b0c278568cdbe9db7742ffc985fc28f77341015cc3c`.
- All **8,897,464 navigation topology/component/cover payload bytes** are identical,
  SHA256 `bbf10f69d8dedfa3b048fa8f11b2b0e680df8f8f3775459fdd89eb90e08b0500`.
  Only the envelope's source hash and checksums change. All other manifest fields
  are identical apart from the visual/nav filenames and navigation checksum.
- Static/instance-expanded beauty geometry remains **620,328 / 1,065,436
  triangles**, **7,797 instances**, **174 asset batches**, **329,738 collision
  triangles**, **49,334 navigation polygons**.

## Matched performance measurements

Three fresh clean-control and three fresh candidate browsers, interleaved
control-1, candidate-1, candidate-2, control-2, control-3, candidate-3. One global
validation flock covers the entire batch and every browser/server lifecycle.
Both checkouts were clean; candidate was exactly `ade1769`, control exactly
`0224596`. No old audit timings are reused.

Settings: RX 9070 XT, explicit `MESA_VK_DEVICE_SELECT=1002:7550!`, verified native
AMD RDNA-4/nonfallback WebGPU, full Chromium 153 (Playwright chromium-1243), High,
1280×720, DPR/render scale 1, 120 warmup + **1,800 measured frames**, five-agent
`living-combat-v1`, fixed 60 Hz simulation, unpaced headless scheduling. Primary
CPU runs have **GPU timestamps disabled**, no sampling profiler or detail hooks.

Each cell below is p50 / p95 / p99 / max in milliseconds. These are per-run
percentiles, not pooled samples.

| Run | Control CPU render submission | Candidate CPU render submission | Control CPU step       | Candidate CPU step     |
| --- | ----------------------------- | ------------------------------- | ---------------------- | ---------------------- |
| 1   | 4.4 / 5.5 / 6.2 / 7.6         | 3.8 / 4.6 / 5.2 / 6.7           | 5.7 / 7.4 / 8.9 / 9.9  | 5.0 / 6.3 / 8.1 / 9.2  |
| 2   | 4.4 / 5.5 / 6.1 / 7.9         | 3.9 / 4.9 / 5.8 / 6.5           | 5.6 / 7.3 / 8.8 / 10.1 | 5.2 / 6.8 / 8.6 / 10.8 |
| 3   | 4.2 / 5.4 / 6.2 / 7.7         | 3.9 / 4.9 / 5.6 / 8.1           | 5.5 / 7.3 / 9.0 / 10.5 | 5.2 / 6.7 / 8.6 / 10.4 |

Mean native frame draws: controls **638.752 / 638.736 / 638.752**, candidates
**568.167 / 568.167 / 568.167**. About **70.58 fewer draws, 11.05%**, consistently.
Median run render-submit p50 is **4.4 → 3.9 ms** and CPU-step p50 **5.6 → 5.2 ms**.
Candidate maxima are not uniformly better. These are CPU submission/step wall
times, **not demonstrated display FPS, complete GPU frame time or input latency**.
No GPU-timestamp diagnostic was used to infer a GPU speedup.

All six primary runs have zero console/page errors, late node builders, hitches
and 16.667 ms CPU-budget misses. Each includes 433 enemy shots, 50 player shots,
four completed reloads, four switches and about 112.8 m movement. Incoming damage
is approximately 2,887.4; asynchronous worker execution is not asserted to be
an exact deterministic replay.

Separate static diagnostics count actual native `info.update` submissions, not
asset triangles multiplied by guessed pass counts. In the sunlit conduit view:
low-sun **733 → 662 draws**, **7,595,744 → 7,472,856 submitted triangles**;
night flashlight **810 → 732 draws**, **8,569,218 → 8,433,102 triangles**.
Those triangles include all actual pass consumers, not just beauty; beauty
geometry itself is byte-identical. Diagnostics are separate from primary timing.

## Before/after visual review

Native final-output captures use the same hardware/High/1280×720 settings and
source-authoritative assets. Seven real prototype instances are checked by
instance index and an unobstructed camera ray, then photographed at 18:30 low sun
and 01:30 with the player flashlight on. Ground clutter is viewed at a 1.7 m eye
height; the elevated wall conduit additionally has a close facade-height view.
Thirty moving-camera frames plus endpoint captures cover brick clutter in both
lighting modes. Fixed poses, native counts, warnings and errors are retained.

Reviewed all seven paired contact sheets and both additional sunlit sheets:

- Ground clutter remains present with the same outlines, surface detail, masks
  and AO/received shading. Planks, bricks, rocks and shards deliberately lose
  small cast shadows under the flashlight. They read slightly flatter, especially
  at contact edges; geometry, depth occlusion and material identity are retained.
- The sunlit conduit loses its clear wall shadow. This is visible intentional
  quality loss, not pixel parity. Its silhouette and highlight remain readable.
- Concrete barriers, sandbags, barrels, crates and architectural shadows remain
  coherent in the same views; the flashlight still shadows larger cover.
- The seven central street low-sun captures are pixel-identical because those
  subjects lie in architectural shade. Additional ray-verified sunlit brick and
  conduit locations avoid using shaded ground alone as the sunlight review.
- Preliminary captures included occluded subjects (notably a conduit behind an
  awning), so they are **not** the acceptance images. The `*-visible` and
  `*-sunlit` sets replace them; preliminary files remain for traceability.

All capture sets report zero page/console/GPU validation/WGSL errors. General
Three.js inline-Fn/deprecated-material and zero-range warmup warnings are recorded
separately, identically on control and candidate. An initial evidence-only harness
incorrectly classified general TSL warnings as errors; its failure log is retained
and the classification was corrected to match `docs/profiling.md`.

**Shared diagnostic limitation:** the seven-subject and supplemental sunlit
capture sequences observe six node builders on their first low-sun-to-night
transition, identically on control and candidate: RenderPipeline,
vertical/horizontal AO bilateral RTT, GTAO, bloom high-pass and bloom composite.
The count then stays at six cumulatively. All six living-combat runs observe
zero. These day/night sequences are not a claim of universal prewarm coverage;
no gate or runtime code was changed to suppress their builders.

## Validation and evidence

Passed: clean `npm ci`; `npm test` (**155/155**); `npm run build` (including
`typecheck`, `lint`, asset generation checks and world validation);
`npm run format:check`; `npm run world -- --check`; `git diff --check`.

New `smoke-world-clutter-shadows.mjs` checks authored and committed policies,
critical retained casters, received shadows/prepass, prototype geometry identity,
LOD, instance transforms/masks and unchanged cooked collision/navigation geometry
when the shadow flag is toggled. The existing surface-navigation test keeps its
whole-envelope golden and every physical traversal gate, updates the envelope
hash for the reviewed provenance-only regeneration, and adds the unchanged
physical-payload size/hash assertion. The initial old-envelope failure was not
bypassed; the supervisor independently confirmed the payload before approving
this narrow golden refresh, and all recorded outcomes passed afterward.

Local durable evidence: `/home/edoardo/Documents/render-optimization-lab/shadows/`.

- `install.log`, `tests.log`, `build.log`, `format.log`, `world.log`,
  `world-check.log`, `final-checks.log`.
- `asset-comparison.json`, `compare-assets.py`, `parent-asset-verification.json`.
- `control-{1,2,3}.json/.log`, `candidate-{1,2,3}.json/.log`,
  `measurement-order.log`, `measure.sh`.
- `before-visible/`, `after-visible/`, `visible-poses.json`,
  `capture-visible.mjs`, paired `review-visible-*.jpg`.
- `before-sunlit/`, `after-sunlit/`, `sunlit-poses.json`,
  `capture-sunlit.mjs`, paired `review-sunlit-*.jpg`.

The props lane is approved to stack on stable `ade1769`; its later generated
worlds must preserve these flags and physical payload. This branch does not
include the props geometry change. Independent review and final readiness remain
with the supervisor; no merge is authorized.
