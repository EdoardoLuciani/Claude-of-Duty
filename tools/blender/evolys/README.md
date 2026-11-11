# EVOLYS source map

[Shared workflow](../README.md) ·
[Asset and build commands](../../../assets/weapons/fn-evolys-762/README.md)

- `build.py`: geometry, seeded maps, belt, atlas, studio and stage order.
- `actions.py`: eight sparse actions, hand controls and events.
- `export.py`: 120 Hz lattice, exact endpoints, STEP resets and static joins.
- `finish_atlas.py`: base/ORM on UV1; original normal detail stays on UV0.

Hand calibration and shared review arms are read-only. Refit intentionally with
`bun tools/blender/evolys/hand-reference.ts`, never during ordinary rebuilds.
[`../review_hands.py`](../review_hands.py) owns shared review-arm baking for EVOLYS
and MPX.
Save editable sparse actions before export. Fire/Last_Shot last 60/700 s;
preserve held endpoint samples, matching NLA names and TRS resets.

## Ordinary rigid export (current)

Receiver/handguard join as static surfaces. `IRON_sights` remains independently
removable; there is no integrated optic or lens. `SOCKET_sight` owns the rear
aperture centre, aligned with `SOCKET_front_post`. `MOUNT_optic` is the rail-contact
frame; `MOUNT_muzzle` remains a future datum. `MOUNT_rail` seats TOR Mini on
a two-leg upper-right offset bracket; the existing side interface owns its feet.
Stock, bolt, handle, feed cover
and trigger remain ordinary meshes in their original local/control frames.
Only the eight-joint belt is skinned; both pouches have independent STEP ownership.
Keep 12.7 mm belt pitch, separate finish tiles and persistent runtime round masks.
The registered cook uses shared gltfpack flags without added simplification.
`check.py` requires freshly generated shared optic blends and checks actual
mounted RMR/ACOG/PM II surfaces against irons and animated cover, charging handle,
stock, belt and deformed shared hands at 120 Hz. PM II crosses the front iron;
RMR/ACOG retain both irons. The common TOR Mini checker adds all-clip 120 Hz laser/hand/emitter checks.
No future suppressor or authored stock-fold fit is certified.

## Approved UV precision exception

After modifiers/atlas assignment, UVs round ties-to-even to 1/16384.
Maximum displacement is .03125 texel at 1024; some UV triangles collapse.
This is not exact seam/tangent preservation or all-device shading equivalence.
Historical mechanical-skin comparisons alone retain the approved 0.0026
normal-vector bound. Neither exception relaxes geometry, contacts or other weapons.
Detailed historical measurements/reviews remain in Git; human sign-off is separate.
