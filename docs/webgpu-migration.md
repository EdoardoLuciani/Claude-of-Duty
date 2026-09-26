# #312 WebGPU migration — baseline and integration checklist

Baseline gameplay revision: `5c033cd` (`develop`), measured with the branch's corrected profiler and Three.js 0.186.1. Target: WebGPU only, current desktop Chrome/Edge; no WebGL gameplay fallback. PR #311's prepass spike is reference material, not a production dependency. Keep all incomplete changes off `develop`.

## Reproduce the baseline

```bash
npm ci
npm run dev -- --port 5197 --strictPort
node tools/profile.mjs --port=5197 --w=960 --h=540 --dpr=1 --frames=900 --warmup=60 > /tmp/webgpu-before-profile.json
for shot in hero night interior combat ads weapon muzzle; do
  node tools/capture.mjs --port=5197 --shot="$shot" --w=960 --h=540 --settle=20 \
    --executable="$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" \
    --out="/tmp/webgpu-before-$shot.png"
done
```

`hero`, `night`, `interior` cover daylight, moonlight and interiors; `combat` includes skinned soldiers and muzzle/impact activity; `ads`, `weapon`, `muzzle` cover the first-person model. Add a moving reload capture before signing off (static shot IDs do not exercise its temporal behavior). Keep the same shot, quality preset, DPR, settle count and hardware in the after comparison. Capture uses deterministic `?capture=1&shot=...`; profile uses moving combat and deliberately **does not** fix the sim clock, so use repeated runs for distributions. PNGs live outside the repository until the PR's before/after attachments.

Corrected moving-camera baseline: 900 frames, first 60 discarded, 960×540 high, HeadlessChrome **151 full Chromium**, Mesa 26.2.3/RADV, Vulkan ANGLE, Three.js 0.186.1. Local reports in `/tmp/webgpu-before-{dgpu,igpu}-motion.json` (not committed). Both runs turned the player in **840/840** timed frames (4.936 / 5.027 rad cumulative yaw), resolved **840/840** GPU timer queries and reported no page errors. Earlier `/tmp/webgpu-before-{dgpu,igpu}-full.json` runs are **not valid moving-camera baselines**: they rotated the camera directly, which the player rig overwrote. Do not compare after results against those earlier numbers. GPU time and CPU submission overlap; do not add them.

| GPU | Boot ms | Frame p50/p95/p99 ms | Game CPU p50/p95/p99 ms | Render CPU p50/p95/p99 ms | GPU render p50/p95/p99 ms |
|---|---:|---:|---:|---:|---:|
| RX 9070 XT discrete (RDNA 4) | 2603 | 12.7 / 16.7 / 20.2 | 2.6 / 5.6 / 8.0 | 3.9 / 4.6 / 5.1 | 3.951 / 4.130 / 4.166 |
| Ryzen 9950X integrated (RDNA 2, `MESA_VK_DEVICE_SELECT=1002:13c0!`) | 4210 | 70.3 / 77.3 / 85.4 | 2.7 / 5.7 / 6.7 | 4.2 / 5.2 / 5.7 | 58.819 / 66.318 / 66.704 |

Use the full browser with `--enable-features=Vulkan`: the default Playwright headless shell exposes only SwiftShader as its WebGPU adapter here, and its measured frame times are **not comparable** to real-GPU WebGPU runs. Browser/adapter identity and internal resolution are emitted in each JSON report. PR #311 documented the same real-adapter requirement.

`tools/profile.mjs` reports boot measures, browser/adapter, internal and display resolution, p50/p95/p99 for frame interval, synchronous engine step, gameplay excluding render submission and render submission. GPU time is separately measured with nonblocking `EXT_disjoint_timer_query_webgl2` where available; missing/disjoint queries are omitted. Until a per-frame WebGPU timestamp source is wired and verified, WebGPU GPU p50/p95/p99 must be reported as unavailable, never estimated from CPU submission or a batched timestamp.

## Migration inventory (ownership, not a second rendering framework)

