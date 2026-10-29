# Mossberg 590A1 Tactical — provisional runtime prototype

Factory **SKU50774 (2016)**: 18.5-inch barrel, 6+1, ghost rings, fixed black
synthetic stock and tri-rail forend. Runtime uses `src/weapons/m590.ts` and the
committed GLB. **Strict 1:1 fidelity and final visual/gameplay acceptance remain
unapproved.** Passing contact tests is not visual approval.

## References and unresolved limits

Primary sources (accessed 2026-10-13):

- [Mossberg seven-shot release, p2 specifications](https://resources.mossberg.com/hubfs/press_releases/Mossberg-Introduces-7-Shot-Versions-of-590A1-and-590-PR-1-4-2016-FINAL.pdf)
- [2016 catalog, p2 photograph/specifications](https://resources.mossberg.com/hubfs/eBook_PDF/Mossberg-2016-NewProducts.pdf)
- [Manufacturer SKU50774 description/photo](https://resources.mossberg.com/journal/7-shots-now-available-in-mossbergs-legendary-590-tactical-shotguns)
- [Adiga Armory review](https://www.youtube.com/watch?v=g3Ln8Di3m2E) and
  [companion exterior opening](https://www.youtube.com/watch?v=b5jCBszsghc)

Manufacturer nominal targets: barrel `.4699 m` (closed breech to muzzle), OAL
`1.0033 m`, LOP `.352425 m` (trigger face to buttpad centre), six tube plus one
chamber. These are public nominal dimensions, not manufacturing tolerances.
The exposed barrel is approximately `.461288 m`.

The catalog right/ejection-side image is object 11, 1795×399 px. Comparison uses
uniform OAL scaling, heel x0/muzzle x1793 and barrel centre y71: 1607.143 px/m.
No anisotropic warp or adapter scale correction is allowed. Camera projection is
unknown; landmark selection alone is uncertain by 2–5 px. Photo trigger
`[670,181]` and butt centre `[12,275.5]` imply about 371.97 mm LOP, versus nominal
352.425 mm; its trigger is about 20.9 mm forward and 3.6 mm vertically displaced
from the nominal-constrained model. **This disagreement is unresolved; published
dimensions take precedence.** The Euclidean LOP endpoint convention is an authoring
assumption, not a manufacturer datum diagram.

Owner footage identifies 50774 (the review title also lists 50765), but does not
authenticate year, hidden cross-sections or metric mechanism travel. Tape, butt
cover, sling and attached hardware are excluded. The **89 mm pump stroke is
provisional**, not factory-verified. The open-port strip's ownership/motion remains
uncertain and deferred. Contours, rail relief, rear hardware and materials still
need independent visual review. No functional engineering acceptance is claimed.
Copyrighted frames/boards stay outside Git; do not substitute a mirrored right
photo for a verified left reference.

## Source and rebuild

Follow the [shared authoring workflow](../../../tools/blender/README.md).

| File | Purpose |
| --- | --- |
| `tools/blender/m590.py` | Geometry, seeded maps, UVs, studio, export and manifest |
| `tools/blender/m590_actions.py` | Seven actions, shared hand controls and excluded review skins |
| `tools/blender/m590/export_actions.py` | Runtime action sampling and native export assertions |
| `tools/blender/m590/skin.py` | Export-only four-joint rigid mechanical skin |
| `tools/blender/m590/finishes.py` | Export-only UV1 scalar finish atlas and exact linear vertex colours |
| `tools/blender/m590/clearance.py` | Narrow measured shared-glove/stock clearance exception |
| `manifest.json` | Basis, sockets, aliases, exact event beats, contact windows and export stats |
| `hand-reference.json` | Versioned shared-Arm calibration; quaternions x,y,z,w, angles in radians |

Declared read-only inputs are `hand-reference.json` and shared
`assets/player/arms/player-arms.blend` (excluded review skins only). Missing inputs
fail; ordinary builds never refit hands. `tools/m590-hand-reference.mjs` owns the
frozen, surface-reviewed firing wrist/pose and the existing support/shell fits.
Intentional calibration uses **edit calibration → `node tools/m590-hand-reference.mjs`
→ export → source clearance checks → in-engine review**. Do not restore the old
independent distal-pad stock fitting: it could satisfy pad distances while the
proximal fingers and thumb web crossed the stock.

From the repository root after `npm ci`, using Blender **5.2.2**:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/m590.py
# Isolated products; add --render --quick for optional GPU preview stills:
blender -b -t 2 --python-exit-code 1 --python tools/blender/m590.py -- \
  --output /tmp/m590-authoring-review
blender -b -t 2 /tmp/m590-authoring-review/m590.blend \
  --python-exit-code 1 --python tools/blender/m590_check.py
node tests/smoke/smoke-shotgun-asset.mjs
node tests/smoke/smoke-m590.mjs
node tests/smoke/smoke-m590-ads.mjs
node tests/smoke/smoke-m590-runtime.mjs
M590_TEST_RUNTIME=1 node tests/smoke/smoke-m590.mjs
M590_TEST_RUNTIME=1 node tests/smoke/smoke-m590-ads.mjs
blender -b -t 2 /tmp/m590-authoring-review/m590.blend \
  --python-exit-code 1 --python tools/blender/m590_clearance_check.py
```

The native Actions exporter retains the 120 Hz lattice, fractional endpoints,
constant-channel reduction and STEP resets. Hull visibility uses four exact
fractional keys and direct TRS curves, including orientation at zero scale.
**No GLB/JSON/accessor rewriting, exporter hooks or runtime compensation.**

Compare two fresh same-environment builds (GLB, embedded maps, manifest) with each
other and the committed baseline. Historical unchanged-source controls differed
from the committed stock by at most `2.9802322387695312e-8 m`, normals by
`0.005708665345738909°`, and six triangles' UVs by `2.384185791015625e-7`;
oriented topology/winding/bounds matched. Those reviewed rounding observations
are not new tolerances or permission to repair geometry/UVs.

Preserve the preview World Background node RGB `0.05087608844041824`, strength 1;
`World.color` alone is insufficient. Optional Draco/meshoptimizer bridge warnings
are harmless because this asset requests neither extension.

## Runtime contract

Native metres; Blender `(x,-z,y)` exports to runtime `-Z` forward / `+Y` up with
`export_yup=True`, no adapter basis/scale shim. `M590_RIG` is identity at Idle;
receiver, forend, bolt, trigger, `shell_insert`, sockets and hands are direct
children. Exact sockets, mechanism travel, clip durations/events and contact
windows live in `manifest.json`; do not maintain a second rounded schedule.

One mixer samples all mechanisms/hands. Gameplay events come only from the
shared event-only Clip bridge, never mixer listeners. Pump owns the trigger
pulse; there is no separate Fire action or baked shot recoil. Retain common
reactive recoil, pooled ejection, damage/spread and 6+1 accounting.

The #337 pump-audio correction adds a post-shot `boltrelease` at the existing
forward stop and places empty-reload `pump`/`boltrelease` at its real rear/forward
stops. Only event metadata changes: the complete GLB BIN (mesh, maps and sampled
motion) is byte-identical to the pre-correction export. Post-shot `pump` still owns
one casing; reload markers never invent one. Recorded audio contacts are split
so stopping an action cannot play a later return from inside a whole-cycle file.

Use shared arm scales left `.97` / right `1`, authored wrist/finger/thumb controls
and `hand-reference.json` contacts without adapter refits. Reload wraps, release,
thumb/rim insertion, clearance and return are distinct phases. The asset owns
the entire path; tests retain the full skin/hull sweeps and original tolerances.
**Never expose `shell_insert` as `parts.magazine` or `magazineBody`.** Its authored
STEP scale alone drives visibility. Idle/reset must restore all channels and hide
the insert on interruption, switch, death, restart and disposal.

Prototype body anchors are support shoulder Z `-.045 m` and firing shoulder Z
`.450 m` (including ADS), versus previous `-.020`/`.280 m`; shared arm lengths
and weapon mounts are retained. The 170 mm firing-shoulder offset is a
presentation compromise, not anatomical validation. Historical reach/wrist-angle
measurements predate the #447 firing calibration and are not acceptance gates.
The #447 firing-hand recalibration lowers/straightens the wrist alongside the
neck, keeps finger-root spreads within 11.5°, and distributes thumb flex across
both hinges (29.3°/17.5°, instead of a 74.3° distal hook). Hand scale, shoulders,
weapon framing, support/shell poses and all handling timings are unchanged.

`m590_check.py` now sweeps all five full evaluated right-arm skin surfaces at
120 Hz through all seven actions against the actual stock, receiver/tang and
trigger guard, with the one narrowly approved sub-30-micrometre tessellation
exception below; all other triangle crossings are forbidden. The moving trigger is an
intentional index contact and remains covered by the existing trigger-pad checks;
the existing left-hand pump/loading skin sweeps are retained. The original #447
pose fails the new full-surface gate at Idle frame 0. These gates do not certify
finger-to-finger clearance, anatomy or final lighting; human visual acceptance
of hip, ADS, inspect and transitions is still required.

## Export/runtime optimization

The editable `.blend` keeps all 110 original high component meshes, modifiers,
seven source finishes, UVs and sparse poses. Only evaluated export copies change:
rubber-buttpad bevels use two rather than four segments, forend-rib bevels two
rather than three, and receiver/forend/bolt/trigger share one four-joint rigid
skin. Original mechanical controls, sockets and hands remain named nodes.
`shell_insert` stays an independent, unskinned STEP-scale owner, never a magazine.

One opaque finish material serves both mechanical skin and insertion shell (two
submissions). Exact original linear base-colour factors live in `COLOR_0`;
UV0 albedo pixels, normal XYZ pixels and normal strength `.25` are unchanged.
UV1 selects seven padded binary-metal/scalar-roughness tiles in generated
`m590-finish-orm.png`. Only subtle roughness micro-grain is area-filtered over each
finish's UV domain; colours, exposure and normal detail are not compensated.
The generated PNG is authoritative Python output, not a metadata sidecar.

Native export: **72,206 triangles / 2 primitives / 1 material / 11,820,048 B**
versus 93,106 / 13 / 7 / 9,037,164 B before optimization. Native size grows due to
rigid weights, vertex colours, UV1 and 32-bit indices; the old unskinned 10MiB
native budget is replaced by a 12MiB authoring cap plus explicit <4MiB runtime
and <3.5MiB decoded-typed-array gates. The latter measure storage, not GPU allocation.
No gameplay/contact tolerance was relaxed for the new representation.

`m590.runtime.glb` is cooked using pinned gltfpack 1.3 through `cookModel` in
`build/models.mjs`, common flags plus:

```js
['-si', '0.50', '-se', '0.0002', '-sp', '-vc', '16']
```

Keep `-kn` and `-af 0`; use 16-bit vertex colours to retain dark finish factors.
The registry and shared meshopt/KTX2 loader integration remain parent-owned;
`loadM590()` deliberately retains its operational native URL/signature. Node
fixtures decode the runtime candidate without duplicating runtime loader machinery.
Matched render/evaluation evidence is external; final hardware-WebGPU and human
visual acceptance are separate from counts and smoke tests.

## Narrow approved shared-glove clearance exception

The committed older review blend embedded a denser glove. A fresh rebuild using
current shared arms has 12,562 charcoal-glove vertices / 25,120 triangles instead
of 15,074 / 30,144. The coarser surface creates the same tiny neck contact at all
**979** sampled 120Hz poses: Idle 0–240, Pump 0–54, Reload_Tactical 0–66,
Reload_Empty 0–114, Inspect 0–360, Draw 0–84 and Holster 0–54. Only right charcoal
glove faces **774 [1816,1813,1873]** and **7834 [1813,1872,1873]** cross stock-local
faces **1154/1157** (four overlap pairs per pose). Stock global face numbers in
historical combined audit buffers were 6426/6429; they are not local indices.

The operator explicitly approved this tessellation contact, not a general
clearance tolerance. `m590/clearance.py` requires the exact shared-arm file SHA256
`0fde215d10b6b7725f1117881b79c8888a2630d601a0a0e3eb34629ba74ef7ad`
and glove triangle topology SHA256 (little-endian uint32 triples)
`90eef66426a22d171eb78e2668c15c7a4b7809ecf73b4f7b9eb2f483bbc05bcc`.
The only admissible contact vertices lie in game-space bounds
`[-.0021,-.0347,.0861]` to `[.0021,-.0337,.0885]` metres. Different meshes,
triangles, winding, stock regions, receiver/tang/guard contacts or deeper contacts
still fail; no shared appearance, calibration or stock geometry was changed.

This is not a triangle skip list: every intersecting triangle receives an
adaptive signed-Euclidean-distance certificate over its entire area, using the
closed stock's 1-Lipschitz distance bound plus 0.1µm float-arithmetic allowance.
A cached certificate is reused only with its measured maximum vertex-displacement
error added. **30µm (0.030mm) is the absolute ceiling**, not a millimetre-scale
allowance. Initial 200-grid sampling measured ~26.43µm;
a full uncached 979-pose adaptive diagnostic found **27.6231µm** at Holster frame 50
(face 774), with a certified global upper bound **28.5000µm**. The cached
production checker conservatively bounds its complete sweep below 29.10µm.
The diagnostic records every affected pose/triangle externally. Native
source wrist/shell drift and all other original skin/contact checks are retained.
`m590_clearance_check.py` proves that +20µm deeper geometry, new contact triangles,
other right-skin surfaces, receiver contact, changed winding and out-of-region
contacts are rejected.

## Review evidence

External checkpoints under `/home/edoardo/Documents/Claude-of-Duty-recovery/`:
`issue410-corrections`, `issue410-junction-finish`, `issue410-reference-research`,
`issue410-reference-application`, `issue410-evidence-details`, and
`issue410-runtime-prototype`. They retain source provenance, unwarped comparison
boards, before/after views and validation logs. Catalog image SHA256:
`3bfbe157fe495de0e504b954619465e7c9078ecf073a86d98a1a88918bb80890`.
These checkpoints document local corrections, not final acceptance.

For play review, run `npm run dev`, buy M-590 as the secondary and equip with 2/Tab.
For deterministic diagnostics in `/?capture=1`, await readiness then call
`__ENGINE__.ctx.get('weapons').setWeaponImmediate('shotgun')`; this bypass is not
shop/balance acceptance. Use normal fire/ADS/reload/switch/pause controls and
`__ENGINE__.ctx.get('sky').setTimeOfDay(23)` for night. Read native final output rather than trusting a possibly black headless
swapchain; weapon/action capture matrices are temporary review scripts.
Before/after #447 hip/ADS/inspect images belong on the PR for human review.
