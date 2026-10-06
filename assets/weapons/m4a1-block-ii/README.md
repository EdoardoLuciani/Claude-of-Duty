# M4A1 Block II

Blender-authored starting rifle. Original art, not scan/CAD or certified replica.
Receiver/grip/sight contours, finish and some contacts still need human review.
History: [#339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339),
[ADS design #343](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/343).

Files: `m4a1-block-ii.blend/.glb` (packed editable source/runtime), `manifest.json`
(events/counts), `hand-reference.json` (contacts), `photo-review.json` and
`side-review.json` (frozen registration/URLs/masks, not photographs).
Normal builds need no Blender; renders/duplicate maps/backups stay untracked.

## Configuration and measurement caveats

- Colt M4A1-pattern receivers; 14.5-inch SOCOM-profile 5.56 mm barrel.
- FDE Daniel Defense **M4A1 RIS II FSP**, SKU **01-004-08030**; barrel-mounted
  A2 front-sight base and raised MaTech 600 m rear aperture.
- Unsuppressed SureFire **FH556RC-1/2-28** four-prong; black LMT SOPMOD stock,
  A2 grip, GI trigger guard and standard non-E2 aluminum USGI 30-round magazine.
- No optic, magnifier, laser, light, foregrip or rail covers. Restrained wear.

Reference anchors: [Block II configuration](https://clonerifles.com/m4a1blockii/),
[Daniel Defense RIS II FSP](https://danieldefense.com/m4a1-fsp-risii-fde.html),
[SureFire FH556RC](https://www.surefire.com/socom-4-prong-flash-hider/),
[LMT SOPMOD](https://lmtdefense.com/product/sopmod-buttstock-black/) and
[MaTech](https://www.matechsolutions.com/buis). Exact review-photo URLs and
registration estimates are in the two camera JSONs.

Closed-bolt face to crown is **368.300 mm**. The RIS main envelope is
**311.150 × 56.642 × 57.150 mm**, including teeth/side fasteners but excluding
the separate rear bolt-up flange. SureFire's **2.6 in / 6.4 cm** listing conflicts:
the provisional flash-hider length is **66.040 mm**, not simultaneously 64.000 mm.
The nominal carbine gas tube is **9.783 in / 248.4882 mm**; routing/endpoints and
internal clearances are inferred. Receiver/furniture/magazine/sight contours are
photo-informed, not certified CAD. No verified photograph of the entire exact
bare configuration has been established; component photos do not validate full-
rifle proportions. Direct DD photo downloads returned 403, not inspected-photo proof.

## Rebuild and contracts

Root commands, Blender 5.2.2 LTS and installed Node dependencies:

```sh
node tools/m4-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
npm test
npm run lint
npm run build
node tests/e2e/check-m4-game.mjs --port=5199 --out=.tmp-rend/m4-game
node tools/capture.mjs --shot=weapon --out=.tmp-rend/m4-boot.png
```

Regeneration overwrites source/GLB/manifest/maps. `--render` adds Eevee stills;
local OCIO 2.5/2.4 library mismatch may require a compatible configuration,
not runtime changes. Game metres: +X right/+Y up/−Z forward, converted by generator.

Eight 120-fps native actions: Idle, Fire, Last Shot, Tactical/Empty Reload,
Inspect, Draw, Holster. Preserve all events/durations, including fractional
.620 s draw. Game retains skins/IK, ADS/sway/reactive recoil; no duplicate arms.
Mute NLA and use invertible rest transforms while gathering static export seats;
exporter then samples tracks. Preserve visible spare descendants, separate empty-
reload charging grip and latch/stock/deformed-arm checks through the 240-Hz rack.

Export: 105,647 triangles / 32 primitives / 12 materials / 16 mesh buffers /
three 1024² maps / 7,641,228 bytes. Includes both magazines/cartridges and hidden
review case. Caps: <110k triangles, ≤40 primitives, ≤16 materials, ≤10 MiB.

## Approved ADS design H (gameplay adaptation, not factory hardware)

- Rear hole 5.6 mm; original 7.6 mm cup and sight centre retained.
- Front post 2.60 mm; upper 1.4 mm neon green `#39ff14`, emissive intensity 2.
  Sleeve clearance: 10 µm radial, 1 µm cap (+.02 mm diameter), within 2 µm aim datum.
- Fixed rear base top .1 mm below lowest inner edge, overlapping cup wall.
- No camera/FOV, recoil, handling, ballistics or accuracy changes; adapter preserves
  paint instead of metal/polymer dimming.

`node tools/capture-m4-sights.mjs --port=5208 --out=.tmp-rend/m4-sights` boots fresh
DPR-1 lockstep engines, frame 103: day/dusk 1080p and day 720p.
Shared `tools/lib/m4-sight-checks.js` checks paint, opacity, aperture rays,
.002 mm aiming datum and solid attachment (≥3 contacts, ≥.25 mm embedding).
Judge full/native frames; 3× crops are diagnostics, not motion/occlusion acceptance.

## Source/photo review

`m4_review.py` renders overview without hands/spares/case; `m4_photo_review.py`
uses recorded cameras. Both force Eevee raster and never save source. Headless
graphics context is required; no HIP/CUDA setup.

```sh
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python tools/blender/m4_review.py -- --out .tmp-rend/m4-views
# Add --view left --view right to select angles; default is all ten.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python tools/blender/m4_photo_review.py -- --out .tmp-rend/m4-photo \
  --registration assets/weapons/m4a1-block-ii/side-review.json
```

For diffs use `tools/m4-photo-diff.py --photos REF_DIR --before BEFORE --after AFTER
--out OUTPUT --registration assets/weapons/m4a1-block-ii/side-review.json`.
Keep reference filenames/dimensions, frozen uniform registration and matched backend/
settings; don't compare old Cycles frames or independently warp axes. Two-anchor zero
residual is constructed, not calibration. Weak oblique fits/lighting limits remain;
Pillow/NumPy are offline-only. Actual game HDR output is the final appearance check.
