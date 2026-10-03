# Weapon/arm calibration audit

Status: **diagnosis and controlled alternatives, not an approved retune**. Runtime
baseline `ed32c7a`; no production material, light, exposure, asset, gameplay or
quality setting changes in this audit. PR #316 remains draft. The preceding
[physical-material/Fresnel corrections](webgpu-fresnel-compensation.md) are active.
The user reports that the upstream Fresnel fix has merged; this audit still uses
the compensated 0.186.1 release, not an unreleased upstream build.

Follow-up: [world-dependent view lighting](webgpu-view-lighting.md) implements
native material consistency and replaces this fixed rig. The findings below
are historical, not a description of that candidate. Run this old audit at
`0d9ada2`; current runtime validation is `tools/view-lighting-check.mjs`.

## Conclusions

1. The arm/M4 color multipliers are substantial, selective **art overrides**, not
   sRGB conversions, unit conversions, or requirements of HDR rendering. Their
   comments explain their original purpose but do not establish their numerical
   correctness for the current lighting.
2. The native view rig is neither a camera-relative studio rig nor a faithful
   world-light rig: its warm lights stay fixed in world space and do not track
   the world's changing key intensity/color/direction. This needs resolving
   before choosing new material darkening factors.
3. The lighting/material path is not even uniform across weapons: P320 and MCX
   still use ordinary physical materials and cannot enter the application's
   native indirect-light hook. Three's automatic native conversion lets them
   render, but does not install that application hook.
4. Restoring authored base colors improves some material visibility, but is not
   by itself a satisfactory day/night/interior calibration. The controls are
   alternatives to inspect, not an approved new appearance.
5. Neither the legacy image nor the authored asset is a measured real-world
   reflectance reference. The asset is the content contract; deliberate changes
   to it need an explicit art target rather than an unexplained loader multiplier.

## Method and independent reference

`tools/weapon-calibration-audit.mjs` runs only on the required RX 9070 XT, checking
actual `renderer.backend.device.adapterInfo` (`amd`, `rdna-4`, nonfallback).
Three fresh browser pages capture hero/interior/night at 1280×720, DPR 1, high.
The pose is frozen at frame 183 / 3.05 s after 180 settling frames. Exposure is
held at each shot's settled value: **3.271791 / 5 / 5**, respectively. No legacy
RNG alignment is applied. Recorded simulation time, camera, clip and five RNG
stream snapshots are restored/unchanged within each run.

The tool:

- Parses the committed GLBs and their embedded PNGs. Base-color samples are
  decoded from sRGB, then multiplied by the glTF **linear** base-color factor;
  packed roughness/metalness channels remain linear. These are full-texture
  means, **not geometry/UV-weighted means**. In particular, atlas padding makes
  a full-atlas average unsuitable as a claim about the P320's visible albedo.
- Uses the actual posed/skinned arm and M4 geometry/materials in an isolated
  RGBA32F view render. Categorical masks select sleeve/glove/weapon interiors,
  excluding samples near mask boundaries. Statistics are linear Rec.709-weighted
  RGB means, not display code values or perceived-brightness scores.
- Isolates key, rim, hemisphere, environment and custom diffuse fill. Their sums
  reconstruct baseline means within `1e-8`; lights/environment/fill all disabled
  produce zero. Restored baseline means repeat exactly.
- Tests four yaw angles with the camera and viewmodel moving together. A
  camera-locked diagnostic rotates only the artificial directional rig while
  retaining its initial camera-relative orientation. Indirect lighting is off
  for this comparison: genuine environment variation is not mistaken for an
  orientation defect.
- Replaces illumination with a constant-white environment, environment intensity
  1, no direct/hemisphere/custom fill and no diffuse-IBL trim. A separate
  zero-specular 18%-gray physical card returns **0.17973633** in all channels
  (absolute error `0.00026367`, within the `0.0005` PMREM reference tolerance).
  Neutral images use only linear-to-sRGB encoding over an 18%-gray background;
  they have no exposure, AgX, LUT, bloom or world rendering.
- Captures final-frame controls through the normal game post-processing graph,
  with unchanged exposure/world lighting. These extra renders advance world
  history without advancing simulation; they are not an identical-history
  world-image decomposition. Quantitative material comparisons use the isolated
  view buffers, which have no world TAA/fog.

