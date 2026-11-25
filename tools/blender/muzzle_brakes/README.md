# M4-72 Brake

A matte-stainless game prop based on the exterior photographs in the
[Precision Armament gallery](https://precisionarmament.com/m4-72-severe-duty-compensator/).
The stepped collar, swept side impressions and beveled nose are authored in Blender.
The impressions and nose are closed relief, with painted occlusion; the mesh is
not a functional replica. No reference photographs are used as textures.

The M4A1, MCX VIRTUS, EVOLYS-7.62 and AX-338 all mount the unchanged prop at
unit scale. The brake replaces the stock muzzle hardware without showing any
suppressor adapter. `SOCKET_mount` seats on `MOUNT_muzzle` and `SOCKET_muzzle`
places the shot effect at the prop's nose. The authoring frame is Blender +Y
forward, +Z up; glTF uses −Z forward, +Y up.

From the repository root:

```sh
bun tools/build-assets.ts
for host in m4a1-block-ii mcx-virtus fn-evolys-762 ax338; do
  blender -b ".cache/blender/weapons/$host/$host.blend" -t 2 \
    --python-exit-code 1 --python tools/blender/muzzle_brakes/check.py || exit
done
```

The check seats the authored mesh and samples clips for hand and weapon
intersections, sight clearance and exit alignment. Inspect the cooked asset in
the market and in first person as well; the source check does not cover
runtime IK or lighting.
