# MCX reference-fidelity audit

Status: **audit only; implementation and rendering budget await approval**.
Baseline: `d0b1b08`, unchanged committed Blender/GLB asset.

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

**Color-management caveat:** local Blender 5.2.2 links OpenColorIO 2.4.2 but ships
an OCIO 2.5 configuration; it logs a fallback warning. The audit studio renders
are usable for geometry/silhouette, not calibrated finish approval. Resolve the
local rendering environment before producing final material-comparison stills.
Browser captures do not use that Blender color configuration.

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
