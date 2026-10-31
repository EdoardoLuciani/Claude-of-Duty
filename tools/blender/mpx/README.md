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
| Lossless local mesh frames, packed normal fans and mechanical skin    | `skin.py`: `consolidate_mechanics`               |
| Source-named packed-normal regression                                 | `../mpx_normal_check.py`                         |

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
248² plus four-pixel edge padding. Lens/cap sheets share one optical material with
exact UV1-selected alpha/coating; absorptive interior retains its separate
specular/environment policy. Three transparent sorting objects and four rigid
magazine/round draws remain independent. The two finish PNGs are
export products; the editable blend still packs the three full-resolution maps.
Runtime motion retains the historical
**120 Hz** lattice. The held `ceil(duration * 120)` value receives the exact
endpoint, including **60/950 s** Fire/Last_Shot. Motion is LINEAR, scales are
CONSTANT/STEP; retain explicit child TRS resets even under hidden parents. Stock
Actions export has forced sampling off; output inspection is read-only.

## Normal-preserving mechanical skin

Do not rebase the evaluated rigid mesh vertices into a common physical bind frame:
float32 translation changes tiny but nonzero bevel faces. Also do not restore decoded
`corner_normals` using `normals_split_custom_set`: Blender's identity join/separate path
already decodes/re-encodes the native `custom_normal` short2 values and that round trip
is lossy on degenerate fan spaces. The selector regression demonstrates 16 changed
corners even without coordinate/topology changes. The earlier rigid-GLB oracle was
not a solution and is not part of this pipeline.

Keep each rigid mesh's original local coordinates. Ten identity-rest control bones
carry unchanged prepared helper curves; ten identity-rest child frame bones carry
original static mesh-local TRS. Pose transforms, rather than vertex rebasing,
assemble the skin. The two-level hierarchy preserves the exact subframe rotation
of a translated mesh origin. Stock `export_rest_position_armature=False` exports
these pose frames, while stock inverse binds use identity rest frames. The mesh
still uses ordinary one-influence skinning; no GLB rewrite or exporter hook exists.

Preserve Blender's packed `custom_normal` attribute through separate/join under a
temporary export-copy corner attribute and restore its exact encoding, not decoded
vectors. Local geometry, sharpness and fan connectivity remain unchanged. The
builder asserts every restored local corner normal against its pre-operation value,
including zero-area and nonzero tiny triangles, then removes temporary attributes.
The editable .blend is saved before these export-only operations.

`mpx_normal_check.py` uses the saved editable selector parts to reproduce the lossy
setter and assert the packed-encoding fix through an actual identity join. The
independent `tools/mpx-pass2-parity.mjs` requires a retained pass-1 native GLB: it
matches every oriented triangle/position/UV/finish/owner and compares every corner
normal at rest, every surface vertex over ≥21 moving poses per clip, plus dense
120 Hz samples. No new expected hash substitutes for that external reference.
`smoke-mpx-skin.mjs` separately checks native/cooked actual vertices and normal
transforms against the named controls, dense subframes, lockback/reset, moving caps,
magazine ownership and gameplay/inspection bone-texture disposal.

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
names remain unchanged and are the runtime lookup contract. The consolidated fresh
pair retained exact JSON and all non-UV buffer views; UV0 differed by at most
1.1920928955078125e-7 and UV1 by 5.960464477539063e-8. Both pinned cooks were
byte-identical, including maps, decoded arrays and Actions. These narrow measured
exceptions do not waive Gate 3 human visual/gameplay acceptance or other checks.
