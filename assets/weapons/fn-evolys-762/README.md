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
Hand calibration and shared review arms are read-only. `IRON_sights` owns both
iron assemblies; `SOCKET_sight` is the rear aperture centre, aligned with the
front post tip. Removing irons leaves the bare rail, without replacement parts.

`MOUNT_optic` is an identity rail-contact frame on tooth 30 (z = -0.19650 m),
forward of the calibrated charging-hand sweep. Shared RMR and
ACOG fit with irons installed; PM II crosses the front sight and requires irons
removed (`opticClashes: ['scope']`). Eye relief is weapon/optic tuning, not a
change to the shared optic geometry. A bare rail with no optic/irons remains valid.

`MOUNT_muzzle` reserves the existing flash-hider exit on the bore axis (-Z forward).
`MOUNT_rail` reserves a right-side mounting plane at (0.0275, 0.075, -0.300),
4 mm outboard of the handguard shell/M-LOK interface, with local +Y pointing
outboard (+X). No side-rail adapter geometry is authored. These are **future
datums only**: suppressor and laser catalogs are absent (#670/#671); no fit or
animated clearance is claimed for nonexistent attachments. The authored stock is rigid; there is no fold clip.

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

The checker loads their actual surfaces and
checks rail contact, iron clashes, and cover/charging/stock/belt/deformed-hand
clearance across every clip at 120 Hz, including exact endpoints. Native checks
and browser captures are evidence, not final human visual approval.

Use `--output /tmp/evolys-review --quick` for scratch builds.
UV rounding and historical normal-encoding exceptions are bounded in the source
map; they do not waive contacts, human approval or establish an FPS improvement.
