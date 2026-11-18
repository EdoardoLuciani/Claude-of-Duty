# Al-Maktaba MK-IV field terminal

Original game art: a two-shell molded instrument case with over-center latches,
folding grip, elastomer feet, a gasketed rim and two coaxial sleeve hinges. The
interior is a suspended controller and battery tray; the cable harness terminates
in keyed plugs, and the service header is the spark source. The exterior data
plate, lid checklist and PCB screen print are authored inks, not runtime overlays.

## Author, check, cook

Use Blender 5.2.2 and the repository's gltfpack 1.3. From the repo root:

```sh
OUT="$(mktemp -d)"
blender -b -t 2 --python-exit-code 1 --python tools/blender/intel_case/build.py -- --output "$OUT"
bun run models:cook -- intel_case "$OUT"
blender -b "$OUT/intel-case.blend" -t 2 --python-exit-code 1 \
  --python tools/blender/intel_case/check.py -- "$OUT/intel-case.glb" "$OUT/intel-case.runtime.glb"
```

`build.py` owns the shape and pivot; `atlas.py` generates and packs the opaque
sRGB albedo and linear roughness/metalness atlases (512 × 256 each). Grading,
edge/finish swatches, scratches, labels and copper routing are atlas detail,
not extra geometry or runtime canvases. Blender saves the individual editable
parts in closed pose before it joins four native glTF meshes. The check samples
moving-versus-fixed surfaces through the gameplay sweep, then verifies the named
nodes, batch/material budget and self-contained maps in both exports. Sampled
surface intersections are not a continuous collision proof, nor do they test
clearance against level props.

`bun run assets` (also `dev` and full `build`) hashes the local Python recipe
and cook settings and rebuilds missing or stale products. There are no shared
weapon, attachment, external font/image or hand-calibration inputs. Generated
`.blend` and `.glb` files are ignored. Without a scratch path, the native files
go beside this guide and the cooked GLB goes to `public/models/props/`.
The case uses meshopt geometry and WebP atlases, with a 256 × 128 cooked
roughness/metalness map; it needs neither a Basis worker nor the scene material
forge.

## Axes, datums and runtime contract

Blender is metre-scale, +X right, +Z up, -Y toward the handle; the glTF is +X
right, +Y up, +Z toward the handle. Closed envelope is approximately
0.746 × 0.483 × 0.536 m (X × Y × Z), floor origin retained. Coordinates below
are in glTF metres relative to `INTEL_CASE`.

| Node | Contract |
| ---- | -------- |
| `INTEL_CASE` | Root at the authored site; gameplay owns yaw, position and pool visibility. |
| `INTEL_HINGE` | Rear pin axis at `(0, 0.38, -0.23)`, identity rotation when closed. Gameplay opens about local `-X` through its existing arc; no exported animation. |
| `INTEL_BODY`, `INTEL_LID` | One shared opaque PBR material, a single draw per rigid assembly. |
| `INTEL_BEACON` | Lid child. Its HDR basic material is owned and pulsed by gameplay. |
| `INTEL_LEDS` | Body child, one batch; gameplay owns its constant unlit green. |
| `INTEL_SPARK` | Body-fixed socket at `(0.13, 0.288, 0.06)`, on the raised service header. |

No bundled lights or runtime-mesh fallback. Each pool slot clones the transforms,
not the buffers, maps or materials. Restart reuses them; IntelSystem disposes
them on teardown. Gameplay uses the same authored sites and interaction target.

## Measured budget and review

One shared kit at **High** quality (measured from the loaded meshes). Geometry
bytes are the unique typed-buffer payload, not renderer/driver allocations.
Texture bytes are RGBA8 payload estimates with full mip chains. The baseline
counts the case's own canvas only, not the shared procedural material library.

| Metric | Procedural baseline | Authored case |
| ------ | ------------------- | ------------- |
| Triangles | 5,922 | 5,634 |
| Vertex entries | 5,185 | 6,351 |
| Beauty draws / prepass draws / eligible shadow casters | 11 / 9 / 9 | 4 / 2 / 2 |
| Runtime materials | 8 | 3 |
| Shared geometry bytes | 263,624 | 184,532 |
| Case-owned texture bytes with mips | 699,052 | 873,816 |
| Native / cooked GLB bytes | Not applicable | 430,332 / 108,664 |
| Cooked embedded WebP bytes | Not applicable | 46,524 |

The new finish needs distinct UVs and normals at material and bevel seams,
so there are more vertex entries despite fewer triangles and smaller buffers.
The extra roughness/metalness map buys visible separation between polymer,
rubber, hardware and electronics; its cooked resolution is half the albedo's
on each axis. The LED and lens batches stay out of prepass and shadow passes.

Hardware review: Chromium WebGPU on AMD RDNA 4 (no fallback), 1280 × 720, DPR 1,
E2 roof. Matching camera, time, fixed exposure and lid angles for each pair:
noon without flashlight and midnight with the stock player flashlight. The
viewmodel and HUD are hidden for the prop comparisons. The full native render
path was timed at the open pose, with 48 measured frames per visible/hidden
case condition, alternated in blocks. CPU milliseconds are main-thread render
submission, GPU milliseconds are native render/compute pass timestamp sums
(excluding copies, queue waits and presentation). Medians below include the
visible case; the draw delta is visible minus hidden within each build.

| Open pose | CPU ms (before → after) | GPU render ms | GPU compute ms | Added full-frame draws |
| --------- | ----------------------- | ------------- | -------------- | ---------------------- |
| Day, close | 5.10 → 5.20 | 2.621 → 2.563 | 0.938 → 0.939 | 47 → 12 |
| Day, approach | 4.45 → 4.00 | 2.918 → 2.905 | 0.808 → 0.809 | 47 → 12 |
| Night, close | 3.75 → 5.35 | 2.649 → 2.588 | 0.939 → 0.940 | 56 → 14 |
| Night, approach | 3.75 → 4.40 | 2.985 → 2.975 | 0.807 → 0.808 | 56 → 14 |

The draw reduction is repeatable; the whole-frame timings do not establish a
case-only speedup. For example, the hidden-case night close CPU median also
moved from 3.40 to 5.20 ms. Do not treat these timings as a frame-rate claim.
The matched front views cover closed, partial and open; rear views show the
hinges in the closed and open poses. Final visual judgment at gameplay distance
and site-specific clearance still need human review.
