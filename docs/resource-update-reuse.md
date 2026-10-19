# Resource reuse and update frequency: measured findings and clean design

## Conclusion

The general solution is to separate **source-data updates, GPU-resource residency,
and draw preparation**. A render item is not the owner of every resource it uses.
Use versioned, shared resources for reusable data; cache only computations with
known dependencies; batch genuinely changing object uniforms into uniform-buffer
pages. Do not replace the full refresh path with a once-per-object/frame check.

This requires renderer-level work for the built-in skinning and object-uniform
paths. The pinned Three.js public APIs do not expose a switch that makes those
paths share their backing buffers or pool their uploads. Under the project's
no-internals-patching constraint, pursue this upstream, not through a game-side
renderer shim, custom replacement skinning shader, or another shadow proxy.

There are smaller application-owned opportunities: correct FX attribute update
policy and correctly scope application uniforms. Neither is the systemic fix.
No optimization, Three.js modification, dependency change, or quality change was
implemented for this investigation. This document reports observations and a
design recommendation, not a measured speedup or an approved implementation.

## Measurement and boundaries

- Application: `5a6608bb968797bf4053bd38fe233037f921f64f`, production High,
  1920×1080, DPR 1, uncapped, `living-combat-v1`, 5 or 12 living enemies.
- Three.js pin: `0978e2b62e53654ebe1a2c3032ebee0a4981c701`. Relevant source files
  match the earlier API/native attribution baseline byte-for-byte. The application
  base is newer; earlier native CPU milliseconds are not new-base benchmarks.
- Official temporary Chrome Beta 153.0.8010.12, hardware AMD RDNA-4,
  nonfallback WebGPU; same browser used for matching-symbol native attribution.
- Two complete 900-frame captures per population, each after 120 warmup frames:
  **3,600 measured frames**, no page errors, zero late node-builder builds.
  Both captures per population produced identical upload counts and byte totals.
- Temporary diagnostics snapshot the actual bytes passed to public
  `GPUQueue.writeBuffer`, associate sources with scene-owned resources, and use
  public object render callbacks for draw attribution. No internal update method
  was replaced. Existing callbacks are retained and restored.
- Comparisons are exact destination-range comparisons, invalidated by overlapping
  writes and submitted encoder writes. STORAGE destinations and
  SharedArrayBuffer sources are excluded from redundant-upload eligibility.
  Equal source data sent to a different GPU destination is counted separately.
- Byte snapshots and matrix comparisons add substantial CPU work. **These are
  counts, not performance timings.** No FPS gain follows from their percentages.
- Headless page compositing is software despite hardware WebGPU; whole-browser
  desktop performance remains outside the established evidence.

## 1. What is actually repeated?

Per application frame; means over each 900-frame cycle:

| Observation                                                      | 5 enemies | 12 enemies |
| ---------------------------------------------------------------- | --------: | ---------: |
| All `writeBuffer` calls                                          |    758.72 |   1,523.65 |
| All uploaded bytes                                               | 1,359,204 |  1,796,705 |
| Identical writes to an already populated destination range       |    127.37 |     293.98 |
| Of those, same frame and before the next submit                  |   **120** |    **288** |
| Identical source bytes additionally written to a new destination |    138.39 |     323.13 |
| Packed object-uniform writes                                     |    404.27 |     802.58 |
| Packed object-uniform bytes                                      |    26,399 |     57,512 |
| Same-frame identical packed object-uniform writes                |     **0** |      **0** |
| Current-pose bone writes, including first-person meshes          |    225.58 |     532.78 |
| Previous-pose bone writes                                        |     40.29 |      99.39 |

The 120/288 before-submit duplicates are current-pose bone uploads: **192,000 /
460,800 bytes per frame**. Their CPU arrays, destination, range, and bytes match.

Packed object uniforms are different. Their existing change detection already
prevents nearly all unchanged uploads: there are zero same-frame duplicates and
only 0 / 0.12 identical writes per frame across frames in these runs. They still
incur traversal, value reads, comparisons, and packing; and the genuinely changing
small ranges still generate many separate API calls. A global unchanged-byte
filter would mostly miss this part of the problem.

