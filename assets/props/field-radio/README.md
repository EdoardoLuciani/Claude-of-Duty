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
bun build/models.ts field_radio "$out"
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
  (select/send/stow bindings, charges or empty, request locks and cursor) and
  redraws only when the visible count or cursor changes.
  Stow, pause and restart retain the same model and canvas; viewmodel teardown
  disposes the owned geometry, materials and textures.

Keep the housing and LCD to one draw each, with no extra lights or transmission
passes. The [export check](../../../tools/blender/field_radio/check.py) enforces vertex and triangle limits.

Use `bun tools/capture.ts --shot=radio --out=.cache/radio.png` to review glove
seating and LCD legibility in daylight and darkness, with charges available and empty.
