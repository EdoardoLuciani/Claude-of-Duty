# MCX reference-fidelity audit

Implemented; **human visual sign-off remains pending**. Historical iterations,
comparisons and measurements are in [PR #334](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/334)
and Git history (original asset: `d0b1b08`). Regeneration: [README](README.md).

## Target and limits

Gray 9-inch VIRTUS .300 BLK; factory folding/telescoping stock and short M-LOK
guard, direct-thread SRD762Ti (not QD/SLH), TA31F/TA51 and black MAG800 magazine.
Light wear; reference-backed markings, no copied specimen serial.
Preserve six clips, events, balance and rigid-part architecture. Gameplay does
not reproduce the TA31F's 5.56 BDC. No manufacturing or trademark-permission claim.
Published exterior dimensions target ±1 mm only where the datum is reliable;
photo-inferred geometry and undocumented datums are not certified measurements.

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

## Current asset and measurements

Approved caps: **<110,000 triangles**, ≤40 primitives, ≤16 materials,
three 1024² maps, ≤10 MiB. No additional render pass/dependency.

| Metric | Current export |
|---|---:|
| Triangle instances | 90,146 |
| Primitives / materials | 37 / 13 |
| Mesh groups / clips | 10 / 6 |
| Embedded maps | 3 × 1024² |
| GLB bytes | 7,741,948 |

These counts include hidden reload parts; material slots are not draw calls.
Reduced geometry versus the original is not a GPU-time claim.

| Evaluated-source datum | Value | Qualification |
|---|---:|---|
| SRD762Ti overall / diameter | 236 / 44 mm | Published rounded metric exterior |
| TA31F optic + foot | 151.89 × 50.8 × 58.42 mm | Excludes TA51 shoe/knobs; specification inclusion remains uncertain |
| PDW handguard | 203.2 mm | Nominal 8 inches; mounting overlap inferred |
| Complete magazine envelope length | 190.502 mm | Explicit convention below, not verified Magpul datum |
| Magazine world-Z extent | 189.224 mm | Not the published length datum |
| Magazine body/floorplate thickness | 24.413 / 28.319 mm | Unverified |
| Grip height/thickness | ~120.65 / 34 mm | Photo-inferred |
| Upper-forging vertical extent | 47 mm | Photo-inferred |

Magazine length is the longer side of its minimum-area side-view envelope,
including floorplate/feed-lip shell, excluding cartridges/unattached dust cover.
The measured value is within 0.1 mm of our 190.5 mm construction target, but
Magpul supplies no datum drawing. Both reload magazines use the same geometry;
shell-only bounds or hand-target metadata do not establish full-envelope accuracy.

Receiver shoulders, grip, stock, guard openings, magazine panels, collector,
suppressor contour and grey/black separation are reference reconstructions.
Charging-handle authority: [SIG small-latch kit](https://www.sigsauer.com/sig-mcx-charging-handle-assy-ambi-small-latches.html),
[product image](https://www.sigsauer.com/media/catalog/product/k/i/kit-mcx-charge-handle-sm.jpg),
[installed VIRTUS review](https://gear-report.com/sig-sauer-mcx-virtus-pistol-review/).
The exact MGW specimen SKU is unproven. Relief/depth, finish, fonts and fine marks
remain approximations; no scan/CAD or literal pixel-perfection claim.

## Assembly regressions to preserve

- Stock hinge: lower end −23 mm, shoulder +19.5 mm, cap +23.5 mm; handle's lowest
  surface +25.5 mm. Spine front is seated into the offset knuckle. These are
  inferred fit values, not published SIG tolerances.
- All stock/handle meshes plus fixed rear plate are checked through complete reload/
  fold clips at 120 Hz and a fully folded rack: 696 sampled poses.
  Conservative separation: 2.0 mm moving stock/handle (floor 1.9), 0.5 mm rear plate
  (floor 0.4). Exported axis/translation/scale invariants extend vertical separation
  between sampler keys. Preserve cap seating and spine/knuckle support checks.
- TA51 shoe spans 45.9–60.1 mm with 0.1 mm seating overlap at foot and rail.
  This fixes the former 3.5 mm foot gap and 0.5 mm rail gap without moving the
  optic/lens/sight/clamps. Source surface checks and exported-triangle raycasts
  cover both interfaces; dimensions are fit corrections, not verified TA51 geometry.
- Keep complete-magazine bounds, charging stem support throughout racking,
  trigger movement, dust-cover attachment, open vent rims and optic dimensions.
  Static fit corrections did not alter the six native animation/event tracks.

## Review methodology

Use frozen guard/rail registration, uniform scale and matched backend/camera/
lighting/exposure. No grip-specific refit or independent X/Y warp. Photographic
mask disagreement diagnoses shape; it is not millimetre error or fidelity
certification. Historical Cycles images are not comparable to current Eevee output.
Local Blender OCIO mismatches require a complete compatible configuration/LUT set,
not a runtime color change. Lockstep milliseconds are simulation time, not GPU time.
Smoke/source/browser checks protect mechanics and budgets, not final visual acceptance.
