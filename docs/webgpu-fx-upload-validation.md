# FX upload lifetime validation; bone upload-only control

Follows the [remaining-upload audit](webgpu-remaining-upload-audit.md).
Reference: `f40bc36` (production behavior `d7f43f9`). Only FX usage changes ship.

## FX change

`ParticleLayer.ibuf` and the four decal attributes use public `StreamDrawUsage`
instead of `DynamicDrawUsage`. Births/projections still publish dirty ranges and
increment versions in `flush()`. Shader motion/fade/expiry and capacities are
unchanged. Pinned native Three uploads dynamic attributes even without a version
change; with consumed ranges that means copying the full event-data array again.
The small usage correction removes that quiet-frame behavior without a Three
patch, custom rendering path, shader change or production diagnostic setting.

The preceding exact short upload audit measured **1.365 → 0.510 MB/frame**, about
**854 KB/frame less (~62.6%)**, but only about six fewer calls. These counts and
the following timing samples have different windows; do not combine them into a
per-call causal budget.

## Whole-app timings

RX 9070 XT only; actual native device `amd / rdna-4 / isFallbackAdapter:false`,
Chrome 153/Vulkan, 960×540/DPR1/high, seeded move/turn/firefight. Three **600/60**
plain pairs (540 measured intervals each), second pair reverses order. Only the
FX usage changes: the before boot route restores `DynamicDrawUsage` in the two
FX modules. No deep upload snapshots or GPU timestamp queries in these pairs.

| Pair | Before mean / p95 / p99 ms | After mean / p95 / p99 ms |
|---|---|---|
| 1 | 10.411 / 13.7 / 15.1 | 10.658 / 13.7 / 25.3 |
| 2, reversed | 10.863 / 13.3 / 14.6 | 9.872 / 12.7 / 14.5 |
| 3 | 10.557 / 13.2 / 14.4 | 10.346 / 12.8 / 14.2 |

Mean across pairs **10.610 → 10.292 ms (~3.0% lower)**, but one pair worsens and
the first after p99 is worse. **Mixed small timing evidence, not a reliable FPS
milestone.** Zero measured late builders/errors. These shorter samples cover a
different part of the script from earlier 900/60 measurements; neither their
absolute times nor the historical WebGL reference establish migration acceptance.
No isolated GPU kernel gain, fixed-clock comparison or cold-start improvement is
claimed. Most remaining writes/traversal/binding checks are unaffected.

## Correctness and lifetime

- `tools/fx-webgpu/run.mjs`, `FX_GPU=dgpu`: additive/lit/anchored/soft-depth,
  decal projection/expiry, haze warp/expiry, casings and matrix projection pass.
  The actual renderer device adapter is now checked, not a separate adapter
  request. The new GPU lifetime probe checks byte-exact CPU/GPU event arrays,
  fixed-time quiet-image equality, zero quiet/expiry uploads, accumulated hidden
  writes, both rings wrapping, rebirth after expiry, odd resize and fresh owners.
- Negative `FX_CONTROL=unversioned`: removes the particle version publication
  through a test-only route. It fails **`versioned FX GPU attribute disagrees
  with CPU data`**, rather than merely checking a usage constant.
- New standalone smoke checks explicit stream usage, immutable quiet/expired
  versions, every birth publication, accumulated dirty ranges, wrap draw ranges,
  disposal and fresh owners.
- Seven high gameplay shots (hero/interior/night/combat/ADS/weapon/muzzle):
  **HDR, weapon target, all prepass MRT attachments, raw and filtered AO hashes
  are exact** against the before route. Full buffers are hashed browser-side;
  the result transports hashes, not complete HDR buffers.
- Final temporal output is **not exact in all seven shots**. A separate
  before/before repeat also differs in final output in both checked shots
  (hero/combat), with current buffers exact. This identifies a nonrepeatable
  temporal fixture, **not proof that every after difference is harmless**.
  Exact final-history acceptance remains open; no committed visual assertion
  was weakened. The temporary checker reports final differences separately.
- Smoke suite, lint, Vite build and fresh standard native hero capture pass.
  No authored world/prop assets changed.

### Drawbacks / maintenance obligations

`StreamDrawUsage` is version-gated on this pinned native backend. Future direct
CPU array mutations must publish `needsUpdate`/dirty ranges: they can no longer
rely on an unconditional dynamic upload to hide a missing publication. Existing
birth/flush paths and the negative control cover that obligation. Dirty spans
can still become broad when wrapping or batching many births; the change does
not remove those legitimate uploads or CPU work. Keep complete graphics/lifecycle
checks when upgrading Three. The byte reduction does not guarantee higher FPS.

## Bone data: no production change

Native `NodeMaterial.setupPosition()` invokes `skinning(object)` internally;
its current/previous reference buffers do not expose a material palette-group
hook. A small safe public per-skeleton group adjustment is therefore **not
available in the current path**. Replacing the skinning/vertex path would need
explicit normals/tangents, bind transforms, previous bones/velocity, ownership,
shadow/prepass and weapon handling. That is outside this easy-fix increment.

A **private diagnostic-only upload control**, never committed into runtime,
compares exact palette bytes per binding per game frame and skips only a repeated
upload into that same binding. The matching control does the same comparison and
snapshot work but retains the upload. Current/previous data stay separate, and
changed bytes are never skipped. This still leaves native traversal, node updates
and binding checks; its comparison/allocations perturb timings. It is an
**upload-only experiment, not an upper bound on a complete palette redesign**.

Short 120/60 separate instrumented counts, after the FX fix:

| Per frame | Matched control | Exact repeated-upload skip |
|---|---:|---:|
| Queue writes | 1,880.72 | 1,736.72 |
| Bytes | 492,355 | 261,955 |
| Framework draws | 952.73 | 952.73 |

That avoids **144 calls / 230,400 bytes/frame**, corresponding to repeated
material slots in the three shadow cascades. Different GPU targets still need
their own first upload. The earlier ~399 KB same-source repetition is not all
removable by this same-target control.

Two short plain **360/60** matched-control pairs:

| Pair | Control mean / p95 / p99 ms | Skip mean / p95 / p99 ms |
|---|---|---|
| 1 | 9.419 / 12.2 / 31.9 | 9.564 / 13.7 / 15.3 |
| 2, reversed | 9.217 / 11.0 / 12.8 | 9.056 / 10.9 / 12.7 |

Average **9.318 → 9.310 ms: effectively tied**, mixed pair directions, zero late
builders/errors. No established whole-app gain, complete image/animation gate
or production-safe implementation. No bone fix is shipped. Revisit a proper
per-skeleton/frame owner only if a scoped design justifies the extra complexity;
this experiment does not justify replacing native skinning now.

Temporary artifacts: `/tmp/cod-fx-speed-{before,after}-{1,2,3}{,-raw}.json`,
`/tmp/cod-fx-lifetime-final/`, `/tmp/cod-fx-lifetime-negative.log`,
`/tmp/cod-fx-parity-high.json`, `/tmp/cod-fx-parity-repeat.json`,
`/tmp/cod-bone-count-{control,dedup}{,-raw}.json`, and
`/tmp/cod-bone-speed-{control,dedup}-{1,2}{,-raw}.json`.
PR #316 remains draft; legacy parity, cold-start responsiveness, temporal
precision and the other migration gates remain open.