There are **26 measurements per scene / 78 total**, plus gray-card probes and
27 full-resolution PNGs. No GPU errors were reported. This is not a performance,
unscripted motion, seven-weapon visual acceptance or human approval result.
An initial undersized 8×4 white-environment fixture returned black and failed the
gray-card assertion; it was rejected, not used as calibration evidence. The
reported reference uses the 512×256 environment described by the committed tool.

### Necessary frozen-pose observation control

An initial ablation retained the preceding custom diffuse-fill contribution on
unchanged rigid M4 geometry. Its first direct-only mean was `0.00558354`, rather
than the component sum `0.00535608`: the difference was precisely the previous
fill mean, `0.000227464`. Arms updated correctly. Extra render-only frames and
`material.needsUpdate` alone did not remove it.

The pinned `NodeMaterialObserver.containsNode()` scans material node properties,
not a custom `setupEnvironment()` function; `hasAnimation` separately recognizes
skinned meshes. Its `needsRefresh()` uses these flags for full updates. A
**diagnostic-only identity** `colorNode = materialColor` on rigid materials makes
the custom uniforms refresh. The complete baseline RGBA32F buffer before/after
this identity control is **bit-exact in all three scenes**, and component sums
then pass. The node properties are restored before disposal.

`--no-observer=1` deliberately omits that control and fails:

```
AssertionError: direct-light components do not reconstruct; check rigid-material uniform refresh
```

This establishes a paused-pose update hazard for the application's custom hook.
It does **not** establish that ordinary moving gameplay retains that error, nor
justify adding identity nodes to every shipping material without checking update
policy and performance. It is also separate from the upstream Fresnel defect.

## 1. What the material overrides actually do

| Surface/path | Runtime override | Meaning |
|---|---|---|
| Olive arm materials | base color × `.30` | removes 70% of linear base reflectance; −1.74 stops on the diffuse parameter, not the whole image |
| Other arm materials | base color × `.80` | removes 20%; −0.32 stops on that parameter |
| M4 and P320 | base color × `.42` | removes 58%; −1.25 stops on the base-color parameter |
| M4 and P320 | specular intensity `.12` | changes the dielectric reflectance model, not exposure |
| MCX selected coated surfaces | base color × `.24`, metalness `0`, specular `.12` | material-model changes as well as darkening |
| MCX other selected surfaces | base color × `.42` or `.28`, metalness overrides `.4` / `.9` | further per-surface art overrides; glass has a separate explicit thin-lens approximation |

The arm `.30/.80` values predate the migration (`8eedc18`); M4's `.42/.12` came
from `6fd6c09`. In particular, the arm override was **not introduced to fix the
native Fresnel defect**. It was inherited from the old view-light calibration.
See [the sleeve audit](webgpu-sleeve-material-audit.md) for its independent
texture/color-space and specular-contract checks.

### Concrete asset values

The committed `Olive_ripstop` texture's full-texel mean linear RGB is
`[0.042597, 0.052128, 0.024170]`, luminance `0.048083`.
After the loader's `.30`, it becomes
`[0.012779, 0.015638, 0.007251]`, luminance `0.014425`.
That is already a dark authored olive, made much darker in the loader. Its
roughness mean is `0.8849`; metalness is zero throughout. The authored specular
factor remains approximately `.16` after the preceding permanent repair.

The M4 receiver's mean base color is
`[0.033163, 0.038017, 0.042870]`; `.42` reduces it to
`[0.013929, 0.015967, 0.018005]`. Its packed metalness is **1 at every texel**, and
its mean roughness is `0.6210`. For that fully metallic surface, base color sets
normal-incidence specular reflectance rather than a diffuse albedo. Darkening it
therefore directly suppresses metal reflection. Calling this only an exposure
adjustment obscures a material-model change.

There is no duplicate-color-factor defect established here: `tools/blender/m4a1.py`
explicitly multiplies a near-white microtexture by the chosen material color and
multiplies the roughness texture by its factor. The glTF factors/maps represent
that authoring graph.

