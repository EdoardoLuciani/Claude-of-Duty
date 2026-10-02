# Short remaining-upload audit and indexed-buffer feasibility

Follows [uniform sharing](webgpu-uniform-sharing.md), production reference `d7f43f9`.
No production rendering or dependency behavior was changed by this audit.

## Scope

RX 9070 XT only: actual native adapter `amd / rdna-4 / isFallbackAdapter:false`,
Chrome 153/Vulkan, 960×540/high. Short seeded move/turn/firefight fixture, 120
frames/60 initial settling frames; detailed inspection covers **frames 60–89**.
Two stock runs and one boot-route FX usage control. Actual queue calls/byte spans
are attributed to binding or attribute updates; bone duplicates require the
same CPU source, same byte span and **exact copied-byte equality in the frame**.

Byte snapshots and private read-only binding inspection perturb execution.
These are structural counts, **not frame-time acceptance or isolated CPU costs**.
The shorter window is not a replacement for the earlier 900/60 means.
All measured runs reported zero late builders/errors and the hardware adapter.

## Findings

| Stock short-window metric / frame | Calls | Bytes |
|---|---:|---:|
| All native queue writes | 1,921.53 | 1,364,762.53 |
| Attribute updates (FX) | 9.00 | 859,769.60 |
| Current/previous bone arrays | 259.30 | 416,800.00 |
| Exact repeated bone source/span/data within frame | 248.30 | 398,816.00 |
| World render-group fields | 960.23 | 48,213.20 |

The repeated-bone row is a **subset**, not additional work to add to the total.
Equal data on unrelated CPU sources, or differing camera transforms, was not
classified as redundant.

### 1. FX usage defeats otherwise-correct dirty tracking

`src/fx/particles.js` already records dirty spans, calls `addUpdateRange()` and
sets `needsUpdate` at births. `src/fx/decals.js` does the same for its four event-
updated vertex attributes. Time-dependent motion/fade is in the shader.

Pinned Three.js `src/renderers/common/Attributes.js::update()` nevertheless
updates when `usage === DynamicDrawUsage`, **even without a new version**.
`WebGPUAttributeUtils.updateAttribute()` copies the entire array when ranges
are empty. Thus the dirty span is consumed, and subsequent quiet frames still
upload the full event-data array. This is a usage/lifetime mismatch to address;
it does not by itself establish a Three.js defect.

A **diagnostic-only boot route** substitutes `StreamDrawUsage` for
`DynamicDrawUsage` in `particles.js` and `decals.js`, leaving explicit versioning
and dirty ranges intact:

| Metric / frame | Stock | Usage control |
|---|---:|---:|
| All writes | 1,921.53 | 1,915.73 |
| All bytes | 1,364,762.53 | 510,345.47 |
| Attribute writes | 9.00 | 3.20 |
| Attribute bytes | 859,769.60 | 5,352.53 |

About **854 KB/frame (~62.6% of total bytes)** disappears but only 5.8 calls.
Actual GPU draw/work counts match in every inspected frame. This is **not a
proven timing gain or image/lifecycle pass**. Births, expiry, ring wrap, late
visibility, resize/restart and all GPU-owned dirty data still require validation
before shipping. No installed dependency was edited.

### 2. Bone ownership is the next uniform-array target

Current CSM palettes use six GPU targets for six skeleton sources, yet issue
54 writes per cascade/frame because the same character has multiple material
slots. Across three cascades that is 162 writes. World/prepass have additional
layout-specific targets; first-person arms issue ten current-palette writes for
two source arrays. Previous-frame palettes are separate and must remain so.

`Skinning.js` already updates a skeleton once per node frame, but its default
`referenceBuffer('skeleton.boneMatrices', ...)` follows object-scoped buffer
uploading. CPU skeleton-update frequency and GPU upload frequency are different.

Investigate **per-skeleton, per-frame GPU palette ownership** first, rather than
immediately replacing the entire object rendering model. A frame-wide skip on a
shared reference that switches between skeletons could freeze or cross-wire
characters; it is not a safe shortcut. Preserve previous bones, velocity and
pass ordering. The counts bound repetition, not an established safe speedup.

### 3. World camera layouts still differ

World render-group updates touch 124 GPU buffer targets in this window and
include repeated camera matrices plus varying material/shadow/light fields.
The earlier AO fix collapsed CSM camera layouts to two targets/cascade, not all
world layouts. Do not assume all 960 small writes can disappear, or that moving
object transforms alone solves this bucket.

## The proposed shader-indexed buffer

The general design is sound: keep records in GPU memory, update changed records
in bulk, and let the shader fetch `objects[objectId]` / `bones[boneOffset + skinIndex]`.
Public TSL storage nodes support indexed access. Static world instance matrices
already use resident storage in this game.

A sensible split is:

```text
Pass/camera data        updated per camera/pass
Static object records  resident; update only on edits
Dynamic object records current + previous transforms
Material records       update only changed fields
Bone palettes          current + previous data per skeleton/frame
FX streams             birth/edit dirty ranges; shader evaluates age/motion
```

But **one upload is not one draw**. CPU still calculates/packs records, the GPU
still shades vertices, and ordinary scene traversal/draw submission remains
unless batching changes too. Read-only storage access and additional indexing
can also change GPU cost; fewer queue calls alone is not proof of faster frames.

Specific pinned-Three constraints:

- `WGSLNodeBuilder.getDrawIndex()` returns `null`; ordinary native mesh draws
  use `firstInstance = 0`. There is no automatic unique `drawIndex` for every
  normal mesh in this backend.
- A table needs a stable index provided by instancing, a constant/per-instance
  attribute, batching, or supported indirect draw arguments. A per-object index
  uniform still leaves a small per-draw update.
- `BatchedMesh` already indexes matrices/indirection **data textures**, using
  `instanceIndex` on WebGPU. The backend supplies subdraw index as `firstInstance`
  but still loops over separate `drawIndexed`/`draw` calls. It is not one native
  multi-draw command or a global storage-table drop-in.
- Built-in transform/skinning/material accessors must stop binding/uploading
  their old object data, or adding a table just adds another buffer. Preserve
  normals/tangents, alpha testing, skinning, previous transforms, velocity,
  camera-dependent precision, and separate weapon depth/camera semantics.

**Recommendation:** validate the small FX usage/version correction, then a
limited palette-lifetime/sharing prototype. An indexed object/material/bone
system is worth a scoped benchmark, but is a larger architecture change—not
an automatically easier replacement for the current renderer. Check complexity
and correctness before adopting it. No general object-table implementation or
production usage change was made in this audit.

Temporary evidence: `/tmp/cod-targeted-{uploads,uploads-owners,stream-fx}{,-raw}.json`;
`/tmp/cod-structural-profile.mjs` diagnostic `uploads` mode. Source references are
the pinned `node_modules/three/src/` files above plus `nodes/accessors/Batch.js`,
`renderers/webgpu/WebGPUBackend.js`, and `nodes/accessors/Skinning.js`.
