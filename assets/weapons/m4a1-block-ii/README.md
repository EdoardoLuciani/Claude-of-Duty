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
Native export: ≤91k instanced triangles, 18 ordinary primitive instances, one
material, four unchanged 1024² source maps, ≤13 MB (decimal). Geometry, motion,
contact and exact iron tolerances are unchanged; the narrow baseline-only normal
comparison allowance is documented below.
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
# node tools/blender/m4/hand-reference.mjs
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4/build.py -- --quick
# Non-destructive scratch build:
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4/build.py -- \
  --output /tmp/m4-authoring-review --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4/check.py
node tests/smoke/smoke-m4.mjs
```

Use frozen uniform registration for visual review: no after-only reframing or
independent X/Y warp; final native frames are authority.
History: [#339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339),
[sight approval #343](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/343).

## Ordinary-mesh representation (simplification candidate)

Python saves individually editable components, all 12 source materials, original
maps and sparse actions before export preparation. No geometry reduction, iron
reshaping, lettering removal, socket/contact movement or calibration change is
selected. Source and native products are generated from an empty scene.

The existing single opaque physical-node material is unchanged. Original linear
tint is COLOR_0 (16-bit normalized); UV1 stores roughness/metalness and UV2 normal
strength/role, constant per triangle. `m4-finishes.ts` samples the original UV0
maps, selects receiver-only albedo on role 1 and emits the approved paint tint at
strength 2 on role 2. The GLTFLoader normal-Y correction is preserved. All four
1024² PNGs remain byte-identical. Replacing this graph with an atlas or 12 source
materials is deliberately outside this bounded representation change.

The full-body 13-joint mechanical skin and its bone-action bake are removed.
Receiver, handguard and stock are three ordinary static chunks. Bolt, nested bolt
head, charging handle, trigger, dust cover and magazine release retain ordinary
geometry on their original animated controls. The four exact iron surfaces stay
ordinary meshes: merging them would require new geometric-subset machinery in
the precision probes for little additional storage return. More submissions are
an explicit trade-off, not free work. No new runtime machinery replaces the skin.

Historical 120 Hz motion, LINEAR/STEP interpolation, reset channels and exact
fractional Draw endpoint are unchanged. Direct cover persistence and empty
bolt/head overrides now move the actual ordinary descendants. Magazine
bodies/followers, independently hidden rounds and review case remain independent;
no hidden-parent scale is baked into their geometry. Inspection owns transforms
and mixers, borrows surfaces/materials and no longer allocates a weapon skeleton.

Immutable comparison baseline: `d29573f8b9426d70671ac5fb3fa4289a2de7546b`.

| Measure | Baseline native | Ordinary native | Baseline runtime | Ordinary runtime |
| --- | ---: | ---: | ---: | ---: |
| Raw file bytes | 12,884,956 | 9,914,424 | 5,020,616 | 4,994,800 |
| gzip -9 bytes | 4,405,531 | 4,416,379 | 3,962,487 | 3,963,226 |
| Unique triangles | 83,363 | 83,363 | 83,355 | 83,355 |
| Instanced triangles | 90,605 | 90,605 | 90,597 | 90,597 |
| Primitive instances / loaded Idle | 6 / 3 | 18 / 15 | 6 / 3 | 18 / 15 |
| Materials / images | 1 / 4 | 1 / 4 | 1 / 4 | 1 / 4 |
| Unique vertices | 97,573 | 97,628 | 82,878 | 82,879 |
| Skinned vertices / joints | 90,255 / 13 | 0 / 0 | 77,640 / 13 | 0 / 0 |
| CPU attribute bytes | 7,269,188 | 5,467,168 | 5,262,288 | 4,641,224 |
| CPU index bytes | 954,336 | 500,178 | 954,240 | 500,130 |
| CPU geometry bytes | 8,223,524 | 5,967,346 | 6,216,528 | 5,141,354 |
| Embedded image payload bytes | 3,147,456 | 3,147,456 | 2,883,599 | 2,883,599 |

All ordinary streams use 16-bit indices; the previous body stream used 32-bit.
CPU geometry falls 1,075,174 B (17.3%) in the decoded runtime. This is **not** a
GPU measurement. On r187 WebGPU, the baseline's non-normalized Uint8 joint IDs
expand to Uint32. Parent native AMD RDNA-4 measurements confirm uploaded geometry
**7,148,208 → 5,141,356 B** (−28.1%) and geometry-plus-logical-texture subtotal
**12,740,720 → 10,733,868 B**, with unchanged texture storage. Observed palette
storage falls 832 → 0 B, separately from that subtotal. This excludes other renderer
resources and driver padding. Isolated loaded-Idle beauty draws rise 3 → 15;
paired A/B/B/A CPU time averages roughly **0.120 → 0.150 ms**, while GPU pass time
is roughly 0.062 ms on both. That is a disclosed submission-cost trade-off, not
whole-game FPS evidence or a claim that CPU rendering became faster. Runtime raw bytes fall 25,816 B (0.51%);
gzip grows 739 B (0.019%), so compressed transfer savings are not claimed.

Texture formats, dimensions, mip count and payloads are unchanged: four 1024²
UASTC RGB KTX2 images, 11 mips each, original sRGB/linear assignments. Logical
texture storage remains 5,592,512 B for BC7/ASTC, not measured total residency.
The cook retains `-noq -vc 16 -kv`; it removes only the same eight zero-area
triangles. Exact native-to-cooked positions/UVs/winding/normals remain required.

### Independent parity and intentional minor difference

The immutable full-skin native baseline comparison covers 104,548 rest vertex
instances, 18 real surface/control owners, 2,796 fractional/event-adjacent poses
and 16,093,734 actual moving-vertex checks. Maximum position deviation is
0.000000018342 m, within the unchanged 2 µm motion/iron gates.

Local-frame native exporter normal rounding differs on 1,610 vertex instances,
2,814 affected triangles, total triangle area 0.0002997259001771814 m² (~3.0 cm²).
These are tiny bevel/local-frame normal differences, not flipped surfaces. The
largest unit-normal vector deviation is 0.0002999812 (~0.0172 degrees). Parent
approved a baseline-only 0.0003001 bound for exactly the six meshes below; every
other mesh retains the tighter 0.000002 comparison, and native-to-cooked normals
remain exactly equal. Positions and iron/contact tolerances are not relaxed.

| Mesh | Affected vertices | Affected triangles | Triangle area m² | Max vector delta |
| --- | ---: | ---: | ---: | ---: |
| bolt_head_mesh | 750 | 1,692 | 0.0000737883528616 | 0.0001731903762 |
| bolt_mesh | 191 | 304 | 0.0000190146735299 | 0.0001415291169 |
| charging_handle_mesh | 238 | 352 | 0.0001856987372193 | 0.0001726653943 |
| dust_cover_mesh | 70 | 96 | 0.0000043462578556 | 0.0000999999966 |
| mag_release_mesh | 206 | 250 | 0.0000135492768335 | 0.0001633750805 |
| Front_sight_post | 155 | 120 | 0.0000033286018773 | 0.0002999811689 |

Tests retain actual iron rays/support/dimensions, deformed hand/stock sweeps,
latch contact, magazine drops/ammunition, interruption/death/reset behavior,
cover and lockback motion, independent rounds, inspection rest/ownership and
material disposal. Matched native-GPU hero/side/optic/ADS/reload/inspect captures,
RGBA fallback, market and production integration passed. Fresh independent review
found no issues and the combined 160-test suite passed. Acceptance prioritizes
simpler representation and measured storage savings, not minimum submission count;
it does not certify general factory/human fidelity or an FPS improvement.

Reproduce with gltfpack **1.3** through the unchanged registered cook profile:

```sh
GLTFPACK=/home/edoardo/.local/bin/gltfpack node build/models.mjs m4
node tests/smoke/smoke-m4.mjs
```
