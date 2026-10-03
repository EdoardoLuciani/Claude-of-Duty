# Steady rendering: stable CSM uniform identities

## Result and scope

Against the preceding runtime (`9a68890`, including the retained uniform-sharing
work, with the FX experiment still reverted), three paired **plain** 600-frame
runs improve mean frame interval **11.665 → 9.354 ms (19.8% lower)**. That is
approximately **85.7 → 106.9 FPS**, or **24.7% higher throughput** in this fixture.
Synchronous renderer wall time falls **8.892 → 6.694 ms (24.7%)**.

This is not fresh legacy parity, GPU execution timing, an unscripted benchmark,
or final migration approval. PR #316 remains draft. AI scheduling, quality,
geometry, FX upload policy, bones, materials and separate weapon rendering are
unchanged. No dependency patch, private renderer refresh override, WGSL rewrite,
clock change or production diagnostic switch is used.

## Why this removes repeated preparation

Three 0.186.1's CSM `setup()` constructs a new expression for each material build.
Its camera/split/far references therefore get different node identities. The
stock PCF function also constructs new `mapSize` and `radius` reference nodes
inside its shader-build callback. Identical values alone cannot make those
layouts share a native bind group: Three's shared-group key includes node IDs.
Consequently, many world draws compare and upload the same camera/light data
through distinct render groups, despite those values having render lifetimes.

`src/render/csm-webgpu.js` changes those **expression/parameter lifetimes**:

- `StableCSMShadowNode.setup()` delegates initialization and expression creation
  to the native CSM, then reuses that expression. Fade/cascade-count changes
  invalidate it; a null camera still invokes native initialization.
- The inherited expression's `Fn` still executes `setupShadowPosition` for every
  shader builder/context. Shader builds, material-dependent shadow handling,
  skinning, current/previous transforms and shadow draws are **not** cached away.
- A `WeakMap` retains one PCF parameter-node pair per actual `LightShadow`.
  The nodes remain native, live `reference()` nodes in the native `renderGroup`.
- The public `shadow.filterNode` hook uses the same pinned five Vogel samples,
  IGN rotation, radius normalization, hardware depth comparisons and averaging
  as stock PCF. Array-layer handling is retained. Caller-supplied filters are
  preserved; the filter is not forced onto non-PCF shadow types.
- No new texture/render target or per-frame allocation is introduced. The weak
  parameter cache does not retain dead shadow owners. Existing Three.js owns
  and updates the shadow resources normally.

The integration in `src/render/index-webgpu.js` is an import and constructor
substitution. This is deliberately **not** a new shadow algorithm. The derived
sampling code includes Three's MIT notice. A Three.js upgrade must revalidate
it against the stock filter, not silently preserve an obsolete sample pattern.

### Structural check: moving frame 30

These are inspection counts, not additive time budgets:

| Counter | Stock | Retained change |
|---|---:|---:|
| Candidate draw calls | 1,045 | 1,045 |
| Node entries visited | 27,998 | 27,998 |
| Full-path bindings checked | 16,483 | 16,483 |
| Uniform fields compared, all passes | 24,510 | 13,017 |
| Uniform fields compared, world pass | 15,590 | 4,097 |
| Unique world `render` uniform IDs | 1,043 | 107 |
| Comparisons of the same 75 light coefficient IDs in world `render` groups | 9,002 | 377 |

Thus the fix removes repeated field comparisons rather than bypassing full
refresh, texture validation, node traversal, skinning or cascade rendering.
It does **not** eliminate all remaining per-draw preparation.

## Matched performance

Actual renderer device: `renderer.backend.device.adapterInfo`, AMD / `rdna-4`,
`isFallbackAdapter: false`, with `MESA_VK_DEVICE_SELECT=1002:7550!`.
Managed Chrome 153, Vulkan/ANGLE, native WebGPU, 960×540, DPR 1, high quality.
Combat-start lockstep fixture, real turning/forward motion/periodic firing;
60 initial frames, 30 settling frames, then 600 measured frames per boot.
Pair 2 reverses launch order. Each run is short; GPU runs are not concurrent.

