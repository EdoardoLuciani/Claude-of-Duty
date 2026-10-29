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
| Native static-surface consolidation after saving editable assemblies   | `export.py`: `consolidate_static_surfaces`              |
| Opaque/base/ORM finish bake on UV1, with unchanged normal UV0          | `finish_atlas.py`: `bake_finish_atlas`                  |

Read-only inputs are `assets/weapons/fn-evolys-762/hand-reference.json` and shared
`assets/player/arms/player-arms.blend`; photo-review data freezes registration,
not geometry. Refit only with `node tools/evolys-hand-reference.mjs` as an
intentional calibration change. `evolys_actions.author_review_hands` also serves
MPX and is not a weapon-local API.

Preserve assembly order and rubber/canvas/metal **normal UV0** partitions.
The export-only finish bake writes base color/ORM on UV1 without reprojecting
normal detail. Three seeded source maps stay packed in the editable blend; the
export embeds the unchanged normal and two baked finish maps. Temporary PNGs
are removed. Save the editable preview with sparse Bezier actions/review skins
before runtime preparation. Preserve the **120 Hz** integer-frame lattice and
held `ceil(end)` sample at the exact endpoint: Fire/Last_Shot are **60/700 s**
before float32 encoding. Constant channels keep two endpoint samples and STEP;
other motion is LINEAR. Keep TRS resets on controls/belt bones. Stock Actions
export merges matching NLA names, without broadcasting unused armature actions.

Keep one eight-joint/one-primitive belt at 12.7 mm pitch. Brass, projectile and
link finishes occupy separate atlas tiles, not separate draws. Runtime owns persistent
remaining-round masks, the departing last round and insertion/reset behavior;
native constant channels must never resurrect spent ammunition.

## Native/export optimization

The recipe uses two bevel segments instead of three at the same radii. Native
triangles fall from 74,888 to 53,059 without removing markings, rails, vents or
mechanical parts. Close-up bevel profiles are slightly coarser. After saving the
editable assemblies and sparse Actions, the export joins receiver, handguard and
optic surfaces with identical rigid motion. Stock remains separately measurable;
cover, trigger, charging slider, bolt, both independent pouches and belt retain
all original controls and skinning. Named controls/sockets remain. The three
static mesh names exist in the editable blend; exported geometry is `static_surfaces`.

The export then bakes all ten source finishes into shared 1024² base/ORM maps,
with one opaque material and a separate alpha lens. UV1 addresses ten 256² tiles,
each with an eight-pixel gutter and 240² interior. Base samples are multiplied
by their source factors in linear light; roughness/metallic factors enter the
ORM channels. Four-by-four area sampling slightly subdues fine base/rough noise.
There is **no normal-map resampling, UV0 change, strength adjustment or lighting/
exposure compensation**. Geometry lettering remains geometry, not baked text.
Original materials and images stay editable in the saved blend.

| Profile                                 | Native triangles | Primitive instances | Materials | Native bytes | Runtime bytes |
| --------------------------------------- | ---------------: | ------------------: | --------: | -----------: | ------------: |
| Original                                |           74,888 |                  35 |        10 |    9,320,692 |             — |
| Bevel/static-only fallback (`c7e5c93b`) |           53,059 |                  26 |        10 |    8,140,248 |     3,854,832 |
| Finish atlas                            |           53,059 |                  10 |         2 |    7,735,012 |     3,166,568 |

The atlas keeps three 1024² maps: texture texel memory does not increase. UV1
raises measured decoded CPU vertex/index arrays from 1,845,070 to 2,321,350 bytes
in the cooked asset (+476,280 B); this is not a GPU-allocation measurement.
The trade buys 16 fewer total submissions, eight fewer materials and a smaller
runtime file. A 2048² base/ORM trial had the same submission count but 11,523,492
native bytes and **three times** the total texture texels (normal stays 1024²),
so it was rejected. No extra rigid mechanical skin is required for this gain;
independent pouch visibility, cover and belt mechanics remain straightforward.

`fn-evolys-762.runtime.glb` uses gltfpack 1.3 and `build/models.mjs`'s
`GLTFPACK_FLAGS`, with **no additional flags**. The cook retains 51,793 unique /
52,977 instantiated triangles and ten primitive instances. Earlier fallback
trials `-si 0.75 -se 0.0002 -sp` and `-si 0.5 -se 0.0005 -sp` saved only 29,356 /
83,416 bytes and increased gzip size; no extra simplification was selected.

The adapter retains its native load path pending shared-loader integration.
`makeEvolysModel` accepts the decoded runtime candidate and recovers Idle's
manifest duration **only** for an entirely constant, single-t=0-key,
zero-duration fold. Nonzero/moving/malformed clips are not repaired silently.
Both smoke scripts exercise both exports. Exact pre-atlas oriented geometry,
normal XYZ, UV0 and skin hashes, baked finish channels, every round's three
finish regions, actual collapsed ammunition vertices, fractional endpoints,
STEP visibility and 240 Hz control/contact parity are checked. Pouch clearance
selects the original black/fabric surfaces by atlas tile instead of material name;
it does not enlarge the enclosure across empty space below the mounting tongue.
CPU AgX comparisons cover studio sides, feed/optic/markings close-ups and reload
poses. Final native-WebGPU/KTX2 visual review and human sign-off remain required.

## Approved UV precision exception

The measurements and bounded WebGPU review below refer to the historical
74,888-triangle / 35-primitive source, not the optimized bevel/export profile.
The same UV rounding rule is retained, without repacking or reprojecting maps.

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
