# M4A1 Block II

Starting rifle: Colt-pattern receivers, 14.5-inch SOCOM barrel, FDE RIS II FSP,
A2 front-sight base, raised MaTech rear aperture, FH556RC four-prong,
black LMT SOPMOD/A2 grip and non-E2 USGI 30-round magazine. No accessories.
Original art, not scan/CAD; receiver/grip/sights/finish still need human review.

## References and datums

[Block II configuration](https://clonerifles.com/m4a1blockii/),
[DD RIS II FSP](https://danieldefense.com/m4a1-fsp-risii-fde.html),
[SureFire FH556RC](https://www.surefire.com/socom-4-prong-flash-hider/),
[LMT SOPMOD](https://lmtdefense.com/product/sopmod-buttstock-black/),
[MaTech](https://www.matechsolutions.com/buis).
Barrel face-to-crown: 368.300 mm; main RIS envelope: 311.150 × 56.642 × 57.150 mm,
excluding rear flange. SureFire's 2.6 in/6.4 cm listing conflicts; provisional
flash-hider length is 66.040 mm. Hidden depths/gas routing are inferred.
Component photos don't certify the complete bare configuration; DD downloads
returned 403. Exact photo registration/URLs remain in the review JSONs.

## Source/runtime and approved sights

The [M4 source map](../../../tools/blender/m4/README.md) owns edit locations,
read-only calibration/review-arm inputs and native 120 Hz/STEP export details.
Follow the [shared workflow](../../../tools/blender/README.md): Python is authority,
blend/GLB/maps/manifest are generated. `photo-review.json` and `side-review.json`
record reference limitations.
Eight native clips preserve events/durations, shared IK/ADS/sway/reactive recoil.
Keep invertible rest seats, matching NLA tracks, visible spare descendants and
empty-reload latch/stock/deformed-arm clearance. No duplicate arms/live cases.
Caps: <110k triangles, ≤40 primitives, ≤16 materials, four 1024² maps, ≤10 MiB.
The selected balanced finish adds a receiver-only albedo map with 25% of the
original variation around the same mean. The other three maps remain shared.
Receiver linear RGB is .041/.043/.046, roughness .44, normal strength .08;
FDE .56/.16, polymer .80/.55, phosphate steel .56/.16, magazine .67/.18
(roughness/normal). Metalness is unchanged; no added clearcoat. Source generation
and exported-material smoke checks own these settings, not runtime overrides.

The rear hole is restored to its original 2.2 mm bore and 7.6 mm outer cup;
the original sight centre and 2.60 mm post are unchanged. The upper 1.4 mm
neon-green tip is retained. The lower support clears the opening by 0.1 mm
while remaining attached; the historical untrimmed support occluded the bore.
Preserve paint/opacity, aperture rays, aim datum and solid attachment checks.
Selected runtime ADS framing is 60 mm eye relief / 42° vertical weapon FOV;
world zoom, sight dimensions and ballistics are independent.

## Rebuild/check (root, Blender 5.2.2)

```sh
# Only when intentionally changing shared hand calibration:
# node tools/m4-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
# Non-destructive scratch build:
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- \
  --output /tmp/m4-authoring-review --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
node tests/smoke/smoke-m4.mjs
```

Use frozen uniform registration for visual review: no after-only reframing or
independent X/Y warp; final native frames are authority.
History: [#339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339),
[sight approval #343](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/343).
