# EVOLYS authoring: source first

`../evolys_762.py` is the weapon recipe; `../evolys_actions.py` owns the existing
poses/events, and `export.py` prepares the in-memory native runtime Actions.
The blend, GLB and manifest are generated products, never build inputs. No old
weapon blend, GLB or texture is loaded, and no exported bytes are repaired.
Normal Vite builds use the committed GLB without Blender.

## Edit locations and stages

| Concern                                                              | Location                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Seeded three-map generation, pigment, metalness, roughness, normals  | `evolys_762.py`: `field`, `image`, `material` and finish declarations |
| Receiver, grip, stock, handguard, optic, pouch, markings             | Corresponding named assembly sections in `build`                      |
| One eight-bone skinned belt, pitch, links and weights                | `belt_pos` and belt construction in `build`                           |
| Rigid consolidation and rubber/canvas/metal atlas partitions         | End of geometry in `build`                                            |
| Final source UV precision                                            | Binary-grid loop after atlas assignment                               |
| Eight editable weapon/wrist/finger poses and events                  | `evolys_actions.py`: `author_actions`                                 |
| Historical runtime lattice and source-side endpoint/STEP preparation | `export.py`: `prepare_export_actions`                                 |
| Fixed review cameras/lights/exposure                                 | Studio section in `build`                                             |
| Stock export options, paths and manifest                             | End of `build` and `main`                                             |

Module imports do not build objects or reset scenes. `build` starts from an empty
factory scene, generates the complete asset, saves the packed editable preview
with original sparse Bezier actions and review skins, then prepares only the
in-memory runtime copy. Geometry assembly order and the original atlas strategy
remain; this is not MCX planar projection or P320 atlas baking.

Declared read-only inputs:

- `assets/weapons/fn-evolys-762/hand-reference.json`: versioned wrist/finger/contact
  calibration. `node tools/evolys-hand-reference.mjs` derives it separately from
  shared Arm calibration and local contact data. Do not automatically refit it.
- `assets/player/arms/player-arms.blend`: shared appearance/bind data appended
  only for excluded DCC review skins. No shared skins are exported.
- Asset README/photo-review JSON: reference limitations and frozen registration
  for review, not previous weapon geometry or texture inputs.

`evolys_actions.author_review_hands` is shared with MPX. Its implementation/API
is not weapon-local and must not be changed as an EVOLYS-only authoring edit.

## Build (repository root, Blender 5.2.2)

```sh
blender -b -t 4 --python-exit-code 1 --python tools/blender/evolys_762.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/evolys_762.py -- \
  --output /tmp/evolys-review --quick
# Optional fixed-camera source renders, with an available GPU lane:
blender -b -t 4 --python-exit-code 1 --python tools/blender/evolys_762.py -- \
  --output /tmp/evolys-review --render --quick
```

`--output` redirects every product, including temporary generated maps, without
changing calibration inputs. Three seeded 1024² maps are packed into the blend
and embedded in the GLB; temporary loose PNGs are removed as before. `--quick`
changes only preview samples/resolution, not geometry/maps/actions/export.
`--render` is optional and writes the five existing cameras to `renders/`.
Use valid compatible process-local `OCIO` if needed, never compensated lighting
or disabled color management. Render before export preparation to retain the
same review pose, camera, lights, exposure and AgX transform.

The runtime copy retains the historical **120 Hz** integer-frame sample lattice.
The held `ceil(end)` sample is given the exact clip-end timestamp in source
curves (Fire/Last_Shot remain exactly `60/700` seconds before float32 encoding).
Existing constant-channel reduction keeps its two endpoint samples and STEP;
nonconstant motion is LINEAR and visibility STEP. Explicit TRS resets remain on
all controls and belt bones. Stock Actions export merges matching NLA names;
unused original armature actions are not broadcast. Post-export validation only
reads the GLB, checking exact float32 endpoints, ordered times and STEP scales.
No exporter hooks, monkeypatches, GLB repairs or runtime compensation exist.

## Explicitly approved UV precision exception

Fresh unmodified builds on this Blender host showed modifier-interpolated atlas
UV variation up to `1.1920928955078125e-7`, despite identical other payloads. The
user approved rounding final source UVs to nearest **1/16384**, ties-to-even,
after modifiers/consolidation/atlas assignment and before actions/save/export.
The measured maximum triangle-corner displacement versus both the committed
asset and an unmodified rebuild is **0.000030517578125 UV = 0.03125 texel at
1024**. This affects all 35 material primitives, retaining atlas partitions and
island placement without repacking or reprojection.

This is **not exact seam preservation**: 34 subprecision UV multiplicity groups
collapse, and 132 index entries substitute equal-position/normal/skin duplicate
vertices across the three belt primitives, optic rubber and receiver rubber.
Vertex/index counts, oriented triangle-corner geometry, normals, joints, weights
and bind ordering are unchanged. No authored tangent attribute exists. These
measured changes are an explicit migration exception, not a relaxed test or
permission to alter other surfaces. Rounding can straddle a boundary after a
future source/environment change; repeat-build evidence is host/version-local,
not a universal cross-platform determinism claim.

## Preservation and review

Keep one eight-joint skinned belt with three material primitives and 12.7 mm
pitch, eight clips, sockets, pouch/belt clear/insert times and calibrated hands.
`src/weapons/evolys.ts` still owns persistent remaining-round masks, the final
departing round and interruption/reset behavior; native constant channels must
not resurrect spent rounds. No independent cartridge objects or new masks.

Use the existing source/runtime checks in the asset README, plus clean-install
`npm test`, lint, format check and build. Build into two empty external output
directories in separate processes and compare GLB/embedded-map/manifest hashes.
Blend paths/metadata need not be byte-identical. Compare static indexed and
oriented-corner payloads, materials/maps/nodes/sockets/skin, events, every native
clip at fractional boundaries and actual runtime reset/ammo semantics. Review
matched final source/game captures, including the affected rubber, belt,
receiver and optic surfaces. Passing saved-source checks or export alone is not
human visual acceptance; existing inferred-detail/finish/contact limits remain.
