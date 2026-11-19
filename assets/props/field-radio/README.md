# FR-12 field radio

Held first-person prop, original game art. Two moulded shells, perimeter gasket,
recessed speaker perforations, captive screws, sealed keys, indexed encoder and
stepped whip form the silhouette and distinguish the controls. The satin polymer,
rubber, anodized collars and exposed screw heads use one UV atlas material. The
albedo carries printed markings, grille perforations, grain and narrow contact
wear; the separate packed map varies roughness and metalness. The LCD is an
opaque dielectric cover with no baked UI, transparency, or transmission pass.

## Build and check

Input: `tools/blender/field_radio/build.py` only. Its seeded paint and PBR atlases
are generated and packed into the editable blend; no external fonts, textures,
weapons, arm blends, or world files are required. Blender 5.2.2 exports the native
GLB using its stock exporter. The editable blend keeps the individual components;
the export joins the housing into one draw and retains the LCD separately.

```sh
# From repository root; repeat in a second empty directory to compare exports.
out=$(mktemp -d)
blender -b -t 2 --python-exit-code 1 --python tools/blender/field_radio/build.py -- --output "$out"
bun run models:cook -- field_radio "$out"
blender -b "$out/field-radio.blend" -t 2 --python-exit-code 1 \
  --python tools/blender/field_radio/check.py -- "$out/field-radio.glb" "$out/field-radio.runtime.glb"
```

Omit `--output` and the cook directory to rebuild the normal ignored products:
`field-radio.blend` and `field-radio.glb` here, and
`public/models/player/field-radio.runtime.glb` for play. `bun run build` and
`bun run dev` rebuild these when the recipe or cook flags change. The cook uses
ETC1S for the two static atlases and `-kv` so the untextured screen retains UVs.
The native and cooked GLBs from two clean same-host builds were byte-identical.

## Datums and runtime ownership

- `GRIP_radio`: identity datum at the original grip origin. Metres, +Y up the
  body, +Z toward the screen. Housing is ~51 × 106 × 37 mm; total height with
  the whip is ~191 mm. `Radio_housing` is the static finish primitive.
- `SCREEN_radio`: separate opaque mesh/material, +Z facing, aperture 39.6 ×
  19.8 mm. UV0 spans the aperture with the rounded corners trimmed. glTF top-left
  UVs receive a `CanvasTexture` with `flipY = false`.
- `viewmodel.ts` seats the case against the glove; the tilt and thumb offset
  keep the upper controls out of the closed hand. The wrist target is a fixed
  camera-space close-up that turns the LCD toward the eye. `radio-mesh.ts` binds
  the 256 × 128 sRGB canvas to the LCD emissive map; it is the radio interface
  (charges or empty, request bindings and locks, stow binding) and redraws only
  when the visible count changes.
  Stow, pause and restart retain the same model and canvas; viewmodel teardown
  disposes the owned geometry, materials and textures.

## Measured held budgets

| Prop only | Before | FR-12 |
| --- | ---: | ---: |
| Draws / materials (native view pass) | 14 / 5 | 2 / 2 |
| Triangles / vertices | 246 / 397 | 1,206 / 1,648 |
| Loaded index + attribute bytes | 14,180 | 46,788 |
| Resident texture payload (including LCD mips, RDNA 4 BC7) | ~171 KiB | ~597 KiB |
| Dedicated runtime GLB | None | 76,424 B |

The extra geometry gives the housing curved corners, seating/recesses and a
shaped antenna/encoder. Extra texture memory buys the static labels, grille,
material variation and visible wear while keeping one housing draw. The prop
reduces native submissions and reuses the LCD allocation instead of replacing it.
No extra lights or transmission passes. Texture payload excludes driver allocation
padding; it is not a whole-renderer memory measurement.

At 1920 × 1080 high quality on AMD RDNA 4 native WebGPU, a frozen gameplay
fixture alternated held/hidden for 96 measured frames of each. Median whole-graph
CPU submit was 3.9/3.7 ms before and 4.5/4.4 ms with the FR-12; GPU render-pass
sum was 5.666/5.658 ms before and 5.637/5.626 ms after. The median within-pair
held-minus-hidden CPU delta was 0.1 ms before and 0.0 ms after; the GPU delta
(0.003/0.020 ms) was small relative to variability. These are not isolated prop
GPU times or evidence of a whole-frame speedup.

Use `bun run shot -- --shot=radio --out=.cache/radio.png` for held context.
Review a matched close-up by cropping the view camera (without moving either
camera), daylight and streetlight/night, and both available/empty request rows.
Check glove seating and controls independently of screen text, and compare the
finish next to the current M4. In-engine captures do not replace human approval.
