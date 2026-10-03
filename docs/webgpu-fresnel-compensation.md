# TEMPORARY COMPENSATION: native Three.js Fresnel F90

**Status: resolved locally with an explicitly temporary dependency compensation.**
The separate sleeve material-conversion defect is fixed normally in application
code. Upstream release availability is tracked by the user; no upstream PR,
publication, merge or dependency-version upgrade is part of this change.

The independent diagnosis/specification and original evidence are in
[the sleeve material audit](webgpu-sleeve-material-audit.md). This is not an
exposure, tint or saturation adjustment, and not full visual-parity acceptance.

Follow-up: the user reports the upstream fix has merged, but a containing release
is not yet available. Keep this compensation until a release is validated; do
not remove the permanent material adapter. The separate
[weapon/arm calibration audit](webgpu-weapon-calibration.md) investigates the
then-remaining material overrides and view-light policy without retuning production.
The later [view-light implementation](webgpu-view-lighting.md) removes those loader
compensations separately; it does not remove or change this dependency compensation.

## Small implementation

`tools/compensate-three-fresnel.mjs` runs from `package.json`'s `postinstall`.
For **exactly Three.js 0.186.1**, it changes the regular and retroreflective
direct-light GGX arguments from `f90: 1` to the already-computed
`f90: specularF90`. It covers the source module and both distributed WebGPU
bundles. No BRDF implementation is copied into our application; no runtime
monkey patch, generated-WGSL rewriting, extra render pass or new dependency.

The 33-line script:

- Checks the exact version and SHA-256 of each pristine file (or its exact
  already-compensated equivalent).
- Requires exactly two original or two compensated occurrences per file.
- Validates **all files before writing any**; rejects partial or unrelated edits.
- Is idempotent, prints an explicit TEMP compensation notice, and clears stale
  Vite optimized dependencies only when files actually change.
- Fails closed on dependency upgrades. Do not simply weaken the guard to make
  an upgraded package install.

`npm ci` installs the compensation automatically. If lifecycle scripts were
intentionally disabled, run `npm run postinstall` before using this branch.
The smoke test also rejects an uncompensated installation. Package-lock changes
are limited to the root install-hook metadata; dependency versions/integrities
are unchanged. Package manifests remain human-review-required files.

`src/weapons/arm-asset.js::createArmMaterial()` now preserves the loaded physical
material type and copies physical properties, including the authored specular
strength. Standard materials still receive a standard node material. This is a
permanent application correctness fix, **not** part of the temporary compensation.
Owned texture sharing/disposal and blood decoration remain intact.

The existing olive/glove multipliers, M4 overrides, view lights, exposure,
quality settings, assets, AI and RNG behavior are not changed here. In particular,
this does not endorse `.30` as physically calibrated or fix the missing startup
RNG reservation.

## Validation

All new GPU runs use the RX 9070 XT, with actual renderer/device checks.

- A clean **`npm ci`** invokes the hook successfully; installation idempotence,
  version mismatch, unexpected file content and partially applied changes are
  covered by `tests/smoke/smoke-fresnel-compensation.mjs`. Invalid inputs leave
  earlier files untouched. Source and both distributed bundles are checked.
- The GPU fixture uses the **actual application arm converter**, not a duplicate
  conversion implementation. The adapter's textured fixture statistics equal
  the direct physical-material copy exactly. Its Three.js imports resolve together through
  `tools/arm-material-fixture.js` to avoid duplicate TSL module stacks.
- Independent zero-specular diffuse oracle: three angles × retroreflection
  disabled/enabled = **6 cases**, all pass. Maximum linear error **7.16e-9**.
- Reverting both F90 arguments in browser responses makes that oracle fail.
  Reverting **only the retroreflection argument** also fails. Both negatives
  fail specifically with `zero-specular material is not pure Lambert diffuse`.
- **108 cases** compare legacy and compensated native: specular strengths
  0/.16/1, metallic values 0/.5/1, roughness .25/1, retroreflection 0/.6,
  and incidence angles 0/45/75 degrees. Maximum absolute linear-channel
  difference **1.526e-5**, mean **5.75e-7**; every channel passes
  `abs(native - legacy) <= 2e-6 * max(1, abs(legacy))`.
