# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS iron-sight base, short M-LOK guard, folding stock, open
three-prong muzzle device and MAG800 magazine. Optional TA31F/TA51 and SRD762Ti
are shared attachments, not integrated geometry. Original art; dimensions and finish are not factory certification.

[Source map](../../../tools/blender/mcx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python is authority; native blend/GLB/maps/manifest and cooked runtime GLB are
generated. The adapter converts +X-forward/+Y-up and samples six native clips;
draw/holster, shared arms, mounted optics and pooled cases remain runtime-owned.
Preserve STEP magazine visibility, attachment seating and reload/fold clearance.
The opaque finish uses vertex pigments and a stable canonical UV1 scalar lookup,
with original UV0 detail maps; no glass remains in the base weapon. Do not compensate with lighting.

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
stations. The native check also preserves the iron sight line and checks the
actual module/support hardware against mechanisms and both
review arms across 1,656 source poses, including Draw/Holster and Idle_ADS.
This is an authored game-fit adapter, not a factory accessory/CAD claim.

The original vertical adapter intersected the runtime support glove. Hardware
placement alone also left brief draw and post-charge return crossings. Draw now
approaches with fitted grip fingers; after releasing the charging latch, the
empty-reload hand aligns below the rail before rising onto the support grip.
Authored mechanism/contact event times are unchanged. This adapter and the authored contact/event times are retained by the #662 base
conversion below.

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

## Iron-sight base and attachment fits (#662)

The ACOG was extracted into `tools/blender/acog/` **before** removing its integrated
assembly (see the [equivalence receipts](../../attachments/trijicon-acog/README.md)).
No weapon build or generated MCX file is now needed for the shared ACOG.
The base has no optic, glass, scope mask, chevron or suppressor. Its unsuppressed
report uses the #668 MCX bank; installing/removing the can drives the effective
`suppressed` flag without changing ammunition or handling tuning.

The existing backup bases/hinges remain on the rail. `IRON_sights` contains a
hinge-supported open rear aperture and deployed front post/protective ears;
`IRON_sights_removed` contains the original folded leaves. Rear aperture center
and front post tip are both at native Z=77 mm, separated by 382 mm. The 5 mm
rear bore and base eye relief of 60 mm provide an open, centered sight picture.
Removing irons with no optic is valid and shows folded leaves without a reticle.

Native Blender coordinates are metres, +X forward, +Z up. All mounts follow the
receiver and preserve unit scale; their local +Y is rifle-forward (glTF -Z).

| Slot | Authored datum | Fit / eye relief | Iron state |
| --- | --- | --- | --- |
| optic | `MOUNT_optic` = (-.036, 0, .046) | RMR 125 mm | installed or folded |
| optic | same | ACOG 110 mm | installed or folded |
| optic | same | PM II 90 mm | folded only; ocular intersects deployed rear leaf |
| muzzle | `MOUNT_muzzle` = (.274, 0, 0) | shared SRD762Ti exterior, native .300 BLK direct-thread shoulder | either |
| rail | retained canted upper-right `MOUNT_rail` | TOR Mini | either |

The empty-reload glove approaches and leaves the outboard charging latch via a
90 mm lowered clearance arc, rather than crossing the three shared optic bodies.
Full latch contact, magazine transfer and mechanism/event times remain unchanged.

The optic seat is 45 mm forward of the former integrated ACOG seat to clear the
raised rear leaf. Each shared optic's physical mount contacts real rail teeth.
The base muzzle has an open throat and three prongs under `MUZZLE_device`; the
entire device hides with the can installed. The 5/8-24 thread stays on the barrel.
Bare exit is X=.317 m; mounted exit is X=.510 m, exactly at the shared endcap,
not the legacy socket 2 mm ahead. No runtime attachment scaling or offsets.
These are authored exterior game fits, not certified manufacturer hardware.

`check.py` retains the mechanism/stock, magazine and runtime-hand parity gates.
It also checks the open aligned iron bore/post, base bore, mounts, real optic
seating, declared iron clash, every optic together with suppressor/laser, and
catalog surfaces against the six mechanism/review gestures plus draw, holster
and base ADS over 1,656 native 120 Hz poses. Source review hands represent the
base configuration; mounted-optic ADS changes camera-relative arm solving, so
source sampling alone is not certification of every live ADS transition.
Engine hip/ADS screenshots for base, RMR, ACOG, PM II, suppressor and laser are
captured separately; rendering and finite samples do not replace final human
visual/animation approval.
