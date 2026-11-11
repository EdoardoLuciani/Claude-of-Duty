# ACOG TA31F / TA51

`tools/blender/optics.py` extracts the complete MCX optic assembly from the
freshly generated editable Blender source, preserving geometry, UVs and packed
surface textures. Edit the canonical weapon Python geometry/materials, not generated
`.blend`/GLB products. `bun run build` builds the source weapon before extraction,
then cooks the standalone local GLB via `build/models.ts`.

`MOUNT_base` is the identity rail-contact transform; `SOCKET_sight` is the ocular
axis in metres. Runtime frame is +Y up / −Z forward. The assembly includes its
mount. Glass uses the existing thin-alpha readability policy, not transmission;
the gameplay overlay owns the magnified sight picture. Magnification/reticle live
in `src/weapons/attachments.ts`, per-weapon eye relief in `src/weapons/defs.ts`.

M4 mounting is enabled here; the other six fits remain owned by their conversion
issues (#662–#667). The original integrated optics are intentionally unchanged.
