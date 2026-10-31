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
| Ordinary static join after saving editable assemblies                  | `export.py`: `consolidate_static_surfaces`              |
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

## Ordinary rigid export (current)

The current recipe removes the export-only eight-joint mechanical skin. Only
receiver, handguard and optic are joined as `static_surfaces`, with ordinary
opaque/lens primitives. The stock stays in its native rotated local frame: no
bind-space triangulation, corner-normal carrier or custom-normal re-encoding is
needed. Bolt, charging handle, feed cover and trigger are ordinary meshes under
the original animated controls. No adapter, shader or other runtime code changes.
The existing deforming eight-joint belt and both independent STEP-owned pouches
are untouched. Source maps, atlas, UV rounding, hand calibration, sockets, event
and timing data are unchanged. The editable source is still saved before export.

Compared with immutable published base **d29573f8**:

| Metric                                     | Mechanical skin baseline | Ordinary rigid candidate |
| ------------------------------------------ | -----------------------: | -----------------------: |
| Materials / total / loaded-Idle primitives |                2 / 5 / 4 |               2 / 10 / 9 |
| Native / cooked instantiated triangles     |          53,059 / 52,977 |          53,059 / 52,977 |
| Native rigid attribute vertices            |                   49,695 |                   44,797 |
| Cooked rigid attribute vertices            |           44,025 skinned |          44,025 ordinary |
| Native / cooked belt vertices              |          13,184 / 13,184 |          13,184 / 13,184 |
| Skeletons / joints                         |                   2 / 16 |        1 / 8 (belt only) |
| Native raw / gzip-9 bytes                  |    8,975,480 / 4,422,826 |    7,735,012 / 4,384,205 |
| Runtime raw / gzip-9 bytes                 |    3,188,352 / 2,485,402 |    3,166,568 / 2,487,080 |
| Native unique CPU attribute/index bytes    |                4,271,158 |                3,081,338 |
| Runtime unique CPU attribute/index bytes   |                2,673,550 |                2,321,350 |

Runtime CPU arrays fall by 352,200 B, but that is **not uploaded GPU memory**.
On r187 WebGPU, the removed 44,025 four-influence rigid streams are expected to
recover about **880,500 B** because non-normalized Uint8 joint IDs expand to
Uint32. Expected geometry is around 2,479,560 B versus the measured baseline
3,360,060 B (~26.2% less); parent must measure actual candidate uploads. No FPS
improvement is claimed; five more submissions and ordinary-object costs are an
explicit tradeoff. CPU index bytes stay 310,758 B in the runtime; no index-width
saving is claimed. Gzip-9 uses the same Node zlib level 9 for both products.

All three encoded native PNG and cooked KTX2 image payloads are unchanged.
Each is 1024²; runtime retains 11 mip levels. KTX2 payloads remain 1,068,530 B
normal, 575,258 B base, 508,056 B ORM. Logical compressed texture storage remains
4,194,384 B; there is no texture-memory saving or exposure/material retuning.

Two separate fresh exports and unchanged-profile cooks are byte-identical.
The pre-skin **875587a3** hashes independently protect every ordinary local
surface, belt and pouch; no candidate-generated geometry hashes were adopted.
The representation parity tool additionally compares immutable **d29573f8**:
all 53,059 oriented triangles, image bytes, exact UV0/UV1 and 491 poses /
33,173,433 mapped vertices. Maximum position drift is 3.744e-8 m; maximum normal
vector difference remains 0.0024999942, solely the already approved historical
mechanical-skin encoding loss documented below. There is no new normal exception,
retessellation or deliberate detail/silhouette change. Slight local shading can
differ when removing that historical encoding step; matched GPU review is pending.

The dense ownership test keeps the **same 3,415 native / 3,409 cooked pose/time
sets**, all actual ordinary rigid vertices, endpoint/STEP checks and unchanged
2 µm / 40 µm gates. Actual evaluations are 152,981,755 native + 150,081,225 cooked:
the reduction from 319,789,650 reflects 4,898 fewer duplicate native attribute
vertices, not removed samples or geometry coverage. Inspection checks both
ordinary and skinned object/transform independence with borrowed geometry and
finishes; belt skeleton disposal remains explicit. The stock oracle still checks
all 4,922 actual triangles at 830 poses per asset against 120 mm (minimum measured
146.14 mm). Sleeve/pouch checks retain the same atlas-selected physical enclosure
and thresholds, with minimum vertex gaps 0.34 mm native / 0.33 mm cooked. Runtime
belt masks, persistent visibility, insertion/interruption and installed/spare
pouch ownership retain the existing smoke gates. Native/cooked 240 Hz contact
parity remains 9,042 poses with its original tolerances.

