# ACOG TA31F / TA51

`tools/blender/acog/{geometry,build}.py` owns the complete standalone optic.
It builds from an empty scene, never a generated weapon blend or GLB. The original
MCX primitive, material and planar-UV recipes remain shared source under
`tools/blender/mcx/`; they preserve the original geometry and packed surface maps.
`bun run assets` builds and cooks the optic independently of every weapon.

```sh
blender -b --python-exit-code 1 --python tools/blender/acog/build.py
bun run models:cook -- acog
```

## Extraction equivalence (#662)

Before removing the integrated optic, the old `optics.py` extraction was run on
a fresh MCX source from `c7c7946a`, then compared with the empty-scene build on
Blender 5.2.2. All 15,172 oriented triangles, positions and normals match exactly;
UV differences from saved-source evaluation are at most **2.3841858e-7**.
Material JSON and both `MOUNT_base` / `SOCKET_sight` transforms match exactly.
All three embedded PNG byte hashes match (SHA-256):

- `micro_normal`: `3e35643ef749eb4faacb5ee67a6d8e1c2be4788e1702d147ba625334c80ed4e6`
- `surface_variation`: `89144794c0e7222d5135a50c6381e620d9a01a5cc3f99d681fc5160b5b18d136`
- `roughness_variation`: `38426dfd196c04393a684919a90077e289a38e33fe6620d01986beeb68256fdc`

Comparison canonicalized triangles by material and cyclic corner order, retaining
winding, normals and UVs; it did not depend on join/index order or GLB byte identity.
These are same-host extraction receipts, not cross-platform bitwise guarantees.

Mount/sight datums, glass policy, tuning ownership and supported weapon/iron-sight
combinations follow the [shared attachment contract](../../../ARCHITECTURE.md#models).
