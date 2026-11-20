# SIG MPX

Black select-fire 8-inch MPX with deployed removable irons and a bare 9mm barrel
crown/thread protector. Original reference-informed game art; human
visual/animation/gameplay acceptance is pending.

[Source map](../../../tools/blender/mpx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

The adapter converts +X-forward/+Z-up/−Y-right once and samples eight clips with
unchanged timelines/events and calibrated grip endpoints. Draw/holster support-hand
approaches move below/outboard of the PM II; holster releases early and returns
after the objective clears. Ordinary meshes retain independent mechanisms,
magazines and rounds.
Preserve lockback, cancellation, chamber accounting, shared hand calibration and
pooled ejection. One opaque material retains original finish colors and UV0 grain;
UV1 keeps the original finish-tile indices, including reserved unused finishes.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py
# Build the catalog attachments with bun tools/build-assets.ts before running source checks.
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend \
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

| Slot | Authored datum | Catalog fits |
| --- | --- | --- |
| Optic | `MOUNT_optic`, rail-contact plane | shared optics |
| Muzzle | `MOUNT_muzzle`, bore-forward | shared `suppressor` (SRD762Ti) |
| Rail | `MOUNT_rail`, bore-forward | TOR Mini `laser` |

Optic and muzzle frames rotate Blender +Y forward onto weapon +X; the adapter
preserves canonical shared-attachment locals at all three mount boundaries. RMR and
ACOG clear the deployed irons; the PM II needs them folded. The can swaps
`MUZZLE_device` (thread protector) for `MUZZLE_device_removed` (an adapter sleeve
bridging the crown to the shared rear mount); see the
[shared calibre decision](../../attachments/sig-srd762ti/README.md). The right-side
laser adapter is anchored through the last M-LOK slot.

`check.py` verifies catalog seating, iron clashes, both iron states, concurrent
slots, fixed surfaces, every clip's mechanisms and deformed hands at 120 Hz, plus
independent stock-fold and charging-handle sweeps (mechanical checks, not gameplay
animations).

```sh
bun tools/capture.ts --weapon=smg --shot=ads --out=/tmp/mpx-irons.png
bun tools/capture.ts --weapon=smg --rail=laser --muzzle=suppressor --shot=weapon --out=/tmp/mpx-attachments.png
```
