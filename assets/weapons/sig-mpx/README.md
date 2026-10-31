# SIG MPX

**Gates 1–2 approved; animation/gameplay/optic Gate 3 remains pending.**
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
Optimized native caps: <80k triangles, nine real primitives, three materials including
glTF fallback, three embedded 1024² maps, ≤10 MiB. Normal builds need no Blender/network.
Editable components retain all 15 original finishes and three source maps. Runtime
copies retain full-resolution colour grain on UV0, exact per-corner linear finish
colours (16-bit normalized export), and padded 248²-per-finish roughness/normal
XYZ tiles on UV1. Only that subtle procedural grain is reduced; geometry markings,
rail/optic datums, source normals, sockets and authored contacts are not repacked.
Tiny magazine witness-dot cap bevels and handguard rim bevels use fewer segments.

Optics use absorptive inward faces and double-sided single-pass sheets, 2% lens/
1% cover opacity. Dot is nominal 2 MOA in world-camera space with a six-pixel
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
# Independent oriented surfaces, UV/finish/owner and moving-normal parity:
node tools/mpx-pass2-parity.mjs /path/to/pass-1-mpx.glb /tmp/mpx-parity.json
```

### Mechanical consolidation and costs

Export copies combine the ten mechanical owners into one rigid-influence skin;
magazine shells and rounds remain four independent draws for reload/drop ownership.
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
| Native raw / gzip bytes | 8,315,948 / 2,728,711 | 10,178,760 / 2,699,677 |
| Runtime raw / gzip bytes | 2,649,308 / 1,786,348 | 2,688,196 / 1,773,429 |
| Native vertices / vertex-view bytes / index-view bytes | 117,556 / 5,642,688 / 715,278 | 117,556 / 7,382,908 / 794,298 |
| Runtime vertices / vertex-view bytes / index-view bytes | 88,490 / 3,539,600 / 426,624 | 90,168 / 4,102,984 / 438,834 |

Opaque draws fall 14→5 (Idle 12→3); optical/interior draw counts stay 3/1.
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
All three PNG/KTX2 payloads remain byte-identical to pass 1: 1024², cooked 11 mips,
358,652 normal + 226,365 surface + 601,978 ORM encoded bytes. Parent native GPU
appearance/sorting/allocation acceptance remains required.

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
