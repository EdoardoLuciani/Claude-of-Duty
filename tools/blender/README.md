# Blender asset authoring

Python is the source of truth. Generated blends, GLBs, maps and manifests are
products, never fallback build inputs. `bun run dev` / `bun run build` run
these builds through `tools/build-assets.ts` when inputs change. Native products
go to ignored `.cache/blender/<family>/<asset>/`; the cook copies weapon manifests
that code imports into `src/weapons/authored/`. Imports must not build objects or reset scenes.

Start with the [asset/world editing map](../../docs/assets.md). Each weapon has
one tooling directory here: `m4/`, `mcx/`, `p320/`, `evolys/`, `mpx/`, `ax338/`,
`m590/`. Its `build.py` and `check.py` sit beside its geometry, animation and export
helpers. Where applicable, `actions.py` authors clips and `hand-reference.ts`
explicitly refits calibration. MCX's `animations.py` authors its mechanisms and
`hands.py` authors its wrist/finger and equip actions. Run commands from the repository root.

Committed manifests may retain source-path notes from an older export; use the
current recipe README commands below rather than historical paths embedded in products.

Use **Blender 5.3.0** and its bundled glTF exporter. The playable build uses the
upstream Blender distribution with Python 3.13; keep recipes compatible with it
when using a distro package that embeds a newer Python.

Each recipe README owns its asset contract, build/check commands, declared inputs,
references and acceptance limits:
[M4](m4/README.md),
[MCX](mcx/README.md),
[P320](p320/README.md),
[EVOLYS](evolys/README.md),
[MPX](mpx/README.md),
[AX338](ax338/README.md),
[M590](m590/README.md).
Standalone world interaction prop: [Al-Maktaba intel case](intel_case/README.md).
Standalone rigid prop: [M67 grenade](m67/README.md).
Standalone attachments: [EXPS3-0](exps3/README.md),
[TOR Mini laser](tor_mini/README.md), [M4A1 hand stop](handstop/README.md).
The [field radio](field_radio/README.md) is a standalone
first-person prop with a native export and separate live LCD binding.
Standalone FX: [spent shotgun hull](spent_hull/README.md).
The independently built [ammo pickup case](ammo_pickup/README.md)
uses the same native export and cook workflow; it has no rig or animation.

## Build timing and profiling

`tools/build-assets.ts` reports each Blender invocation and runtime cook
separately, including failures, in both the console and `.cache/assets/<id>.log`.
The final `built in` line is the asset's total elapsed time. Concurrent asset
workers overlap: adding their durations does not give whole-build wall time.

To locate expensive functions inside Blender, use Python's built-in profiler
on a scratch export (after generating the shared inputs required by that asset):

```sh
blender -b --python-exit-code 1 --python-expr \
  "import cProfile, runpy, sys; script='tools/blender/m4/build.py'; sys.argv=[script, '--', '--output', '/tmp/m4-profile']; cProfile.run('runpy.run_path(script, run_name=\"__main__\")', '/tmp/m4.prof')"
python -c "import pstats; pstats.Stats('/tmp/m4.prof').strip_dirs().sort_stats('cumulative').print_stats(25)"
```

Change the script and scratch paths for another asset. This profiles the Blender
build, not the separate gltfpack cook.

## Common Picatinny interface

`picatinny.py` owns the nominal MIL-STD-1913 profile and pitch shared by every
weapon rail and attachment clamp. Weapon sources own orientation, support, length and mount location; do not scale
the profile or add vertical runtime seating offsets. A mount origin is a groove centre.
`fits.optic[id].railSlots` may select whole forward grooves (default zero); gameplay,
inspection and rest/live ADS datums share it, and `attachment_source.RAIL_SLOTS` mirrors it
for source checks.
Optic/laser/hand-stop sources machine the matching channel before UV/bake/export, retaining
exact saddle contact and 0.1 mm transverse assembly clearance on the flanks.

After `bun tools/build-assets.ts`, run:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
```

This reads the actual generated rails and clamps against profile/pitch/depth rays
and an inset slotted solid. Then run each weapon's `check.py` for surrounding
geometry, mechanisms, hands and combined slots.

Weapon and attachment models are original game art, not manufacturer CAD or
certified hardware. Fit checks sample finite source poses (clips at 120 Hz with the
review arm skins); they do not prove continuous clearance or runtime IK/recoil
transitions, and do not replace in-engine captures and final human approval.

## Rebuild discipline

- Build factory-empty into an absolute `--output` scratch directory first.
  `--render` is optional; `--quick` changes preview samples/resolution only.
- Shared review-arm appearance and versioned hand calibration are read-only
  inputs, not exported duplicate arms. `review_hands.py` owns the review-arm
  baker shared by every weapon; each caller supplies its own basis, controls and
  clips. Source attachment checks include those skins. Wrap the glTF export in
  `without_review_hands()`: otherwise the exporter re-evaluates the arm skins on
  every frame it samples. Missing inputs fail. Refit
  calibration separately and intentionally, never automatically during a normal rebuild.
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
