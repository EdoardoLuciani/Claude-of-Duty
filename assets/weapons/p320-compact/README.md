# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.
Follow the [shared source-first workflow](../../../tools/blender/README.md):
Python owns the weapon; blend, native GLB, atlas PNGs and manifest are generated
products. A gltfpack cook derives the quantized, simplified KTX2/meshopt runtime
GLB; the native PNG export remains the lossless authoring/rebuild reference.

## Edit map

| Concern | Source |
| --- | --- |
| Stage order, paths and manifest | `p320_compact.py` |
| Pigment/roughness/metalness/grain/stipple and unique 1024² base/ORM/normal/emission bake | `p320/materials.py`: `build_source_materials`, `bake_atlas` |
| Low surfaces, surface UV density, baked-only lettering/traction, bevel reduction | `p320/surfaces.py` |
| Color-only UV1, local lettering panels and coarse unmarked finishes | `p320/color_uv.py` |
| Nine rigid mechanical bones sampled from the original part controls | `p320/skin.py` |
| Named assemblies, sockets, cartridge-tip latitude rings, lettering/atlas | `p320/geometry.py`: `build_geometry` |
| Eight weapon/wrist/finger clips, STEP visibility, events and review hands | `p320_actions.py`: `author_actions` |
| Preview clip selection | `p320/animations.py` |
| Native 60 Hz control sampling and stock Actions glTF export | `p320/export.py` |
| Fixed review cameras, lights and color management | `p320/studio.py` |

Paths above are under `tools/blender/`. `build/models.mjs` owns the runtime
gltfpack settings. Helpers remain weapon-local. Keep the
unique atlas, not MCX repeating projection. Lettering and shallow traction ribs
are high-to-low baked rather than rendered geometry; tritium emission has its
own mask in the same physical material. Spare magazines reuse topology/UVs,
with independent rigid weights. High bake sources remain hidden and editable in
`P320 | high bake source (not exported)`; the visible `P320_surface` is one skin.
`src/weapons/p320.ts` owns native sampling; shared IK and ammo/healing/interruption
logic remain runtime-owned. Preserve sockets, eight clips/events, wrist/finger
contacts, reload thumb grip and STEP magazines without renderer compensation.

## Build/check (root, Blender 5.2.2)

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py -- \
  --output /tmp/p320-review --render --quick
