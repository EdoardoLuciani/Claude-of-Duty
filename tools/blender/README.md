# Weapon authoring

Python is the source of truth. Generated weapon blends, GLBs, maps and manifests
are products, never fallback build inputs. Normal Vite builds use committed
assets and need no Blender. Imports must not build objects or reset scenes.

Use **Blender 5.2.2** and its bundled glTF exporter. Each asset README owns its
build/check commands, declared inputs, references and acceptance limits:
[M4](../../assets/weapons/m4a1-block-ii/README.md),
[MCX](../../assets/weapons/mcx-virtus/README.md),
[P320](../../assets/weapons/p320-compact/README.md),
[EVOLYS](../../assets/weapons/fn-evolys-762/README.md),
[MPX](../../assets/weapons/sig-mpx/README.md),
[AX338](../../assets/weapons/ax338/README.md),
[M590](../../assets/weapons/m590/README.md).

- Build factory-empty into an absolute `--output` scratch directory first.
  `--render` is optional; `--quick` changes preview samples/resolution only.
- Shared review-arm appearance and versioned hand calibration are read-only
  inputs, not exported duplicate arms. Missing inputs fail. Refit calibration
  separately and intentionally, never automatically during a normal rebuild.
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
  acceptance. Commit the recipe with reviewed generated products. Preserve
  existing contact, interruption and ammo gates, not just output counts.
