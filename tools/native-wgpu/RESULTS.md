# Native renderer results — 2026-10-20

**The Rust/WGPU desktop application works without a JavaScript runtime. Native
CPU cost is low, but saturated throughput is only modestly higher than the JS
prototype. Shallow-queue results are dominated by completion/scheduling policy,
not evidence of a universal Rust speedup.** This is the limited #476 workload,
not the full game. See [README](README.md) for scope and reproduction.

## Conditions and provenance

Ryzen 9 9950X, Radeon RX 9070 XT / RADV GFX1201, Mesa 26.2.4, Fedora/Linux
7.2.11-200.fc44, Rust/Cargo 1.99.1, WGPU 30.0.1. Browser: hardware, nonfallback
Chrome 153.0.8010.12; headless compositing remains software. Desktop: Wayland.
No host-security changes, GPU API wrappers or timestamp queries in primary runs.
WGPU safe-API validation stays enabled; Vulkan-layer checks are separate.
RADV's nonconformant/testing warning is retained in the logs.

Runtime source: `9d46a3e285b5daba4eaf385e09f04a9c452f4065`; JS prototype:
`11ebdcacef532da3b96b6f30c4c764096d65e944`. Native source fingerprint:
`23b7adc939d0733c6350a21214e1bf0a23c86f454794a4caffa392bb05a15c81`.
Native ELF SHA256:
`978eabee658c0f7c2f4b221fb2a8aff770a0c1d65949c8939e0f6be5cd565e4b`;
ELF build ID `e044047382abf0f71b935f478f24ad4b3dc88dde`. Later documentation-only
commits do not alter these runtime sources. Dataset fingerprints are in README.

All measured runs use 900 frames after 120 warmup frames, recorded frame reset
and final GPU drain. Same RGBA8-unorm 1920×1080 output, three 1024² shadows,
no MSAA, five passes. Four rotated native/JS-offscreen/original-JS-canvas runs
per population: **24 runs / 21,600 measured frames**. Fence-bound sensitivity:
two runs per population/implementation/bound: **16 runs / 14,400 frames**.
Source trees were clean and commits/binary hashes recorded before measurement.
No runs from the final series were excluded. [measurements.csv](measurements.csv)
retains every final run's means, including faster JS/outlier samples.

## Throughput depends on completion policy

Median of run means; milliseconds per **completed** offscreen frame. Both loops
bound outstanding submissions and wait on actual completion. JS promise delivery
includes GPU-process IPC/event-loop latency; native polls directly.

| Agents | Outstanding bound | Native ms/frame | JS ms/frame | Native throughput ratio |
| -----: | ----------------: | --------------: | ----------: | ----------------------: |
|      5 |                 1 |           1.184 |       2.625 |                   2.22× |
|      5 |       2 (primary) |           0.860 |       1.427 |                   1.66× |
|      5 |                 8 |           0.792 |       0.839 |                   1.06× |
|     12 |                 1 |           1.272 |       2.659 |                   2.09× |
|     12 |       2 (primary) |           0.863 |       1.457 |                   1.69× |
|     12 |                 8 |           0.834 |       0.863 |                   1.03× |

At eight outstanding submissions, throughput gains are **6.1% / 3.4%**, with only
two runs per cell. At two, it is largely a comparison of completion/callback
latency. These are stack/pacing results, not isolated language-execution ratios.
Naga/WGPU versus Tint/Dawn, browser process/sandbox costs, shader instructions,
driver recording and scheduling also differ.

The **unmodified original rAF/canvas JS harness**, retained separately, gives
0.904 / 0.957 ms/frame. Its native two-bound counterparts give 0.860 / 0.863.
Do not pool these different pacing/presentation conditions, or advertise the
shallow-fence ratio while concealing the much faster original JS loop.

## CPU, GPU and presentation are distinct

Primary two-bound medians, CPU-ms/frame:

| Agents | Native process (all threads) | JS renderer processes | JS GPU process |
| -----: | ---------------------------: | --------------------: | -------------: |
|      5 |                        0.220 |                 0.289 |          0.233 |
|     12 |                        0.248 |                 0.311 |          0.261 |

Native includes its WGPU/driver CPU work; it is not a pure renderer-main-thread
measurement. JS process times are separate CDP counters. Neither CPU time nor
GPU-process CPU is GPU execution duration; do not add them into frame latency.
Native encode/submit wall is 0.214 / 0.242 ms; bounded JS render wall is
0.248 / 0.280 ms. Both exclude explicit completion waits. Original canvas JS render
wall includes different implicit backpressure and is not a CPU-time comparison.

Separately serial GPU-timestamp runs give five-pass scope sums **0.903–0.914 ms**
at 5 agents and **0.959–0.971 ms** at 12. These include neither full queue nor
presentation duration, and differ from primary pacing; no GPU speedup is claimed.

Real desktop FIFO runs give **5.556–5.563 ms/frame (~180 presented frames/s)**.
Mailbox is also ~5.556 ms here: compositor/frame callbacks still pace the window.
Immediate presentation is unsupported and correctly fails rather than falling
back. Desktop results are not the throughput headline or a full-game FPS claim.

## Validation, negatives and retained limitations

- Every final frame/pass has matching draws and submitted triangles across
  native and JS, including the original canvas control. Average totals:
  **737.077 / 989.084 draws**, **5.593 / 6.278 million triangles**. Both retain
  161 storage-instance sets and identical dataset hashes. Publication plan is
  five writes, 72,288 / 85,280 bytes, one submit and twelve bind-group sets/frame.
- Nonblank native/JS GPU readbacks at poses 0/60/119 for both populations were
  inspected qualitatively. Cameras, instances, soldiers, hands/weapons, lighting
  and shadows appear consistent. Frozen-bone negative visibly changes the pose
  while cameras/visibility remain live. **No rendered pixel comparisons/gates**;
  this is not an exact-pixel or exhaustive visual-parity claim.
- Seven Rust tests cover affine/singular transforms, WebGPU near/far clipping,
  hierarchy/instances/palettes/publication, detached binds, pose freeze and malformed
  recordings. Cargo test, Clippy `-D warnings`, formatting and release build pass.
  Clean `npm ci`, **140 maintained game tests**, typecheck, lint, format and game
  build also pass. Existing npm audit reports one high-severity finding; unchanged.
- Vulkan-layer checks pass for both offscreen scenes and a 12-agent desktop run.
  Reintroducing the original local `VertexOut` reproduces VUID 10684 and makes
  `validate.sh` fail, although WGPU's API-error array alone stays empty. Equivalent
  aggregate construction fixes the generated-layout issue in both compared shaders.
- Rejected BGRA/RGBA mismatch, pre-Vulkan-check series, unsuccessful object-pointer
  pilot, failing shader-validation negative and earlier presentation variability
  remain outside the final series. No validation suppression, dependency fork,
  private hooks, pixel gates or production rendering changes were used.

Persistent raw evidence: `/home/edoardo/Documents/native-wgpu-lab/final/`
(`series-manifest.json`, per-run JSON/logs, `summary.json`, GPU/window diagnostics,
`captures/`, `validation/`). Generation/analysis scripts and rejected controls are
retained in its parent directory. Device-loss recovery and exhaustive device,
compositor/resize/color/pose parity are not established. Source/resource ownership
and work-count parity do not imply a full-game port or identical GPU instructions.
