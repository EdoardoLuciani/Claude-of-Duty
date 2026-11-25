# M4-72 Brake

A matte-stainless game prop based on the exterior photographs in the
[Precision Armament gallery](https://precisionarmament.com/m4-72-severe-duty-compensator/).
The stepped collar, swept side impressions and beveled nose are authored in Blender.
The impressions and nose are closed relief, with painted occlusion; the mesh is
not a functional replica. No reference photographs are used as textures.

All verified hosts mount the same prop at unit scale. The brake hides removable
stock muzzle hardware without showing any suppressor adapter. The M-590 keeps
its permanent front assembly. `SOCKET_mount` seats on `MOUNT_muzzle` and
`SOCKET_muzzle` places the shot effect at the prop's nose. The authoring frame
is Blender +Y forward, +Z up; glTF uses −Z forward, +Y up.

From the repository root:

```sh
(
  bun tools/build-assets.ts || exit
  for asset in m4a1-block-ii/m4a1-block-ii mcx-virtus/mcx-virtus fn-evolys-762/fn-evolys-762 \
    ax338/ax338 sig-mpx/mpx m590/m590; do
    blender -b ".cache/blender/weapons/$asset.blend" -t 2 \
      --python-exit-code 1 --python tools/blender/muzzle_brakes/check.py || exit
  done
)
```

The check seats the authored mesh and samples clips for hand and weapon
intersections, sight clearance and exit alignment. Inspect the cooked asset in
the market and in first person as well; the source check does not cover
runtime IK or lighting.
