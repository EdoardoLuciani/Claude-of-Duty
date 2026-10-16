# M4 finish separation spike — #432

## Recommendation: retain the shipping baseline

The tested **rough dielectric coat over the existing effective dark metallic
receiver** is not recommended for adoption. It produces brighter, stronger
highlights, but the matched gameplay views do not show a convincing improvement
from “plastic-looking” to black anodized aluminum. Outdoors the broad receiver
response becomes lighter and more washed out; indoors it remains almost black.
This is a visual assessment of the attached comparisons, not a perception-study
score. No shipping materials, meshes, lighting or other weapons are changed.

This result rejects **one fixed material variant**, not all material improvements.
The baseline's shared low-contrast finish maps remain a plausible contributor.
Missing first-person self-shadowing remains unchanged and cannot be credited to
this experiment. A further material pilot should use finish-specific surface
structure and better-calibrated reference lighting, not another unvalidated
metalness/roughness sweep or a global loader adjustment.

## Revisions and reproduction

- Application baseline: merged develop `a7c5f55c7844d564b2581474e4ed160ca4e09101`.
- Tested diagnostic harness: `24a26e9` (`tools/spikes/m4-finish.mjs`). Three fresh
  browser runs, each with outdoor/indoor × hip/ADS, on AMD RDNA-4 native WebGPU,
  `fallback=false`, 1280×720, high quality and complete normal prewarm.
- Durable raw evidence: `/home/edoardo/Documents/Claude-of-Duty-recovery/issue432/`:
  `protocol.md`, `run-{1,2,3}/report.json`, raw PNGs, `summary.json`,
  `map-inventory.json`, source references and labeled `comparisons/*.jpg`.
- The protocol selected the one variant before its first successful comparison;
  early failures were harness provenance/temporal-control problems, not a
  parameter sweep. The material settings were not tuned after seeing the result.

```sh
npm ci
CHROMIUM_PATH=/path/to/chrome MESA_VK_DEVICE_SELECT='1002:7550!' \
  PORT=5460 node tools/spikes/m4-finish.mjs /absolute/new-output-directory
```

Use a new output directory for each run. This tool is never imported by gameplay.
It clones only the black-anodized **receiver primitive**, registers its borrowed
maps with the normal render-owned indirect hook, and restores/disposes the clone.
The shared charging-handle finish, steel, FDE handguard, polymer, rubber, arms and
all other materials remain untouched. The material names alone are not used to
change every mesh sharing the receiver's source material.

## Authored baseline and shared maps

Authority: `tools/blender/m4a1.py`, committed
`assets/weapons/m4a1-block-ii/m4a1-block-ii.glb`; the loader preserves these inputs.
The asset is **7,641,228 bytes**, SHA256
`b7e3ab1e757726906487690aa5282fb53fad2255addc94df3d3654359b1034c7`.
Its three embedded 1024² images are shared between receiver and polymer, despite
separate glTF texture indices/samplers. Decoded image bytes match exactly.

| Input                                   | Receiver                 | Polymer furniture        |
| --------------------------------------- | ------------------------ | ------------------------ |
| Linear base factor RGB                  | .041 / .047 / .053       | .026 / .029 / .032       |
| Metalness factor                        | 1                        | 0                        |
| Roughness factor                        | .68                      | .80                      |
| Normal strength                         | .12                      | .65                      |
| Evaluated outdoor-hip roughness mean    | .63509                   | .74494                   |
| Evaluated outdoor-hip base-layer F0 RGB | .03333 / .03821 / .04309 | .04000 / .04000 / .04000 |

These are evaluated shader channels, not just scalar defaults. Geometric
roughness filtering makes pixel values differ from the texture-factor product;
edge pixels can reach roughness 1. The receiver really is metallic and the
polymer really is dielectric. The problem is not a missing metalness map.

Decoded albedo-image sRGB code values range **.851–.973**, mean **.91055**, SD
**.01701**. Do not confuse those encoded texture multipliers with final linear
pigment or F0. The non-color roughness G channel ranges **.847–.980**, mean
**.91321**, SD **.01824**. Multiplication alone therefore gives small roughness
variation: SD about **.0124 receiver / .0146 polymer**. The metalness B channel is
1 throughout; the polymer's factor correctly makes the result zero.

The common normal image is also non-color data. It combines procedural
microstructure with an authored A2 grip-checkering region; the source assigns
that atlas region explicitly. Different normal strengths do not create two
independent roughness or albedo structures. Small shared noise is not equivalent
to reference-specific machining/blasting/molding. No texture was replaced here.

## Exactly one prototype

