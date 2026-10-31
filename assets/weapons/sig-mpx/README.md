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
OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx.py -- \
  --output /tmp/mpx-review
# Omit --output to regenerate committed products after review.
# Refit calibration only as a separately approved change:
# node tools/mpx-hand-reference.mjs
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx_check.py
node tests/smoke/smoke-mpx-asset.mjs
node tests/smoke/smoke-mpx.mjs
node tests/smoke/smoke-mpx-skin.mjs
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx_normal_check.py
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
(four Uint32 IDs plus four normalized weight bytes, 20 B/vertex); parent must measure
actual uploaded geometry and increased object/submission costs. No FPS claim is made.

Independent native comparison matches **all 78,272 oriented triangles**, 63 retained
named controls and all 1,224 original helper channels. Maximum position difference
is 7.45e-9 m, UV difference 1.1920928955078125e-7 (the existing UV-only repeatability
limit), rest normal vector error 1.18e-7 and animated normal error 1.86e-7 over
15,349,162 samples. No affected normals exceed the existing 0.001 gate; there are no
new normal exceptions or appearance waivers. Actual ordinary carrier vertices from
live lockback/mid-reload inspections match fresh Idle exactly. Native/cooked gameplay,
contacts, actual closed solid-lid rays, magazine/round ownership and borrowed-resource
inspection disposal remain checked. GPU storage/submission/timing, matched views and
independent review remain parent gates; this candidate is not final visual acceptance.

### Approved solid covers and costs (historical skinned representation)

Only the two clear cover sheets are replaced: closed polymer discs join their
existing cap frames in the opaque mechanical skin. There are still twenty joints;
no new animation mechanism, runtime selector, material or texture is introduced.
Existing opaque material sidedness is unchanged; source manifold checks and
back-face-culled rays from both directions verify real front/back lid geometry.

| Metric | Earlier clear-cover base | Approved solid covers |
|---|---:|---:|
| Materials | 3 | 3 |
| All / loaded Idle primitive instances | 9 / 7 | 7 / 5 |
| Native triangles | 78,040 | 78,272 |
| Cooked triangles | 73,139 | 73,377 |
| Native raw bytes | 10,178,760 | 10,198,740 |
| Runtime raw / gzip-9 bytes | 2,688,196 / 1,762,442 | 2,689,748 / 1,768,263 |
| Runtime CPU vertex / index arrays, bytes | 4,102,984 / 438,834 | 4,115,992 / 440,262 |

Gzip-9 values here use the same Node compression level for both assets. All embedded
PNG/KTX2 payloads are byte-identical. Independent comparison matches all **77,960
unaffected oriented triangles**, including the original cap rims, with zero position
and rest/moving normal error across 15.3M samples. The deliberately removed 80 clear
sheet triangles are replaced by 312 triangles confined to the two solid lids; all
84 named controls and 1,368 existing channels match exactly. The existing UV-only
repeatability bound is unchanged. Geometry/storage grow slightly; no FPS or GPU-memory
improvement is claimed. Native AMD RDNA-4 / Three r187 measured uploaded geometry
**5,286,220 → 5,304,684 B** and geometry-plus-logical-texture subtotal
**9,480,604 → 9,499,068 B**; texture footprint and separately observed 1,280 B palette
storage are unchanged. This excludes other renderer resources and driver padding.
Matched hero/side/optic/ADS/reload/inspect and closed-cover optic/ADS readbacks,
forced RGBA, market and production integration checks passed. User visual approval
and independent technical acceptance cover this redesign, not general Gate 3.
When comparing the older clear-cover asset against the solid-cover asset,
`tools/mpx-pass2-parity.mjs` cannot match the deliberately replaced lid triangles;
that historical acceptance enumerated replacements separately. The current ordinary
candidate instead matches every triangle against the accepted solid-cover baseline.

### Accepted clear-cover consolidation baseline (historical)

Export copies combine the ten mechanical owners into one rigid-influence skin;
magazine shells and rounds remain four independent primitives for reload/drop ownership.
Body lenses and both cap sheets remain three independently sorted rigid transparent
objects, with unchanged 0.02/0.01 alpha, 0.25/0 clearcoat and 0.03/0.05
specular/environment factors. The absorptive interior stays separate at 0.02/0.03.
UV1 selects the optical scalar factors without another texture or vertex attribute.
Original editable parts/materials, sockets, controls, calibration and Actions remain.

| Metric | Pass 1 | Consolidated |
|---|---:|---:|
| All / loaded Idle primitives | 18 / 16 | 9 / 7 |
| Materials | 4 | 3 |
| Native triangles, all / Idle | 78,040 / 67,556 | 78,040 / 67,556 |
| Cooked triangles, all / Idle | 71,104 / 60,818 | 73,139 / 62,875 |
| Native raw / gzip-default bytes | 8,315,948 / 2,728,711 | 10,178,760 / 2,699,677 |
| Runtime raw / gzip-default bytes | 2,649,308 / 1,786,348 | 2,688,196 / 1,773,429 |
| Native vertices / vertex-view bytes / index-view bytes | 117,556 / 5,642,688 / 715,278 | 117,556 / 7,382,908 / 794,298 |
| Runtime vertices / vertex-view bytes / index-view bytes | 88,490 / 3,539,600 / 426,624 | 90,168 / 4,102,984 / 438,834 |

Opaque primitives fall 14→5 (Idle 12→3); optical/interior counts stay 3/1.
Native vertex-array growth is exactly 87,011 skinned vertices × 20 JOINTS/WEIGHTS bytes;
runtime growth is 62,033 × eight bytes plus 1,678 extra vertices × 40 base bytes.
Twenty joints (ten control parents, ten static mesh-local frames) add 1,280 inverse-bind
bytes, copied control animation channels, CPU bone matrices and an owned bone texture.
Loaded CPU geometry-array byte counts equal the vertex/index-view counts above;
unique native/runtime animation-value arrays grow 366,072→384,916 / 351,736→368,768
bytes. Animation-time arrays remain 4,008 / 4,020 bytes. Initial bone matrices cost
1,280 CPU bytes, or 2,304 bytes after the 12×12 RGBA bone-texture backing allocation.
Skinning adds vertex-shader work; mixed rigid/skinned opaque draws can require distinct
shader variants. The two optical TSL selectors add scalar shader work. No GPU allocation,
pipeline-count or FPS reduction is claimed from these CPU/delivery measurements.
Gzip values above use Node's default level; PR aggregate figures use Python gzip-9.
All three PNG/KTX2 payloads remain byte-identical to pass 1: 1024², cooked 11 mips,
358,652 normal + 226,365 surface + 601,978 ORM encoded bytes. Native AMD RDNA-4 /
Three r187 measurements found uploaded geometry **3,966,232 → 5,286,220 B** and
geometry-plus-logical-texture subtotal **8,160,616 → 9,480,604 B** (7.783 → 9.041 MiB).
This excludes other renderer resources, bone buffers and driver padding; queue
tracing separately observed 1,280 B of palette storage. This is a draw/storage
trade-off, not a GPU-memory or FPS improvement.

Independent source/normal and runtime reviews passed, including every original
triangle and tiny/zero-area normal. Matched native-GPU hero/side/ADS/reload/optic
captures, RGBA fallback, market and production integration checks passed. Inspection
samples authored Idle before caching helper/bone rest positions; native/cooked
regressions compare actual carrier vertices from lockback and mid-reload against
independent fresh Idle inspections. These checks do not clear human Gate 3 or
all-state/factory-reference acceptance.

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
