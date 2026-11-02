# EOTECH EXPS3-0 attachment

A Blender-authored EXPS3-0 visual-review candidate. It is not yet mounted in
gameplay or a certified engineering model. The future weapon integration must
validate alignment, sight picture and reticle behavior.

## Products

- `tools/blender/exps3.py` is the source of truth; `exps3_bake.py` creates the
  optimized atlas from the editable high/low geometry.
- `exps3-0.blend` contains the editable source, runtime meshes, packed maps and
  review studio. Open with Blender 5.2.2.
- `exps3-0.glb` is the native export: 11,972 triangles, two primitives and three
  embedded 1024² PBR atlases. `exps3-0.runtime.glb` is the gltfpack-cooked
  version: 11,552 triangles and three embedded UASTC KTX2 maps. Glass is a
  separate material; neither export contains the review studio or a reticle.
- `exps3-{base-color,normal,orm}.png` are the body atlases. ORM channels are
  occlusion, roughness and metallic. `finish-{normal,roughness}.png` are
  high-source maps, not runtime textures.
- `manifest.json` records product/source hashes, dimensions and budgets;
  `reference-review.json` records reference sources, rights, measurements and
  review evidence. Reference photos are not embedded or shipped.

## Integration contract

Coordinates are native metres. Blender uses +X right, +Y forward, +Z up; glTF
uses +X right, +Y up, −Z forward. All parts and datums descend from
`ATTACHMENT_exps3`:

| Node | Exported local position (m) | Meaning |
| --- | --- | --- |
| `SOCKET_mount` | `[0, 0, 0]` | Rail-top mounting datum |
| `SOCKET_sight` | `[0, .0482, .0231]` | Provisional rear optical centre |
| `SOCKET_lens_rear` | `[0, .0482, .0231]` | Rear lens exterior centre |
| `SOCKET_lens_front` | `[0, .0482, -.0181]` | Front lens exterior centre |

The visual envelope is 58.400 × 73.700 × 96.470 mm (W/H/L). The jaw and rail
channel are visual approximations, not manufacturing tolerances. Runtime meshes
are `EXPS3_body` and `EXPS3_glass`; the latter contains both panes.

The 48.2 mm optical height is photo-derived and provisional. Verify mount
height, rail seating, rear-sight clearance, co-witness and ADS sight picture on
the intended weapon. The 68/1 MOA reticle is metadata only: project it in the
runtime optic rather than baking a visible floating mesh. Glass is a neutral
PBR approximation, not a spectral coating simulation.

## Rebuild and validate

Follow the [shared Blender workflow](../../../tools/blender/README.md). Blender
5.2.2 with working AgX color management is required for authoring; normal builds
use committed products and do not require Blender. Run from the repository root:

```sh
# Review in scratch space first; --quick lowers render samples only.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- \
  --output /tmp/exps3-review --render
# Regenerate native products.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py
# Cook the runtime GLB with the configured gltfpack.
npm run models:cook -- exps3
node tests/smoke/smoke-exps3.mjs
node tests/smoke/smoke-exps3-cook.mjs
npm test
npm run build
```

Review cameras are `left`, `right`, `front`, `rear`, `top`, `hero` and
`rear-quarter`. Same-host rebuilds were byte-identical for native GLB and
atlases, but this is not a cross-platform determinism guarantee. See
`reference-review.json` for the authoring-host OCIO workaround and visual
comparison limitations.
