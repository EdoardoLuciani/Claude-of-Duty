# Native vs direct JS vs Three.js — VSync-free comparison

Fresh runs on 2026-10-20, same RX 9070 XT / Ryzen 9 9950X, Mesa 26.2.4 and
Chrome 153.0.8010.12 as [the original series](RESULTS.md). This is **the reduced,
historical #476 recorded-renderer workload, not full-game FPS**. All three use
the same animated scene inputs, visibility, geometry, materials and five logical
passes. No production rendering, quality settings or native executable changed.

## Uncapped, real desktop windows

| Renderer                           | 5 agents: ms/frame | Rendered FPS | 12 agents: ms/frame | Rendered FPS |
| :--------------------------------- | -----------------: | -----------: | ------------------: | -----------: |
| Native Rust/WGPU                   |              0.914 |        1,094 |               0.950 |        1,052 |
| JS/direct WebGPU, no Three imports |              2.686 |          372 |               2.730 |          366 |
| JS/Three.js reference              |              3.469 |          288 |               4.049 |          247 |

- Native: X11/XWayland, explicitly selected **Vulkan Immediate**, no FIFO fallback.
- Both browsers: **headful X11**, `--disable-gpu-vsync`,
  `--disable-frame-rate-limit`, `--ozone-platform=x11`. One unlimited rAF per
  rendered frame, with actual GPU-completion fences and final drain.
- Hardware GPU/compositing enabled in every browser window; no fallback adapter.
  Every windowed run exceeded 180 rendered FPS. This is **not** a monitor-refresh
  ceiling or a count of distinct frames physically displayed.
- All three use the same eight-outstanding-work bound. These are fresh runs,
  not pooled with the earlier native two-bound ~1,149/~1,109 FPS results.

Native is about **2.9×** the windowed direct-JS throughput, and **3.8×/4.3×** the
windowed Three reference. **These ratios do not isolate the language or renderer.**
Chrome's canvas/compositor/presentation path is different from native Vulkan WSI;
native windows use BGRA8 and browser canvases RGBA8, with their existing window
attachment defaults. No claim of identical presentation work or causal attribution
of the gap is made. Use the fully matched offscreen control below for that distinction.

## Matched render-only control: no presentation or rAF

All three render to persistent **1920×1080 RGBA8-unorm + depth32float**, no MSAA,
with the same three 1024² shadow maps. No surface acquisition, compositing,
requestAnimationFrame or display pacing is involved. Both JS controls are
headless but execute on the hardware Vulkan adapter; headless compositing remains
software and is not used to present these offscreen textures.

| Renderer                           | 5 agents: ms/frame | Completed FPS | 12 agents: ms/frame | Completed FPS |
| :--------------------------------- | -----------------: | ------------: | ------------------: | ------------: |
| Native Rust/WGPU                   |              0.848 |         1,179 |               0.839 |         1,192 |
| JS/direct WebGPU, no Three imports |              0.833 |         1,201 |               0.869 |         1,151 |
| JS/Three.js reference              |              1.250 |           800 |               1.676 |           597 |

**Direct JS and native are effectively tied at this queue depth:** JS is 1.9%
faster at five agents; native is 3.6% faster at twelve. Native run ranges are
0.789–0.866 / 0.819–0.909 ms; four runs do not establish a reliable winner in
that small difference. Compared with Three, native throughput is **1.47×/2.00×**;
direct-JS throughput is **1.50×/1.93×**. The large windowed native/JS gap must not
be reported as an intrinsic Rust rendering speedup.

Separate two-bound sensitivity, median completed ms/frame (two runs/cell):

| Agents | Native | Direct JS | Three reference |
| -----: | -----: | --------: | --------------: |
|      5 |  0.857 |     1.441 |           1.699 |
|     12 |  0.894 |     1.479 |           1.809 |

As before, shallow bounds strongly expose browser completion IPC/callback latency.
CPU/process time, encode/submit wall, GPU execution and completed throughput are
different domains; do not add their overlapping times or infer full-game FPS.
No GPU timestamp or validation-layer instrumentation was enabled in these runs.

## Method, checks and provenance

- **60 uninstrumented runs / 54,000 measured frames**: four rotated runs per
  implementation/population/target at bound eight (48), plus two offscreen runs
  per implementation/population at bound two (12). Every run: 120 warmup + 900
  measured frames, recording reset, actual completion, final drain. Tables use
  reciprocal of the median run-mean duration, not mean instantaneous FPS.
- All 900 × five-pass draw/triangle sequences match native for each JS run.
  Same dataset SHA256, resolution, DPR 1, no errors/fallback/late shader builders;
  direct JS imports zero Three modules, Three really imports the pinned library.
- Three offscreen uses only public `RenderTarget`, `setRenderTarget`, and
  `readRenderTargetPixelsAsync` APIs. Default target explicitly uses RGBA8 and a
  FloatType depth texture. No Three source changes, backend hooks or timed GPU
  API wrappers. Windowed Three retains its original renderer.
- Actual GPU readbacks for both populations at poses 0/60/119 were qualitatively
  inspected alongside native and direct JS. No blank images, obvious missing
  geometry or frozen poses; **no numerical pixel comparisons or exact-parity claim**.
  Prior prototype visual limitations remain disclosed in the original reports.
- Native executable/source fingerprints remain those in [RESULTS](RESULTS.md).
  Comparison helper commit: `0e883e2`; pinned #476 JS checkout: `11ebdcacef532da3b96b6f30c4c764096d65e944`.
  Three package reports `0.186.0`; concatenated webgpu/core/tsl bundle SHA256:
  `56be0947803f6b87443cb65fbd20e39d6e8c4ea412b656b36d2e40c41453789d`.
  All reports retain renderer/binary/dataset fingerprints, adapter, browser GPU
  status and flags; source trees were clean during the timing series.
- Every run is in [three-way.csv](three-way.csv), including faster-JS and slower
  native runs. Raw reports/logs, rotated run manifest/driver, analysis and captures:
  `/home/edoardo/Documents/native-wgpu-lab/three-way/`. Pilots/capture runs remain
  separate and are not pooled. Earlier measurements are retained, not replaced.

## Reproduce

Use the existing [dataset/build instructions](README.md), `--in-flight=8` for all
three and the same 120/900 warmup/measured counts. The native window command must
include `--present=immediate` and child-local X11 selection. Offscreen uses
`--benchmark` instead. The optional JS helper adds `--mode=raw|three`:

```sh
# From tools/native-wgpu; REFERENCE/DATA/CHROME are local absolute paths.
node reference.mjs --reference="$REFERENCE" --data="$DATA" --executable="$CHROME" \
  --mode=three --agents=12 --warmup=120 --frames=900 --in-flight=8 --out=/tmp/three.json
# Replace --mode=three with --mode=raw for the independent JS renderer.
# For desktop canvas, add --windowed; this also sets the VSync-off/X11 browser flags.
node check.mjs /tmp/native-offscreen.json /tmp/three.json
```