Equal data going to another destination is **not** an upload that can simply be
omitted. That destination needs initialized data unless the binding is changed to
reference an existing compatible resource. The counts above are not additive
savings: source-sharing and same-destination suppression interact.

### Repeated transform inputs

The second capture also snapshots `matrixWorld`, camera `matrixWorldInverse`, and
camera `projectionMatrix` after the original `onBeforeRender` callback. Comparison
is per scene/object/camera within a frame:

| Scene-owned draw callbacks           | 5 enemies | 12 enemies |
| ------------------------------------ | --------: | ---------: |
| Callbacks per frame                  |    903.36 |   1,210.58 |
| Repeated identical matrix-input sets |    274.37 |     553.96 |
| New/changed matrix-input sets        |    628.99 |     656.62 |

A fully visible soldier has **45 callbacks but four matrix-input sets**: the main
view and three shadow views. Built-in high-precision model-view/normal nodes use
object-frequency callbacks, so repeated material groups can recompute the same
pure matrix functions. This is a concrete reuse opportunity beyond upload bytes.

These are input opportunities, not counts of matrix multiplications, nor proof
that all callback work is redundant. Material values, node context, custom
callbacks, and other resources can differ with identical matrices. Fullscreen
objects internal to postprocessing are not included in the scene callback census.

## 2. Source-level mechanism

Paths below are relative to `node_modules/three/src/` at the pinned commit.

1. `materials/nodes/manager/NodeMaterialObserver.js`: node materials, animation,
   and velocity take the FULL path before the static-object shortcut. Static
   transforms do not establish static shader inputs or a reusable whole draw.
2. `renderers/common/Renderer.js`, `_renderObjectDirect()`: FULL runs node,
   geometry, and binding updates. Draw grouping therefore multiplies preparation.
3. `nodes/core/NodeFrame.js`: OBJECT-frequency `updateNode()` invokes the update
   for every call. It does not mean once per `Object3D` per animation frame.
4. `nodes/accessors/ModelNode.js`: high-precision model-view and normal-view
   uniforms perform matrix calculations in object-update callbacks. Keep this
   precision and calculation order; moving the work into the vertex shader is
   not automatically numerically equivalent.
5. `renderers/common/nodes/NodeBuilderState.js` and `BindGroup.js`: nonshared
   binding groups clone their bindings for render objects. A cloned raw buffer
   binding can still point at the same source node/CPU array while owning a
   different backend buffer. A reference node may also change its resolved array;
   caching by node identity alone is therefore incorrect.
6. `nodes/accessors/Skinning.js`: pose calculation already has skeleton-level
   frame deduplication. Small poses use `referenceBuffer()`; current and previous
   poses have distinct uses. Recomputing the skeleton is not the observed problem.
7. `renderers/common/nodes/NodeUniformBuffer.js` inherits `Buffer.update()`, which
   returns true. This raw/reference-buffer path has no equivalent of the packed
   `UniformsGroup.update()` unchanged-value check.
8. `renderers/common/Bindings.js`, `nodes/NodeManager.js`, and
   `webgpu/utils/WebGPUBindingUtils.js`: object-group traversal reaches that update
   and issues `writeBuffer()`, including full raw bone-buffer writes.

Consequently, a fully visible soldier's current pose can be uploaded 45 times to
21 destinations: three shadow destinations each receive nine identical writes;
the other 18 receive one each. There are two problems: repeated updates of one
resource and multiple resources representing one immutable pose. Fixing only the
first leaves the second.

Geometry attributes already demonstrate a better resource model:
`Attributes.js` tracks attribute version and allocation generation, while storage
bindings use that identity/version information. Reuse that model where possible
for uniform backing; do not introduce an unrelated game-specific cache system.

## 3. Correct reuse scopes

