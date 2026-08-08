# Blender world round-trip parity

Validated during the Blender authoring cutover at 960×540, 20 deterministic
lockstep settle frames per shot.

## Structural gates

| metric | procedural reference | Blender export |
|---|---:|---:|
| world draw calls | 220 | 220 |
| instances | 8,008 | 8,008 |
| static triangles | 606,374 | 606,374 |
| instanced triangles | 1,146,484 | 1,146,484 |
| collision triangles | 38,580 | 38,580 |
| collision meshes/surfaces | 8 | 8 |

The source validator also confirms 184 retained instance batches and 7,666
per-instance colour-mask records. Production build and browser boot pass with
manifest v2 and committed Blender outputs.

## Pixel gate

All eleven procedural-reference shots were compared with
`tools/imagediff.mjs --tol=1`. The worst changed-pixel rate was 0.4504% (`hud`),
with mean maximum-channel delta 0.053/255. Most changes are isolated one-pixel
edge differences caused by Blender's float32 coordinate/normal round trip. The
largest isolated delta occurred on 0.0345% of the combat frame. No composition,
material, lighting, or collision change was observed.

Manifest-v1 versus manifest-v2 Blender output was additionally checked on hero,
interior, and HUD shots: HUD was pixel-identical; hero/interior differed only by
1 code value on at most 0.0035% of pixels.

This epsilon is the accepted one-time source-format migration baseline. Future
world changes should compare against the Blender-authored baseline, not the
removed procedural generator.

## Functional gates

- `npm run world:validate`: pass.
- `npm run world:source:validate`: pass.
- `npm run build`: pass without launching Blender.
- Browser capture: pass, correct north-street initial spawn.
- Physics self-test: 55/55 checks pass, including stairs, walls, BVH, capsule
  movement, penetration, rigid bodies, and determinism.