The M4 has no authored specular extension, so its dielectric default is F0 `.04`
for IOR 1.5. Runtime specular `.12` makes that `.0048` (0.48%). It does **not** dim
fully metallic parts: glTF's metalness blend bypasses the dielectric specular
weight there. Consequently, increasing this value cannot be a general repair
for a dark metallic receiver; it mainly changes polymer/rubber/marking response.
It also changes grazing behavior, so base-color and specular overrides are not
interchangeable brightness controls.

MCX treats selected anodized/coated surfaces as dielectric; M4 calls comparable
surfaces fully metallic. That is an inconsistent authoring/runtime policy worth
reviewing, not proof that every M4 metal value should be set to zero. Coated-metal
appearance needs an explicit material decision/reference.

### GPU effect of removing only base-color overrides

The physical specular settings, maps, roughness, lights and exposure stay fixed.
These are posed-view means, not whole-frame brightness or the scalar multiplier
itself:

| Hero view group | Current linear mean | Authored base colors | Ratio |
|---|---:|---:|---:|
| Sleeve | .007464 | .022080 | 2.96× |
| Glove | .005379 | .006382 | 1.19× |
| M4 | .008072 | .014962 | 1.85× |

Under the neutral-white environment, sleeve mean changes `.017549 → .050562`
and M4 `.032816 → .056183`. Restoring only the M4 dielectric specular default,
while keeping `.42` base colors, changes the hero M4 mean `.008072 → .011342`
(**1.41×**). These differing ratios are why a single exposure multiplier is not
equivalent to restoring authored material parameters.

## 2. The view-light rig is the larger calibration-policy problem

`src/render/index-webgpu.js` constructs:

- Key: `0xffe8c4`, intensity **2.2**, position `(-.45, .75, .55)`.
- Hemisphere: `0x8fb6ff / 0x36302a`, intensity **.35**.
- Rim: `0xffd7a8`, intensity **.9**, position `(.2, .35, -.9)`.

The camera/weapon anchor rotates and translates; these lights do not. Their
intensity and color also stay constant across the tested day/night scenes.
They do not cast shadows. `receiveShadow = true` on a weapon does not connect it
to the world's CSM when its separate scene contains no corresponding shadowed
light. The view indirect hook intentionally bypasses the world's coarse room
gate. Thus there is no local room-occlusion response in this rig, although the
shared sky/environment and global exposure still vary.

The old renderer had a camera-relative rig and shaped its level/color from the
world light. That proves a migration policy difference, not that its five-light
budget or gamma shaping should simply be copied back.

### Turning while holding geometry fixed in camera space

Four yaw angles, direct rig only, hero pose:

| Group | Fixed world-space rig max/min | Camera-locked control max/min |
|---|---:|---:|
| Sleeve | 1.662× | 1.00003× |
| Glove | 1.701× | 1.00005× |
| M4 | 2.599× | 1.00125× |

The small residual is not bit-exact rotational invariance; normal/rasterization
precision affects the weapon more than the sleeve. The significant fixed-rig
variation cannot be corrected for all headings by one base-color multiplier.
Real world-light/environment variation with heading is valid: the defect is an
unconnected artificial rig, **not a requirement that weapons never change
brightness when turning**.

A separate translation-only diagnostic, preserving orientation, leaves the
sleeve mean effectively unchanged and changes hero M4 mean by about 0.18%, not a
room-sized lighting response. This is a view-only test, not a physical room
irradiance measurement. The lack of room gating/shadowed view lights is also
explicit in the source.

### Day/night budget

The sampled world key falls from **6.69004 to .09714** (about **68.9× lower**).
The three artificial view lights do not fall at all. Their isolated pixel means
are identical between hero and night.

| Contribution | Day sleeve | Night sleeve | Day M4 | Night M4 |
|---|---:|---:|---:|---:|
| Artificial key + rim + hemisphere | 78.4% | 97.3% | 66.4% | 97.9% |
| Environment IBL | 3.3% | 0.15% | 30.8% | 1.6% |
| Custom sky/ground diffuse fill | 18.3% | 2.5% | 2.8% | 0.5% |

These are fractions of the measured linear masked means, not global energy or
quality percentages. With the actual settled exposure included, night sleeve
mean is **1.23× its daylight pre-tonemap value**, and M4 **1.04×**. This does not
mean their displayed/perceived brightness has those ratios, but it explains why
removing darkening alone can make the first-person model look too prominent at
night while the environment remains dark.