Keep the receiver's base factor, metalness, roughness, maps, UVs and normal strength
unchanged, then add:

| Added coat parameter                  | Value                                          |
| ------------------------------------- | ---------------------------------------------- |
| Native clearcoat weight               | 1                                              |
| Coat roughness factor                 | .50                                            |
| Coat roughness map                    | Borrow existing roughness texture              |
| Coat normal map and scale             | Borrow existing normal texture and .12 scale   |
| Evaluated coat roughness, outdoor hip | Mean .47256; min .43487; geometric edge max 1  |
| Native coat F0                        | .04, fixed by Three's clearcoat lighting model |

The physical motivation is a dielectric oxide interface over an absorbing,
metal-backed finish. **This is an approximation, not a calibrated anodization
BSDF.** The current dark metallic color already approximates attenuation; it is
not the high reflectance of bare aluminum. Native clearcoat uses IOR 1.5/F0 .04
and lacks the dye/porosity/thickness model required to reproduce a specific black
hardcoat. A measured anodic-alumina sample reported n≈1.63 (F0≈.0574), but under
specific oxalic-acid conditions—not the actual Colt process. The prototype's .50
coat roughness is an explicitly chosen test value, not a measurement from a photo.
Blender's generic coat is described for lacquer/car paint; calling the parameter
“coat” does not establish that it faithfully models black anodization.

## Matched capture controls

The complete running game graph supplies the PNGs, including arms, existing
world AO/shadows, view lighting, tone mapping/LUT and world-metered exposure.
The engine does not advance between A/B/restored-A captures. Exact snapshots
check pose/object matrices, frame/time, view projection, light values, shadow
flags, exposure and render settings. A fixed temporal jitter sample is held
across the paired captures; **TAA remains enabled with unchanged settings**.
Thirty-two settling renders precede the pair. This is deterministic diagnostic
capture, not unrestricted moving gameplay.

Every pair's raw world-beauty target is **byte-identical**. Polymer isolated-HDR
pixels are **exactly unchanged**. Final display output is not claimed bit-identical
outside the receiver: temporal/post-process restoration residuals are measured,
and receiver bloom can affect nearby display pixels. Restored-A whole-frame
RGBA mean absolute difference stays **below .111 of one 8-bit code value**
(below .148 averaged over RGB alone; alpha is unchanged), with maxima ≤9 codes;
this is much smaller than the receiver's outdoor change.
The `.25 / 16` restoration gates reject larger instability.

Exposure is not retuned: approximately 4.186 outdoor hip, 4.874 outdoor ADS,
4.994 indoor hip and 4.881 indoor ADS, fixed within each pair. Camera presets
are the authored `weapon` and `interior` shots; world-camera FOV80/49.6 and
first-person-camera FOV60/51.6 for hip/ADS. Framing is identical before/after. These are two lighting situations, not all environments.

The gameplay ADS frame contains **zero visible polymer-furniture pixels**.
It tests receiver highlights and sight-picture effects, not a hidden
receiver-versus-polymer comparison. Hip fire contains ~25,252 receiver and
15,256 polymer pixels; ADS contains ~14,926 receiver pixels. No after-only crop
or pose change was used to make a material difference appear larger.

## Measured response and visual assessment

Unexposed isolated-view HDR luminance; these are linear rendering values, not
physical luminance units or percentages of perceived plasticity:

| Case        | Baseline receiver mean | Variant receiver mean | Ratio |
| ----------- | ---------------------: | --------------------: | ----: |
| Outdoor hip |                .060136 |               .110733 | 1.84× |
| Outdoor ADS |                .026648 |               .046102 | 1.73× |
| Indoor hip  |                .000708 |               .001507 | 2.13× |
| Indoor ADS  |                .001176 |               .002278 | 1.94× |

Outdoor hip's receiver p90 rises **.12216 → .25750**, p99
**.14662 → .34958**. Polymer mean remains **.097871 outdoors / .001390 indoors**.
Base-layer roughness/metalness/F0 are identical with/without the coat. The changed
response is the added dielectric lobe and its energy-conserving layer treatment,
not secretly lightened base color, altered exposure or metallic polymer.

Inspected full gameplay views and matched side-by-side images:

- **Outdoor hip:** visibly brighter and more pronounced broad highlights; not a
  convincing improvement in the black anodized character. Relative to the
  unchanged stock, brightness separation alone is not better finish separation.
- **Outdoor ADS:** visible receiver response change, but most sight hardware is
  intentionally unchanged and polymer is not visible. No evidence of improved
  metal-versus-polymer readability from this view alone.
