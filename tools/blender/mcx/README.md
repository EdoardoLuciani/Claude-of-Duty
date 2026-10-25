# MCX source map

[Shared authoring workflow](../README.md) ·
[Asset, references and build/check commands](../../../assets/weapons/mcx-virtus/README.md)

| Concern                                                   | Source                                        |
| --------------------------------------------------------- | --------------------------------------------- |
| Stage order and paths                                     | `../mcx_virtus.py`                            |
| Finishes and three seeded 1024² maps                      | `materials.py`: `FINISHES`, `build_materials` |
| Named assemblies, rigid pivots and sockets                | `geometry.py`: `build_*`, `build_geometry`    |
| Six clips, poses, visibility and events                   | `animations.py`: `build_animations`           |
| Surface projection, runtime preparation and native export | `export.py`                                   |
| Fixed review cameras/lights                               | `studio.py`                                   |

Metres, +X forward, -Y ejection side. Preserve runtime names, sockets and events.
This is a weapon-local recipe, not a cross-weapon framework; helpers depend on
its local materials/pivots. Write connected shader multipliers and defaults;
base color is sRGB, roughness/normal maps are data.

This pilot intentionally replaced packed UVs/triangle ordering with dominant
rest-space face-plane projection, one repeat per 10 cm. Apply the same rule to
evaluated, deterministically triangulated runtime faces to avoid modifier UV
rounding. It is for shared detail maps, not unique painted atlases; it was not a
byte-preserving material-only change. Shape, maps, sockets and gameplay timings
were not retuned by that migration.

Save the editable packed preview with modifiers and Idle before export prep.
Sample sparse motion natively at **60 Hz** into LINEAR keys; visibility stays
CONSTANT/STEP with explicit resets. Mute tracks, restore rest transforms, evaluate
modifiers and join in name order under ten rigid parents. Stock Actions export
merges matching track names with forced sampling off. No GLB repair or alternate
saved-source/material-only path.
