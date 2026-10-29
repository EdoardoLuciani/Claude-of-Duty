# MPX source map

[Shared authoring workflow](../README.md) ·
[Asset, references and build/check commands](../../../assets/weapons/sig-mpx/README.md)

| Concern                                                               | Source                                           |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| Build/reset/paths, seeded maps, finishes, named assemblies and studio | `../mpx.py`: `build` / `main` and named sections |
| Original component smart-project atlas and projected markings         | End of component construction in `../mpx.py`     |
| Eight sparse actions, hands, visibility and events                    | `../mpx_actions.py`: `author_actions`            |
| Runtime-only sampling/reset preparation                               | `animations.py`: `prepare_export_actions`        |
| Evaluated rigid copies, stock export and read-only assertions         | End of `../mpx.py`                               |
| Export-only per-corner finish colour and padded ORM/normal tiles      | `finishes.py`: `consolidate_finishes`            |

Read-only inputs are `assets/weapons/sig-mpx/hand-reference.json` and shared
`assets/player/arms/player-arms.blend`. Refit only with the separately approved
`node tools/mpx-hand-reference.mjs` stage. The shared
`evolys_actions.author_review_hands` API also serves EVOLYS; don't change it as a
weapon-local cleanup. Review skins are excluded from the runtime GLB.

Preserve assembly order, per-component smart-project atlas and optical finishes.
Save components/modifiers/sparse Bezier actions with Idle before evaluating and
joining runtime copies by rigid parent. Export copies consolidate compatible
opaque finishes using linear corner colours and a padded 4×4 finish atlas for
roughness/metalness and strength-adjusted normal XYZ. Original UV0/colour grain
remain unchanged; UV1 is a deterministic affine transform of that same atlas,
not a reproject/repack. Each finish tile reduces procedural grain from 1024² to
248² plus four-pixel edge padding. Lens, clear cap and absorptive interior remain
separate materials for the adapter's optical policies. The two finish PNGs are
export products; the editable blend still packs the three full-resolution maps.
Runtime motion retains the historical
**120 Hz** lattice. The held `ceil(duration * 120)` value receives the exact
endpoint, including **60/950 s** Fire/Last_Shot. Motion is LINEAR, scales are
CONSTANT/STEP; retain explicit child TRS resets even under hidden parents. Stock
Actions export has forced sampling off; output inspection is read-only.

## Approved repeatability limit

Blender 5.2.2 evaluated-bevel UVs vary by up to **1.1920928955078125e-7 UV**
(**0.0001220703125 texel** at 1024), despite identical saved-source UVs; unchanged
historical and single-thread builds show it too. Atlas preservation was explicitly
chosen over rounding: **GLB byte-repeatability remains unmet for those UV bytes**.
No rounding, repacking, reprojection, seam collapse or custom interpolation.
Maps/manifest and non-UV runtime payloads still require exact comparison; isolate
differences to evaluated UV accessors rather than tolerating whole geometry.
A pair of optimized same-host empty-directory exports measured **5.960464477539063e-8**
maximum differences on both original UV0 and derived UV1; indices, positions,
normals, corner colours, all Action times/values, helper transforms and PNG pixels
were exact. The existing UV-only exception still applies; do not round either UV set.

Removing the startup cube's orphan datablock shifts incidental mesh labels
`Cube.131/.166/.117` to `Cube.130/.165/.116`; authored node/control/socket/parent
names remain unchanged and are the runtime lookup contract. These narrow measured
exceptions do not waive Gate 3 human visual/gameplay acceptance or other checks.
