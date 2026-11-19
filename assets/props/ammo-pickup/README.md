# Field supply ammo case

Original game art: a seam-welded pressed-steel case with rolled lid and seal,
side strengthening presses, paired stamped toggle latches, rear hinge knuckles
and a folded carrying bail. The yellow supply stencil reads from above and in
front; the finish distinguishes painted steel, primer, exposed metal, ink and
rubber. Wear is concentrated near exposed edges and handling points. The case
stays closed. The amber recognition ring is separate and runtime-owned.

## Source and standalone build

Inputs are [`build.py`](../../../tools/blender/ammo_pickup/build.py) (shape,
part layout, normals and UVs) and [`finish.py`](../../../tools/blender/ammo_pickup/finish.py)
(deterministic atlas generation). No photograph, font, other asset or previous
export is required. Blender 5.2.2 supplies NumPy and the native glTF exporter.
With gltfpack 1.3/BasisU on `PATH`, run from the repo root:

```sh
out=$(mktemp -d)
blender -b -t 2 --python-exit-code 1 --python tools/blender/ammo_pickup/build.py -- --output "$out"
bun run models:cook -- ammo_pickup "$out"
blender -b "$out/ammo-pickup.blend" --python-exit-code 1 --python tools/blender/ammo_pickup/check.py
```

The `.blend` preserves individually named component meshes and both packed
atlases. The native export joins only an in-memory copy, then gltfpack cooks
that GLB with meshopt and UASTC/KTX2. `bun run assets`, `bun run dev` and
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

| Per case, excluding the unchanged ring | Procedural baseline | Authored |
| --- | ---: | ---: |
| Opaque materials / draws per pass | 3 | 1 |
| Indexed triangles | 48 | 442 |
| Exported runtime vertices | 96 | 728 |
| Cooked asset on disk | — | 87,072 B |
| Shared atlas payload on BC-capable WebGPU, including mips | 0 B | 109,280 B |

The 256² sRGB base-color and 128² linear packed roughness (G) / metalness (B)
atlases retain markings and directional wear without decal meshes, extra
materials or a normal-map sample. Geometry is reserved for the stepped lid,
corner normals, side presses and hardware that change the silhouette or catch
light. The case/ring together submit 24,896 triangles in one beauty pass with
all 32 slots populated (12,288 for the procedural baseline). The same scene
submits 6 instead of 16 pickup draws including beauty, opaque prepass and the
three observed shadow cascades. The two instance buffers reserve 4,096 B total
instead of 8,192 B (excluding Three's internal previous-matrix buffers).

A 1280×720 High-quality full-pool diagnostic on hardware RDNA 4 alternated the
baseline and authored pools in the same renderer (192 frames each). CPU submit
including pickup matrix/bounds sync was 5.20/6.80 ms vs 4.40/6.20 ms (p50/p95);
native render-pass sums were 3.208/4.024 ms vs 3.109/4.024 ms. These measurements
include surrounding world work, exclude GPU copies, compute, queue wait and
presentation, and fluctuate with the host. The confirmed optimization is draw
consolidation, not a claim of faster GPU frame time. Review normal approach and
close-up views in native WebGPU, in daylight and darkness, with the ring enabled
and all slots occupied for the pool view.
EOF