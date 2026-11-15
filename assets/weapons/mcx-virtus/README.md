# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS iron-sight base, short M-LOK guard, folding stock, open
three-prong muzzle device and MAG800 magazine. Optional TA31F/TA51 and SRD762Ti
are shared attachments, not integrated geometry. Original art; dimensions and finish are not factory certification.

[Source map](../../../tools/blender/mcx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python is authority; native blend/GLB/maps/manifest and cooked runtime GLB are
generated. The adapter rebases the native frame once on load and samples authored
mechanism, wrist/finger and equip actions. Shared upper/forearm IK, mounted optics
and pooled cases remain runtime-owned.
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
`magazineBody`; independent transfer geometry remains.

## Blender-authored hands

`hand-reference.ts` explicitly calibrates grip/finger poses into the checked-in
`hand-reference.json`. `hands.py` authors wrist/finger, draw and holster actions in
Blender. Normal builds read that calibration without executing gameplay or
rewriting authoring inputs. Refit intentionally after changing contact geometry:

```sh
bun tools/blender/mcx/hand-reference.ts
```

The saved source includes `MCX | authored hands (shared appearance)`. The shared
review-arm baker poses these skins from the same native controls exported to the
game; the skins themselves remain excluded from the weapon GLB. Native actions
drive wrists/fingers through the shared runtime rig; upper/forearm IK responds to
the live stance. The MCX adapter rebases the whole native scene, skin, curves and
origin into game space once on load, then uses the shared wrist targets.

Select a paired mechanism/hand clip in Blender's Python console:

```py
import sys
sys.path.insert(0, '/path/to/checkout/tools/blender')
from mcx.review_hands import select_review_clip
select_review_clip('Reload_Empty')
```

`check.py` validates native controls, shared review-skin exclusion and wrist
continuity across hidden magazine states, then sweeps mechanisms and deformed
hands against catalog attachment surfaces. Source sampling is not continuous
collision certification or final human animation approval.

## TOR Mini rail (#686)

The optional laser is enabled by `fits.rail.laser`. Its game-fit Picatinny adapter
seats on the existing upper-right handguard chamfer, canted approximately 36.25°
upward from vertical. The backing, five teeth and screws
move together; six actual-surface rays verify backing contact at both screw
stations. The native check also preserves the iron sight line and checks the
actual module/support hardware against mechanisms and both
review arms across 1,656 source poses, including Draw/Holster and Idle_ADS.
This is an authored game-fit adapter, not a factory accessory/CAD claim.

The authored empty-reload hand passes below the rail before returning to the
support grip. Source checks sample all native clips, including draw/holster, and
preserve the adapter seat, emitter clearance, magazine transfer and mechanism
beats. Live movement/ADS and interruption behavior must also be reviewed in the
runtime; the saved review scene is not a substitute for that validation.

```sh
bun tools/capture.ts --weapon=mcx --rail=laser --shot=weapon --out=/tmp/mcx-laser.png
```
See the [mount table, source sweep and limitations](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

## Iron-sight base and attachment fits (#662)

The base has no optic, glass or suppressor. Standalone optics and the SRD762Ti
use the shared [attachment contract](../../../ARCHITECTURE.md#models).
Installing/removing the can changes the effective suppression state, not handling.

The existing backup bases/hinges remain on the rail. `IRON_sights` contains a
hinge-supported open rear aperture and deployed front post/protective ears;
`IRON_sights_removed` contains the original folded leaves. Rear aperture center
and front post tip are both at native Z=77 mm, separated by 382 mm. The 5 mm
rear bore and base eye relief of 60 mm provide an open, centered sight picture.
Any mounted optic shows the folded leaves instead; removing it redeploys them.

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

Each shared optic's physical mount contacts real rail teeth ahead of the raised rear leaf.
The base muzzle has an open throat and three prongs under `MUZZLE_device`; the
entire device hides with the can installed. The 5/8-24 thread stays on the barrel.
Bare exit is X=.317 m; mounted exit is X=.510 m, exactly at the shared endcap,
with no runtime attachment scaling or offsets.
These are authored exterior game fits, not certified manufacturer hardware.

`check.py` checks mechanisms, stock, magazines and native hand controls, plus
iron/muzzle bores, real optic seating, declared iron clashes and catalog surfaces
against the native clips with shared review skins. Mounted-optic ADS and live
movement change upper/forearm solving; source sampling alone does not certify
all runtime transitions. Engine hip/ADS, reload and inspect captures remain
separate from the finite source checks and final human visual approval.
