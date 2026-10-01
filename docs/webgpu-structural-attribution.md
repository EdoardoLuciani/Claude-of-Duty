# Remaining WebGPU render overhead: structural attribution

## Conclusion and scope

This is diagnostic evidence at `9f817da` (production render behavior `6d40e1a`),
not an optimization or acceptance result. **The remaining cost is primarily
active renderer/update work, amplified by the game's pass/material structure;
it is not established as an unavoidable WebGPU cost or a browser defect.**
Three.js binding/uniform processing is a major contributor. Browser/native
serialization and service-side work also exist, but the marked steady trace
does not support dominant main-thread waiting/backpressure.

All new measurements used RX 9070 XT only, `MESA_VK_DEVICE_SELECT=1002:7550!`,
960×540/DPR 1/high for the game, pinned Three.js 0.186.1, managed Chrome 153
unless stated. Game runs use the established seeded movement/turn/fire script,
900 frames / 60 warmup. Engine wall, frame intervals, sampled attribution,
thread CPU and selected GPU pass timestamps are distinct measurements; do not
add them. Production and installed dependencies were not changed.

## 1. Application structure multiplies renderer work

One light-instrumented stock run measured engine wall **13.118 ms**, including
`RenderSystem.render()` **11.909 ms**. Renderer invocation wall was world
**9.328 ms** (inclusive of CSM), prepass **1.412 ms**, weapon **0.494 ms**.
These overlap; they are not additional costs. Other exclusive means included
AI 0.387, UI 0.267 and physics 0.198 ms.

The game submits about 1,077 draws, including three frequently updated CSM
cascades, velocity/MRT, many instanced/material variants and the node-based
lighting/indirect graph. Stable point-light identities prevent shader rebuilds
but retain light data in shaders even when a light contributes zero irradiance.

Separate, single-run light controls constrain possible attribution:

| Diagnostic control | Engine wall ms | Writes/frame | Native draws/frame |
|---|---:|---:|---:|
| Stock | 14.124 | 6,939.79 | 1,077.22 |
| Hide point/spot lights before boot | 11.285 | 2,768.01 | 1,077.22 |
| Freeze shadows | 8.776 | 5,889.95 | 403.14 |
| Skip underlying queue writes | 12.100 | 6,939.79 attempted | 1,077.22 |
| Skip backend binding upload | 12.239 | 7.83 | 1,077.22 |
| Disable rendering | 0.848 | 0 | 0 |

These controls change images or work and are **not optimization proposals**.
Differences are neither additive nor reliable isolated millisecond budgets.
Shadow submission matters; the result does not justify freezing moving shadows.
The write controls retain much of the JS traversal/comparison cost.

## 2. Three.js update and buffer-sharing behavior matters

A 12.754-second CDP sampled profile placed about 12.7% of sampled time in native
`writeBuffer`, 9.8% in `Bindings._update`, 8.5% in `UniformsGroup.update`, 5.1%
in `_updateBindings` and 4.6% in `_renderObjectDirect`. Vector/color/value
comparison and uniform getters add further cost. These are self-sample shares,
not independent uninstrumented per-frame budgets. Native samples alone cannot
distinguish active execution from waits. A function named `build` in a sample
is not proof of shader building: recorded steady late builders remain **zero**.

A separate 30-frame binding inspection found:

| Pass/group | Distinct binding group IDs in window | Updates/frame | Raw changed ranges/frame |
|---|---:|---:|---:|
| World/render | 238 | 227.40 | 3,775.23 |
| Prepass/render | 2 | 2.00 | 7.00 |
| CSM 0/render | 173 | 172.50 | 512.50 |
| CSM 1/render | 174 | 174.00 | 517.00 |
| CSM 2/render | 174 | 173.47 | 515.40 |

CSM groups can recur across cascades: **do not sum these as unique buffers**.
Ranges are not write calls: the backend merges exactly contiguous ranges.
World and CSM render groups account for roughly 5,320 raw ranges/frame. Camera
projection/view/world matrices and positions are repeatedly compared/uploaded
across layouts; camera-relative light positions change as the camera moves.
Many small padded uniform fields cannot be merged by the contiguous-only rule.

Source paths explain the mechanism without proving each layout's origin:

