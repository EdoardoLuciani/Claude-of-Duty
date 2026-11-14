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

Use `-- --output /tmp/mcx-review` for scratch builds. Normal dev/build uses generated
products at the canonical asset paths. World-magazine drops remain unavailable because the adapter lacks
`magazineBody`; independent transfer geometry remains. Historical optimization
measurements are in Git history, not evidence of an FPS improvement.

## Runtime-driven Blender review hands

The saved source includes `MCX | authored hands (shared appearance)`: two armatures
and ten shared skin meshes. These are review-only; the weapon GLB is exported
**before** they are appended. Gameplay continues to use the single shared arm asset.
No new runtime animation or separate IK implementation is introduced.

`runtime-hands.ts` loads the freshly exported weapon/shared arm GLBs and samples
actual `Viewmodel`, `MCXAnimation`, fitted fingers, shoulder/elbow solving and skin
binding offline in Bun. Image decoding/rendering is unnecessary for these poses.
`review_hands.py` bakes the sampled matrices into native NLA actions at 120 Hz,
with mirrored right-hand binding, left-hand scale and fractional endpoints.
Normal asset builds prepare the shared arms first; direct Blender builds require
Bun plus the generated `player-arms.blend` and `/models/player/arms.glb` products.
Generated bridge files live under ignored `review/`; the saved blend embeds its
runtime vertex receipts and does not need that directory to run `check.py`.

Nine selectable tracks: `Idle`, `Fire`, `Reload_Tactical`, `Reload_Empty`,
`Inspect`, `Stock_Fold`, `Draw`, `Holster`, `Idle_ADS`. Fire uses native clip time
(gameplay runs its mechanism animation faster). Stock_Fold retains the runtime
Idle hold; it is not a new gameplay folding gesture. Draw/Holster and Idle_ADS
pair with the weapon's Idle track. Hip stance is deterministic, without procedural
sway/bob; these clips do not represent every possible live movement/transition.

In Blender's Python console, set the checkout path and select a paired clip:

```py
import sys
sys.path.insert(0, '/path/to/checkout/tools/blender')
from mcx.review_hands import select_review_clip
select_review_clip('Reload_Empty')
```

This enables matching weapon/arm NLA tracks and sets the timeline. The blend's
`MCX hand review - START HERE` text lists the same entry points. Rebuild after
runtime hand-code changes; the asset cache tracks runtime weapon sources and
core math/guards. No committed hand-tuning/calibration file is rewritten.

`check.py` compares 120 evaluated skin points per pose against embedded runtime
references over all **1,656 poses**, and runs the real TOR/adapter/emitter checks
against both review arms across all nine tracks. Maximum measured skin drift is
**0.0033 mm**, bounded at 0.005 mm: the stock glTF exporter omits tiny influences
that remain in the shared Blender source weights. These are finite pose/vertex
checks, not continuous geometric or final human animation certification.

## TOR Mini rail (#686)

The optional laser is enabled by `fits.rail.laser`. Its game-fit Picatinny adapter
seats on the existing upper-right handguard chamfer, canted approximately 36.25°
upward from the former vertical side seat. The backing, five teeth and screws
move together; six actual-surface rays verify backing contact at both screw
stations. The native check also preserves the ACOG sight line and checks the
actual module/support hardware against mechanisms, optic, suppressor and both
review arms across 1,656 source poses, including Draw/Holster and Idle_ADS.
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
The source scene now also contains runtime-driven DCC review arms as described below.

```sh
bun tools/capture.ts --weapon=mcx --rail=laser --shot=weapon --out=/tmp/mcx-laser.png
```
See the [mount table, source sweep and limitations](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).