| Area | Current WebGL/GLSL and consumers | Required switch |
|---|---|---|
| `src/render/` | `index.js` owns `WebGLRenderer`, compile monkey-patch, stateful manual pipeline; `prepass.js` G-buffer; `csm.js`, `gtao.js`, `contact.js`, `ssr.js`, `taa.js`, `bloom.js`, `lut.js`, `exposure.js`, `composite.js`, `materialpatch.js`, `pass.js`, `glsl.js`, `env.js` implement GPU passes or string injection. | One WebGPU renderer, awaited initialization, explicit separate world/view passes (no weapon MSAA, per owner), upstream CSM/GTAO/SSR/TAA/bloom/LUT; retain only game-specific exposure policy. No renderer fallback or duplicate GLSL pass. |
| `src/materials/` | `shader.js` and `glsl/` surface functions, `generator.js` GPU texture forge, `library.js`, `masks.js`, `index.js`; preview creates a separate renderer. | Named reusable TSL surface functions/node materials; preserve authored PBR maps, masks and the 19 generated surfaces. Update preview. |
| `src/sky/` | `atmosphere.js`, `clouds.js`, `dome.js`, `luts.js`, `stars.js`, `noise.js`, `volumetrics.js`, `fullscreen.js`; `index.js` calls `render.setEnvMap` and registers volumetrics as a post pass; volumetrics uses depth/velocity. | TSL atmosphere/clouds/fog, environment texture creation and buffer inputs; preserve time of day. |
| `src/fx/` | GLSL particles, decals, haze and renderer-backed `preview.js`; `index.js` passes linear depth to soft FX. | TSL effects without changing analytic particle simulation; explicit depth ownership, WebGPU preview. |
| `src/ai/` | `textures.js` injects soldier detail/rim via `onBeforeCompile`; `grounding.js` shader; `preview.js` owns WebGL renderer. | Node composition for skinned soldiers; retain GLB PBR and vertex wear, WebGPU preview. |
| `src/weapons/` | `viewmodel.js` optics, `radio-mesh.js` shader; `index.js` hands off weapon scene, `preview.js` uses WebGL renderer. | Node optics and viewmodel outside world TAA/fog, separate view pass without MSAA; preview uses WebGPU. |
| `src/player/`, `src/ui/` | `lowhealth.js` post pass consumes exposure texture; `ui/minimap.js` has a WebGL canvas; `ui/preview.mjs` has a WebGL renderer. | TSL low-health/exposure linkage, WebGPU minimap/preview or a non-GPU alternative. |
| `src/core/`, `src/dev/`, `src/world/`, tools | `prewarm.js` compiles WebGL target variants and reads GL extensions; `dev/telemetry.js` reads renderer stats; world patches materials and passes env; `tools/capture.mjs`, `tools/profile.mjs` and other browser probes assume GL for diagnostics. | Await device before init of material/sky systems, prewarm nodes asynchronously, adapt stats/readbacks and capture/profiling, validate unsupported-device UI, resize and disposal. |

Strict boot implementation note: Three.js 0.186.1's `WebGPURenderer` constructor installs an automatic WebGL2 fallback even if no fallback is requested. `src/render/webgpu-device.js` constructs the same public `Renderer` + `WebGPUBackend` + `StandardNodeLibrary` directly with no `getFallback`. This is not a local fork, monkey-patch or second backend path. Browser tests show 0 WebGL context requests when WebGPU is absent or adapter acquisition fails. `tools/webgpu-boot/` is a focused integration check, not a parallel gameplay renderer; it reads an offscreen half-float output because headless Chromium's WebGPU canvas screenshots are black on this machine despite correct GPU render-target readbacks. Test on a real GPU using the full Chromium executable, not the Playwright headless shell's SwiftShader adapter.

Existing render contracts requiring an audited consumer before deletion: `renderer`, `screenSize`, `displaySize`, `depthTexture` (positive view metres), `velocityTexture` (UV delta), `normalTexture` (normal/coverage/material ID), `aoTexture`, `exposureTexture`, `hdrTexture`, `registerPass`, `addLight`, `requestEnvMap`, `setEnvMap`, `patchMaterials`, `prewarmMaterials`. In particular sky fog, soft particles/haze, player low-health and post-exposure/bloom cannot silently lose their inputs. Spike warning: TSL MRT names `velocity` and `depth` have built-in semantics; camera-motion velocity needs explicit verification; do not blindly replace the existing prepass with `velocity`.

## Gates

- [x] Baseline tooling separates frame, CPU step/submission and available WebGL GPU timer queries; initial deterministic stills captured.
- [x] Full 900-frame moving-combat baseline on both real integrated and discrete GPUs; record Chromium version and internal resolution.
- [ ] Moving reload capture and full-Chromium deterministic stills, before/after attachments.
- [x] Standalone WebGPU-only boot slice: strict device creation, no WebGL context on missing GPU/adapter, async init, world and separate **non-MSAA** view pass (owner preference), partial-alpha compositing, GPU readback, resize and disposal (`node tools/webgpu-boot/run.mjs` on a GPU-backed full Chromium). Unsupported-device checks also run in `npm test` without a GPU.
- [ ] Wire this renderer and the two-pass pipeline into the production render owner after GLSL-only materials/effects have node replacements; add integrated unsupported-device and resize/dispose tests. The game **still uses WebGL** on this branch; this boot slice alone does not satisfy phase 2.
- [x] First texture-forge function: `src/materials/normal-tsl.js` computes the packed tangent-space normal from height in TSL; the WebGPU probe verifies both gradient directions against analytic slopes.
- [ ] Replace GLSL surface generation and the remaining material shader hooks with TSL node materials; integrate the Sobel function into the production forge, preserve GLB maps/vertex masks, and capture representative soldier/world/weapon materials. The WebGL forge still uses GLSL until the complete switch; no runtime dual-backend toggle.
- [ ] Upstream CSM/GTAO/SSR/TAA/bloom/LUT in one pipeline with AO lighting, correct specular/exposure/viewmodel order.
- [ ] Sky/FX/optics/low-health, previews, prewarm, readbacks, capture and per-frame WebGPU GPU timestamps; no recurring shader errors/hitches.
- [ ] Remove legacy code and probes, update `ARCHITECTURE.md`/README, run tests/lint/build/world validation; integrated/discrete performance and visual before/after, attach PNGs to final PR.