- `NodeBuilderState.createBindings()` shares `groupNode.shared` bindings within
  a builder state, and clones other bindings. It does not globally consolidate
  every shader layout's camera/light data into one canonical GPU buffer.
- `NodeManager.updateGroup()` checks a group/binding pair's version; object
  groups always require checking. Shared node values do not automatically imply
  one shared GPU buffer across all material/geometry/context variants.
- `UniformsGroup.update()` walks and compares uniforms; the backend walks
  changed ranges and sends individual `queue.writeBuffer()` calls.
- `NodeMaterialObserver` selects full refresh for custom node/context hooks,
  animation/dynamic instancing and velocity before its static/bundle shortcut.

The exact split among geometry, instancing, material and pass-context layout
variants still needs targeted inspection. Instancing alone is not a sufficient
explanation: the simple instanced fixture below retained shared light uploads.

### Actual application-side redundancy: static room arrays

`IndirectFill` sets the two room arrays' **node** `updateType = 'none'`. That
stops CPU repacking, not all GPU uploads: `NodeUniformBuffer` inherits
`Buffer.update()`, which returns true. Their default object binding group still
requests uploads. The current comment promising no per-mesh/frame re-upload is
therefore not fulfilled by that setting alone.

A diagnostic public `uniformGroup('constantRooms', 1, 'none')` for these immutable
arrays reduced writes **6,939.79 → 6,585.83** and bytes
**1,337,004 → 1,280,370/frame** (~354 calls / 56.6 KB). This remains unshipped:
initialization, restarts, resize/new variants and image/history parity must be
verified before accepting that lifetime contract. One instrumented timing is
not evidence of a gain.

Coalescing each uniform buffer's changed ranges into one bounding span reduced
writes **6,940 → 1,739**, while increasing bytes **1.337 → 1.525 MB/frame**.
Two plain stock/coalesced pairs had means **14.833/14.800** and
**13.245/12.470 ms**. This is mixed preliminary evidence, not an established
speedup. It leaves comparison/traversal work intact. Moving indirect uniforms
to `renderGroup` also did not establish a paired frame-time improvement.

## 3. Browser/native work: real, but not a demonstrated dominant wait

The marked 840-frame trace spanned 11.343 s. Renderer animation-callback wall
was about **10.682 s**, with thread CPU about **10.772 s**; the small impossible
CPU-over-wall discrepancy prevents precise subtraction, but the two track
closely rather than showing a large sleeping gap.

Within that same steady window, `DawnClientSerializer::GetCommandSpace` totaled
**21.4 ms**, and client `Flush` **58.6 ms** (~0.025 and 0.070 ms/frame, nested
where applicable). The earlier unmarked trace's 887.6 ms `GetCommandSpace`
total included non-steady work; it is **not a steady per-frame wait budget**.

GPU-process `DawnCommands` totaled **5.559 s**, with about **5.536 s thread CPU**
(~6.6 ms/frame). The nested decoder handler is nearly the same span, not another
cost. This is concurrent CPU service work—decode/validation/upload/recording—not
GPU execution time and not something to add to engine wall. Tracing perturbs
execution and does not separate those internal operations.

Headed helper/native-surface means were **15.325/15.255 ms**; headless native
surface **16.890 ms**. These single runs do not show presentation flags removing
the cost. `SystemInfo` reported hardware compositing/WebGPU/Vulkan and ANGLE on
RX 9070 XT. Actual WebGPU `device.adapterInfo` independently reported
`vendor: amd`, `architecture: rdna-4`, `isFallbackAdapter: false`; private device
IDs/descriptions are blank, not proof of a software adapter.

Three alternated-order stock pairs compared managed Chrome 153 with Fedora
Chromium **154.0.8037.57**:

| Pair | Chrome 153 mean/p95/p99 ms | Chromium 154 mean/p95/p99 ms |
|---|---|---|
| 1 | 13.61 / 17.2 / 33.5 | 12.43 / 15.4 / 16.1 |
| 2, reversed | 12.89 / 16.3 / 17.2 | 12.90 / 16.3 / 17.5 |
| 3 | 13.16 / 16.4 / 17.2 | 11.73 / 14.5 / 15.4 |

Across means **13.22 → 12.35 ms (~6.6%)**, but one pair ties. Different builds
as well as versions are involved; no specific Chromium regression/fix is
established. Legacy was not rerun on 154: this is not a new parity comparison.

