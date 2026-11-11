# ACOG TA31F / TA51

`tools/blender/optics.py` extracts the complete MCX optic assembly from the
freshly generated editable Blender source, preserving geometry, UVs and packed
surface textures. Edit the canonical weapon Python geometry/materials, not generated
`.blend`/GLB products. `bun run build` builds the source weapon before extraction,
then cooks the standalone local GLB via `build/models.ts`.

Mount/sight datums, glass policy, tuning ownership and supported weapon/iron-sight
combinations follow the [shared attachment contract](../../../ARCHITECTURE.md#models).
