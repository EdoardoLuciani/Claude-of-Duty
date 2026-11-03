# SIG MPX

Black select-fire 8-inch MPX, deployed stock, ROMEO4T and MPX-specific SRD9.
Solid 1.5 mm polymer cap lids are approved; closed lids intentionally occlude
the optic. General animation/gameplay/optic human acceptance remains outstanding.
Original art, not a certified replica.

[Source map](../../../tools/blender/mpx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

The adapter converts +X-forward/+Z-up/−Y-right once and samples eight clips.
Ordinary meshes preserve actual cap pivots, mechanisms, independent magazines and
rounds. Preserve lockback, cancellation, chamber accounting and pooled ejection.
Three materials retain original finish colors and UV0 grain, with UV1 finish tiles.
Body lenses stay at 2% opacity; the world-sized 2 MOA dot has a six-pixel floor.
Hand calibration/review-arm inputs are read-only. Normal builds use local assets.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend \
  --python-exit-code 1 --python tools/blender/mpx/check.py
npm run models:cook -- mpx
node tests/smoke/smoke-mpx.mjs
```

Use `--output /tmp/mpx-review` for scratch builds. The registered cook retains
material boundaries and 16-bit colors; do not adopt more aggressive optic-rim
simplification. The source map records the UV-repeatability limitation.
Historical representation/storage comparisons remain in Git, not an FPS claim.
