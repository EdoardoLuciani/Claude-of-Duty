# FN EVOLYS 7.62

Tan/black exterior, six-position stock, RM06/RM33 and inferred 100-round pouch.
Original art; human visual sign-off remains pending.

[Source map](../../../tools/blender/evolys/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python owns geometry, finishes and actions; blend/GLBs/maps/manifest are generated.
Ordinary rigid meshes retain independent controls; only the eight-joint belt is
skinned. Both pouches retain STEP ownership. Preserve eight clips, event timing,
12.7 mm belt pitch, persistent spent-round masks and insertion-only restoration.
Hand calibration and shared review arms are read-only. Runtime optics use a
world-sized 3.25 MOA dot with a five-pixel readability floor, not a ring.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/evolys/build.py
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys/check.py
npm run models:cook -- evolys
```

Use `--output /tmp/evolys-review --quick` for scratch builds.
UV rounding and historical normal-encoding exceptions are bounded in the source
map; they do not waive contacts, human approval or establish an FPS improvement.
