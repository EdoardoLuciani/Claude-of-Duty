# SIG MPX

**Solid-cover redesign approved after matched native-WebGPU comparisons.**
The user approved replacing the two clear cap windows with solid polymer lids,
including their closed-cover occlusion. Fresh independent technical review passed.
This specific approval does not clear animation/gameplay/optic Gate 3.
Original game art, not CAD/scan or an endorsed/licensed replica.
Black select-fire 8-inch MPX, deployed factory stock, bare M-LOK guard,
30-round magazine, folded irons, ROMEO4T (not PRO), 1.41-inch mount/no spacer,
MPX-specific SRD9 at the actual barrel endpoint. No handstop or copied serial.

## Primary reference authority

| Source | Authority / limitation |
|---|---|
| [2019 SIG catalog](https://www.sigsauer.com/pub/media/sigsauer/resources/2019_DEFENSE_CATLOG_web.pdf), printed p.23 / PDF p.25 | Labelled 8-inch base inset, not the large suppressed hero's barrel configuration. |
| Same catalog, printed p.43 / PDF p.45 | MIL-SRD9-MPX: 175×35 mm with mount, not generic pistol SRD9. |
| [2021 LE catalog](https://www.sigsauer.com/media/sigsauer/resources/2021_LE_CATALOG_DEL.pdf), printed pp.15–16 / PDF pp.16–17 | Opposite-side/stock details; SD guard doesn't identify barrel length. |
| [MPX manual REV02](https://www.sigsauer.com/media/sigsauer/resources/OPERATORS__MANUAL_MPX_1811295-01_REV02_LR.pdf), PDF pp.26–28 | Controls/rear charging handle; not MP5 side cocking. |
| [ROMEO4T](https://www.sigsauer.com/romeo4t-1x20-mm.html) / [manual](https://www.sigsauer.com/media/sigsauer/resources/7402901-01_R00.pdf) | Approved 85.5×46×63.5 mm accessory envelope, 20 mm aperture, 2 MOA dot. |

The catalog's inconsistent MPX K dimensions are unusable. The optic manual's
84.6 mm closed-cover length differs from the approved product-page 85.5 mm;
measure the complete accessory, not body alone. Body/rim/battery cap, 64 mm lens
spacing, hidden depths/finish are inferred, not an optical prescription.
Reference fingerprints/registration remain in `photo-review.json`; no X/Y warp.
History: [#360](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/360).

## Source/runtime contract

The [source-first edit/build guide](../../../tools/blender/mpx/README.md) owns
geometry/PBR, action stages and declared read-only calibration/review-arm inputs.
`src/weapons/mpx.ts` converts +X-forward/+Z-up/−Y-right once; copy shared sampler
arrays before conversion. Eight native clips preserve shared IK/ADS/sway/recoil.
No duplicate arms, root recoil or review casing; all DCC controls need NLA tracks.
Keep exact balance/events, partial-mag retention, empty-mag discard, chamber/+1,
lockback/cancellation/reset and one live case per shot. Handle is non-reciprocating;
empty reload uses bolt release. Sound isn't a verified MPX recording.
Native asset: <80k triangles, sixteen ordinary primitives, three materials including
glTF fallback, three embedded 1024² maps, ≤10 MiB. Normal builds need no Blender/network.
The recipe retains all 15 original finish calibrations and three source maps;
editable solid lids reuse the existing polymer finish. The unused clear-cover
atlas slot is reserved so every other finish stays unchanged. Runtime
copies retain full-resolution colour grain on UV0, exact per-corner linear finish
colours (16-bit normalized export), and padded 248²-per-finish roughness/normal
XYZ tiles on UV1. Only that subtle procedural grain is reduced; geometry markings,
rail/optic datums, source normals, sockets and authored contacts are not repacked.
Tiny magazine witness-dot cap bevels and handguard rim bevels use fewer segments.

Optics use absorptive inward faces and double-sided single-pass body lenses at
2% opacity. Covers are solid 1.5 mm polymer lids using the existing cap
finish; they obstruct the aperture when closed. The existing lens/cap shader
selectors are removed, with unchanged constant body-lens alpha and clearcoat. Dot is nominal 2 MOA in world-camera space with a six-pixel
minimum diameter, no ring/halo; size after projection update. Weapon-only ADS FOV/shoulder
fit is explicit readability policy, not target magnification. Keep 20 mm aperture,
mount axis, open caps, fixed battery rim, wrist/contact and eight-action reach gates.

## Rebuild/check (root, Blender 5.2.2)

```sh
OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py -- \
  --output /tmp/mpx-review
# Omit --output to regenerate committed products after review.
# Refit calibration only as a separately approved change:
# node tools/blender/mpx/hand-reference.mjs
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx/check.py
node tests/smoke/smoke-mpx-asset.mjs
node tests/smoke/smoke-mpx.mjs
```

### Ordinary-mesh simplification candidate

The d29573f8 solid-cover baseline is retained as the independent comparison, not the
older clear-cap asset. The ten-control/twenty-joint full-body skin is removed in favour
of the original local-frame ordinary meshes. The four genuinely animated mechanisms
remain under their original controls; stationary parts need no skin. Caps keep their
actual adjustable pivots, 1.5mm solid lids and original open/closed behaviour. Body
lenses, absorptive interior and independent magazines/ammunition are unchanged.
No intentional surface change or retessellation was authored. The unchanged pinned
cook simplifies these separate rigid surfaces differently, which requires matched
native-WebGPU visual review before accepting the increased submission count.

| Metric | d29573f8 solid covers | Ordinary candidate |
|---|---:|---:|
| Materials | 3 | 3 |
| All / loaded Idle primitives | 7 / 5 | 16 / 14 |
| Native triangles all / Idle | 78,272 / 67,788 | 78,272 / 67,788 |
| Cooked triangles all / Idle | 73,377 / 63,113 | 71,270 / 60,984 |
| Native static / skinned vertices | 30,463 / 87,347 | 117,810 / 0 |
| Cooked static / skinned vertices | 28,057 / 62,369 | 88,676 / 0 |
| Joints / animation tracks (all 8 clips) | 20 / 1,368 | 0 / 1,224 |
| Native raw / gzip-9 bytes | 10,198,740 / 2,615,880 | 8,327,412 / 2,649,173 |
| Runtime raw / gzip-9 bytes | 2,689,748 / 1,768,263 | 2,650,272 / 1,774,679 |
| Native CPU vertex / index bytes | 7,401,820 / 797,802 | 5,654,880 / 716,910 |
| Runtime CPU vertex / index bytes | 4,115,992 / 440,262 | 3,547,040 / 427,620 |

Gzip uses Node level 9 consistently for both sides. Runtime delivery shrinks raw but
slightly grows compressed; this is not a delivery-size win. All three PNG/KTX2 image
payloads are byte-identical: 1024² with 11 cooked mips, 358,652 normal + 226,365 surface
+ 601,978 ORM encoded bytes. CPU array reductions are not GPU measurements. Removing
62,369 weighted vertices avoids r187's non-normalized Uint8 joint-ID expansion
(four Uint32 IDs plus four normalized weight bytes, 20 B/vertex). Parent native
AMD RDNA-4 / r187 measurement confirms uploaded geometry **5,304,684 → 3,974,664 B**
(−25.1%), with unchanged 4,194,384 B logical textures; the subtotal is
**9,499,068 → 8,169,048 B**. Observed palette storage falls 1,280 → 0 B, separately
from that subtotal. Other renderer resources and driver padding are excluded.
Isolated loaded-Idle beauty draws rise 5 → 14; paired A/B/B/A CPU/GPU microbench
results are not whole-game FPS evidence. No FPS claim is made.

Independent native comparison matches **all 78,272 oriented triangles**, 63 retained
named controls and all 1,224 original helper channels. Maximum position difference
is 7.45e-9 m, UV difference 1.1920928955078125e-7 (the existing UV-only repeatability
limit), rest normal vector error 1.18e-7 and animated normal error 1.86e-7 over
15,349,162 samples. No affected normals exceed the existing 0.001 gate; there are no
new normal exceptions or appearance waivers. Actual ordinary carrier vertices from
live lockback/mid-reload inspections match fresh Idle exactly. Native/cooked gameplay,
contacts, actual closed solid-lid rays, magazine/round ownership and borrowed-resource
inspection disposal remain checked. Parent matched hero/side/optic/ADS/reload/inspect
and closed-cover views, RGBA fallback, market and production integration passed.
Fresh independent review found no issues; the combined 160-test suite passed.
This bounded representation acceptance does not clear general factory/human Gate 3.

### Approved solid covers and costs (historical skinned representation)

The user approved replacing 80 clear-sheet triangles with 312 triangles forming
closed 1.5 mm polymer lids. This preserved the existing cap frames/pivots and
material sidedness; back-face-culled rays verify real front/back occlusion. Materials
stayed at three, primitives fell 9 / 7 → 7 / 5 (all / Idle), and native/cooked
triangles rose 78,040 / 73,139 → 78,272 / 73,377.

Costs versus clear covers were +1,552 runtime raw B, +5,821 gzip-9 B and +18,464
uploaded geometry B; image payloads, texture footprint and palette storage were
unchanged. All 77,960 unaffected oriented triangles were independently preserved.
Matched views and user approval covered this redesign, not general Gate 3.
The current ordinary meshes retain the approved lids and compare every triangle
against that solid-cover baseline; comparing older clear covers requires accounting
for the intentional replacements rather than relaxing parity.

[Detailed solid-cover acceptance](https://github.com/EdoardoLuciani/Claude-of-Duty/blob/d29573f8b9426d70671ac5fb3fa4289a2de7546b/assets/weapons/sig-mpx/README.md#approved-solid-covers-and-costs).

### Accepted clear-cover consolidation baseline (historical)

Before the solid-cover redesign, ten control/frame pairs combined the mechanics
without rebasing tiny bevels or re-encoding decoded normals. Materials fell 4 → 3,
primitives 18 / 16 → 9 / 7 (all / Idle), while all 78,040 native triangles remained.
Changed simplification boundaries produced 73,139 cooked triangles versus 71,104;
runtime raw size grew 2,649,308 → 2,688,196 B.

The body lenses and two clear cap windows retained independent transparent sorting,
with UV1 selecting their original alpha/coating factors; the absorptive interior
kept its separate lighting policy. Uploaded geometry grew 3,966,232 → 5,286,220 B
with unchanged images and logical textures. This was a draw/storage trade-off,
not an FPS or memory win. The current representation removes the mechanical skin,
and solid covers have already removed the optical selectors.

[Detailed clear-cover consolidation](https://github.com/EdoardoLuciani/Claude-of-Duty/blob/d29573f8b9426d70671ac5fb3fa4289a2de7546b/assets/weapons/sig-mpx/README.md#accepted-clear-cover-consolidation-baseline-historical).

### Runtime candidate cook

`loadMPX(renderer)` loads committed `mpx.runtime.glb` through the shared
meshopt/KTX2 loader; native `mpx.glb` remains the authoring reference. Both exports run
through the same adapter and smoke checks via `tools/lib/glb-fixture.mjs`.
With gltfpack **1.3**, use `cookModel` from `build/models.mjs` and its unchanged
shared flags plus `['-km', '-vc', '16', '-si', '0.7', '-se', '0.0002', '-sp']`.
`-km` is required: opaque and absorptive interior use the same atlas but different
runtime pass policies. `-vc 16` preserves dark linear reflectance; retain `-kn`
for every socket/helper. No decoder or registry changes are weapon-owned.
The more aggressive 0.5 / 0.0005 setting was rejected for visible optic-rim
artifacts. The selected conservative setting preserves lettering and silhouettes
in matched previews. Native-WebGPU/Basis-texture captures and forced RGBA fallback
checks also passed; this is not factory-reference approval or an FPS claim.

All eight authored clip durations/events are unchanged. glTF infers durations
from keys: gltfpack deduplicates wholly constant Idle to one t=0 key. The adapter
restores its authored two-second hold **only** for that zero-duration/single-key
case; moving clips and arbitrary Idle durations are not rewritten. Tests retain
all contact gates and check native/decoded STEP edges and Idle start/interior/end,
reset and loop poses. Equivalent quaternion signs are compared as orientations,
with explicit 16-bit quantization bounds and dense world-space motion parity.

Previews use Eevee without ray tracing; common flags follow the shared workflow.
The [approved UV-repeatability limitation](../../../tools/blender/mpx/README.md#approved-repeatability-limit)
retains the atlas and explicitly leaves GLB byte-repeatability unmet for evaluated
UV bytes. Maps/manifest and non-UV payloads still require exact comparison.
Technical gates don't certify all-triangle clearance or final appearance;
Gate 3 human approval, finish/highlight/FX/audio review remain outstanding.
