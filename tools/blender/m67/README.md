# M67 — rigid game prop

Original exterior game art, not a functional model. The rounded shell, low seam,
rolled spoon and the silhouetted ring are geometry; the yellow stencil and rim
paint, scratches, and chipped enamel are baked into one shared finish. The
markings are artwork, including the fictional lot code. There are no animated
parts, internal surfaces, sockets, player arm inputs or extra shadow casters.

## Build and check

From the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
review=$(mktemp -d)
blender -b -t 2 --python-exit-code 1 --python tools/blender/m67/build.py -- --output "$review"
blender -b "$review/m67.blend" -t 2 --python-exit-code 1 --python tools/blender/m67/check.py
bun build/models.ts m67 "$review"
```

`build.py` owns the shape and UVs; `finish.py` owns the seeded atlas artwork.
The native exporter writes `m67.blend` and `m67.glb` by default here. The cook
packs meshopt geometry and two KTX2 maps (base color and metallic/roughness)
into `public/models/weapons/m67.runtime.glb`. These are ignored products, not
input files. `bun tools/build-assets.ts`/`bun run build` hash the standalone recipe, check
and cook profile independently of the arm and firearm recipes.

## Grip and instance space

`MESH_grenade` is one opaque rigid primitive in game metres, unscaled, with its
origin at the body centre, top along +Y and spoon toward −X. The silhouette spans
about 101 × 142 × 92 mm (X/Y/Z; includes the exterior details). The viewmodel
palm attachment retains its current seat, angle and view-only scale. The world
mesh stays unit scale at the same body-centre pivot; the existing release point
and physics bounds are unchanged. The held, player-thrown and AI instances borrow
one geometry, material and map pair. Weapons warm both render passes before play
and own the asset through restart; AI never loads or disposes it.

The [source check](check.py) enforces the triangle
budget. Use the `grenade`, `grenadeCook*` and `grenadeThrow*` shots to check the
held pose, then review player and AI world instances in daylight and artificial light.
