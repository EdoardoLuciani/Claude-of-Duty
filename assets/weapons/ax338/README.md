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

## Opaque finish consolidation and runtime candidate

The saved `.blend` retains the original separately editable components, finishes,
UVs and packed maps. After saving, `ax338/finishes.py` consolidates the **actual
export geometry/material slots**, not just scene groups: seven opaque finishes
share one material and one primitive per independently controlled assembly. The
coated scope lenses retain their separate transparent material/primitive, alpha
and normal scale. There is no new skin, hand calibration or hierarchy migration.

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

`loadAX338()` deliberately retains its existing signature and native URL until
shared decoder/registry integration. `makeAX338Model()` and its animation work
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
