# EVOLYS source map

[Shared authoring workflow](../README.md) ·
[Asset, references and build/check commands](../../../assets/weapons/fn-evolys-762/README.md)

| Concern                                                                | Source                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Seeded maps, finishes, named assemblies, atlas, studio and build/paths | `../evolys_762.py`: `build` / `main` and named sections |
| Eight-bone skinned belt, pitch, links and weights                      | `belt_pos` and belt construction in `build`             |
| Final source UV precision                                              | Binary-grid loop after atlas assignment                 |
| Eight sparse actions, hands and events                                 | `../evolys_actions.py`: `author_actions`                |
| Runtime lattice, endpoint/STEP preparation and read-only assertions    | `export.py`: `prepare_export_actions`                   |

Read-only inputs are `assets/weapons/fn-evolys-762/hand-reference.json` and shared
`assets/player/arms/player-arms.blend`; photo-review data freezes registration,
not geometry. Refit only with `node tools/evolys-hand-reference.mjs` as an
intentional calibration change. `evolys_actions.author_review_hands` also serves
MPX and is not a weapon-local API.

Preserve assembly order and rubber/canvas/metal atlas partitions, not MCX planar
projection or P320 baking. Three seeded maps are packed/embedded; temporary PNGs
are removed. Save the editable preview with sparse Bezier actions/review skins
before runtime preparation. Preserve the **120 Hz** integer-frame lattice and
held `ceil(end)` sample at the exact endpoint: Fire/Last_Shot are **60/700 s**
before float32 encoding. Constant channels keep two endpoint samples and STEP;
other motion is LINEAR. Keep TRS resets on controls/belt bones. Stock Actions
export merges matching NLA names, without broadcasting unused armature actions.

Keep one eight-joint/three-primitive belt at 12.7 mm pitch. Runtime owns persistent
remaining-round masks, the departing last round and insertion/reset behavior;
native constant channels must never resurrect spent ammunition.

## Approved UV precision exception

Unmodified Blender-host builds varied by up to `1.1920928955078125e-7` in
modifier-interpolated UVs. Explicitly approved rounding to nearest **1/16384**,
ties-to-even, runs after modifiers/consolidation/atlas assignment and before save/
export. Maximum measured displacement: **0.000030517578125 UV = 0.03125 texel**
at 1024 across all 35 primitives, without repacking/reprojection.

This is **not exact seam or tangent-frame preservation**: 34 subprecision
multiplicity groups collapse; 132 index entries substitute equal-position/normal/
skin duplicates across belt primitives, optic rubber and receiver rubber.
Counts, oriented triangle geometry, normals, joints, weights and bind order remain.
UV zero-area triangles increase 6,594 → 7,188, all collapsed to lines, with no flips:

| Surface                | Newly collapsed UV triangles | With nonzero 3D area |
| ---------------------- | ---------------------------: | -------------------: |
| Belt brass             |                           37 |                   37 |
| Belt projectile jacket |                          452 |                  452 |
| Coated lens            |                           11 |                    7 |
| Pouch fabric           |                           30 |                    0 |
| Spare-pouch fabric     |                           30 |                    0 |
| Receiver rubber        |                           34 |                   34 |
| **Total**              |                      **594** |              **530** |

The 530 nondegenerate 3D triangles total approximately **2.668 mm²**; the other
64 already have zero 3D area. No authored tangents exist. Native normal-map UV
derivatives can therefore change local shading despite identical normals/maps.
This exception is not a new tolerance; repeatability is host/version-local and
future rounding may straddle boundaries.

For frozen GLB `4761054b36677078af9a17fcf8befbf88be8a51b1b5975cb0c927d4770d1fbb8`,
no visible regression was detected in six matched AMD RDNA-4 hardware-WebGPU views:
hip, belt side/projectile oblique, lens front/oblique and receiver rubber. Close-ups
were diagnostic cameras, with normal prewarm/maps/materials and matched lighting/
exposure. Central 920×530 crops differed by at most 3/255 RGB (2/255 hip/lens/rubber);
the full belt-side image had two edge pixels at 5/255 and 16/255. Small existing
animation-rounding differences remain, so these were not UV-only renders. Both
runs retained TSL inline-return/zero-count warnings without captured errors.
This bounded observation is not pixel identity, all-state/device shading equivalence
or final human visual approval.
