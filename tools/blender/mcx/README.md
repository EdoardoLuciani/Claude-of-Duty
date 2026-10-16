# MCX authoring: edit Python, build once

The Python recipe is the sole source of truth. The `.blend`, `.glb`, PNGs and
manifest are generated products. Never open an old `.blend` as a build input,
edit generated texture pixels, or repair a GLB after export.

This is an MCX pilot, not a framework for all weapons. Units are metres, +X is
forward, -Y is the ejection side. Existing runtime names, sockets, six clips and
event times remain the integration contract.

## Where to edit

| Change                                                                                      | Source                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Color, metalness, roughness, surface-normal strength                                        | `materials.py`: `FINISHES`                       |
| Shared procedural surface maps                                                              | `materials.py`: `build_materials`                |
| Receiver/grip, handguard/rail, optic, suppressor, charging handle, stock, magazines, casing | Matching `build_*` assembly inside `geometry.py` |
| Rigid pivots and named sockets                                                              | Start/end of `geometry.py`: `build_geometry`     |
| Motion poses, frame timings, visibility, events                                             | `animations.py`: `build_animations`              |
| Surface scale, mesh preparation, stock exporter options                                     | `export.py`                                      |
| Review cameras/lights only                                                                  | `studio.py`                                      |
| Stage order and output paths                                                                | `../mcx_virtus.py`                               |

Geometry helpers are local to the geometry builder. Module imports do not build
objects or mutate Blender. There are no registries, plugins, alternate material
maintenance commands or runtime material overrides.

## Build

From the repository root, using Blender **5.2.2** and its bundled glTF exporter:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/mcx_virtus.py
```

The command always starts from an empty factory scene and regenerates the whole
weapon. It does not read a previous `.blend` or `.glb`. Normal Vite/game builds
continue to use committed assets and do not require Blender.

For a scratch build, use an absolute output directory. This does not touch the
committed asset directory:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/mcx_virtus.py -- \
  --output /tmp/mcx-review --render --quick
```

`--render` produces five fixed-camera PNGs. `--quick` changes only preview
resolution/samples, never geometry, maps, animation or export. A working OCIO
configuration is required; if the local Blender installation has an incompatible
system config, supply a compatible process-local `OCIO` path. Do not disable
color management or change system configuration to obtain a render.

## The complete process

1. **Materials:** generate the three seeded 1024² maps; build named finishes from
   `FINISHES`. The recipe writes both connected shader multipliers and their
   corresponding defaults. Base color is sRGB; roughness and normals are data.
2. **Geometry:** build named assemblies and rigid pivots. Keep dimensional and
   contact decisions beside the corresponding part, not in exporter corrections.
3. **UVs:** project repeating detail maps onto dominant rest-space face planes,
   at one repeat per 10 cm. No automatic island packing or dependence on object
   creation order. This is appropriate for these shared detail maps, not a unique
   painted decal atlas. It deliberately replaces the previous packed UV layout.
4. **Animation:** author the six clips and explicit reset channels. Sparse motion
   poses use Blender's curves, then are evaluated at 60 Hz into LINEAR keys in
   Blender. Visibility keys stay CONSTANT. Tracks name/group the actions; they
   are not a blended scene to be force-sampled during export.
5. **Preview:** save a generated `.blend` with named components, modifiers, packed
   maps and Idle selected. Optional studio renders use this file's scene setup.
6. **Export:** mute tracks and restore explicit rest transforms. Evaluate mesh
   modifiers, triangulate with fixed quad/ear-clip rules, and apply the same UV
   projection to the final faces. This avoids modifier interpolation changing
   UV rounding between builds. Join components in name order under their ten
   rigid parents. Use Blender's ordinary **Actions** exporter, merging matching
   track names, with forced sampling off. Blender emits LINEAR motion and STEP
   visibility itself. Nothing reopens or rewrites the resulting GLB.
7. **Manifest:** record counts/events from the build. This is a separate metadata
   file, not a modification of the exported asset.

The editable preview retains bevel modifiers; the runtime copy evaluates them.
Both use the same physical-scale surface rule. UVs and triangle ordering differ
from the historical asset; this change is not claimed to be a byte-preserving
material-only edit. Material parameters, generated image content, part shapes,
sockets and gameplay timings are not retuned by this pilot.

## Review a change

- Change the relevant recipe section, not the generated products.
- Build to a scratch directory first. Inspect the saved scene/renders and compare
  against the previous asset under the same cameras and lighting.
- Use the existing `tools/blender/mcx_check.py` and MCX smoke/gameplay checks;
  this redesign adds no tests. Export success alone is not visual acceptance.
- For a reproducibility check, run the same command into two empty directories
  in fresh Blender processes. Compare runtime GLB and PNG hashes. `.blend`
  metadata can differ with paths; it is not the runtime identity.
- Once accepted, run the same build command without `--output` and commit the
  recipe together with its generated asset/manifest changes.

Do not add a saved-file-only fallback if a fresh build fails. Diagnose the stage
that failed. Do not relax runtime contracts or introduce output patches to make
an export look successful.
