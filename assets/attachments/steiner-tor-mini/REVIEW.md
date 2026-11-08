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

## Fresh-build comparison

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

## Geometry and runtime delivery

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
