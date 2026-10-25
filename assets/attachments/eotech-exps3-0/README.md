# EOTECH EXPS3-0 — Blender-authored attachment asset

Black EXPS3-0 with the transverse CR123 housing, flared protective hood,
left-side NV/brightness controls, right-side windage/elevation adjusters,
captive scalloped cap, raised quick-detach mount and separate optical windows.
**Asset-first visual-review candidate**, not a gameplay attachment or a certified
1:1 engineering model. The M4, market, economy and equipped loadout are unchanged.

## Products and authority

- [`../../../tools/blender/exps3.py`](../../../tools/blender/exps3.py) is the
  source of truth. It constructs native Blender geometry/materials from a
  factory-empty scene; no prior blend, purchased model, scan or CAD is an input.
- `exps3-0.blend` retains the **178 separately editable high-source components**
  in hidden `SOURCE_HIGH | editable bake authority`, plus the two optimized runtime
  meshes, five packed maps, seven review cameras and the unchanged studio.
  Blender 5.2 uses Zstandard compression; open normally in Blender 5.2.2.
- `exps3-0.glb` is the stock native glTF export: **11,972 triangles, two primitives,
  two PBR materials, three embedded atlases, 2,952,288 bytes**. No high-source
  geometry, studio, external asset URL, animation, arms or reticle is exported.
- `exps3-base-color.png` and `exps3-normal.png` are 2048² unique-UV atlases;
  `exps3-orm.png` is 1024² (R=1, G=roughness, B=metallic). Normal/data maps are
  Non-Color; base color is sRGB. These three maps are embedded in the GLB.
- `finish-normal.png` and `finish-roughness.png` are the original seeded 1024²
  high-source finish maps, retained in the blend but **not** the runtime GLB.
  Reference photos are not textures.
- `manifest.json` records source/product hashes, budgets, axes and datums.
  `reference-review.json` records source URLs, photo hashes, frozen cameras,
  profile measurements, repeat-build evidence and limitations.

## Atlas optimization

At the owner's request, the approved detailed model became the bake source for an
**8–12k target with one opaque atlas material plus separate optical glass**.
The result reduces triangles **44,617 → 11,972 (73.2%)**, primitives **11 → 2**,
materials **10 → 2**, and GLB size **4.31 → 2.82 MiB**. This is an asset-resource
comparison, not an FPS benchmark or a promise of two total renderer passes.

`tools/blender/exps3_bake.py` regenerates from freshly authored high/low geometry.
Small lettering, warning labels, printing, moulded legends and Torx detail transfer
to base-color/normal/ORM images using native Cycles selected-to-active baking.
No studio illumination or ambient shadow is baked. Corresponding parts are
exploded only for projection to prevent neighbouring rings/cases contaminating
one another; exact stored native positions are restored before saving/export.
UVs are uniquely unwrapped/packed, with extra density for printed panels. The
body exports native Mikk tangents with its tangent-space normal map.

The silhouette, open sight corridor, recesses, major screw bosses, cap/mouth and
wire remain geometric. A small rear emblem stays geometric where flattening it
lost too much of the shallow-relief presentation. **Both optical panes retain the
original geometry and split normals**, joined into one glass primitive. The body
is opaque; it is not forced through transmission to achieve a single material.

**Texture-memory trade-off:** the three uncompressed RGBA8 atlases total about
**36 MiB before mipmaps / 48 MiB with full mips**, versus 8 / 10.7 MiB for the old
two shared 1K maps. The extra atlas resolution preserves inspection lettering;
this pass reduces geometry/material submissions and file size, not every memory
category. No GPU texture compression or performance claim is implied. Tiny baked
features have finite-resolution/edge differences rather than identical geometry.

The high-source Sol review below is historical. This new optimization was
parent-checked against the approved source under the frozen cameras and native
WebGPU; it is **not a new Sol approval**. Owner visual acceptance remains separate.

## Reference/profile review

