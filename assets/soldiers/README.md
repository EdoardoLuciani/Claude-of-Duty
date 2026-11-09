# Procedural soldier assets

Authoritative geometry: [`tools/blender/soldiers/build.py`](../../tools/blender/soldiers/build.py).
See the [authoring commands and contracts](../../tools/blender/soldiers/README.md).
The recipe builds factory-empty with Blender **5.2.2** and supports all uint32
seeds. Native primitives, sewn cloth sections and modifiers replace the old
TypeScript builder; visual differences are intentional, not a pixel-perfect port.

- **Vanguard:** covered helmet, down goggles, fabric wrap, full carrier and carbine.
- **Irregular:** tied headwrap, shooting shades, chest rig and long wood-tone AK.
- **Breacher:** bare helmet, parked goggles, hard half-mask and full carrier.

`src/ai/rig.ts` and `soldier.ts` remain the rig, variant and surface authorities.
`reference.ts` serializes that calibration explicitly. Geometry generation reads
no old GLB, blend or cached mesh. Editable blends are review products, not fallback
inputs; put lasting edits into the recipe. Runtime IK, animation, textures,
materials, hitboxes and AI logic retain their existing owners.

## Regenerate and review

```sh
# First author into an empty absolute scratch directory:
bun tools/blender/soldiers/export.ts --output /tmp/soldier-review
# Optional --seed 0x5eed1234 --blender /absolute/path/to/blender
# After structural, in-engine material and pose review, regenerate canonical files:
bun tools/blender/soldiers/export.ts --output "$(pwd)/assets/soldiers"
bun run models
bun run test
bun run build
```

The explicit author command stages the complete family before publishing
`<name>.blend`, `<name>.glb`, `<name>.json` and the final `manifest.json`. Node's
existing GLTFExporter encodes newly generated mesh data, preserving canonical
joint order, FLOAT colors and four weights without Blender exporter hooks or GLB
repair. The five weapon sockets derive from the authored rifle frame.

The manifest binds declared source content, Three revision and product hashes.
Source text and JSON hashes normalize LF/CRLF; binary hashes remain exact.
Changing a declared recipe/calibration input requires regeneration. Missing,
stale or corrupt products fail visibly rather than silently rebuilding/falling
back. Products are ignored, not committed: `bun run dev` / `bun run build`
regenerate them when inputs change, then stage GLB/JSON to ignored public URLs.

Same-host repeated generation is checked; blend bytes need not match and there
is no cross-platform bitwise or old-pixel guarantee. Rig/skin/surface/socket
contracts, runtime material acceptance and real animation/ladder clearance checks
remain required. Commit the recipe; never hand-edit the manifest or runtime files.
