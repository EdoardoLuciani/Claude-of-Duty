# P320 Compact

Nitron Compact game base, curved trigger, fixed SIGLITE irons, threaded barrel
and flush 15-round magazine. The bare slide retains fixed SIGLITE iron sights;
optic customization is unsupported. The compact under-barrel laser seat and
threaded barrel are game-fit adaptations, not a certified factory replica.

[Shared workflow](../README.md) ·
[Runtime cook](../../../build/README.md)

Sources live in `tools/blender/p320/`: `build.py` stages geometry/materials,
`surfaces.py` owns the bake surfaces and UV layout, `skin.py` owns the rigid
bones, and `actions.py`/`export.py` own the clips and sampled export.
The mechanical skin and two ordinary barrel-owned muzzle-state meshes share one
opaque material and one UV layout across all four maps. The blend retains
editable high bake sources, including the slide wordmark and SIGLITE insets.
Preserve STEP magazines, sockets, events, hand contacts and runtime slide overrides.
Shared arms and `hand-reference.json` are read-only; ordinary builds never refit.

`Inspect` uses the [CS2 Glock-18 viewmodel](https://www.youtube.com/watch?v=-7spynqkYTk&t=2s)
as a motion reference only.

Run from the repository root with Blender 5.3.0 and gltfpack 1.3:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320/build.py
blender -b -t 8 .cache/blender/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320/check.py
bun build/models.ts p320
```

Use `--output /tmp/p320-review --render --quick` for scratch source builds.
The registered cook is lossy; inspect lettering, highlights, reloads and idle
before further simplification. KTX2/meshopt decoders stay local; RGBA8 fallback
does not retain compressed-texture memory savings. Use compatible AgX OCIO,
never exposure compensation.

## Attachment contract

The base has no glass, reticle, suppressor or laser. SIGLITE irons are fixed
(`removableIrons` unset), and there is no optic rail, plate, `MOUNT_optic` or
`fits.optic`, so every optic is rejected. The optional TOR Mini laser and compact
9mm suppressor are supported independently or together.

| Datum          | Owner / orientation                            |
| -------------- | ---------------------------------------------- |
| `MOUNT_muzzle` | tilting barrel; -Z forward, +Y up, unit scale  |
| `MOUNT_rail`   | frame; local +Y points into the underside seat |

The thread travels with the barrel, not the slide; the enlarged upper muzzle
opening clears barrel tilt. SIGLITE rings and luminous insets are baked onto the
sight faces in the shared atlas; the checker samples green emission at the inset
centres, a neutral rear housing and front-facing upper-ring normals.

The TOR Mini seats on a shortened game-fit integral frame rail (not the factory
Compact frame), with its activation pads immediately ahead of the trigger guard.
Reload and handling hand paths clear the module, which stays below the bore/slide
path and never follows the slide. See the
[shared laser mount contract](../tor_mini/README.md#weapon-mounting).

## Compact 9mm suppressor

The `suppressor` fit names the `suppressor9mm` can model: the original
[compact booster can](../suppressor9mm/README.md). The muzzle seat
follows the tilting barrel. `MUZZLE_device` owns the removable thread protector;
`MUZZLE_device_removed` owns the exposed helical thread, both ordinary meshes under
the barrel bone. Preserve the thread geometry: bevel decimation can enlarge its
crest into the booster receiving bore. In loaded rest the can stays below the fixed
SIGLITE aim ray, so no raised sights or altered ADS position are needed; during
tilt and empty lockback the bore moves, as it should.

`check.py` checks thread/slide clearance and the fixed iron ray, then runs the
laser and asset-owned `suppressor.py` sweeps at 120 Hz across every clip. They
verify the barrel-relative mount, intersections against the evaluated mechanical
skin, both shared arms, TOR Mini and its emitter ray. Build the compact can and
laser first (`bun tools/build-assets.ts`).