Primary references:
[EOTECH product specifications and gallery](https://www.eotechinc.com/products/eotech-hws-exps3),
[EOTECH operator manual, OpticsPlanet mirror](https://www.opticsplanet.com/i/pdf/opplanet-eotech-exps3-manual.pdf),
and [higher-resolution product photos](https://www.militia-armory.com/product/eotech-exps3-0-holographic-weapon-sight/).

The manual/product page establish the nominal **96.5 × 58.4 × 73.7 mm** L/W/H
and the 68 MOA ring / 1 MOA dot variant. The manual's display-window section gives
**30 × 23 mm**, **3.17 mm front glass** and **4.76 mm rear laminate**. Its parallel
1.20 × 0.85 inch window listing is not an exact conversion. This art retains nominal
**30 × 23 mm physical panes**, while modelling a separately photo-estimated
**30 × 22 mm clear bezel opening**. The manual does not certify a full 30 × 23 mm
unobstructed bore. Glass thicknesses and attachment-root ownership are unchanged;
removal need not leave floating panes behind.

Side, front, rear and top comparisons use estimated orthographic cameras with
one uniform scale per photo, not independent X/Y stretching or per-part alignment.
The camera poses are frozen in the source and review JSON. Filled-silhouette IoU
is descriptive only: **left 0.93695, right 0.92221, rear 0.89862, front 0.90614,
top 0.93610**. Alpha >250 excludes faint photo shadows; enclosed holes are filled
for this external-profile statistic. It does **not** assess the optical aperture,
small details, material fidelity or certify 1:1 accuracy. The smoke test separately
casts two-way rays across the rounded clear opening, with extra lower-edge coverage.

### Optical-window correction after owner/oracle review

The original 46 mm optical centre and 42 mm-wide carrier were not well matched to
the registered window cutouts. Worse, the 37.5 mm battery roof clipped the bottom
3 mm of the former 30 × 23 mm bore claim. The old test's lowest ray was 38 mm,
so it missed that defect. The correction keeps the outside hood/envelope and all
cameras/materials fixed: optical group at **48.2 mm**, carrier **39 × 30.4 mm**,
clear opening **30 × 22 mm**, gasket **33 × 25 mm**, battery roof **36.7 mm**.
The carrier's bottom remains seated on the existing 33 mm electronics-housing roof.
Physical pane sizes, fore/aft positions and 3.17/4.76 mm thicknesses are unchanged.

Usable axial centreline height increases from about **20 to 22 mm**; it is not a
smaller window used to conceal the clipping. The lower clear opening has 0.5 mm
battery-roof clearance. An independent 0.25 mm two-way opaque-mesh ray grid found
**2,500/21,264** blocked rays in the old claimed pane, versus **0/20,304** in the
corrected declared clear opening. The committed regression samples the complete
rounded opening at 1 mm plus the lower edge at 0.25 mm, with both face directions.

Separate, unfilled window overlays now accompany external silhouettes. Reference
cutout overlap improves **front .91808 → .94504**, **rear .89916 → .97580**.
Glass-hidden renders isolate opaque geometry only; the shipped glass shader is not
made artificially transparent. Edited reference transparency and anti-aliasing
mean these are visual estimates, not certified optical dimensions. See the review
JSON for masks, bounds, angular probes and original defect evidence. No complete
eye box is claimed; for example, a −10° downward centreline ray still meets the
battery housing. Runtime reticle and ADS remain outside this asset-only PR.

### Rear/right correction after independent Sol review

The owner-requested GPT-6.1 Sol comparison identified concrete rear anatomy and
hardware differences that silhouette overlap did not measure. The revised cover
has a 26 mm screw-row spacing, a lower row at Z2 mm, rounded 9 mm lower bosses,
upper ears/shallow saddle and actual counterbores. The rear icon intersects the
cover with 0.12 mm exposed relief; the old 0.72 mm floating gap is gone. Lettering
also has shallow physical relief, rather than relying on a detached black badge.

Right-side adjustments now occupy actual hood/housing openings, with recessed
walls, convex moulded annuli, physical tool grooves and moulded legends/arrows.
The lower mount has an open shaped channel, contoured lever, oval tension-pad
inset and genuinely recessed slotted nut. A redundant zero-area skirt spike was
removed; planar sheet/casting/slot faces receive explicit native split normals
instead of the false rounded/triangular highlights from averaged corner normals.

The cap has a **23.5 mm nominal grip diameter** within its unchanged **28.2 mm
retaining mouth**, approximately the photograph's **1.2 ratio**, not an OEM
measurement. Seal and groove floor fit the smaller cap. Tether eyes, folded loops
and crimp sleeves provide visible attachment at both ends; its exact flexible bend
is not reconstructed. The complete outside envelope and optical contracts remain
unchanged—this is local anatomy work, not a uniform rescale.

Casting uses an 80 mm finish tile and .65 normal strength versus the hood/mount's
40 mm/.22, using the same two original PNGs. Native roughness factors are
hood .86 / casting 1 / mount .94 rather than replacing every scalar with the shared
map's mean. Base colors, metalness, glass settings, studio/exposure and all cameras
are preserved. This separates coarse casting from fine hood response without
trying to match an uncalibrated photograph's absolute brightness.

Regression probes cover the shipped recess/dome/groove depths, lower boss and
counterbore surfaces, seated rear relief, cap/mouth proportion, valid planar hood
normals and exported finish factors, alongside the unchanged optical checks.
Before/after candidates use the same cameras; the quarter reference photograph's
pose differs and is labelled. Exterior IoU is not a detail-acceptance target: its
rear/front/top values declined despite corrected local anatomy, and the current
measurements are reported rather than hidden. Three independent Sol review rounds
ended **acceptable with notes**, with no remaining P1 blocker established. After
that review, the parent fixed the small reported arrowhead/dial intersection by
subdividing and conforming only those heads: 11,856 dense samples per head found
zero buried points, with 0.062–0.108 mm clearance. This bounded final correction
was parent-verified, not separately Sol-reviewed. Fine moulded lettering remains
less readable than the photos, and the shallow rear mark is lighting-sensitive.
Human visual acceptance remains separate; exact typeface and spectral glazing
are still acknowledged approximations.

EOTECH's photos retain their original ownership and are not committed or embedded.
The original geometry, procedural finish and reconstructed vector markings are
not extracted photographic texture maps. EOTECH identifies the reference subject;
no endorsement is implied. Lettering uses Blender's bundled font, not an assertion
that the manufacturer's original typeface has been reproduced exactly.

## Coordinates and future M4 handoff

Native metres throughout. Blender: **+X right, +Y forward, +Z up**. Export:
**+X right, +Y up, −Z forward**; no runtime scale/axis correction is required.
All mesh parts and the following datums descend from `ATTACHMENT_exps3`:

| Node | Exported local position (metres) | Meaning |
| --- | --- | --- |
| `SOCKET_mount` | `[0, 0, 0]` | Rail-top datum, central receiver mounting region |
| `SOCKET_sight` | `[0, .0482, .0231]` | Provisional optical centre at rear external surface |
| `SOCKET_lens_rear` | `[0, .0482, .0231]` | Rear laminate external surface centre |
| `SOCKET_lens_front` | `[0, .0482, -.0181]` | Front glass external surface centre |

The optimized visual envelope is **58.400 × 73.700 × 96.470 mm** W/H/L. The cap's
former 0.14 mm raised polarity marking is now a texture, so the body width is the
manufacturer's rounded nominal width; this is not a uniform rescale. Length stays
0.03 mm under nominal. These are art dimensions, **not** installation tolerances.
The jaw/channel geometry is a visual Picatinny approximation, not manufacturing data.
Runtime meshes are `EXPS3_body` and `EXPS3_glass`; the latter contains both panes.
Use the retained lens sockets, not the retired individual-pane mesh names.

**The 48.2 mm optical centre above the current art datum is photo-derived and provisional.** The
published envelope does not certify it. Confirm mount height, rail seating,
rear-sight clearance, co-witness and sight picture against the M4 when implementing
ADS; do not silently turn this candidate datum into an approved gameplay alignment.
The 68/1 MOA reticle is metadata only. A holographic reticle must be projected in
runtime optics, not baked as a floating mesh that is visible from the front.

Hidden internals, holographic laminate/laser, exact threads and optical curvature
are not reconstructed. Glass uses a neutral AR-tinted PBR approximation rather
than spectral coating simulation. Runtime optic/reticle behavior, pricing and
weapon-specific run purchases are a subsequent PR, after human visual review.

## Rebuild and checks

Follow [the shared authoring workflow](../../../tools/blender/README.md).
From the repository root, with **Blender 5.2.2** and working AgX color management:

```sh
# Scratch first; no generated products are used as build inputs.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- \
  --output /tmp/exps3-review --render
# Regenerate committed products, without adding review PNGs to the asset folder.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py
node tests/smoke/smoke-exps3.mjs
npm test
npm run lint
npm run build
npm run format:check
```

`--quick` lowers review samples only; geometry/maps and camera registration are
unchanged. Cameras are `left`, `right`, `front`, `rear`, `top`, `hero` and
`rear-quarter`. Normal game builds use committed products and require no Blender.
The asset is intentionally not mounted or imported by production runtime code yet.

Fresh separate-process builds (one rendering all seven views, one without renders)
produce identical atlas PNGs, geometry/indices, normals, UVs, materials and sockets.
Native Mikk export differs in **one tangent component by 0.0001000166**, one native
four-decimal rounding bin (at most about 0.006°); therefore the optimized GLBs are
not claimed byte-identical. This narrowly measured render-cache difference does
not permit broader geometry/texture tolerances. The native UV lattice is fixed
before baking/export; no exporter hooks or post-export GLB/texture repairs exist.
Same-host evidence is not universal cross-platform determinism.

On the authoring host, the installed Blender OCIO 2.5 configuration was incompatible
with its OCIO 2.4.2 library. A process-local official Blender 4.4.3 configuration
with AgX and the installed `luts/`/`filmic/` was used via `OCIO`; see its URL/hash
in `reference-review.json`. Color management was not disabled, and the fixed
studio/cameras/exposure were preserved for initial/final comparisons.