The following sections record **historical** optimization and accepted exceptions;
the mechanical skin below is no longer the current representation.

## Native/export optimization

The recipe uses two bevel segments instead of three at the same radii. Native
triangles fall from 74,888 to 53,059 without removing markings, rails, vents or
mechanical parts. Close-up bevel profiles are slightly coarser. The first pass
joined receiver, handguard and optic surfaces as `static_surfaces`; the second
pass below replaces that export-only layout with a shared mechanical skin.
Editable assemblies, original finishes, sparse Actions and named controls/sockets
remain in the saved blend. Pouches and belt retain independent ownership.

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
| Finish atlas (pass 1)                   |           53,059 |                  10 |         2 |    7,735,012 |     3,166,568 |
| Rigid mechanical skin (pass 2)          |           53,059 |                   5 |         2 |    8,975,480 |     3,188,352 |

The atlas keeps three 1024² maps: texture texel memory does not increase. UV1
raises measured decoded CPU vertex/index arrays from 1,845,070 to 2,321,350 bytes
in the cooked asset (+476,280 B); this is not a GPU-allocation measurement.
The trade buys 16 fewer total submissions, eight fewer materials and a smaller
runtime file. A 2048² base/ORM trial had the same submission count but 11,523,492
native bytes and **three times** the total texture texels (normal stays 1024²),
so it was rejected. These first-pass measurements did not include a mechanical
skin; the second pass trades additional rigid skin attributes for fewer draws.

`fn-evolys-762.runtime.glb` uses gltfpack 1.3 and `build/models.mjs`'s
`GLTFPACK_FLAGS`, with **no additional flags**. The cook retains 51,793 unique /
52,977 instantiated triangles and five primitive instances in pass 2. Earlier fallback
trials `-si 0.75 -se 0.0002 -sp` and `-si 0.5 -se 0.0005 -sp` saved only 29,356 /
83,416 bytes and increased gzip size; no extra simplification was selected.

The adapter loads the registered runtime product through the shared KTX2/meshopt
loader. `makeEvolysModel` accepts either decoded export and recovers Idle's
manifest duration **only** for an entirely constant, single-t=0-key,
zero-duration fold. Nonzero/moving/malformed clips are not repaired silently.
Both smoke scripts exercise both exports. Exact pre-atlas oriented geometry,
normal XYZ, UV0 and skin hashes, baked finish channels, every round's three
finish regions, actual collapsed ammunition vertices, fractional endpoints,
STEP visibility and 240 Hz control/contact parity are checked. Pouch clearance
selects the original black/fabric surfaces by atlas tile instead of material name;
it does not enlarge the enclosure across empty space below the mounting tongue.
CPU AgX comparisons cover studio sides, feed/optic/markings close-ups and reload
poses. The second-pass section below records completed native-WebGPU/KTX2 checks;
factory-reference and all-state human acceptance remain separate.

## Historical second-pass mechanical consolidation

`skin.py` joins receiver, handguard, optic, stock, bolt, charging handle, feed
cover and trigger into `mechanical_surfaces`, using eight one-influence rigid
joints. Static authoring parents no longer create draws. Every original empty
control remains and moving joints copy the already-prepared 120 Hz Actions,
including exact fractional endpoints and STEP channels. No material/shader,
lighting, exposure, normal-map strength or atlas change is introduced.

Retained runtime boundaries (all parts / loaded Idle: **5 / 4 primitives**):

- Mechanical opaque: 34,775 triangles; all rigid mechanisms and stock.
- Mechanical lens: 90 triangles; true transparent optical pass, same skin.
- Deforming belt: 15,744 triangles; original independent eight-joint skin and
  persistent per-round ammunition masks. Combining it would couple belt-wide
  visibility/reset ownership to the mechanical mesh for no needed target gain.
