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

`m4a1-block-ii.blend/.glb`, `manifest.json`, `hand-reference.json`,
`photo-review.json` and `side-review.json` are maintained inputs/exports.
Eight native clips preserve events/durations, shared IK/ADS/sway/reactive recoil.
Keep invertible rest seats, matching NLA tracks, visible spare descendants and
empty-reload latch/stock/deformed-arm clearance. No duplicate arms/live cases.
Caps: <110k triangles, ≤40 primitives, ≤16 materials, three 1024² maps, ≤10 MiB.

Approved H is a gameplay adaptation, not factory hardware: 5.6 mm rear hole in
the original 7.6 mm cup, original sight centre and 2.60 mm post, upper 1.4 mm
neon-green tip. Fixed lower support joins the cup below the inner edge.
Preserve paint/opacity, aperture rays, aim datum and solid attachment checks.
No camera/FOV/ballistic retuning.

## Rebuild/check (root, Blender 5.2.2)

```sh
node tools/m4-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
node tests/smoke/smoke-m4.mjs
node tests/e2e/check-m4-game.mjs --out=.tmp-rend/m4-game
node tools/capture-m4-sights.mjs --out=.tmp-rend/m4-sights
```

Regeneration overwrites source/exports; normal builds need no Blender.
`m4_review.py` / `m4_photo_review.py` use Eevee and frozen uniform registration.
No after-only reframing or independent X/Y warp; final native frames are authority.
History: [#339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339),
[sight approval #343](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/343).
