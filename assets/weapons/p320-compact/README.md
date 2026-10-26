# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.
Follow the [shared source-first workflow](../../../tools/blender/README.md):
Python owns the weapon; blend, native GLB, atlas PNGs and manifest are generated
products. A separate texture-only cook derives the KTX2 runtime GLB; the native
PNG export remains the editable/rebuild reference.

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

Paths above are under `tools/blender/`. Helpers remain weapon-local. Keep the
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
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py -- \
  --output /tmp/p320-review --render --quick
blender -b -t 8 /tmp/p320-review/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
TOKTX=/absolute/path/KTX-Software-4.4.2/bin/toktx node tools/cook-p320-textures.mjs
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
materials. The optimized skin has 20,212 triangles / one primitive / one material,
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

### KTX2 runtime cook

`tools/cook-p320-textures.mjs` reads the untouched native `p320-compact.glb` and
writes `p320-compact.ktx2.glb` plus a provenance/settings JSON. It replaces only
embedded images and their texture references with required `KHR_texture_basisu`;
all non-image buffer bytes, accessors, meshes, skin, clips, nodes, material factors
and UV selections are preserved and checked by smoke tests. This is not geometry
optimization or exporter repair. Rebuild the native asset first, then recook;
stale derived products fail the source-hash check. Normal builds need neither
Blender nor the encoder because both GLBs are committed.

The external encoder is [**KTX-Software 4.4.2**](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2)
(`toktx v4.4.2`, no new npm dependency).
The Linux x86-64 release archive SHA-256 is
`a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245`.
Settings are UASTC quality 4, RDO lambda 0.25, Zstandard level 18, one encoder
thread, RGB, and a complete 11-level box-filtered mip chain. Color/emission use
sRGB; normal/ORM use linear data. Normal XYZ is retained, not repacked into XY;
there is no shader reconstruction or material retuning. Encoding is lossy: inspect
lettering and shallow highlights against the native PNG reference before approval.

The runtime GLB is **4.86 MiB** versus **5.28 MiB** native. On BC7 or ASTC 4×4,
four 1K maps plus mips occupy approximately **5.33 MiB** instead of **21.33 MiB**
(format footprint, excluding driver padding). Unsupported hardware gets decoded
RGBA8, not this memory saving. This is a memory optimization, not an FPS claim.

`src/weapons/p320.ts` configures the pinned Three loader from initialized native
WebGPU features, selecting BC7/ASTC or RGBA8; it intentionally avoids lower-quality
color block formats for normal/ORM. A two-worker decoder is disposed after the
asset load. Its matching JS/WASM and upstream notice are served locally from
`public/vendor/basis-e27dfa95/` (about 0.56 MiB uncompressed, a one-time cold-load
cost). Other weapon assets are unchanged. The decoder and cold transcode cost
must be included when evaluating download/load savings for this P320-only trial.

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
