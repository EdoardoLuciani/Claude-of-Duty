# WebGPU fullscreen pass and texture-boundary audit

Audited production baseline: `6f3bae2`, Three.js 0.186.1. **No production renderer
changes are made by this audit.** RX 9070 XT only, selected with
`MESA_VK_DEVICE_SELECT=1002:7550!`; managed Chrome153, 960x540/DPR1, deterministic
lockstep capture. No integrated-GPU tests.

## Method and limits

`tools/webgpu-graph-audit.mjs` records actual GPU render attachments, texture-view
bind groups, texture copies, fullscreen shaders and optional GPU timestamps.
It intercepts from before boot so previously created views/groups remain mapped,
then measures 24 gameplay frames after ready. Loading/prewarming is excluded.

- Bound textures are **potential reads**, not proof every shader samples them.
  Shader inspection establishes the identity/pointwise boundaries below.
- CPU render-call nesting / encoder creation order is not GPU submission order.
  Sort `startNs` timestamps within each measured frame for execution order.
- Deep interception and these short fixed-scene timestamp samples are diagnostic,
  **not an uninstrumented whole-app performance benchmark**. Uploads, texture
  copies, idle and waits are outside render-pass timestamp sums.
- Private cached shader reads exist only in this tool. No renderer/builder
  overrides or installed dependency edits ship in gameplay.

Reproduce, from the migration worktree:

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-graph-audit.mjs \
  --quality=high --out=/tmp/cod-graph-audit-high.json
# Also quality=medium, low, ultra; active low-health uniform probe:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-graph-audit.mjs \
  --shot=combat --hurt=1 --out=/tmp/cod-graph-audit-combat-hurt.json
