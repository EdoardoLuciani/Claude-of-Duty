# Side-reference correction: SOPMOD, USGI magazine and trigger/guard

This pass follows the user's review of `9d6b962`. It supersedes that checkpoint's
oblique stock-toe inference. **The previous rake was wrong:** the side reference
shows a pad square to the buffer axis. This is a targeted correction, not whole-
rifle photo/AAA acceptance. Other outstanding work in README.md remains open.

## Side references and fixed registration

Exact originals, filenames, dimensions, anchors, camera matrices, regions and
source URLs are recorded in `side-review.json`. Photos are review-only inputs,
not shipped textures/meshes.

- **Stock:** [LMT SOPMOD side product photograph](https://www.rooftopdefense.com/product/lmt-sopmod-battery-storage-stock/) (1080²); identity corroborated against LMT's manufacturer product/components. Rear and front cheek-roof landmarks determine ONE uniform scale/roll/translation for the whole stock, not separate fitting of its pad/web.
- **Trigger/guard:** [Colt M4A1 lower photograph](https://charliescustomclones.com/colt-m4a1-complete-lower-receiver/) (1280²). Front/rear takedown pins register the entire lower assembly; the trigger/guard region is measured without independent fitting of those parts.
- **Seated magazine:** [Colt SOCOM side photograph](https://charliescustomclones.com/colt-m4-socom-block-1-carbine-rifle-2022-custom-14-5-pinned-barrel-w-milspec-ras/) (600² original). Front/rear takedown pins register the whole rifle; only the seated magazine region is evaluated. Its KAC rail, foregrip, waffle stock and muzzle configuration are NOT the selected bare Block II and do not validate those parts. [Standard non-E2 SureFeed photographs](https://riflemags.co.uk/surefeed-5-56-22-30-round-usgi-m16-m4-magazine/) corroborate stamped body/grooves and the formed floor end.

Before is the saved source at `9d6b962`; after uses the same frozen cameras at
Idle/frame 0. No separate X/Y scaling, target-part translation or after-only
camera fit. The assumption of a side orthographic camera is approximate: these
are not certified orthographic scans. **Two anchors define a similarity exactly,
so zero anchor residual is by construction, not independent validation.** Stock
roof and pin dimensions are reconstruction datums, not manufacturer-certified
measurements. The low-resolution seated-magazine original limits accuracy.

The same white-background threshold (<195 minimum RGB) and render-alpha mask
(>127) as the earlier review are used. Fixed regions contain the targeted side
features; statistics are calculated on original pixels, before board resizing.
Boards show photo / before / after / cyan-missing + red-extra mask / RGB delta
×2. RGB deltas remain lighting/exposure-sensitive; neither metric is a scan or
whole-rifle fidelity score. No verified exact bare full-rifle photograph exists.

| Fixed side region | Mask disagreement before → after | Reduction |
| --- | ---: | ---: |
| SOPMOD stock | 111,676 → 67,603 px | 39.47% |
| Trigger/guard | 11,066 → 7,459 px | 32.60% |
| Seated USGI magazine | 1,870 → 793 px | 57.59% |

## Corrections

- Removed the rearward rake and overlong/deep toe; pad surfaces are now square
  to the buffer axis. Deepened the cheek-shell side envelope, lowered the
  enclosed storage chambers, rebuilt the web with horizontal/vertical sling
  slots, and repositioned QD sockets and lever. Real web/brace/pad support is
  tested. Contours remain photo-informed, not certified LMT dimensions.
- Reduced exposed magazine length and forward curvature while retaining the
  upper seating, feed lips, follower, top cartridges, internal wall thickness,
  formed grooves and shared spare. Replaced the 4 mm horizontal floorplate
  with a thin formed plate following the curved bottom. Exported body envelope
  is **157.894 mm** in Y versus **188.000 mm** before; this is a photo-informed
  reconstruction measurement, not a published USGI dimension. The runtime
  drop-proxy length now describes the revised geometry, not a gameplay stat.
- The old 24 mm-wide trigger-opening cutter did NOT pierce the ~34 mm-wide
  lower side walls. Cut the actual through-opening, raised/thinned the GI
  strip and seated its mounting ears/pins. Refined the exposed curved trigger
  inside the opening rather than moving its animated pivot or changing beats.
- Refit the right-hand contact into the exposed trigger: index target is
  `[0,.0235,.004]`, wrist `[.0351,-.012,.1228]` (5 mm lower / .5 mm rearward).
  The original wrist position could not reach the new trigger face within
  tolerance. No test allowance was widened. Shared runtime skins/IK are kept;
  Blender owns the updated right-hand fitting, not a new animation system.

## Validation and preservation

- **56/56 smoke scripts**, lint/build, deterministic weapon boot and actual
  startup browser test pass; browser **10 shots / 10 shells / zero errors**.
- Shared seven-weapon grip regression: maximum pad error **0.96 mm**, hip wrist
  **44.2°**, ADS **73.6°**. Magazine wrist attachment, drops, ammunition and
  interruptions retain existing coverage.
- Source: 1,373 charging poses (3.000 mm stock / 7.231 mm rear-sight minima),
  30 distinct mechanism states, new pad-plane/through-window/guard-ear support
  and trigger/guard stroke / magazine-floorplate attachment checks. Indexed GLB probes reproduce before failure:
  **4 → 0** receiver-wall hits through the opening; **27.225 → 0.000 mm** pad
  rake across test heights; old magazine >180 mm fails the new side envelope.
  Pad GLB probes fall BETWEEN traction ribs, not on their raised crowns.
- **1,157 animation channels byte-unchanged; 91 updated right-hand channels.**
  Changes are confined to `hand_R` / `R_*` fitting. All sampler times and
  interpolation, weapon/left-hand curves, eight clip durations/events, socket
  transforms and three embedded map buffers are unchanged from `9d6b962`.
  Weapon definitions, ballistics, recoil, modes and ADS settings are unchanged.
- Export: **105,587 triangle instances / 28 primitives / 11 materials / three
  1024² maps / 7,637,724 bytes**. All approved caps retained; both magazines and
  cartridge groups count. No runtime dependency or global lighting changes.

## Reproduce

The current render tool defaults to **Eevee**, even for older Cycles `.blend`
files. This checkpoint's published boards/metrics used Cycles and remain
historical. Rerender **both** before and after with the same engine/settings for
new comparisons; AA/lighting differences mean historical numbers need not match.

Download only the three review originals in `side-review.json` to an ignored
folder with the recorded filenames. Use a separate pre-change `.blend` copy.
Offline board tooling needs Pillow/NumPy; normal build/boot needs neither them
nor Blender.

```sh
blender -b /path/to/before.blend --python-exit-code 1 \
  --python tools/blender/m4_photo_review.py -- --out .tmp-rend/m4-side/before \
  --registration assets/weapons/m4a1-block-ii/side-review.json
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_photo_review.py \
  -- --out .tmp-rend/m4-side/after \
  --registration assets/weapons/m4a1-block-ii/side-review.json
python3 tools/m4-photo-diff.py --photos /path/to/review-originals \
  --before .tmp-rend/m4-side/before --after .tmp-rend/m4-side/after \
  --out .tmp-rend/m4-side/boards \
  --registration assets/weapons/m4a1-block-ii/side-review.json
```

Residual outline and finish differences are visible in the boards. The side
corrections improve the flagged regions; they do not close other reference,
mechanical midframe/hand-contact or independent visual acceptance work.
