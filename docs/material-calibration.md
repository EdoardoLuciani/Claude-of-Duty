# Material calibration and rendering policies

Follow-up to #370. This is material fidelity/correctness work, not a performance
experiment or a claim that all finishes have measured physical optical constants.

## Ownership and units

- Native weapons preserve GLB base factors, metallic/roughness maps, normal scales
  and physical extensions. Pigment/finish edits belong in their Blender source;
  exposure and local incident-light budgets belong to render. No blanket loader
  darkening or specular suppression. Explicit view-pass optics remain exceptions.
- Player arms have one authoring path: `tools/blender/player_arms.py` and committed
  `public/models/player/arms.glb`. The loader preserves physical specular and maps.
  The old runtime 0.30 multiplier was already removed in #380. Procedural glove,
  pad, seam and sleeve recipes were unused and have now been removed.
- Hex colors and procedural `authoredColor()` constants are sRGB authoring values;
  they are decoded before linear shading. `new Color(r,g,b)` weapon recipe tints
  are linear multipliers, not final albedo. Read the exported textures when
  discussing reflectance, rather than treating Blender script tuples as linear.
- Dielectric base color supplies diffuse pigment; conductor base color supplies
  F0. At IOR 1.5, white specular color and metalness zero, F0 is
  `0.04 * specularIntensity`. A value of 0.11 means 0.0044, not 0.02. Fully metallic
  pixels ignore dielectric specularIntensity; darkening their color changes F0.
- Coated/anodized/phosphated finishes may use different single-layer approximations
  in different authored assets. Names alone do not establish measured metalness.
  Preserve the authored model unless a controlled finish comparison justifies an
  asset change. Do not silently force every conversion coating into one class.

## Changes in this pass

1. MPX/AX338 no longer multiply every color by 0.42 or force specularIntensity 0.12.
   MCX thin-alpha scope, MPX optical sheets/absorptive optic interior, and authored
   AX/EVOLYS lens opacity remain explicit sight-picture policies.
2. Vertex grime cannot activate rain runoff when weather.y is zero. The damp
   ground-band roughness adjustment also requires splash (weather.z), so cavity-only
   finishes cannot become wet near world ground. Positive rain/splash formulas
   remain; cavity grime stays independent.
3. Macro and macroBig use the selected surface projection space. Locally projected
   weapon color, roughness and wear/grime guidance no longer move through a world
   noise field. World projection remains world-anchored; environmental weather
   still uses world height/orientation. Existing variation amplitudes remain.
4. Bake cache keys include relief/worldSize. Soldier cache keys include AO, normal
   scale, rim and side; goggle tint variants no longer collide. Existing effective
   defaults and repeated requests still reuse materials and borrowed textures.
5. Glass no longer floors its already-linear pigment to 0.02. Its nominal clean
   authored tint decodes to approximately 0.0035/0.0039/0.0041; the old floor lifted
   it to neutral 0.02/0.02/0.02 before lighting. Other generators' artist-authored
   floors remain, rather than applying a blanket color-space rewrite.
6. Removed unused weapon-glass tint API and obsolete procedural arm recipes.
   Replaced historical pixel/exposure essays with concise finish rationale.
   All eleven retained procedural recipes have exactly unchanged numeric and
   linear Color values. Geometry masks/handling/animation were not retuned.

## Policies deliberately retained

- Current sleeve/glove pigment and exported specularFactor (~0.16). Decoded mean
  base RGB is approximately 0.0426/0.0521/0.0242 for ripstop, 0.0791/0.0844/0.0455
  for stitches, and 0.0126/0.0145/0.0155 for the charcoal glove. These are texture
  means before AO, blood, lighting and exposure, not a measured fabric reference.
- World indirect budget, camera-position key/sky visibility proxy, bounded 10%
  first-person readability fill, practical lights and exposure policy. The view
  pass does not acquire world per-fragment CSM or self-shadowing from receiveShadow.
- Soldier CLOTH_BUDGET, KIT_CAL (0.51), vertex hierarchy and post-lighting silhouette
  rim (up to 62% darkening). These are readability/art-direction policies, not
  neutral calibration references. Removing them needs combat visibility evidence.
