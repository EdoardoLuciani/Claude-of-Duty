# Mossberg 590A1 Tactical — provisional runtime prototype

SKU50774 (2016): 18.5-inch barrel, 6+1, ghost rings, fixed synthetic stock and
tri-rail forend. Strict fidelity and final visual/gameplay acceptance are unapproved.
Nominal factory barrel/OAL/LOP are .4699 / 1.0033 / .352425 m. Photo-derived LOP
disagrees; published dimensions take precedence. The permanent 12g adapter adds
12 mm forward of the original crown. The 89 mm pump stroke is provisional.

[Shared workflow](../README.md)

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
blender -b -t 2 .cache/blender/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/m590/check.py
bun build/models.ts m590
```

Use `--output /tmp/m590-review` for scratch builds. Preserve one mixer,
event-only gameplay bridge, pump-owned casing ejection, authored shell visibility,
cancellation/reset and 6+1 accounting. Keep full right-arm skin checks.

All firing-arm skins require zero crossings against the stock, receiver/tang and
trigger guard. Shoulder offsets remain presentation compromises, not anatomical
approval. Preserve AgX color management.

## Integrated rear sight and attachment seats

The default has the integrated ghost-ring irons and no optic/glass, suppressor or
laser; `removableIrons` stays unset, so mounted optics must clear the fixed irons.
The receiver carries an AIMPRO-style low rail with an integrated rear ghost ring
([reference photos and published description](https://jerkingthetrigger.com/2013/10/29/aimpro-tactical-ghost-ring-rail/)),
an aftermarket game-art configuration rather than the original sight assembly.
Its scout extension runs forward over the barrel on a receiver-seated base so the
PM II's complete pedestal envelopes sit on real teeth. The original iron sightline,
front blade/shroud, barrel/OAL/LOP anchors and safety are retained.

| Datum          | Ownership                                        |
| -------------- | ------------------------------------------------ |
| `MOUNT_optic`  | receiver; extended top rail                      |
| `MOUNT_muzzle` | receiver; permanent 12g adapter forward face     |
| `MOUNT_rail`   | receiver; fixed forward magazine-tube clamp rail |

Rails and clamp channels use the [shared Picatinny profile](../README.md#common-picatinny-interface).
Only mating rail teeth may contact optic feet; all other weapon surfaces stay strict.
See `check.py` for the seating and clearance thresholds.

The TOR Mini rail is supported by two clamps on the fixed magazine tube, ahead of
the moving forend and clear of the cap fluting/barrel lug; all support hardware
stays fixed through the pump stroke. `check.py` sweeps deformed hands, mechanisms,
the visible insertion hull, mounted optics, laser hardware and emitter corridor
through the full native clips. See the
[shared laser contract](../tor_mini/README.md#weapon-mounting).

The open-bore 12g muzzle adapter is permanent seating hardware, **not** a
suppressor: `SOCKET_muzzle` stays at its exit, while `DATUM_barrel_crown` retains
the factory measurement. The `suppressor` fit mounts the dedicated
[12g expansion can](../suppressor12g/README.md) on that seat; its
wide body intentionally occludes the low ghost-ring sightline. `muzzle.py`,
appended to `check.py`, checks the can against the actual optic meshes, sight
rays, TOR Mini and the full-clip hand/mechanism sweep.

For play review, equip the secondary and inspect fire, ADS, reloads and transitions.
