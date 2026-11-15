# Weapon authoring

Python is the source of truth. Generated weapon blends, GLBs, maps and manifests
are products, never fallback build inputs. `bun run dev` / `bun run build` run
these builds through `tools/build-assets.ts` when inputs change; products are
ignored, except weapon manifests that code imports. Imports must not build objects or reset scenes.

Start with the [asset/world editing map](../../docs/assets.md). Each weapon has
one tooling directory here: `m4/`, `mcx/`, `p320/`, `evolys/`, `mpx/`, `ax338/`,
`m590/`. Its `build.py` and `check.py` sit beside its geometry, animation and export
helpers. Where applicable, `actions.py` authors clips and `hand-reference.ts`
explicitly refits calibration; MCX authors clips in `animations.py` and has no
separate hand-calibration stage. Run commands from the repository root.

Committed manifests may retain source-path notes from an older export; use the
current asset README commands below rather than historical paths embedded in products.

Use **Blender 5.2.2** and its bundled glTF exporter. Each asset README owns its
build/check commands, declared inputs, references and acceptance limits:
[M4](../../assets/weapons/m4a1-block-ii/README.md),
[MCX](../../assets/weapons/mcx-virtus/README.md),
[P320](../../assets/weapons/p320-compact/README.md),
[EVOLYS](../../assets/weapons/fn-evolys-762/README.md),
[MPX](../../assets/weapons/sig-mpx/README.md),
[AX338](../../assets/weapons/ax338/README.md),
[M590](../../assets/weapons/m590/README.md).
Standalone attachments: [EXPS3-0](../../assets/attachments/eotech-exps3-0/README.md),
[TOR Mini laser](../../assets/attachments/steiner-tor-mini/README.md).

## Common Picatinny interface

`picatinny.py` owns the nominal MIL-STD-1913 profile (1999 Figure 1 / Figure 2):
19.0 mm top flat, 21.209 mm maximum head width, 15.672 mm neck, 45° flanks,
5.2324 mm recoil grooves at 10.0076 mm pitch and 2.9972 mm groove depth.
The basic .108-inch flank dimension is not the rail's overall height. These
are shared game-art dimensions, not a manufacturing-tolerance certificate.
Weapon sources own orientation, support, length and mount location; do not scale
the profile or add vertical runtime seating offsets. A mount origin is a groove centre.
`fits.optic[id].railSlots` may select whole forward grooves (default zero); gameplay,
inspection and rest/live ADS datums share it, and `attachment_source.RAIL_SLOTS` mirrors it
for source checks.
Optic/laser sources machine the matching channel before UV/bake/export, retaining
exact saddle contact and 0.1 mm transverse assembly clearance on the flanks.

After `bun run assets`, run:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
```

This reads the actual generated meshes: fourteen weapon interfaces, five clamp
assemblies, independent profile/pitch/depth rays and an inset slotted solid that
rejects penetration rather than exempting the entire mating rail. Then run each
weapon's `check.py` for surrounding geometry, mechanisms, hands and combined slots.
Finite source samples and browser captures do not replace final human approval.

## Rebuild discipline

- Build factory-empty into an absolute `--output` scratch directory first.
  `--render` is optional; `--quick` changes preview samples/resolution only.
- Shared review-arm appearance and versioned hand calibration are read-only
  inputs, not exported duplicate arms. `review_hands.py` owns the shared EVOLYS/MPX
  review-arm baker; each caller supplies its own basis, controls and clips.
  MCX's local `runtime-hands.ts` / `review_hands.py` instead bake actual runtime
  matrices after exporting the weapon; source parity and attachment checks include
  those skins. See its asset README for paired clip selection. Missing inputs fail. Refit calibration separately and intentionally, never
  automatically during a normal rebuild.
- Save editable components/modifiers/sparse poses before preparing runtime copies.
  Preserve each weapon's own UV strategy, sampling lattice, fractional endpoints,
  STEP visibility and reset channels; local guides record exceptions.
- Export with stock native Actions; inspect outputs read-only. No exporter hooks,
  GLB/texture repair, runtime material compensation or saved-file-only fallback.
- Use compatible process-local OCIO with AgX if necessary. Never disable color
  management or compensate with changed lighting/exposure. Match cameras, pose,
  registration and exclusions before/after; no independent X/Y photo warp.
- Compare fresh separate-process builds in two empty directories against each
  other and the committed candidate: geometry/indices/UVs/normals, materials/maps,
  nodes/sockets/skin and fractional-time events/hands/visibility/reset behavior.
  Quantify numerical differences rather than adding blanket tolerances. Blend
  paths/metadata need not be byte-identical; same-host evidence is not universal
  cross-platform determinism. Explicit asset exceptions remain narrow.
- Run source, smoke and hardware-WebGPU checks; export success is not visual
  acceptance. Commit the recipe with its regenerated weapon manifest. Preserve
  existing contact, interruption and ammo gates, not just output counts.
