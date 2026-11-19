# FN EVOLYS 7.62

Tan/black exterior, six-position stock, removable rail irons and inferred
100-round pouch.
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

`MOUNT_optic` is the rearmost identity rail-contact frame, where the RMR seats.
Larger optics sit whole grooves farther forward (`fits.optic[id].railSlots`) to
clear the calibrated charging-hand sweep. RMR and ACOG clear the irons; the PM II
crosses the front sight. Any mounted optic hides the irons at runtime.

`MOUNT_muzzle` seats the shared SRD762Ti at the barrel crown (+Y up, -Z forward,
unit scale). `MUZZLE_device` owns the original slotted flash hider and its shoulder;
`MUZZLE_device_removed` is an open thread sleeve shown only with the can installed,
clearing the can's rear opening without scaling the attachment.

The TOR Mini mounts directly on the underside Picatinny rail, with no side bracket.
The rail's exposed teeth below the molded covers follow FN's
[studio profile](https://fnherstal.com/app/uploads/FN-EVOLYS-7.62-studio-001.png)
and [bipod reference](https://fnherstal.com/app/uploads/STM7400-scaled.jpg). The
support hold sits behind the rail with glove-pad contact on the molded cover, and
reload/inspection routes keep the fingers curled until below/outboard of the rail.
The handguard owns the rail; the stock is rigid with no authored fold clip.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/evolys/build.py
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys/check.py
bun build/models.ts evolys
```

Before running `check.py`, regenerate the shared optic Blender products if missing
or stale (`bun tools/build-assets.ts --force`): the asset cache promises GLBs, not
standalone `.blend` review products. The checker loads the actual optics, SRD762Ti
and TOR Mini surfaces and checks rail contact, iron clashes, slot coexistence,
fixed-surface clearance, the mounted exit and a through-bore gauge. It sweeps
cover/charging/stock/belt and both deformed hands across every clip at 120 Hz.
The asset has no bipod.

Use `--output /tmp/evolys-review --quick` for scratch builds. UV rounding and
normal-encoding exceptions are bounded in the source map.
