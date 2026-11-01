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
`manifest.json` records native counts/events; `textures/` holds the three
1024² editable-source maps and the generated 64² scalar finish lookup. The native
and runtime GLBs embed two 1024² detail maps plus that lookup. Do not author
changes in the generated files.
`src/weapons/mcx.ts` converts +X-forward/+Y-up and samples six native clips.
Draw/holster remain procedural, stock fold showcase-only. Shared arms/IK,
scope/reticle, sound and live pooled cases are runtime-owned; hide baked cases.
Normal builds need no Blender.

Caps: <110k triangles, five primitive instances, two materials, two 1024² detail
maps plus one 64² scalar lookup, ≤10 MiB native GLB.
Preserve complete-magazine bounds, vents/trigger, charging stem, cap/spine seating,
hinge/handle clearance throughout reload/fold and the seated TA51 foot/rail.
Keep matching clip names and STEP magazine visibility without reload blending.
Materials borrow textures; counts aren't GPU timings.

## Rebuild/check (root, Blender 5.2.2)

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx/build.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx/check.py
node tests/smoke/smoke-mcx.mjs
node --input-type=module -e "import {cookModel} from './build/models.mjs'; cookModel({input:'assets/weapons/mcx-virtus/mcx-virtus.glb', output:'assets/weapons/mcx-virtus/mcx-virtus.runtime.glb', flags:['-si','0.65','-se','0.0002','-sp','-vc','16']});"
```

Follow the [shared authoring workflow](../../../tools/blender/README.md).
`-- --output /tmp/mcx-review` builds elsewhere; add `--render --quick` for stills.
The local source map owns physical-scale UV projection and 60 Hz/STEP export details.

The finish uses a warmer medium-gray coating, smoother surface detail, matte
polymer and a darker charcoal suppressor. This is an artistic alternative to the
previous cool satin proposal, not a measured factory finish. In `FINISHES`, the
coating is linear RGB (.135, .130, .123), roughness .44, normal strength .025;
polymer retains its pigment with roughness .84 / normal .50; the suppressor is
RGB (.045, .046, .049), roughness .76 / normal .15. These remain the editable
source settings; the export-only consolidation policy below reduces fine grain.

The authoring pilot intentionally rebuilt UVs/triangle order. The subsequent
finish revision changed only material factors. The current optimization reduces
small machined bevels to one segment while retaining the four-segment rounded
forging/grip transitions, and exports one rigid-influence mechanical skin instead
of seven independent mechanical meshes. Independent magazines/casing, all named
helpers/sockets, six clips and their original events remain intact.

The material follow-up packs original linear pigments into per-corner `COLOR_0`
and metalness/mean roughness into padded 64² scalar tiles on UV1. Original UV0
albedo and full-XYZ normal pixels/repeat remain unchanged. One opaque material now spans
fine surfaces, polymer, rubber and the emissive fiber. A small MCX-local physical
node treatment reads existing UV1 finish identity to select exact .02/.50/.90/.03
normal strengths and fiber-only linear emission (.336, .0175, .0056). It samples
the unchanged UV0 full-XYZ normal texture, preserving derivative tangent and
back-face handling. No atlas, extra map, vertex stream or skeleton is added.
Procedural roughness grain remains intentionally replaced by its original mean;
only glass roughness stays outside the lookup so the adapter's optical override
retains its meaning. The glass remains separate with the established thin-alpha
policy (transmission 0, opacity .1, no depth writes, original runtime tint). No pigment, lighting,
exposure or color-management compensation is included.

Compared with the skin-only optimization: materials 13 → 5, primitive instances
22 → 13 (Idle-visible 15 → 8), runtime bytes 3,077,652 → 2,267,368. The trade-off
is larger native export (8,147,296 → 9,163,208 bytes) and decoded geometry storage
(2,515,012 → 3,679,532 bytes) from corner pigment and UV1. Native triangles remain
59,860, with identical position/normal/UV0/finish-identity triangle records. The
selected runtime has 53,209 instanced triangles. These are asset/storage counts,
not GPU allocation or performance timings. The earlier mechanical-skin commit
preserves the prior 13-material result as a fallback.

Second pass (from the five-material result above): materials 5 → 2, primitive
instances 13 → 5 (skin 5 → 2 including glass; each magazine 3 → 1; case 2 → 1),
loaded Idle 8 → 3. The spent case has no retained rubber split. Native triangles
remain 59,860 with an exact ordered-corner surface/normal/UV0/UV1/skin-binding
multiset hash matching the previous export. Unchanged cook flags now yield
53,162 instanced triangles (47 fewer from merged simplification boundaries), and
2,256,416 runtime bytes. This is not a source shape simplification or FPS claim.
The new shader adds finish-ID arithmetic (two floors, three comparisons and
normal/emission selects) to existing sampling; it adds no texture samples.
External GLB viewers need the MCX adapter to reproduce per-finish normal strengths
and fiber emission; the editable Blender preview retains all original materials.
Matched native-WebGPU captures and RGBA fallback checks passed. Measured uploaded
geometry is 4,454,976 → 4,457,100 B; logical textures remain 2,801,744 B. This is a
draw reduction, not an established FPS improvement. The pre-existing absence of
`magazineBody` means functional world-magazine drops remain unavailable in both
pass-1 and pass-2 MCX; independent main/spare transfer geometry is preserved.

The derived candidate uses gltfpack 1.3 with the shared cook flags plus
`-si 0.65 -se 0.0002 -sp -vc 16`. Sixteen-bit corner colors avoid dark-pigment
shifts from default eight-bit linear quantization. The adapter loads the runtime
GLB through the shared KTX2/meshopt loader. Matched hardware-WebGPU optical/texture/
hand captures and forced RGBA fallback checks passed; the decoded-geometry smoke
alone is not visual evidence or an FPS measurement.
