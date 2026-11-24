# Al-Maktaba MK-IV field terminal

Original game art: a two-shell molded instrument case with dark olive polymer,
charcoal rubber, lighter corner guards, over-center latches, a folding grip,
elastomer feet, a gasketed rim and two coaxial sleeve hinges. The interior is a
suspended controller and battery tray; the cable harness terminates in keyed
plugs, and the service header is the spark source. The exterior data plate, lid
checklist and PCB screen print are authored inks, not runtime overlays.

## Author, check, cook

Use Blender 5.3.0 and the repository's gltfpack 1.3. From the repo root:

```sh
OUT="$(mktemp -d)"
blender -b -t 2 --python-exit-code 1 --python tools/blender/intel_case/build.py -- --output "$OUT"
bun build/models.ts intel_case "$OUT"
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

`bun tools/build-assets.ts` (also `dev` and full `build`) hashes the local Python recipe
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

| Node                      | Contract                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEL_CASE`              | Root at the authored site; gameplay owns yaw, position and pool visibility.                                                                          |
| `INTEL_HINGE`             | Rear pin axis at `(0, 0.38, -0.23)`, identity rotation when closed. Gameplay opens about local `-X` through its existing arc; no exported animation. |
| `INTEL_BODY`, `INTEL_LID` | One shared opaque PBR material, a single draw per rigid assembly.                                                                                    |
| `INTEL_BEACON`            | Lid child. Its HDR basic material is owned and pulsed by gameplay.                                                                                   |
| `INTEL_LEDS`              | Body child, one batch; gameplay owns its constant unlit green.                                                                                       |
| `INTEL_SPARK`             | Body-fixed socket at `(0.13, 0.288, 0.06)`, on the raised service header.                                                                            |

No bundled lights or runtime-mesh fallback. Each pool slot clones the transforms,
not the buffers, maps or materials. Restart reuses them; IntelSystem disposes
them on teardown. Gameplay uses the same authored sites and interaction target.

Keep the LED and lens batches out of prepass and shadow passes. The
[export check](check.py) enforces the triangle budget.
Review the hinge sweep and clearance at the authored sites.
