# M4A1 Block II

Starting rifle: Colt-pattern receivers, 14.5-inch SOCOM barrel, FDE RIS II FSP,
A2 front-sight base, raised MaTech rear aperture, FH556RC four-prong,
black LMT SOPMOD/A2 grip and non-E2 USGI 30-round magazine. No accessories.
Original art, not scan/CAD; receiver/grip/sights/finish still need human review.

## References and datums

[Block II configuration](https://clonerifles.com/m4a1blockii/),
[DD RIS II FSP](https://danieldefense.com/m4a1-fsp-risii-fde.html),
[SureFire FH556RC](https://www.surefire.com/socom-4-prong-flash-hider/),
[LMT SOPMOD](https://lmtdefense.com/product/sopmod-buttstock-black/),
[MaTech](https://www.matechsolutions.com/buis).
Barrel face-to-crown: 368.300 mm; main RIS envelope: 311.150 × 56.642 × 57.150 mm,
excluding rear flange. SureFire's 2.6 in/6.4 cm listing conflicts; provisional
flash-hider length is 66.040 mm. Hidden depths/gas routing are inferred.
Component photos don't certify the complete bare configuration; DD downloads
returned 403. Exact photo registration/URLs remain in the review JSONs.

## Source/runtime and approved sights

The [M4 source map](../../../tools/blender/m4/README.md) owns edit locations,
read-only calibration/review-arm inputs and native 120 Hz/STEP export details.
Follow the [shared workflow](../../../tools/blender/README.md): Python is authority,
blend/GLB/maps/manifest are generated. `photo-review.json` and `side-review.json`
record reference limitations.
Eight native clips preserve events/durations, shared IK/ADS/sway/reactive recoil.
Keep invertible rest seats, matching NLA tracks, visible spare descendants and
empty-reload latch/stock/deformed-arm clearance. No duplicate arms/live cases.
Native export caps: ≤91k instanced triangles, ≤19 primitive instances, four materials,
four 1024² source maps plus two 512² finish atlases, ≤9.8 MB (decimal).
The selected balanced finish adds a receiver-only albedo map with 25% of the
original variation around the same mean. The other three maps remain shared.
Receiver linear RGB is .041/.043/.046, roughness .44, normal strength .08;
FDE .56/.16, polymer .80/.55, phosphate steel .56/.16, magazine .67/.18
(roughness/normal). Metalness is unchanged; no added clearcoat. Source generation
and exported-material smoke checks own these settings, not runtime overrides.

The rear hole is restored to its original 2.2 mm bore and 7.6 mm outer cup;
the original sight centre and 2.60 mm post are unchanged. The upper 1.4 mm
neon-green tip is retained. The lower support clears the opening by 0.1 mm
while remaining attached; the historical untrimmed support occluded the bore.
Preserve paint/opacity, aperture rays, aim datum and solid attachment checks.
Selected runtime ADS framing is 60 mm eye relief / 42° vertical weapon FOV;
world zoom, sight dimensions and ballistics are independent.

## Rebuild/check (root, Blender 5.2.2)

```sh
# Only when intentionally changing shared hand calibration:
# node tools/m4-hand-reference.mjs
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
# Non-destructive scratch build:
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4a1.py -- \
  --output /tmp/m4-authoring-review --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
node tests/smoke/smoke-m4.mjs
node tests/smoke/smoke-m4-cook.mjs
node tests/smoke/smoke-m4-finishes.mjs
```

Use frozen uniform registration for visual review: no after-only reframing or
independent X/Y warp; final native frames are authority.
History: [#339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339),
[sight approval #343](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/343).

## Optimized native export and runtime candidate

Python still saves individually editable components, maps and sparse actions in
`m4a1-block-ii.blend` before export preparation. Cylinder edge radii use one
chamfer instead of two strips (the exact aiming post is excluded); the 0.2 mm
Picatinny cross-section corners use three samples instead of four. No vent,
letter, bore, mechanical contact, socket or aiming dimension is removed.
At export, fixed receiver/handguard/stock geometry is joined across assembly
boundaries into one indexed mesh with a primitive per compatible finish. Named
`handguard`/`stock` seats remain as empty helpers. Moving mechanisms, independent
magazine drops, top-round visibility and named iron meshes stay separate.
The editable source retains 12 finishes. Export uses four materials: unchanged
receiver, unchanged polymer/A2 checkering, packed opaque finishes and independent
emissive sight paint. The nine remaining opaque finishes carry their original
linear base factors in per-corner COLOR_0, with original full-resolution UV0
albedo. Two 512² UV1 atlases store padded roughness/metalness and strength-baked
normal XYZ (120² interior texels per finish, four-pixel guards). Normal baking
scales tangent-space XY by the original normalScale, retains Z and normalizes.
The positive affine UV mapping preserves tangent orientation. Receiver and A2
checkering retain their original UV0 normal maps and strengths; all four original
source maps remain byte-identical. No roughness/specular/exposure compensation is
applied in the adapter. Geometry lettering remains complete and unchanged.

| Measure | Previous native | Optimized native | Runtime candidate |
| --- | ---: | ---: | ---: |
| File bytes | 8,270,588 | 9,724,336 | 5,466,544 |
| gzip -9 bytes | 4,610,834 | 4,825,034 | 4,325,920 |
| Unique triangles | 98,405 | 83,363 | 83,355 |
| Instanced triangles | 105,647 | 90,605 | 90,597 |
| Primitive instances | 32 | 19 | 19 |
| Idle opaque primitive submissions (scene-derived) | 27 | 16 | 16 |
| Materials / images | 12 / 4 | 4 / 6 | 4 / 6 |
| Decoded vertex/index array bytes | 4,317,342 | 5,575,394 | 4,163,826 |

Array bytes are measured from GLTFLoader's unique typed arrays, not measured GPU
allocation or an FPS claim. Runtime UASTC KTX2 maps retain sRGB albedos, linear
scalar maps and full RGB normal XYZ, with 11 source-map / 10 finish-atlas mips.

The conservative geometry-only fallback remains at commit `390390e9`: 12 materials,
29 primitive instances, 4,960,516 runtime bytes and 3,151,490 decoded geometry bytes.
The four-material version deliberately trades +506,028 runtime bytes and
+1,012,336 decoded geometry bytes for 29→19 primitive instances / 24→16 Idle
submissions. Full-mip BC7 or ASTC 4×4 texture storage is estimated at
5,592,512→6,291,616 bytes (+12.5%); RGBA8 fallback is 22,369,616→25,165,816 bytes.
These are image/block-format estimates, not measured renderer allocations.
A 1024² atlas control cost 5,949,584 runtime bytes and 8,388,768 estimated compressed
texture bytes without a visible close-up benefit, so the 512² atlas is selected.
Slight procedural-grain reduction is accepted, not panel/lettering damage.

Reproduce the candidate with gltfpack **1.3** through the shared cook function
without overwriting the native export:

```sh
node --input-type=module -e "import {cookModel} from './build/models.mjs'; cookModel({input:'assets/weapons/m4a1-block-ii/m4a1-block-ii.glb',output:'assets/weapons/m4a1-block-ii/m4a1-block-ii.runtime.glb',flags:['-noq','-vc','16']})"
```

Use shared `GLTFPACK_FLAGS` plus `['-noq', '-vc', '16']`. Sixteen-bit color
quantization keeps the original dark finish factors within 1/65535, avoiding
the several-percent relative errors of eight-bit linear COLOR_0 for dark rubber.
Tested simplification ratios
0.75/0.60/0.50 with error limits 0.0002/0.0005/0.001 changed the precision-critical
iron meshes. Even unsimplified float-position quantization at 16 bits moves the
aperture outside its existing 2 µm diameter check. Do not relax the iron checks:
`-noq` keeps indexed positions/UVs/winding, retaining all nondegenerate surfaces.
Additional nonquantized simplification with 0.000002/0.00001 error limits saved
only 6–31 kB and made gzip larger, so it is not selected. The cook removes eight
zero-area triangles. It also collapses constant Idle keys to t=0; `makeM4Model`
restores **only** the observed zero-duration, wholly constant single-key Idle to
2 s. Moving/nonconstant clip endpoint mismatches throw rather than being repaired.

The native loader URL/signature intentionally remain operational. Parent
integration must register this profile and enable shared KTX2/meshopt loading
before selecting `.runtime.glb`. No EXPS3 attachment data or shared optic mounting,
ADS, arm appearance or hand calibration was changed. Both products run the full
M4 behavioral/actual arm-skin/contact suite. The cook test additionally checks
materials, map color spaces/channels/mips, names, indexed surfaces, STEP tracks
and 2,796 fractional/event-adjacent poses. Native motion is unchanged; cooked
maximum local translation error is 0.000051 mm and normalized quaternion error
is 0.004635 degrees. Final native-WebGPU visual/performance review remains an
integration gate. Matched CPU previews also use RGBA32-transcoded candidate
textures; the normal map has 1.334/255 RGB RMSE (maximum 13/255), while
receiver albedo is unchanged and the other two maps have <0.166/255 RMSE.
This accepts very slight micro-normal grain loss, not material/color compensation
or a claim about native GPU texture-format fidelity.
