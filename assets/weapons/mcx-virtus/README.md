# MCX VIRTUS / .300 BLK

Blender-authored shop primary: gray 9-inch VIRTUS configuration with the short
factory M-LOK handguard and folding/telescoping stock, SRD762Ti direct-thread
suppressor, TA31F/TA51 exterior and MAG800 .300 BLK magazine. Exterior dimensions
are checked against published specifications; unpublished contours and typography
remain reference-informed approximations, not a pixel-identical or manufacturing
replica. Reference sources, measurement caveats and the audit are in
[FIDELITY_AUDIT.md](FIDELITY_AUDIT.md). Original game art and generated textures;
no third-party model/texture assets. SIG SAUER/MCX/VIRTUS
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
The TA31F's real 5.56 BDC behavior is not reproduced: gameplay reticle, ballistics
and balance are unchanged. Runtime arms, scope/reticle, sound and pooled casings
are supplied by the game.
The baked showcase casing is hidden. Normal builds need no Blender.

## Rebuild and check

From the repository root, using Blender 5.2:

```sh
blender -b --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tests/smoke/smoke-mcx.mjs
node tests/smoke/smoke-mcx-game.mjs
node tests/e2e/check-mcx-game.mjs
```

Regeneration overwrites the source, GLB, manifest and maps, not game/world code.
Blender exports need not be byte-identical across Blender versions. Optional
stills: generator `--render` (or `--render --quick`). For saved-source poses use
`tools/blender/mcx_review.py -- --clip Fire --frame 8 --camera receiver_detail`;
`--reel` additionally needs FFmpeg. Review output directories are ignored.

The approved export limits are **strictly fewer than 110,000 triangles**, at most
40 GLB primitives, 16 unique materials, three 1024-square images and 10 MiB GLB.
`smoke-mcx.mjs` enforces them. The Blender geometry check independently verifies
TA31F/SRD762Ti exterior dimensions, the PDW guard's nominal length, supported
moving parts and closed vent rims. Manifest material slots are not draw calls.

All moving objects must select matching NLA tracks. Magazine visibility uses
STEP zero/unit scales; runtime additionally hides inactive meshes. Avoid blending
reloads. This is a first-person asset, with no world-weapon LOD or collision mesh.
