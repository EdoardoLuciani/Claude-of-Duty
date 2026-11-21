# Field supply ammo case

Original game art: a seam-welded pressed-steel case with rolled lid and seal,
side strengthening presses, paired stamped toggle latches, rear hinge knuckles
and a folded carrying bail. The yellow supply stencil reads from above and in
front; the finish distinguishes painted steel, primer, exposed metal, ink and
rubber. Wear is concentrated near exposed edges and handling points. The case
stays closed. The amber recognition ring is separate and runtime-owned.

## Source and standalone build

Inputs are [`build.py`](build.py) (shape,
part layout, normals and UVs) and [`finish.py`](finish.py)
(deterministic atlas generation). No photograph, font, other asset or previous
export is required. Blender 5.2.2 supplies NumPy and the native glTF exporter.
With gltfpack 1.3/BasisU on `PATH`, run from the repo root:

```sh
out=$(mktemp -d)
blender -b -t 2 --python-exit-code 1 --python tools/blender/ammo_pickup/build.py -- --output "$out"
bun build/models.ts ammo_pickup "$out"
blender -b "$out/ammo-pickup.blend" --python-exit-code 1 --python tools/blender/ammo_pickup/check.py
```

The `.blend` preserves individually named component meshes and both packed
atlases. The native export joins only an in-memory copy, then gltfpack cooks
that GLB with meshopt and UASTC/KTX2. `bun tools/build-assets.ts`, `bun run dev` and
`bun run build` also author/cook it (stale source/product detection, no dependency
on arms or weapon builds). Normal outputs are `ammo-pickup.blend` and
`ammo-pickup.glb` here, and `/models/props/ammo-pickup.runtime.glb` under
`public/`. Do not commit any product. `check.py` checks the adjacent native and
cooked exports in the scratch directory above.

## Runtime contract and budget

One rigid identity mesh node, `Ammo_Case`, with one opaque PBR primitive and no
animation. Metres, +Y up, +Z on the latch side. Origin stays at the pickup datum:
case bounds X ±0.201 m, Y 0.025–0.260 m and Z −0.144–0.151 m. Do not recenter the
case or add the ring in Blender. The weapons system loads the cook once and owns
one case batch and one ring batch, with immutable shape/finish data and dynamic
instance matrices. The world-camera opaque prepass validates stable slot history;
shadow passes and the ring do not. Restart retains the shared GPU resources;
weapon-system teardown releases the geometry, materials, atlases and instance
buffers.

Keep one draw per batch, with a 256² sRGB base-color map and a 128² packed
roughness/metalness map on the case. The [export check](check.py)
enforces vertex and triangle limits. Review with the ring enabled and all slots occupied.
