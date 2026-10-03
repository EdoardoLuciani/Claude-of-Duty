# Develop integration for the WebGPU migration

PR #316 remains draft. The migration was rebased onto `a33127d` (`develop`),
including the cache-beacon, EVOLYS reload-clearance and 3D grenade-aiming follow-up
that arrived during validation. The previous branch tip, `e756366`, is retained
locally as `backup/webgpu-pre-develop-rebase-e756366`. Historical benchmark and
image reports describe their recorded revisions, **not this new content base**.

## Preserved incoming behavior

- Live day/night clock, pause/death/restart behavior, sun/moon environment-rebake
  tracking, streetlight outages, flashlight and its actual occluding spotlight
  shadows. `develop` deliberately reduces moon illuminance from `.30` to `.03`
  and removes the old minimum moon-key intensity. Night is therefore darker;
  this integration does not counteract it with exposure or weapon multipliers.
- Blender-authored FN EVOLYS, including the latest belt/reload-clearance asset;
  cache placement, interaction, alarm and rewards, and the raised red HDR beacon.
- M4 sight revisions, absorbed sleeve-blood/roughness and near-full-health
  coverage semantics, ballistics, ragdoll attachments and height-aware grenade
  launches/clearance. Physics, AI agent/tuning, audio, authored assets and world
  generation/assets have no migration diff against this `develop` base.

## Native adaptations

- EVOLYS uses the shared physical node-material adapter, retaining authored
  factors/maps instead of restoring the old fixed-view-rig calibration. Its
  existing thin-alpha RMR lens remains; no extra transmission pass was added.
- Intel props use native standard/basic node materials. Their opaque geometry
  casts/receives shadows; beacon/LED materials remain unlit. Prewarming attaches
  a pooled prop temporarily and delegates to the renderer's actual-variant,
  zero-draw graph warmup, restoring parent/visibility even on failure.
- Flashlight shadow warmup is asynchronous through player/AI/render. The
  stand-in skinned caster remains attached until native shadow compilation is
  complete. The reported `skinnedShadowDraws` are shadow-caster callbacks during
  zero-range warmup, not rendered gameplay geometry. No WebGL shadow-map
  internals or fallback were introduced.
- Incoming sleeve-blood GLSL semantics were translated to TSL; its program key
  is `arm-blood-tsl-v2`. Physical arm factors and shared texture ownership remain.
- Day/night smoke/E2E expectations use native sun selection, the retained `.55`
  practical-light budget, actual shadow-camera draws, GPU occlusion readback and
  node-builder counts rather than WebGL program/depth-shader internals.
- `tests/e2e/native-render.mjs` verifies the actual backend/adapter and provides
  nonblank final-graph readback with HUD overlay for headless Vulkan captures.
  Offscreen capture changes fullscreen graph contexts. Intel's first-cache and
  opening compile assertions remain separate: after the intervening screenshot,
  one normal frame restores the production context before measuring opening.
  This excludes a capture-induced rebuild, not gameplay material compilation.
- Intel's smoke mock now checks native graph delegation and state restoration,
  rather than requiring three legacy `compileAsync` passes/scratch-target frees.

## Night-sky artifact found during visual review

The darker incoming night exposed a previously masked native star-cell lattice.
It was present in **raw world color**, without fog/TAA/final composition. Turning
night-sky contribution off removed it; restoring the old moon level merely hid
it. Neither is the production fix.

Generated WGSL showed shared airmass first assigned inside the second star
layer's `exist` conditional, then reused outside it for the whole night-sky
extinction. Empty cells therefore used its zero-initialized value. Shared band
and twinkle expressions also crossed conditional branches. `src/sky/stars.js`
now materializes equatorial direction, airmass, band and twinkle with public
TSL `.toVar()` at their common enclosing scope. No shader rewriting, dependency
patch, star removal, changed moon level or new artistic multiplier is involved.

`tools/sky-stars-check.mjs` renders RGBA32F with Milky Way gain zero. An independent
GPU eligibility mask selects cells without any of the three stars; CPU
Kasten–Young airmass/extinction plus authored airglow is the numerical oracle.
No CPU/GPU procedural-hash equality is assumed. On AMD/RDNA4/nonfallback:

| Variant | Analytic samples | Maximum absolute linear RGB error |
|---|---:|---:|
| No point-star branches | 16,384 | 3.2431e-10 |
| Point-star branches, repaired | 8,238 empty cells | 3.2418e-10 |
| Restored lazy expressions (negative) | 8,238 empty cells | 1.5843e-5 — fails |

Tolerance is `2e-8`; all sampled channels must be finite. The negative restores
all four lazy expressions through a guarded diagnostic source route. It fails
with `star-cell branches changed analytic airglow extinction`. This specifically
checks diffuse extinction across star branches, not full procedural-star or
Milky Way radiometric equivalence. Final 1080p hero/ADS/night captures were
repeated after the repair. This is separate from the still-unisolated road bands.

## Validation

All new GPU work used `MESA_VK_DEVICE_SELECT=1002:7550!`; actual adapter checks
reported AMD / RDNA4 / nonfallback. GPU jobs ran sequentially.

- Clean `npm ci` with the existing pinned Fresnel compensation; no additional
  dependency changes. Final smoke suite: **72 scripts**, including incoming
  cooked-collision/live-body grenade tests and EVOLYS clearance checks.
- `npm run lint`, `npm run build`, `npm run world:validate`, `git diff --check`.
- Native day/night E2E: clock lifecycle, powers/toggles without shader
  permutations, sun/moon CSM selection, flashlight full-world shadow pass,
  wall-blocked versus clear GPU illumination, skinned warmup and a live enemy
  entering the beam without new builders.
- EVOLYS and M4 gameplay E2Es: startup/shared arms, actual firing/ejection,
  reload and sight/ADS captures. EVOLYS was repeated after the latest asset.
- Intel E2E: drop/open/alarm/reward/cleanup/restart, first-cache and opening
  compilation assertions; repeated after the new beacon revision.
- Ballistics and three-variant ragdoll E2Es, including attachment alignment.
- Arm-blood damage/heal/cancel/restart/weapon/resource lifecycle; independent
  strict physical-material/Fresnel oracle and matrix.
- View-lighting/material checks on low/medium/high/ultra. The full day/night
  flashlight E2E is not claimed as a four-tier sweep.
- High/combat graph warmup/cache, prepass/AO, resize, light-cycle and haze-lifecycle
  regression runner. Star-oracle positive/negative and final 1080p stills.

Useful reproduction (from this worktree):

```sh
npm test && npm run lint && npm run build && npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/sky-stars-check.mjs
# Intentional failure:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/sky-stars-check.mjs --negative=1
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/day-night-e2e.mjs --out=/tmp/day-night
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/check-evolys-game.mjs --out=/tmp/evolys
MESA_VK_DEVICE_SELECT=1002:7550! SHOT_DIR=/tmp/intel node tests/e2e/intel-e2e.mjs
MESA_VK_DEVICE_SELECT=1002:7550! node tools/view-lighting-check.mjs --quality=high
```

Local evidence uses `/tmp/cod-rebase-*`: final static-gate logs, `day-night`,
`evolys-final`, `intel-final`, `m4`, `ballistics`, `ragdoll`, `blood`, `fresnel`,
`view*`, `graph.log`, star-oracle logs, and `final/webgpu-*.png` plus metadata.
The pre-rebase image reference is `/tmp/cod-view-light-after` at `e756366`.
Comparison sheets are qualitative: content, night tuning and startup RNG streams
changed; they are **not** matched-state image-error or performance experiments.

## Still separate

Road-band isolation, combat-input/glare isolation and the deliberate motion /
transition acceptance pass have not been completed by this rebase. Production
startup RNG ordering, startup responsiveness, historical exposure/medium-resize
fixtures, broad quality/motion acceptance and a fresh independent review remain
open. Fresh night E2E pages recorded 227 post-ready builders versus 9 on day
pages (these totals include offscreen-capture work). Night power/flashlight
variants had equal totals, and the separate live enemy-entering-beam check added
zero builders. This does **not** establish a hitch-free first day-to-night
handoff: the extra night builds remain a transition/startup gate, not a timing
result or something this report certifies harmless. No new performance result
or equal-quality legacy parity is claimed.
Keep the current authored-material/world-dependent-view-lighting direction and
retire the narrowly pinned Fresnel compensation only after a containing upstream
release has actually been verified.
