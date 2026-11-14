# FN EVOLYS 7.62

Tan/black exterior, six-position stock, removable rail irons and inferred
100-round pouch. No optic is installed by default.
Original art; human visual sign-off remains pending.

[Source map](../../../tools/blender/evolys/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python owns geometry, finishes and actions; blend/GLBs/maps/manifest are generated.
Ordinary rigid meshes retain independent controls; only the eight-joint belt is
skinned. Both pouches retain STEP ownership. Preserve eight clips, event timing,
12.7 mm belt pitch, persistent spent-round masks and insertion-only restoration.
Ordinary rebuilds consume saved hand calibration and shared review arms.
Refit intentionally with `bun tools/blender/evolys/hand-reference.ts`.
`IRON_sights` owns both iron assemblies; `SOCKET_sight` is the rear aperture centre, aligned with the
front post tip. A mounted optic hides them, leaving the bare rail without replacement parts.

`MOUNT_optic` is an identity rail-contact frame on tooth 30 (z = -0.19650 m),
forward of the calibrated charging-hand sweep. Shared RMR and
ACOG clear the irons; PM II crosses the front sight. Any mounted optic hides the
irons at runtime. Eye relief is weapon/optic tuning, not a change to the shared
optic geometry.

`MOUNT_muzzle` seats the unchanged shared SRD762Ti (`muzzle: 'suppressor'`)
at the 406 mm barrel crown: `[0, .075, −.5126887836]` m, +Y up, −Z
forward, unit scale. `MUZZLE_device` owns the original slotted flash hider and
its shoulder; removal restores both. `MUZZLE_device_removed` is an open
16 mm long, 18.6 mm OD / 8.2 mm bore sleeve, shown only with the can installed.
It clears the shared can's 19 mm rear opening without scaling or changing the
attachment. This is an exterior 7.62 game fit, not certified FN threading or
manufacturer-approved hardware. The installed exit is 236 mm forward of the
seat (`z = −.7486887836` m), rather than the base hider's `SOCKET_muzzle`.
The common mount solver owns switching, inspection, exit-origin ballistics/FX/
tracers and effective suppression; no EVOLYS runtime offset, stats or audio-bank
changes are needed. Review with
`?attachmentWeapon=lmg&attachmentMuzzle=suppressor` (acquire EVOLYS first).

TOR Mini (#686) mounts directly
on the underside Picatinny rail at `[0, .0165924, −.363725]`, with no side bracket.
The rail's exposed teeth below the molded covers follow FN's
[studio profile](https://fnherstal.com/app/uploads/FN-EVOLYS-7.62-studio-001.png)
and [bipod reference](https://fnherstal.com/app/uploads/STM7400-scaled.jpg);
dimensions remain photo-informed game art, not certified CAD.
The support hold is recalibrated 23 mm rearward and 16 mm lower, with a more
transverse wrap and glove-pad contact on the molded cover, for both laser and
attachment-free configurations. Reload and
inspection routes keep the fingers curled until below/outboard of the rail,
then reverse that staging on regrip; contact beats and mechanism timing remain.
The handguard owns the rail; the stock is rigid with no authored fold clip.
See the [shared laser checks and limits](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/evolys/build.py
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys/check.py
bun run models:cook -- evolys
```

Before running `check.py`, explicitly regenerate the shared optic Blender
products if missing or stale: `bun run assets -- --force`. The ordinary asset
cache promises GLBs, not standalone `.blend` review products. Weapon-independent
commands and source requirements live with the [RMR](../../attachments/trijicon-rmr/README.md),
[ACOG](../../attachments/trijicon-acog/README.md) and
[PM II](../../attachments/schmidt-bender-pm-ii/README.md) assets.

The checker loads actual RMR/ACOG/PM II, SRD762Ti and TOR Mini surfaces and
checks rail contact, iron clashes, slot coexistence, fixed handguard/receiver/
adapter clearance, the mounted exit and a 7.8 mm through-bore gauge. It sweeps
cover/charging/stock/belt and both deformed shared hands across all eight clips
at 120 Hz, including exact endpoints (reload/feed handling, draw and holster
included). Sprint is procedural whole-viewmodel motion, not a separate authored
clip; attachments follow that same rigid mount. The separate TOR Mini checker
also verifies its emitter and rail hardware. **Bipod clearance is N/A**: this
asset has no bipod geometry/control (`build.py` and manifest label it `no bipod`);
no future bipod fit is certified. Native checks and browser captures are evidence,
not final human visual approval.

Use `--output /tmp/evolys-review --quick` for scratch builds.
UV rounding and historical normal-encoding exceptions are bounded in the source
map; they do not waive contacts, human approval or establish an FPS improvement.
