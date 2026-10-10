# Native diagnostics and maintenance (#370)

This bounded follow-up to material integration retains skinned coverage, shares
native diagnostic helpers, and cleans up reporting/tuning names. It does not
change gameplay, warmup staging/order, shader arithmetic, sampling budgets,
resolution, lighting, or SSR/TAA composition.

## Pinned Three contracts

Source: Three `9681657f760197afa0a680b1e522a4340a6a53f8`.

- `src/renderers/common/Info.js`: `render.calls` and `compute.calls` are
  cumulative; `reset()` clears frame calls/draw counts, not those totals.
  `memory.programs` counts live programmable **stages**, not GPU pipelines.
- `src/renderers/webgpu/utils/WebGPUTextureUtils.js:copyTextureToBuffer()`
  removes 256-byte GPU row padding before returning the typed array.
- `src/materials/nodes/manager/NodeMaterialObserver.js:needsRefresh()` makes
  skinned meshes FULL-refresh independently of declarative material nodes.
  Skeleton updates are cached by renderer frame; advance real rAFs between poses.

## Diagnostic boundaries

`src/dev/native-builds.js` owns the callback observer. It preserves the existing
callback's context, return value and exceptions, supports a local `onBuild`, and
is inert after disposal even when another wrapper retains it. Independent
observers (e.g. telemetry and a fixture) each count an event once. Re-running
`verifyNative()` disposes its previous observer instead of stacking observers
which increment the same global counter. Existing counter reset operations and
build-detail fields remain supported. Missing native diagnostic support fails
verification rather than reporting zero builds.

`tools/lib/native-render.mjs` serializes the self-contained helpers through
Playwright; production preview does not serve `/src/` or `/tools/` module URLs.
There is no runtime renderer interception or new browser dependency. Specialized
fixtures still own their oracles and per-pass/resource instrumentation.

`tools/lib/native-readback.js:packedReadback()` validates element count and returns
the original data. It neither infers a stride nor decodes/converts values. Byte,
half-float and float interpretation, display transforms, and nonblank checks stay
with their callers. Capture target/face/mip restoration and owned target disposal
remain failure-safe; shared QuadMesh geometry is never disposed by the probes.

`src/dev/render-info.js` supplies these diagnostic snapshot fields:

| Field | Meaning |
|---|---|
| `rendererFrame` | Native renderer frame ID, not the application frame |
| `renderCallsTotal` | Native cumulative render calls |
| `renderCallsFrame` | Native render calls since the last info reset |
| `drawCallsFrame` | Draw calls since the last info reset |
| `computeCallsTotal` | Native cumulative compute calls |
| `computeCallsFrame` | Native compute calls since the last info reset |
| `shaderStagesLive` | Native live programmable stages |
| `webglProgramsLive` | Historical WebGL program count; unavailable on native |

Do not equate the renderer's reset window with one application frame: they use
separate loops, and capture lockstep can pump several application frames. This
change never resets renderer info or changes scheduling. Existing native `calls`
(capture/preview) and `renderCalls` (telemetry) remain cumulative aliases for report
continuity. On historical WebGL reports their old meaning remains unchanged;
new native totals are unavailable there. Unavailable values are `null`, not zero.
Combat profiling retains explicit before/after call/draw deltas around each step.
Builder counts, live stages, pipeline compilations and GPU timings are distinct.

## Prewarm and tuning

`window.__PREWARM__.hooks` is the canonical returned hook report. It is published
before the terminal warmup-failure gate, so failure diagnostics do not depend on
`__ENGINE__`/`__READY__` being published. There is no duplicate runtime
`engine.__prewarmHooks`; current consumers use the canonical report. Only the
historical cross-revision benchmark retains a fallback for old checkouts.
AI's unavailable WebGL `programs` field is now `null`, not a claimed zero.
No hook staging, cancellation, RNG/clock, hidden variants, readiness or resource
cleanup has changed. `?prewarm=0` keeps its explicit disabled report.

SSR additive gain remains **0.16**. Bloom defaults remain **0.14** strength,
**1.6** threshold and **0** radius, with a **16** post-exposure input ceiling.
These are named application art policies, not upstream defaults or physical
reflectance constants. The ceiling affects only bloom's input, not original HDR.
This cleanup does not validate or change additive SSR after world TAA.

## Regression coverage and reproduction

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
# Run GPU jobs sequentially on hardware WebGPU; never software fallback.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-correctness-check.mjs
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/startup-e2e.mjs
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/startup-e2e.mjs --failure=prewarm
MESA_VK_DEVICE_SELECT=1002:7550! node tests/e2e/production-boot.mjs
```

Skinned goggles/original/clone: three bone/camera poses × two fog/alpha states,
plus eight warmed animated frames. The smoke fixture checks legacy/current/clone
FULL classification for skinned cloth and goggles using the pinned observer,
without patching its methods. `--negative=skin` must fail the animated-pixel oracle;
existing `rim`/`clone` mutations must still fail their pixel assertions.

Native correctness checks all pixels of odd-width 7×1 and 7×3 RGBA targets in
byte/half/float formats against an analytic XY gradient. CPU regressions retain
malformed/padded rejection, callback context/return/exception/disposal behavior,
repeated verification, unavailable counters, reset semantics and failed capture
restoration. Startup's failure fixture expects a failed report with preserved
state/target/RNG and no readiness; it is not an expected-crash test.

Matched-exposure captures and a living-combat pair are regression screens, not
bit-identical final-image, speedup, statistical-equivalence or cross-vendor claims.
Keep raw reports and limits with the PR rather than adding another harness.
