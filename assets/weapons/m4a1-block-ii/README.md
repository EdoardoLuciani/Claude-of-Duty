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
Native export caps: ≤91k instanced triangles, six primitive instances, one material,
four unchanged 1024² source maps, ≤13 MB (decimal). The native authoring byte
allowance includes the measured rigid-skin/finish attributes and 32-bit indices;
geometry, normal, motion, contact and exact iron tolerances are unchanged.
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

## Second-pass opaque/mechanical consolidation

Python still saves individually editable components, all 12 source materials,
original maps and sparse actions in `m4a1-block-ii.blend` before export preparation.
The approved first-pass geometry is unchanged: no new simplification, iron edits,
letter removal, socket/contact movement or hand calibration. Source and native
products are generated from an empty scene, not from an earlier GLB/blend.

All finishes now use one opaque physical-node material. Original linear tint is
COLOR_0 (16-bit normalized); UV1 stores roughness/metalness and UV2 stores normal
strength/role. These are constant per triangle, not texture coordinates for an
atlas. `m4-finishes.ts` samples the original full-resolution UV0 maps, chooses the
original receiver-only albedo on role 1, and emits the approved green paint tint
at strength 2 only on role 2. It preserves the native derivative tangent frame,
scales normal XY by the authored strength and retains Z before normalization.
Paint keeps roughness .8, zero metalness and no normal perturbation. All other
roughness values still multiply the original roughness image; no tint, roughness,
normal-strength, exposure or specular averaging/compensation is applied.

The four original 1024² embedded PNGs remain byte-identical; both 512² finish
atlases are removed. The direct graph samples four textures per fragment (shared
albedo, receiver albedo, roughness and full XYZ normal), versus three in each old
finish. Both albedo samples are selected by immutable surface data; no new
runtime texture allocation/packing or giant atlas is needed. The native GLB's
standard slots carry these four maps; the M4 adapter is required to interpret
UV1/UV2 and the receiver image carried in the emissive slot. The editable blend
continues to show the original source materials without that adapter.

One 13-joint, one-influence mechanical skin contains receiver, handguard, stock,
bolt, bolt head, charging handle, trigger, dust cover, mag release and the four
exact iron surfaces. Static assembly/sight names remain bones, not extra draws;
the M4 sight checker extracts actual weighted triangles rather than accepting
empty helpers as geometry. Original object curves are sampled onto equivalent
bone-local TRS at the historical 120 Hz/STEP lattice, including Draw's exact
fractional endpoint. Direct gameplay cover and lockback overrides operate on
those same bones. Independent magazine bodies/followers, independently hidden
loaded rounds and the review case remain real rigid meshes under their original
parents. Each retains one material/draw; neither magazine/drop ownership nor
cartridge visibility is approximated by collapsed skin geometry.

| Measure | Pass-1 native | Pass-2 native | Pass-1 runtime | Pass-2 runtime |
| --- | ---: | ---: | ---: | ---: |
| File bytes | 9,724,336 | 12,884,956 | 5,466,544 | 5,020,616 |
| gzip -9 bytes | 4,825,034 | 4,405,531 | 4,325,920 | 3,962,487 |
| Unique triangles | 83,363 | 83,363 | 83,355 | 83,355 |
| Instanced triangles | 90,605 | 90,605 | 90,597 | 90,597 |
| Primitive instances | 19 | 6 | 19 | 6 |
| Visible loaded-Idle submissions | 16 | 3 | 16 | 3 |
| Materials / images | 4 / 6 | 1 / 4 | 4 / 6 | 1 / 4 |
| Decoded vertex/index bytes | 5,575,394 | 8,223,524 | 4,163,826 | 6,216,528 |

Runtime surfaces are the 75,685-triangle mechanical skin, two 5,014-triangle
magazine bodies, two 2,228-triangle rounds and a 428-triangle case. Loaded Idle
shows skin + primary body + primary round (82,927 triangles); spare and case are
hidden exactly as before. The runtime has 82,878 unique vertices / 250,065 unique
indices; both magazine instances share buffers. Its decoded attributes use
5,262,288 bytes and indices 954,240 bytes. These are CPU typed-array storage, not
actual uploaded GPU allocation. The merged skin exceeds 65k vertices, requiring
32-bit indices. Exact finish factors and rigid joints/weights increase runtime
CPU geometry by **2,052,702 bytes (+49.3%)**. The regression budget is 6,216,528
bytes; this is an explicit draw-versus-storage trade-off, not a memory win.

Each runtime map is UASTC RGB KTX2 with all 11 mips; albedos stay sRGB, scalar and
normal images linear. Estimated full-mip BC7/ASTC 4×4 texture storage falls from
6,291,616 to 5,592,512 bytes; RGBA8 fallback estimate falls from 25,165,816 to
22,369,616 bytes. Native AMD RDNA-4 / Three r187 measurements found uploaded
geometry **4,163,828 → 7,148,208 B** and geometry-plus-logical-texture subtotal
**10,455,444 → 12,740,720 B** (9.971 → 12.150 MiB). This excludes other renderer
resources and driver padding; queue tracing also observed 832 B of bone buffers.
The second pass saves draws, not GPU memory, and establishes no FPS improvement.

Reproduce using gltfpack **1.3** through the checked-out `cookModel` API:

```sh
node --input-type=module -e "import {cookModel} from './build/models.mjs'; cookModel({input:'assets/weapons/m4a1-block-ii/m4a1-block-ii.glb',output:'assets/weapons/m4a1-block-ii/m4a1-block-ii.runtime.glb',flags:['-noq','-vc','16','-kv']})"
node tests/smoke/smoke-m4-skin.mjs
```

The registered profile includes `-kv` for otherwise-unused finish UV1/UV2. `-noq` preserves the existing 2 µm iron geometry checks;
16-bit tint avoids dark-finish eight-bit linear errors. No additional reduction
or material-policy change is selected. The cook still removes only eight
zero-area triangles. `makeM4Model` restores only a wholly constant, single-key
zero-duration Idle to 2 s; moving/nonconstant endpoint damage still throws.

Native-before-skin versus native-after-skin comparison covers 104,493 rest
vertices, all 18 surface/control owners, 2,796 fractional/event-adjacent poses and
16,135,083 deformed vertex comparisons (maximum 0.00001834 mm). Native-to-cooked
actual surface maximum is 0.03524 mm, consistent with the existing bounded cook
quaternion reduction; the static iron dimension, bore/ray and support checks
remain unchanged. Tests retain the actual hand-skin/stock sweeps, latch contacts,
magazine drops/ammunition, interruption/death/reset behavior, direct cover and
lockback deformation, independent rounds, inspection clone skeleton/bone-texture
ownership and disposal. Matched native-WebGPU hero/side/ADS/reload/iron captures,
RGBA fallback and independent code review passed. The normal graph retains the
loader's normal-Y sign for derivative tangents; native/runtime tests cover this
separately from geometry-normal parity. These checks do not establish factory
fidelity, continuous contact correctness or an FPS improvement.
