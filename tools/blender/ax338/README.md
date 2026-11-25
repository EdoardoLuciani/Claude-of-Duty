# Early Accuracy International AX338

Early solid-carrier AX338, .338 LM/27-inch barrel, Dark Earth panels, ten-round
magazine, factory brake and removable rail-mounted aperture/post irons. Original
art; human sign-off is pending.

[Shared workflow](../README.md)

Sources are `tools/blender/ax338/build.py`, `actions.py`, `export.py` and
`finishes.py`. Grip/photo-review JSON, hand calibration and shared review arms
are read-only inputs; never refit during ordinary rebuilds.
Ordinary meshes retain nine clips, independent magazines and `IRON_sights`.
Preserve 60°/100 mm bolt motion, the 1.1 s cycle, 2.8/3.6 s reloads, events,
STEP visibility and spent-ammo persistence. Runtime sampling normalizes rotations.
The registered cook uses 16-bit colors/positions without added simplification.

Run from the repository root with Blender 5.3.0 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338/build.py
blender -b -t 2 .cache/blender/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/check.py
bun build/models.ts ax338
```

Use `--output /tmp/ax338-review` for scratch builds. Build the standalone optics
before running the attachment checks (normal `bun run build` does this).

## Sights and attachment datums

Game-frame metres, +Y up / -Z forward, under `AX338_RIG`:

| Datum          | Contract                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| `SOCKET_sight` | Rear aperture centre, aligned with the front post tip                                       |
| `MOUNT_optic`  | Identity orientation; actual top-rail tooth contact plane                                   |
| `MOUNT_muzzle` | Barrel-crown seating plane for the dedicated .338 can; identity, unit scale                 |
| `MOUNT_rail`   | Right-side KeySlot/Picatinny adapter ahead of the support hand; local +Y points inward (-X) |

Irons are one removable `IRON_sights` assembly with no replacement part. Railway and
ACOG clear the installed irons; the PM II crosses the rear aperture, and any mounted
optic hides the irons at runtime.

`check.py` loads each standalone optic and checks foot seating, iron clashes, the
aperture opening and post alignment. It sweeps every clip's bolt and deformed
hand/sleeve poses with the optics and irons, plus a separate geometric stock-fold
sweep around the physical hinge (not a gameplay fold action).

The AX338's `suppressor` fit mounts the dedicated
[.338 suppressor](../suppressor338/README.md). `MUZZLE_device` owns
the factory brake **and** lock nut; installing the can hides both and shows the open
adapter under `MUZZLE_device_removed`. `muzzle.py` (also called by `check.py`)
checks the can/adapter against every component, the evaluated hands and the mounted
TOR Mini/optics; the adapter meets the barrel only at the crown plane. The asset has
no bipod.

**Full right-hand DCC acceptance still fails** against the grip allowance; passing
the muzzle or attachment sweeps does not waive it. Reproduce the report with:

```sh
blender -b -t 2 .cache/blender/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/contact.py -- --side right --out /tmp/ax338-right.json
```
