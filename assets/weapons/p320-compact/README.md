# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons and flush 15-round magazine.
Original game art, not a certified replica.

[Shared workflow](../../../tools/blender/README.md) ·
[Runtime cook](../../../build/README.md)

Sources live in `tools/blender/p320/`: `build.py` stages geometry/materials,
`surfaces.py` and `color_uv.py` own bake surfaces/lettering UVs, `skin.py` owns
nine rigid bones, and `actions.py`/`export.py` own eight clips and 60 Hz export.
The blend retains editable high bake sources. Native and cooked exports use one
physical material and four 1024² maps; color uses UV1, other maps UV0.
Preserve STEP magazines, sockets, events, hand contacts and runtime slide overrides.
Shared arms and `hand-reference.json` are read-only; ordinary builds never refit.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320/build.py
blender -b -t 8 assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320/check.py
npm run models:cook -- p320
```

Use `--output /tmp/p320-review --render --quick` for scratch source builds.
The registered cook is lossy; inspect lettering, highlights, reloads and idle
before further simplification. KTX2/meshopt decoders stay local; RGBA8 fallback
does not retain compressed-texture memory savings. Use compatible AgX OCIO,
never exposure compensation. Historical measurements/exceptions remain in Git.