- Installed pouch: 1,184 triangles; original independent STEP parent/motion.
- Spare pouch: 1,184 triangles; distinct replacement ownership and STEP parent,
  hidden in loaded Idle. Neither pouch is folded into the rigid skin.

Both opaque and alpha materials and all three 1024² textures are unchanged.
Runtime KTX2 maps retain 11 mip levels. Runtime raw bytes rise 21,784 B
(3,166,568 → 3,188,352); gzip-9 decreases 1,678 B (2,487,080 → 2,485,402).
Decoded unique CPU vertex/index typed arrays rise 352,200 B
(2,321,350 → 2,673,550). This is **not uploaded GPU allocation**. There is one
additional eight-joint skeleton/bone texture, and skinning now covers rigid
surfaces including the lens. The adapter disposes each unique skeleton once;
inspection clones own their skeletons and borrow geometry/materials/maps.

The stock/head oracle now selects all **4,922 actual stock triangles** by
`MECH_stock` influence and evaluates their skinned positions. It retains the
120 mm envelope, measuring 146.14 mm native / 146.15 mm runtime over the original
reload sweep. Sleeve/pouch geometry and thresholds are unchanged.

### Approved EVOLYS export-corner-normal encoding exception

Freeze each source mesh's native local-space tessellation before joining;
otherwise the rotated stock can choose different diagonals. Carry original
corner normals through the bind transform as a temporary float attribute, then
set final split normals after joining. Blender stores custom split normals as
`INT16_2D`, so this step has a bounded encoding loss: independently compared with
base `875587a3`, maximum normalized-vector distance **0.0024999942** (about
0.143°), permitted only up to **0.0026** for these EVOLYS export normals. This
exception was approved for the candidate subject to final matched native-GPU
acceptance; it does not alter geometry, hand/contact, quaternion or other-weapon
limits. No flattening, normal-map resampling or exporter/GLB repair is used.

`node tools/evolys-pass2-parity.mjs /absolute/path/to/base-native.glb` compares
all 53,059 oriented triangles, exact UV0/UV1 and encoded image bytes. Across 491
poses / 30,768,515 actual evaluated vertices, maximum position difference is
3.744e-8 m and deformed normal difference stays 0.0024999942. All stored normals
are finite unit directions; the test evaluates normal skin matrices through
moving poses, skipping only collapsed non-rendered surfaces. Exact UV0 plus
preserved deformed positions retains derivative tangent-space inputs (including
the existing degenerate-UV exception); direction changes are bounded above.
The new mechanical hash freezes this layout; unchanged belt/pouch hashes remain.

Affected original mesh normal distributions (unique original attribute vertices;
columns partition `<1e-7`, `[1e-7,1e-4)`, `[1e-4,0.0026]` vector distance):

| Original surface                       | Vertices |  <1e-7 | <1e-4 | Remainder |    Maximum |
| -------------------------------------- | -------: | -----: | ----: | --------: | ---------: |
| Bolt                                   |      216 |    182 |    34 |         0 | 0.00009457 |
| Charging handle                        |      476 |    321 |   140 |        15 | 0.00014142 |
| Feed cover                             |    1,042 |    838 |   200 |         4 | 0.00040775 |
| Static opaque receiver/handguard/optic |   37,629 | 28,543 | 7,161 |     1,925 | 0.00249999 |
| Lens                                   |      198 |    136 |    40 |        22 | 0.00031541 |
| Stock                                  |    4,942 |    515 | 3,932 |       495 | 0.00044709 |
| Trigger                                |      294 |    253 |    40 |         1 | 0.00013048 |

Belt (13,184 vertices) and both pouches (2,342 each) have exactly zero change.
`smoke-evolys-skin.mjs` additionally checks 169,708,425 native and 150,081,225
cooked actual vertices against source controls, plus independent inspection and
bone-texture disposal. Existing 9,042-pose native/cooked control/contact checks
retain their original tolerances. Two independent fresh exports and cooks are
byte-identical. Parent matched Three r187 native-WebGPU captures, RGBA fallback
and independent review passed, including the narrowly approved normal-encoding
loss. Uploaded geometry increases 2,479,560 → 3,360,060 B; with unchanged logical
textures the subtotal rises 6.365 → 7.204 MiB. These omit other renderer allocations
and driver padding and are not an FPS improvement claim. Final factory-reference
and all-state human acceptance remain separate.

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
