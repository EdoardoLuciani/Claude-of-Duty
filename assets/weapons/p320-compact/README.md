# P320 Compact

Nitron Compact game base, curved trigger, fixed SIGLITE irons, threaded barrel
and flush 15-round magazine. The bare slide retains fixed SIGLITE iron sights;
optic customization is unsupported. The extended under-barrel laser seat and
threaded barrel are game-fit adaptations, not a certified factory replica.

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
never exposure compensation.

## Attachment contract (#666)

The base has no glass, reticle, suppressor or laser. SIGLITE irons are fixed:
`removableIrons` stays unset. There is no optic rail, plate or `MOUNT_optic`, and
`fits.optic` is absent: gameplay, inspection, market and capture validation reject
all optics. Only the optional TOR Mini laser and compact 9mm suppressor are supported,
independently or together. The normal iron-sight ADS pose is unchanged.

Game-space mount datums in metres (native Blender uses +Y forward, +Z up):

| Datum | Position | Owner / orientation |
| --- | --- | --- |
| `MOUNT_muzzle` | `[0, .037, -.132]` | tilting barrel; -Z forward, +Y up, unit scale |
| `MOUNT_rail` | `[0, .002, -.122]` | frame; local +Y points into the underside seat; frame-owned TOR Mini |

The thread travels with the barrel, not the slide; the enlarged upper muzzle
opening clears barrel tilt. `check.py` checks thread/slide clearance and the fixed
iron ray, then runs the laser and suppressor weapon/hand sweeps across all eight
clips. These are sampled external-fit checks, not collision-free internal
operating geometry. Hands, authored action timing and ammunition events are unchanged.
SIGLITE rings and luminous insets are baked onto the sight faces, with extra
host-island UV density in the same atlas. They have no overlapping runtime caps.
The checker samples green emission at all three projected inset centres,
neutral rear sight housing and front-facing upper-ring normals.

TOR Mini (#686) uses an explicitly extended game-fit integral frame rail: its
front advances 14 mm to native +Y=.141 and a fifth cross-slot at .129 supports the
module's forward seat. This is not a factory Compact frame. The nose projects a
few millimetres ahead of the barrel but remains below its bore/slide path; it
never follows the slide. The source sweep tests actual deformed hands at 120 Hz,
including the early tactical/empty reload intervals missed by a coarser sweep.
See the [shared laser mount contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

## Compact 9mm suppressor (#714)

The P320's `suppressor` fit names the `suppressor9mm` can model: the original
[compact booster can](../../attachments/compact-9mm/README.md), not the shared
SRD762Ti rifle exterior.
The muzzle seat follows the tilting barrel, never the frame or slide.
`MUZZLE_device` owns the removable thread protector; `MUZZLE_device_removed`
owns the exposed helical thread. Both are ordinary meshes under the barrel bone
and share its atlas; the barrel tube/crown stays in the mechanical skin.
Preserve the thread geometry: bevel decimation can enlarge its crest into the
booster receiving bore. The common solver switches the two states.

The can is 135 mm long and at most 28.4 mm across. In loaded rest its top is
51.2 mm above the rig origin, leaving **2.5 mm below** the fixed SIGLITE 53.7 mm
aim ray. No raised sights, hidden irons or altered ADS position are needed.
During the actual Browning tilt
and empty lockback the bore moves, as it should; this is not a claim that a
locked-open handgun retains a live firing sight picture.

`check.py` includes the asset-owned `suppressor.py` sweep: 1172 poses at 120 Hz
across all eight clips (Idle, Fire, Last_Shot, Reload_Tactical, Reload_Empty,
Inspect, Draw, Holster), including exact endpoints. It verifies the invariant
barrel-relative mount matrix, intersections against the **evaluated mechanical
skin**, all ten deformed mesh components belonging to both shared arms/hands,
TOR Mini and its emitter ray. It also ray-tests the loaded-rest
iron sightline. Editable sparse source controls are not used as a proxy
for subframe mechanical-skin motion. Source checks are sampled external-fit
proofs, not internal booster engineering or continuous collision certification.

Build the compact can and laser first (`bun run assets`), then run
the Blender check above. Native WebGPU hip and iron ADS captures and runtime
exit/part-switch checks supplement the source sweep.
