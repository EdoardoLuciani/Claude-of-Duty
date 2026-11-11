# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS, short M-LOK guard, folding stock, SRD762Ti, TA31F/TA51 and
MAG800 magazine. Original art; dimensions and finish are not factory certification.

[Source map](../../../tools/blender/mcx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python is authority; native blend/GLB/maps/manifest and cooked runtime GLB are
generated. The adapter converts +X-forward/+Y-up and samples six native clips;
draw/holster, shared arms, scope and pooled cases remain runtime-owned.
Preserve STEP magazine visibility, optic seating and reload/fold clearance.
The opaque finish uses vertex pigments and a UV1 scalar lookup, with original
UV0 detail maps; glass remains separate. Do not compensate with lighting.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx/build.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx/check.py
bun run models:cook -- mcx
```

Use `-- --output /tmp/mcx-review` for scratch builds. Normal builds use committed
assets. World-magazine drops remain unavailable because the adapter lacks
`magazineBody`; independent transfer geometry remains. Historical optimization
measurements are in Git history, not evidence of an FPS improvement.

## TOR Mini rail (#686)

A short authored right-side Picatinny adapter enables the shared optional laser,
independently of the existing integrated optic and suppressor. No base conversion
or dependency on the still-open #662/#663 issues is introduced. Receiver ownership
keeps it clear of moving controls and stock; hands/animations remain unchanged.
See the [mount table, source sweep and limitations](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).
