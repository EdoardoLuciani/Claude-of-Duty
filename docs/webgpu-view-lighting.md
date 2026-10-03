# Native material consistency and world-dependent view lighting

**Implemented candidate, not appearance approval. PR #316 stays draft.**
This follows the [calibration audit](webgpu-weapon-calibration.md) at `0d9ada2`.
It fixes material-path consistency first, replaces the constant artificial rig,
and re-evaluates authored defaults under that policy. No exposure, tonemapper,
world-light budget, asset, gameplay, AI, animation or quality-preset retuning.
The pinned temporary [Fresnel compensation](webgpu-fresnel-compensation.md) remains.

## Material policy

`src/weapons/asset-material.js` preserves loaded physical/standard factors and
texture identities in a native physical node material. M4, P320 and MCX now enter
the same application indirect-light hook; they no longer depend on automatic
ordinary-material conversion that silently skipped that hook. Standard inputs
use standard-property copying into the physical default; physical inputs preserve
IOR, specular, clearcoat, transmission and other physical properties.

Removed post-load compensations:

- Arm Olive `.30` and other arm/glove `.80` base-color multipliers.
- M4/P320 `.42` base-color and `.12` dielectric specular overrides.
- MCX surface-dependent `.24/.42/.28` color, metalness and specular overrides.
- Bandage `.26` darkening, also explicitly inherited from the old view fill.
- Weapon ownership of the view-scene `.24` environment budget and the ineffective
  native per-material equivalent. The renderer now owns local view IBL.

Bandages use the same native adapter. Held grenade/radio **copies** are native as
well, with instance-owned materials disposed by the viewmodel. Their shared
world/preview template materials and textures are not patched or disposed by the
viewmodel. No AI/projectile material or geometry changes are hidden in that fix.
Blood coloration/roughness and texture ownership remain intact.

One explicit GLB artistic/rendering approximation remains: **MCX surface 11** uses
its established thin-alpha scope tint, opacity `.10`, roughness `.12`, dielectric
specular `.25`, metalness `0` and disabled depth writes. Transmission is explicitly
`0`: gameplay supplies the scope sight picture; this does not add another scene
transmission pass. It is not claimed to simulate the exported glass optically.
Other authored physical properties are preserved.

Procedural weapon material recipes are still their authored finishes, not new
post-load compensations. Historical exposure/pixel notes in `materials.js` are
marked historical, not evidence of current physical calibration. There are no
new per-gun or per-arm darkening factors.

## Lighting policy and deliberately limited approximations

`src/render/view-lighting.js` owns the named policy constants:

1. **World-directed key:** copies active sun/moon color, intensity and direction.
   A static-collision `SIGHT` ray from the camera estimates key visibility; it does
   not rotate with the camera. Visibility settles with an `.08 s` time constant.
2. **Local sky visibility:** 12 deterministic world-space hemisphere rays, cached
   only for identical camera position and static-world identity/version. Turning
   alone does not reorient the probe. The open fraction maps to `.035..1`;
   `.035` is an explicit coarse unmodelled-bounce floor borrowed from the world
   indoor-fill policy, not an absolute light floor or a measured irradiance.
   It gates view diffuse fill, diffuse IBL, specular IBL and clearcoat radiance.
3. **World practicals:** two stable point-light proxies selected by incident RGB
   strength at the camera, using native punctual attenuation. Positions, colors,
   intensities, ranges and decay come from authored world lights. Their current
   unshadowed policy is preserved; a future shadow-casting source also gets a
   visibility ray. FX lights are excluded: they already have view proxies.
4. **Camera-relative readability:** one directional fill at **10% of estimated
   local incident RGB** (visible key + visibility-scaled authored sky fill +
   selected practicals). This is an explicit modest artistic budget, not a
   measured physical bounce or a fitted legacy-image multiplier. There is no
   constant night headlight. Ten percent bounds this input budget, **not its
   percentage of every pixel's final brightness**.

The fixed warm key/hemi/rim trio is gone. Scene environment intensity follows
the world; the shared sky PMREM stays in world coordinates. The old view-only
`.45` custom-fill multiplier is gone. Genuine world lighting still changes on a
turn. Only the deliberately artificial readability direction follows the camera.