blender -b -t 8 /tmp/p320-review/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
GLTFPACK=/absolute/path/gltfpack npm run models:cook -- p320 /tmp/p320-review
# After scratch inspection, regenerate the committed products:
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py
GLTFPACK=/absolute/path/gltfpack npm run models:cook -- p320
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-p320-ktx2.mjs
```

Each factory-empty build bakes four maps with Cycles CPU, authors the original
object/hand actions, samples the mechanical bones, saves packed preview/studio,
then exports native Actions grouped by NLA name at **60 Hz**. The native export
copy samples the same 60 Hz control lattice without exporter force-sampling:
force-sampling bones would change discrete visibility to LINEAR. CONSTANT scale
curves must export STEP; all vertices have one unit bone weight. Bone axes preserve
the former part-local coordinates, including magazine hand contacts and runtime
slide/barrel overrides. Empty cartridge visibility uses bone scale, not only
`Bone.visible`. Post-export inspection is read-only. Review with `p320_review.py`.

Optimization baseline: 56,862 triangle instances / 16 primitive instances / four
materials. The native optimized skin has 20,212 triangles / one primitive / one material,
including both magazines and their cartridges. Outward-only glyph caps conform
to their actual assembly before
baking (the former barrel label floated 3.3 mm outside the chamber). All four maps
use 1024². The extra emission image preserves sight lighting without another
material section. The native PNG export's RGBA8+mips image storage is approximately 21.3 MiB
versus 16 MiB before optimization (and 53.3 MiB for the initial 2K color/normal
candidate). These are asset counts, not GPU timing claims; skinning and the extra
emission map are deliberate trade-offs.

### Texture-budget comparison

Matched 1920×1440 Blender profiles and fixed-pose native-WebGPU first-person
captures compare these fresh source bakes. The first three rows use identical
geometry and UVs; the final row uses the local lettering panels described below.
Lighting, cameras, material factors and animation remain fixed across all rows:

| Base / normal resolution (ORM/emission stay 1K) | GLB MiB | Approx. RGBA8+mips MiB |
| --- | ---: | ---: |
| 2K / 2K (initial optimization) | 8.86 | 53.3 |
| 2K / 1K | 5.34 | 37.3 |
| 1K / 1K, shared surface UVs | 4.77 | 21.3 |
| **1K / 1K, lettering-focused color UV1 (native PNG reference)** | **5.28** | **21.3** |

Color has its own `BaseColorUV` layer (glTF TEXCOORD_1), with about 80% of occupied
color UV area reserved for 13 tight lettering panels; unmarked finishes share
the remaining budget. Normal/ORM/emission retain surface UV0 and their original
relative density. Small face cuts establish local UV boundaries rather than
spending space on entire blank host islands; no glyph geometry is rendered.
These boundaries add 2,176 triangles and UV1 adds vertex data, but still require
one material and one primitive. All eight animation/skin transforms are retained.

Compared with shared-UV 1K color, the local panels have approximately 9× the linear
texel density: chamber/serial markings become readable again and slide lettering
is sharper, without a larger image. Plain-color grain/cavity shading receives
less resolution; geometric and normal-map detail remain separate. The 1K normal
still loses fine traction definition and changes highlights relative to 2K.
This is not a lossless replacement or an FPS claim. Human review still applies.

### gltfpack runtime cook

`npm run models:cook -- p320 [asset-directory]` uses the shared
[`build/models.mjs`](../../../build/models.mjs) pipeline with a P320-specific
simplification profile. It reads Blender's untouched native `p320-compact.glb` and
invokes native **gltfpack 1.3** with BasisU support, writing
`p320-compact.runtime.glb`. This is a GLB containing KTX2 textures and compressed
geometry, not a KTX2 model format. There is no per-model provenance sidecar and no
custom GLB repacking/repair. Rebuild native source first, then explicitly recook
and validate. Normal builds use committed assets and need neither Blender nor
gltfpack. No new npm dependency. Download the native tool from the
[official releases](https://github.com/zeux/meshoptimizer/releases/tag/v1.3).

The pinned settings retain named nodes/extras and constant tracks, disable time
resampling, use floating-point position/UV quantization (14/16 bits), 8-bit normals,
high animation precision (rotation 16, translation/scale 24), and meshopt compression.
Permissive simplification targets 50% with a tighter relative error limit of 0.001;
this asset stops at **17,368 triangles / one primitive / one material / nine joints**.
Float positions keep the named mechanical skin directly addressable. Float UVs
avoid `KHR_texture_transform` clones of the shared ORM map in the pinned renderer.

All four maps remain 1024² UASTC KTX2 with eleven mip levels. Color/emission use
sRGB; normal/ORM are linear data, with full normal XYZ and no shader reconstruction.
Texture quality 10 disables UASTC RDO; gltfpack uses Zstandard level 9. One encoder
thread makes repeated cooks reproducible. This replaces the former custom toktx
texture-only pass (quality effort 4, RDO lambda 0.25, Zstandard 18); its smaller
images were a different quality/size trade-off, not a better GLB container.

Geometry and animation bytes are intentionally no longer identical to native.
The approved constant-track folding removes the tiny ±0.1° idle tilt while retaining
vertical bob. Clip durations, hand contacts, STEP magazine visibility, sockets,
UV selections, material factors and gameplay events remain covered by tests.
Full-clip sampled socket/helper deviations are bounded at **0.3 mm / 0.12°** against
native (observed 0.238 mm / 0.103°). Inspect lettering, highlights, reloads and idle
motion before accepting further simplification or tuning changes.

The runtime GLB is **2.27 MiB** versus **5.28 MiB** native. Four BC7/ASTC 4×4 maps
with mips occupy approximately **5.33 MiB** instead of **21.33 MiB** (logical format
footprint, excluding driver padding). Unsupported hardware decodes to RGBA8 without
that memory saving. These are storage/buffer optimizations, not an FPS claim.

`src/weapons/p320.ts` attaches Three's local meshopt decoder and configures KTX2
from initialized native WebGPU features (BC7/ASTC or RGBA8). Its two-worker Basis
decoder closes after loading. `KTX2Loader` uses the JS/WASM already supplied by
the pinned Three npm dependency; Vite serves/emits these assets locally using the
loader's default package-relative URLs. No duplicate decoder binaries are checked
in. The Apache notice is distributed at `public/licenses/basis-universal-LICENSE.txt`.
Decoder transfer remains ~0.56 MiB before HTTP compression. Other weapons are
unchanged. Include decoder transfer/startup when evaluating cold-load savings.

Some distributions ship a Blender OCIO config newer than their linked OpenColorIO
library. Use a compatible process-local `OCIO=/absolute/path/config.ocio` retaining
AgX; never bake with color management disabled or compensate with exposure.
Shared arm appearance and committed `hand-reference.json` are explicit read-only
inputs. Refit separately with `node tools/p320-hand-reference.mjs` only when
intentionally changing contacts; normal rebuilds never refit.

## Historical migration exceptions (before the optimization)

The old all-unmuted NLA export zero-scaled `magazine_spare_round` in every clip.
The source already showed it; showing its authored brass/copper cartridge in both
reloads was explicitly approved. Stock Actions preserve its unit scale; parent
visibility still hides it in reset/other clips. Ammo semantics are unchanged.

The tip uses deterministic 24×12 latitude rings instead of allocator-dependent
UV-sphere traversal. Oriented connectivity is unchanged; maximum displacement is
4.067 nanometres. All twelve non-tip primitives retain exact positions/normals/
UVs/indices. Base/ORM PNGs are byte-identical; the normal atlas changes only tip
pixel `(822, 375)` from `(129, 128, 255)` to `(128, 128, 255)`, with no padding change.
Two fresh scratch builds and a committed-directory build matched runtime GLB/map
hashes. These narrow measured exceptions don't permit atlas/finish retuning or
replace human visual approval. History: [#315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315).
