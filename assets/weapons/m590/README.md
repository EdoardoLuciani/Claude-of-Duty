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

All firing-arm skins require zero crossings against the stock, receiver/tang and
trigger guard. Shoulder offsets remain presentation compromises, not anatomical
approval. Preserve AgX color management.

## Integrated rear sight and attachment seats

The default has the integrated ghost-ring irons and no optic/glass, suppressor or
laser. `removableIrons` stays unset. The receiver carries an AIMPRO-style low rail
with an integrated rear ghost ring. This is an aftermarket game-art configuration,
not the original SKU50774 sight assembly or manufacturer CAD certification.

[Reference photos and published 4-inch/eight-slot description](https://jerkingthetrigger.com/2013/10/29/aimpro-tactical-ghost-ring-rail/)
show a receiver-hugging base, recessed fasteners and a protected rear aperture.
The game-art scout extension now has **174.904 mm of teeth**, 18 lugs / 17 slots
at 10.0076 mm pitch, from z **−255.452 to −80.548 mm**. The common Picatinny
profile supports the PM II's complete pedestal envelopes. The extension runs
forward over the barrel on a receiver-seated base with a thin cantilever.
Paired surface rays and evaluated meshes check barrel clearance. The original
iron sightline, front blade/shroud, barrel/OAL/LOP anchors and safety are retained.
Local outlines and screw stations are photo-derived estimates, not engineering drawings.

| Datum | Runtime metres / orientation | Ownership |
| --- | --- | --- |
| `MOUNT_optic` | `[0, .091, -.168]`, identity | receiver; extended seventeen-slot rail |
| `MOUNT_muzzle` | `[0, .068, -.6672884763]`, identity | receiver; adapter forward face |
| `MOUNT_rail` | `[0, .009, -.575]`, identity | receiver; fixed forward magazine-tube clamp rail |

`fits.optic` enables **RMR / ACOG / PM II / EXPS3** with .120 / .100 / .090 / .200 m eye relief.
Rails and clamp channels use the [shared Picatinny profile](../../../tools/blender/README.md#common-picatinny-interface).

The PM II has **130 mm cross-bolt spacing**, two 28 mm pedestals requiring 158 mm
of rail, and a 177 mm one-piece base. Both complete pedestal envelopes are within
the actual teeth; eight foot-contact rays cover both ends of both pedestals.
Its base and housing must clear the fixed ears and front sight. Only mating
rail teeth may contact optic feet; all other weapon surfaces remain strict.
The ghost-ring bore stays open with no optic mounted. See `check.py` for the
current seating and clearance thresholds; sampled checks are not manufacturer
installation tolerances or continuous-clearance certification.

## Optional TOR Mini (#686)

The shared laser is a separate optional asset. `rail: 'laser'` installs it;
`rail: null` removes the module while leaving the base weapon's tube clamps/rail.
Mount +Y points into the seat and −Z stays forward; gameplay and independent
inspection share the solver.

Two clamps at z=−.572/−.590 support the short underside rail on the fixed magazine
tube, ahead of the moving forend and clear of the cap fluting/barrel lug. Eight
radial rays verify actual tube seating; the web is supported at both clamps.
All support hardware remains fixed through the provisional 89 mm pump stroke.
`check.py` sweeps deformed hands, mechanisms, the visible insertion hull,
mounted optics, laser hardware and emitter corridor through the full native clips.

The open-bore 12g muzzle adapter remains permanent seating hardware, **not** a
suppressor. `SOCKET_muzzle` stays at its exit, while `DATUM_barrel_crown` retains
the factory measurement. The `suppressor` fit (can model `suppressor12g`) uses this exact seat (#715); see below.
See the [shared laser contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

For play review, equip the secondary and inspect fire, ADS, reloads and
transitions. Finite source sampling is not final visual/gameplay acceptance.

## Optional large-bore suppressor (#715)

`muzzle: 'suppressor'` mounts the M590's `suppressor12g` model, the standalone
[12g expansion can](../../attachments/12g-suppressor/README.md), not the shared
rifle SRD762Ti. Its 220 mm extension puts the active exit at
`[0, .068, -.8872884763]`. Both adapter pieces remain permanent: there is no
removable `MUZZLE_device`, and clearing the slot restores the original adapter
exit. All eight pellets, FX and tracer segments consume the shared active muzzle;
no spread/count/damage or audio-bank changes.

The can clears the blade/cheeks, tube cap, lug and TOR Mini/clamps, but its wide
body intentionally occludes the low ghost-ring sightline. Fixed irons remain
unchanged; use the RMR/ACOG/PM II fits when suppressing, with no automatic
optic selection or eye-relief change. `muzzle.py`, appended to `check.py`, checks
the can against all four actual optic meshes and sight rays alongside TOR Mini
and 120 Hz full-clip deformed-hand/mechanism checks. The combined check retains
the rail/pedestal and fixed-ear clearance gates. See the can README for bore/spread
bounds, commands and finite-sampling limits.
