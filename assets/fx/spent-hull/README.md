# Spent shotgun hull

Inert M590 ejection game art. The Blender recipe in
[`tools/blender/spent_hull/`](../../../tools/blender/spent_hull/) is authoritative
and builds from factory empty. It has no external maps, saved-scene inputs or
M590 build dependency; its red and brass palette follows the M590 insertion round.
The mesh shapes the fired crimp, open mouth, recessed strike and longitudinal
ridges. Vertex finishes add a dark inner wall, rubbed print, heat discoloration
and brass burnish without textures or microgeometry.

## Rebuild and check

```sh
out=$(mktemp -d)
blender -b -t 2 --python-exit-code 1 --python tools/blender/spent_hull/build.py -- --output "$out"
blender -b -t 2 "$out/spent12g.blend" --python-exit-code 1 --python tools/blender/spent_hull/check.py
bun tools/blender/spent_hull/cook.ts "$out/spent12g.glb" "$out/spent12g.runtime.glb"
cmp "$out/spent12g.glb" "$out/spent12g.runtime.glb"
```

Use Blender 5.2.2 and its native glTF exporter. Repeat in a second empty directory
and compare the native exports with `cmp`. `bun run assets` / `bun run dev` /
`bun run build` run the standalone `spent-hull` step when its inputs change or a
product is missing. Normal builds write the `.blend` and native `.glb` next to
this README and publish `public/models/fx/spent12g.glb`. All products are ignored.

The cook verifies the runtime vertex contract with Three's loader and publishes
the native bytes unchanged. The pinned gltfpack drops `_SHELLPBR` even with `-kv`.
Three reads Blender's uppercase semantic as `_shellpbr`. `COLOR_0` is linear
normalized color; the custom float pair carries metalness and roughness.
Plastic and metal values stay discontinuous at the seam. No maps or UVs are used.

## Casing-pool contract

`spent12g` is the only mesh, at identity, in the 45 mm length / 4.95 mm rim-radius
**game reference basis**. Its origin is centered along the length. The mouth
points +Y in glTF (+Z in Blender). `weapon:shell` scales length and radius
independently to the M590's authored in-game proportions (70 mm / 11.05 mm).
The pool uses its own shared vertex-finish material and draws the hulls once per
relevant world pass. The Blender material previews the same vertex finishes.

| Per-hull asset metric | Baseline | Blender hull |
| --- | ---: | ---: |
| Indexed triangles submitted (nondegenerate) | 768 (640) | 596 (596) |
| Exported vertices | 462 | 408 |
| Geometry attribute + index bytes | 28,632 | 19,896 |
| Runtime GLB bytes | 30,452 | 21,176 |
| Primitives / materials | 1 / 1 | 1 / 1 |
| Texture bytes | 0 | 0 |

Geometry bytes are the loaded typed-array lengths, excluding driver padding and
the shared instance buffer. At full pool occupancy, each world pass submits
8,344 hull triangles, down from 10,752 (one instanced draw in both cases). For visual signoff, compare airborne and resting
hulls, a rapid M590 sequence, and close mouth/primer views in daylight and
artificial light. Match camera, pose and exposure, and inspect the red against
the M590 insertion round. Source checks do not replace human in-engine review.
