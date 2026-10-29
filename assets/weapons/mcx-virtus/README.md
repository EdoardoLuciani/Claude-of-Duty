# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS, short factory M-LOK guard, folding/telescoping stock,
direct-thread SRD762Ti, TA31F/TA51 and black MAG800 magazine.
Original art, not CAD/scan or an endorsed/licensed replica.
Visual review remains separate from technical validation.
History: [#334](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/334).

## Reference authority

| Source | Authority / limitation |
|---|---|
| [SIG manual](https://www.sigsauer.com/media/sigsauer/resources/OPERATORS_MANUAL_SIGMCX_VIRTUS_ENGLISH_2402117-01_REV_02_LR.pdf), [9-inch SBR](https://www.midwestgunworks.com/page/mgwi/prod/rmcx-300b-9b-tap-sbr) | Base exterior; pictured accessories differ. |
| [PDW handguard](https://www.sigsauer.com/mcx-virtus-handguard-assembly-pdw-length-w-mlok-blk.html) | 8-inch nominal, overlap inferred. |
| [SRD762Ti](https://www.sigsauer.com/srd762ti.html) | 236 × 44 mm rounded exterior; not QD/SLH. |
| [TA31F](https://www.trijicon.com/products/details/ta31f) | 151.89 × 50.8 × 58.42 mm; inclusion of mount/protrusions uncertain. |
| [MAG800](https://magpul.com/pmag-30-ar-300-b-gen-m3.html) | Exterior and 7.5-inch max length; no measurement datum drawing. |

Photo-inferred contours/depths/finish/marks aren't certified dimensions.
Magazine construction uses its full minimum-area side envelope including
floorplate/feed lips, not world-Z height. No copied serial or real 5.56 BDC.

## Source/runtime contract

Python under [`tools/blender/mcx/`](../../../tools/blender/mcx/README.md) is the
sole authoring source. `mcx-virtus.blend/.glb` are generated editable-preview/native
products; `mcx-virtus.runtime.glb` is the derived gltfpack candidate.
`manifest.json` records native counts/events; `textures/` holds generated
1024² maps. Do not author changes in the generated files.
`src/weapons/mcx.ts` converts +X-forward/+Y-up and samples six native clips.
Draw/holster remain procedural, stock fold showcase-only. Shared arms/IK,
scope/reticle, sound and live pooled cases are runtime-owned; hide baked cases.
Normal builds need no Blender.

Caps: <110k triangles, ≤40 primitives, ≤16 materials, three 1024² maps, ≤10 MiB.
Preserve complete-magazine bounds, vents/trigger, charging stem, cap/spine seating,
hinge/handle clearance throughout reload/fold and the seated TA51 foot/rail.
Keep matching clip names and STEP magazine visibility without reload blending.
Materials borrow textures; counts aren't GPU timings.

## Rebuild/check (root, Blender 5.2.2)

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tests/smoke/smoke-mcx.mjs
node --input-type=module -e "import {cookModel} from './build/models.mjs'; cookModel({input:'assets/weapons/mcx-virtus/mcx-virtus.glb', output:'assets/weapons/mcx-virtus/mcx-virtus.runtime.glb', flags:['-si','0.65','-se','0.0002','-sp']});"
node tests/smoke/smoke-mcx-runtime.mjs
```

Follow the [shared authoring workflow](../../../tools/blender/README.md).
`-- --output /tmp/mcx-review` builds elsewhere; add `--render --quick` for stills.
The local source map owns physical-scale UV projection and 60 Hz/STEP export details.

The finish uses a warmer medium-gray coating, smoother surface detail, matte
polymer and a darker charcoal suppressor. This is an artistic alternative to the
previous cool satin proposal, not a measured factory finish. In `FINISHES`, the
coating is linear RGB (.135, .130, .123), roughness .44, normal strength .025;
polymer retains its pigment with roughness .84 / normal .50; the suppressor is
RGB (.045, .046, .049), roughness .76 / normal .15. Other finishes are unchanged.

The authoring pilot intentionally rebuilt UVs/triangle order. The subsequent
finish revision changed only material factors. The current optimization reduces
small machined bevels to one segment while retaining the four-segment rounded
forging/grip transitions, and exports one rigid-influence mechanical skin instead
of seven independent mechanical meshes. Independent magazines/casing, all named
helpers/sockets, six clips and their original events remain intact.

Native triangles: 90,146 → 59,860; primitive instances: 37 → 22 (Idle-visible:
30 → 15); native bytes: 8,866,176 → 8,147,296. The selected runtime candidate is
3,077,652 bytes / 52,677 instanced triangles. All thirteen distinct finishes and
three 1024² maps remain unchanged, including full normal XYZ and the established
10 cm repeating finish UVs. No material, exposure or color-management compensation
is included. These are asset counts, not GPU allocation or performance timings.

The derived candidate uses gltfpack 1.3 with the shared cook flags plus
`-si 0.65 -se 0.0002 -sp`; a more aggressive `0.50 / 0.0005` trial saved only
132,244 additional bytes and was not selected. The adapter continues loading the
native GLB pending shared KTX2/meshopt loader integration. Compare matched cameras,
pose and lighting; the decoded-geometry smoke uses texture stubs and does not
replace hardware-WebGPU optical/texture/hand review.
