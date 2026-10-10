# FN EVOLYS 7.62

Implemented review candidate; **human visual sign-off pending**. Original game
art, not scan/CAD, manufacturing geometry or a certified replica. No endorsement
or commercial trademark permission; marks/typography are approximate, no copied serial.

## Configuration/references

Current tan/black 7.62 exterior, revised six-position non-folding stock, no irons/
bipod; RM06 Type 2 RMR + RM33 low mount and reference-informed 100-round pouch.
Accessories are not a claimed factory loadout; unpublished depths/cloth are inferred.

Primary shape authority: FN's [right](https://fnherstal.com/app/uploads/STM7402-scaled.jpg)
and [left](https://fnherstal.com/app/uploads/STM7400-scaled.jpg) studio photographs,
[product page](https://fnherstal.com/en/defence/portable-weapons/fn-evolys-762/),
[2024 technical sheet](https://fnherstal.com/app/uploads/technical-data-fn-evolys-762-1.pdf)
and [stock revision](https://fnherstal.com/en/news/fn-evolys-gets-ergonomic-changes-based-on-user-suggestions/).
Accessory authority: [RM06](https://www.trijicon.com/products/details/rm06-c-700672)
and [RM33](https://www.trijicon.com/products/details/rm33), including its own
multi-angle photographs. The RM33's published **0.768 inch / 19.5072 mm**
rail-to-RMR optical-axis height is preserved; its 13.21 mm overall envelope
includes the clamps below the rail, not a tall rectangular riser.

[Hands-on mechanism/pouch photographs](https://sadefensejournal.com/visiting-fnh-u-k-and-getting-hands-on-with-the-ultralight-evolys-machine-gun/)
supplement the side-cover/pouch layout. That article's demonstrated gun is
5.56 mm; it is not dimensional authority for this 7.62 mm receiver or pouch.
Unpublished receiver depth, stock/grip relief, feed-cover/tray detail, cloth
shape and wear remain inferred. No hidden functional internals are modelled.
Reference originals are disposable review inputs, never shipped textures/assets.

Construction datums: a **406 mm** external barrel, breech face to barrel crown
(excluding the flash hider), and an approximately **948 mm** retracted exterior
length. Saved-mesh checks independently locate the barrel endpoint rings and
measure the overall mesh envelope. These are explicit modelling conventions,
not proof of agreement with unpublished manufacturer measurement datums/CAD.

## Runtime contract

`fn-evolys-762.blend/.glb`: editable source and self-contained export.
`manifest.json`: clip/events, belt pitch and counts. `hand-reference.json`: fitted
hands. `photo-review.json`: frozen cameras/regions/exclusions/fingerprints, no photos.
`src/weapons/evolys.ts` samples native tracks; shared skins/IK, ADS/sway/recoil remain.

Eight clips: Idle, Fire, Last Shot, Tactical/Empty Reload, Inspect, Draw, Holster.
Reloads open the left cover, replace pouch, insert belt and close; empty reload
also racks. Preserve 3.4/4.8 s reloads, 3.6 s inspect, .75/.5 s draw/holster,
700 rpm and existing balance/chamber/+1 semantics (not a real open-bolt simulation).
Exactly one live pooled case per shot, no exported duplicate arms/cases/bipod.

Eight cartridges/links share one skin / three primitives, 12.7 mm feed pitch.
The last round finishes its stroke, then stops. Ammo masks the tail and restores
it only at insertion; interruption/switch/reset must not resurrect spent belt.
Mirror native reload scale keys explicitly around mixer-cached constant values.
Keep physical pouch/feed openings, arc-length feed curve and enclosed tail.

Export: 74,888 triangles / 35 primitives / 10 materials / three 1024² images /
9,079,280 bytes, including spare pouch. Caps: <150k triangles, ≤48 primitives,
≤18 materials, three 1024² maps, ≤15 MiB. No new render pass/dependency.
Normal builds need no Blender; procedural LMG is not a runtime fallback.

## Rebuild and review

From repository root with Blender 5.2.2 and installed Node dependencies:

```sh
node tools/evolys-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/evolys_762.py
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys_check.py
npm test
npm run lint
npm run build
node tests/e2e/check-evolys-game.mjs --port=5213 --out=.tmp-rend/evolys/game
node tools/capture.mjs --port=5213 --shot=weapon --out=.tmp-rend/evolys/boot.png
```

Regeneration overwrites manual source edits. Source maps are packed and embedded;
loose generated PNGs and Blender backups are not maintained. Blender exports
need not be byte-identical across versions. On this machine the system OCIO 2.5
config is incompatible with its linked OCIO 2.4.2 library. Use `OCIO` pointing to
a complete compatible Blender 4.5 colour configuration for authoring/reviews;
this local workaround changes neither dependencies nor runtime colour management.

Saved-source reviews use **Eevee rasterization**, ray tracing disabled, 48 samples.
Do not mix Cycles/older settings with new comparisons. Headless GPU context and
Pillow/NumPy for offline diff tooling are needed, not new game dependencies.

```sh
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --out .tmp-rend/evolys/after
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --photos --out .tmp-rend/evolys/photo-after
# Before: use the same saved-source lighting/backend with --baseline OLD_LMG_GLB.
# Its adjacent old metadata JSON supplies the moving-part seats.
python3 tools/evolys-photo-diff.py --photos REF_DIR \
  --before .tmp-rend/evolys/photo-before --after .tmp-rend/evolys/photo-after \
  --out .tmp-rend/evolys/diff
# Targeted stock review uses the SAME frozen registration/ROI/exclusions.
python3 tools/evolys-photo-diff.py --photos REF_DIR \
  --before FIRST_CANDIDATE_PHOTOS --after CURRENT_PHOTOS \
  --out .tmp-rend/evolys/stock-diff --region stock
# Native track reels: PNG frames at 30 fps (120 fps source, step 4).
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --reel --clip Reload_Empty \
  --view left --hands --out .tmp-rend/evolys/reel-empty
# Fire reel is a twelve-shot native-track showcase, including tail exhaustion.
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --reel --clip Fire \
  --view feed_detail --out .tmp-rend/evolys/reel-fire
```

## Validation limits

Preserve stock/carrier/pad continuity, closed cheek/web seam, QD bore and physical
feed passage. Support grip and shoulder fit stay within actual arm reach.
Reload motion clears the pouch and moves the stock away from the camera/head.

Recorded clearance gates: 830 actual skinned hip/ADS/action poses, no conservative
pouch-bound intersections; min sleeve vertex gap .34 mm. Stock clears a 120 mm head
envelope (sampled min 146.14 mm). Source checks sample belt/solid intersections at
13 firing phases and tail enclosure. These are sampled/envelope tests, not all-state
collision or cloth-compression certification.

Also retain budget/PBR, barrel endpoint, open-vent, RM33 optical-axis, exact feed
pitch/ammo/insertion, hand-contact (≤3 mm), replacement-pouch, reset/interruption,
event/case and DCC skin synchronization coverage.

Photo comparisons use fixed uniform scale/cameras/ROI/exclusions, no after-only
refit. Configuration masks exclude absent bipod/irons and added accessories, not
unexplained base-gun mismatches. Reference 235/render-alpha 127 thresholds and
uncalibrated cameras limit mask interpretation; RGB depends on lighting. Legacy
offline materials approximate runtime shaders. Historical before/after metrics
live in Git; stock comparisons used the first EVOLYS candidate, not procedural LMG.
Stock/grip/typography/finish/feed details still need visual approval. Lockstep
milliseconds are simulation time, not GPU performance.
