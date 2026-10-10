# MCX VIRTUS / .300 BLK

Original Blender-authored shop primary: gray 9-inch VIRTUS, short factory M-LOK
guard, folding/telescoping stock, direct-thread SRD762Ti, TA31F/TA51 and MAG800.
[Reference authority, dimensions, caveats and open visual approval](FIDELITY_AUDIT.md).
No downloaded mesh/maps, endorsement, commercial branding permission or CAD claim.

`mcx-virtus.blend`: editable rig/components/packed maps; `.glb`: runtime asset;
`manifest.json`: counts/events; `textures/`: generated 1024² PBR maps.
`src/weapons/mcx.ts` converts GLTF +X-forward/+Y-up and samples idle/fire/reloads/
inspect. Draw/holster stay procedural; folding is showcase-only. Game supplies
arms, scope/reticle, sound/live casings; baked showcase case stays hidden.
Existing ballistics/reticle are not real TA31F 5.56 BDC. No world LOD/collision mesh.

## Rebuild/check (root, Blender 5.2)

```sh
blender -b --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tests/smoke/smoke-mcx.mjs
node tests/smoke/smoke-mcx-game.mjs
node tests/e2e/check-mcx-game.mjs
```

Generator overwrites source/GLB/manifest/maps; normal builds need no Blender.
Exports need not be byte-identical across versions. `--render [--quick]` adds
stills; `mcx_review.py -- --clip Fire --frame 8 --camera receiver_detail` reviews
saved source (`--reel` needs FFmpeg). Previews use Eevee raster, ray tracing off,
working GPU context; compare identical backends/settings, not historical Cycles.

Caps: **<110k triangles**, ≤40 primitives, ≤16 materials, three 1024² maps, ≤10 MiB.
Preserve dimension, vent, complete-magazine, hinge/handle and optic seating checks
listed in the audit. All moving controls need matching NLA tracks. Magazine
visibility uses STEP zero/unit scale plus runtime hiding; avoid reload blending.
Borrowed textures retain owner lifetime; material slots are not draw calls.
