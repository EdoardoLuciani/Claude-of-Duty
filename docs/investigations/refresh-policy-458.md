# Refresh policy and redundant shadow dependencies: #458

## Result

**A redundant application shader dependency explains a recoverable part of the
CPU cost.** This is a better-supported next step than application batching or a
GPU-driven ownership rewrite. No runtime optimization or permanent Three patch
is included: the candidate remains an exact-source-guarded offline control.

The measured renderer always chose FULL refresh, but that alone was not a
sufficient explanation. For our generated RGB surface output, Three builds the
surface function to obtain `colorNode.a` for shadows, although the implicit alpha
of that RGB output is one. This registers unnecessary bindings and update nodes
in three cascade passes. A compile-time, app-only specialization removes those
dependencies without changing FULL refresh, draw counts, or material/object
identity. All nine fresh natural-scheduler matched pairs improve CPU render and
callback medians. GPU timestamp pass sums are essentially unchanged.

This follows [the initial CPU submission report](cpu-submission-458.md). Its
binding-loop/affinity results and isolated batching toy remain valid historical
measurements, but are not the justification for this candidate. The user's
objection to recommending batching before explaining the expensive path was
justified. The initial direct-to-indirect command substitution did not test a
proper GPU-driven architecture and does not rule one out. #413 remains unresolved.
No upstream issue/PR has been opened.

## Protocol

- Same baseline: merged dependency PR #460, investigation commit `2e04797`, Three
  source `0978e2b62e53654ebe1a2c3032ebee0a4981c701`.
- Ryzen 9 9950X / RX 9070 XT, native AMD/RDNA4, fallback false; RADV 26.2.4,
  Fedora 44/Linux 7.2.11, Node 24.18.0, full Chrome for Testing 153.0.8010.12.
- Fresh serialized production builds/browser/server, high/DPR1,
  `living-combat-v1`, five soldiers, finite 10,000 HP, no grenades,
  120 warmup + 1,800 measured frames; unpaced, lockstep 60 Hz simulation.
- **27 successful production profiling runs / 48,600 measured frames:** five
  count-only censuses, eighteen throughput runs, two validation runs, two GPU
  diagnostics. These are separate measurement modes, not 27 acceptance runs.
- Three fresh pairs per resolution, order base1/candidate1, candidate2/base2,
  base3/candidate3. Natural scheduling only: no affinity, CPU sampling, counters,
  screenshots, or GPU queries in the eighteen acceptance measurements.
- Async worker admission is not seeded replay. All fixture/activity gates pass;
  median draw visits are 875 in every acceptance run and measured builder count
  is zero. Raw activity/workload counters and tails are retained.
- One initial candidate build failed TypeScript's explicit-parameter requirement.
  It produced no profiling frames; logs are retained separately. The runner
  restored sources and rebuilt production in its `finally` block.

## Actual refresh decisions, not inferred causes

The off-by-default census decorates the pinned observer's **original** conditions
and returns. It preserves predicate order, getter counts, short circuits and
return values; it never reruns `firstInitialization`, `equals`, or the refresh
method to infer a reason. Unit tests cover those semantics and throwing-renderer
stack cleanup. Creation causes are captured before temporary override material
state is restored. Collector failures are recorded without replacing renderer
errors, and fail the report afterward.

The collector is installed before navigation/prewarm. Measured passes wrap
`_renderScene` (including QuadMesh paths), retaining invocation/parent IDs and
nesting. Refresh events record actual camera/scene/context/target identities,
MRT, material/source material, passId, observer, logical object and RenderObject
identities, and material-group ranges. RenderTarget identity uses a WeakMap:
Three RenderTargets do not have the Object3D-style numeric `id`.

Canonical baseline `census-2.json`:

| Measured quantity                         |            Result |
| ----------------------------------------- | ----------------: |
| Refresh decisions / draw visits           |         1,546,605 |
| FULL / SHARED / NONE                      | 1,546,605 / 0 / 0 |
| Logical Object3Ds, frame p50              |               239 |
| RenderObjects, frame p50                  |               750 |
| Draw visits, frame p50                    |               875 |
| `_renderScene` invocations, frame p50     |                24 |
| Static world shadow visits, whole capture |           855,792 |

Static shadow visits average 475.44/frame: about 377.44 instanced and 98 ordinary
mesh visits, across three cascades. They are **55.3% of draw visits**, not 55.3%
of CPU time or unique scene objects. Instanced Object3Ds also represent multiple
instances. Repeated pass/material-group visits must not be called unique objects.
Culling and the offscreen casters required by the shadow frusta are unchanged.

First-match witnesses include `material:colorNode`, `material:aoNode`, animation,
dynamic instancing, and fallback equality changes. If `hasNode` wins, later
initialization/velocity predicates were **not evaluated**, not false. In
particular, the velocity prepass could still require FULL without its earlier
AO-node witness. An observer is shared state, not necessarily one logical object.

## The rejected constant-shadow explanation

