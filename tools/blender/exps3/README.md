# EOTECH EXPS3-0 attachment

Shared holographic optic for every weapon except the P320. `tools/blender/exps3/build.py` owns geometry/export;
`bake.py` owns the atlas. Blend/native GLB/maps/manifest and cooked runtime
GLB are generated products. References, rights and visual limitations live in
`reference-review.json`.

[Shared workflow and rail contract](../README.md)

## Rebuild and validate

Run from the repository root with Blender 5.2.2, compatible AgX and gltfpack 1.3:

```sh
bun tools/build-assets.ts
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
# Then run each weapon's saved-source check.py (commands beside each asset).
bun tools/capture.ts --weapon=rifle --optic=exps3 --rail=laser --muzzle=suppressor --shot=ads --out=/tmp/m4-exps3.png
```

The cook writes `public/models/attachments/exps3.runtime.glb`. Standalone review
is available with `blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3/build.py -- --output /tmp/exps3-review --render`;
`bun build/models.ts exps3 /tmp/exps3-review` cooks that scratch native export.

## Mechanical interface

Native metres export -Z forward/+Y up under `ATTACHMENT_exps3`. `MOUNT_base`
and retained `SOCKET_mount` identify the QD saddle contact; `SOCKET_sight` is the
photo-derived optical centre. The clamp channel, including the relief through the
low rear casting, is cut from the shared `tools/blender/picatinny.py` profile. A fit
may select whole forward rail grooves via `railSlots`, never a vertical seating
offset; `check_picatinny.py` verifies every clamp and weapon rail.

## Rendering

The editable high-detail source projects onto a lighter body mesh with three PBR
atlases. The hood keeps its brand marks, printed adjuster labels and index dots,
and a simplified yellow warning label. The captive wire is modeled without its
small fittings. Separate front and rear glass use thin alpha without a
scene-transmission pass. The ring/dot reticle is drawn by the live-axis viewmodel
reticle (catalog data in `src/weapons/attachment-rules.ts`), not baked into the mesh;
the ring keeps its world-angular size and hides once it would leave the clear opening.