FX's existing relative flash-strength calculation now consumes `viewLightLevel`,
the maximum RGB channel of the estimated local incident budget. Using only the
new sun key would make flashes depend on a fully occluded sun inside a room lit
by practicals. Flash lifetime, shape, pool, falloff and strength formula are not
retuned. This is **not** a reapplication of the rejected FX upload experiment.

The proxy lights retain their identities, visibility and non-shadow-casting
state. No new GPU pass/target, self-shadow map, world-depth sharing or MSAA. The
partial-alpha, non-MSAA view target remains separate from world depth/history/fog.
Scratch vectors and sky directions are allocated once. Smoothing advances at most
once per simulation frame, including during render-only probes and warmup.

These are approximations, not full world/view lighting equivalence: camera-point
collision visibility is not per-fragment CSM, transparent/rendered geometry can
differ from collision geometry, the hemisphere is coarse, body/self-shadowing and
true local GI are absent, and selecting two practicals can change contributions
when crossing a selection boundary. Unshadowed practicals retain world light
leakage rather than adding inconsistent view-only wall shadows. Broad motion and
human appearance acceptance remain necessary.

## Frozen indirect-uniform correctness

The custom `setupEnvironment()` hook is not a material node property observed by
Three's `NodeMaterialObserver`. An unchanged rigid mesh can receive only shared
refreshes. The changing sky, ground, sun direction, diffuse-IBL scale and view
visibility now use the **public native `renderGroup`**, not object uniforms.
No identity `colorNode`, dependency modification, copied BRDF or forced per-mesh
refresh is used. The immutable room group and retained CSM caching stay intact.

A completely frozen M4, arms hidden, no direct/IBL contributions, changes only
custom-fill RGB. Summed linear HDR channels at 960×540:

| Input | R | G | B |
|---|---:|---:|---:|
| zero | 0 | 0 | 0 |
| red | 53.846425 | 0 | 0 |
| green | 0 | 60.031243 | 0 |
| zero again | 0 | 0 | 0 |

Simulation frame/time and sampled engine RNG do not advance. Routing the five
uniforms back into `objectGroup` intentionally fails with
`rigid custom fill stayed stale`. This validates the specific refresh defect,
not every possible material update in moving gameplay.

## Re-evaluation of authored defaults

The candidate does **not** reproduce the old constant illumination. Seven fresh
1080p high-quality before/after shots show:

- Direct-sun M4, P320 and especially MCX surfaces are much brighter, often grey/
  silver-looking. The cloth is lighter olive. These are substantial appearance
  changes, **not an approved restoration of visual identity**.
- Interior/night arms and guns are darker and respond to local warm practicals
  instead of the same warm rig used outdoors. The existing exposure cap/night
  readability questions have not been solved by this change.
- ADS/reload, muzzle and combat captures are included; road banding and broader
  combat/world glare are not diagnosed or repaired here.

An unlit RGBA32F probe of posed opaque weapon pixels, **arms hidden**, gives mean
base RGB below. No light, exposure or tone mapping; alpha must exceed `.99`.
This is one pose/LOD-weighted base-color diagnostic, not full-asset reflectance or
an exact mask of what remains visible behind the arms in the final image.

| Weapon | Linear base RGB mean |
|---|---|
| M4 | `.053061, .051862, .052061` |
| P320 | `.030862, .033133, .035062` |
| MCX | `.078784, .084932, .092511` |

The bright lit result is not a loader simply replacing those pigments with white.
For metallic texels, base color controls metal F0, not diffuse albedo. Preserving
these authored inputs is a defensible **provisional baseline**, not certification
that the finishes are physically measured or that this complete lighting/exposure
system is artistically satisfactory. No evidence here justifies reinstating the
old exact multipliers. Further finish/world-light/exposure-budget review should
make any art adjustment explicit, rather than hide it in another loader scalar.

A separate unaligned, sequential-page policy check records these local budgets
(the figures are inputs, not display brightness or matched-pose image ratios):

| Scene | World key | View key | Sky visibility | Readability incident RGB |
|---|---:|---:|---:|---|
| Hero | 6.6900 | 6.6900 | .67833 | `.69904, .61381, .52673` |
| Interior | 6.6702 | ~0 | .03500 | `.04965, .02800, .01444` |
| Night | .09714 | .09714 | .67833 | `.02231, .01962, .02243` |

The interior has two unshadowed practicals with estimated incident strengths
`.39987` and `.08132`; night uses the world's increased practical intensities.

