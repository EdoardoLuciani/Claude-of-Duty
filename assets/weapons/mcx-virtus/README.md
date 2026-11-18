# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS iron-sight base, short M-LOK guard, folding stock, open
three-prong muzzle device and MAG800 magazine. Optional TA31F/TA51 and SRD762Ti
are shared attachments, not integrated geometry.

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
hands against catalog attachment surfaces.

## Side-profile reference

SIG's [2018 commercial catalog, printed page 49](https://luxuscap.com/wp-content/uploads/2025/12/2018-SIG-SAUER-COMMERCIAL-CATALOG.pdf#page=51)
identifies the gray VIRTUS SBR in .300 BLK with a 9-inch barrel and short M-LOK
guard. The [matching SIG product photograph](https://images.eurooptic.com/images/products/sig-sauer/0/sig-sauer-mcx-virtus-sbr-9-rifle-rmcx-300b-9b-tap-sbr.jpg)
is available through [Scopelist](https://www.scopelist.com/sig-sauer-mcx-300blk-9-with-telescoping-folding-stock-rmcx-300b-9b-tap-sbr).
Register the side view at the front rail edge using one scale from the repeated
rail teeth. Use the same scale for the receiver, magazine and grip.

The guard has a shallow lower edge, bore-height side slots and a diagonal rear
shoulder supported by the receiver nose. The barrel, bare flash hider and muzzle
attachment datum share that bore axis. The support-hand calibration follows the
guard; optic/laser seating and the stock hinge retain their independent fits.
The stock has a tapered lower shoulder, an angled recoil pad and a rounded toe
with a narrow relief slot above it. The rifle photograph shows a translucent
Lancer magazine. The lower receiver tapers into the grip saddle. The grip widens
toward its sloped heel, and the seated polymer magazine sweeps forward below the
well lip and ends in an angled floorplate. The rear of the magazine blends into
the neck below the lip, and the trigger guard curves into the well with a
continuous front band. The well lip frames an open mouth during reloads. Both
magazines share the same exterior and glove contact.

## Attachment fits

The base has no optic, glass or suppressor; standalone optics, the SRD762Ti and
the TOR Mini use the shared [attachment contract](../../../ARCHITECTURE.md#models).
`IRON_sights` holds the hinge-supported open rear aperture and deployed front
post/ears; `IRON_sights_removed` holds the folded leaves shown under any optic.
Native Blender coordinates are metres, +X forward, +Z up; every mount follows the
receiver with unit scale and local +Y rifle-forward (glTF -Z).

| Slot | Authored datum | Iron state |
| --- | --- | --- |
| optic | `MOUNT_optic` | installed or folded; the PM II ocular needs folded leaves |
| muzzle | `MOUNT_muzzle` at the direct-thread shoulder | either |
| rail | canted upper-right `MOUNT_rail` on a game-fit handguard adapter | either |

The base muzzle's open three-prong device lives under `MUZZLE_device` and hides
with the can installed; the thread stays on the barrel. The empty-reload glove
leaves the charging latch on a lowered arc so it clears the optic bodies and passes
below the laser rail.

`check.py` checks mechanisms, stock, magazines and native hand controls, plus
iron/muzzle bores, real optic seating, declared iron clashes, laser seating and
emitter clearance, and catalog surfaces against the native clips with shared
review skins.

```sh
bun tools/capture.ts --weapon=mcx --rail=laser --shot=weapon --out=/tmp/mcx-laser.png
```
