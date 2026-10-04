# Final WebGPU review and targeted cleanup

Base: `1947ab07` (PR #316), compared against develop `a33127db`.
The user approved the current appearance/playability and explicitly deferred
startup/loading-feedback and stutter optimization. **Do not merge without authorization.**

## Independent review

The separate `openai/gpt-6-astra` review completed with exit 0, a nonempty report,
and [a posted review comment](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/316#issuecomment-5980348320).
It requested two bounded correctness fixes, not a new rendering architecture or
another visual retune. Its checks apply to the base above, not this subsequent fix.

### Unexpected device loss

Confirmed the reported public-callback fault injection: Three marks the renderer
lost and skips rendering without throwing. Previously, simulation and input kept
running, with no engine error or reload dialog.

- Register the loss handler before awaiting renderer initialization, preserve
  Three's default bookkeeping, and pass unexpected loss to `Engine.fail()`.
- Stop the frame loop and use the existing reload-required dialog. Do not add a
  fallback backend, recovery renderer or new loading-screen design.
- Abort initialization/readiness if a terminal error arrives during init/prewarm.
  Ignore intentional device destruction and owner teardown.

`tools/webgpu-review-check.mjs` checks ordinary gameplay and injections during
init and prewarm. All three retain unchanged frame/simulation time after one
second, disabled input and exactly one open failure dialog. Failed boots remain
at frame/time zero and never publish readiness. Removing the notification to the
engine deliberately fails `no invisible simulation after loss`: frame 4→64,
simulation 0.0556→1.0555 s, input enabled and zero dialogs.

This is callback fault injection, **not** a physical driver-reset test. The
existing fatal UI is reused; broader loading and failure-feedback work is still
deferred.

### Frame-graph ownership

Confirmed that `convertToTexture()` creates owned RTTs for colour expressions,
while existing texture/sample/pass outputs are borrowed. `RenderPipeline.dispose()`
only releases its material, not these intermediate targets.

Keep an explicit local list of newly created RTT nodes and dispose that list
alongside the graph's explicit passes. No recursive disposer, borrowed-target
destruction, additional render pass or output retune.

The GPU regression constructs/renders/disposes three graphs per configuration:
warp alone, warp plus a resampling post effect, and SSR/fog plus warp. All **nine**
return `renderer.info.memory.textures` to **0**, with exactly one graph-disposal
event per owned intermediate. The deliberate no-disposal control reproduces
**2→4→6** retained textures for the warp-only case and fails
`warp: graph leaked textures`. The CPU smoke also checks borrowed ownership and
restoration of scene callbacks.

A related ownership check exposed a delayed-readback race: disposing an old graph
could overwrite its replacement's view-scene callbacks. Detach those callbacks
when releasing the graph, before waiting for GPU readback, and restore only hooks
still owned by that graph. The CPU regression reproduces this ordering; the GPU
rebuild keeps view alpha **0** and releases all textures. Deliberately removing
the callback ownership guard clobbers the new hook and produces alpha **1**, so
the deferred-disposal assertion fails rather than accepting an opaque view clear.

## Requested simplifications

### Remove unused WebGL implementation

Deleted **8,319 lines across 26 files**: the old renderer owner/effects and GLSL
material generator/library, plus the obsolete `tools/materials-parity` bridge
that imported that generator. Gameplay already imports `index-webgpu.js`.
The deletion-only checkpoint passed all 75 then-existing smoke scripts, lint and
build before the other changes were applied.

Historical reports remain historical. Reproducing their old WebGL implementation
or removed parity tool requires the corresponding historical checkout; it is no
longer shipped beside the native gameplay owner. Numerical sky helpers, current
TSL materials, authored assets and unrelated tooling remain intact.

### Use Three's fullscreen primitive

The three material-bake setups and shared sky-bake setup now use `QuadMesh`.
Only per-pass materials/targets are owned here; its shared geometry is not
explicitly disposed. Sky LUT/environment bake Y inversions are removed because
QuadMesh UVs already agree with native texture sampling. The separate fog
clip-space reconstruction Y correction is unrelated and remains intact.

`tools/quad-bake-check.mjs` compares a known quadratic height field with its
analytic normal, sRGB albedo/height packing, ORM data and a float sky UV field:

| Quantity | Maximum absolute error | Gate |
|---|---:|---:|
| Encoded normal | 0.00386534 | <0.008 (RGBA8 plus half-float height) |
| Sky UV field | 0 | <1e-6 |
| Albedo | 0.00226022 | <0.003 |
| Height alpha | 0.00217225 | <0.003 |
| ORM | 0.00196079 | <0.003 |

The test also checks render-target restoration and zero shared-geometry disposal
events. It uses 64-pixel RGBA8 rows to respect native readback alignment.
Restoring the old plane/scene/orthographic-camera bake in a diagnostic route
raises normal error to **0.505706** and fails
`baked normal disagrees with height gradient`.
Procedural detail orientation changes with the bake convention; this is **not a
byte-identical texture refactor**. Authored material parameters, exposure, bloom,
weapon lighting budgets and Three's pinned Fresnel compensation are unchanged.
Before/after afternoon and powered-night images accompany the PR response.

### One active key-light direction

Sky owns a stable `keyDirection`, derived once from the active placed light.
Renderer compatibility field `sunDir`, material uniforms, indirect fill and fog
borrow this vector instead of independently normalizing the same light. FX and
view lighting transform copies. Render retains its own direction only for the
no-sky fallback.

The source is the **placed key**, including the near-horizon clamp, not the
astronomical sun/moon vectors used by atmospheric scattering and disc placement.
This also keeps fog aligned with the light actually fitted by CSM. Smoke coverage
checks identity across sun→moon handoffs, the clamp and authoritative zero light.

## Validation and limits

All GPU work is sequential and restricted to `MESA_VK_DEVICE_SELECT=1002:7550!`,
with `amd / rdna-4 / non-fallback` adapter verification. No dependency upgrade,
GPU-validation override or render-quality reduction.

- 76 smoke scripts, lint, build and committed-world validation passed.
- Device-loss and repeated graph-lifetime checks passed; both deliberate
  regressions failed the intended assertions.
- Full native prepass/AO/resize/light-cycle/haze check passed. World/view targets
  were 544×306, raw AO/haze 272×153; the transparent view corner was `[0,0,0,0]`.
  Fog preserved all 28,442 cleared-depth sky samples exactly.
- Full day/night/flashlight E2E passed, including pause/shop/death/restart and
  the native wall-shadow oracle (blocked **0**, clear **167**). Introducing a live
  enemy into the flashlight added **0** builders/compiles.
- High-quality world-dependent view-lighting/inventory checks passed.
- Combat/reload/MCX optics/clock-cycle motion: **4×180 = 720** simulated frames,
  **0 setup and 0 moving builders** in every phase. These are scripted structural
  checks, not real-time performance or exhaustive temporal certification.
- Starfield empty-cell/airglow oracle passed with maximum error **3.2431e-10**.

No fresh performance improvement is claimed. The prior +6.55% three-pair result
and predominantly post-death benchmark are not rewritten as a win. Full human
temporal/unscripted certification and physical device-reset testing remain
unperformed. The PR stays draft; fixes do not constitute merge authorization.
