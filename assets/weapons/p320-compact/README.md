# P320 Compact

Nitron Compact game base, curved trigger, fixed SIGLITE irons, threaded barrel
and flush 15-round magazine. The optics-ready slide/cantilever rail is an original
universal game-fit adaptation, not a factory early-production configuration or a
certified replica.

[Shared workflow](../../../tools/blender/README.md) ·
[Runtime cook](../../../build/README.md)

Sources live in `tools/blender/p320/`: `build.py` stages geometry/materials,
`surfaces.py` and `color_uv.py` own bake surfaces/lettering UVs, `skin.py` owns
nine rigid bones, and `actions.py`/`export.py` own eight clips and 60 Hz export.
The mechanical skin and two ordinary barrel-owned muzzle-state meshes share the atlas.
The blend retains editable high bake sources. Native and cooked exports use one
physical material and four 1024² maps; color uses UV1, other maps UV0.
Preserve STEP magazines, sockets, events, hand contacts and runtime slide overrides.
Shared arms and `hand-reference.json` are read-only; ordinary builds never refit.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320/build.py
blender -b -t 8 assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320/check.py
bun run models:cook -- p320
```

Use `--output /tmp/p320-review --render --quick` for scratch source builds.
The registered cook is lossy; inspect lettering, highlights, reloads and idle
before further simplification. KTX2/meshopt decoders stay local; RGBA8 fallback
does not retain compressed-texture memory savings. Use compatible AgX OCIO,
never exposure compensation. Historical measurements/exceptions remain in Git.

## Attachment contract (#666)

The base has no glass, reticle, suppressor or laser. SIGLITE irons are fixed:
`removableIrons` stays unset and every supported optic must clear the installed
irons. A recessed slide plate supports an open-centre cantilever rail. Its 180 mm
length supports the shared PM II's 177 mm mounting foot (ring pedestals at ±65 mm)
and the ACOG's 96 mm shoe; the shared RMR retains its existing high riser.
This deliberately oversized universal support is not a real pistol recommendation.

Game-space mount datums in metres (native Blender uses +Y forward, +Z up):

| Datum | Position | Owner / orientation |
| --- | --- | --- |
| `MOUNT_optic` | `[0, .066, -.003]` | slide; identity rail contact |
| `MOUNT_muzzle` | `[0, .037, -.132]` | tilting barrel; -Z forward, +Y up, unit scale |
| `MOUNT_rail` | `[0, .002, -.122]` | frame; local +Y points into the underside seat; frame-owned TOR Mini |

The rail underside is at .062 m, above the .0537 m iron aim ray and .056 m rear
sight top. Side supports end before the ejection port. The thread travels with the
barrel, not the slide; the enlarged upper muzzle opening clears barrel tilt.
`check.py` loads the available shared optic Blender sources and checks mounted
weapon/hand intersections, thread/slide clearance, iron ray and ejection corridor
across all eight clips. Rail/optic-foot seating is intentional contact. These are
sampled external-fit checks, not collision-free internal operating geometry.
SIGLITE islands reserve extra UV0 density within the same 1024² atlas: otherwise
sub-texel luminous caps can disappear when added geometry repacks the UVs. The
checker samples baked green emission at all three actual inset centres.

The adapter caches the optic mount's **rest** rig-local transform, so changing an
optic during slide lockback cannot move the settled ADS datum. Mounted geometry
and the RMR's live optical axis follow the actual animated slide, including in
independent market inspection clones. Hands, authored action timing, mechanical
skin and ammunition events are unchanged.

Pistol eye relief is measured from each shared `SOCKET_sight`, not from the slide:
RMR .394 m, ACOG .308 m, PM II .200 m. The differing rear ocular offsets leave the
slide at approximately the original -.373 m ADS extension for all three, rather
than pulling the handgun up to the face or fully extending the elbows. These are
**game long-eye-relief fits**, not claims about real TA31/PM II exit pupils. The
current runtime renders magnified sights with its common scope overlay and hides
the gun at full ADS; geometry-visible ADS review is needed in addition to a full
ADS screenshot to verify the arm/sight relationship. Native WebGPU review at
1600×1000 verified -.372827 m rig Z for every fit, with right-arm reach
.5943–.5947 m against a .630 m limit (base irons .6019 m). Independent inspection
clones reset a locked-open source to loaded rest without mutating gameplay.

TOR Mini (#686) uses an explicitly extended game-fit integral frame rail: its
front advances 14 mm to native +Y=.141 and a fifth cross-slot at .129 supports the
module's forward seat. This is not a factory Compact frame. The nose projects a
few millimetres ahead of the barrel but remains below its bore/slide path; it
never follows the slide. The source sweep tests actual deformed hands at 120 Hz,
including the early tactical/empty reload intervals missed by a coarser sweep.
See the [shared laser mount contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

## Compact 9mm suppressor (#714)

The separate `suppressor9mm` catalog entry loads the original
[compact booster can](../../attachments/compact-9mm/README.md), not the shared
SRD762Ti rifle exterior. `fits.muzzle` enables only this verified pistol fit.
`MOUNT_muzzle` now uses the shared attachment frame (the former future-datum
contact-normal rotation was not a suppressor orientation). Its rear seat advances over the exposed barrel thread at native +Y=.132 m,
not the crown-tip base exit at .1445 m. It remains under the
**barrel bone**, never the frame or slide. `MUZZLE_device` owns the removable
thread-protector sleeve; `MUZZLE_device_removed` owns the exposed helical thread.
Both are ordinary meshes under the same animated barrel and share the existing
atlas. The barrel tube/crown stays in the mechanical skin. The narrow thread ribbon
retains its authored geometry: bevel decimation had enlarged its crest and
would intersect the booster receiving bore. Common mount/remove
logic switches the two states; no motion, hand tuning, stats or audio banks change.

The can is 135 mm long and at most 28.4 mm across. In loaded rest its top is
51.2 mm above the rig origin, leaving **2.5 mm below** the fixed SIGLITE 53.7 mm
aim ray. No raised sights, hidden irons or altered ADS position are needed.
The RMR/ACOG/PM II optical rays also clear it. During the actual Browning tilt
and empty lockback the bore moves, as it should; this is not a claim that a
locked-open handgun retains a live firing sight picture.

`check.py` includes the asset-owned `suppressor.py` sweep: 1172 poses at 120 Hz
across all eight clips (Idle, Fire, Last_Shot, Reload_Tactical, Reload_Empty,
Inspect, Draw, Holster), including exact endpoints. It verifies the invariant
barrel-relative mount matrix, intersections against the **evaluated mechanical
skin**, all ten deformed mesh components belonging to both shared arms/hands,
three mounted optics, TOR Mini and its emitter ray. It also ray-tests loaded-rest
iron/optic sightlines. Editable sparse source controls are not used as a proxy
for subframe mechanical-skin motion. Source checks are sampled external-fit
proofs, not internal booster engineering or continuous collision certification.

Build the compact can and shared optics/laser first (`bun run assets`), then run
the Blender check above. Native WebGPU before/after hip, iron ADS and RMR ADS
captures and runtime exit/part-switch checks supplement the source sweep.
