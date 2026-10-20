# Material ownership and rendering policies

## Authored finishes and units

Weapons preserve GLB base factors, maps, normal scales and physical extensions;
pigment/finish edits belong in Blender, exposure/light budgets in render.
No blanket loader darkening/specular suppression. Arms have one source:
`tools/blender/player_arms.py` and the committed arm GLB, not procedural recipes.

Hex/`authoredColor()` values are sRGB and decoded before shading.
`new Color(r,g,b)` recipe tints are linear multipliers, not final albedo.
Dielectric base color is diffuse pigment; conductor color is F0. At IOR 1.5,
white specular and metalness zero, F0 = `0.04 * specularIntensity`; metallic
pixels ignore that factor. Coating names don't establish measured metalness.
Preserve the authored approximation unless controlled evidence justifies a change.

## Copy, clone and ownership

Use the pinned native `NodeMaterial.copy()`, not borrowed classic prototypes.
Weapons force physical nodes; arms retain standard/physical source selection.
Maps stay borrowed; colors/vectors, definitions, iridescence ranges and clipping
planes must retain their value ownership. Disposal must not destroy input maps.

Soldier output subclasses native `setupOutput()` and calls super before fog/alpha.
Declarative `rimNode` survives copy/clone and distinguishes shader cache keys;
`outputNode` is not equivalent because it runs after that boundary.
Skinned cloth/goggles remain FULL-refresh independently of declarative nodes.
Runtime soldiers use one opaque material per variant: existing equal-size bakes
are texture-array layers, with repeat/mips/anisotropy retained. A flat surface ID
selects immutable tint/roughness/metalness/AO/detail parameters; GLB groups remain
authoring labels, not separate draws. Goggle pigment, smoothness and half rim remain;
the former 1.4 environment gain uses the shared material's default 1.0 instead.
Clones must be registered with their render owner: the per-instance environment
hook isn't copied. `IndirectFill` calls upstream environment setup first; keep
camera-specific world/view identities, PMREM and shared render uniform groups.

## Procedural and readability policies

- Rain runoff requires weather.y; damp ground-band roughness requires weather.z.
  Cavity grime alone cannot wet a surface.
- Macro/wear noise uses the selected projection space; local finishes travel
  with the object. Environmental weather still uses world height/orientation.
- Bake keys include relief/worldSize. Soldier keys include AO, normal scale,
  rim/side and goggle tint; equivalent effective defaults still reuse resources.
- Preserve dark linear glass pigment; no blanket 0.02 floor.
- MCX thin-alpha scope, MPX optical sheets/absorptive interior and AX/EVOLYS lens
  opacity are explicit sight-picture exceptions, not measured optical constants.
- Keep exported arm specular, world indirect/practical/exposure budgets, bounded
  10% first-person readability fill and soldier KIT_CAL/rim hierarchy.
  Cloth backlight is emissive orientation/AO approximation, not direct-shadow
  sampling. Transparent windows use IBL for environment reflections.

## Validation

```sh
node tools/material-calibration-check.mjs
# Each mutation must execute and fail its named pixel assertion:
node tools/material-calibration-check.mjs --negative=rain
node tools/material-calibration-check.mjs --negative=roughness
node tools/material-calibration-check.mjs --negative=local
node tools/material-calibration-check.mjs --negative=cache
node tools/material-calibration-check.mjs --negative=glass
node tools/material-calibration-check.mjs --negative=rim
node tools/material-calibration-check.mjs --negative=clone
node tools/material-calibration-check.mjs --negative=skin
node tools/material-calibration-check.mjs --negative=factors
node tools/material-calibration-check.mjs --negative=normal
node tools/material-calibration-check.mjs --negative=mask
node tools/quad-bake-check.mjs
node tools/view-lighting-check.mjs --all-scenes=1 --exposure=4
```

CPU tests load actual arm/six-weapon GLBs, check copy/cache/borrowed ownership,
and preserve procedural bake bytes/RNG/disposal. Native probes read shader
channels, clone/fog/alpha/skinned behavior and independent environment contexts.
These gates aren't final human visual approval or combat-performance evidence.
Historical captures and measurements:
[#386](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/386),
[#389](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/389),
[#390](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/390).