Plain mode restores the native draw, upload, binding and node-update functions
before measurement. Only frame/system wall timers and the zero-steady-builder
callback remain. Structural counters are null, not misleading zero draw counts.

Frame interval milliseconds:

| Pair | Stock mean / p95 / p99 | Candidate mean / p95 / p99 |
|---|---|---|
| 1, stock then candidate | 11.463 / 14.4 / 17.7 | 9.727 / 11.5 / 13.8 |
| 2, candidate then stock | 11.827 / 14.9 / 17.8 | 8.649 / 10.4 / 12.0 |
| 3, stock then candidate | 11.705 / 14.5 / 16.1 | 9.686 / 11.1 / 13.3 |

Mean renderer wall: **8.696/7.021**, **9.052/6.068**, **8.928/6.993** ms
(stock/candidate). Mean whole engine step: **10.973 → 8.712 ms (20.6%)**.
All pairs improve; the size varies. No errors or measured shader builders.
Final sampled camera/RNG/agent state agrees in all pairs. Renderer wall includes
native calls/backpressure, not just JS or thread CPU. Engine, render and frame
intervals overlap and must not be added.

A separate three-pair light-instrumented series gives **12.244 → 9.966 ms**
frame interval and **9.386 → 7.234 ms** renderer wall. In that series, every one
of the 1,800 matched frames has identical candidate draw/work counts. Mean
candidate draws are **1,030.228**, index-or-vertex-instance work **22,867,574.16**.
Writes drop **1,951.672 → 674.873/frame**, bytes **1,351,888.92 → 1,283,218.05**
(only **5.1% fewer bytes**). These counts are separate from the plain timing claim.

A separate 120-frame native GPU-command spy confirms **960 → 960 actual draws**
and **21,069,211.1 → 21,069,211.1 work/frame**, with zero per-frame mismatches.
Candidate counts in that shorter window are 961 because one zero-count draw
never becomes a GPU command. These shorter-window means are not the 600-frame
means above.

An ordinary-AI cross-check releases the staged starting actors to normal
movement/decisions. One light-instrumented pair gives frame mean/p95/p99
**13.419/15.6/18.1 → 11.010/12.8/15.3 ms**, renderer mean **10.094 → 7.993 ms**.
All 600 candidate draw/work samples and the final sampled gameplay state agree.
This is a cross-check, not an unscripted acceptance run or a fix for navigation
hitches. No navigation answer replay is used in these performance tests.

Do not compare these combat-start 600-frame results directly with the historical
hero-start 900/60 legacy result, or add them to older optimization percentages.
No new GPU-timestamp/clock acceptance claim is made.

## Experiments not retained

- An explicit per-material hook for sharing light coefficients was real but
  weaker: its final standalone three-pair series improved mean interval by 4.4%.
  Once CSM layouts were canonical, an additional pilot was only about 2.3%.
  The extra material/context/disposal machinery was removed entirely.
- Immutable surface texture grouping did not show useful throughput improvement.
  A first shared-texture-group attempt also hit Three's missing sampler
  `nodeUniform.id`; that erroring experiment was excluded, not patched upstream.
- Caching only the CSM expression did not collapse the remaining PCF reference
  layouts: world light comparisons stayed at 9,002. Both lifetime fixes matter.
- A native `BatchedMesh` pilot grouped 169 static leaves into 20 batches but
  expanded 7,343 instances into per-instance draws. Fewer preparation entries
  did not deliver useful timing improvement. Its image gate was not established;
  neither batching nor its culling/draw-order changes are retained.

Exploratory single runs were not sufficient to infer gains from structural
counts. The retained result is backed by the separate paired timing series.
The rejected FX and bone-upload experiments remain rejected/unimplemented.

