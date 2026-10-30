# M4 source map

[Shared authoring workflow](../README.md) ·
[Asset, commands and approved sights/finish](../../../assets/weapons/m4a1-block-ii/README.md)

| Concern                                                           | Source             |
| ----------------------------------------------------------------- | ------------------ |
| Stage order, output paths, editable preview                       | `../m4a1.py`       |
| Seeded maps, A2 checkering, receiver-only albedo and finishes     | `materials.py`     |
| Named assemblies, controls, sockets, applied radii and atlas      | `geometry.py`      |
| Eight sparse weapon/wrist/finger actions, events and review skins | `../m4_actions.py` |
| Clip selection, runtime sampling and explicit resets              | `animations.py`    |
| Export-only original tint and exact per-corner finish factors     | `finishes.py`      |
| Rigid mechanical skin and sampled native bone actions             | `skin.py`          |
| Rigid joining, native Actions export and read-only assertions     | `export.py`        |
| Fixed review cameras, lights and color management                 | `studio.py`        |

Preserve assembly order and the original smart-project/checkering atlas: A2
checkering occupies its left half, other surfaces the right. Do not substitute
MCX's repeating planar UVs. Geometry helpers remain local to their builder.

Read-only inputs are `assets/weapons/m4a1-block-ii/hand-reference.json` and shared
`assets/player/arms/player-arms.blend` (excluded review skins only). The separate
`node tools/m4-hand-reference.mjs` stage intentionally regenerates calibration;
ordinary builds never infer it from old weapon products.

Save the four-map packed preview with Idle and original Bezier actions before
preparing runtime copies. Motion and visibility retain the historical **120 Hz**
integer-frame lattice; motion exports LINEAR, visibility CONSTANT/STEP. Keep
explicit TRS resets on every control in every clip. Draw retains the held frame-75
value at its exact **74.4-frame / .620 s** endpoint. Stock Actions export merges
matching NLA names without forced sampling; no output rewriting.

Runtime preparation merges fixed assemblies, the four exact irons and moving
mechanisms into one one-influence mechanical skin, regardless of authoring
parent. Named static/moving controls become bones with equivalent public local
TRS; no dimensions/tolerances or source geometry are edited. The two magazine
bodies/followers, independently visible loaded rounds and review case remain
separate rigid meshes under their original parents. Save invertible rest seats
before export: selecting Idle and joining/exporting with its hidden spare scale
would permanently collapse that geometry.

`finishes.py` runs only after saving the editable preview, which retains all 12
source materials and original maps. Export uses a single opaque material with
original tint in COLOR_0, roughness/metalness in UV1 and normal strength/role in
UV2, constant per triangle. The small M4-owned physical graph in
`src/weapons/m4-finishes.ts` interprets those factors and samples all four original
1024² maps at UV0, preserving receiver albedo, full-resolution A2 checkering and
normal XYZ/strength. Role 2 retains green paint emission strength 2 and roughness
.8 without grain; role 1 selects the receiver-only albedo. No atlas baking or
averaged material values are used. The receiver image is carried in the standard
emissive slot, so the adapter is required to display the consolidated GLB.

Use `['-noq', '-vc', '16', '-kv']` with the pinned shared cook API. `-kv` preserves
finish UVs that the standard glTF slots do not sample. The asset README records
measured geometry-byte/index and four-sample shader costs, improved file sizes,
unchanged triangles and the remaining native-GPU review gate. Do not substitute
more permissive simplification or relax the existing precision-critical irons.
