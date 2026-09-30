# MCX reference-fidelity audit

Status: **implemented and tested; user visual sign-off remains pending**.
Baseline: `d0b1b08`, original committed Blender/GLB asset.
The initial audit below is retained as the design/evidence record; rebuilt results
and the subsequently approved budget are recorded at the end.

## Agreed target

- MCX VIRTUS .300 BLK, 9-inch barrel, factory Elite Concrete gray, lightly used.
- Factory folding/telescoping stock and short factory M-LOK handguard.
- SRD762Ti **direct-thread**, not SRD762Ti-QD or SLH-series suppressor.
- TA31F exterior and TA51 mount. Existing gameplay reticle/ballistics retained;
  this is not a recreation of the TA31F's real 5.56 BDC behavior.
- Black PMAG 30 AR 300 B GEN M3, not the translucent magazine in the base-rifle photo.
- Reference-backed logos/model/caliber markings; no copied specimen serials.
- Geometry/material changes and necessary fit corrections only. Preserve clip
  timing, gameplay balance and the existing rigid-part animation architecture.
- Published exterior dimensions within 1 mm where the measurement datum is
  reliable. Photo-inferred geometry is disclosed, not labeled measured.
- Best documented approximations for unsupported details; final visual sign-off
  belongs to the user. No claim of identical pixels under arbitrary conditions.

## Reference authority

Reference pictures are review inputs, **not** textures or meshes to ship.

