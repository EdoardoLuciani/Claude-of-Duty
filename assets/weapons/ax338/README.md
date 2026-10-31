# Early Accuracy International AX338

Early AX338/v02/12.10, .338 LM/27-inch barrel, solid-carrier folding-stock
exterior (not AXMC A-frame), Dark Earth panels, factory brake, ten-round magazine,
older PM II LP 5–25×56/34 mm and AI-style mount. No bipod/deployable stock.
Original game art, not CAD/scan or certified replica; **human sign-off pending**.

## Reference authority and limits

[Early brochure](https://www.eurooptic.com/PDF/ax_brochure.pdf),
[public text](https://www.scribd.com/document/207864701/Ax338-Brochure) /
[768×1024 preview](https://imgv2-2-f.scribdassets.com/img/document/207864701/original/794e70b387/1?v=1),
[older PM II](https://www.schmidtundbender.de/en/5-25x56-PM-II-LP-P4FL-1cm-ccw-DT-ST) /
[2018–19 catalog](https://blog.scopelist.com/wp-content/uploads/2018/09/Schmidt-Bender-Catalog-EN-2018-2019.pdf),
[AI mounts](https://www.opticauthority.com/accuracy-international-accessories-scope-mounts.aspx).
Brochure/catalog downloads returned 429/403: full-resolution drawings weren't
inspected. PM II 417 mm/34 mm anchors are provisional indexed specifications,
not drawing proof; don't substitute revised 420 mm optic.
[Dutch rail detail](https://commons.wikimedia.org/wiki/File:AX338_netherlands_rail.png)
is supplemental; service A-frame stock isn't authority for the locked stock.

Construction: 685.800 mm face-to-crown barrel, 1250 mm overall, 406 mm forend;
magazine body 105×104×34 mm, 112.5 mm feed-to-floor envelope. Depths, stock/brake/
mount seats and optical layout remain inferred. Bolt lift/travel 60°/100 mm are
animation datums, not mechanism certification. References aren't shipped textures.

## Source/runtime contract

Follow the [shared authoring workflow](../../../tools/blender/README.md).
Sources: `tools/blender/ax338.py`, `ax338_actions.py`, `ax338/export.py`,
`ax338/finishes.py`.

Declared read-only build inputs:

- `grip-profile.json`: traced grip contours, actually used to construct geometry.
- `photo-review.json`: fixed photo registration, including scale/center dimensions
  used by that geometry (not just review metadata).
- `hand-reference.json`: versioned fitted wrist/finger trajectories. Ordinary
  builds preserve it; no automatic hand fitting or clearance correction occurs.
- `assets/player/arms/player-arms.blend`: shared skin/bind appearance appended
  for excluded DCC review arms only, never exported in the weapon GLB.

The separate hand fitter also reads the shared runtime
`public/models/player/arms.glb` and generated manifest grip sections. Native
adapter is `src/weapons/ax338.ts`.
Nine clips, shared skins/IK/ADS/sway/recoil; no duplicate arms/live casing.
Preserve 1.1 s cycle, 2.8/3.6 s reloads and all balance/scope/FOV/event values.
Last-round ejection without manual cycle and empty-insertion chambering are
gameplay simplifications. Switching/death/reset must not restore spent ammo.
Caps: <150k triangles, ≤48 primitives, ≤18 materials, three 1024² maps, ≤15 MiB.

## Gameplay reticle

The fullscreen ADS overlay is a **P4FL-inspired game adaptation**, not a certified
replica of the manufacturer's reticle. The [P4FL FFP 5–25×56 PM II datasheet,
revision 00](https://www.guncity.com/function/file/06f5980f-11f3-4afc-a473-067104e0cea1)
was inspected for the fine center, alternating hashes and three heavy outer posts.
The game retains its wider, fixed ~20° ADS vertical FOV: major ticks indicate
**5 mrad**, minor ticks **2.5 mrad**, and heavy posts begin at **25 mrad**. These
are angular offsets, not bullet-drop distances or automatic ballistic compensation.
The reference's auxiliary rangefinder and illumination are omitted. Fine stroke
width has a 1.1-render-pixel readability floor; graduation positions use the live
world-camera FOV/zoom and remain aspect-correct. No reference image ships.

Runtime source: `src/weapons/sniper-reticle.ts` and the sniper branch of
`src/weapons/viewmodel.ts`. No GLB/Blender rebuild is needed for overlay edits.
Run `node tests/smoke/smoke-sniper-reticle.mjs` for the native
720p/1080p/ultrawide shader pixel checks. Review captures are disposable.

## Rebuild/check (root, Blender 5.2.2)

```sh
# Full source build, factory-empty scene, without reading an old weapon product:
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338.py
# Isolated full scratch products (does not change versioned calibration inputs):
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338.py -- \
  --output /tmp/ax338-authoring-review
# Optional matched studio previews only; --quick changes resolution/samples only:
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338.py -- \
  --output /tmp/ax338-authoring-review --render --quick

blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_check.py
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --side left --out /tmp/ax338-left.json
# Separate full right sweep: expected known failure, not cleared by source check.
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --side right --out /tmp/ax338-right.json
node tests/smoke/smoke-ax338.mjs
node tests/smoke/smoke-ax338-contact.mjs
```

The old `--hands-only` saved-weapon mesh/UV substitution is retired. Every build
regenerates the whole weapon from Python and the declared inputs, saves separate
editable components, then consolidates runtime meshes in memory. The original
rubber/stipple/metal smart-project atlas remains. The symmetric bevel faces of
the bolt knob are ordered by cyclic vertex keys before weighted normals and UV
projection, so unwrap tie order does not depend on allocation order. No other
surface is reprojected by a new UV scheme.

The saved preview retains fitted LINEAR contact intervals and BEZIER free motion.
Runtime export preparation samples the historical **120 Hz integer-frame lattice**,
places its held final sample at the exact clip endpoint, and authors native STEP
visibility/constant channels and LINEAR motion. The stock Blender Actions exporter
writes the final GLB; subsequent validation only reads it. No exporter hooks,
monkeypatches or post-export timestamp/interpolation repair are used.

**Intentional geometry/calibration changes only:** preserve the existing declared
export → fit → export stage. First export geometry/contact sections with the
versioned calibration; then run `npm run models` (shared actual arm skin) and
`node tools/ax338-hand-reference.mjs` to intentionally update the versioned hand
JSON; finally rebuild and run all checks. The fitter uses the committed asset
manifest path, not `--output`; scratch builds do not refit or modify inputs. Do
not run this stage automatically on material/workflow rebuilds, or treat it as a
fix for the known right-hand failure.

For reproducibility, build twice into empty external directories in fresh Blender
processes with the same Blender/exporter/NumPy/OCIO settings. Compare GLB, embedded
maps and manifest hashes; blend metadata can contain different output paths.
No cross-platform byte-identity promise follows from a same-host check.
Match registration/cameras/lights/pose/exposure/ROI/exclusions; don't hide hands
in acceptance reels or compare old Cycles frames. A compatible OCIO configuration
is required (supply process-local `OCIO` if needed, never compensate lighting or
disable color management). History:
[#358](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/358).

## Editing map

| Concern | Location |
| --- | --- |
| Seeded three 1024² maps, atlas quarters, finish factors | `ax338.py`: map generation and `material` |
| Geometry, pivots, sockets, photo-registered grip | `ax338.py`: named assembly sections and geometry helpers |
| Applied bevel/weighted normals, knob face ordering | `ax338.py`: `finish` |
| Original rubber/stipple/metal atlas partition | `ax338.py`: smart-project loop before action authoring |
| Weapon, wrist/finger poses, fitted spans and events | `ax338_actions.py`: `author_actions` (unchanged by workflow migration) |
| Runtime 120 Hz curves, endpoint/constant semantics, read-only output checks | `ax338/export.py` |
| Export-only vertex albedo and guarded scalar-finish atlas | `ax338/finishes.py` |
| Guarded entry, stage order/output paths, saved preview/studio, joins/native export | `ax338.py`: `build` / `main` |

Imports do not build or mutate Blender. Missing declared inputs fail; there is
no previous blend/GLB/map fallback. Generated preview edits are not source edits.

## First-pass opaque finish consolidation

The saved `.blend` retains the original separately editable components, finishes,
UVs and packed maps. After saving, `ax338/finishes.py` consolidates the **actual
export geometry/material slots**, not just scene groups: seven opaque finishes
share one material and one primitive per independently controlled assembly. The
coated scope lenses retain their separate transparent material/primitive, alpha
and normal scale. That first pass added no skin, hand calibration or hierarchy migration; the second-pass skin below records the historical baseline.

Original linear albedo factors move into `COLOR_0`. Albedo and normal XYZ images
and UV0 remain unchanged. Only scalar roughness/metalness move into a guarded
2×4 atlas through UV1; each finish receives a 508×252 bilinearly sampled roughness
region plus two-pixel guards in the existing 1024² budget. This deliberately
reduces fine roughness detail, not normal-map resolution or lettering geometry.
The original atlas remains editable in the source blend. No exposure, lighting,
color-space or material-factor compensation is applied by the adapter.

Measured with gltfpack 1.3, gzip level 9; triangles/submissions include the hidden
spare magazine. Decoded storage is the sum of unique decoded geometry typed
arrays, **not measured GPU allocation or a timing claim**:

| Product | Bytes | gzip bytes | Unique / instanced triangles | Primitive instances | Materials | Decoded vertex/index bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original native | 10,143,988 | 5,799,061 | 100,697 / 100,697 | 30 | 8 | 4,703,622 |
| Consolidated native | 12,615,752 | 5,986,154 | 100,697 / 100,697 | 11 | 2 | 7,275,822 |
| Runtime candidate | 4,673,060 | 3,521,587 | 97,953 / 100,633 | 11 (9 unique) | 2 | 5,383,894 |

All products have three embedded 1024² maps and nine clips; runtime maps are UASTC
KTX2. Native storage grows because vertex color and UV1 replace material factors.
A cook-only original asset measures 4,338,672 B / 3,415,527 B gzip / 3,467,958 B
decoded geometry, so consolidation trades some storage for fewer submissions.
At Idle, visible weapon-only submissions fall from 27 to 9 (including one lens
submission); these counts do not include shared arms or imply an FPS gain.

The runtime's 2,744 fewer **unique** triangles are mostly deduplication of the two
identical magazine/cartridge assemblies (2,680 triangles). There are only 64 fewer
triangle **instances**, all in the stock, which has 64 exactly zero-area triangles
in native float positions. Position quantization can additionally collapse tiny
faces: the selected decoded asset has 98 zero-area triangle instances versus 67
native; do not describe all unique-count savings as pre-existing degenerates.

No simplification is selected. Trials targeting 50% with permissive error limits
0.0005, 0.0002 and 0.00005, plus border locking, saved little beyond compression
but lost butt-pad grooves or measured over 0.4 mm sampled panel-surface detail.
The selected flags add **`['-vc', '16', '-vp', '16']`** to `GLTFPACK_FLAGS` in
`build/models.mjs`. Sixteen-bit linear colors protect the dark furniture factors;
sixteen-bit float position quantization costs 60,776 B versus 14-bit but reduces
the measured sampled surface deviation from 0.030415 to **0.007631 mm**. The
10,388 vertex probes are not a formal Hausdorff bound or full visual proof.

Reproduce the candidate without editing the shared registry:

```sh
node --input-type=module -e "import { cookModel } from './build/models.mjs'; cookModel({ input: 'assets/weapons/ax338/ax338.glb', output: 'assets/weapons/ax338/ax338.runtime.glb', flags: ['-vc', '16', '-vp', '16'] });"
node tests/smoke/smoke-ax338-finishes.mjs
node tests/smoke/smoke-ax338-runtime.mjs
AX338_RUNTIME=1 node tests/smoke/smoke-ax338.mjs
AX338_RUNTIME=1 node tests/smoke/smoke-ax338-contact.mjs
```

`loadAX338(renderer)` uses the registered runtime profile and shared decoder.
Native-WebGPU captures and forced RGBA fallback checks passed.
`makeAX338Model()` and its animation work
with either product via the decoded GLTF fixture. glTF infers duration from keys:
gltfpack folds wholly constant Idle to t=0, so the adapter restores **only** its
unchanged two-second hold from the manifest. Moving clip durations remain strict.
Sampled rotations are normalized using a retained control list before matrices
and hand contacts, restoring the unit-quaternion invariant after integer component
encoding. Native 60° bolt tolerance stays 1e-5 rad; runtime has an explicit 1e-4
rad codec bound, alongside unchanged 100 mm travel and <3 mm contact gates.

Two empty, separate-process source builds and cooks are byte-identical on this
host (Blender 5.2.2, two CPU threads, compatible process-local AgX OCIO). Their
native geometry/UV0 matches the original; one receiver normal differs from the
committed asset by 0.000100 vector units already in the **unmodified-source**
fresh baseline. No new normal discrepancy arises from consolidation.
Across 3,559 half-frame poses including endpoints, maximum native/runtime local
translation deviation is 5.162e-8 m, normalized rotation 8.088e-5 rad, scale zero;
STEP visibility/reset/Idle loop parity passes. Runtime bolt contact peaks at
0.010 mm. Actual shared skins still pass 761 poses: tube depth 0.980 mm, opposing
magazine finger/thumb gaps 0.797/1.077 mm, right holding-finger gap 1.296 mm.
Matched CPU studio views, optical/rail/lettering details and reload poses were
reviewed using a geometry-equivalent PNG cook; final native-WebGPU KTX2 captures
and timing remain integration-owned. The existing full right-hand DCC failure
below is unchanged, not waived by these passing runtime checks.

## Second-pass draw consolidation (historical d29573f8 baseline)

The d29573f8 baseline joined receiver, handguard, stock, optic, bolt and trigger
into a six-joint skin: two materials, six asset-wide primitives and four in loaded
Idle. Native/runtime triangle counts stayed 100,697 / 100,633 and textures,
mechanics, contacts and magazine ownership were preserved.

Skin attributes and 32-bit indices increased uploaded geometry from 5,383,896 to
8,272,448 B, without an established FPS gain. The current ordinary representation
below retires that skin. Its comparison retains the bounded normal rounding and
eight-triangle coplanar guard retessellation checks.

[Historical implementation, measurements and validation](https://github.com/EdoardoLuciani/Claude-of-Duty/blob/d29573f8b9426d70671ac5fb3fa4289a2de7546b/assets/weapons/ax338/README.md#second-pass-draw-consolidation-current-product).

## Ordinary-mesh representation (current product)

The full-body export skin is retired. The source still saves the same editable
components before runtime consolidation; the `.blend` and calibration inputs are
unchanged. Existing per-parent joins now export ordinary receiver, handguard,
stock, optic, bolt and trigger geometry. Only bolt/trigger have independent
mechanical motion. Lens material/geometry, magazine bodies and cartridge controls
remain independent. No new joins, detail reduction, runtime mechanism, material
policy, texture, dependency or cooker flags were added.

Removing `ax338/skin.py` eliminates six export bones and duplicated mechanical
bone Actions. The adapter no longer discovers/disposes weapon skeletons, but still
normalizes root, bolt, trigger, magazines and every authored hand control after
sampling. Bolt-cycle mechanics, native 60°/100 mm gates, STEP visibility, canonical
Idle, event timing, hand inputs and magazine/drop ownership remain unchanged.

| Product | Raw bytes | gzip-9 bytes | Unique / instanced triangles | All / Idle primitives | Attribute / index bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| d295 native | 15,626,140 | 5,970,466 | 100,697 / 100,697 | 6 / 4 | 9,101,560 / 1,157,100 |
| Ordinary native | 12,615,752 | 5,986,154 | 100,697 / 100,697 | 11 / 9 | 6,687,720 / 588,102 |
| d295 runtime | 4,673,444 | 3,513,406 | 97,953 / 100,633 | 6 / 4 | 5,724,152 / 1,156,332 |
| Ordinary runtime | 4,673,060 | 3,521,587 | 97,953 / 100,633 | 11 / 9 | 4,796,176 / 587,718 |

Counts include hidden spare geometry, exclude shared arms, and use unique decoded
attribute/index typed arrays. Native has 128,610 ordinary vertices; cooked has
120,010, including 4,013 vertices shared by the identical magazine assemblies.
There are **zero skinned weapon vertices/joints**, versus 115,997 cooked skinned
vertices/six joints in d295. Every candidate index stream is Uint16 (11 native,
9 unique cooked geometries); no large Uint32 body join remains. Decoded runtime
geometry falls 1,496,590 bytes (21.75%). Encoded raw storage is nearly unchanged
and gzip grows 8,181 bytes; this is not a file-size optimization.

The current r187 backend expanded the baseline non-normalized joint IDs on upload;
parent native AMD RDNA-4 / r187 measurements confirm uploaded geometry
**8,272,448 → 5,383,896 B** (−34.9%) and geometry-plus-logical-texture subtotal
**12,466,832 → 9,578,280 B**. Isolated loaded-Idle beauty draws rise 5 → 10
(the double-sided transparent lens adds a submission beyond primitive counts).
The separately observed 1,152 B palette storage is removed. Other renderer
resources/driver padding are excluded. Paired A/B/B/A isolated CPU/GPU timings
are not whole-game FPS evidence; no FPS improvement is claimed. Two materials
and all three embedded image payloads are unchanged: native PNGs, runtime UASTC
KTX2, each 1024² with eleven runtime mip levels; logical runtime texture payload
remains 4,194,384 bytes.

The frozen-d295 native migration comparison is preserved in
[Git history](https://github.com/EdoardoLuciani/Claude-of-Duty/blob/ec1d361fdfd4b1424bd101ebaa79bb9f370a9734/tools/ax338-representation-parity.mjs).
It used the immutable old product, not a regenerated expected candidate. All 1,215 non-retired animation tracks (including all right-hand channels)
retain byte-identical times/values and interpolation; all nine durations match.
All six per-part triangle counts and position/UV0 vertices match;
maximum position difference is 3.819e-8 m. The eight accepted coplanar guard
triangles reverse their former retessellation, preserving directed patch boundary,
position/UV0 vertex sets and area (4.28936042845e-6 → 4.28936072209e-6 m²).
No other topology differs. UV1 differs by at most 6.664e-8; finish colours and all
three native image payloads match exactly; cooked image payloads are also
byte-identical to d295. Optic normal differences peak at
1.366e-7 vector units. Removing bind-frame rounding changes 2,455 receiver,
5,776 stock and 311 bolt vertex normals by >1e-5, with respective maxima
0.000800, 0.00036015 and 0.00013913. Triangles touching those changed
normals cover 0.019758, 0.0139355 and 0.00378926 m² respectively (not removed
geometry or flipped faces). These are minor representation rounding
changes, not flipped surfaces or permission to increase normal tolerances.
Parent approved updating only the representation-dependent rifle/optic hashes;
the original 10-micrometre lattice, winding/normal/UV logic and protected clip hash
are unchanged. No geometry/contact/motion tolerance was relaxed.

`smoke-ax338.mjs` and `smoke-ax338-runtime.mjs` retain geometry fingerprints,
ordinary ownership, real drop/cartridge geometry, unit sampled quaternions,
interruptions and the original 0.05 mm native/runtime sampled-surface gate
(measured 0.007631 mm). Shared inspection tests cover independent transforms,
borrowed resources and owned material/map disposal. Native/cooked
actual shared-arm sweeps pass 761 poses; left DCC passes 474 poses at the unchanged
0.903077 mm depth. Full right-hand DCC acceptance remains the inherited failure
below; none of these checks clears it. Two fresh separate-process source
exports and cooks match byte-for-byte (native, runtime and manifest). Matched
native-GPU hero/side/optic/ADS/reload/inspect, RGBA fallback, market and production
gates passed. Fresh independent review found no issues; combined 160 tests passed.
This representation acceptance does not clear the inherited right-hand/factory gates.

## Known issues and gates

**Right-hand acceptance remains failing.** Historical review recorded 115
violating skin/component samples over 474 poses, up to 3.256 mm depth, including
index/trigger and transitions. The authoring migration's frozen baseline at
`2b0464666c874bd8c1feb6a7fb882c011fc57389`, using the explicit full right sweep
above in Blender 5.2.2 with compatible OCIO, instead measures **252 violations /
474 poses, maximum 7.041641 mm** versus the unchanged 1 mm allowance. The older
record's exact environment/options were not re-established; do not infer a
regression from those two historical summaries. The matching baseline left
sweep passes at 0.903077 mm maximum. These are measured pre-existing limitations,
not corrected or waived by this source migration. Passing default left/source or
runtime smoke checks does not clear full right-hand acceptance.
Preserve curved grip/stock connections, left skin/forend/magazine sweeps, bolt
contacts, exact events, spare transforms, visibility, interruptions and case counts.
Sampled contact envelopes aren't continuous clearance or physical compression
certification; retain the longer test timeout, not relaxed tolerances.