| Data / computation                                          | Correct owner and invalidation scope                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Simulation time / truly global application fields           | Published frame state; no object dependency                                                                   |
| View, projection, shadow cascade, viewport-dependent fields | Actual view/render context and its revisions; not just camera identity                                        |
| Object world transform                                      | Object and transform revision; account for callbacks/mid-frame mutation                                       |
| High-precision model-view / normal-view                     | Object-transform and view dependencies; normal/precision mode too                                             |
| Material controls                                           | Actual owning material/resource and value revision; `material.version` alone does not track uniform mutations |
| Current bones                                               | Skeleton/pose producer and published pose revision, independent of camera/material group                      |
| Previous bones                                              | Separate historical-pose publication, retaining velocity semantics                                            |
| Geometry / instance data                                    | Attribute identity, version, byte range, usage, and allocation generation                                     |
| Arbitrary object-update callback                            | Keep per-draw semantics unless explicitly declared dependency-safe                                            |

A frame ID is a scheduling hint, not a data version. The same object or camera can
change twice in a frame, and unchanged data can persist across many frames. Mutable
TypedArrays do not publish revisions automatically; legacy unversioned buffers
must retain conservative behavior unless their producer adopts an explicit dirty
contract. Camera identity, source-array identity, and shader/material version are
not sufficient standalone cache keys.

## 4. Recommended renderer solution

### A. Versioned resources, independent of render items

Represent a CPU-published buffer resource by its owning producer, semantic role,
resolved byte range, layout/usage compatibility, and content revision. Bindings
reference its GPU backing rather than owning duplicate copies because they
belong to different render items. Track uploaded revisions **per destination
allocation and allocation generation**, not just per source or frame.

For skinning, the existing once-per-pose producer should publish a revision;
material groups, prepass, beauty, and shadow views should reference the same
compatible current-pose resource. Keep historical pose state correct. The same
resource abstraction should handle instance/reference buffers, not contain an
`if soldier` optimization. First use, resizing, device loss/recreation, source
replacement, disposal, and borrowed-resource lifetime must remain correct.

Sharing GPU backing does not require sharing whole bind groups with incompatible
layouts. Do not share by TypedArray identity alone, and do not add CPU byte scans
to every draw as the permanent solution. Explicit producer versions avoid that
work; unversioned user inputs still need the conservative fallback.

### B. Dependency-aware preparation, preserving custom callbacks

Cache known-pure built-in computations at their actual scope: object transforms,
object/view matrix results, published material/global records, and pose resources.
Reuse their prepared records across material groups and compatible passes. Do
not suppress arbitrary `onObjectUpdate` callbacks: they can legally return a
material-dependent value on the same object/camera/frame.

Geometry readiness must be checked independently of whether a uniform record is
unchanged. New attributes, newly visible objects, and allocation-generation
changes must not be starved by an unrelated uniform-refresh shortcut. This is
not a request to disable validation or blindly change FULL to SHARED.

### C. Pool and batch the genuinely changing uniforms

The 404/803 packed object writes still need a solution after unchanged uploads
are removed. Pack compatible records into renderer-owned uniform-buffer pages,
upload populated spans in batches, and bind the corresponding ranges for draws.
Keep existing shaders/precision, draw order, texture/material bindings, and
visibility. Respect alignment, binding-size/device limits, page growth, and
lifetime. Logical update scopes need not each consume another GPU bind-group slot.

Records must represent immutable snapshots for queued draws. Writing value A,
encoding a draw, then writing value B to the **same range before submission**
does not preserve A for the first draw. Allocate distinct ranges for distinct
versions needed by pending work; retire/reuse them only under correct queue
ordering and lifetime rules. Simply combining today's writes into a large final
upload is not a correct allocator design.

Pooling targets call count and resource/validation bookkeeping as well as bytes;
it does not remove all per-draw binding or command-recording work. This matches
the earlier native attribution: deferred validation/command recording and buffer
writes matter, while the actual Vulkan queue-submit function is small. Those
thread times overlap and must not be added into a promised frame-time reduction.

### Upstream alignment, not a local framework