An attempted `skip_validation` Dawn flag did **not** disable observable native
write validation: a scoped misaligned-buffer-offset probe returned the same
validation error with and without it. Its timing runs cannot establish the
cost of disabled validation. No unsafe flag is recommended for production.

## 4. Plain Three.js does not intrinsically need 10 ms for 1,000 draws

`tools/webgpu-structure-probe.mjs` is a standalone, local-only fixture: 1,000
boxes (12,000 triangles), one shared material/geometry, one directional light,
0 or 24 point lights, moving camera, 64×64 offscreen target, no shadows/history/
post/gameplay. WebGPU instanced objects each have one resident storage matrix.
The node-mesh variant adds a color uniform. 360 frames / 60 warmup, single runs:

| Variant | Point lights | Render wall mean ms | WebGPU writes/frame |
|---|---:|---:|---:|
| WebGPU meshes | 0 | 1.050 | 1 |
| WebGPU meshes | 24 | 0.900 | 25 |
| WebGPU one-instance meshes | 0 | 1.885 | 1 |
| WebGPU one-instance meshes | 24 | 2.679 | 25 |
| WebGPU node meshes | 0 | 1.725 | 1 |
| WebGPU node meshes | 24 | 2.460 | 25 |
| WebGL meshes, standalone reference | 24 | 0.658 | n/a |

All accepted rows recorded 1,000 actual draws, zero page errors and zero steady
WebGPU builder events. A separate exploratory node-instanced variant emitted
`THREE.TSL: Invalid generated code, expected a "vec4"` and is **excluded**, not
claimed correct or offered by the tool. Direct package builds avoid optimizer
module-identity ambiguity, but did not resolve that exploratory error.

This is deliberately **not workload-equivalent** to the game (~23.4 million
submitted index/vertex instances, complex materials, multiple passes). Its rAF
intervals are also not FPS acceptance. It only disproves the assertion that
roughly 1,000 draws or 24 lights inherently imply the current 10–14 ms cost.

Reproduce (tool accepts `--key=value`):

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-structure-probe.mjs \
  --kind=mesh --lights=24 --out=/tmp/structure-mesh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-structure-probe.mjs \
  --kind=instanced --lights=24 --out=/tmp/structure-instanced
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-structure-probe.mjs \
  --kind=node-mesh --lights=24 --out=/tmp/structure-node
```

`--backend=webgl` is standalone reference-only, never gameplay fallback.
`--browser=/path/to/chrome` overrides the managed browser. Summary and raw
records are saved separately. Whole-game controls/trace/profile were diagnostic
`/tmp/cod-structural-profile.mjs` runs, not production hooks. Detailed artifacts
are `/tmp/cod-structural-{cpu,bindings,trace-steady}*`,
`/tmp/cod-structural-browser-{153,154}-{1,2,3}*`,
`/tmp/cod-structural-control-*`, and `/tmp/cod-minimal-final-*`.
A broad skip-bindings control caused validation errors and is excluded.

## Repository validation

The committed probe was rerun for mesh, instanced, node-mesh and standalone
WebGL reference: 1,000 draws, no errors, no steady WebGPU builders; the three
WebGPU rows retained 25 writes/frame with 24 point lights. `npm test` (51 tests),
`npm run lint`, `npm run build`, `git diff --check`, and a fresh-port standard
960×540 hero capture passed. No runtime, dependency, generated world or visual
settings changed; the original worktree's modified lockfile was left untouched.

## Next fix priority

1. Validate the small immutable room-buffer lifetime correction first.
2. Investigate/reduce redundant camera/light binding layouts and full node
   refresh while retaining lighting, alpha/skinning and velocity semantics.
   Public shared data/packed light-buffer designs are preferable to unsupported
   private cache overrides; feasibility is not yet established.
3. Keep range coalescing and browser comparisons as secondary experiments, not
   promised fixes. Maintain separate native service and GPU timing evidence.
4. Bundles still need draw-order/image parity and complete invalidation before
   shipping; they do not remove the uniform update cost. Cold boot ~12 s and
   previous visual/temporal/fixture acceptance blockers remain unchanged.

PR #316 remains draft. This report makes no quality cuts, performance acceptance
claim, upstream defect claim, or permission to publish upstream changes.
