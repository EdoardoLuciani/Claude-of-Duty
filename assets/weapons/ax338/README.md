# Early Accuracy International AX338

**Integrated review candidate; human visual/reference sign-off is pending.**
Original Blender-authored game art, not a scan, certified replica or manufacturer
CAD. This replaces the procedural shop sniper without changing combat balance.
Passing tests is not a claim of AAA quality or pixel-identical reproduction.

## Locked configuration and reference authority

Early **AX338/v02/12.10** brochure configuration: .338 Lapua Magnum, 27-inch
barrel, early solid upper-carrier folding stock (not the later AXMC A-frame),
Dark Earth stockside/grip panels, black action/forend/barrel, factory brake,
10-round magazine, older **Schmidt & Bender PM II LP 5–25×56**, compatible
AI-style one-piece mount, no bipod, restrained wear. The stock is not deployable.
Exterior manufacturer/model text is reference-informed; there is no copied
specimen serial. Turret typography/layout is an approximation, not a calibrated
scope or a commercial branding permission/endorsement.

Primary authority is the [early AX338 brochure](https://www.eurooptic.com/PDF/ax_brochure.pdf),
with [publicly available brochure text](https://www.scribd.com/document/207864701/Ax338-Brochure)
and its [public composite preview](https://imgv2-2-f.scribdassets.com/img/document/207864701/original/794e70b387/1?v=1).
The preview and specification text were inspected. Direct EuroOptic/Scopelist
PDF retrieval returned **429**, so the full-resolution original drawing/photo
pages were **not** inspected. The composite is only **768 × 1024**; its gun
profile is approximately 657 pixels long. Enlargement cannot recover detail.
This limitation is substantial, especially for stock relief, brake contour,
receiver transitions and fine hardware—not something the tests certify away.

The [Dutch-service photograph](https://commons.wikimedia.org/wiki/File:Accuracy_International_AX338_-_Dutch_Army.jpg)
is supplemental only: its loadout/production details do not override the early
brochure. It is attributed to Dutch Ministry of Defence / Jasper Verolme under
the Commons page's CC BY-SA 4.0 license; it is not shipped as a texture or asset.

Optic references: [older PM II LP listing](https://www.schmidtundbender.de/en/5-25x56-PM-II-LP-P4FL-1cm-ccw-DT-ST),
[2018–19 catalog](https://blog.scopelist.com/wp-content/uploads/2018/09/Schmidt-Bender-Catalog-EN-2018-2019.pdf),
and [AI mount listings](https://www.opticauthority.com/accuracy-international-accessories-scope-mounts.aspx).
Search-indexed older catalog specifications report **417 mm / 34 mm**; direct
catalog download returned **403**, so these are provisional catalog-listed
anchors, not inspected dimension-drawing proof. Do not substitute the revised
420 mm PM II. AI accessories literature points to a compatible 34 mm one-piece
mount (5656); exact mount relief, height and inclination have not been verified
or reproduced as certified 5656 geometry. Mount/cap/turret depth and hidden
contours remain inferred. No factory loadout claim is made for the assembled
optic/mount. Original reference images remain disposable review inputs, never
committed or shipped.

### Measurement ledger

| Datum | Authoring value | Evidence / confidence |
| --- | ---: | --- |
| Barrel length | 685.800 mm | Brochure says 27 in / 686 mm; exact inch conversion used, millimetre listing treated as rounded. |
| Overall exterior length | 1250 mm | Brochure specification; brake inclusion/stock adjustment datum is assumed, not independently calibrated. |
| Forend length | 406 mm | Brochure offers 406 / 330 mm; long depicted configuration selected, endpoint placement inferred. |
| PM II housing length | 417 mm | Provisional older-catalog anchor; full dimension drawing not retrieved. |
| Main optic tube diameter | 34 mm | Older-catalog/mount listings; provisional until primary drawing review. |
| Action/stock/grip/magazine/brake depths | Inferred | Preview silhouette plus plausible component scale, not published manufacturing dimensions. |
| Bolt lift / rear travel | 60° / 100 mm | Visual animation datums; travel is inferred, not verified mechanism engineering. |

`ax338_check.py` measures saved component vertices for the barrel, whole gun
and scope housing. It does **not** independently validate unpublished real-world
datums. Only visible exterior mechanisms are represented.

## Source and runtime contract

- `ax338.blend`: separate editable component meshes, packed original maps,
  mechanism controls, native NLA actions, shared preview arm skins and studio.
- `ax338.glb`: committed self-contained weapon, sockets, ammunition visibility
  controls and nine native clips. Review arms are excluded; no baked duplicate
  casing. Static geometry is consolidated only **after** saving editable source.
- `manifest.json`: clip durations/events, dimensions and export statistics.
- `hand-reference.json`: offline fitting inputs and runtime neutral hand poses.
- `photo-review.json`: frozen camera/ROI/exclusion data and reference fingerprint;
  no photograph.

`src/weapons/ax338.js` samples Blender mechanism/wrist/finger tracks. Shared
runtime skins/upper/forearm IK, ADS, locomotion sway and reactive recoil remain.
Native actions: **Idle, Fire, Last Shot, Bolt Cycle, Tactical Reload, Empty
Reload, Inspect, Draw, Holster**. The bolt stays locked on discharge; Bolt Cycle
lifts, pulls, pushes and locks it while right index/thumb contacts follow the
evaluated mechanism. The normal shot impulse is not baked a second time.

All original durations/events are retained: **1.1 s cycle, 2.8 / 3.6 s reloads,
3.6 s inspect, 0.88 s draw, 0.56 s holster**. Original damage, capacity/reserve,
ballistics, recoil, audio, scope mask/reticle, FOV and sensitivity are unchanged.
The original chamber/+1 rules and gameplay reload completion beats remain.
In particular, the existing last-round path schedules ejection at 0.05 s and
has no manual cycle; empty-reload chambering is committed at magazine insertion.
Those are preserved **gameplay simplifications**, not true firearm operation.
Empty magazines hide their visible rounds; reset/switch/death restore complete
native neutral channels without resurrecting ammunition. Runtime drops the old
magazine through the existing physics path and emits one pooled case per shot.

Export: **81,317 triangle instances / 30 primitives / 8 materials / three
1024² embedded images / 9,235,332 bytes (8.81 MiB)**. Includes spare magazine
and visible cartridges. Approved caps: strictly <150k triangles, ≤48 primitives,
≤18 materials, three 1024² maps and ≤15 MiB GLB. No new runtime dependency/pass.
Normal development/production builds need no Blender. Exporter/prefetch no
longer include sniper; even cache hits remove stale ignored procedural exports.
The old builder remains only for regression/baseline review, never game fallback.

## Rebuild and validation

From repository root, Blender 5.2.2 and installed Node dependencies:

```sh
node tools/ax338-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_check.py
npm test
npm run lint
npm run build
node tests/e2e/check-ax338-game.mjs --port=5221 --out=.tmp-rend/ax338/game
```

Regeneration overwrites manual source edits. Original geometry and PBR fields
are generated offline in Blender; no downloaded geometry/maps. Source and
runtime use the same UVs; original maps are packed/embedded, not maintained as
duplicate PNGs. Blender exports are not guaranteed byte-identical across versions.
On this machine the system OCIO 2.5 config cannot load in its linked OCIO 2.4.2
library. Set `OCIO` to a **complete compatible Blender 4.5 colormanagement folder's
config.ocio** for authoring/reviews. This is local offline tooling, not a game
color-management or dependency change. Reviews explicitly use Eevee rasterization,
ray tracing off, 48 samples, AgX. Do not compare with another backend/lighting.

```sh
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --out .tmp-rend/ax338/after
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --photos --out .tmp-rend/ax338/photo-after
# Same saved-source studio/backend and registration for the old GLB + seats.
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --photos --baseline OLD_SNIPER_GLB --out .tmp-rend/ax338/photo-before
python3 tools/ax338-photo-diff.py --photos REF_DIR \
  --before .tmp-rend/ax338/photo-before --after .tmp-rend/ax338/photo-after \
  --out .tmp-rend/ax338/diff
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --reel --clip Reload_Empty --view right --hands --out .tmp-rend/ax338/reel
# Same actual-game test sequence with review-only old-builder substitution.
node tests/e2e/check-ax338-game.mjs --port=5221 --baseline=1 \
  --out=.tmp-rend/ax338/game-before
```

## Review evidence and remaining limits

Photo registration uses one uniform scale, fixed cameras and the same final
ROI/bipod exclusion before/after. No independent X/Y fitting, elastic warp or
after-only reframing. The two endpoint anchors have zero fit residual by
construction—not independent camera calibration. Thresholds (photo RGB 235,
render alpha 127), AA, compressed preview pixels and photographic annotations
influence masks. The broad ROI includes brochure header/inset/annotation ink,
so its raw mask IoU is **not an isolated gun-silhouette fidelity score**. Regional
boards are more useful for diagnosing receiver, stock, optic and brake mismatch.
RGB delta is lighting-sensitive, not a certification. Legacy offline material
remapping approximates shader appearance; actual-game before/after captures
accompany the isolated geometry comparisons.

The saved-mesh/source checks cover dimensions, UVs, packed maps, true KeySlot
openings, native bolt lift/travel and wrist/skin synchronization. Runtime smoke
checks cover budgets, PBR, all nine actions, exact original event parity, sampled
right index/thumb bolt contact (≤3 mm), spare transforms, empty-round visibility,
interruption/reset and cleanup. The existing zeroing test now uses the actual
AX338 GLB instead of its old procedural approximation. Browser checks exercise
both reloads, the unchanged scope, manual cycling/chambering, inspect interruption,
last shot/dry fire, switching, death/reset, day/night/flashlight and exact shot/case
counts. They do **not** prove every deforming hand/sleeve triangle is collision-free.

Stock relief, grip curvature, optic/mount contour, muzzle details and surface
finish still need human scrutiny against better-resolution references. Whole-scene
lockstep `ms` is simulated time, **not a GPU benchmark**. Review screenshots,
reference overlays, native action reels and your visual approval are the final
acceptance gate; the improvement over the old approximation is not AAA sign-off.