- Authored dark window/interior backings, grenade finishes and single-layer coating
  approximations. Converting them to different physical models without comparative
  evidence would be another guessed retune, not a verified correction.
- Cloth backlight is explicitly an emissive orientation/AO approximation; it does
  not sample direct-light shadows. No new shadow hook or lighting framework is
  added here. Transparent window panes use IBL, not the opaque SSR surface prepass.

World palette comments still contain legacy reflectance/SSR wording. Correcting
those comments alone invalidates the hashed world-authoring manifest, so they are
not edited in this runtime pass. The units/policy above are the current contract;
update that wording with the next intentional world-source regeneration. No world,
prop, Blender GLB or procedural image asset bytes are changed by this PR.

## Validation and observations

[Raw readbacks, capture metadata and source hashes](https://gist.github.com/EdoardoLuciani/011236502d4dfb8e538cdecbe63792a5).
Before/after images are attached to the PR; source hashes identify the reviewed
runtime. The initial candidate was captured at dirty parent `031cb73`; the final
roughness correction is recaptured at dirty parent `5b82065`.

Hardware: nonfallback RX 9070 XT / RDNA4, native Chromium WebGPU. No GPU timing or
combat-performance measurement. Cross-vendor and comprehensive motion/content
coverage are not established.

- CPU smoke: real committed GLBs through all six production adapters; no global
  color/specular compensation, maps/factors retained, optical exceptions preserved.
  Soldier appearance variants distinguish caches; equivalent defaults reuse them.
- Native shader/readback probe: dry-runoff max RGB difference **0**, wet positive
  control **0.24452**. Local translation and rotation differences **0**; world
  positive control **0.22486** after translation. Bake relief/worldSize changes
  produce distinct texture sets and actual normal-map differences **0.05446** and
  **0.00655**. Inputs exaggerate signals to make these behavioural tests sensitive;
  they are not final-image quality metrics or optical measurements.
- Independent review found a pre-existing ground-band roughness leak. Reproduced
  with rigid vertical movement: flat cavity-only material drift **0.10000**, actual
  alu/polymer/steel **0.06600/0.06300/0.06600**, expected zero. After gating the band
  by splash, all four differences are **0**; enabled-splash control remains
  **0.13000**. The committed probe reads roughness as well as color.
- Five exact-match negative controls reinstate missing rain/splash gating,
  world-space macro coordinates, incomplete bake keys or the glass floor and must
  fail the corresponding assertion. Glass readback excludes cleared background.
- Before/after captures at 960x540: all seven weapons in the weapon shot, plus
  MPX/AX338/shotgun in hero/interior/night. All six authored weapons get an unlit
  posed base-color readback. MPX means change from 0.02058/0.02234/0.02453 to
  0.04899/0.05318/0.05839; AX from 0.00989/0.00901/0.00758 to
  0.02356/0.02146/0.01804, consistent with undoing the 0.42 scale.
- Key/visibility/readability/practical budgets are identical between runs. World
  exposure is intentionally still automatic: hero 3.23454 -> 3.23666 (~0.0655%),
  interior 4.90932 -> 4.90942, night 4.996003 -> 4.996007. Glass changes can affect
  world metering, so captures are not claimed bit-identical or matched HDR errors.
- MPX/AX are visibly brighter with authored reflectance; the captures retain dark
  indoor/night response and the sight-picture policies. No claim of universally
  improved appearance or physically measured coating response.

Reproduce from a clean install:

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs
# Each negative run must fail, after the mutation is installed and executed:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=rain
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=local
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=cache
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=glass
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=roughness
MESA_VK_DEVICE_SELECT=1002:7550! node tools/view-lighting-check.mjs --all-scenes=1 --out=/tmp/material-after
```

For baseline captures, use a detached worktree at develop `031cb73`, install cleanly
and copy **only** the updated `tools/view-lighting-check.mjs` into it. Run it with
`--all-scenes=1` and a different unused port/output directory. Never run competing
GPU probes or terminate another agent's renderer processes.
