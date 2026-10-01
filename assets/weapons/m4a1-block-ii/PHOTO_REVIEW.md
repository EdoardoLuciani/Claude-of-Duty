# M4 exterior correction / photographic diagnostics — NOT accepted fidelity

The user flagged the front sight, exposed stock cylinders, unknown geometry
behind the port and whole-rifle proportions. This checkpoint addresses concrete
construction errors and publishes seven photographic comparisons, including
unfavorable results. The PR remains draft. It is not a completed AAA replica.

## Reference findings and changes

- **Front sight mounting:** the approved Daniel Defense M4A1 RIS II **FSP**
  preserves the barrel-pinned A2 front sight/gas block inside a rail cutout.
  Moving it onto the rail would change the configuration. The previous paired
  zig-zag legs were replaced by a single cast A-frame with a real triangular
  through-window, front-rising ears and a shorter exposed post. Sight sockets,
  sight alignment and gameplay zero are unchanged. The photo's sight/rail
  placement and height still disagree with the reconstruction; do not call
  this proportional validation.
- **SOPMOD:** LMT explicitly describes two watertight storage compartments.
  They belong below/outboard of the buffer bore **inside** the sloping cheek
  shell, not as two exposed cylinders on top. The body now has that cross-
  section, recessed storage/caps, a narrow relieved structural web, repositioned
  QD sockets/lever and a supported raked buttpad. Cheek, toe and web contours
  are photograph/camera-inferred, not dimension-certified LMT CAD.
- **Behind the port:** the features are the brass deflector and forward assist.
  The old assist housing's negative rotation pointed its rear end inward,
  away from the separate button. Housing, button and traction now share the
  same outward/rearward axis, with actual attachment checks. The deflector is
  a broad tapered casting rather than a thin plate.
- **Receiver:** rounded upper shoulders and a narrow rail neck replace the
  overly broad flat roof. Seam, channels, rail/sight datums and mechanism paths
  remain fixed. Forging contours and lower/grip proportions remain unresolved.
- **RIS:** photographic vent cadence is distinct from Picatinny tooth cadence:
  19 larger openings per diagonal row, not 31 tiny ones. Broader chamfered webs
  accommodate them. Published outer envelope/internal gauge, rail teeth,
  barrel, tube, FSP installation and hand contacts remain unchanged.

## Review sources — originals are not shipped

Exact image URLs, filenames, original dimensions, landmarks, estimated cameras,
regions and exclusions are in `photo-review.json`.

