# Native WGPU recorded-scene experiment

A **Rust desktop executable**, not a webview: WGPU 30/Vulkan, Winit 0.30,
Glam 0.30, Serde, Clap and ordinary Rust tooling. It needs **no JavaScript,
Node, browser, network connection or game installation at runtime**. Assets
are local recorded-scene files. Dependencies are isolated to this tool and locked
in `Cargo.lock`; the game's renderer and JS package manifests are unchanged.

This ports the _limited_ direct-WebGPU renderer in draft
[#476](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/476), commit
`11ebdcacef532da3b96b6f30c4c764096d65e944`. It is **not a native game port, a
production backend, or a full-game FPS comparison**. Both implementations use
that experiment's historical snapshots, not today's `develop` world/materials.

Measured results and limitations: [RESULTS.md](RESULTS.md).

## Build and run

Linux with a working hardware Vulkan driver and a recent Rust/Cargo toolchain
(WGPU 30's requirements) is needed. Winit supports Wayland and X11. Cargo fetches
build dependencies; the resulting executable does not fetch anything.

```sh
cd tools/native-wgpu
cargo build --release --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
cargo fmt --check
# Optional integration check: installed Vulkan SDK tools/validation layer required.
bash validate.sh /absolute/path/to/recorded-scenes /tmp/native-validation

# An animated, native desktop window. Replays the 120-frame recording at 60 Hz.
# Escape closes it; resize rebuilds only the main depth target/surface.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes --agents=12

# Offscreen, bounded throughput, deliberately independent of VSync/compositing.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --warmup=120 --frames=900 --in-flight=2 --out=/tmp/native.json

# UNCAPPED desktop throughput: force X11/XWayland for this process only.
# On this host Wayland exposes no Immediate mode; Mailbox still refresh-paces.
# Immediate is explicit VSync-off, not a FIFO fallback.
env -u WAYLAND_DISPLAY -u WAYLAND_SOCKET \
  target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --warmup=120 --frames=900 --present=immediate --out=/tmp/window-uncapped.json

# Refresh-limited presentation control ONLY; not a throughput measurement.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --warmup=120 --frames=900 --present=fifo --out=/tmp/window-vsync.json

# GPU readback captures happen AFTER measurement. No rendered pixel-diff gates.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --frames=120 --capture=/tmp/native-captures --poses=0,60,119

# Separate timestamp diagnostic; forces one completed frame at a time.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --frames=900 --gpu --out=/tmp/native-gpu.json
```

`--adapter=SUBSTRING` selects a hardware adapter; CPU fallback is refused.
`--present=immediate` or `mailbox` is explicit: unsupported modes fail, not silently
fall back. For uncapped windowed measurements, use the X11/Immediate command
above and verify `presentMode: "Immediate"` in the report. FIFO, and this host's
Wayland Mailbox loop, measure refresh-limited presentation instead. No global
compositor/monitor setting is changed. Rendered FPS above refresh does not mean
the physical monitor displays every rendered frame. Normal timings keep WGPU's safe API validation; `--validation` requests
additional Vulkan validation layers for separate diagnostic runs, if available.
GPU loss/surface failures terminate with an error rather than fabricating results.
`--freeze` is a negative control: freeze bone-local inputs, not cameras/visibility.
An output file is initially marked incomplete and replaced only after measurement.

## Recorded inputs and workload

Export `scene-{5,12}.json` plus `.bin` using #476's `tools/direct-webgpu/export.mjs`,
or reuse its **final**, non-pilot datasets. They are intentionally not duplicated
here (roughly 130 MiB each). SHA256 of JSON bytes **followed by** binary bytes:

| Agents | Dataset SHA256                                                     |
| ------ | ------------------------------------------------------------------ |
| 5      | `50440afc51b81cd99b4697a952b63ce46a835df94500a00ad74ca5d9d2a92802` |
| 12     | `c85b360fcf0784a96e12120c2d718adbc33081f22d3d4774e828a618ae809625` |

The native loader validates section bounds, topology, indices, instance/palette
references and frame lengths. CPU matrices use Glam's `DMat4` (f64), publishing
f32 at the same buffer boundaries as JS. Frustum extraction uses WebGPU's [0,w]
depth range. Singular zero-scale objects publish zero inverses, not NaNs.

The same geometry, material sides/colors, hierarchy, visibility, cameras, bone
palettes and instance matrices drive five passes: three fixed 1024² shadows,
world beauty, then a depth clear and view beauty. WGSL is copied from #476,
renaming the depth fragment entry point and returning `VertexOut(...)` directly
instead of assigning a function-local output struct. The latter is an equivalent
expression that avoids invalid SPIR-V Function-storage layout emitted for the
original form on this WGPU/Naga version; the JS offscreen control mirrors it.
Shader arithmetic and buffer layout are unchanged. `validate.sh` checks the
Vulkan-layer log as well as process success: WGPU's `errors:[]` alone does not
include all backend validation messages. Shadow passes retain the actual JS
implementation's dummy RGBA8 attachments, despite its older README's depth-only
wording. Main output is non-sRGB 1920×1080, shader gamma, depth32float, no MSAA.
Offscreen defaults to `--format=rgba8unorm`; use `--format=bgra8unorm` if the
reference browser prefers BGRA. The structural check rejects format mismatches.
Culling, draw order, index ranges and instance counts are retained.

Both omit full PBR/textures/alpha/transparent/sky/FX/post/history/full CSM policy.
No quality settings are disabled in the game: **the game is not executed**.
The renderer owns GPU resources; scene state owns CPU publication. Object/pose
writes precede their submission; subsequent frames enqueue writes after earlier
draws. No shared GPU destination is overwritten ahead of an older pending draw.

## Fair comparison and interpretation

`reference.mjs` is **optional comparison tooling**, not a native runtime
requirement. Point it at a clean checkout of #476 with that checkout's npm
prerequisites installed. It reuses the real JS renderer, shaders, loader and
browser harness, serving source in memory without editing the reference branch.
It uses a persistent offscreen output texture/view instead of the canvas current
texture and the identical equivalent vertex-output constructor described above. Three.js is never imported. No GPU method wrappers
are installed in timed frames.

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node reference.mjs \
  --reference=/absolute/checkout/of/476 --data=/absolute/path/to/recorded-scenes \
  --executable=/absolute/path/to/full/hardware/chrome --agents=12 \
  --warmup=120 --frames=900 --in-flight=2 --out=/tmp/js-offscreen.json
node check.mjs /tmp/native.json /tmp/js-offscreen.json
```

Both offscreen loops cap outstanding submissions using actual completion fences
(default two); drain after warmup, reset recorded frame to zero, and drain at the
end. JS promises include GPU-process IPC/event-loop callback delivery; native
WGPU polls submission completion directly. Test other bounds (`--in-flight=1,2,8`
in **separate invocations**) rather than attributing fence latency to language
execution. Also retain fresh runs of #476's original rAF/canvas `run.mjs`: its
pacing/presentation differ and it is not the matched offscreen control.

Report CPU time, encode/submit wall time, drained elapsed/frame, GPU scopes and
windowed presentation **separately**. Native process CPU includes its WGPU/driver
threads; JS renderer- and GPU-process CPU are distinct. CPU and GPU overlap: do
not add CPU-ms to GPU-ms or convert CPU reductions into promised FPS. Naga/WGPU
and Tint/Dawn, browser IPC/sandbox, driver paths, shader instructions and scheduling
also differ. This is a stack comparison, **not an isolated Rust-vs-JS test**.

Reports retain every frame's five-pass draw/triangle counts, dataset/source/binary
fingerprints, hardware info, resolution, fence bound and validation/pacing modes.
Verify matching counts and inspect nonblank poses 0/60/119 and a frozen-bone
negative before interpreting timings. Structural contracts do not prove exact
pixels, and qualitative visual agreement is not an exhaustive parity guarantee.
GPU timestamps (`--gpu`) are separate serial, paced diagnostics, excluding full
queue/presentation duration. Device-loss recovery and exhaustive multi-device,
resize/compositor parity are out of scope.
