# TOR Mini candidate review evidence

**Status: technically validated visual-review candidate; human AAA acceptance and
weapon integration remain open.** The asset is not installed on any weapon yet.

## Reference pass

Used the official store's two side views and front/rear upper-quarter images
linked in [reference-review.json](reference-review.json), with the manual's
nominal envelope as the global scale authority. Original geometry and procedural
finishes only; reference photographs are not textures or delivered products.

Iterated the rear clamp ramp/front chamfer, tapered boot, rear U relief, pressure
pads, battery cap, marking width/placement and aperture. Compared detailed source
and baked target with the same studio cameras. Kept diamond pad relief in the
optimized geometry after an earlier projection introduced visible triangular
shading artifacts; pad caps now have explicitly flat normals.

An approximate registration of the right-side render to `TOR_MINI_SIDE_1` used
one uniform scale (0.933970754 for a 1000² render) and translation
(-87.9854, -86.7465) pixels, no independent X/Y warp. Alpha-mask intersection over
union at 95% opacity was **0.91958**. This is a silhouette diagnostic, **not** a
calibrated fit measurement or proof of 1:1/AAA fidelity. It excludes neither all
photographic perspective nor all shadow/edge differences. The left side and both
quarters were also inspected, without claiming equivalent numerical registration.

## Initial full-detail build comparison

Blender **5.2.2**, two factory-empty, separate-process builds: one scratch build
with review rendering, one normal clean-install asset build. Compared native GLB
accessor values, not only container byte sizes:

- Positions, normals, UV0, tangents and indices: **byte-identical**.
- Node/socket and material JSON: **identical**.
- 2048² normal and ORM pixels: **identical**.
- 2048² base color: **1 of 4,194,304 pixels differed**, maximum RGB channel delta
  **1/255**, mean absolute channel delta **0.00000007947/255**.

This is same-host evidence, not a universal bit-exact Blender/Cycles guarantee.
Explicit native `EXTEND` bake padding and fractional UV separation replaced an
earlier adjacency-padding configuration that varied at island borders.

## Initial full-detail geometry and runtime delivery

- **9,978 triangles**, one opaque mesh/material/primitive, no animation/skin.
- Authored envelope: **32.84 × 53.20 × 30.35 mm** in Blender XYZ (width/length/height).
- Three 2048² maps; no baked beam, lighting or AO.
- Native GLB approximately **7.08 MiB**; cooked meshopt/KTX2 GLB **5.89 MiB**.
- Separate-process saved-blend/native-export checker: **PASS**.
- Cooked asset decoded with Three r187 GLTFLoader, MeshoptDecoder and KTX2Loader,
  compiled and rendered with **WebGPURenderer in Chromium**, AMD `gcn-5` adapter:
  one mesh / 9,978 triangles, **no captured page/console errors**. This standalone
  material/decode check is not mounted gameplay or a frame-time benchmark.

## Repository gates

`bun ci`, `bun run test`, `bun run lint`, `bun run format:check` and the full
`bun run build` passed. The clean build regenerated all model families and
validated committed world assets; no unrelated generated files are committed.

Review images on the PR distinguish the initial reconstruction from the refined
candidate using the same hero camera, framing and studio exposure. Other views
come from the final candidate. No pre-existing shipped laser is implied by the
"before" image.

## Mesh optimization pass

Selected a **5,924-triangle authored target**, **40.6% fewer triangles** than the
9,978-triangle baseline. Runtime vertex count fell from **10,819 to 7,363**
(approximately 32%). One opaque mesh/material/primitive and three 2048² maps
remain; the standard cook does not simplify further. No flashlight, weapon-fit
or gameplay changes.

### Trials and selection

First tested attribute-aware gltfpack simplification on the unmodified native
baseline, preserving the original maps. Representative trials with `-sp -noq`
(and retained named nodes/extras):

| Target ratio / relative error limit | Actual triangles | Close-up observation |
| --- | ---: | --- |
| 0.30 / 0.003 | 6,054 | Conservative reduction; aperture starts to lose detail |
| 0.50 / 0.004 | 5,506 | Aperture visibly polygonal in the front view |
| 0.40 / 0.006 | 4,798 | More contour/edge loss despite little change at small screen sizes |
| 0.25 / 0.012 | 3,870 | Obvious aperture faceting and shading changes; rejected |
| **Selective authoring reduction** | **5,924** | **Selected: round aperture retained, smaller losses elsewhere** |

Also tried gltfpack position/attribute optimization (`-sv`); it did not resolve
the aperture trade-off enough to prefer it over the selective target.

The selected recipe leaves the detailed high source intact, but changes the low
target's small-cylinder budgets (12/16/24 segments by size), removes microscopic
bevel geometry in favor of its normal bake, and reduces the boot lip's bevel
segments. Both aperture rings retain **32 circular outline segments**; their
microscopic bevels are baked, and the low cap normals are explicitly flat to
avoid shading waves. Pressure-pad diamond relief and larger bevels remain real
geometry. The atlas is rebaked from the original detailed source, not patched.

### Validation of the selected target

- Eight matched Blender views and nine WebGPU views per candidate, including a
  small-screen-size proxy (not a mounted gameplay capture). Cameras, exposure,
  environments and framing matched within each renderer.
- Old and new cooked GLBs both decoded/compiled/rendered on the same AMD `gcn-5`
  WebGPU adapter without captured page/console errors. Small fasteners and edge
  rounding are less detailed; the main silhouette, aperture and pad relief hold up.
- Native sampled surface differences: 51,085 baseline-to-target samples had
  maximum **0.0593 mm** / mean **0.00775 mm** distance; 31,415 target-to-baseline
  samples had maximum **0.0895 mm** / mean **0.00697 mm**. Samples include vertices,
  triangle centroids and edge midpoints; **not an exact Hausdorff bound**.
- Separate-process checker passes with the tighter **6,000-triangle budget** and
  a new explicit **32-segment aperture** gate. Sockets and envelope are unchanged.
- Two fresh builds have identical position/normal/UV/tangent/index accessor bytes
  and node/material JSON. Of 4,194,304 pixels per map, base color and ORM each
  differ at one pixel by at most 1/255; normal differs at 24 pixels by at most
  2/255. Same-host Cycles rounding evidence, not universal bit-exact textures.
- Clean install, smoke/lib tests, lint, formatting and full build passed again.

This reduces **mesh processing**, not draw calls or texture memory. Repacking and
rebaking the unchanged-resolution atlases means the cooked file actually grows
slightly: **6,176,192 → 6,353,120 bytes** (~5.89 → 6.06 MiB). No download-size,
VRAM or FPS improvement is claimed. Before/after optimization views are attached
on the PR; human final visual acceptance and mounted integration remain separate.