- In that matrix, default-specular-strength and fully metallic subsets are
  **bit-exact** between compensated and uncompensated native readbacks.
  This is sampled validation, not a claim about all material features.
- Four matched 1080p game pairs: **hero, ADS, reload, night**. The before control
  restores the old arm conversion and both native F90 literals only in browser
  responses. The after capture has neither control: it uses production code
  and the installed compensation. Sampled frame/time/camera/quaternion/FOV/
  weapon state and exposure match exactly in each pair. Targets/device,
  nonblank-image and zero-error checks pass.
- The sleeve is visibly less washed out; it is also darker because we preserved
  the authored low specular response while leaving the old .30 calibration
  unchanged. That remaining calibration/lighting question is separate.
- Native arm-blood E2E passes armour/damage, partial/cancelled/interrupted/
  complete/capped healing, respawn/restart, seven weapons, stable GPU resources
  and authored physical-material preservation on both arms.
- **60 smoke tests**, lint, build and diff checks pass. Existing high/combat
  graph checks also pass prepass isolation, AO linkage/filtering, resize,
  light-cycle/haze lifecycle, warmup state/RNG restoration, static-storage cache
  and transparent weapon clear. The ordinary HUD capture gate passes too.
  The latter existing capture/game runners used temporary copies adding actual
  device assertions; their production rendering/check logic was unchanged.

Not certified here: all glTF extensions/feature combinations, arbitrary normals,
unscripted gameplay, motion parity, equal-quality performance or complete
migration readiness. No performance improvement is claimed. PR #316 stays draft.

The first extended fixture attempt mixed raw and Vite-optimized Three.js imports
and produced `No stack defined for assign operation`. That was a harness module
identity error; the shared fixture entry fixes it. No application shader or test
expectation was loosened to hide that error.

## Reproduce

From the migration worktree, after `npm ci`:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs \
  --strict=1 --out=/tmp/cod-fresnel-gpu
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs \
  --backend=webgl --root=/home/edoardo/Documents/Claude-of-Duty-webgl-visual-reference \
  --strict=1 --out=/tmp/cod-fresnel-gl

# Intentional failures; diagnostic browser routes only:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs --uncompensated=1 --strict=1
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs --uncompensated=retro --strict=1

MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --standard-arm=1 --uncompensated=1 --shots=hero,ads,reload,night --out=/tmp/cod-fresnel-before
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --shots=hero,ads,reload,night --out=/tmp/cod-fresnel-after
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/arm-blood-e2e.mjs --out=/tmp/cod-fresnel-blood
```

The old forward visual controls (`--physical-arm`, `--f90-control`) are retired;
those corrections are now the default. Historical audit commands refer to the
pre-compensation revision. Current visual metadata records the reverse controls.
The visual runner still performs its previously documented startup-RNG alignment
in the browser; that is not a production fix or full event-state equivalence.

Artifacts: `/tmp/cod-fresnel-{gl,gpu,negative-1,negative-retro}/`,
`/tmp/cod-fresnel-{before,after,blood}/`, `/tmp/cod-fresnel-comparison.png`.

## Remove when upstream is fixed

1. Verify the upstream release corrects the affected direct-light paths and run
   the independent oracle/matrix against it. Do not infer correctness just from
   a release number or the original proposed patch.
2. Remove `tools/compensate-three-fresnel.mjs`, the `postinstall` hook and its
   root lockfile metadata when upgrading. Retire installation-specific smoke
   assertions, **retain arm-property and behavioral GPU regression coverage**.
3. Reinstall with `npm ci` and rerun capture/lifecycle/build checks against the
   actual upstream code. Ensure no stale optimized Three.js bundle remains.
4. Remove/update reverse controls whose markers no longer match and mark this
   compensation retired. Keep `createArmMaterial()`'s preservation fix.

Remaining migration tasks are the calibration/view-lighting audit, night/interior
exposure, road bands, combat glare/transient equivalence, AO/contact and motion
checks, startup responsiveness, the RNG-order regression, integration of current
develop, and final review. This compensation closes only the identified Fresnel
and sleeve material-conversion defects locally.
