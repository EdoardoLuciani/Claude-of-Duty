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
| Export-only corner pigment and scalar finish packing      | `finishes.py`: `consolidate_finishes`         |
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
modifiers and join in name order under the ten rigid parents. Export preparation
then consolidates receiver, bolt, charging handle, trigger, cover, stock and bolt
release into one single-influence mechanical skin. The original animated empties
remain runtime contacts/helpers; six moving bones copy their native Action curves
with only rest translation subtracted. The static receiver bone has no motion.
Magazines and the showcase case stay independently owned rigid meshes, preserving
STEP visibility and dropped-magazine cloning. Stock Actions export merges matching
track names with forced sampling off. No GLB repair, exporter hooks or alternate
saved-source/material-only path.

Small machined chamfers use one bevel segment; the broad rounded receiver/grip
transitions retain four. Export-only finish consolidation keeps thirteen original
linear pigments in per-corner `FinishColor` and scalar metalness/mean roughness in
sixteen-texel padded tiles of a 64² `FinishUV` lookup. UV0 albedo/full normal XYZ
pixels retain their original resolution and 10 cm repeat; UV1 is constant at each
finish tile centre, with zero derivatives and seven guard texels on either side.
Five materials separate fine surfaces, polymer, absorptive rubber, glass and
emissive fiber. Polymer/rubber strengths remain .50/.90; only already-weak fine
normal grain is reduced to .02. Roughness grain is replaced by its source mean,
not a retuned factor. Glass/fiber retain their roughness factors outside the lookup
and white vertex colors, preserving runtime optical overrides and emission.
The editable blend and original three source maps are saved before consolidation.

This is a deliberate grain/storage trade-off rather than a lossless merge:
relative to the 13-material skin-only export, Idle submissions fall 15 → 8 and
runtime size falls 3,077,652 → 2,267,368 bytes, while decoded geometry storage
increases 2,515,012 → 3,679,532 bytes. Source-contact checks stay unchanged;
`smoke-mcx-finishes.mjs` checks every decoded pigment/lookup coordinate, original
albedo/normal pixels, padded ORM values and independent optical policies.

The committed `mcx-virtus.runtime.glb` is cooked by gltfpack 1.3 using the shared
`GLTFPACK_FLAGS` in `build/models.mjs` plus `-si 0.65 -se 0.0002 -sp -vc 16`.
Sixteen-bit linear colors bound pigment quantization error to 1/65535. Keep `-kn`:
sockets, helper names, independent magazine ownership and mechanical bones are
runtime contracts. `loadMCX()` intentionally still loads the native export until
the shared runtime-loader integration. `smoke-mcx-runtime.mjs` exercises both
through the actual GLTFLoader/Meshopt decoder, including all rigid-influence
vertices, fractional poses, wrist contacts, reload visibility, interruption reset
and the adapter's empty-state bolt override.