Two narrow controls registered the **exact factory default shadow literal** in
a WeakSet. One excluded only that literal from node detection; the second also
excluded inherited `getAO` only for that exact unlit default-shadow case. Other
nodes, animation, dynamic instancing, initialization, velocity, target switching,
and equality checks remained intact.

Both controls left measured decisions, first-match causes, binding visits and
uploads exactly unchanged. Do not interpret this as evidence that bypassing
refresh is universally ineffective. The dominant operative shadow color graph
was **not the registered default literal**. The enhanced creation snapshot finds
203 derived source-color graphs among 207 shadow observers with source metadata;
these are build-observer counts, not draw/time shares. The compiled first witness
`material:colorNode` did not by itself establish constantness.

## Source-backed dependency chain

At this pin:

1. `Renderer._getShadowNodes` (`src/renderers/common/Renderer.js:3749–3846`)
   treats a source `colorNode` as an alpha dependency even for opaque materials.
   It multiplies shadow alpha by `material.colorNode.a`, then temporarily uses
   that derived graph on the shadow override material.
2. `src/materials/shader-tsl.ts:47–54,631–638` declares separate `color: vec3`
   and `opacity: float` outputs. Our color member belongs to the function that
   returns color, opacity, normal, roughness, metalness and AO together.
3. `MemberNode.generate` builds the underlying struct before selecting a member.
   `SplitNode.generate` builds the input, expanding RGB to RGBA for `.a`.
   `NodeBuilder.format` supplies the fourth component as **one**.
4. Consequently, obtaining that implicit alpha builds/registers the surface
   graph in shadows even though its RGB result cannot affect that alpha.
   `NodeMaterialObserver.containsNode` conservatively marks the derived graph
   dynamic, so every visited shadow RenderObject takes FULL binding maintenance.

This is app-specific knowledge of a known generated function, **not** a general
rule that arbitrary opaque/vec3 functions are pure. Such functions can discard,
write storage, run callbacks, or have other required effects. Registration also
is not proof that all surface arithmetic executes on the GPU: a native compiler
can eliminate unused calculations while Three still maintains declared resources.

## App-only control: `shadow-color`

Only the offline source transform changes `createSurfaceNodeMaterial`:

- Capture a conservative construction-time eligibility decision for ordinary
  world-space, non-masked surfaces. Exclude alpha/map/transmission/custom graph
  behaviors; accept the application's known ordinary uniform control inputs.
- For eligible materials, wrap the original color member in a zero-input TSL
  `Fn`, with explicit vec3 output. A **JavaScript build-time** branch returns
  `vec3(0)` when `builder.material.isShadowPassMaterial` is true; otherwise it
  returns the original member. No layout, `.once()`, TSL `If` or `select`.
- Keep the original member in the closure, not a function input that could build
  eagerly. The unchosen branch is not built. The source material object is not
  replaced; prewarm uses the real specialized graph from boot.
- Do not alter Three's observer, buffer ownership, traversal, culling, batching,
  or indirect commands. Derived shadow `colorNode` still exists and still causes
  FULL: the earlier exact-default-literal controls do not match this wrapper.

CPU-only builder tests exercise shadow-first and beauty-first expansion/cache
order, graph/material stability, masked/local/custom/RGBA-replacement/map/control
negatives. Eligibility is fixed at construction, not toggled on a warmed graph.
This control is scoped to the pinned generator and its current caller, which
constructs ordinary uniform inputs. `isUniformNode` alone is **not** a universal
purity guarantee for arbitrary callbacks/subclasses; a shipping change still
needs deliberate supported-input and eligibility review.

### What disappeared

Two representative static material cohorts were inspected in all three roles:

| Role                   | Mesh bindings | Instanced bindings | Update nodes (both) |
| ---------------------- | ------------: | -----------------: | ------------------: |
| Velocity/depth prepass |       14 → 14 |            16 → 16 |             13 → 13 |
| Shadow                 |    **16 → 4** |         **17 → 5** |          **11 → 9** |
| Beauty                 |       34 → 34 |            35 → 35 |             76 → 76 |

Beauty and prepass vertex **and** fragment WGSL are byte-identical for these
representatives. Shadow fragment source shrinks from 24,445 → 1,493 bytes (mesh)
and 18,771 → 1,576 bytes (instanced). Binding names, uniform names, update types
and complete WGSL are preserved in the census/specimen files and `shaders/`.
These are source/layout facts, not GPU execution-time estimates.

Across the whole capture, the same 38 static source materials account for the
same 855,792 shadow visits. Exactly twelve binding entries disappear per static
shadow visit. Means per measured frame:

| Counter                                       |      Base |    Candidate |
| --------------------------------------------- | --------: | -----------: |
| FULL refresh decisions                        |   859.225 |      859.225 |
| `_update` binding-group visits                |  1,951.77 |     1,951.77 |
| `_update` binding-entry visits / scope checks | 14,269.92 | **8,564.64** |
| `writeBuffer` calls                           |    571.57 |       565.55 |
| `writeBuffer` bytes                           | 1,254,736 |    1,251,628 |

