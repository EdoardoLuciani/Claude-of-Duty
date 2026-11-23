# Industrial world props

`build.py` authors the precast concrete barrier and steel transfer platform in
Blender. Each is a closed solid: the barrier has a flared base and the platform
has a recessed frame under a full deck. The fork pockets are cut into the
meshes, not layered over them. The platform has a dark industrial finish; neither prop carries range-specific markings.

`tools/worldgen/industrial-props-meshes.ts` is a compact, checked-in mesh bake.
The world exporter imports it through `industrial-props.ts` wherever a layout
uses either prop; dev, CI and clean world builds do not run Blender. The assembler
uses the same authored geometry for instanced visuals and collision cooking and
supplies the world concrete and steel palettes.

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

Placement helpers take level-space metres at the base centre and yaw in radians.
`placeBarrier` measures 2.4 m × 0.55 m in X/Z and rises 0.78 m. `placePlatform`
measures 3 m × 2 m in X/Z and rises 0.45 m. Use the deck height as the next
platform's base Y when stacking. The smoke test checks the bounds, cooked deck
and stack heights, and the player's ledge probe against cooked collision.
