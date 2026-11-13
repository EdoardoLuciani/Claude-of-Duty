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

The optional laser is enabled by `fits.rail.laser`. Its game-fit Picatinny adapter
seats on the existing upper-right handguard chamfer, canted approximately 36.25°
upward from the former vertical side seat. The backing, five teeth and screws
move together; six actual-surface rays verify backing contact at both screw
stations. The native check also preserves the ACOG sight line and checks the
actual module against mechanisms, optic and suppressor across 1,530 source poses.
This is an authored game-fit adapter, not a factory accessory/CAD claim.

The original vertical adapter intersected the runtime support glove. Hardware
placement alone also left brief draw and post-charge return crossings. Draw now
approaches with fitted grip fingers; after releasing the charging latch, the
empty-reload hand aligns below the rail before rising onto the support grip.
Authored mechanism/contact event times are unchanged. Integrated ACOG/SRD762Ti
remain; no base conversion or dependency on #662/#663 is introduced.

A native-WebGPU runtime fixture sampled the actual `Viewmodel`, `MCXAnimation`
and shared deformed arm skins at 120 Hz: **5,051 poses**, covering hip/ADS draw,
holster, both reloads, inspect, firing/empty return, ADS/sprint/low-ready transitions
and gesture cancellation into holster/draw. Both arms clear the real adapter
surfaces and cooked module; the emitter ray clears the hands. These finite
samples are not continuous clearance or final human animation approval. A separate
full-game WebGPU run also equipped/removed the laser and captured actual firing,
empty-reload return and inspect with no collected page/console/TSL/GPU-validation
errors. Material-deprecation, zero-draw and canvas-format warnings remain disclosed;
this does not attribute or waive earlier strict-browser failures elsewhere in #686.
The source scene still has no DCC review arms;
adding static/approximate hands would not replace runtime verification.

```sh
bun tools/capture.ts --weapon=mcx --rail=laser --shot=weapon --out=/tmp/mcx-laser.png
```
See the [mount table, source sweep and limitations](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).
