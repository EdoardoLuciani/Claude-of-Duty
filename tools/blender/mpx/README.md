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

Read-only inputs are `assets/weapons/sig-mpx/hand-reference.json` and shared
`assets/player/arms/player-arms.blend`. Refit only with the separately approved
`node tools/mpx-hand-reference.mjs` stage. The shared
`evolys_actions.author_review_hands` API also serves EVOLYS; don't change it as a
weapon-local cleanup. Review skins are excluded from the runtime GLB.

Preserve assembly order, per-component smart-project atlas and optical finishes.
Save components/modifiers/sparse Bezier actions with Idle before evaluating and
joining runtime copies by rigid parent. Runtime motion retains the historical
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

Removing the startup cube's orphan datablock shifts incidental mesh labels
`Cube.131/.166/.117` to `Cube.130/.165/.116`; authored node/control/socket/parent
names remain unchanged and are the runtime lookup contract. These narrow measured
exceptions do not waive Gate 3 human visual/gameplay acceptance or other checks.
