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

Runtime preparation joins the three fixed assemblies by finish while retaining
`handguard`/`stock` helper seats; named irons and all independently animated
mechanisms remain separate. The saved blend is deliberately pre-join and remains
component-editable. Cylinder micro-bevels use a single chamfer (not the exact
front aiming post); Picatinny corner curves retain three samples. The asset
README records the deliberately nonquantized gltfpack candidate/profile and its
precision trade-off. Do not substitute more permissive simplification globally.