1. [SIG VIRTUS operator manual](https://www.sigsauer.com/media/sigsauer/resources/OPERATORS_MANUAL_SIGMCX_VIRTUS_ENGLISH_2402117-01_REV_02_LR.pdf):
   externally visible parts, controls and stock variants.
2. [Gray 9-inch SBR, RMCX-300B-9B-TAP-SBR](https://www.midwestgunworks.com/page/mgwi/prod/rmcx-300b-9b-tap-sbr):
   base-rifle right profile and receiver/stock/grip close-ups. The photo has no
   ACOG/suppressor and a different magazine: compare those against their own references.
3. [SIG PDW handguard](https://www.sigsauer.com/mcx-virtus-handguard-assembly-pdw-length-w-mlok-blk.html):
   8-inch nominal length. [Gray part identification](https://pspcorp.ca/buy-mcx-virtus-handguard-8-pdw-ss-hgrd-mcx-pdw-mlok-8184):
   SSHGRDMCXPDWMLOKGRY. Nominal length is not yet a confirmed mesh-boundary datum.
4. [SIG SRD762Ti](https://www.sigsauer.com/srd762ti.html):
   236 mm overall, 44 mm diameter (rounded metric manufacturer values).
   [Exterior photo](https://www.topgunsupply.com/images/D/SRD762TI.jpg) from
   [matching retailer listing](https://www.topgunsupply.com/sig-sauer-srd762ti-suppressor-7.62mm.html).
   Retailer imagery is corroborating, not a dimensional drawing; resolve differences
   between model-year examples rather than mixing variants. One other retailer's
   SRD762Ti listing linked an SLH762TIC-QD image and was rejected as visual authority.
5. [Trijicon TA31F](https://www.trijicon.com/products/details/ta31f):
   151.89 x 50.8 x 58.42 mm published dimensions, 32 mm objective;
   manufacturer left/right/top/oblique photographs and TA51 mount identification.
   Verify which protrusions/mount parts the width/height specification includes
   before asserting exact full-assembly width/height compliance.
6. [Magpul MAG800](https://magpul.com/pmag-30-ar-300-b-gen-m3.html):
   exterior photos, smooth upper side region, distinct rib/panel pattern,
   dot matrix and floorplate. Published maximum length 7.5 inches; this is not
   necessarily the magazine's unrotated vertical bounding-box height.

## Measured baseline

Measurements use evaluated editable-source geometry at Idle frame 0, in metres,
not perspective screenshots. Evaluated source totals match the GLB triangle count.

| Item | Baseline | Reference / interpretation |
| --- | --- | --- |
| Suppressor main tube | 160 mm long, 43 mm diameter | Not the full accessory; do not compare 160 directly with 236 mm overall |
| Suppressor including mount/endcap | 194 mm overall, 44 mm maximum diameter | Target 236 mm overall, 44 mm diameter; length needs about +42 mm |
| ACOG-prefixed components | about 183.6 mm overall length | TA31F published length 151.89 mm; excessive length and wrong body profile |
| Handguard shell | 183 mm longitudinal extent | Factory short guard is nominally 8 inches / 203.2 mm; establish mounting-overlap datum before interpreting the 20.2 mm difference |
| Magazine shell | about 176.35 mm vertical extent | Not directly comparable with 190.5 mm maximum length; curved/angled component |
| Export triangles | 93,606 | Includes both authored magazines and showcase casing, not all simultaneously visible |
| GLB mesh primitives | 37 | Asset submissions, not whole-frame draw calls |
| Unique materials / mesh objects | 12 / 10 | Manifest's 40 material slots is not the GLB's primitive count |
| GLB file | 7,840,424 bytes (about 7.48 MiB) | Baseline file size |
| Texture images | three 1024 x 1024 | Albedo variation, roughness variation, micro-normal |

## Mismatches and corrections

| Priority | Component | Evidence and proposed correction |
| --- | --- | --- |
| High | Stock | Current open two-strut skeleton and wedge cheek piece do not match the factory stock in the SBR/close-up photos. Replace with the telescoping spine, molded butt body, pad, correct latch and folding-knuckle exterior; retain the stock pivot/clip contract. |
| High | Receiver and grip | Flat polygon extrusions, simplified shoulders, magwell/guard contours and invented grip chevrons do not match the reference forging and molded grip. Rework profiles, reliefs, control placement and grip panels, including the opposite side. |
| High | Handguard | Repeated four-slot/octagonal approximation misses the reference's front openings, rear transition and lower diagonal vents. Rebuild the exterior/slot layout; do not borrow SPEAR-LT or legacy MCX shapes. |
| High | Suppressor | Fluted tube, generic locking rings, end bands and invented text are not the chosen direct-thread accessory. Correct overall length, exterior profile, rear wrench-flat silhouette and reference-backed surface seams; no functional internal modeling. |
| High | Optic | Overlong generic lathed shell, symmetric top profile and short unprotected collector differ from TA31F multi-view photos. Correct asymmetric forged housing, hood/ocular, collector casing, cap/lug shapes and TA51 shoe/clamps. Preserve gameplay scope rendering; move sight socket if necessary. |
| High | Magazine | Current lattice-like ribs cover the upper side and do not match MAG800's smoother upper region and lower panel/rib pattern. Correct both identical animation magazines, floorplate, shoulder and visual markings. |
| Medium | Finish | Receiver/handguard share graphite alloy with black accessories. Give the base rifle the chosen gray finish while keeping accessories black; verify runtime calibration, not just Blender colors. |
| Medium | Markings | Remove `VISUAL ASSET / 00300`, `PRISM OPTIC` and generic suppressor label. Use reference-backed locations/content; no specimen serial number. Fine markings may use authored atlas detail rather than excessive geometry. |
| Medium | Integration/tests | Adapter hard-codes grip targets, handguard extents, mag seat and reload-hand points. Recheck all changed contact surfaces, lens/socket alignment, muzzle FX origin and magazine fit. Existing tests prove mechanics but not likeness. |

This is a substantial visible-asset correction, not a small material tweak.
No new animation system, runtime dependency, world change or gameplay rebalance is needed.

## Budget proposal (not approved)

**Recommend no rendering-cost growth**, by redistributing existing geometry:

- At most 93,606 exported triangles and 37 GLB primitives.
- Keep the ten rigid mesh groups and existing six asset clips.
- Three 1024-square images maximum; no extra transmission/render pass.
- At most 16 unique materials, allowing distinct gray/black finishes while still
  enforcing the 37-primitive submission cap. Material count is not draw-call count.
- GLB at most 8 MiB; no new runtime dependencies.
- Target roughly 70k–90k triangles, an estimate rather than a measured rebuilt result.
- If the approved cap cannot be met, stop for approval rather than hide a compromise.

There is visible waste to reclaim: the four generic suppressor end bands cost
6,144 triangles; the existing ACOG component family costs 17,892 triangles,
including heavily tessellated short rings/ocular pieces. Replacing incorrect
geometry and reducing tessellation on small details should fund more accurate
profiles/vents. This is an estimate, not proof that every requested detail fits.

Alternative bounded headroom, only with approval: 110,000 triangles, 40 primitives,
16 materials, same three 1024-square images, GLB at most 10 MiB.

Implementation complexity estimate: substantial edits to the ~250-line visible
component-definition block plus focused material/helper changes; roughly 150–300
net new authoring/test/review lines, not a new framework. Exact churn depends on
how much inferred geometry survives the first matched-view review. If significantly
more structure is needed, check with the user rather than expand scope silently.

## Baseline checks and evidence

Passed on the unchanged asset:

- `node tests/smoke/smoke-mcx.mjs`
- `node tests/smoke/smoke-mcx-game.mjs`
- Blender `tools/blender/mcx_check.py`
- `node tests/e2e/check-mcx-game.mjs --port=5197 --out=.tmp-rend/mcx-audit/game-before`
  (no browser errors; shop, ADS, inspect, reloads, firing, casings and audio exercised).

Disposable evidence in this worktree:

- `.tmp-rend/mcx-audit/before-{right,left,top,hero}.png`
- `.tmp-rend/mcx-audit/component-metrics.json`
- `.tmp-rend/mcx-audit/references/` with original images/source URLs
- `.tmp-rend/mcx-audit/game-before/` with hip, ACOG, inspect and reload captures

**Color-management caveat (resolved for comparison captures):** local Blender
5.2.2 links OpenColorIO 2.4.2 but ships an OCIO 2.5 configuration. Initial renders
logged fallback warnings and were used only for geometry. Before/after stills
were subsequently rendered using the official Blender 4.5 OCIO configuration
and its original LUTs via `OCIO`, stored under ignored `.tmp-rend/mcx-audit/ocio/`.
Both sets use the same AgX look, exposure, camera, lighting and resolution, with
no fallback warning. No system file or runtime dependency was changed. Browser
captures do not use that Blender color configuration.

The browser harness's reported 16.6667 ms is lockstep simulated time, **not** a
measured GPU frame-time benchmark. Its whole-scene counters are not MCX-only cost.
Implementation must compare identical gameplay views on the same browser/device;
no claim of performance parity is made from those baseline numbers alone.

Before completion: preserve existing smoke contracts (update obsolete dimension
assertions with independently justified replacements, never weaken mechanics),
add exterior dimension checks, run full tests/lint/build, produce matched before/
after multi-view and gameplay captures, disclose uncertainty, and obtain user
visual sign-off. Commit/push the implementation and open a PR against `develop`
with attached evidence. This report alone is not the requested model fix.

## Implemented result

The user approved bounded headroom with **strictly fewer than 110,000 triangles**
and explicitly requested mesh optimization without compromising visible quality.
The other approved caps are 40 primitives, 16 materials, three 1024-square images
and 10 MiB GLB. The rebuilt export is below even the original triangle and file
size budgets; primitive count and texture resolution have not grown.

| Export metric | Before | Rebuilt |
| --- | ---: | ---: |
| Triangles | 93,606 | 85,590 (-8.6%) |
| GLB primitives | 37 | 37 |
| Unique materials | 12 | 13 (separate gray coating) |
| Mesh groups / clips | 10 / 6 | 10 / 6 |
| Texture images | 3 x 1024² | 3 x 1024² |
| GLB bytes | 7,840,424 | 7,580,240 (-3.3%) |

Measured evaluated-source exterior dimensions at Idle frame 0:

| Component | Rebuilt | Reference |
| --- | --- | --- |
| SRD762Ti including mount/endcap | 236.000 x 44.000 x 44.000 mm | 236 x 44 mm |
| TA31F optic/foot, excluding TA51 shoe/knobs | 151.890 x 50.800 x 58.420 mm | 151.89 x 50.8 x 58.42 mm |
| PDW guard exterior length | 203.200 mm | nominal 8 inches; overlap datum remains inferred |

Factory-style stock body/spine, receiver shoulders and grip, guard openings,
MAG800 panel layout, collector/optic housing, suppressor exterior and gray/black
surface separation were rebuilt. Generic flutes/locking bands, skeletal stock,
lattice magazine ribs and invented text were removed. Fine circular details use
less excessive tessellation; no blanket decimator or runtime quality reduction
was applied. The existing authored clips/event timings are unchanged.

The sight and muzzle sockets follow the new exterior; runtime scope aperture,
handguard radius/extents and gray-coating calibration were updated. Existing
hand-contact/reload paths were retained after browser fit review. No per-frame
allocation or new runtime dependency was introduced.

Remaining qualifications: receiver, stock, grip, magazine, guard section and
optic forging reliefs are photo-inferred, not measured scans. Molded texture,
wordmark font forms and very fine marks are approximations. No copied serials
are included. The model does not establish commercial trademark permission or
replicate real optic BDC behavior. These are disclosed limitations, not claims
of literal pixel perfection.

Checks passed after regeneration: all 53 smoke checks (`npm test`),
`npm run lint`, `npm run build`, Blender geometry/dimension/vent-rim checks and
the MCX browser integration check and `tools/capture.mjs` boot capture, following
a standard clean `npm ci`. World assets were not changed. Smoke changes
replace obsolete optic identity/socket coordinates and **tighten** export limits;
no animation, ammo, ejection, interruption, reset or PBR coverage was removed.
The independent Blender exterior checks are additional coverage.

The attached review evidence includes matched four-view before/after stills,
reference-shape comparisons and gameplay captures. Performance evidence is the
reduced exported geometry and unchanged submissions/maps, not a GPU-time claim.
At the identical browser-check frame, the whole scene reports 1,049 calls versus
1,048 before, with unchanged program/texture counts; total exported MCX primitives
remain 37. Separating the painted cover from its steel hinge changes which
material subsets are visible. This is not a measured GPU frame-time regression.
Final acceptance still requires the user's visual review.

## Follow-up: receiver/grip correction (after `0095f2f`)

The user's magazine/body/grip review exposed shortcomings in the first pass.
A read-only registered comparison preceded these corrections. The initial
implementation above is historical; the following numbers supersede its counts.

- Replace constant-depth upper/lower extrusions and separate shoulder strips
  with varying-depth cross-sections, integrated shoulders and selective rounded
  normals. Upper-forging vertical extent is now 47 mm rather than 66 mm; this
  contour is photo-inferred, not a published SIG measurement.
- Correct the upper/lower seam, lower body, magwell and trigger-guard profiles.
  Reposition the port/assist/deflector and lower controls to the reference layout.
  The open dust cover remains attached to its hinge.
- Move and reshape the grip assembly rather than simply shortening the grip.
  The approximately 120.65 mm tall grip has a narrower web, rounded palm section,
  corrected backstrap/heel and recessed stipple panels. Grip thickness remains
  34 mm; neither that dimension nor the contour is independently certified.
- Rebuild the charging exterior against SIG's
  [KIT-MCX-CHARGE-HANDLE-SM](https://www.sigsauer.com/sig-mcx-charging-handle-assy-ambi-small-latches.html)
  [product image](https://www.sigsauer.com/media/catalog/product/k/i/kit-mcx-charge-handle-sm.jpg),
  corroborated by the installed VIRTUS handle in
  [Gear Report's review](https://gear-report.com/sig-sauer-mcx-virtus-pistol-review/).
  This is the best-supported small-latch candidate, not proof of the exact SKU
  on the MGW specimen. The curved bow, hooked latches/pins and supported stem
  replace the rectangular crossbar; exterior dimensions remain inferred.
- Uniformly reduce the complete magazine by about 2.35%, relocate its seat and
  apply identical geometry to both reload magazines. Move the shooting-hand,
  trigger/thumb and reload contact points accordingly; retain their timing.

### Magazine datum and qualifications

Magpul publishes **Length, max: 7.5 in / 190.5 mm** but no measurement drawing.
We therefore adopt an explicit conservative convention: the longer side of the
**minimum-area side-view envelope**, including floorplate and feed-lip shell,
excluding visible cartridges and an unattached dust cover. An independent
convex-hull/edge measurement gives **190.502 mm**, within 0.1 mm of our 190.5 mm
construction target. World-Z extent is **189.224 mm**. Body/floorplate thickness
are approximately **24.413 / 28.319 mm** after uniform scaling and are unverified.

This fixes the known oversize under the documented convention; it **does not
certify agreement with Magpul's unpublished datum** or the full magazine's width
and thickness to the agreed 1 mm standard. Do not infer that certification from
shell-only bounds or the runtime `magSize` hand-target metadata. Both Blender and
Node checks measure the complete exterior and test the replacement magazine.

### Evidence and cost

The same guard/rail registration is retained without grip fitting or independent
X/Y scaling. The grip-region bottom gap falls from **85 to 6 image pixels**
(reference row 929, previous model 1014, corrected model 935). In the documented
receiver/grip ROI, threshold-mask disagreement falls from 27,095 to 8,618 pixels.
These are qualitative photographic diagnostics, **not millimetres or an exact
fidelity score**. Camera, lighting, relief details and remaining inferred contours
still matter. Comparison images and their caveats are attached to PR #334.

| Final export metric | First pass | Follow-up |
| --- | ---: | ---: |
| Triangles | 85,590 | 90,146 |
| Primitives / materials | 37 / 13 | 37 / 13 |
| Mesh groups / clips | 10 / 6 | 10 / 6 |
| Images | 3 x 1024² | 3 x 1024² |
| GLB bytes | 7,580,240 | 7,741,780 |

Additional cross-sections/radii use some of the approved headroom without a
blanket decimator or texture downgrade. Triangles remain **3.7% below the original
93,606**, and the GLB is **1.3% smaller than the original**. All approved caps hold.
The rail/barrel/optic and their sight/muzzle sockets are unchanged in this pass;
all six clip durations/events and gameplay balance remain unchanged.

Passed after a standard clean `npm ci`: all 53 smoke checks, lint, build,
independent Blender dimension/clearance/attachment checks, MCX browser integration
and boot capture. New checks cover complete magazine envelopes, the corrected
silhouette bands, shaped receiver/grip normals, charging bow/latch connections,
stem support throughout the rack and dust-cover support. Trigger band coordinates
were updated for the corrected geometry; pull direction, minimum travel,
attachment/clearance, timing and existing gameplay checks were not weakened.
At the same browser-check frame, submissions/programs/textures remain
1,049 / 242 / 154, unchanged from the first pass. This is not a GPU-time benchmark.

**PR remains draft pending renewed user visual sign-off.**

## Follow-up: hinge/charging-handle clearance (after `31b2051`)

The user correctly identified a missed assembly fit defect. Read-only evaluated
mesh BVH and positive-volume Boolean checks confirmed that the folding knuckle
intersected the charging bow, stock-side latch and latch pivot in Idle, during
initial pull/final return and with the stock folded. The previous attachment/
stem-support checks did not test hinge clearance; their passing result was not
proof that this joint was collision-free.

The knuckle's upper shoulder was too high. Shorten its upper end while retaining
its **-23 mm lower end**, diameter and fold pivot. The shoulder is now at +19.5 mm
and the 4 mm cap ends at +23.5 mm, below the handle's +25.5 mm lowest surface.
The spine's front end also moves forward 7 mm to seat into the offset knuckle;
a new support test exposed that the previous end floated beside it. Rear stock
length, receiver plate, handle exterior/contact targets and fold pivot are
unchanged. The original factory-stock/installed-VIRTUS photographs support the
relative layout, but these hinge coordinates are **photo-informed fit values,
not published SIG dimensions or a manufacturing tolerance claim**.

Validation is deliberately broader than the original diagnosis:

- New Blender and exported-GLB Node regressions fail on the saved `31b2051`
  asset, before applying the fix. No existing mechanical checks were removed.
- Conservative rifle-space bounding-box separation certificates include **all
  moving stock meshes and all charging-handle meshes**, plus the fixed rear
  plate. Disjoint bounds prove non-intersection even for contained meshes, which
  surface-only BVH tests can miss. Entire 198-frame reload and 120-frame fold
  clips are checked at **120 Hz**, plus the complete rack with stock fully folded:
  **696 poses** including Idle and midframes.
- Moving stock/hinge-to-handle minimum certified separation is **2.000 mm**
  (regression floor 1.9 mm, allowing float32 roundoff). The unchanged fixed rear
  plate retains its separate **0.500 mm** conservative gap (floor 0.4 mm).
- Node measures the actual exported rear-hinge geometry and verifies constant
  vertical translation, vertical-axis-only rotation and unit vertical scale for
  the stock/handle in every clip. Thus their vertical separation persists
  **between exported sampler keys**, not just at the sampled Blender poses.
- Cap seating, the unchanged lower end/pivot and spine-to-knuckle support are
  checked. An independent rerun of the original triangle-BVH diagnosis finds
  zero interference at rest, throughout its stroke samples and folded.
- All six exported animation sampler inputs/outputs are **byte-identical** to
  `31b2051`; manifest clip durations/events are identical. No animation workaround,
  gameplay rebalance, runtime allocation or dependency change was introduced.

Final export remains **90,146 triangles / 37 primitives / 13 materials / ten
mesh groups / six clips / three 1024² images**. GLB is **7,741,948 bytes** (+168
bytes versus `31b2051`, from static transform/geometry serialization). All approved
caps hold; no additional rendering submissions or geometry budget are needed.

After clean `npm ci`: all 53 smoke checks, lint, build, Blender checks, MCX browser
integration and boot capture pass. Same browser frame remains 1,049 calls /
242 programs / 154 textures; lockstep milliseconds are not a GPU benchmark.
Matched before/after rest, early pull, full rack, folded, multi-view and gameplay
screenshots are attached to PR #334. The diagnosed hinge collision is fixed;
final whole-model visual acceptance still belongs to the user.

## Follow-up: independent review and optic seating (after `96df669`)

The independent review identified one P2 assembly defect: the integral ACOG foot
floated above the TA51 shoe. Classified **must fix**, independently remeasured in
source and exported geometry: foot bottom **60.000 mm**, shoe top **56.500 mm**,
leaving **3.500 mm** of air. A second measurement found the shoe bottom at
**46.500 mm**, **0.500 mm** above the rail teeth. The original pre-PR asset had
2.000 mm foot/shoe overlap and a contacting shoe/rail interface.

Only the shoe's vertical extent/center changed: it now spans **45.900–60.100 mm**,
with **0.100 mm** seating overlap at both interfaces. This is a documented visual
fit correction, not a published TA51 height or manufacturing tolerance. The optic
body/foot envelope, lens axis, sight socket, clamps and fasteners remain fixed.
No gameplay or animation workaround is involved.

Blender now checks foot-to-shoe and shoe-to-rail surface contact in addition to
the existing housing-to-foot check. Node raycasts the actual exported triangles:
the foot's lower face, shoe support at five stations, shoe lower face and an
exposed rail tooth. Both new seating regressions fail on the saved pre-fix asset.

All six animation sampler inputs/outputs and associations, manifest clip/events,
materials, embedded maps and sockets are unchanged. Export still has **90,146
triangles / 37 primitives / 13 materials / ten mesh groups / six clips / three
1024² maps / 7,741,948 bytes**. The existing hinge margins and magazine envelope
also remain unchanged. Syntax checks, all 53 smoke checks, lint, build, Blender
geometry checks, MCX browser integration and boot capture pass. Matched side and
oblique before/after views are attached to PR #334; final visual sign-off is pending.
