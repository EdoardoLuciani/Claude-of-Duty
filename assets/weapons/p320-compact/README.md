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

## Attachment contract

The base has no glass, reticle, suppressor or laser. SIGLITE irons are fixed
(`removableIrons` unset), and there is no optic rail, plate, `MOUNT_optic` or
`fits.optic`, so every optic is rejected. The optional TOR Mini laser and compact
9mm suppressor are supported independently or together.

| Datum | Owner / orientation |
| --- | --- |
| `MOUNT_muzzle` | tilting barrel; -Z forward, +Y up, unit scale |
| `MOUNT_rail` | frame; local +Y points into the underside seat |

The thread travels with the barrel, not the slide; the enlarged upper muzzle
opening clears barrel tilt. SIGLITE rings and luminous insets are baked onto the
sight faces in the shared atlas; the checker samples green emission at the inset
centres, a neutral rear housing and front-facing upper-ring normals.

The TOR Mini seats on an extended game-fit integral frame rail with one extra
cross-slot (not the factory Compact frame). Its nose stays below the bore/slide
path and never follows the slide. See the
[shared laser mount contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting).

## Compact 9mm suppressor

The `suppressor` fit names the `suppressor9mm` can model: the original
[compact booster can](../../attachments/compact-9mm/README.md). The muzzle seat
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
laser first (`bun run assets`).