Binding/scope checks fall **40.0%**, whereas mean uploaded bytes fall only ~0.25%.
The issue is not simply upload bandwidth. Counters are non-overlapping method
invocation totals within measured render-object execution scopes; compute work
executed inside those scopes can be charged to its enclosing object. Shared-path
binding-loop visits are not represented by `_update`; here every decision is FULL.
Counters and shader exports are invasive diagnostics, never throughput runs.

## Fresh natural-scheduler acceptance

Each cell below is an individual run's p50 in milliseconds, not pooled frames.

| Resolution | Base render p50s | Candidate render p50s | Median render | Median callback |
| ---------- | ---------------- | --------------------- | ------------- | --------------- |
| 640×360    | 5.3, 5.3, 5.4    | 4.7, 4.6, 4.6         | **5.3 → 4.6** | **7.1 → 6.4**   |
| 1280×720   | 5.7, 5.8, 5.7    | 5.1, 5.1, 5.2         | **5.7 → 5.1** | **7.8 → 7.1**   |
| 1920×1080  | 6.3, 6.4, 6.4    | 5.5, 5.5, 5.5         | **6.4 → 5.5** | **8.8 → 7.9**   |

All nine matched pairs improve both medians. Median-of-run-median CPU render
reductions are 13.2%, 10.5%, 14.1%; callback reductions 9.9%, 9.0%, 10.2%.
Gameplay medians are 1.1 → 1.1, 1.2 → 1.2, 1.4 → 1.3 ms respectively. This is a
repeatable local fixture result, not a cross-hardware FPS or input-latency claim.
Synchronous render duration includes driver/submission work and is not GPU time.

Separate 720p GPU diagnostics: timestamp pass-sum p50 **2.963 → 2.955 ms**, with
600/599 samples. That does not establish a material GPU-time gain. It is not a
complete GPU frame and excludes copies/waits/presentation. Do not combine it
with synchronous CPU durations. No new CDP sampling profile was taken here.

## Validation and remaining boundary

- Clean `npm ci`; 132 smoke tests; typecheck/lint/build/format and diff checks.
- Pristine and candidate native buffer-name/isolation and resource readback suites.
- Both conditions: startup/prewarm low/high/ultra, all seven weapons and first-use
  handling, five canonical render suites, strict arms/material audit.
- Fresh high-quality hero captures: **zero changed RGB pixels, max delta zero**.
- Profiler failure tests retain original errors, partial reports/`summary: null`,
  cleanup, and bounded stalled-GPU drain behavior.
- All guarded sources, including application shader source, are restored; the
  production build is rebuilt pristine. No application source is changed in this PR.

These checks do not constitute exhaustive dynamic-shadow/depth equivalence for
arbitrary surface functions or future material behavior. A single hero image is
not an oracle for every cascade, moving light, alpha case or disposal/rebuild.
Before shipping, review the narrow input contract and keep corresponding
shadow/cascade/versioning and negative coverage. A further refresh-policy control
must be separately justified for the exact active graph; do not relax a literal
identity guard just to manufacture SHARED/NONE counts.

A genuine GPU-driven path remains a different architecture: persistent per-object
GPU data and GPU visibility/arguments must avoid CPU per-object maintenance.
This experiment does not implement or reject that design. It shows that a small
integration-level dependency correction should precede such ownership changes.

## Reproduce and evidence

```sh
# Run ONLY in a disposable, dedicated worktree; never concurrently.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=refresh-census --id=census --out=/tmp/458-refresh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=shadow-color-census --id=pruned-census --out=/tmp/458-refresh
# Separate uninstrumented conditions, fresh alternating pairs at each resolution:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=shadow-color --id=candidate --out=/tmp/458-refresh --w=1280 --h=720
# Correctness/capture is separate from the eighteen acceptance measurements:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=shadow-color --id=validation --out=/tmp/458-refresh --validate=1 --capture=1
```

`--refresh=1` on the profiler requires matching instrumented native sources; use
the trial runner rather than manually editing dependencies. Missing creation or
pass metadata, collector errors, frame gaps, or draw-count reconciliation failures
reject the diagnostic. It cannot be combined with CDP/GPU/detail timing modes.
After a forced stop, recover only in the disposable worktree: verify original
sources against the recorded baseline, restore mutated tracked shader/material
files without overwriting unrelated changes, reinstall dependencies, invalidate
Vite cache, and rebuild production. Source-only restoration is insufficient.

[Evidence archive](issue-458-refresh/captures.tar.gz): JSON, manifests with source/
build hashes, chronological run order, activity/tails, logs, failed-build logs,
PNG pair, WGSL specimens, exact candidate diff/source, summary/reproducer, oracle
source reviews and Three license. `census-1` predates the enhanced provenance/
shader collector; `census-2` is the canonical baseline. Advisory reviews are not
measurements or proof of a general upstream bug.

Archive SHA-256: `edd4c838662d28ac7015ec1cb34852c452c986d9bf8f70b65c619c0b04fcf956`.