```

## Actual recurring fullscreen passes

| Stage | High | Medium | Low | Ultra | Reason |
|---|---:|---:|---:|---:|---|
| GTAO raw |1|1|0|1| Depth/normal neighborhood evaluation |
| AO horizontal +vertical bilateral |2|2|0|2| Two dependent filter outputs |
| World TAA resolve |1|1|0|1| World-only reprojection/history |
| TAA-to-fog input RTT |1|1|0|1| **Identity copy high/medium**; TAA+SSR sum ultra |
| Fog +world/weapon composition RTT |1|1|1|1| Produces colour for displaced haze sampling |
| Haze-warp result RTT |1|1|1|1| Texture interface required by low-health input |
| Bloom bright extraction |1|1|1|1| Half-resolution thresholded input |
| Bloom horizontal/vertical blur |10|10|10|10| Five progressively smaller mip levels |
| Bloom mip composite |1|1|1|1| Combines five vertical mip outputs |
| SSR raymarch +five blur mip levels |0|0|0|6| Ultra reflections |
| Final presentation |1|1|1|1| Low-health/exposure +bloom +AgX/sRGB +LUT |
| **Recurring fullscreen draws/frame** |**20**|**20**|**15**|**26**| Excludes geometry, shadows and sparse meter |

One additional 64x64 meter draw appeared in each 24-frame trace. It is sparse,
nominally requested every16 rendered frames while no readback is pending. It is
not a recurring full-resolution post pass. Haze offset sprites and their clear
are separate geometry/clear passes, **not fullscreen postprocessing draws**.
Environment/shadow updates can also add non-fullscreen passes.

Actual drawing-buffer sizes: high/ultra 960x540, medium768x432, low691x388.
AO raw is half size (high480x270) while its bilateral targets are full size R8.
Full-resolution HDR intermediates are RGBA16F. On high, each such texture is
4,147,200 logical texel bytes (~4.15MB), excluding alignment/driver overhead.

The principal high execution sequence (from GPU timestamps) is:

```text
opaque MRT → AO → bilateral H → bilateral V
→ CSM → lit world → TAA → TAA-copy RTT → separate weapon
→ fog +premultiplied weapon composite → haze warp RTT
→ bloom bright → (H/V blur ×5) → bloom composite → final
```

TAA also makes **two full-size texture copies/frame**: resolve colour to history,
and opaque nonlinear depth to previous depth. These are genuine history updates,
not the redundant identity RTT. Removing the RTT must retain both updates.

## Boundary classification

### A. TAA identity RTT — first removal candidate

`src/render/webgpu-pipeline.js` sets `world = taaPass` on non-SSR presets and then
calls `convertToTexture(world)` for fog. Three's `TRAANode` is not marked as a
texture/sample/pass node, so `RTTNode.convertToTexture()` creates an RTT. Its
679-character fragment shader does only one sample of `TRAANode.resolve`.
The producer has a **public `getTextureNode()`** returning its native pass texture.

A diagnostic-only route prototype (`--variant=direct-taa`) uses that public
texture node. Actual high fullscreen draws fall **20 ->19**, the identity RTT
vanishes, and both native history-copy operations remain. No production source
is changed. **Image/temporal equivalence and whole-app gains are not yet validated.**
This removes one ~4.15MB live texture at960x540 and its materialization work; it
does not remove TAA or its history. The historical `--variant=direct-taa` prototype
belongs to audit commit `09bc5f8`; the current tool instead provides negative
controls that restore removed boundaries.

On ultra the corresponding RTT also adds SSR to resolved world RGB. It is not
an identity shader. Fog already documents accepting evaluated colour nodes as
well as textures; inlining that pointwise sum is a separate candidate requiring
validation of coordinates, sampling, producer scheduling and temporal ordering.

### B. Haze-warp →low-health RTT — second removal candidate

The render owner calls every `post.asNode(convertToTexture(composite), exposure)`.
The only registered gameplay post is `LowHealthPass`. Its `asNode()` samples the
input **at screenUV only** and performs pointwise colour treatment. Therefore the
warp output need not intrinsically be a texture for that treatment.

However, its existing API expects a texture. A change must make pointwise input
handling explicit without breaking future/other passes that really resample.
It must also retain exposure-dependent additive red, alpha and the HDR ordering.
Inlining would execute warp work in both full-resolution final presentation and
quarter-pixel-count bloom bright extraction rather than once in the RTT; fewer
passes are **not automatically less shader work or faster gameplay**. Benchmark
active haze +hurt states, not only the zero-uniform healthy case.

### C. Fog/composite →haze input — retain

`HazeSystem.warpNode()` fetches red/green/blue at three displaced UVs. This is a
real resampling boundary. Removing the texture naively would sample colour at
shifted coordinates but evaluate fog ray/depth/dither at the wrong coordinates,
or repeat the raymarch per tap. Keep it unless redesigning the effect with
separate correctness/performance evidence. Keep fog world-only and weapon alpha
composition premultiplied before haze.

### D. Bloom, AO and history boundaries — mostly necessary

- Native bloom is **12 passes**, not11: bright +10 blurs +mip composite. Its
  horizontal/vertical directions reuse each mip's shader/material. The final
  composite **reuses horizontal mip0's target**, after its blur data is consumed;
  there is no extra dedicated bloom-composite allocation to remove.
- Bloom mip composition could theoretically move into final presentation, but
  accessing private mip fields / replacing the native addon is not a small
  supported API change. Its measured GPU cost is tiny; not the first priority.
- AO H/V and TAA/SSR neighborhood/history boundaries cannot disappear through
  ordinary pointwise fusion without changing algorithms or duplicating work.
- Low-health/exposure and the bloom-input cap already execute inline in bright
  extraction. Final low-health/exposure, bloom addition, AgX/sRGB and LUT are
  also fused. There are **no separate exposure, LUT, tone-map or low-health
  fullscreen passes** to merge in this graph. Healthy/hurt traces have identical
  recurring pass counts, using stable uniform-driven shaders.

## Diagnostic cost, not a speedup claim

In the high24-frame trace: TAA identity RTT ~.012ms GPU, warp RTT ~.014ms,
fog/composite ~.373ms, TAA ~.031ms, raw AO ~.049ms, both AO filters ~.025ms each,
bloom composite ~.008ms. GPU clocks/workloads/instrumentation differ from earlier
moving-combat profiles; do not combine these values with CPU wall time or infer
whole-app gains. The main submission bottleneck and cold-start cost are not
solved by this audit.

**Recommended next change:** remove the high/medium TAA identity materialization
using the public producer texture, with matched current/history/final images and
three paired whole-app profiles. Then assess pointwise post-input handling. No
compute conversion, custom bloom rewrite, quality cut or general frame-graph
abstraction is justified by this inventory alone. PR316 stays draft.

Evidence: `/tmp/cod-graph-audit-{high,medium,low,ultra,combat-hurt,direct-taa}.json`
and corresponding logs. Local texture IDs vary with allocation order; identify
stages by shader/consumer edges, not hardcoded IDs.

## Implemented boundary removal (after the audit)

Production now uses the public TAA resolve texture on high/medium. Low-health
provides `asColorNode()` for a colour node directly (`asNode()` texture inputs
remain supported). Other registered posts retain the default resampling texture
contract. Fog/composite stays materialized before displaced haze sampling, and
ultra keeps the non-identity TAA+SSR input. No compute conversion or native addon
replacement is involved.

| Preset | Before fullscreen draws/frame | After |
|---|---:|---:|
|High|20|18|
|Medium|20|18|
|Low|15|14|
|Ultra|26|25|

Both native TAA history copies remain. High avoids two full-size RGBA16F
intermediates (~8.29MB logical texels at960x540; not driver-measured allocation).
The optimized tool checks counts/history with `--verify=1`, texture-contract
compatibility with `--resample=1`, and 12 exact low-health texture-vs-value cases
with `--parity=1` (healthy/hurt/flash, low/high exposure, landscape/portrait).
That probe also verifies an upstream displaced texture sample retains its UV.
`--variant=taa-copy` /`post-copy` +`--verify=1` each correctly fail when restoring
one redundant boundary. No tests or thresholds were weakened.

See [measurements and non-bit-exact limits](webgpu-performance-analysis.md#fourth-optimization-remove-two-fullscreen-materializations).
**No whole-app or GPU speedup is established by this change.**