- [LMT manufacturer SOPMOD description and product photo](https://lmtdefense.com/product/sopmod-buttstock-black/).
- [SPARTANAT RIS II FSP installation/photo feature](https://spartanat.com/en/photo-file-daniel-defense-ris-ii-fur-m4a1): the rail cutout accommodates the original sight.
- [Colt/FSP upper component gallery](https://charliescustomclones.com/m4a1-sopmod-block-2-fsp-upper-receiver-military-special/): side, top, rear-quarter receiver and front-quarter muzzle views. Gallery accessory covers are not the approved bare configuration.
- [Colt bare upper receiver](https://coltparts.com/colt-ar15-m4-carbine-upper-receiver-assembly/): deflector/assist/receiver profile. It has no lower or SOPMOD stock.
- [Colt M4A1 lower gallery](https://charliescustomclones.com/colt-m4a1-complete-lower-receiver/): receiver and A2 grip only; its pictured stock is NOT the selected SOPMOD.
- [A-frame close-up](https://retrorifles.com/f-marked-front-sight-base-a-frame-fsb/): casting/window topology, not proof of the particular Colt specimen.
- [SOPMOD walkaround](https://www.youtube.com/watch?v=ojGQms8rl_M): additional multi-angle shape review; frames were not treated as scale-calibrated measurements.

No verified photograph of the entire exact bare configuration was found.
Upper-only images cannot establish lower, stock or complete-rifle proportions.
Blocked Daniel Defense downloads were not treated as inspected photographs.

## Registration and pixel differences

Each view has ONE estimated rigid weak-perspective camera: three angles, one
uniform scale and two image translations. Manually identified stable landmarks
are recorded. Planar landmarks can admit a mirrored camera; fits were bounded
near the visibly photographed side. No independent X/Y stretching, per-part
registration or after-only refitting is used. The same cameras render both
saved pre-change and current source at Idle/frame 0. Shared review arms, spare
magazine and casing are excluded. Component-only views exclude unrelated rifle
parts; specified rectangular masks exclude known photographed rail covers.

Boards contain **reference / before / after / silhouette-mask delta / RGB
absolute delta ×2**. Cyan indicates reference-only pixels and red model-only
pixels. RGB differences are lighting/exposure/material sensitive, NOT a score.
The white-background mask uses minimum RGB <195; render masks use alpha >127.
Shadow/edge/label classification, photo variants, perspective and manual
landmarks limit both diagnostics. Crops are presentation only and identical
between panels; full-resolution pixels are measured before board resizing.

| Component view | Landmark RMS px | Mask disagreement before → after |
| --- | ---: | ---: |
| Upper right | 3.73 | 11,027 → 10,673 |
| Bare receiver right | 8.64 | 4,593 → 4,624 |
| Receiver rear-quarter | 31.12 | 125,023 → 125,197 |
| Muzzle front-quarter | 26.94 | 83,846 → 83,958 |
| Upper top, covers excluded | 1.80 | 6,257 → 9,831 |
| SOPMOD front-left | 13.66 | 20,523 → 20,525 |
| Lower left | 5.84 | 47,488 → 47,488 |

**These are diagnostic failures/limitations, not an acceptance pass.** The
receiver/muzzle oblique camera fits are particularly poor and must not justify
dimension changes. Stock silhouette mismatch is effectively unchanged despite
corrected construction. Enlarged vents worsen the threshold top mask. Lower/
grip and muzzle geometry were not corrected by this pass. The comparisons also
show conspicuous sight/rail disagreement and finish/lighting mismatch. Further
verified datums, better perspective registration, shape/material refinement and
independent review are needed before claiming reference fidelity.

## Reproduce offline review

Download the review-only originals from `photo-review.json` into an ignored
folder, retaining exact filenames/dimensions. Do not ship them as textures or
include them in normal builds. Before is the editable source at commit
`6fd6c09`; use a separate ignored copy, not an overwrite of the current source.

```sh
blender -b /path/to/before.blend --python-exit-code 1 \
  --python tools/blender/m4_photo_review.py -- --out .tmp-rend/m4-photo/before
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_photo_review.py \
  -- --out .tmp-rend/m4-photo/after
python3 tools/m4-photo-diff.py --photos /path/to/review-only-originals \
  --before .tmp-rend/m4-photo/before --after .tmp-rend/m4-photo/after \
  --out .tmp-rend/m4-photo/boards
```

Blender review uses source studio lighting, not calibrated photo illumination or
gameplay HDR. Offline boards require Pillow/NumPy, not new npm/runtime packages.
The render tool never saves or changes the `.blend`.

## Technical preservation

Final export: **103,971 triangle instances / 28 primitive instances / 11
materials / 12 unique meshes / three 1024² maps / 7,604,244 bytes**. All approved
caps remain satisfied. Eight clips / 1,248 channels, socket transforms, embedded
map bytes and manifest action milestones are byte-equivalent to `6fd6c09`.
Weapon definitions, runtime logic, hand trajectories and recoil were not changed.

Source checks retain 1,373 charging poses (stock minimum 3.000 mm, rear sight
7.231 mm) and 30 distinct mechanism states. New checks exercise attachment of
deflector/assist/button/stock brace/pad, actual FSB and web windows, enclosed
storage placement and all 19 lower diagonal vent centers. These are specific
geometry regressions, not complete manufacturer-CAD certification.
