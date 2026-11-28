---
description: Reduce Blender model complexity and bake time
argument-hint: "<asset> [constraints]"
---

Optimize the Blender scripts for `$ARGUMENTS` after modeling is complete.

1. Build a baseline. Record mesh, triangle, primitive, and material counts from the exported asset. If it has a bake, time it uncached and separately from export and cooking.
2. Cut unnecessary geometry, meshes, primitives, and materials to a budget that fits the asset's intended use. Profile and speed up any bake; aim for under three seconds on the same machine without relying on cached results.
3. Rebuild and compare matched before/after renders and measurements. Accept small visual regressions only when the measured complexity or bake-time savings justify them. Preserve any rigging, sockets, and animation. Report the before/after counts, bake times where applicable, and trade-offs.