- **Indoor hip/ADS:** the receiver remains near-black despite the roughly doubled
  HDR response. Stronger specular response does not supply the missing local
  form/occlusion cues or make the two finishes reliably identifiable.

Real receiver/product photos show dark surfaces with directional highlights,
small-scale texture and geometry-dependent contrast; the LMT stock also has real
specular reflection and texture. They are not color/roughness calibration charts:
unknown lights, exposure and processing prohibit fitting numerical PBR values
from their RGB values. The spike does not establish a single universal target
finish or quantify how much missing self-shadow contributes.

## GPU and asset cost

Three fresh browsers, each with **20 baseline +20 variant** warmed timestamp
samples per view in alternating ABBA order. Actual native timestamp frame IDs
must match the queried frame. Measurements are **isolated first-person-pass
render totals**, not complete-game GPU time, queue wait, presentation or FPS.

| Case        | Baseline pooled p50 / p95 ms | Variant pooled p50 / p95 ms | Range of per-run median deltas ms |
| ----------- | ---------------------------- | --------------------------- | --------------------------------- |
| Outdoor hip | .14888 / .15288              | .15442 / .15872             | +.00342 to +.00620                |
| Outdoor ADS | .10124 / .13172              | .10916 / .14160             | +.00796 to +.01064                |
| Indoor hip  | .11652 / .15320              | .12094 / .15804             | +.00440 to +.00620                |
| Indoor ADS  | .10042 / .13032              | .10846 / .14096             | +.00810 to +.00812                |

Clock/cache variability is visible between runs; do not extrapolate these small
absolute deltas to every GPU or claim a precise full-game performance penalty.
No cold compile/startup timing comparison was made. The coat introduces shader
layer/sample work and a distinct compiled material feature, not free shading.

Both configurations render **38 first-person draws**. Geometry/indices are
unchanged, so triangle workload is unchanged. No new texture image or geometry
buffer is introduced: the existing maps are borrowed. **Shipping asset byte
change is zero** because this is a non-shipping diagnostic clone. It adds one
in-memory experimental material; a future authored adoption would require
normal Blender/glTF export and measurement, not retaining this runtime override.

## Reference evidence and limits

1. [Colt 2024 military/law-enforcement catalog, PDF p.11](https://www.colt.com/wp-content/uploads/2024/09/24-COLT-2263-COLLATERAL-MLE_Catalog-web-FINAL.pdf):
   “Colt Carbines are offered in Type III ‘hardcoat’ Aluminum Anodizing or
   Cerakote Flat Dark Earth H-265 finish per customer requirements.” Establishes
   finish family, **not** the optical constants/roughness of this specific asset.
2. [LMT SOPMOD Black](https://lmtdefense.com/product/sopmod-buttstock-black/):
   explicitly “crafted from a durable polymer,” with rubberized buttpad.
   The actual product photograph was inspected; it is not measured reflectance.
3. [Receiver-oblique reference photograph](https://cdn11.bigcommerce.com/s-k5jq3j85wp/images/stencil/1280w/products/951/4132/IMG_3575__07134.1722545679.jpg?c=2):
   existing asset reference from `photo-review.json`; inspected directly as
   qualitative shape/finish evidence, not a calibrated or manufacturer-certified
   complete rifle photograph.
4. [Zeković et al., anodic oxide refractive index](https://hrcak.srce.hr/en/331454):
   n=1.63±.02 over 400–580nm for anodic alumina formed in .1M oxalic acid under
   the stated current/temperature. Not a measured black Colt TypeIII coating.
5. [Texas A&M black-material reflectance catalog](https://instrumentation.physics.tamu.edu/reflectance-black/):
   black-dyed **TypeII 6061** samples and separately non-dyed TypeIII samples.
   The inspected total-reflectance graph shows substrate-preparation and
   wavelength dependence. These are **not TypeIII black M4 BRDF data** and are
   not used to set a “correct” metallic/roughness slider.
6. [Blender Principled BSDF layers](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html):
   model semantics for metallic, diffuse/specular and coat layers, not an
   anodization recipe. The pinned native Three implementation independently
   fixes coat F0 to .04 in `PhysicalLightingModel.js`.

All three successful native runs have zero page/console errors and retain the
same four existing boot warnings (two TSL return-layout and zero-index/zero-vertex
warmup draws). No missing self-shadow fix, geometry edit, lighting compensation,
new dependency, asset replacement, or change to another weapon was implemented.

**Decision:** retain baseline for shipping. The diagnostic and comparison record
are the deliverables; they do not authorize the rejected variant for gameplay.
