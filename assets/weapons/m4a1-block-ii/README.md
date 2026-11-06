# M4A1 Block II

Starting rifle: 14.5-inch SOCOM barrel, RIS II FSP, MaTech rear aperture,
FH556RC, SOPMOD stock and USGI magazine. Original art, not a certified replica.

[Source map](../../../tools/blender/m4/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

Python owns geometry, finishes and actions; blend, GLBs, maps and manifest are
generated. Ordinary static/mechanical meshes retain eight native clips,
independent magazines/rounds and exact iron surfaces. One physical material reads
linear vertex tint and UV finish data; keep the four original 1024² maps.
The 2.2 mm rear bore, 2.60 mm post and green tip are authored geometry.
Runtime ADS uses 30 mm eye relief and 42° weapon FOV, a readability trade-off,
not changed ballistics. Hand calibration and review-arm inputs are read-only.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4/build.py -- --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4/check.py
npm run models:cook -- m4
```

Use `--output /tmp/m4-review` for scratch builds. Refit hands only intentionally.
Preserve events, STEP visibility, iron rays, lockback, contacts and resource
ownership. Representation/storage measurements and bounded normal-rounding
acceptance remain in Git history; they are not general visual or FPS approval.
