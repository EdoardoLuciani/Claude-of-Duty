# FN EVOLYS 7.62

Tan/black exterior, six-position stock, removable rail irons and inferred
100-round pouch.
Original art; human visual sign-off remains pending.

[Shared workflow](../README.md)

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
blender -b .cache/blender/weapons/fn-evolys-762/fn-evolys-762.blend \
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

## Source map

- `build.py`: geometry, seeded maps, belt, atlas, studio and stage order.
- `actions.py`: eight sparse actions, hand controls and events.
- `export.py`: 120 Hz lattice, exact endpoints, STEP resets and static joins.
- `finish_atlas.py`: base/ORM on UV1; original normal detail stays on UV0.

Ordinary rebuilds treat hand calibration and shared review arms as inputs. Refit intentionally with
`bun tools/blender/evolys/hand-reference.ts`, never during ordinary rebuilds.
Save editable sparse actions before export. Fire/Last_Shot last 60/700 s;
preserve held endpoint samples, matching NLA names and TRS resets.

### Ordinary rigid export (current)

Receiver/handguard join as static surfaces. `IRON_sights` remains independently
removable; there is no integrated optic or lens. `SOCKET_sight` owns the rear
aperture centre, aligned with `SOCKET_front_post`. `MOUNT_optic` is the rail-contact
frame for the RMR; larger optics seat whole grooves forward of the charging hand.
`MOUNT_muzzle` seats the unchanged SRD762Ti at the barrel crown.
`MUZZLE_device` removes the original hider/shoulder and
`MUZZLE_device_removed` supplies the open game-fit sleeve. `MOUNT_rail` seats TOR Mini directly
on the reference underside Picatinny rail. The intentionally rearward support
hold and staged release/regrip clear the rail and module without a side bracket.
Stock, bolt, handle, feed cover
and trigger remain ordinary meshes in their original local/control frames.
Only the eight-joint belt is skinned; both pouches have independent STEP ownership.
Keep 12.7 mm belt pitch, separate finish tiles and persistent runtime round masks.
The registered cook uses shared gltfpack flags without added simplification.
`check.py` requires freshly generated shared optic blends and checks actual
mounted RMR/ACOG/PM II surfaces against irons and animated cover, charging handle,
stock, belt and deformed shared hands at 120 Hz. PM II crosses the front iron;
RMR/ACOG retain both irons. The common TOR Mini checker adds all-clip 120 Hz
laser/hand/emitter checks and lower-rail hardware versus evaluated hands.
The same sweep checks the actual shared SRD762Ti, its 7.8 mm through-bore gauge,
fixed handguard/adapter clearance and coexistence with every optic and TOR Mini.
There is no bipod geometry/control: bipod clearance is N/A, not certified.
Sprint follows the same rigid viewmodel mount; no authored sprint or stock-fold
clip exists.

### Approved UV precision exception

After modifiers/atlas assignment, UVs round ties-to-even to 1/16384.
Maximum displacement is .03125 texel at 1024; some UV triangles collapse.
This is not exact seam/tangent preservation or all-device shading equivalence.
Historical mechanical-skin comparisons alone retain the approved 0.0026
normal-vector bound. Neither exception relaxes geometry, contacts or other weapons.
Detailed historical measurements/reviews remain in Git; human sign-off is separate.
