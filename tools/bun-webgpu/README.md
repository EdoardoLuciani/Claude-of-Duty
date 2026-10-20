# Bun-native direct-WebGPU experiment

The #476 direct-JavaScript renderer, packaged as a **Linux x64 executable** with
Bun 1.4.3, native Dawn/WebGPU and SDL3. **No browser, webview, Node or separately
installed Bun at runtime.** Bun embeds JavaScriptCore/JIT; `--compile --bytecode`
is packaging/precompiled bytecode, **not JavaScript-to-native-code AOT**.

This is the same **limited historical 120-frame recorded workload**, not a game
port, production renderer or full-game FPS comparison. It does not acquire the
current game's PBR/textures/FX/postprocessing or gameplay. No production source,
root package manifest, world assets, quality settings or dependency forks change.

## Build and run

```sh
cd tools/bun-webgpu
npm ci                    # native-addon install scripts use Node during BUILD
bun run build             # tested Bun 1.4.3; embeds both .node addons + JS
# Only local scene-5/12 JSON+binary recordings and platform libraries at runtime.
SDL_VIDEODRIVER=x11 ./build/cod-bun-webgpu --data=/absolute/recordings --agents=12 --windowed
# Interactive 60 Hz recording replay; Escape/close exits. NOT an FPS benchmark.

# Uncapped native window, VSync explicitly OFF:
SDL_VIDEODRIVER=x11 ./build/cod-bun-webgpu --data=/absolute/recordings \
  --agents=12 --windowed --frames=900 --warmup=120 --in-flight=8 --out=/tmp/bun-window.json
# Matched offscreen RGBA8/depth32; no surface, rAF, timers or display pacing:
./build/cod-bun-webgpu --data=/absolute/recordings \
  --agents=12 --frames=900 --warmup=120 --in-flight=8 --out=/tmp/bun-offscreen.json
```

Requires hardware Vulkan, normal Linux C/C++ libraries and SDL3 for a window.
The executable embeds native **addons**, not an entire OS/driver/SDL distribution.
A standalone copy was tested outside the checkout with `PATH=/nonexistent` and no
Node/Bun/module paths. This is host-tested, **not cross-platform portability proof**.
Assets stay separate (~130 MiB/scene), not in Git or the executable. Export/use
#476 commit `11ebdcacef532da3b96b6f30c4c764096d65e944`'s final `scene-{5,12}.{json,bin}`
recordings; see [draft #476](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/476).

`--frames=0` is interactive window replay; positive frames step the recording
without a clock limit. Size is fixed at 1920×1080 physical pixels; no resize or
full-game input. `--capture=DIR` reads GPU poses 0/60/119 **after** measurement;
`--freeze-pose` is a negative control, never a primary measurement.

## Ownership and changes from the browser renderer

- `renderer.mjs`, `math.mjs`, `shaders.mjs`, `scene.mjs` come from pinned #476.
  Math, hierarchical transforms, skinning, sparse uploads, culling, material sides,
  instancing, index ranges, fixed shadows and draw order are retained. Loader I/O
  moves to the host; section/topology checks precede use. The equivalent shader
  output constructor matches #483's existing Naga workaround; arithmetic is unchanged.
- The host owns the GPU instance/device/output/window. A small explicit target
  (`device/format/size/view`) replaces browser bootstrap, not GPU API wrappers.
  The GPU provider has an explicit global root until device/surface teardown:
  Dawn's async runners must not be collected during large startup allocations.
- Offscreen is persistent RGBA8/depth32. Windows request **BGRA8-unorm + Immediate**
  through the library's public API, with no sRGB double encoding, presentation
  blit, extra draw/submit, FIFO fallback or per-frame timer. X11 is child-local.
  Actual `vkCreateSwapchainKHR` Immediate/BGRA8 was verified with a separate API dump.
- Six pipelines build before warmup. Renderer still uses five scene passes,
  one submit, 12 bind groups, five publication writes/frame. No Three imports.
- Trusted, **pinned prereleases**: `@kmamal/gpu 1.0.0-5`, `@kmamal/sdl 1.0.0-3`;
  current matching native-window ABI is required. Dawn commit
  `42d0e90fe3552a2a8e95ca8e506bc19bbda12729`. They are isolated here, not game
  dependencies. Bun/Node use the exact same addon bytes; build/report metadata
  records addon/source/executable SHA256. The generated binary is ignored.

Rejected stable-binding pilots are retained in the evidence directory: GPU 0.2.1
rejects default texture views with a swizzle validation error (also under Node);
0.2.0 rejects public event callbacks; mixing current GPU with SDL 0.11.13 has an
incompatible native-window payload. The initial sRGB/blit proposal was **not
adopted**. No validation disabling, API monkey-patching or dependency patch fixes.
An unrooted-instance startup hang/crash is also retained; explicit SDK-provider
ownership fixes lifetime, rather than relying on GC timing.

## Validation and measurement

```sh
npm test                  # four standalone math/decoder tests, no GPU/data needed
bun gpu-check.mjs         # optional hardware negative: error listener MUST fire
node gpu-check.mjs        # same check on V8
node check.mjs /tmp/bun-offscreen.json /tmp/rust.json /tmp/browser-raw.json
# Also accepts the browser Three reference and plain Bun/Node controls.
```

Hardware Vulkan-layer validation and API-dump diagnostics are separate from
primary timings. Actual GPU readbacks are qualitatively inspected, never compared
pixel-by-pixel or used for pixel-diff gates. Device loss/API errors are terminal;
there is no device-loss recovery. Startup/power/portability and exhaustive scene
coverage are not established by a renderer throughput test.

Results: [RESULTS.md](RESULTS.md); all final run means: [measurements.csv](measurements.csv).
Raw/rejected evidence, manifests, measurement driver and captures:
`/home/edoardo/Documents/bun-webgpu-lab/`.