The final-frame camera-relative control uses the literal rig directions in
camera coordinates, retaining its current intensities/colors. The combined
control also restores base colors. Neither solves day/night level coupling,
room illumination, or the world's exposure cap; they are not proposed final
settings.

## 3. Environment controls and differing native material paths

`ENV_OCCLUSION = .24` is applied to `viewScene.environmentIntensity`. The native
`MaterialProperties.materialEnvIntensity` chooses **material** intensity only
when `material.envMap` is assigned; otherwise it chooses **scene** intensity.
Per-material `.envMapIntensity` values are therefore not independent calibration
controls for materials using only the scene environment. This behavior is
explicit in the engine, not a newly discovered native color-space defect.

On hooked view materials, diffuse IBL is additionally scaled by `.030` in the
hero case and `.066` at night; specular IBL is not given that trim. Daytime
`.24 × .030 = .0072` applies to that diffuse-IBL contribution, **not** to the whole
material. Added sky/ground fill is separate and has its own `.45` view factor.
Do not multiply all these numbers together and call the result weapon exposure.

The runtime material census also found:

| Weapon | Scene material objects | Eligible for `IndirectFill.patch()` |
|---|---|---:|
| M4 | 11 `MeshPhysicalNodeMaterial` | 11; all patched in the active shot |
| P320 | 4 `MeshPhysicalMaterial` | **0** |
| MCX | 13 `MeshPhysicalMaterial` | **0** |
| Procedural weapons | native physical/basic node materials | physical nodes eligible; basic nodes intentionally not |

`IndirectFill.patch()` requires `isMeshStandardNodeMaterial`. P320/MCX loaders
construct ordinary physical materials. Three's later `NodeLibrary.fromMaterial()`
conversion does not invoke the application's patch function, so the custom
fill/diffuse trim is missing on those paths. Inactive procedural materials are
not called defective merely because they are not yet patched: they are eligible
when traversed while visible. The census/source gate establish the P320/MCX path
difference; this audit does **not** quantify its final-frame impact on those guns.
Their native conversion/lighting consistency should be repaired before claiming
one shared weapon calibration.

## Recommended order, not yet implemented

1. Make the P320/MCX material paths consistently native while preserving authored
   properties and consciously retained surface overrides. Check the custom-hook
   update policy separately; do not ship the diagnostic identity-node workaround
   as an unmeasured universal fix.
2. Define the view-light policy: world-dependent key/environment plus a limited,
   deliberate camera-relative readability fill. Day/night level/color and room
   response need explicit tests. Do not rotate the actual world's lighting with
   the camera or blindly import the entire legacy rig.
3. Re-evaluate the authored base colors/specular defaults under that policy.
   Prefer preserving them; any retained artistic correction should be named,
   documented and tied to reference captures rather than hidden in each loader.
   Neither new scalar values nor wholesale removal of all overrides are approved
   by these measurements alone.
4. Check ADS, reload/motion, other weapons, quality tiers, interiors, night,
   exposure/bloom and human appearance before accepting the result. Road bands,
   combat glare, startup RNG/readiness and the broader migration gates remain
   separate outstanding issues.

## Reproduction and artifacts

From the migration worktree, with the pinned compensated install:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/weapon-calibration-audit.mjs \
  --out=/tmp/cod-weapon-calibration

# Intentional negative; must fail component reconstruction.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/weapon-calibration-audit.mjs \
  --shots=hero --no-observer=1 --out=/tmp/cod-weapon-calibration-negative
```

Outputs include `assets.json`, `{hero,interior,night}.json`, and nine PNGs per
scene: current, sleeve-base, weapon-base, all-base, weapon-specular,
camera-relative, camera-relative-base, neutral-current and neutral-base.
Local presentation sheets `controls-sheet.png` and `neutral-specular-sheet.png`
are downscaled/cropped illustrations; measurements use the full-resolution HDR
buffers. Validation also passed all **60 smoke tests**, lint, build, diff checks,
and the existing strict native arm/Fresnel GPU audit after the shared fixture
export change. The intentional observer negative failed at the expected guard.
The native gameplay backend and non-MSAA separate weapon composition
are unchanged. No new independent review or performance improvement is claimed.
