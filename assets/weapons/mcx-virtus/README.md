# MCX VIRTUS / .300 BLK

Blender-authored shop primary: short handguard, 9-inch barrel configuration,
suppressor, folding/telescoping-style stock and TA31-style ACOG. Original game art
and generated textures; no third-party model/texture assets. SIG SAUER/MCX/VIRTUS
and Trijicon/ACOG identify the subjects, not endorsement. Branding may require
separate commercial review; this is not manufacturing geometry.

## Maintained assets

- `mcx-virtus.blend`: editable components, rigid-part rig, packed textures and cameras.
- `mcx-virtus.glb`: self-contained runtime mesh, textures and animations.
- `manifest.json`: export counts, durations and mechanical event timings.
- `textures/`: generated 1024² surface variation, roughness and +Y micro-normal maps.

`src/weapons/mcx.js` converts glTF +X forward/+Y up into weapon coordinates,
samples idle/fire/reloads/inspect and maps mechanical beats to gameplay events.
Draw/holster remain shared procedural clips. Stock folding is showcase-only.
Runtime arms, scope/reticle, sound and pooled casings are supplied by the game.
The baked showcase casing is hidden. Normal builds need no Blender.

## Rebuild and check

From the repository root, using Blender 5.2:

```sh
blender -b --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tools/smoke-mcx.mjs
node tools/smoke-mcx-game.mjs
node tools/check-mcx-game.mjs
```

Regeneration overwrites the source, GLB, manifest and maps, not game/world code.
Blender exports need not be byte-identical across Blender versions. Optional
stills: generator `--render` (or `--render --quick`). For saved-source poses use
`tools/blender/mcx_review.py -- --clip Fire --frame 8 --camera receiver_detail`;
`--reel` additionally needs FFmpeg. Review output directories are ignored.

All moving objects must select matching NLA tracks. Magazine visibility uses
STEP zero/unit scales; runtime additionally hides inactive meshes. Avoid blending
reloads. This is a first-person asset, with no world-weapon LOD or collision mesh.
