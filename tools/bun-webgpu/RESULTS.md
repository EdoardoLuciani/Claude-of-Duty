# Bun executable results — 2026-10-20

**Yes: the direct JS renderer runs as a native-window executable without a browser
or separately installed JS runtime. Bun embeds JavaScriptCore/JIT, not JS AOT.
Performance is mixed: strong offscreen throughput, but unresolved native surface
acquisition stalls make this window path slower than browser-direct WebGPU.**
This is #476's limited historical recorded workload, **not full-game FPS**.

## Matched offscreen rendering

Median run-mean completed time; FPS is its reciprocal, not mean instantaneous FPS.
All: persistent 1920×1080 RGBA8-unorm + depth32, no MSAA, three 1024² shadows,
same five logical passes, same eight-outstanding-work bound, no presentation/rAF.

| Renderer                    | 5 agents ms/frame | Completed FPS | 12 agents ms/frame | Completed FPS |
| :-------------------------- | ----------------: | ------------: | -----------------: | ------------: |
| **Bun packaged executable** |         **0.757** |     **1,320** |          **0.799** |     **1,252** |
| Rust/WGPU executable        |             0.809 |         1,237 |              0.831 |         1,203 |
| Browser/direct JS, no Three |             0.806 |         1,241 |              0.843 |         1,186 |
| Browser/Three reference     |             1.208 |           828 |              1.673 |           598 |

Bun has slightly higher throughput in this series, but **this does not establish
that JS/JSC is faster than Rust**. The native Dawn binding, Chrome/Dawn and
Rust/WGPU/Naga use different bridges/compilers/backend implementations; driver
clocks and run variation remain confounds. Bun's all-thread process CPU is
**0.746/0.847 CPU-ms/frame**, versus Rust's **0.219/0.244**: Bun is not winning on
CPU efficiency. Browser renderer and GPU-process CPU are separate overlapping
domains and must not be added to infer frame time. Encode/submit wall is not
pure JS execution, nor a GPU-duration measurement.

## Real native/browser windows: VSync OFF

| Renderer                    | 5 agents ms/frame | Rendered FPS | 12 agents ms/frame | Rendered FPS |
| :-------------------------- | ----------------: | -----------: | -----------------: | -----------: |
| Rust/WGPU executable        |             0.910 |        1,099 |              0.946 |        1,057 |
| Browser/direct JS           |             2.657 |          376 |              2.700 |          370 |
| **Bun packaged executable** |         **3.190** |      **313** |          **3.253** |      **307** |
| Browser/Three reference     |             3.410 |          293 |              3.998 |          250 |

Native processes use child-local X11/XWayland and Vulkan **Immediate**; Chrome
uses headful X11, `--disable-gpu-vsync --disable-frame-rate-limit`, unlimited rAF
and hardware compositing. An independent API dump verifies Bun's actual
`vkCreateSwapchainKHR`: `VK_PRESENT_MODE_IMMEDIATE_KHR`,
`VK_FORMAT_B8G8R8A8_UNORM`. No refresh-capped FIFO/Mailbox samples are pooled.
These are GPU-completed rendered frames, **not distinct physically displayed frames**.
Native windows use BGRA8, browser canvases RGBA8; presentation/compositor work is
not identical, so window ratios are not isolated language/renderer ratios.

### Important unresolved window limitation

**All primary Bun window runs retain two roughly one-second stalls.** A separate
host-level timing diagnostic locates ~1000–1002 ms inside public surface-view
acquisition, not JS animation math or a 180 Hz monitor cap. An extra macrotask
turn each frame does **not** fix it; using the direct public texture-view getter
instead of texture + view does **not** fix it either. Both negative trials are
retained; neither added code was adopted. Exact driver/binding root cause is
unresolved. No dependency fork, polling workaround, timeout suppression or
favorable-frame filtering was introduced.

Short 120-frame pilots reached ~960–1,030 FPS before encountering these waits.
They are **not representative of sustained window throughput** and are not pooled.
The 900-frame totals above include every wait. This is not a production-ready
window backend or proof of universal Bun performance.

## Runtime and packaging controls