- [Three.js #30560](https://github.com/mrdoob/three.js/issues/30560) discusses the
  per-render-item UBO architecture and grouping multiple objects into shared
  buffers. Maintainer discussion explicitly calls for an architectural change.
- [RFC #27388](https://github.com/mrdoob/three.js/pull/27388) prototypes single
  uniform-buffer updates per pass. It was open when inspected. Its reported
  example gains are not measurements of this game, and it is not a drop-in,
  accepted, correctness-complete patch to our pin.
- [#33428](https://github.com/mrdoob/three.js/issues/33428) points applications to
  the existing `uniformGroup()` / `sharedUniformGroup()` APIs rather than another
  per-object material abstraction. Public grouping is useful for application
  data; it does not retrofit built-in resource ownership or uniform pooling.

Start with generic versioned uniform backing and its regressions; then pure
built-in preparation reuse and pooled object records. Coordinate the API and
allocator design with upstream rather than maintaining a private renderer fork.
The combined change is substantial enough to require explicit implementation
approval; this analysis does not authorize it.

## 5. Application-owned improvements, separately scoped

`src/fx/decals.ts` allocates four `DynamicDrawUsage` attributes;
`src/fx/particles.ts` uses that policy for its interleaved instance buffer.
`Attributes.update()` uploads DynamicDrawUsage even when the attribute version
has not changed. The FX code already marks dirty ranges and increments versions
on spawn/creation; GPU/node uniforms advance fading/animation independently.

The result is avoidable unchanged uploads after ranges have been consumed:
particle plus decal exact-repeat bytes average **581,810 / 354,569 bytes/frame**
for 5/12 enemies. These are across-frame repeats, not the 120/288 bone duplicates.
A version-driven policy chosen at buffer creation (for example `StreamDrawUsage`
in this pin), retaining all dirty/version notifications, is a small public-API
candidate. Verify all mutation/clear/ring-wrap paths and rendered output before
shipping. It is not yet an implemented or benchmarked fix.

Application uniforms can also use public render/shared groups when their actual
dependencies justify it. Existing good examples include indirect-light render
fields, immutable room data, and light-position groups. Material controls and
shared key-light fields currently enter object groups and merit a scoped audit.
Publish changes explicitly for manually versioned groups, preserve world/view
lighting separation, and check bind-group limits. Merely setting node updateType
or marking an animated mesh static does not establish shared GPU residency.

## 6. Verification and follow-through

Ten standalone assertions passed: six tests exercise the actual pinned classes
(packed change detection, raw-buffer behavior, binding cloning/rebinding,
object-update frequency, observer fast paths, and attribute usage/versioning);
four encode design counterexamples (per-destination generation, view/material
scope, historical pose, and immutable queued ranges). These establish contracts,
**not an integrated renderer implementation, visual parity, or a performance win**.

Any implementation must additionally test multi-material meshes, multiple and
mutating cameras, cascades/flashlight, velocity/previous pose, ragdolls, morphs,
custom callbacks, changed geometry, first-use/new visibility, resource disposal,
device recreation, and normal-boot/prewarm ordering. Preserve depth/image output
and quality; then repeat unwrapped CPU/native/GPU measurements with paired
controls. Keep public diagnostic wrappers out of primary timing captures.

Local evidence (not committed runtime/tooling changes):

- `/tmp/cod-resource-{5,12}-{census,matrix-census}.json` and matching logs.
- `/tmp/cod-resource-summary.json` / `.txt`: grouped counts, owners, and metadata.
- `/tmp/cod-resource-census.mjs`, `/tmp/cod-resource-probe.js`, and
  `/tmp/cod-resource-summarize.mjs`: temporary capture and aggregation scripts.
- `/tmp/cod-resource-contracts.mjs` / `.log`: source-contract/design assertions.
- Earlier native report: `/tmp/cod-native-attribution.md`.

Capture command, from the isolated worktree with a production build:

```sh
DEBUGINFOD_URLS= MESA_VK_DEVICE_SELECT=1002:7550! \
  node /tmp/cod-resource-census.mjs \
  --browser=/tmp/cod-native-symbols/opt/google/chrome-beta/chrome \
  --mode=none --agents=12 --out=/tmp/cod-resource-12-matrix-census.json
node /tmp/cod-resource-contracts.mjs
node /tmp/cod-resource-summarize.mjs
```

The scripts use local absolute paths and are investigation artifacts, not a new
portable repository harness. Raw JSON includes diagnostic timing fields; those
fields must not be used as optimization evidence.
