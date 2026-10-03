# Legacy / WebGPU final-frame visual comparison

## Verdict

**Not visually on par as a faithful replacement yet.** Daylight world composition
is reasonably close, and some native surfaces look cleaner. But the M4/arms,
night readability, ground shading and combat haze/glare have plainly visible
look changes. These are much larger than repeat-capture variation. The earlier
throughput win is **not an equal-visual-quality acceptance result**.

No production rendering/tuning changes are made by this investigation. Keep
PR #316 draft. Side-by-side sheets, enlarged crops and amplified differences
are attached to the visual-comparison comment on [PR #316](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/316).

## Controlled capture

- Native `737d07e` (runtime unchanged from `3bc1ba7`), Three 0.186.1;
  legacy `53f3d4c`, Three 0.186.0. This is the shared-content reference, not
  newest develop. A fresh filesystem SHA-256 comparison matches all **58
  public/model files and 28 authored assets**; committed world source matches.
- **1920×1080, DPR 1, high**, managed Chrome 153/Vulkan, forced sRGB profile.
  RX 9070 XT only. Every page asserts the actual native device is AMD RDNA4 and
  nonfallback, or that the actual WebGL context reports RX 9070 XT / GFX1201.
  GPU runs are sequential. Every shot gets a fresh page/engine.
- Nine scenes: hero, interior, night, detail, weapon, ADS, muzzle, combat, and
  tactical reload. Capture frame **183 / 3.05 simulation seconds** after 180
  settling frames, or **253 / 4.2167 seconds** for reload (70 frames after start).
- The harness restores the missing native startup RNG reservation through a
  browser-only source route, as in the performance comparison. Camera position,
  quaternion, FOV, engine frame/time, weapon clip/time and magazine count match
  in every pair. This is not a full per-frame gameplay/actor/bone equivalence
  assertion; the staged divergence from the performance audit remains open.
- Default auto-exposure and each renderer's production high-quality pipeline
  are retained. No global brightening/darkening, normal/AO replacement or
  matching-by-eye correction is applied to the primary images.
- Both pipelines' final default-framebuffer writes are redirected, for the
  final engine step only, into a same-size RGBA8 readback target. Intermediate
  passes retain their own targets. Both final shaders already encode sRGB;
  no second color transform is applied. Native rows are top-first; WebGL rows
  are flipped from bottom-first. No HUD, screenshot scaling or black headless
  swapchain is involved in the full-resolution images/metrics.
- World and weapon HDR targets are asserted at 1920×1080. Separate weapon
  rendering remains: **legacy 2× MSAA, native 0×**, per the migration decision.
  Native also retains the temporary half-resolution GTAO and different native
  AO/temporal/shadow/post-processing algorithms. A common preset name does not
  make the pipelines equivalent.
- All captures finish without page/shader errors. A recreated legacy checkout
  reproduces the initial hero pilot PNG byte-for-byte.

The reference worktree used for the first pilot was removed externally during
capture preparation. The completed set uses a fresh detached checkout at
`/home/edoardo/Documents/Claude-of-Duty-webgl-visual-reference`, at the same
`53f3d4c`, installed with `npm ci` and checked against the native assets again.
No images from a different legacy revision were mixed into the completed set.

## What the images show

### 1. Daylight world: close composition, not identical shading

Buildings, props, skyline, camera framing and major silhouettes line up in the
selected stills. The broad blue-sky / warm-stone identity survives. However,
shaded surfaces, indirect-light contrast and material colors differ. Some
native areas look cleaner and wood grain more legible; that does not make the
whole frame an improvement or establish complete geometry/culling parity.

### 2. M4 and sleeve: obvious material/lighting differences

The native receiver and rear sight read substantially darker, with much less
of the legacy bright metal/blue edge highlight. This is especially obvious in
ADS. The sleeve shifts from a greener, higher-contrast patterned appearance to
a muted olive/brown, flatter appearance; the cloth grid is still present.
The same differences persist through the sampled reload pose. The silhouettes
and sampled weapon clip match, but the material appearance does not.

These are observations, not a proven single cause such as a missing texture.
Do not fix them by brightening the entire scene: at a common exposure, the
world and weapon do not move toward parity uniformly.

### 3. Ground/material detail: conspicuous ripple-like shading

The native weapon/ADS/reload views show regular ridged/banded shading across
parts of the sunlit road that is not present in the legacy reference. Crate,
cloth and surface response also differ. The enlarged ground crop makes the
pattern readily visible. This investigation does **not** establish whether
that ground pattern originates in normal generation, AO, shadows, or another
stage; it requires an isolated follow-up before choosing a fix.

### 4. Night/interior: metering changes readability

Night is the largest difference. Native loses substantial street/facade detail
into darkness, while its sky and practical lights also have a different balance.
Legacy is much noisier and may itself benefit from art-direction changes; native
is not automatically worse because it is darker. Nevertheless, this is a major
readability/look change, not a faithful port or an approved visual redesign.

Actual final exposure multipliers:

| Scene | Legacy | Native |
|---|---:|---:|
| Hero | 4.112 | 3.348 |
| Interior | 6.765 | 5.000 |
| Night | 16.873 | 5.000 |
| Detail | 7.154 | 5.000 |

Native `_meter()` clamps its target to **5** in `src/render/index-webgpu.js`.
The night multiplier is about **1.75 stops lower** than legacy; this is a
multiplier comparison, not a claim that every final display pixel is 1.75 stops
lower after nonlinear tone mapping. The cap also affects the interior/detail
captures. Meter source, lighting and post processing differ as well.

### 5. Combat/flash: additional haze and highlight changes

The native combat capture has a large additional warm haze/glare region across
the left foreground, reducing local contrast around the soldiers and props.
The frame alone does not establish whether fog, particles, lighting, bloom or
another interaction is responsible. Transient scenes can also differ in actor/
effect state: that full state was not proven identical here. Do not label it a
proven fog-only defect or same-input shader failure. The player muzzle-flash silhouette and ejected casing broadly line up, but
highlight/bloom intensity and surrounding surface response differ.

## Quantified differences, not quality scores

Mean absolute RGB difference below is measured over the complete HUD-free
1920×1080 image, in **8-bit sRGB code levels, 0–255**. It is not a perceptual
quality percentage. `>10` counts pixels where any channel differs by more than
10 levels. No automatic pass threshold was chosen after seeing the results.

| Scene | Mean absolute RGB difference | Pixels with any channel difference >10 |
|---|---:|---:|
| Hero | 11.59 | 50.32% |
| Interior | 13.76 | 74.10% |
| Night | **37.83** | **94.31%** |
| Detail | 15.56 | 67.44% |
| Weapon | 13.13 | 56.51% |
| ADS | **20.33** | 68.01% |
| Muzzle | 16.67 | 63.98% |
| Combat | **23.10** | 70.92% |
| Reload | 14.30 | 55.92% |

Fresh-page **same-backend repeat controls**:

- Legacy hero/night: **0.00** mean difference, exact decoded pixels.
- Native hero: **0.146**; native night: **0.083**. Neither repeat has pixels
  with a channel difference >10.

Cross-renderer differences are therefore not explained by normal repeat noise.
A separate two-pixel Gaussian-blur analysis also leaves large differences:
hero **10.19**, night **37.13**, ADS **19.38**, combat **21.84**. This confirms
that much of the mismatch is broad shading/color, not only fine edge jitter.
It does not identify an individual rendering stage as the cause.

### Common-exposure diagnostic

For hero/interior/night, both pipelines are additionally rendered at exposure
**3**, without advancing simulation. Legacy's exposure-update result is replaced
with a constant texture; native's exposure scalar is fixed. This is a diagnostic
only. It performs one extra render/history update, so it is not an identical-
history decomposition of every pixel difference.

| Scene | Production exposure MAE | Common exposure 3 MAE |
|---|---:|---:|
| Hero | 11.59 | 14.19 |
| Interior | 13.76 | 9.62 |
| Night | 37.83 | 8.64 |

The night comparison moves substantially closer at common exposure, supporting
metering as an important contributor. Residual material/lighting differences
remain; daylight becomes **less** similar. A global exposure adjustment alone
is not a complete correction.

## Recommendation

Do not declare visual parity or merge on the performance result alone. Prioritize:

1. M4/arm material and lighting response, plus the ground banding/ripple pattern.
2. Exposure policy and night/interior readability, with explicit art-direction
   approval if intentionally departing from legacy rather than restoring it.
3. The combat haze/glare discrepancy and remaining AO/contact/post differences.
4. Then moving-camera/ADS/reload sequences, other weapons/optics, quality tiers
   and unscripted/human review. These stills do not establish motion stability.

This pass does not reapply the rejected FX upload change, alter bones or AI
scheduling, backport upstream GTAO, or change runtime rendering settings.

## Reproduce

```sh
# Fresh standalone legacy worktree at 53f3d4c, with npm ci completed.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --root=/home/edoardo/Documents/Claude-of-Duty-webgl-visual-reference \
  --backend=webgl --out=/tmp/cod-visual-final
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --backend=webgpu --out=/tmp/cod-visual-final
node tools/webgpu-legacy-visual-diff.mjs --dir=/tmp/cod-visual-final
```

Run GPU commands sequentially. Optional `--shots=hero,night` narrows the set;
use the same list with the diff tool. Native's test-only reservation must be
removed from the harness once the runtime RNG-order bug is actually fixed.

Outputs: `{webgl,webgpu}-<scene>.png`, common-exposure `-fixed.png` variants,
`{webgl,webgpu}.json`, `metrics.json`, `<scene>-diff-x4.png` and native-resolution
`<scene>-pair-full.png` (**legacy left / native right**). RGB difference images
are amplified **4× and clamped**, not ordinary rendered frames. Attached labeled
sheets are presentation-only downscales; material crops use 2× nearest-neighbor
magnification. Metrics use the original full-resolution images.

The optional Gaussian-blur metrics and labeled sheets were generated with
Pillow/NumPy in `/tmp/cod-visual-diff.py`; the committed Node/pngjs tool reproduces
raw metrics, full-resolution pairs and differences without new dependencies.
Independent JS and Python raw MAE calculations agree to <0.00001 code levels.

Validation: all 22 primary/repeat captures pass device, target-size, nonblank and
error checks; the diff tool confirms matching sampled camera/weapon state for
all nine pairs. A negative control changing native FOV by one degree fails with
`camera/weapon capture state differs for hero`. All **59 smoke tests**, lint,
build and `git diff --check` pass. No world assets changed; no world regeneration
was performed.
