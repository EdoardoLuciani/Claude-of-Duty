# SIG MPX

Black select-fire 8-inch MPX with deployed removable irons and a bare 9mm barrel
crown/thread protector. Original reference-informed game art; human
visual/animation/gameplay acceptance is pending.

[Shared workflow](../README.md)

The adapter converts +X-forward/+Z-up/−Y-right once and samples eight clips with
calibrated grip endpoints. The two-sided inspect keeps both hands on the weapon. Draw/holster support-hand
approaches move below/outboard of the PM II; holster releases early and returns
after the objective clears. Ordinary meshes retain independent mechanisms,
magazines and rounds.
Preserve lockback, cancellation, chamber accounting, shared hand calibration and
pooled ejection. One opaque material retains original finish colors and UV0 grain;
UV1 keeps the original tile indices for the finishes used by the model.

Run from the repository root with Blender 5.3.0 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py
# Build the catalog attachments with bun tools/build-assets.ts before running source checks.
blender -b -t 2 .cache/blender/weapons/sig-mpx/mpx.blend \
  --python-exit-code 1 --python tools/blender/mpx/check.py
bun build/models.ts mpx
```

Use `--output /tmp/mpx-review` for scratch builds. The registered cook retains
material boundaries and 16-bit colors. The source map records the narrow
UV-repeatability limitation.

## Base sights and attachment fits

Source Blender metres, +X forward, +Z up. `SOCKET_muzzle` is at the thread
protector's end; base firing is unsuppressed.

`IRON_sights` owns both deployed clamps, hinges and leaves; base ADS aims through
the rear peep, not an optical axis. `IRON_sights_removed` keeps the same hardware
folded flat for any mounted optic.

| Slot   | Authored datum                    | Catalog fits                   |
| ------ | --------------------------------- | ------------------------------ |
| Optic  | `MOUNT_optic`, rail-contact plane | shared optics                  |
| Muzzle | `MOUNT_muzzle`, bore-forward      | shared `suppressor` (SRD762Ti) |
| Rail   | `MOUNT_rail`, bore-forward        | TOR Mini `laser`               |

Optic and muzzle frames rotate Blender +Y forward onto weapon +X; the adapter
preserves canonical shared-attachment locals at all three mount boundaries. Railway and
ACOG clear the deployed irons; the PM II needs them folded. The can swaps
`MUZZLE_device` (thread protector) for `MUZZLE_device_removed` (an adapter sleeve
bridging the crown to the shared rear mount); see the
[shared calibre decision](../suppressor/README.md). The short Picatinny rail
sits back from the front lip on the upper-right handguard chamfer and stays
visible with or without the laser. The TOR Mini shares the rail's cant and
still points along the bore.

`check.py` verifies catalog seating, iron clashes, both iron states, concurrent
slots, fixed surfaces, every clip's mechanisms and deformed hands at 120 Hz, plus
independent stock-fold and charging-handle sweeps (mechanical checks, not gameplay
animations).

```sh
bun tools/capture.ts --weapon=smg --shot=ads --out=/tmp/mpx-irons.png
bun tools/capture.ts --weapon=smg --rail=laser --muzzle=suppressor --shot=weapon --out=/tmp/mpx-attachments.png
```

## Exterior reference

The receiver, handguard, telescoping stock, grip and magazine are registered to
one scale from the [2019 SIG SAUER defense catalog][catalog], printed page 23
(PDF page 25), labeled **SIG MPX 8″ SBR**. Compare the right side orthographically.
The photo shows an optional optic, folded irons and a compensator; the game's
base build shows deployed irons, a thread protector and a canted side rail.
Those differences are intentional. First-person iron ADS uses a separate
camera setback and does not rescale the model.

[catalog]: https://www.sigsauer.com/pub/media/sigsauer/resources/2019_DEFENSE_CATLOG_web.pdf#page=25

## Source map

- `build.py`: geometry/maps/studio/stages; `actions.py`: eight actions/hands/events.
- `animations.py`: runtime sampling/reset; `finishes.py`: finish colors/tiles.

Hand calibration and shared arms are read-only. Refit separately with
`bun tools/blender/mpx/hand-reference.ts`.
Save editable components/sparse actions before runtime joins.
Keep the smart-project atlas, original UV0 grain and padded 4×4 UV1 finish tiles.
The base has no optical surfaces. Deployed and folded irons, thread protector
and suppressor adapter each retain a separate rigid visibility owner. UV1 uses
explicit sparse slots: unused tiles remain blank without moving any finish.
Attachment frames preserve shared canonical locals during the adapter basis change.

Ordinary meshes retain original local frames: do not rebase them to reduce draws.
Mechanisms follow original animated parents; magazines/rounds remain independent.
Preserve Blender packed corner normals rather than re-encoding decoded vectors.
Motion uses the 120 Hz lattice, held exact endpoints (Fire/Last_Shot 60/950 s),
LINEAR motion, CONSTANT/STEP scales and explicit child TRS resets.
Stock Actions export keeps forced sampling off; output inspection is read-only.

### Approved repeatability limit

Evaluated-bevel UVs may differ by 1.1920928955078125e-7 UV (.0001220703125 texel
at 1024). Atlas preservation takes precedence: GLB byte-repeatability remains
unmet for those bytes. Do not round/repack/reproject either UV set.
Maps, manifest and non-UV payloads still require exact comparison.
Historical measured pairs remain in Git; this exception does not waive human
visual/gameplay acceptance or permit whole-geometry tolerances.