## Correctness and lifecycle checks

- **59 smoke tests**, lint and Vite build pass.
- `tools/webgpu-uniform-check.mjs` passes high/ultra/medium/low on the actual RX
  device. The direct GPU PCF comparison has **18 cases per quality / 72 total**:
  three radii, two map-size scales and three comparison depths, with bit-exact
  stock/candidate results, nontrivial filtered edge pixels and no rebuilds for
  numeric edits. This exercises real cascade depth textures; it is not a CPU
  formula comparison. The array-depth branch is retained but is not exercised
  by these ordinary 2D CSM maps.
- The same tool verifies live GPU light color/intensity/distance/decay values,
  steady room publication, shared bindings, odd 1025×577 resize, cache settling
  and disposal. High compares 75 coefficient nodes **1,812 times across 12
  settled frames**, not once per material layout.
- Restoring fresh CSM expressions or fresh PCF parameter references fails with
  `light coefficients still compared per material layout`.
- Wrong PCF averaging or a frozen radius fails with
  `cached PCF differs from stock filtering`.
- Seven high scenes: **all 49 current-buffer hashes match exactly**—world HDR,
  weapon HDR, normal, positive depth, velocity, raw AO and filtered AO. Ultra
  hero/combat: all current hashes including the SSR surface MRT match exactly.
- Nine **sampled 256×256** cascade-depth hashes match across hero/combat/night;
  this is not a full-map comparison.
- High graph-warm/render-cache/unlit-prepass/AO-blur/resize/light-cycle/haze checks
  pass. Warmup still submits zero scene geometry and preserves simulation/RNG/
  object state; the repeat warmup covered 301 geometries. Moving reload/glint,
  separate weapon alpha, disposal and the standard hero capture also pass.
  The game/capture runners were additionally instrumented in temporary copies
  to assert the actual renderer device rather than requesting another adapter.

**Final temporal images are not bit-exact.** High RGB MAE/max versus stock:
hero **0.200795/6**, interior **0.014170/3**, night **0.093776/2**, combat
**0.775093/12**, ADS **0.145680/7**, weapon **0.010837/6**, muzzle **0.216255/4**
(on the 0–255 scale). Ultra final hashes also differ. The existing native-clock/
history fixture limitations do not prove every difference harmless. No committed
image assertion was weakened, and current-buffer equality is not complete
visual acceptance. Human/unscripted review, final-history/ADS questions, fresh
matched legacy performance and cold-start responsiveness remain open. The
separate known exposure/medium-capture fixtures were not declared resolved.

## Reproduction

```sh
# Plain timing: alternate launch order and repeat pairs, never concurrently.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --plain=1 --csm-stock=1 --frames=600 --out=/tmp/csm-before
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --plain=1 --frames=600 --out=/tmp/csm-after

# Separate structural evidence, not a timing budget.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --csm-stock=1 --frames=60 --census=1 --out=/tmp/csm-count-before
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
  --frames=60 --census=1 --out=/tmp/csm-count-after

MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs
# Also --quality=ultra|medium|low. Each negative must fail:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=csm-expression
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=shadow-fields
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=pcf-samples
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-uniform-check.mjs --control=pcf-values
node tests/smoke/smoke-csm-uniforms.mjs
```

The stock constructor substitution is browser-route test instrumentation only.
Evidence families: `/tmp/cod-steady-csm-plain-{before,after}-{1,2,3}.json`,
`csm-{before,after}-{1,2,3}`, `csm-census-*`, `csm-actual-*`, `csm-normal-*`,
`csm-{high-final,ultra,medium,low}`, `csm-parity-{high,ultra}`,
`/tmp/cod-steady-shadow-check.json`, `cod-steady-negative-*`, `cod-steady-game.log`,
`cod-steady-reload.log` and `cod-steady-capture.png`. Temporary JSON/image
artifacts are not required for ordinary builds.
