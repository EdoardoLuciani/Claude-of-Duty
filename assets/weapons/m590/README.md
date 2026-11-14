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
The game-art scout extension now has **164.904 mm of teeth**, 17 lugs / 16 slots
at 10.008 mm pitch, from z **−247.2 to −82.296 mm**. The former nominal 101.6 mm
section actually had only 84.84 mm of tooth envelope. The extension grows forward
over the barrel, not back through the fixed ghost-ring ears. Four modeled screw
heads/shanks and receiver bores remain unchanged; the continuous receiver-seated
base gains a thin cantilever (front underside y=83 mm, top y=86.5 mm).
Nine paired surface rays measure a minimum **2.175 mm barrel gap** under it;
strict evaluated-mesh checks also reject barrel intersections.
Its contact plane remains **27 mm lower** than the former bridge. The original .096 m
iron sightline, front blade/shroud, barrel/OAL/LOP anchors and safety are retained.
Local outlines and screw stations are photo-derived estimates, not engineering drawings.

| Datum | Runtime metres / orientation | Ownership |
| --- | --- | --- |
| `MOUNT_optic` | `[0, .091, -.168]`, identity | receiver; extended sixteen-slot rail |
| `MOUNT_muzzle` | `[0, .068, -.6672884763]`, identity | receiver; adapter forward face |
| `MOUNT_rail` | `[0, .009, -.575]`, identity | receiver; fixed forward magazine-tube clamp rail |

`fits.optic` enables **RMR / ACOG / PM II** with .120 / .100 / .090 m eye relief.
The datum moves **33.804 mm forward** to seat the PM II without altering the shared
optic asset or mount solver. RMR/ACOG are therefore not geometrically unchanged:
their compatibility, four-ray seating, strict animated clearance and native-WebGPU
ADS framing were revalidated at their unchanged eye relief.

The PM II has **130 mm cross-bolt spacing**, two 28 mm pedestals requiring 158 mm
of rail, and a 177 mm one-piece base. Both complete pedestal envelopes are within
the actual teeth; eight foot-contact rays cover both ends of both pedestals.
Its base's rear edge stops 0.500 mm before the fixed ears. Evaluated surface BVHs
and bidirectional vertex-to-surface sampling measure **0.500 mm base/ear** and
**2.718 mm upper-scope/ear** gaps (including the ocular grip ridges, rather than
assuming the initial 2.5 mm tube estimate), with
**187.28 mm housing/front-sight** separation. Only mating rail teeth may contact
optic feet; receiver base, ears, barrel, front sight/cheeks and every other weapon
surface remain strict. The ghost-ring bore stays open with no optic mounted.
Native-WebGPU hip, ADS and transition captures select .090 m scope eye relief;
the P4FL overlay/reticle and catalog .25 ADS FOV scale remain shared, with no
weapon-stat, audio or global optic changes. These are sampled game-fit measurements,
not manufacturer installation tolerances or a continuous-clearance certificate.

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
hull, RMR/ACOG/PM II (including the full pump stroke under the new overhang),
laser hardware/module and emitter corridor. Historical native-WebGPU
fixture evidence additionally checked **10,194 runtime poses** across irons/RMR/ACOG
before the #716 rail/datum change,
including hip/ADS pump, reloads, draw/holster, inspect, recoil, transitions,
returns and cancellation. Actual skins clear native/cooked laser hardware,
the relieved stock neck, integrated top rail/sight and the selected optic.

The open-bore 12g muzzle adapter remains permanent seating hardware, **not** a
suppressor. `SOCKET_muzzle` stays at its exit, while `DATUM_barrel_crown` retains
the factory measurement. The suppressor seat is still a future datum, not a fit.
See the [shared laser contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

Draw, holster, pump/fire, both reloads and inspect keep their original controls,
contacts and timings; reactive recoil moves the assembly. The extension adds
564 triangles (78,770 → **79,334**, +0.72%); its approved ceiling is now 80k,
with unchanged two primitives, one material, three images and 12 MiB native-byte
limit. The cooked runtime model is 3,735,092 bytes. Finite sampled
checks are not continuous clearance, strict 1:1 fidelity or final human approval.

For play review, buy/equip the secondary and inspect fire/ADS/reload/transitions.
Historical optimization measurements and external review locations are in Git;
storage reductions do not imply an FPS gain or final visual acceptance.
