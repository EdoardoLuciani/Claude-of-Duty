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

# An animated, native desktop window. Replays the 120-frame recording at 60 Hz.
# Escape closes it; resize rebuilds only the main depth target/surface.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes --agents=12

# Offscreen, bounded throughput, deliberately independent of VSync/compositing.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --warmup=120 --frames=900 --in-flight=2 --out=/tmp/native.json

# Separately measure the desktop/presentation path (finite frame-step replay).
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --warmup=120 --frames=900 --present=fifo --out=/tmp/window.json

# GPU readback captures happen AFTER measurement. No rendered pixel-diff gates.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --frames=120 --capture=/tmp/native-captures --poses=0,60,119

# Separate timestamp diagnostic; forces one completed frame at a time.
target/release/cod-native-wgpu-lab --data=/absolute/path/to/recorded-scenes \
  --agents=12 --benchmark --frames=900 --gpu --out=/tmp/native-gpu.json
```

`--adapter=SUBSTRING` selects a hardware adapter; CPU fallback is refused.
`--present=immediate` or `mailbox` is explicit: unsupported modes fail, not silently
fall back. Normal timings keep WGPU's safe API validation; `--validation` requests
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
renaming only the depth fragment entry point. Shadow passes retain the actual JS
implementation's dummy RGBA8 attachments, despite its older README's depth-only
wording. Main output is non-sRGB 1920×1080, shader gamma, depth32float, no MSAA.
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
The only rendering change is a persistent offscreen output texture/view instead
of the canvas current texture. Three.js is never imported. No GPU method wrappers
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
