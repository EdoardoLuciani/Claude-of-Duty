# EOTECH EXPS3-0 attachment

Shared gameplay optic on all weapons except P320, with a 68 MOA ring / 1 MOA dot
and the red dot's 0.62 ADS zoom. `tools/blender/exps3.py` owns geometry/export;
`exps3_bake.py` owns the atlas. Blend/native GLB/maps/manifest and cooked runtime
GLB are generated products. References, rights and visual limitations live in
`reference-review.json`. This is original game art, not manufacturer CAD.

[Shared workflow and rail contract](../../../tools/blender/README.md)

## Rebuild and validate

Run from the repository root with Blender 5.2.2, compatible AgX and gltfpack 1.3:

```sh
bun run assets
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
# Then run each weapon's saved-source check.py (commands beside each asset).
bun tools/capture.ts --weapon=rifle --optic=exps3 --rail=laser --muzzle=suppressor --shot=ads --out=/tmp/m4-exps3.png
```

The cook writes `public/models/attachments/exps3.runtime.glb`. Standalone review
is available with `blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- --output /tmp/exps3-review --render`;
`bun run models:cook -- exps3 /tmp/exps3-review` cooks that scratch native export.

## Mechanical interface

Native metres export −Z forward/+Y up under `ATTACHMENT_exps3`. `MOUNT_base`
and retained `SOCKET_mount` identify the QD saddle contact, 4.8 mm above the art
zero. `SOCKET_sight` is 43.4 mm above that plane and 23.1 mm aft of its centre.
The optical dimensions remain photo-derived, not manufacturer-certified.

The clamp channel, including the relief through the low rear casting, is cut from
the shared `tools/blender/picatinny.py` profile: exact saddle seating, 0.1 mm
transverse flank clearance, jaws 4.8 mm below contact. A fit may select whole
forward rail grooves via `railSlots` (the M4's PM II uses seven to clear its ocular
from the charging hand); never a vertical seating offset. `check_picatinny.py`
verifies every clamp and weapon rail against the same profile.

## Fits and gameplay

| Weapon / API id | EXPS3 eye relief |
| --- | --- |
| M4A1 / `rifle`, MCX / `mcx`, MPX / `smg`, EVOLYS / `lmg`, M590 / `shotgun`, AX338 / `sniper` | 200 mm |

Mounted optics replace removable irons automatically; M590 retains fixed irons.
EXPS3 uses the existing market build/ownership path (350 credits), gameplay solver
and inspection preview. `?attachmentOptic=exps3` configures the default, owned M4
at boot; capture tooling uses `applyBuild()`.

## Rendering

Body/glass remain separate with three 1024² PBR maps. Glass is thin alpha, without
a scene-transmission pass. The live-axis viewmodel reticle is not baked into the
mesh. ADS uses the red dot's 0.62 world FOV/sensitivity scale; the 1 MOA dot has a
two-pixel readability floor. The ring preserves world-angular size and hides once
it would leave the clear opening.
