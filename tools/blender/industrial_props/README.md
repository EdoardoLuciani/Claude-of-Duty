# Industrial world props

`build.py` authors the precast concrete barrier in Blender as a closed solid with
a flared base. The fork pockets are cut into the mesh, not layered over it. It
carries no range-specific markings.

`tools/worldgen/industrial-props-meshes.ts` is a compact, checked-in mesh bake.
The world exporter imports it through `industrial-props.ts` wherever a layout
uses the barrier; dev, CI and clean world builds do not run Blender. The assembler
uses the same authored geometry for instanced visuals and collision cooking and
supplies the world concrete palette.

Rebake from the repository root with Blender 5.2.2:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/industrial_props/build.py -- \
  --output tools/worldgen/industrial-props-meshes.ts
bun tests/smoke/smoke-industrial-props.ts
```

For a deterministic rebuild check, use a fresh Blender process with `--output`
pointing at a scratch file, then `cmp` it with the checked-in bake. Commit the
recipe and text geometry together. Do not commit binary assets, including `.blend`
files, exported GLBs, or raster previews.

`placeBarrier` takes level-space metres at the base centre and yaw in radians.
The smoke test checks the bounds, cooked top and the player's vault probe against
cooked collision.
