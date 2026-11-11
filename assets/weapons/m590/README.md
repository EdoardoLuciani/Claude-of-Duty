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

The approved shared-glove tessellation exception lives in `clearance.py`:
exact file/topology hashes and two glove faces against the stock, with an absolute
30 µm signed-distance ceiling. It is not a general tolerance or triangle skip.
Other intersections still fail. Shoulder offsets and firing-hand calibration are
presentation compromises, not anatomical approval. Preserve AgX color management.

## Fixed irons and attachment seats

The default is bare ghost-ring irons: no optic/glass, suppressor or laser.
`removableIrons` stays unset. A see-through receiver bridge supports all three
shared optics above the fixed rear ring; its paired feet follow the receiver
roof and leave the iron bore open. The 190 mm rail supports both PM II ring
stations. It neither rides on nor extends into the pump stroke.

| Datum | Runtime metres / orientation | Ownership |
| --- | --- | --- |
| `MOUNT_optic` | `[0, .118, -.140]`, identity | receiver |
| `MOUNT_muzzle` | `[0, .068, -.6672884763]`, identity | receiver; adapter forward face |
| `MOUNT_rail` | `[0, .009, -.590]`, identity | receiver; fixed forward magazine-tube clamp rail |

Mount +Y points into the rail seat and −Z remains forward. The base
`SOCKET_muzzle` emits at the adapter exit, coincident with `MOUNT_muzzle`;
`DATUM_barrel_crown` preserves the original factory barrel measurement and front
sight references. The open-bore 12g adapter is permanent seating hardware, not a suppressor. The suppressor seat remains a future datum, not a fit certificate. TOR Mini
(#686) instead uses two fixed tube clamps at z=−.580/−.605 and a supported short
underside rail, ahead of the pump and behind the clean-out cap. It remains fixed
through all 89 mm of pump travel; no forend geometry or hand calibration changed.
Its source sweep checks actual TOR surfaces/hands at all 739 clip poses (120 Hz).
See the [shared laser checks and limits](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

`fits.optic` enables RMR / ACOG / PM II with eye relief .120 / .100 / .085 m respectively.
`check.py` requires freshly generated shared optic `.blend` products (normal
`bun run assets` builds them). `mounts.py` appends those actual meshes and checks
four rail contacts per optic, fixed-iron clearance, the open ghost-ring line,
receiver-foot seating, adapter bore/face, fixed laser-rail ownership, and both evaluated
hands/mechanisms/visible insertion hull across all seven clips at 120 Hz.
Draw, holster, pump/fire handling, both reloads and inspect keep their original
controls, contacts and timings; reactive shot recoil moves the assembled weapon.
The added rail/adapter and tube-clamp rail raise the export triangle budget to 79k without adding a
material, image or primitive.

### Review limitation (#667)

The available regenerated shared-arm product does not match the historical
`clearance.py` raw `.blend` SHA256 or its pinned evaluated-glove topology hash.
The unchanged baseline and changed weapon both stop at Idle frame 0 with
`unreviewed shared-arm input`; a temporary raw-byte-hash-only diagnostic then
stops at `unreviewed glove topology`. Neither pin, contact region nor 30 µm bound
has been changed. A full `check.py` pass is **not** claimed. Independent comparison
found both complete evaluated hands and topology bit-identical to the available
baseline across all 739 clip poses; that is regression evidence, not certification
against the unavailable historically approved hand product. Resolve this shared
input provenance separately before claiming the original right-hand certificate.

For play review, buy/equip the secondary and inspect fire/ADS/reload/transitions.
Historical optimization measurements and external review locations are in Git;
storage reductions do not imply an FPS gain or final visual acceptance.
