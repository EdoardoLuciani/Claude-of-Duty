# Mossberg 590A1 Tactical — provisional runtime prototype

SKU50774 (2016): 18.5-inch barrel, 6+1, ghost rings, fixed synthetic stock and
tri-rail forend. Strict fidelity and final visual/gameplay acceptance are unapproved.
Nominal factory barrel/OAL/LOP are .4699 / 1.0033 / .352425 m. Photo-derived LOP
disagrees; published dimensions take precedence. The permanent 12g adapter adds
12 mm forward of the original crown. The 89 mm pump stroke is provisional.

[Shared workflow](../../../tools/blender/README.md)

`tools/blender/m590/build.py` owns geometry/maps; `actions.py` and
`export_actions.py` own seven clips and 120 Hz/STEP export. `skin.py` and
`finishes.py` prepare four-joint mechanical skin and UV1 scalar finish tiles.
The insertion shell remains independent, unskinned and never a magazine.
Native metres export −Z forward/+Y up without an adapter scale/basis correction.
Manifest sockets/events/contact windows are authority, not a second schedule.
Shared arms and hand calibration are read-only; ordinary builds never refit.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/m590/build.py
blender -b -t 2 assets/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/m590/check.py
bun run models:cook -- m590
```

Use `--output /tmp/m590-review` for scratch builds. Preserve one mixer,
event-only gameplay bridge, pump-owned casing ejection, authored shell visibility,
cancellation/reset and 6+1 accounting. Keep full right-arm skin checks.

All five firing-arm skins now require **zero crossings** against the stock,
receiver/tang and trigger guard. A 0.10 mm inward relief at the lower stock wrist
removes the former two-face glove contact. The old raw-file/topology-pinned 30 µm
exception is retired, not repinned or widened; restoring the old stock fails at
Idle frame 0. Shared arms/calibration and all seven animation tracks are unchanged.
Shoulder offsets remain presentation compromises, not anatomical approval.
Preserve AgX color management.

## Integrated rear sight and attachment seats

The default has the integrated ghost-ring irons and no optic/glass, suppressor or
laser. `removableIrons` stays unset. The receiver now carries an **AIMPRO-style
low rail with an integrated rear ghost ring**, replacing both the factory rear
assembly and the former tall bridge. This is an aftermarket game-art configuration,
not the original SKU50774 sight assembly or manufacturer CAD certification.

[Reference photos and published 4-inch/eight-slot description](https://jerkingthetrigger.com/2013/10/29/aimpro-tactical-ghost-ring-rail/)
show a receiver-hugging base, recessed fasteners and a protected rear aperture.
Our 101.6 mm rail section has eight slots, four modeled screw heads/shanks with
receiver bores, and a continuous underside following the actual receiver roof.
Its contact plane is **27 mm lower** than the former bridge. The original .096 m
iron sightline, front blade/shroud, barrel/OAL/LOP anchors and safety are retained.
Local outlines and screw stations are photo-derived estimates, not engineering drawings.

| Datum | Runtime metres / orientation | Ownership |
| --- | --- | --- |
| `MOUNT_optic` | `[0, .091, -.134196]`, identity | receiver; low eight-slot rail |
| `MOUNT_muzzle` | `[0, .068, -.6672884763]`, identity | receiver; adapter forward face |
| `MOUNT_rail` | `[0, .009, -.575]`, identity | receiver; fixed forward magazine-tube clamp rail |

`fits.optic` enables **RMR / ACOG** with .120 / .100 m eye relief. The PM II fit is
removed: its approximately 128 mm ring spacing cannot seat on this compact rail.
The actual RMR/ACOG meshes pass four foot-contact rays each and strict checks
against the receiver base, integrated sight, weapon, hands and moving parts.
Nine real-surface rays check continuous base seating; the ghost-ring bore stays open.

## Optional TOR Mini (#686)

The shared laser is a separate optional asset. `rail: 'laser'` installs it;
`rail: null` removes the module while leaving the base weapon's tube clamps/rail.
No purchase/customization UI or handling bonus is added. Mount +Y points into
the seat and −Z stays forward; gameplay and independent inspection share the solver.

Two clamps at z=−.572/−.590 support the short underside rail on the fixed magazine
tube, ahead of the moving forend and clear of the cap fluting/barrel lug. Eight
radial rays verify actual tube seating; the web is supported at both clamps.
All support hardware remains fixed through the provisional 89 mm pump stroke.
`check.py` runs the complete source gates, not just the isolated laser sweep:
**739 poses at 120 Hz** cover both deformed hands, mechanisms, visible insertion
hull, supported optics, laser hardware/module and emitter corridor. A native-WebGPU
fixture additionally checks **10,194 runtime poses** across irons/RMR/ACOG,
including hip/ADS pump, reloads, draw/holster, inspect, recoil, transitions,
returns and cancellation. Actual skins clear native/cooked laser hardware,
the relieved stock neck, integrated top rail/sight and the selected optic.

The open-bore 12g muzzle adapter remains permanent seating hardware, **not** a
suppressor. `SOCKET_muzzle` stays at its exit, while `DATUM_barrel_crown` retains
the factory measurement. The separate `suppressor12g` fit now uses this exact seat (#715); see below.
See the [shared laser contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

Draw, holster, pump/fire, both reloads and inspect keep their original controls,
contacts and timings; reactive recoil moves the assembly. Export stays below 79k
triangles, with two primitives, one material and three images. Finite sampled
checks are not continuous clearance, strict 1:1 fidelity or final human approval.

For play review, buy/equip the secondary and inspect fire/ADS/reload/transitions.
Historical optimization measurements and external review locations are in Git;
storage reductions do not imply an FPS gain or final visual acceptance.

## Optional large-bore suppressor (#715)

`muzzle: 'suppressor12g'` mounts the new standalone
[12g expansion can](../../attachments/12g-suppressor/README.md), not the shared
rifle SRD762Ti. Its 220 mm extension puts the active exit at
`[0, .068, -.8872884763]`. Both adapter pieces remain permanent: there is no
removable `MUZZLE_device`, and clearing the slot restores the original adapter
exit. All eight pellets, FX and tracer segments consume the shared active muzzle;
no spread/count/damage or audio-bank changes.

The can clears the blade/cheeks, tube cap, lug and TOR Mini/clamps, but its wide
body intentionally occludes the low ghost-ring sightline. Fixed irons remain
unchanged; use the existing RMR/ACOG fits when suppressing, with no automatic
optic selection or eye-relief change. `muzzle.py`, appended to `check.py`, adds
actual can/TOR Mini mesh and 120 Hz full-clip deformed-hand/mechanism checks.
The rail/optic source and fitting checks are untouched. See the can README for
bore/spread bounds, commands and finite-sampling limits.
