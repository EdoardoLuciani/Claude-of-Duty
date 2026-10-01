# M4A1 Block II — reference and implementation audit

Status: **configuration, implementation scope and budgets approved by the user;
implementation in progress, visual/reference acceptance pending**.
The user selected “Approve and implement” after reviewing this audit. Technical
checks below do not constitute AAA or matched-photo fidelity sign-off.
The first photo-led correction and seven diagnostic comparisons are documented
in [PHOTO_REVIEW.md](./PHOTO_REVIEW.md); their unfavorable results and camera
limitations remain open, not an acceptance pass. The subsequent stock/magazine/
trigger side-reference correction is in [SIDE_REVIEW.md](./SIDE_REVIEW.md);
its regional improvements also do not establish whole-rifle/AAA acceptance.
Base: `6c7330c` (`develop`, including merged MCX PR #334).
Branch: `feat/m4-block-ii-fidelity`.

## Agreed target

- Colt M4A1-pattern 5.56 mm receiver set and 14.5-inch SOCOM-profile barrel.
- Daniel Defense **M4A1 RIS II FSP, FDE**, SKU **01-004-08030**.
- Fixed Colt A2 front-sight base; **MaTech 600 m** rear aperture raised for use.
- SureFire **FH556RC-1/2-28** four-prong flash hider; **no suppressor**.
- Black **LMT SOPMOD** stock, black A2 pistol grip, GI trigger guard.
- 30-round aluminum USGI magazine; use standard, non-E2 **OKAY** body imagery
  as the shape/finish reference, not the MCX's polymer .300 BLK magazine.
- Bare rifle: no optic, magnifier, laser, weapon light, rail covers or foregrip.
- Lightly used: restrained handling wear, finish variation and crevice grime.

This is a configured Block II **base rifle**, not a claim that an iron-only,
bare rifle reproduces a complete issued SOPMOD accessory kit or one identified
military specimen. Manufacturer-backed markings only; do not copy serials,
unique inventory IDs or a photographed specimen's identifying labels.

## Acceptance and reference discipline

The user selected **matched-photo comparisons**, not an unsupported literal
pixel-perfect/scan claim. Geometry and materials are to be authored in Blender;
reference images are review inputs, not shipped textures or downloaded meshes.

Use fixed landmarks and consistent uniform registration for assembly comparisons.
Do not separately stretch X/Y, fit the grip independently, or move individual
parts solely to improve an overlay. Estimate and disclose photographic camera
and lighting. Component comparisons and assembly comparisons must be labeled
separately; an upper-only photograph is not evidence for lower/stock proportions.

The sources below support a complete FSP upper and individual selected parts.
A single verified photograph of **the entire exact bare configuration** has not
yet been established. Use matched component/upper views plus assembled multi-view
and gameplay evidence; do not present them as a matched whole-specimen photograph.
Reference crops with unmodeled accessories must label/mask those differences.

Reliable, unambiguous published dimensions should meet a **1 mm target** under
an explicit measurement convention. Photo-inferred contours, unknown datums,
rounded catalog values and conflicting specifications must remain disclosed.
Passing model dimensions is not manufacturer certification of every surface.

## Source ledger

| Part / purpose | Reference | Reliability and limitation |
| --- | --- | --- |
| Block II configuration | [Clone Rifles parts list](https://clonerifles.com/m4a1blockii/) | Secondary configuration guide; not a dimensional authority or proof of one issued specimen. |
| RIS II FSP | [Daniel Defense product page](https://danieldefense.com/m4a1-fsp-risii-fde.html) | Primary: SKU, construction, 12.25-inch length, 2.23-inch width, 2.25-inch height, 1.15-inch inside diameter. Exact envelope/datums require explicit treatment. |
| Complete FSP upper | [Charlie's Colt/SOCOM FSP assembly](https://charliescustomclones.com/m4a1-sopmod-block-2-fsp-upper-receiver-military-special/) | Photographed secondary assembly reference; includes accessories not selected here. Cross-check its individual parts against primary sources. |
| Colt receiver / barrel family | [Colt M4 page](https://www.colt.com/detail-page/m4-carbine/) and [Colt catalog](https://www.colt.com/wp-content/uploads/2026/02/26-COLT-0200-COLLATERAL-Commercial_Catalog-RND2-FINAL-Flipbook.pdf) | Primary family/14.5-inch SOCOM support. Civilian extended/pinned A2 muzzle configurations and semi-auto markings are not this selected military-style exterior. |
| Four-prong flash hider | [SureFire FH556RC](https://www.surefire.com/socom-4-prong-flash-hider/) | Primary shape/material/SKU. Published length has an inconsistent imperial/metric equivalent; see below. |
| MaTech rear | [MaTech BUIS](https://www.matechsolutions.com/buis) and [MGW views](https://www.midwestgunworks.com/page/mgwi/prod/12996812-c) | Primary functionality and corroborating photos. Dimensions, aperture diameter and detailed contours are not manufacturer-certified here. |
| LMT stock | [LMT black SOPMOD](https://lmtdefense.com/product/sopmod-buttstock-black/) and [LMT illustrated manual](https://lmtdefense.com/wp-content/uploads/2021/06/Sopmod-Buttstock-Instruction-Manual-booklet.pdf) | Primary construction/components: cheek weld, rubber pad, storage tubes, QD features. Do not mistake retailer package dimensions for physical stock dimensions. |
| Carbine gas tube | [Daniel Defense carbine-length assembly](https://danieldefense.com/carbine-length-gas-tube-assembly.html) | Primary nominal 9.783-inch length; installation endpoints, tube routing and inlet/FSB contours remain fit-inferred. |
| Standard aluminum magazine | [OKAY press-release coverage](https://defensereview.com/okay-industries-surefeed-usgi-30-round-standard-capacity-5-56mm-ar-magazine-now-available-to-civilian-tactical-shooters/) and [multi-view retail specimen](https://riflemags.co.uk/surefeed-5-56-22-30-round-usgi-m16-m4-magazine/) | Corroborates aluminum, dry-film gray finish and standard body. No verified manufacturer datum drawing or complete envelope dimensions yet. No copied date/specimen identifiers. |

### Published targets and unresolved datums

- Barrel nominal length: **14.5 in = 368.300 mm**, measured from the closed-bolt
  face to the barrel crown, not the exposed tube or flash-hider tip.
- RIS II FSP nominal length: **12.25 in = 311.150 mm**; nominal outer width
  **2.23 in = 56.642 mm**, height **2.25 in = 57.150 mm**, inside diameter
  **1.15 in = 29.210 mm**. State which fasteners/bolt-up features each measured
  envelope includes; do not silently use a shell-only result.
- SureFire publishes **2.6 in (6.4 cm)**. These are **66.040 vs 64.000 mm**, a
  **2.040 mm** disagreement, not equivalent unit conversions. The provisional
  nominal target is 66.040 mm, corroborated by [Brownells' 2.600-inch listing](https://www.brownells.com/gun-parts/rifle-parts/rifle-muzzle-devices/socom-4-prong-ar-15m16-5.56mm-flash-hider/).
  Disclose the conflict; do not claim simultaneous 1-mm compliance with both.
- Receiver/grip/stock contours, MaTech aperture/height and magazine envelope are
  photo-informed unless a reliable additional datum is found. Do not impose
  the PMAG's 190.5 mm maximum on the USGI magazine by analogy.

## Existing baseline (independently measured)

Clean `npm ci`, build/export and weapon boot capture pass at the base revision.
The generated rifle GLB contains **61,672 triangles / 70,099 accessor vertices /
21 mesh primitives / 21 materials / 2,637,084 bytes / no embedded texture images**.
Its procedural material textures are supplied separately at runtime, so its
geometry-only byte size is **not** directly comparable with a new textured GLB.
Copies of baseline assets, metadata, timing snapshot and capture are ignored
review output under `.tmp-rend/m4-audit/`.

The current model is a generic AR-pattern configuration: 240 mm free-float guard,
three-port brake, unspecified collapsible stock/polymer magazine, tube red dot
and folded backup sights. It is not the agreed Block II configuration.

## Gameplay and timeline contract

Retain weapon ID/label `rifle` / `M4A1`, starting-primary role, ownership/shop
behavior, ammunition accounting, ballistic and damage data, firing modes,
camera recoil, ADS transition/FOV/sensitivity and action/event timings.
Necessary geometry-local sight alignment, hand contacts and viewmodel placement
may be refitted. **No red-dot mesh, glass shader or illuminated aiming reticle**
on this rifle: ADS must align the actual rear aperture and front post.

| Clip | Duration (s) | Existing gameplay events (s) |
| --- | ---: | --- |
| Tactical reload | 2.100 | start .042; magout .420; magdrop .714; magin 1.701; slap 1.848; end 2.0895 |
| Empty reload | 2.900 | start .058; magout .464; magdrop .870; magin 2.059; charge 2.610; boltrelease 2.6593; end 2.8855 |
| Inspect | 3.200 | end 3.184 |
| Draw | .620 | end .6169 |
| Holster | .400 | end .398 |

The game's existing burst mode stays a gameplay abstraction; do not invent a
burst marking or claim the selected real M4A1 has a burst fire-control group.
Match source event numbers within floating-point tolerance, rather than
reconstructing convenient new beats from animation keyframes.

## Approved implementation scope

1. Author the receiver forgings, guard/FSB, barrel/muzzle, stock, grip, metal
   magazine and iron sights in Blender at explicit scale. Use shaped cross-
   sections and selective radii/weighted normals, not constant-depth slabs or
   blanket smoothing. Preserve real holes, rail geometry and supported joints.
2. Author **Idle, Fire, Last Shot, Tactical Reload, Empty Reload, Inspect, Draw
   and Holster**. Blender owns moving parts, weapon choreography and wrist/
   finger controls; existing shared arm skins and runtime upper/forearm IK,
   aiming, sway and reactive motion remain. Do not replace all weapon/arm rigs.
3. Introduce a small weapon-owned M4 loader/animation adapter using the existing
   committed-GLB pattern. Update rifle loading, prewarm, preview and procedural
   exporter exclusion; keep normal builds Blender-independent. Retire/replace
   legacy rifle integration only where its new authored equivalent is tested.
4. Keep shared events and other weapons intact. No runtime dependencies, new
   animation framework, global lighting changes, world changes or per-frame
   allocations. Shared pipeline edits are only the required authored-rifle hook.
5. Validate evaluated source **and exported GLB**, including assembly support,
   sight/rail and receiver/grip/stock seating, charging-handle/rear-sight
   clearance, bolt/cover/ejection motion, magazine fit, and hand contact through
   clips and midframes. Solve interference geometrically, not with avoidance
   animation. Distinguish intended pivots/enclosed parts from exposed collisions.
6. Add actual startup-rifle browser coverage: iron ADS/front-post alignment,
   firing/ejection/last-round state, both reloads, interrupts, inspect/equip,
   switching to other weapons/equipment and restart. Preserve existing smoke
   coverage; document any fixture migration instead of deleting assertions.
7. Compare matched reference cameras, assembled side/top/oblique views and
   gameplay before/after. Report geometry, file size, primitives/materials and
   matching-frame browser resource counts without calling lockstep time a GPU
   benchmark. Run clean install, smoke tests, lint, build, geometry checks,
   browser integration and boot capture. Keep PR draft for visual acceptance.

### Approved budget — same ceilings as the MCX

**Strictly fewer than 110,000 triangles**, at most **40 GLB primitives**, **16
materials**, **three 1024² maps**, **10 MiB GLB**. Count all shipped geometry,
including the spare magazine and cartridge/casing geometry, not only an active
pose. Aim materially below the ceilings and spend geometry on silhouette/radii;
bake microtexture rather than tessellating it. Shared arms are accounted for
separately as existing assets, not silently included/excluded in comparisons.

This is a new authored-rifle/hand-control migration, larger than the final MCX
source-only fixes. Scope stays in authoring, the weapon adapter, essential
pipeline integration and regression/evidence tools. Stop for discussion if it
requires broader rig changes, higher caps or a new runtime dependency.
