# Rendering and material simplification audit

## Scope and conclusion

Audited snapshot: `0700896a7bf2b44f07957d59f8a93bc86e40760c` (`develop`).
This is an audit, not an optimization patch. All experimental runtime edits were
reverted. Slight appearance loss was allowed when evaluating candidates.

**Lowest-effort submission reduction to review first:** omit shadows from selected
small clutter; a trial removed about 72 frame draws. **Closest soldier-style
batching experiment:** consolidate opaque finishes within the M4's rigid parts,
followed by the arms. **Best accumulation-case opportunity:**
instance ammo pickups. **Best geometry-authoring targets:** tyres, sandbags/crates,
and the very dense first-person gloves. Shader-only trials produced smaller,
repeatable GPU-pass savings, not demonstrated FPS improvements.

The earlier [soldier simplification, #479](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/479)
(`430ddc8`) is the model: nine authoring surfaces became one native opaque draw
per soldier, with flat surface IDs, texture arrays and vertex-resolved finish
parameters. It preserved skinning, geometry, history, culling and shadow ownership.
Its main benefit was fewer render objects/draws/uploads, not cheaper geometry.
The historical PR's timings are **not** measurements of this snapshot.

A read-only oracle consultation independently supported part-local weapon/arm
batching and cheaper world normal shading. Its cautions about dormant Physical
features, arm reflectance, animation boundaries and existing world batching are
incorporated below.

### Ranked opportunities

These are implementation priorities, not assertions that an unbuilt candidate
already improves frame time. CPU and GPU costs overlap; do not add their timings.

| Priority | Candidate                                                              | Concrete reduction available                                                                                             | Evidence / expected visual cost                                                                                                  | Effort                                              |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1        | Disable shadow casting on selected small clutter                       | Trial: **657.95 → 586.27** average frame draws (−10.9%)                                                                  | Measured draw reduction; CPU timing suggestive but variable. Small props lose cast shadows, not AO or collision                  | Small                                               |
| 2        | Batch opaque weapon finishes per moving part; start with M4            | M4 receiver **5 → 1** draws, handguard **2 → 1**, stock **3 → 1**; other part-local opportunities below                  | Asset/runtime verified; frame-time benefit unmeasured. Little loss required, though fewer finish distinctions are acceptable     | Medium                                              |
| 3        | Consolidate arm surfaces and simplify glove geometry                   | **10 → 2** arm draws; separately reduce the current **151,416 triangles** across both arms                               | Asset/runtime verified; frame-time benefit unmeasured. Keep finger/contact silhouettes; reduce dense reinforcement/seam geometry | Medium                                              |
| 4        | Instance ammo pickups instead of five meshes per item                  | At the 32-item cap: **160 → 4** beauty draws using existing material families                                            | Code-proven upper-bound opportunity, not an observed 32-visible-item benchmark. No appearance loss necessary                     | Small–medium                                        |
| 5        | Simplify repeated world props, beginning with tyres                    | 93 tyre instances currently represent **221,340 triangles**, before culling/pass repetition                              | Asset verified; vertex/GPU benefit unmeasured. Retain tyre hole/profile; give up small tread/lettering geometry                  | Medium, asset regeneration                          |
| 6        | Use a lighter opaque normal prepass                                    | Geometry-normal trial: GPU-pass p50 **3.191 → 3.043 ms**, approximately **−4.6%**                                        | Measured diagnostic; beauty unchanged, but GTAO loses mapped-normal detail. Needs interior/motion review                         | Small prototype; medium validation                  |
| 7        | Dominant-axis projection for ground finishes                           | Ground trial: GPU-pass p50 **3.191 → 3.065 ms**, approximately **−3.9%**                                                 | Measured diagnostic; fewer projection samples. Possible seams/stretching on slopes and dust fillets                              | Small                                               |
| 8        | Remove shallow parallax on common surfaces                             | Trial: GPU-pass p50 **3.191 → 3.095 ms**, approximately **−3.0%**                                                        | Measured diagnostic; normal maps retained, shallow close-up relief reduced                                                       | Small                                               |
| 9        | Reduce material/geometry overhead of bombs and the bomber              | Four meshes per bomb can become two material batches, then instances; eight rigid aircraft pieces can become two batches | Code verified; benefit unmeasured and limited to strikes. Little visible cost at flight distance                                 | Small–medium                                        |
| 10       | Reduce texture resolution / optionally adopt local compressed textures | Embedded 1024² texture payloads are substantial; halving dimensions quarters their uncompressed texel storage            | Memory/bandwidth/loading candidate, **not** demonstrated FPS uplift; weaker close-up detail                                      | Small for resolution trials; larger for compression |
| 11       | Simplify distant prop/soldier shading and selected transparent sheets  | Remove unnecessary microdetail/weather evaluation; selectively use single-pass sheets                                    | Shader/code verified, benefit unmeasured. More involved selection/prewarm/visual policy                                          | Medium; only after profiling                        |

No savings from the separate trials should be added together: they overlap,
particularly in normal sampling. None of these trials established a reliable
CPU frame-time improvement.

## What was actually scanned

Started from `ARCHITECTURE.md`, runtime initialization, render graph, native
material adapters, quality settings, authoring/export tools and the soldier PR.
Then inspected all GLB JSON/accessors/materials/images, decompressed world GLBs,
all standalone PNG headers/hashes, and the live Three.js scene/materials.

- **15 current GLBs:** seven authored weapons, arms, bandage, three regenerated
  soldiers, spent shotgun hull, world visuals and world collision.
- **39 embedded PNG images**, plus **46 standalone PNGs**: 29 soldier maps,
  eight particle/decal atlas images, nine weapon-authoring texture files.
- All **174 world visual mesh occurrences**, **44 palette keys**, and their
  instances/material reassignment. The raw inventory retains every mesh/prototype,
  material definition, image dimension and encoded-image hash.
- Runtime-generated meshes/materials: ammo pickups, grenades, handheld radio,
  intel cases, bomber/bombs, brass/hulls, particle pools, decals, sky dome, sky and
  material bakes, fog/haze, and render targets/post passes.
- `.blend` files/reference manifests are authoring inputs, not additional runtime
  draws. World collision and navigation are not rendering assets. Audio recordings
  have no rendering/material work and were outside the optimization scope.

The original checkout also contained ignored, obsolete
`public/models/weapons/{rifle,pistol}.glb`. A clean worktree plus `npm ci` and
`npm run models` does not recreate these, and current weapon loaders do not use
them. They were excluded from current-runtime budgets rather than counted as
additional weapons. Current soldiers **are** regenerated by that command.

### Render pipeline implications

See [render graph](../src/render/webgpu-pipeline.ts),
[render ownership/layers](../src/render/index-webgpu.ts),
[quality presets](../src/core/config.ts), and
[world assembly](../tools/worldgen/builder.js).

- Opaque world objects can be submitted to prepass, beauty, and intersecting shadow
  cascades; flashlight shadows add another possible consumer. Do not multiply
  every object by every cascade without accounting for actual visibility.
- First-person arms/weapons use a separate non-MSAA scene, no world prepass,
  no world TAA/fog, and no cast shadows. A saved arm draw is **not** saved again in
  every CSM cascade. Pixel/triangle work remains after material batching.
- World beauty already uses clustered point lights. Light identities are stable
  intentionally. Toggling lights invisible to reduce apparent counts would revive
  shader churn; zero intensity alone is not proof of no light work.
- A runtime census found **49 cached procedural material variants** at boot;
  44 world palette keys are used. The visual GLB's **19 placeholder materials**
  are replaced on load and do not describe runtime shader/material complexity.
- Most static world geometry is already globally merged by palette. Repeated
  props already use spatially bucketed instancing. Sharing a material across
  existing prop prototypes does **not** combine their draws.

## Asset inventory and specific actions

### First-person weapons

Sources: [adapters](../src/weapons/asset-material.ts),
[loaders](../src/weapons/loaders.ts), and the seven weapon-owned adapters/builders.
Counts below are base-pose mesh occurrences with visible ancestors after adapter
setup, **not frustum-tested GPU draws**. They exclude normally hidden spare parts
and cartridges. Transparent DoubleSide meshes can require two native draws.

| Asset  | Authored materials | GLB primitive occurrences, including hidden parts | Enabled runtime primitive meshes | Enabled triangles |
| ------ | -----------------: | ------------------------------------------------: | -------------------------------: | ----------------: |
| M4     |                 12 |                                                32 |                               27 |            97,977 |
| P320   |                  4 |                                                16 |                               13 |            50,062 |
| MCX    |                 13 |                                                37 |                               30 |            82,134 |
| MPX    |                 15 |                                                38 |                               33 |            81,452 |
| EVOLYS |                 10 |                                                35 |                               32 |            72,804 |
| AX338  |                  8 |                                                30 |                               27 |            98,017 |
| M590   |                  7 |                                                13 |                               10 |            91,778 |

Only the equipped weapon is shown. Summing all seven is **not** a per-frame cost.
The adapters already reuse one converted material per authored source material;
adding another material cache will not remove primitive boundaries.

**Smallest useful batching seam:** preserve each independently animated parent
and merge its compatible opaque primitives, adding surface IDs/finish data (or
baking a small atlas). These weapons already share many normal/roughness maps
between their finishes, so not every weapon needs a full soldier-style array of
all textures. Preserve exceptional maps, factors and UV transforms explicitly.

- **M4:** receiver 5, handguard 2 and stock 3 primitives can become one opaque draw
  each. This alone removes seven enabled primitive submissions; the remaining
  bolt/handle/release/magazine boundaries have additional opportunities. Start here
  because it is equipped by default. Its four embedded 1024² maps are shared
  finishes, not four textures per primitive.
- **MCX:** receiver has 11 primitives: **10 opaque plus one runtime-transparent
  lens**. Target two meshes, not one. Stock hinge has five compatible opaque
  primitives; charging handle has four. Preserve independent hinge/bolt/cover
  motion and magazine contents.
- **MPX:** receiver has 10 primitives: nine opaque plus optical glass. Stock hinge
  has four. Magazine/spare magazine have 17,877/17,836 triangles: dense ribs and
  small details are worthwhile geometry-review targets, but magazine contents and
  separate lens-cap hinges must remain independently controlled.
- **AX338:** receiver has six opaque primitives, handguard four, stock five.
  Its optic contains **26,319 triangles**, including its transparent lens; simplify
  exterior microgeometry without closing the aperture or altering the reticle.
- **EVOLYS:** receiver six, handguard four and stock four opaque primitives.
  The **19,968-triangle belt is skinned**; do not rigid-merge it into the receiver
  or discard authored belt deformation. Keep pouch/feed-cover reload boundaries.
- **M590:** receiver five opaque primitives and forend two; these account for
  **50,192 + 40,026 triangles**. Reduce dense small-scale shaping as a separate
  geometry change. Preserve forend travel and STEP-scale shell insertion.
- **P320:** the main finish is already uniquely baked PBR, so it needs less
  shader infrastructure, not another large texture library. Frame and slide each
  have three primitives. Bake compatible lettering into the existing finish;
  keep luminous sight paint distinct or encode emission, rather than losing
  sight readability.

All shipped weapon materials are authored double-sided. Front-side rendering is
worth a separate **closed-surface** experiment, especially after simplifying
geometry. It does not eliminate opaque draws, and cannot be applied blindly to
optical sheets, apertures, interiors or open-ended geometry.

**Do not blindly replace Physical with Standard.** Most opaque weapon finishes
have no active physical extensions; pinned Three conditionally enables clearcoat,
sheen, anisotropy and transmission. Changing the class alone is not equivalent
to dropping all those costs. MCX/MPX adapters already disable lens transmission:
there is no remaining full-scene transmission pass to claim as a new saving.
Preserve their intentional optical/specular/readability exceptions.

### Player arms and bandage

Sources: [arm loading/binding](../src/weapons/arm-asset.ts),
[blood](../src/weapons/arm-blood.ts),
[arm authoring](../tools/blender/player_arms.py),
[bandage adapter](../src/weapons/bandage-mesh.ts).

The arm GLB has five skinned surfaces totaling **75,708 triangles per arm**:

| Surface             | Triangles per arm |
| ------------------- | ----------------: |
| Woven glove         |            30,144 |
| Suede reinforcement |            26,036 |
| Knuckle rubber      |             9,600 |
| Ripstop sleeve      |             9,308 |
| Stitch              |               620 |

The runtime instantiates the same five surfaces for each hand: ten meshes and
151,416 triangles before clipping. Glove + suede + knuckle surfaces alone account
for **131,560 triangles across both arms**. Lower their segmentation while keeping
finger-joint deformation, webbing, thumb saddle and visible contact silhouettes.

A single surface-ID material and merged geometry per arm can remove eight normal
view-pass draws. Do not merge the two independently controlled skeletons together.
Preserve UV0 baked AO / UV1 microdetail, weights/bone order, mirrored winding,
normal handedness, and bind-space blood coordinates. Blood must remain restricted
to the sleeve/stitch surfaces, not be applied across the glove.

All five materials have authored specular strength approximately **0.16**. A
Standard replacement would change the dielectric reflectance substantially;
keep that shared factor in a consolidated Physical material. All are currently
double-sided: selectively cull backfaces only after checking extreme hand poses
and open cuffs.

The bandage GLB has three mesh occurrences, two materials, **1,408 triangles** and
four 256² images. It is already small. Roll/cap merging is possible, but the wrap
has independent animation/deformation. Do not spend the initial optimization
budget here.

### World geometry, materials and props

Sources: [world loading](../src/world/index.ts),
[palette](../src/world/palette.ts), [library](../src/materials/library.ts),
[surface shader](../src/materials/shader-tsl.ts),
[prop builders](../tools/worldgen/props.js).

The visual asset contains **620,328 static + 1,065,436 instance-expanded triangles**,
7,797 instances, and 174 mesh occurrences/draw batches before visibility tests.
The 44 palette keys resolve to **18 surface-library recipes**. Many share bakes
already; palette count is not independent texture-set count.

Largest repeated-prop opportunities, counted across the full map:

| Family                   | Instances | Expanded triangles | Present treatment / useful simplification                                                                                                                            |
| ------------------------ | --------: | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tyre + small tyre        |        93 |            221,340 | 2,380 triangles each, shadow casters, no distance cutoff. Reduce the 85 radial segments/15-point profile; retain bead/hole, bake or omit fine raised lettering/tread |
| Three sandbag prototypes |       377 |            165,880 | 440 triangles each, shadow casters. Lower filled-bag tessellation, retaining silhouette and cover dimensions                                                         |
| Crate A/B/C/flat         |       204 |            156,816 | Mostly slats/bevels, shadow casters. Simplify hidden/internal faces and bevel segmentation                                                                           |
| Dust skirts              |       324 |             84,240 | 260 triangles each; already no shadows and 42 m cutoff. Reduce fillet segments rather than deleting contact grounding                                                |
| Decorative pocks         |     1,886 |             75,440 | 40 triangles each; already no shadows and 65 m cutoff. Try much simpler shallow geometry or a suitably batched decal treatment                                       |
| AC units                 |       101 |             62,216 | Shadow casters. Bake small grille/bevel detail; retain housing silhouette                                                                                            |
| Satellite dishes         |        43 |             18,748 | Shadow casters. Reduce radial tessellation away from silhouettes                                                                                                     |

The tyre/sandbag/crate families together represent **544,036 triangles** before
culling, about 32% of the full visual asset. That is not 32% of actual GPU time:
visibility, projected area, instancing and pass coverage matter.

The scanner also covered the remaining barrel, pallet, rock, brick/block, furniture,
stall/sign, water tank, roof vent, gas bottle, jerry can, wheel, planter, palm,
foliage, produce, litter, bottle/can, plank, slab/rebar, conduit, wreck, mattress,
tray, lamp and glass-shard prototypes. Their per-prototype counts are retained in
the raw inventory. Most are much smaller individual targets. The existing scatter
cutoffs, no-shadow decorations, instancing and foliage prepass exclusion must not
be presented as new optimizations.

**Collision constraint:** do not hand-edit generated GLBs or silently lower
collision/ballistic fidelity with a cosmetic mesh change. Current world source
feeds both visual and cooked collision outputs. Any visual-only simplification
must explicitly preserve collision/navigation inputs; otherwise regenerate and
validate collision, penetration, support and navigation as part of the change.
Do not invent nominal collision thicknesses to compensate.

**Material simplifications:**

- 30 used palette keys / 138 batches have planar parallax configured. This is a
  shader feature inventory, not the number marching at every distance. Parallax
  already fades between 6 and 14 m. Remove the weak relief on plaster, concrete,
  painted/rusted metal and wood first, retaining authored normal maps; the trial
  below measures exactly that recipe-level change.
- Sand/dirt/gravel recipes use triplanar sampling: three base albedo/ORM/normal
  projections rather than one. Their five used palette variants span eight
  batches and 118,291 expanded triangles. Roads and ground fillets are good
  dominant-axis candidates; sloped mounds need seam review.
- `road_dust.detile = 0.9`, sand's `0.7` and dirt's `0.8` are **not evaluated**
  while those recipes are triplanar. De-tiling exists only in the other branch.
  Disabling those values alone does not save sampling. When switching projection,
  explicitly keep detiling off or the newly activated branch offsets savings.
- Common planar materials can sample a second albedo/ORM/normal set for de-tiling,
  plus detail and multiple macro/weather textures. Detail fades multiply sampled
  results; they do not by themselves skip sampling. The normal prepass retains
  material normal setup, so some of this work is paid again there.
- A small **cheap-prop shader family** could retain base albedo/ORM/normal and
  basic masks while dropping runoff, patch/fold detail and microdetail on small
  props. Prefer a few measured, prewarmed families, not a universal shader with
  every optional feature active. Much environmental weather is static; baking or
  simplifying it is plausible, but a generic tile cannot reproduce world-height
  and orientation effects exactly.
- Fabric/burlap actually enable Physical sheen and cloth backlighting/fold logic;
  unlike dormant physical features, these are real downgrade candidates. Retain
  their broad shading/readability and trial Standard on small bags before awnings.
- Compatible **static** plaster/concrete palette batches could later share surface
  IDs and geometry. The ceiling is far smaller than batching nine surfaces for
  every soldier. A single world material cannot also merge different instanced
  geometries automatically. Finer spatial chunks can reduce submitted triangles
  but add draws; do not do that indiscriminately in a CPU-sensitive renderer.

### Soldiers

All three GLBs still carry nine authoring primitives/material slots, but runtime
merges/annotates their geometry and draws one opaque native material:

| Variant   | Triangles | Runtime body/weapon material draws per pass |
| --------- | --------: | ------------------------------------------: |
| Vanguard  |    25,698 |                                           1 |
| Breacher  |    25,698 |                                           1 |
| Irregular |    21,374 |                                           1 |

The enemy weapon is already baked into the skinned soldier; it is not an extra
independent rifle draw. Existing AI relevance logic also considers potential
shadow contribution, not just camera visibility.

The remaining options are geometric LOD and a simpler distant finish, **not
repeating #479's material merge**. The combined shader samples microdetail even
on surfaces whose lookup parameters multiply its contribution to zero. A
prewarmed coarse tier could remove that fetch and rim/detail work, but needs
actual distance/population benchmarks; dynamic branches are not free.

The three camo normal PNGs are byte-identical, as are the three camo ORM PNGs.
Independent layer-index deduplication could save four 512² RGBA8 mip chains
(about 5.3 MiB theoretically), but requires changing the current common layer
selection. It does not remove draws or normal/ORM sample operations. This is a
lower-priority memory cleanup, not a large rendering-performance claim.

### Gameplay props, FX, sky and post-processing

- **Ammo:** [pickup implementation](../src/weapons/ammo-pickups.ts) creates case,
  lid, band, latch and additive ring for every item; cap 32, lifetime 180 s. Four
  opaque parts cast shadows. Merge lid/band under their shared finish and use
  case/edge/latch/ring instance batches: four beauty draws for the population
  instead of five per pickup. Maintain item identity, expiry, bob/rotation,
  interaction and ring blending. The living-combat profiler does not accumulate
  dead-enemy pickups, so it does not measure this opportunity.
- **Bomber/bombs:** [radio](../src/radio/index.ts) creates ten aircraft meshes
  (eight rigid opaque parts plus two transparent propeller discs), and four
  meshes per bomb (three shared-finish body pieces plus glow). Merge rigid pieces
  by existing material; instance the bomb body/glow across live bombs. Keep drop
  positions, detonation, hearing/audio tracking and propeller motion unchanged.
  These meshes currently do not opt into cast shadows; do not claim CSM savings
  for them. Their opaque parts do participate in the normal prepass.
- **Intel:** [cases](../src/intel/prop.ts) already merge small geometry by kind,
  but retain body/lid/material boundaries and render enclosed electronics while
  closed. Hide interior-only geometry when fully closed, then consider batching
  compatible finishes per hinged section. Keep alarm LEDs/beacon, label,
  interaction and opening motion; only a few cases exist, so lower priority.
- **Grenades / handheld radio:** six grenade meshes, plus a radio built from many
  small rigid pieces. Merge body/fuze and compatible radio housing details by
  material, keeping independently moving/hidden parts and the dynamic screen.
  First-person use is intermittent; prioritize the always-visible weapon/arms.
- **Particles:** already interleaved-buffer instanced pools with bounded uploads
  and shader-driven motion. They use transparent DoubleSide materials without
  `forceSinglePass`; pinned native Three submits back/front separately. A
  single-pass trial removed about **4.53 average frame draws**, but did **not**
  improve measured GPU-pass time in ordinary combat. Keep this as a low-risk
  heavy-FX follow-up, not an advertised FPS improvement.
- **Decals:** already one pooled draw with an atlas and PBR normal/ORM maps.
  Simplifying those channels may help fill-heavy blood/impact scenes, not draw
  count. **Brass/hulls:** already instanced; spent hull is one 768-triangle
  primitive with vertex color/PBR attributes, not a per-shell material array.
  Existing low caps/cutoffs should be preserved before designing new pools.
- **Transparency:** windows/bottles/lenses can pay two-sided draws. Prefer a
  single-pass option only for thin sheets after appearance checks; a closed
  bottle needs both front/back coverage for its intended appearance. MPX optics
  already set single-pass. AX338/EVOLYS lenses and world sheets are candidates,
  but not full-scene transmission-removal opportunities.
- **Sky:** one full-screen triangle, but procedural cumulus/cirrus/night shading
  can be expensive. Screen clouds currently always request detailed density;
  environment clouds already use a cheaper density variant. Trial lower detail
  or a lower-resolution cached sky only in sky-heavy views. Environment baking
  already has angular invalidation and a 0.25 s throttle; the deterministic
  combat fixture freezes automatic clock progression and cannot establish the
  live day/night rebake cost.
- **Fog/haze/post:** GTAO is already half resolution; world/view separation,
  compute fog, TAA and bloom are intentional costs. Per-pass resolution/quality
  reductions could exceed some asset savings on weaker GPUs, but are separate
  screen-space quality experiments. Do not delete the prepass on low quality:
  soft particles/haze still need current depth. Preserve linear-depth, velocity,
  transparency and history contracts when trying a cheaper normal output.

### Texture storage and sampling

The 39 embedded images are 35 at 1024² (arms + weapons) and four at 256²
(bandage). Assuming RGBA8 full mip chains, their **logical texel payload** is
approximately 188 MiB: arms 69.3 MiB, weapons 117.3 MiB, bandage 1.3 MiB.
This is **not measured process VRAM**; actual GPU formats, shared sources, texture
clones, allocation/driver behavior, render targets and CPU image retention differ.

Halving all 1024² embedded images to 512² would theoretically save about
**140 MiB** of that payload. Start with weapon micro-normal/roughness noise and
non-hero arm maps; judge ADS and close hand poses before downscaling uniquely
baked P320 color/markings/AO. Keep mipmaps and avoid indiscriminately reducing
anisotropy on oblique ground/weapon surfaces. KTX2/Basis or another supported
GPU-compressed delivery path is a later offline/local-WASM option, not a new
network service or an automatic frame-time win.

Standalone weapon PNGs are authoring companions to embedded images, not proof of
additional runtime image fetches. Eight are byte-identical to embedded PNGs;
MCX's external roughness PNG differs in encoding/content hash. Count the GLB
images used by the adapter, not both copies as separate resident textures.

Soldier maps are 512²; their texture arrays already preserve filtering/mips.
Particle/decal atlases have both 512² and 1024² versions; runtime selects one size
for the quality preset, not both simultaneously. Normal procedural world surfaces
are GPU-baked shared albedo-height/ORM/normal sets, not additional image files.
Lowering bake resolution targets memory/startup/bandwidth, not draw count.

## Controlled shader trials

All tests used fresh browsers, the same clean-installed worktree, full Chromium
153, hardware AMD RDNA-4 (RX 9070 XT selection, not fallback), High at
1280×720/DPR 1, five-agent `living-combat-v1`, 120 warmup + 900 measured frames,
lockstep 60 Hz simulation, unpaced headless scheduling, and `--gpu=1`.
No concurrent GPU jobs. Every run passed the profiler's living-combat gates,
reported zero errors/late node builders, and had no CPU budget misses or hitches.

Three fresh runs per condition; the table uses the **median of run percentiles**,
not a pooled distribution. Baseline 1–3 are the comparison; baseline 4 is a
post-trial drift check. Values are milliseconds except draws.

| Condition                         | GPU pass-sum p50 |   p95 |   p99 | CPU step p50 | CPU render-submit p50 | Mean frame draws |
| --------------------------------- | ---------------: | ----: | ----: | -----------: | --------------------: | ---------------: |
| Baseline                          |            3.191 | 3.402 | 3.450 |          5.5 |                   4.3 |           657.95 |
| Remove shallow parallax           |            3.095 | 3.304 | 3.344 |          5.5 |                   4.3 |           657.95 |
| Dominant-axis ground              |            3.065 | 3.259 | 3.297 |          5.7 |                   4.4 |           657.95 |
| Geometry-normal prepass           |            3.043 | 3.224 | 3.282 |          5.6 |                   4.3 |           657.96 |
| Single-pass particles             |            3.193 | 3.405 | 3.442 |          6.0 |                   4.7 |           653.42 |
| Baseline 4, end control (one run) |            3.198 | 3.418 | 3.446 |          6.5 |                   5.1 |           657.95 |

Exact trial definitions:

1. In `MaterialSystemNode.get`, after merging recipe options, set `p.parallax=0`
   for `plaster`, `concrete`, `metal_rust`, `metal_painted`, `wood`. Other recipes,
   normal maps and geometry remained unchanged.
2. Independently, for `sand`, `dirt`, `gravel`, set `p.uvMode='planar'` and
   `p.detile=0`. This includes `road_dust` and dust skirts. No parallax trial was
   stacked on top.
3. Independently, change the prepass MRT normal output from `normalView` to
   `normalViewGeometry`. Keep depth, velocity, materials/deformation, beauty and
   post settings unchanged. This is a prototype, not a fully minimal depth shader.
4. Independently, set particle material `forceSinglePass=true`; keep DoubleSide,
   blending, vertex/fragment nodes, budgets and all other settings unchanged.

**Limits:** native timestamp **render + compute pass sums** exclude copies,
queue wait and presentation. They are not complete GPU frame time. CPU rendering
is submission wall time, not GPU time. The end control shows material CPU drift;
therefore do not attribute the particle/ground CPU differences to their changes,
or claim a reliable FPS improvement. GPU baseline p50 remained within about
0.3% across the four controls.

Combat was active rather than idle. Most runs had 228 enemy shots; prepass run 1
had 230 and 299 rather than 300 paired GPU samples. Incoming damage varied
(approximately 1,494–1,528 in the initial controls) despite the fixed fixture;
worker admission is asynchronous. These are comparable workloads, **not an
exact deterministic replay**. Original runs were retained, not silently replaced.

Native final-output hero captures were inspected for baseline, parallax, ground,
and prepass trials; broad appearance remained similar in that view. These do not
approve close-up relief, sloped projection seams, interior GTAO, night, flashlight,
ADS or motion. No pixel-parity requirement or pixel-diff acceptance was imposed.
Screenshots are attached to the audit PR. All runtime trial changes were reverted.

### Additional small-clutter shadow trial

This targets draw submissions rather than finish shaders. Independently disable
`castShadow` for `brick_a`, `brick_b`, `plank_a`, `plank_b`, `slab_shard`,
`conduit_box` and `rock_a` world prototypes. They occupy 26 instance batches.
Keep their meshes, materials, prepass/GTAO, receive shadows, collision and
navigation unchanged; leave larger cover and actor shadows intact. In an actual
asset change, put the policy in prototype data rather than a runtime name regex.

Three control and three candidate **primary runs without GPU timestamps** used
the same fixture/settings as above. Order was control 1, candidate 1, candidate 2,
control 2, control 3, candidate 3. These were separate from the shader diagnostics.

| Run | Control render-submit p50 / p95 / p99 / max | Candidate render-submit p50 / p95 / p99 / max |
| --- | ------------------------------------------- | --------------------------------------------- |
| 1   | 4.4 / 5.5 / 6.2 / 6.6 ms                    | 4.1 / 5.0 / 5.5 / 5.9 ms                      |
| 2   | 3.7 / 4.7 / 5.7 / 6.9 ms                    | 4.1 / 5.1 / 5.5 / 6.4 ms                      |
| 3   | 4.6 / 5.7 / 6.4 / 7.2 ms                    | 4.0 / 4.8 / 5.6 / 6.3 ms                      |

Median run p50 render submission was **4.4 → 4.1 ms**; median CPU step p50 was
**5.7 → 5.3 ms**. The fastest control beats every candidate, so this is suggestive,
not a robust CPU/FPS acceptance claim. The robust result is **657.95 → 586.27 mean
frame draws**, about **10.9% fewer**, consistently across repetitions. Main-view
triangle geometry is unchanged; the removed submissions are shadow consumers.

Three separate GPU diagnostics yielded pass-sum p50 **3.156 / 3.160 / 3.119 ms**
(median 3.156, only about 1.1% below the initial baseline); do not infer an 11% GPU
speedup from an 11% draw reduction. Their p95 values were 3.369 / 3.381 / 3.321 ms;
p99 3.397 / 3.439 / 3.367 ms; maxima 3.419 / 3.446 / 3.421 ms. One had 299 paired
samples and two had 300. All nine additional runs passed combat coverage with
zero errors, late builders, hitches or CPU budget misses; some had 230 instead of
228 enemy shots. A native hero capture retained the broad appearance, but missing
small-object shadows require low-sun/flashlight/moving-camera review before shipping.

This is a better first quality-for-submission experiment than merging unrelated
world geometry: it removes real shadow draws without adding material or batching
infrastructure. The experiment was reverted, like the shader trials.

### Reproduction and retained evidence

```sh
npm ci
npm run models
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs \
  --port=5397 --frames=900 --warmup=120 --w=1280 --h=720 --dpr=1 \
  --quality=high --gpu=1 --out=/tmp/material-audit-profile.json
```

Local evidence directory:
`/home/edoardo/Documents/render-material-audit-lab/0700896/`.
It contains the complete GLB/PNG scanner and inventory, runtime census,
25 raw profile JSONs/logs (16 shader-diagnostic controls/trials plus nine shadow
primary/diagnostic runs), exact single-change
patches, native screenshots, oracle consultation, summary and file hashes.
Run `python cod-render-inventory.py /path/to/checkout` after `npm run models` to
repeat the asset inventory. Apply only one retained trial patch at a time at the
specified base revision. No runtime benchmark framework or dependencies were added.

## Suggested implementation sequence and gates

1. **Small-clutter shadow policy** first: repeat the submission trial with longer
   interleaved runs and low-sun/flashlight views; preserve collision and main-view
   geometry. Then **M4 opaque part consolidation**, one asset/adapter seam. Compare three or more
   interleaved baseline/candidate runs with GPU diagnostics separate from primary
   CPU timing. Count actual draws/uploads and maintain complete fire/reload/switch,
   ADS, socket and first-use/prewarm coverage. Reject a combined material that
   simply leaves geometry groups as separate material draws.
2. **Arm consolidation**, then a separate geometry-authoring experiment. Preserve
   physical reflectance, UVs, blood masks, mirrored binding and deformation. Review
   hip/ADS, all reloads, bandaging and extreme wrist/finger poses. Do not bundle
   material and topology changes into an unexplained result.
3. **Pickup instancing** with a late-wave/populated-loot fixture. Verify expiry,
   interaction, bob/ring blending and shadow equivalence; ordinary high-HP combat
   is not enough to accept it. Use a strike fixture separately for bomb batching.
4. **World prop simplification** with before/after source regeneration, collision/
   penetration/support/navigation gates and representative ground-level/roof views.
5. Ship individual **shader quality relaxations** only after normal-interior,
   sloped-ground, night/flashlight and moving-camera review. Preserve honest
   expectations: the observed wins were roughly 0.10–0.15 ms of GPU pass time on
   this machine, with no demonstrated CPU or presentation-speed improvement.

Validation of the final audit-only branch after restoring all experiments:
clean `npm ci`; `npm test` **153 passed**; `npm run build` (including typecheck,
lint and world-asset validation), `npm run format:check`, and `git diff --check`
passed. No asset source or generated runtime asset changes are included.

Follow `AGENTS.md` for clean-install tests/build/formatting and asset validation.
Several candidates intentionally relax current material-calibration policy;
update those specific expectations with reviewed visual evidence if implemented,
rather than weakening unrelated correctness tests or silently bypassing ownership.
