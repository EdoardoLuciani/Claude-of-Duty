# M4-72 Brake

A matte-stainless game prop based on the exterior photographs in the
[Precision Armament gallery](https://precisionarmament.com/m4-72-severe-duty-compensator/).
The stepped collar, swept side impressions and beveled nose are authored in Blender.
The impressions and nose are closed relief, with painted occlusion; the mesh is
not a functional replica. No reference photographs are used as textures.

The M4A1 is the verified host. The brake replaces its stock flash hider without
showing the suppressor adapter. `SOCKET_mount` seats on `MOUNT_muzzle` and
`SOCKET_muzzle` keeps the stock shot-effect origin. The authoring frame is
Blender +Y forward, +Z up; glTF uses −Z forward, +Y up.

From the repository root:

```sh
bun tools/build-assets.ts
blender -b .cache/blender/weapons/m4a1-block-ii/m4a1-block-ii.blend -t 2 \
  --python-exit-code 1 --python tools/blender/muzzle_brakes/check.py
```

The check seats the authored mesh and samples clips for hand and weapon
intersections, sight clearance and exit alignment. Inspect the cooked asset in
the market and in first person as well; the source check does not cover
runtime IK or lighting.
