# SIG MPX

Black select-fire 8-inch MPX with deployed removable irons, a bare 9mm barrel
crown/thread protector and no optional attachment installed. The integrated
ROMEO4T and MPX-specific SRD9 are removed. Original reference-informed game art,
not a certified replica; human visual/animation/gameplay acceptance is pending.

[Source map](../../../tools/blender/mpx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

The adapter converts +X-forward/+Z-up/−Y-right once and samples eight clips with
unchanged timelines/events and calibrated grip endpoints. Draw/holster support-hand
approaches move below/outboard of the PM II; holster releases early and returns
after the objective clears. Ordinary meshes retain independent mechanisms,
magazines and rounds.
Preserve lockback, cancellation, chamber accounting, shared hand calibration and
pooled ejection. One opaque material retains original finish colors and UV0 grain;
UV1 keeps the original 15 finish-tile indices, including reserved retired finishes.
No ROMEO lens, cap, glass policy or built-in reticle remains in the runtime model.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py
# Build the catalog attachments with bun run assets before running source checks.
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend \
  --python-exit-code 1 --python tools/blender/mpx/check.py
bun run models:cook -- mpx
```

Use `--output /tmp/mpx-review` for scratch builds. The registered cook retains
material boundaries and 16-bit colors. The source map records the narrow
UV-repeatability limitation; export success is not human visual acceptance.

## Base sights and verified fits (#663)

All coordinates below are source Blender metres (+X forward, +Z up).
The 203.2mm barrel extends from x=.109 to .3122, with a real open 9.4mm crown.
`SOCKET_muzzle` is x=.3182 at the thread protector's end. Base firing is
unsuppressed; only the configured shared suppressor selects suppressed audio/FX.

`IRON_sights` owns both deployed clamps, hinges and leaves. The rear 3.6mm peep
at x=−.079 and front blade at x=.284 share z=.074. Base ADS uses this rear datum,
60mm eye relief and a .7 weapon-FOV ratio, not the removed ROMEO optical axis.
`IRON_sights_removed` retains the same hardware folded flat; any mounted optic folds
the irons, and removing it redeploys them.

| Slot | Authored datum | Enabled catalog fits |
| --- | --- | --- |
| Optic | `MOUNT_optic` [.025, 0, .044], rail-contact plane | RMR: .125m eye relief; ACOG: .11m; PM II: .09m |
| Muzzle | `MOUNT_muzzle` [.3162, 0, 0], bore-forward | shared `suppressor` |
| Rail | `MOUNT_rail` [.295, −.037, 0], bore-forward | TOR Mini `laser` |

Optic and muzzle frames rotate Blender +Y forward onto weapon +X. The adapter
preserves canonical shared-attachment locals at **all three** mount boundaries.
RMR/ACOG clear the deployed irons; PM II intersects the rear deployed sight. Any
mounted optic hides the irons at runtime, and the PM II housing clears the folded
front hardware. The forward sight clamp remains supported on the last real teeth.

The can replaces `MUZZLE_device` (thread protector) with
`MUZZLE_device_removed` (authored adapter sleeve). The sleeve bridges the crown
to the shared rear mount with .2mm radial envelope clearance. The shared asset
retains its 236×44mm SRD762Ti-inspired exterior but now has a **10.4mm-clear
GAME-FIT endcap/shadow annulus** and an open rear sleeve. This is explicitly not
manufacturer-approved 9mm SRD762Ti compatibility or a physical baffle redesign;
see the [shared caliber decision](../../attachments/sig-srd762ti/README.md).

The right-side laser adapter retains its 43.5mm backing, four supported teeth and
two anchors through the last M-LOK slot. The existing strict TOR check samples
998 poses at 120Hz with actual hardware, emitter corridor and both deformed arms.
The MPX check additionally verifies actual catalog seating, iron clashes, both iron
states, concurrent slots, fixed surfaces, all eight clips' mechanisms/deformed
hands at 120Hz, 181 stock-fold poses and 39 charging-handle positions. These finite
samples are not continuous clearance or final gameplay approval. The stock and
charging sweeps are independent mechanical checks, not new gameplay animations.

```sh
bun tools/capture.ts --port=5175 --weapon=smg --shot=weapon --out=/tmp/mpx-base.png
bun tools/capture.ts --port=5175 --weapon=smg --shot=ads --out=/tmp/mpx-irons.png
bun tools/capture.ts --port=5175 --weapon=smg --optic=scope --shot=ads --out=/tmp/mpx-scope.png
bun tools/capture.ts --port=5175 --weapon=smg --rail=laser --muzzle=suppressor --shot=weapon --out=/tmp/mpx-attachments.png
```