Separate paired runs, same JS port + identical native addon bytes, bound eight,
two runs/cell. **Do not pool these later controls into the primary medians.**

| Target / agents | Packaged Bun ms/frame | Plain Bun ms/frame | Node/V8 ms/frame |
| :-------------- | --------------------: | -----------------: | ---------------: |
| Offscreen / 5   |                 0.822 |              0.813 |            1.020 |
| Offscreen / 12  |                 0.862 |              0.849 |            1.170 |
| Window / 5      |                 3.187 |              3.189 |            3.311 |
| Window / 12     |                 3.252 |              3.256 |            3.489 |

**Packaging brings no demonstrated steady-state FPS gain** over plain Bun;
offscreen difference is ~1–2%, window difference negligible. Node is slower in
these small controls; this includes runtime/N-API interaction, not pure language
arithmetic. Absolute times shift between series; no universal engine ranking.

Separate shallow-bound diagnostic (two runs/cell), completed ms/frame:

| Agents / bound 2 | Bun executable |  Rust | Browser/direct JS |
| ---------------: | -------------: | ----: | ----------------: |
|                5 |          1.074 | 0.855 |             1.463 |
|               12 |          1.069 | 0.893 |             1.477 |

Browser completion IPC/callback delivery strongly affects shallow queue results;
those larger Bun/browser ratios are not the primary saturated comparison.

## Protocol, validation and provenance

- **100 uninstrumented runs / 90,000 measured frames**: primary 64 (four rotated
  runs × four implementations × two populations × two targets); paired runtime
  controls 24; shallow-bound controls 12. Every run: 120 warmup + 900 measured,
  recorded-frame reset, actual GPU fences and final drain. No exclusions.
- Dataset hashes and every 900-frame × five-pass draw/triangle sequence match
  across implementations. No API errors/fallback adapters or late browser shader
  builders. Direct browser JS imports no Three; Three really loads its library.
- Both populations pass separate Vulkan-layer validation; a native window does
  too. Intentional invalid-buffer writes reach public error callbacks under Bun
  **and Node**. Wrong-work and frozen-pose reports are rejected by the comparator.
- Actual GPU readbacks, both populations at poses 0/60/119, in offscreen and native
  windows, were qualitatively inspected alongside Rust. Frozen-bone control is
  retained. **No pixel-by-pixel comparisons, pixel gates or exact-parity claim.**
- Four standalone math/decoder tests, 140 game smoke tests, clean `npm ci`, build,
  lint and formatting pass. Production package manifests remain unchanged;
  the new isolated tool manifest intentionally pins experimental native bindings.
- Host: RX 9070 XT / RADV GFX1201, Ryzen 9 9950X, Mesa 26.2.4, Linux
  7.2.11-200.fc44; Bun 1.4.3, Node 24.18.0, Chrome 153.0.8010.12. Browser offscreen
  compositing remains software but rendering is hardware; real browser windows
  have hardware compositing. Primary runs have no API wrappers, timestamps or
  Vulkan layers. RADV's testing warning stays in logs. No global host/display,
  driver, compositor or security settings change.
- Measured source commit **`5362798`**; native control checkout `240a0e3`, runtime
  `9d46a3e`; JS/Three prototype `11ebdca`. Source trees were clean during series.
  Bun source SHA256: `5e9ab6458a0a0fa4e77c6b3b4a029c71e721f7ae966530e83c7ab7d524f57d70`.
  Executable: **108,070,880 bytes (~103.1 MiB)**, SHA256
  `e9a6bebd615855b37714acd545349753424ff4ed1039b554f98d73b74a11d30e`.
  Native addons, compiler command, dependencies and dataset hashes are recorded
  in build/run manifests. Later documentation commits do not change measured code.

[measurements.csv](measurements.csv) retains **all 100** run means. Full reports,
logs, manifests, rotated driver/analysis, API dump, qualitative readbacks, failed
binding/lifetime pilots, standalone test and negative diagnostic trials remain at
`/home/edoardo/Documents/bun-webgpu-lab/`. See [README](README.md) for scope,
build/run commands, prerelease-binding limitations and platform dependencies.
