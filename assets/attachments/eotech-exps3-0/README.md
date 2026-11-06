# EOTECH EXPS3-0 attachment

Standalone visual-review candidate, not mounted in gameplay or engineering-certified.
`tools/blender/exps3.py` owns geometry/export; `exps3_bake.py` owns the atlas.
Blend/native GLB/maps/manifest and cooked runtime GLB are generated products.
See `reference-review.json` for references, rights and visual limitations.

[Shared workflow](../../../tools/blender/README.md)

Run from the repository root with Blender 5.2.2, compatible AgX and gltfpack 1.3:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py
npm run models:cook -- exps3
```

Use `--output /tmp/exps3-review --render` for scratch review.
Native metres export −Z forward/+Y up under `ATTACHMENT_exps3`; mount is the
rail-top origin. Optical height .0482 m is provisional. Verify seating,
co-witness and ADS on the intended weapon. The 68/1 MOA reticle is metadata only,
not a baked mesh. Body/glass stay separate with three 1024² PBR maps.
