# FN EVOLYS 7.62

**Implemented review candidate; human visual sign-off is pending.** Original
Blender-authored game art, not a scan, manufacturer CAD, manufacturing geometry
or a certified pixel-identical replica. This replaces the procedural LMG.
The P320/M4/MCX asset and shared-hand conventions are retained.

## Configuration and references

- Current FN EVOLYS 7.62, tan/black with restrained surface variation; revised
  adjustable stock in the depicted carry configuration, folded irons, no bipod.
- Trijicon RMR Type 2 RM06, RM33 low Picatinny mount; neither accessory appears
  in the primary FN photographs. No unsupported claim of a factory loadout.
- Reference-informed 100-round soft pouch and short exposed linked starter belt.
  Published pouch capacity is known; its exterior dimensions are inferred.
- Reference-backed model/calibre/manufacturer text, approximate typography and
  FN cartouche, no copied specimen serial. Branding is not an endorsement or
  a grant of commercial trademark permission.

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

## Maintained files and runtime

- `fn-evolys-762.blend`: editable component groups, side-cover hinge, linked-belt
  skin, controls, shared preview arms, original packed maps and studio cameras.
- `fn-evolys-762.glb`: self-contained runtime weapon, sockets, one belt skin and
  eight native animation clips. No duplicate arms, cases or bipod.
- `manifest.json`: clip durations/event beats, belt pitch and export statistics.
- `hand-reference.json`: fitted wrist/finger inputs shared by authoring/runtime.
- `photo-review.json`: reference URLs, fixed uniform-scale cameras, comparison
  regions, RGB reference fingerprints and explicit accessory/pose exclusions;
  no photographs.

`src/weapons/evolys.js` samples Blender weapon/wrist/finger tracks. Shared runtime
skins/IK, ADS, locomotion sway and reactive recoil remain in charge. Native clips
are Idle, Fire, Last Shot, Tactical/Empty Reload, Inspect, Draw and Holster.
Both reloads open the **left side** cover, exchange the pouch, insert a starter
belt and close the cover; empty reload also racks the charging handle. Authored
pouch-contact wrists follow the evaluated pouch through each transfer stroke.

The eight visible cartridges/links form **one skinned mesh / three primitives**,
not one submission per bullet. Each shot advances one **12.7 mm** cartridge pitch
along the short feed curve. The final departing round completes its stroke,
then the belt stops; the last rounds visibly run out. Gameplay ammunition masks
the tail and restores it only at the reload insertion beat. Interrupted actions,
switching, partial ammunition and new-game resets cannot respawn a spent belt.
Native reload scale keys are mirrored explicitly because Three's mixer caches
constant values and cannot see runtime ammunition scale overrides.

Damage, 700 rpm, capacity/reserve, recoil, audio, FOV and action durations are
unchanged: reloads **3.4 / 4.8 s**, inspect **3.6 s**, draw **0.75 s**, holster
**0.5 s**. The existing game chamber/+1 ammunition rules are intentionally
preserved, although the pictured real gun is open-bolt; this is not a functional
fire-control simulation. Runtime continues to emit exactly one pooled live case
per shot, not a second baked review case.

Export: **75,028 triangle instances / 35 primitives / 10 materials /
three 1024² images / 9,085,752 bytes (8.67 MiB)**. Counts include the hidden spare
pouch. Approved caps: strictly <150,000 triangles, ≤48 primitives, ≤18 materials,
three 1024² maps, ≤15 MiB GLB. No additional runtime dependency/render pass.
Normal builds use committed assets without Blender; procedural exports/prefetch
no longer include LMG, and exporter cache hits remove stale ignored LMG outputs.

## Rebuild and validation

From repository root, Blender 5.2.2 and installed Node dependencies:

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
# Native track reels: PNG frames at 30 fps (120 fps source, step 4).
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --reel --clip Reload_Empty \
  --view left --hands --out .tmp-rend/evolys/reel-empty
# Fire reel is a twelve-shot native-track showcase, including tail exhaustion.
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python tools/blender/evolys_review.py -- --reel --clip Fire \
  --view feed_detail --out .tmp-rend/evolys/reel-fire
```

## Review evidence and limits

Fixed camera registration uses **one uniform scale**, no independent X/Y fit,
elastic warping or after-only reframing. Orthographic cameras are estimates,
not independently calibrated camera reconstructions. Whole-gun comparisons mask
only documented configuration differences: absent bipod/mount, added pouch/belt
and above-rail RMR/folded irons. Both before/after use the same final masks.
Reference threshold 235 and render alpha threshold 127 are diagnostic choices;
photo lighting/AA still influence the masks. RGB delta is **not a fidelity score**.
The legacy GLB's offline material tint remap is an approximation to its runtime
procedural shaders; baseline silhouette geometry/seats, not RGB parity, are the
purpose of that offline import. Original runtime preview screenshots accompany it.

| Base-gun ROI | Before IoU | After IoU | Mask mismatch pixels |
| --- | ---: | ---: | ---: |
| Right | 0.398 | 0.864 | 324,258 → 75,411 |
| Left | 0.390 | 0.827 | 332,199 → 98,418 |

Regional diagnostics deliberately expose remaining limitations: right/left
receiver IoU **0.951 / 0.940**, handguard **0.929 / 0.858**, stock **0.749 / 0.724**,
grip/guard **0.794 / 0.666**. These are not millimetre errors or certified likeness.
In particular stock, opposite-side grip contours, typography, finish and inferred
feed/pouch details still need human scrutiny, not automatic acceptance from the
improvement over the old approximation.

Checks cover budget/PBR completeness/tints, native skin and clip keys, exact
one-pitch feeding, remaining-ammo visibility, insertion beats, empty/switch/reset
states, visible replacement pouch transforms, saved-mesh barrel/endpoints and
open vents, optical-axis datum, shared DCC wrist/skin synchronization and runtime
hand pad contact (≤3 mm gate), reloads, inspection, recoil, zeroing and case/event
counts. They do **not** prove every deformed hand/weapon triangle is collision-free.
Gameplay screenshots and animation reels plus the user's visual approval remain
the final gate. No claim of AAA sign-off or identical pixels is made by these tests.
Whole-scene lockstep `ms` is simulated time, not a measured GPU benchmark.
