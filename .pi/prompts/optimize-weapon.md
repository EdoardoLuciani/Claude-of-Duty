---
description: Reduce Blender weapon asset complexity and bake time
argument-hint: "<weapon or attachment> [constraints]"
---

Optimize the Blender scripts for `$ARGUMENTS` after modeling is complete.

1. Build a baseline. Record mesh, triangle, primitive, and material counts from the exported asset. Time the uncached bake separately from export and cooking.
2. Cut unnecessary geometry, meshes, primitives, and materials to a budget that makes sense for the asset's in-game use. Profile and speed up the bake; aim for under three seconds on the same machine, without relying on cached results.
3. Rebuild and compare matched before/after renders and measurements. Accept small visual regressions only when the measured complexity or bake-time savings justify them. Preserve rigging, sockets, and animation. Report the before/after counts, bake times, and trade-offs.
