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
The higher-resolution [service rail close-up](https://commons.wikimedia.org/wiki/File:AX338_netherlands_rail.png)
was inspected for KeySlot head/neck relief and panel ribbing. The
[service stock close-up](https://commons.wikimedia.org/wiki/File:AX338_netherlands_butstock.png)
shows a **different A-frame stock** and was rejected as authority for the locked
solid-carrier stock. Neither service photograph proves early-production dimensions.
Renewed full-brochure downloads (including alternate paths/mirrors) still returned 429.

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
| Magazine body H × L × W | 105 × 104 × 34 mm | Provisional exterior reconstruction, not verified early-AX338 manufacturer dimensions. Floorplate is 107 × 38 mm; feed-lip-to-floor envelope is 112.5 mm high. |
| Visible cartridge overall length | 93.5 mm | Standard .338 LM visual envelope; fits the 104 mm body. The [period magazine article](https://precisionrifleblog.com/2012/12/13/detachable-magazine-dimensions-max-coal/) reports 3.764 in (95.61 mm) **interior COAL**, not an exterior AX338 drawing. |
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
- `manifest.json`: clip durations/events, dimensions/export statistics and
  magazine component envelopes measured from saved meshes before consolidation.
- `hand-reference.json`: offline fitting inputs and runtime neutral hand poses.
- `grip-profile.json`: separate front/rear contour estimates on the frozen brochure
  pixel grid; independent smooth longitudinal curves, not a straight loft axis.
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

Export: **100,697 triangle instances / 30 primitives / 8 materials / three
1024² embedded images / 9,989,960 bytes (9.53 MiB)**. Includes spare magazine
and visible cartridges. Approved caps: strictly <150k triangles, ≤48 primitives,
≤18 materials, three 1024² maps and ≤15 MiB GLB. No new runtime dependency/pass.
Normal development/production builds need no Blender. Exporter/prefetch no
longer include sniper; even cache hits remove stale ignored procedural exports.
The old builder remains only for regression/baseline review, never game fallback.

## Rebuild and validation

From repository root, Blender 5.2.2 and installed Node dependencies:

```sh
npm run models  # supplies the actual shared runtime arm skin for offline fitting
# Export geometry/contact sections first, then fit hands, then bake final actions.
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
node tools/ax338-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_check.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --out .tmp-rend/ax338/contact.json
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --side right \
  --part 'Pistol grip spine' --part 'Grip stipple' --part 'Grip screw' \
  --part 'Tan trigger guard' --part 'Curved trigger' --part 'Receiver stock mount' \
  --part 'Stock hinge' --part 'Stock carrier' --part 'Hinge' \
  --part 'Steel flat-bottom action' --out .tmp-rend/ax338/right-contact.json
node tests/smoke/smoke-ax338-contact.mjs
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

## Furniture/contact correction pass

The accepted basic early-stock outline and **PM II optic remain unchanged**.
The optic's material names and position/normal/UV/index buffers are frozen by a
smoke SHA-256 regression gate. No scope overlay, zoom, sensitivity, weapon camera
placement or combat/action-event timing was changed.

- Two extension guides and an interior adjustment housing now physically bridge
  carrier/housing to butt spacer. Wheel/lock/sling details remain reconstruction,
  not certified hidden AI mechanism geometry. Independent saved-source checks
  measure the connection and magazine/cartridge envelopes.
- Pistol grip has a narrowed neck, tapered three-dimensional palm swell, rounded
  heel and conforming stipple patches, rather than an extruded wedge. Its rake,
  neck and heel were rechecked against the frozen brochure projection after the
  first revised contour proved too upright. This is still photograph-based
  reconstruction, not a manufacturing drawing.
- Magazine now contains its cartridges; the old 83 mm body could not contain the
  old 103 mm visible rounds. Depth, seating, floorplate, ribs/lips and the dropped
  magazine's visual size were corrected together. Seating was rechecked against
  the same frozen profile; the steel body has a physical open interior with
  provisional 1.2 mm walls, not cartridges projecting through a closed box.
  Exterior dimensions remain
  provisional; retailer AXMC/AXSR measurements are not treated as early-AX338 CAD.
- Forend has eight physical planes and matching inner wall, revised physical
  KeySlot openings, rear collar, panel ribs, physical inboard panel anchors and
  a connected integral rail web. Saved-source BVH checks verify actual guide and
  panel-anchor surface intersections, not just overlapping bounds.
- Support grip sits **under the moulded panels**, within actual hip/ADS arm reach.
  A more forward bare-tube pose was rejected because it stretched the runtime
  sleeve. Shared skins/IK and weapon/camera placement were retained.
- Offline fitting uses the actual shared glove's deformed vertices, triangle
  centroids and edge midpoints, not only joint-axis radii. Cached unwrap/squeeze
  samples become native Blender curves; fitted spans use linear interpolation
  so independent Bezier tangents cannot overshoot their clearance solve.
  The carried-magazine solve explicitly requires the thumb's distal skin on the
  opposing side, rather than accepting a web/base or same-side near-contact.
  Runtime contact probes include distal-weighted face centroids/edges as well as
  vertices. Both reloads retain a fixed grip through magazine travel/drop, open before
  retraction, and refit the support grip. Draw/holster keep support on the rifle.

## Curved grip, receiver/stock junction and trigger follow-up

The user rejected the still-straight grip and identified a detached stock and
elongated trigger. Those were real geometry errors, not texture problems:

- Front and rear straps now follow **independent smooth curves** traced on the
  unchanged primary-photo registration. The waist turns into a wider rounded
  heel; the lower front becomes nearly vertical. The black insert follows and
  wraps the rear strap. A concealed throat seats inside the existing housing.
  Overlapping grip volume is cut away to prevent crossed exterior neck faces.
- A load-bearing receiver/stock adapter replaces the **21 mm gap** between
  action and hinge, with bolt-shroud clearance. The integrated upper grip
  housing reaches this adapter. Actual saved-surface intersection checks now
  test **receiver → adapter → hinge**, separately from the older pad connection.
  The accepted stock outline/position and scope are not moved.
- The guard now has rounded corners and a **~31 mm-high aperture**, rather than
  the old ~61 mm opening. The exposed trigger blade is **~29 mm** long and hooks
  forward, rather than the old ~50 mm backward-bending lever. These are inferred
  exterior contours from the early brochure, not certified factory CAD.
- Saved-mesh cross-section regression checks reject a straight thin substitute:
  they measure the fuller heel, rear bow and near-vertical lower front. Additional
  ray checks enforce the shallow opening and trigger checks enforce blade length
  and forward bend. Gameplay durations and events are unchanged.

## Current holding-finger closure — visual review / remaining contact limits

The right middle, ring and little fingers now close onto the curved grip instead
of hanging open in front of it. The rifle, held wrist/orientation, approved index
and thumb, left hand and gameplay/event timings remain unchanged. The permitted
small palm adjustment was not needed. One empty-reload wrist hold prevents lateral
travel from beginning while those fingers are still wrapped; release/regrip times
are unchanged.

- Saved-source actual distal glove contact: **1.297 mm maximum gap**, across
  eight holding poses in Idle, Fire, Last Shot, both reloads, Inspect, Draw and
  Holster, against the **4 mm** contact gate. Their PIP/DIP skins have **zero
  inter-finger triangle intersections** in those poses.
- Actual-runtime hip/ADS distal glove contact: **1.297 mm maximum gap**, against
  actual lower grip triangles. These new right-hand contact checks supplement,
  not replace, the existing left-hand runtime clearance sweep.
- **Still not collision-complete:** the expanded right source sweep reports
  **115 violating skin/component samples / 474 poses / 3.256 mm maximum depth**
  versus the unchanged **1 mm** allowance. The corresponding preceding WIP
  reported 125. No newly violating clip/time/skin/component tuples appeared on
  the same sample grid, but existing index/trigger and transition failures remain.
  This is not continuous collision certification, nor proof all depths decreased.
- Lint, build, all **68 smoke tests**, source connection/skin checks, left source
  sweep, browser sequence and actual boot capture pass. The PR stays **draft**.
- Regression hashes freeze rifle positions/UVs/transforms, index/thumb controls,
  left-hand and mechanism channels; only three holding fingers and the documented
  empty-reload wrist hold are excluded from that channel fingerprint.

For a reproducible hand-only pass on the committed source (retaining the approved
meshes and UV layouts, including Blender's otherwise variable UV island packing):

```sh
node tools/ax338-hand-reference.mjs --holding-only
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py -- --hands-only
```

The close-up `grip_wrap` view can isolate the firing hand with
`--hands --hand-side right`; such images must be labelled **support hand hidden**.
Actual-game images and all-nine-action reels retain both hands.

## Previous stock-entry / lowered-hand WIP — `7dcdc1a` (historical)

Published at the user's request for visual inspection, **not a completed hand
correction or acceptance candidate**. The standalone right-contact check below
**failed for that candidate**; do not infer physical correctness from the green
smoke suite. Current results are recorded above.

- Replaced the oversized 47 mm-wide, 32 mm-diameter horizontal hinge drum with
  compact receiver/stock leaves, small vertical knuckles and pin. This hidden
  construction is still an early-brochure reconstruction, not verified factory CAD.
- Sized the central entry to the stock's 27 mm-wide spine and 23 mm-high throat.
  Tapered only the concealed carrier front: its old rectangular front hung
  21.5 mm below that throat. Saved-mesh checks verify the sized entry and actual
  receiver/leaf/spine/stockside/pin connections, not only overlapping boxes.
- Lowered the firing wrist **28 mm**, moved it **7 mm forward / 6 mm outward**,
  and changed palm/finger orientation to fit the curved grip. Thumb and finger
  fitting and staged unwrap/regrip curves are still being corrected. Shared arm
  proportions, scope geometry, rifle placement and gameplay/clip/event timings
  are unchanged.
- **Historical failure:** its right saved-source sweep reported **125 violating
  skin/component samples across 474 poses**, maximum detected depth **3.256 mm**,
  against the unchanged **1 mm allowance**. Remaining violations involve the
  trigger, guard and grip/insert surfaces, including transitions. Gates and
  coverage have not been relaxed. This sweep also checks the changed hinge,
  carrier and receiver/action surfaces; it is not a full right-side continuous
  collision certificate.
- Source geometry/connection checks, all 68 smoke tests, lint and build pass.
  The existing runtime skin test covers the **left** hand, not the unfinished
  right-hand contact correction. Review the actual-game and saved-source images
  as visual evidence, not proof that the right-hand failures are resolved.

The PR stays **draft and unmerged**. Fixed-camera comparisons use the preceding
`d48b7bd` candidate as the baseline, not the original procedural sniper.

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
accompany the isolated geometry comparisons. The correction board retains all
regional results. The preceding correction still had a straight raked grip:
its broad grip/guard overlap was 0.594. The curved-grip/compact-guard correction
is 0.813 on the identical grid. This annotation-contaminated diagnostic is not
an isolated grip score or a fidelity certificate; the visible residual still
needs review rather than being hidden. No
scope geometry was altered to improve its neighboring-region diagnostic.

The saved-mesh/source checks cover dimensions, UVs, packed maps, true KeySlot
openings, native bolt lift/travel and wrist/skin synchronization. Runtime smoke
checks cover budgets, PBR, all nine actions, exact original event parity, sampled
right index/thumb bolt contact (≤3 mm), spare transforms, empty-round visibility,
interruption/reset and cleanup. The existing zeroing test now uses the actual
AX338 GLB instead of its old procedural approximation. Browser checks exercise
both reloads, the unchanged scope, manual cycling/chambering, inspect interruption,
last shot/dry fire, switching, death/reset, day/night/flashlight and exact shot/case
counts.

The saved-source contact check evaluates **474 poses** (30 Hz plus event/end
boundaries) across all nine actions, using actual deformed left glove/sleeve BVHs
against physical weapon-component meshes, excluding optic, cartridges and marking
ink. Maximum detected signed nearest-surface overlap is **0.903 mm**, within the
explicit **1 mm soft-contact allowance**. Vertex/face-centroid probes on intersecting
triangles are sampled evidence, not a continuous collision certificate.

The runtime skin test exercises **761 real Viewmodel poses**, including hip/ADS
reach and six full gameplay gestures at 60 Hz. It checks actual referenced skin
vertices, triangle centroids/edges against a conservative filled forend envelope,
and every deformed triangle against geometry-derived magazine component envelopes
with the same 1 mm allowance. The maximum conservative tube depth is **0.979 mm**;
**96 carried-magazine poses** maintain opposing distal finger/thumb skin-envelope
contact (finger maximum gap **0.624 mm**, thumb maximum envelope gap **1.006 mm**). Envelope
contact is not an exact contact-patch or compression simulation. Material-merged
bounds are deliberately not used: ribs/feed lips otherwise fill empty space around
its body. This test needs a longer wall-clock allowance (~22 s locally); no physical
gates or sample coverage were reduced.

For the historical `d48b7bd` candidate, the additional right-side saved-source
check sampled **474 poses** against the changed grip, inserts/screws, guard,
trigger and receiver/stock mount: maximum detected overlap **0.590 mm**, no
>1 mm violations. **That result does not apply to the current lowered-hand WIP;
its known failures are documented above.** The firing hand is refitted
using actual skin samples around the changed housing/aperture and grip. Bolt
transitions clear laterally before turning/unfolding the hand, with unchanged
mechanism/event timings. This check is limited to those changed components;
right-hand/full-body continuous collision,
all locomotion/recoil states and manufacturer fidelity are **not** certified.

Stock relief, grip curvature, optic/mount contour, muzzle details and surface
finish still need human scrutiny against better-resolution references. Whole-scene
lockstep `ms` is simulated time, **not a GPU benchmark**. Review screenshots,
reference overlays, native action reels and your visual approval are the final
acceptance gate; the improvement over the old approximation is not AAA sign-off.