## Validation and timing

Actual GPU in every new run: **AMD/RDNA4, non-fallback RX 9070 XT**. No iGPU runs.

- 61 smoke scripts; lint, build, committed-world validation and diff whitespace checks.
- Native policy suite: all seven weapons, high/medium/low/ultra; eligible active
  materials enter the indirect hook, physical properties/arm colors preserved,
  light budgets/frames, stable identities, transparent view corner and samples 0.
- Deliberate stale-uniform negative fails the intended guard.
- Physical/Fresnel oracle and material matrix still pass on the installed,
  compensated Three 0.186.1. The adapter probe now uses authored base color;
  `.30` remains only an explicitly identified historical unlit control.
- Arm-blood E2E: damage, partial/cancel/interrupted/full healing, caps, respawn,
  restart, all seven weapons, pistol reload/MCX ADS and stable effect resources.
- High/combat prepass, AO, resize, light cycle, haze lifecycle, actual-variant
  graph warmup and cache checks; moving-camera reload; normal HUD capture.
- Matched 1080p hero/interior/night/ADS/reload/muzzle/combat before/after: sampled
  frame/time/camera/quaternion/FOV/clip/time/mag equal, no GPU/browser errors.
  Both sides use the visual harness's diagnostic startup RNG reservation. It is
  **not a production RNG repair** or complete transient/history equality. Async
  meter differences remain: hero `3.33381→3.34751`, ADS `4.99646→4.99882`, reload
  `4.49425→4.50700`; interior/night/combat 5 and muzzle `4.41564` match.

Three sequential ordinary-AI, moving/firing 1920×1080 pairs, 600 samples each,
plain timers, baseline `0d9ada2` versus this candidate, without RNG alignment:

| Pair | Before ms/frame | After ms/frame | Before p95/p99 | After p95/p99 |
|---|---:|---:|---|---|
| 1 | 13.056 | 13.075 | 15.1 / 17.9 | 15.4 / 24.1 |
| 2 | 12.888 | 12.641 | 15.1 / 17.2 | 14.7 / 17.4 |
| 3 | 12.895 | 13.005 | 15.0 / 18.5 | 17.3 / 18.7 |

Aggregate **12.947→12.907 ms/frame (~0.3% lower)**: effectively tied, **not a
performance win**. Tails are mixed/worse, not certified harmless. All pairs have
zero late builders/errors and equal sampled initial/final gameplay state; this
is not full event/trajectory equivalence. No GPU timestamp/DVFS or startup gain
claim. The image changed materially, so this is not equal-quality benchmarking.

PR remains draft. These checks do not close global exposure/readability,
self-shadow/local-GI limitations, unscripted/motion/human approval, newest-develop
integration, startup responsiveness or all historical fixture failures. No new
independent review is claimed.

## Reproduce / artifacts

```sh
npm test && npm run lint && npm run build
MESA_VK_DEVICE_SELECT=1002:7550! node tools/view-lighting-check.mjs \
  --out=/tmp/cod-view-light-final
# Repeat with --quality=low, medium, ultra.
# Intentional failure:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/view-lighting-check.mjs \
  --stale-indirect=1 --out=/tmp/cod-view-light-negative
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs \
  --strict=1 --out=/tmp/cod-view-light-fresnel
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/arm-blood-e2e.mjs \
  --out=/tmp/cod-view-light-blood
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --shots=hero,interior,night,ads,reload,muzzle,combat \
  --out=/tmp/cod-view-light-after
```

Artifacts are machine-local under `/tmp/cod-view-light-*`: `final/report.json`,
`{low,medium,ultra}/report.json`, `after/webgpu.json` and PNGs,
`before/`, `before-actions/`, `before-fx/`, `blood/`, `fresnel/`,
`perf-{before,after}{,-2,-3}.json` and corresponding logs. Captures were made from
the candidate working tree before commit, so its revision metadata still names
parent `0d9ada2`; before captures use the unchanged parent. Later baseline runs
use the detached `/tmp/cod-view-light-baseline` worktree at that parent.

`environment.png`, `actions.png`, `weapons.png` contact sheets are for review,
not quantitative full-resolution comparisons. The first two pair baseline/candidate;
the seven-weapon sheet shows only the candidate. The historical calibration tool
now refuses this different rig and directs callers to the current policy check.
