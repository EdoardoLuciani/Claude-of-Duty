# M590A1 — authored weapon and handling candidate

Reference-driven reconstruction of **factory Mossberg 590A1 Tactical SKU50774
(2016)**: 18.5-inch barrel, 6+1, ghost rings, fixed conventional black synthetic
stock and tri-rail forend. No invented pistol/M4 stock or SureFire furniture.
**Provisional in-game review prototype, not strict 1:1/final visual acceptance.**
Runtime now uses the reviewed native GLB through `src/weapons/m590.ts`, shared
actions/hands/materials and unchanged gameplay tuning. Only the integration hold
was relaxed for user review; geometry/contact/reference limits below remain. No combat definitions or
seven gameplay durations/events changed.

## Manufacturer dimension / reference sheet

Primary sources, accessed 2026-10-13:

- [Mossberg 2016 seven-shot release, p2 specification table](https://resources.mossberg.com/hubfs/press_releases/Mossberg-Introduces-7-Shot-Versions-of-590A1-and-590-PR-1-4-2016-FINAL.pdf).
- [Mossberg 2016 New Products catalog, p2 photo/specifications](https://resources.mossberg.com/hubfs/eBook_PDF/Mossberg-2016-NewProducts.pdf).
- [Manufacturer SKU50774 description and photograph](https://resources.mossberg.com/journal/7-shots-now-available-in-mossbergs-legendary-590-tactical-shotguns).

| Documented exterior quantity | Published value | Nominal metre target / endpoint |
|---|---|---|
| Barrel | 18.5 in | `.4699`, closed breech/bolt face to muzzle, NOT just exposed barrel |
| Overall length | 39.5 in | `1.0033`, maximum longitudinal muzzle-to-butt extent |
| Length of pull | 13⅞ in | `.352425`, trigger front face to buttpad centre |
| Stock configuration | Fixed black synthetic | One fixed position; no collapsed/extended-stock ambiguity |
| Capacity | Seven, catalog includes chamber | Six tube + one chamber, unchanged game balance |

Actual evaluated OAL is `1.003300 m` (within 1 µm of the nominal authoring target);
barrel datum separation `.469900 m`; physical trigger/butt LOP `.352425 m`.
Exposed barrel, receiver nose to muzzle, is approximately `.461288 m`. These are
nominal public dimensions converted to metres, not factory tolerances or claims
of sub-millimetre measurement of a real specimen. No functional internals or
manufacturing specification is supplied.

The genuine **RIGHT/ejection-side** photograph is catalog p2 image object11,
1795×399 pixels. OAL calibration uses stock heel x0 and muzzle x1793;
barrel centre y71. Photo is uniformly scaled and muzzle/barrel-axis aligned to
orthographic renders at 1607.143px/m. No anisotropic warp or model scale shim.
Camera/lens/distance and exact pose are unpublished; local landmarks carry at
least 2–5px selection plus unquantified perspective/occlusion uncertainty.
OAL-scaled trigger region is about **20.9 mm** forward of the model's nominal-
LOP-constrained trigger, with about 3.6mm vertical difference. Explicit approximate
photo endpoint selections are trigger `[670,181]` and butt centre `[12,275.5]`:
their estimated straight-line LOP is `371.97 mm`, versus nominal `352.425 mm`.
The front-face-to-butt-centre Euclidean model convention is an authoring assumption,
not a manufacturer datum diagram. Trigger front vs pivot/tip and unknown projection
matter; public photo/spec
consistency remains unresolved. The published dimensions win; the photo is not
stretched to fake agreement. Other local contours, width and component detail
are photo estimates, not falsely exact manufacturer dimensions.

New genuine left/rolled owner views are available from
[Adiga Armory's 2019 review](https://www.youtube.com/watch?v=g3Ln8Di3m2E)
and [companion exterior opening](https://www.youtube.com/watch?v=b5jCBszsghc).
The owner explicitly identifies50774; the review title also lists50765. These
are configuration-corroborated owner references, not factory authentication,
proof of2016 manufacture, calibrated dimensions or bare hidden cross-sections.
A flipped right image is NOT a verified left reference. Owner tape, butt cover,
sling and attached hardware are excluded. Copyrighted frames and comparison
boards remain outside Git; URLs/provenance only are committed. Independent
visual approval is required.

## Files and rebuild

- `m590.blend`: editable component meshes/modifiers, packed original maps, seven
  native NLA tracks and shared glove/sleeve review skins, plus an excluded studio.
- `m590.glb`: committed local runtime candidate; only rigid weapon meshes and
  mechanism/wrist/finger controls. No arms, spent cases, cameras or lights.
- `manifest.json`: actual export statistics, basis, sockets, mechanism, exact
  gameplay event times and contact windows.
- `hand-reference.json`: offline shared `Arm` fit; game-space wrist quaternions
  are **x,y,z,w**, finger/thumb poses are radians. `pads` are palmar distal contact
  patches (right index uses the common trigger patch); `thumb` is the common
  thumb-centre oracle and `thumbPad` is its palmar surface patch.

From the repository root, after `npm ci`:

```sh
# Hand fitting reads the committed GLB's actual stock exterior.
# If exterior geometry changed: export first, then refit and export again.
node tools/m590-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m590.py
blender -b assets/weapons/m590/m590.blend --threads 8 --python-exit-code 1 --python tools/blender/m590_check.py
node tests/smoke/smoke-shotgun-asset.mjs
# Optional DCC stills/contact frames; images must stay outside the repository:
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m590.py -- --render-dir=/home/edoardo/Documents/Claude-of-Duty-recovery/issue410-corrections/boards/author-render
```

Geometry/actions live in `tools/blender/m590.py` and `m590_actions.py`. Rebuild
source and export together after authoring changes; do not hand-patch the GLB.
The scripts reuse the M4 native basis, rigid-parent export and shared review-skin
patterns. Only evaluated export copies are merged. Planar UVs are deterministic;
original source components retain editable bevels. Exact fractional endpoints
and hull visibility keys are corrected in the exporter, including the quaternion
lost by Blender's zero-scale decomposition. Two consecutive Blender 5.2.2
rebuilds produced byte-identical GLBs. Normal game builds require no Blender.

Blender must have a compatible OCIO installation with AgX. The review host's
Blender 5.2.2 shipped an OCIO 2.5 profile with a linked 2.4 library; authoring used
an external `BLENDER_SYSTEM_DATAFILES` directory containing a compatible profile
copy and original LUT links. No fallback transform or repository config change
was used. Optional Draco/meshoptimizer bridge warnings are harmless here: this
GLB does not request either extension.

## Locked native contract

Metres, existing game attachment origin retained, but geometry/grips are revised.
Blender coordinates
are `(x,-z,y)` for game `(x,y,z)`: **+Y forward / +Z up / +X right**.
`export_yup=True` yields **−Z forward / +Y up / +X right** with no extra adapter
rotation. `M590_RIG` is identity at Idle. Direct children are `receiver`, `forend`,
`bolt`, `trigger`, `shell_insert`, all sockets and all hand controls.

| Socket | Game-space position |
|---|---|
| `SOCKET_muzzle` | `[0,.068,-.6552884763]` |
| `SOCKET_ejection` | `[.0205,.063,-.132]` |
| `SOCKET_sight` | `[0,.096,-.058]` |
| `SOCKET_loading` | `[0,.024,-.068]` |
| `SOCKET_chamber` | `[0,.068,-.1853884763]` |

Ejection direction is `[.84,.42,.28]`. The front blade tip is centered at the
same `.096 m` sightline through the real rear aperture. No optic or reticle glass.
The real 23×80mm game loading opening has belly lip `.022 m`; `.024 m` socket
lies within its opening depth. Hull acceptance is `[0,.0348,-.068]` aligned to
the tube. These hidden clearance surfaces are game presentation, not a model
of functional internals or published manufacturer machining dimensions.

Wrist/finger nodes follow `authored-hands.ts`: `hand_L/R`,
`L/R_finger_{0..3}_root`, `L/R_finger_{0..3}_{0..2}`,
`L/R_thumb_base`, `L/R_thumb_0`, `L/R_thumb_1`. Use the shared arm scales
**left .97 / right 1**. Revised right wrist `[.047,.050,.140]`, finger direction
`[.05,-.65,-.758]`, back `[1,0,0]`; revised left wrist `[-.0504,.0279,-.290]`,
finger `[.326,-.30,-.897]`, back `[-.473,-.873,.120]`. Right fingers fit the
actual exported conventional-stock exterior; left index contacts the bottom
rail and remaining pads wrap the forend. Exact quaternions/contacts are in
`hand-reference.json`; do not independently offset/re-fit wrists in the adapter.

Forend, twin action bars, bolt and planted support hand share a **provisional
89 mm +Z stroke**, replacing the arbitrary old38mm. This is photo-inferred from
exterior gap, **NOT verified factory mechanism travel**; the static gap and hull
length alone do not establish extraction fidelity. Minimum rear mesh clearance
is6mm. Owner-identified50774 exterior cycling footage is now available, but
its moving camera and lack of metric scale do not verify89mm. Bolt rest
`[0,.068,-.1613884763]`; trigger pivot `[0,.022,-.002]`, pull −.28 radians. Pump reaches full rear at `.32×duration`, holds to `.55`, closes by `.82`.
The trigger/finger pulse is part of Pump; there is no separate Fire action or
baked shot recoil. Preserve the game's reactive recoil and pooled live ejection.

| Native clip / alias | Duration | Gameplay events (seconds) |
|---|---:|---|
| `Idle` | 2, visual loop | none |
| `Pump` / `pump` | .45 | pump .144; end .44775 |
| `Reload_Tactical` / `reloadTac` | .55 | start .011; shellin .451; end .54725 |
| `Reload_Empty` / `reloadEmpty` | .95 | start .019; shellin .646; pump .836; boltrelease .8835; end .94525 |
| `Inspect` / `inspect` | 3 | end 2.985 |
| `Draw` / `draw` | .7 | end .6965 |
| `Holster` / `holster` | .45 | end .44775 |

Consume `manifest.clips` through the existing event-only Clip bridge. Manifest
values use the original fractional formulas (`.995×duration`, etc.), not rounded
video frames. Dispatch gameplay events only from existing Clip callbacks, never
from AnimationMixer listeners. Idle restores every mechanism, root and hand
channel; Holster intentionally ends lowered, and Draw ends at Idle.

Hull visibility remains tactical `[.187,.462)` and empty `[.418,.665)`.
The support hand transports the shell with a genuine four-finger wrap, releases
that wrap before entering the receiver, then pushes the rear rim from below with
the thumb. Fingers remain curled outside the receiver during insertion; after
shellin the thumb withdraws and the hand moves outboard before opening for return.
These phases are distinct contact/clearance assertions, not a continuous grip
through the receiver wall:

| Phase / manifest key | Tactical | Empty |
|---|---|---|
| Four pads + thumb wrap / `shell` | `[.187,.319]` | `[.418,.475]` |
| Release transition / `release` | `[.319,.385]` | `[.475,.551]` |
| Thumb/rim push / `thumb` | `[.385,.451]` | `[.551,.646]` |
| Whole glove/receiver clearance / `insertionClearance` | `[.319,.55]` | `[.475,.95]` |

Empty reload additionally plants the hand on the forend during `[0,.209]` and
`[.741,.95]`. The hull's local base is zero and it extends −Z for 70 mm, with an
11.05 mm rim radius. `shell` and `insertion` reference wrists/poses/contacts are in
game space relative to `shell.hullPosition`; `insertion.rimPad` is the desired
palmar contact on the rear face near its lower edge. The GLB owns both paths and
all release/return interpolation; runtime must not reconstruct either phase.

**Do not expose `shell_insert` as `parts.magazine` or `magazineBody`.** Those are
shared detachable-magazine/hide/drop paths. The shotgun adapter alone converts
its authored STEP scale to visibility. Reset samples Idle and hides the hull;
retain `reactiveFire: true`, `fxClass: 'shotgun'`, shell metadata and the common
record's legacy below-mouth `magSeat` helper if needed. No procedural part/hand
updates or second animation clock should overwrite native curves.

## Measurements and limits

Actual GLB: **93,106 triangle instances, 13 primitives, 7 materials, 3 embedded
1024² PBR maps, 8,920,320 bytes (8.51 MiB)**. No implicit fallback material.
Source:111 editable component meshes,46 animated controls and3 unanimated
physical dimensional datums, plus excluded review arms/studio. The old806mm
silhouette and445mm barrel are superseded, not stretched in a runtime adapter.
Stock comb dip/narrower wrist/flatter lower section, diagonal recessed rubber
buttpad lattice, curved guard/trigger, revised protective sight silhouettes and
chamfered tri-rail profiles are estimated from the actual reference. The metal
safety is seated on evaluated receiver/tang support. A broad lower bolt surface
and small hardware close the rounded ejection window and withdraw with the bolt;
the upper recess and real port remain open geometry. Right fingers and thumb
were refit from the actual exported stock before regenerating source/export.

The saved-source check uses rendered tessellation/BVH for real openings, aligned
irons, mesh contacts, barrel/receiver separation and hull/loading-channel sweep.
It measures approximately6 mm minimum pump rear clearance and sweeps the actual
deformed shared glove/sleeve against receiver/barrel during planted pump motion,
and against the receiver throughout release, insertion and return (193 skin
poses). Every visible hull pose is separately swept against the loading channel,
so shortened wrap windows cannot conceal interpenetration. The focused actual
GLB regression samples 1,951 poses at 240 Hz and validates all seven actions/exact
beats/native PBR/sockets/controls/visible hull transitions, actual triangle
contacts/openings, rim-thumb contact, continuous wrist/finger/thumb motion and
canonical reset. Maximum wrap/pump drift is .240mm; rim-thumb drift1.292mm;
maximum240Hz wrist step18.98mm and hand rotation step .184 radians. Source
checking now additionally locks evaluated manufacturer nominal OAL, actual
barrel/trigger/butt datums and full89mm pump/glove clearance. Contact/continuity
and full insertion/return assertion windows were not weakened.
The safety regression samples 15 underside/support rays and requires metal
material, rejecting both a controlled 6mm lift and a polymer substitution.
Additional source rays check recessed pad relief; source/export rays check broad
moving bolt presentation. Export bolt rays are root-local, independent of handling tilt.
The bounded junction finish adds five paired receiver/stock rays (absolute gap
below .2mm), twelve centre/off-centre tang/crown pairs (absolute step below .5mm),
and local lower-wrist flat-run/corner and lower/rear guard rays in both source and
export. These compare actual surfaces separately; a filler cannot satisfy the
stock mating test. In-memory source negatives restore the planar first ring,
open a 6mm gap and restore a proud tang; export negatives independently lift the
stock or tang. Each is rejected without saving any asset. Original safety,
contact, skin-clearance, timing and continuity limits remain unchanged.

## Persistent correction evidence / remaining visual limits

The power-off recovery preserved the eight-file partial diff byte-for-byte before
edits. New copyrighted references, rendering scripts, boards and validation logs
are outside Git at `/home/edoardo/Documents/Claude-of-Duty-recovery/issue410-corrections`.
The re-downloaded catalog's extracted `sources/catalog-004.png` matches the original
SHA256 `3bfbe157fe495de0e504b954619465e7c9078ecf073a86d98a1a88918bb80890`.
`boards/actual-photo-comparison.jpg` and `calibration.json` retain uniform scale,
explicit endpoint selections and the unresolved trigger/LOP disagreement.
`right-open-root-normalized-ortho.png` removes only root handling tilt to compare
the provisional 89mm travel against `right-closed-ortho.png`. These are mechanical
model views, not an authenticated factory open-action comparison.
Loading sheets hide only sleeves/right arm; explicitly named `thumb-isolated-diagnostic-*`
views additionally isolate evaluated thumb skin to expose the rim/mouth contact.
They complement, never replace, the full original glove/sleeve collision sweep.

The external `blender-data/colormanagement` override copies the host profile,
changes only its version declaration from 2.5 to 2.4, and links the original
`filmic`, `icc` and `luts` resources. Metadata keys ignored by OCIO2.4 warn in logs;
AgX loads without fallback. No repository/system config or material acceptance
substitute was introduced. The earlier `/tmp` boards/logs/override were lost;
new evidence is a fresh checkpoint, not recovery of those missing artifacts.

The last bounded contour iteration has fresh immutable evidence under
`/home/edoardo/Documents/Claude-of-Duty-recovery/issue410-junction-finish`.
It reuses the genuine photo and compatible Blender environment above; no new
reference research or material pass. The stock's first polygonal ring now mates
with the receiver's actual angled rear face, rather than filling the former
6–9mm gap. Only the tang behind the seated safety tapers into the actual crown,
including its transverse curvature; the validated button support is retained.
The lower wrist now has a deliberately creased neck-low corner and slanted flat
run; the lower/rear guard return is refined without moving the trigger. The front
ear's long square cap is locally rounded against the genuine crop, with the
central blade/sightline unchanged. At that checkpoint, side-lug transverse head/neck relief was deferred:
the right photo did not resolve that hidden cross-section sufficiently. The
new owner obliques support the bounded relief pass documented below.
`boards/actual-photo-comparison.jpg` uses the same unwarped global calibration;
enlarged junction/wrist/guard/front-ear/side-lug crops use that same registration,
not independent assembly alignment. Before/after hero, hands and an oblique
junction view expose the real geometry and the remaining limitations.

**Visual acceptance remains BLOCKED pending independent review.** The introduced
open seam and proud rear tang are technically corrected; this does not certify
the entire junction silhouette. Guard/trigger placement still disagrees with
the photo, and contour/material fidelity, rail furniture and hidden sight detail
remain unapproved. Local geometry improvement and passing numerical tests do
not establish a 1:1 replica. Nominal
OAL/barrel/LOP, all seven event schedules and original contact limits/windows
remain unchanged; 89mm travel remains explicitly provisional.

These checks do not certify runtime shared-IK reach, final game lighting, ADS
framing, death/restart/pause or fire/reload interruption behavior. Those remain
component B's integration gates, without weakening existing tolerances.

## Owner-reference bounded detail checkpoint

New evidence is preserved without overwriting earlier boards at
`/home/edoardo/Documents/Claude-of-Duty-recovery/issue410-evidence-details`.
The source frames/provenance remain in `issue410-reference-research`; the prior
application review/cameras remain in `issue410-reference-application`.
Same-camera before/after views and native owner crops are qualitative, not a
calibrated camera solve, globally warped photo or new millimetre specification.

- **Construction repair:** the chamber subtraction now tapers under both rear
  receiver shoulders without changing the exterior/seam/safety. Its side walls
  retain the old clearance through Y70mm: the visible bolt's rear edge reaches
  Z−6.5mm, unlike the shorter carrier. Eight off-centre source/export roof rays
  catch the old floor-through-hole result; ten chamber-side rays preserve the
  original visible-bolt clearance. These are model regressions, not machining
  dimensions or a functional internal design.
- **Supported topology:** owner review08:20/08:22/rolled08:25 shows a long front
  protective side surface and broad base edge. Both cheeks now have low skirts
  unioned into the pedestal, rather than floating forward edges. The blade,
  tip, sockets and sightline are unchanged; no hidden/opposite ear was removed.
  The 19mm base width, retained cheek spacing and skirt contour are inferred.
- **Supported relief:** review03:27 (03:21 sleeve context) supports side-lug
  head/neck steps. Relief is carved inward only, preserving seven lugs per side,
  original longitudinal stations, outer head silhouette and contact envelope.
  The 10mm neck height and transverse relief/chamfers are visual estimates.
  Bottom rail, sleeve position and whole stroke are unchanged.
- **Supported visible detail:** review02:30/left03:21 and companion00:36 show a
  rear-sight bed and circular toe mounting-head/recess. A shallow longitudinal
  bed and undriven circular head are now visible. The 11mm bed width, roughly
  0.8mm depth, 2.6mm head radius and 3.4mm recess radius are inferred, not screw
  or adjustment specifications. Aperture, ears and attachment/datum stay fixed.

The existing hand-reference, action authoring, seven durations/events, sockets,
nominal OAL/barrel/LOP and original contact/skin/opening/seam tolerances remain
unchanged. No refit was needed: original full source and exported contact/skin
checks still pass against the new geometry. No textures/material tuning, owner
accessories or runtime edits were used as a geometry substitute.

**Open-port strip remains deferred.** Its ownership and motion are uncertain;
no guessed moving part or original elevator-shelf change was made. The open
window and89mm provisional travel remain as before. The front shroud contour,
rail relief depth, rear hardware form and materials still need independent
visual review against better bare-specimen references. The photo-versus-nominal
LOP/trigger disagreement is unchanged and unresolved. Strict1:1, functional
engineering and runtime/integration acceptance are NOT certified by this pass.


## Provisional runtime review

The procedural shotgun builder/export is retired. Normal Vite builds load the
committed GLB without Blender. `M590Animation` consumes current manifest aliases
and hand controls in native metres/basis; no geometry scale, basis shim, contact
refit, second clock or procedural mechanism/hand transform is used. The insert
hull is never a detachable magazine. Idle resets all authored channels and its
STEP visibility on clip interruption, switch, death, restart and disposal.

Original weapon damage/spread/recoil, six tube plus one chamber, seven durations
and gameplay event beats remain unchanged. The 89 mm pump remains provisional.
The existing shotgun hip/ADS/sprint/low-ready mounts are retained; no camera pose
change hides a dimensional mismatch. Native prototype ADS places the conventional
stock wrist close to the camera: right glove/cuff prominence and wrist posture
need human review, not acceptance from offline contact checks. Shared IK reach,
lighting and gameplay evidence are reported separately from asset fidelity.

The prototype changes only weapon-owned body anchors: support shoulder Z
`-.020 → -.045 m`, firing shoulder Z `.280 → .450 m` (also used in ADS).
Shared arm lengths/scales, IK, hand anchors/orientations and weapon/ADS mounts
are unchanged. The latter is a substantial 170 mm rearward first-person shoulder
presentation offset, not anatomical or factory-fit validation. It meets the
original shared hip/ADS wrist gates (59.0°/77.1°), but the native motion fixture
leaves only about 3.58 mm firing-arm reach margin; the support margin is about
7.67 mm. Both forearm scales remain 1 in that fixture. Diagnostic obliques show
a much straighter firing arm, while gameplay ADS still has a prominent near-eye
glove/cuff. Numeric transport/reach passes do not approve this pose visually or
certify collision-free skin under unrestricted movement. Parent/user review is
required before accepting the presentation; no further tuning is implied.

Local play: `npm ci && npm run dev`, open the printed local URL on hardware
WebGPU, then buy M-590 as the secondary in the shop and use 2/Tab to equip it.
For a repeatable console review in `/?capture=1`: await readiness, run
`__ENGINE__.ctx.get('weapons').setWeaponImmediate('shotgun')`, then use ordinary
mouse fire/ADS, R reload, 1/2 switch and the pause-menu controls. This diagnostic
equip is not shop/balance acceptance. `sky.setTimeOfDay(23)` via
`__ENGINE__.ctx.get('sky')` selects night. Prototype baseline/after captures,
normal-speed gameplay reel, metrics and logs live outside Git in
`/home/edoardo/Documents/Claude-of-Duty-recovery/issue410-runtime-prototype`.
