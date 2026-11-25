# Crest and Vector brakes

Original, fictional game props. Crest has a tall, faceted graphite shell with ochre ribs;
Vector has a wider, low-profile slate shell and a stepped bright nose. The meshes are visual
shells, not functional muzzle-device designs.

The M4A1 is the only supported host. Both assets seat at its existing `MOUNT_muzzle`, replace
its stock flash hider and share the stock exit position. The authoring frame is Blender +Y
forward, +Z up; the glTF uses −Z forward, +Y up. `SOCKET_mount` and `SOCKET_muzzle` are the
seat and effect/projectile exit datums. No weapon art or calibration needs to change.

From the repository root:

```sh
bun tools/build-assets.ts
blender -b .cache/blender/weapons/m4a1-block-ii/m4a1-block-ii.blend -t 2 \
  --python-exit-code 1 --python tools/blender/muzzle_brakes/check.py
```

Dev/build run the same recipes and cook the two runtime GLBs. The Blender check seats the
actual meshes and samples the M4A1 clips for intersections and iron-sight clearance. Inspect
both builds in the market and in first person; source checks don't cover runtime IK and lighting.
