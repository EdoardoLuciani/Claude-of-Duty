# #485 phase 1–2: scheduling matrix and Firefox Nightly

**Chromium's canvas penalty survives removal of rAF. Firefox Nightly's preferred
BGRA8 canvas+rAF path is substantially faster in this workload, but its offscreen
completion notifications and forced-RGBA8 path behave very differently. Neither
browser's maximum completed-render rate is a physical display-FPS measurement.**
No production renderer/quality changes; no backend adoption recommendation.
These are #476's **limited historical recorded scenes, not full-game FPS**.

## Controlled method

Same RX 9070 XT / RADV, 1920×1080 DPR 1, 120 warmup + 900 measured frames,
three 1024² shadows/depth32, no MSAA, same five logical scene passes, one submit,
eight outstanding completion promises, recording reset/final drain. **All browser
paths are headful**, removing the previous headless/headful compositor confound.
Canvas COPY_SRC remains enabled everywhere; no format/usage optimisation adopted.

- **rAF**: one callback per frame. **Task**: one MessageChannel task per frame,
  not a clamped timer or microtask-only spin. **Completion**: no explicit task/rAF
  yield; offscreen anchor. GPU queue promises acknowledge submitted work, but
  delivery includes IPC/event-loop time, not GPU timestamp execution.
- Uncapped configuration: Chromium `--disable-frame-rate-limit --disable-gpu-vsync`;
  Nightly's **profile-local** `layout.frame_rate=0`. Normal controls omit the Chrome
  flags / use Firefox `-1`. Flags are requests, not proof every callback source
  becomes unlimited: the measurements below expose several exceptions.
- Explicit unorm formats: Chromium RGBA8 preferred; Firefox BGRA8 preferred.
  Also retain Firefox RGBA8 format-matched anchors. No sRGB/gamma changes.
- Four rotated runs/cell; median run-mean duration, FPS is its reciprocal. Normal
  controls/native anchors two runs/cell. Keep browser formats/backends explicit.

## 1. Chromium matrix: rAF is not the main canvas penalty

**Completed-render FPS, not displayed FPS.** Both browsers' columns use their
preferred format, so cross-browser columns are not a format-isolated comparison.

| Output / scheduler, uncapped requested | Chromium RGBA8: 5 | Chromium RGBA8: 12 | Nightly BGRA8: 5 | Nightly BGRA8: 12 |
| :------------------------------------- | ----------------: | -----------------: | ---------------: | ----------------: |
| Offscreen / completion                 |             1,196 |              1,142 |              116 |               121 |
| Offscreen / task                       |             1,189 |              1,139 |              112 |               125 |
| Offscreen / rAF                        |              57.4 |               57.3 |              117 |               122 |
| Canvas / task                          |               382 |                368 |              113 |               119 |
| **Canvas / rAF**                       |           **375** |            **373** |          **854** |           **858** |

At twelve agents, Chromium is **0.878 ms/frame offscreen/task versus 2.716
canvas/task**; canvas/rAF is nearly identical at **2.683**. Replacing rAF does
not recover the ~3× gap. Render-call wall stays **0.246 / 0.264 / 0.258 ms**.
The large exposed wait is at the GPU-completion boundary (~2.3 ms/frame for both
canvas loops), not rAF dispatch (~0.05–0.08 ms) or CPU draw-loop wall.

GPU-process CPU rises from **0.250** offscreen/task to **4.706/4.639 CPU-ms/frame**
canvas task/rAF (all threads). This is a location clue, **not GPU duration or
additive critical-path latency**. No exact compositor/copy/driver attribution yet.

Blank/offscreen+rAF is a bad throughput baseline here: ~17 ms/frame is spent
waiting for callbacks even with uncapped flags. It runs near 57 Hz, while canvas
rAF exceeds the 180 Hz monitor rate. Scheduling depends on output activity;
this is not evidence the GPU became 20× slower.

## 2. Nightly works on hardware, but defaults and completion delivery matter

Firefox Nightly **160.0a1, build 20261022084508**, default WebGPU enabled, no
force-enable/blocklist bypass. Its content adapter strings are redacted. Separate
built-in about:support diagnostics identify **Vulkan / RADV / device 0x7550,
vendor 0x1002 / RX 9070 XT**, nonfallback, plus hardware WebRender and X11.
Owned browser DRM FDs corroborate the same device in every timed run.

Preferred BGRA8 canvas+rAF completes **854/858 frames/s**, versus Chromium
**375/373**, roughly **2.3×**. Fresh Rust/WGPU Immediate-window anchors are
**1,146/1,092** (two runs each). This narrows the earlier native/browser gap for
this path, but does not isolate JS engines, compiler/backends or colour format.
It is not evidence the full game runs 2.3× faster in Firefox. At twelve agents,
canvas/rAF run means span **2.655–2.735 ms** Chromium versus **1.156–1.171 ms**
Nightly BGRA8; four runs are not an inferential confidence interval.

### Forcing RGBA8 changes the Firefox presentation path

Nightly logs **“disabling SharedTexture swapchain: canvas configuration format
not supported”** for RGBA8, but not BGRA8. Rendering remains hardware; do not call
this a software WebGPU adapter. Format-matched RGBA8 canvas+rAF under ASAP drops
to **23.9/23.8 completed frames/s**, mostly scheduling wait (~41 ms), with a
~0.45–0.53 ms render call. Its twelve-agent run means vary widely,
**28.281–47.422 ms**. All poor runs remain in the evidence.

This is why a naive identical-RGBA8 browser comparison would be misleading as a
comparison of each browser's preferred path. Exact format/usage fast-path cause
and possible Chromium BGRA8 benefit are **not investigated/adopted in this phase**.

### The low offscreen/task numbers do not establish slow GPU rendering

Nightly's BGRA8 offscreen/task/completion and canvas/task loops exhibit batches
of quick encodes followed by **~95 ms completion-bound waits** (encoding-interval
p99 ~95–96 ms). Canvas+rAF does not show those waits; its p99 is ~1.2 ms.
These are **test-loop encoding intervals, not full-game or presentation latency**.

Separate callback-bound diagnostic, twelve agents/offscreen/completion, 120 frames:
bound **1 → 9.95 FPS**, bound **16 → 220.65 FPS**, versus primary bound 8 ~121.
This supports a roughly 100 ms notification/polling-cadence interpretation, not
an order-of-magnitude GPU execution claim. Exact internal timer/cause remains
unproven without deeper profiling. Do not use this fenced loop to rank raw GPUs.

## Normal refresh controls and what was actually presented

With normal configuration, Chromium rAF is ~**60 FPS** for canvas and offscreen;
Nightly rAF is ~**174–175** for BGRA8 canvas/offscreen **and RGBA8 canvas**. Normal
Chromium canvas/task is ~**526 FPS** at twelve agents, while Nightly task remains
~119–125. Thus “normal/VSync-on” does not cap every task-driven render loop, and
ASAP can make the fallback path worse. These exact browser configurations are
not asserted equivalent to physical monitor presentation modes.

Separate diagnostics, not primary timings:

- 900 canvas acquisitions: Chromium rAF/task each **900 distinct texture objects**;
  completion-only **563**. Nightly rAF **900**, task **504**, completion-only **366**.
  Distinct objects still **do not count displayed frames**.
- Narrow Chromium presentation traces, bounded by benchmark time-stamps: **900
  GPU-completed frames versus 206 / 203 `Display::FrameDisplayed` feedback events**
  for canvas rAF/task. Offscreen+rAF has **one** such event despite 900 callbacks.
  These count reported root-display feedback, can include UI composites, and do
  not identify 900 distinct scene images or physical scanouts. Trace overhead and
  in-flight boundary effects prohibit pooling these counts into primary FPS.
- Firefox's equivalent compositor-presented count is **not established here**.
  No claim of 858 unique displayed frames/s, optical FPS or input-to-present latency.

## Validation, provenance and retained evidence

- **140 completed uninstrumented runs / 126,000 measured frames**: 96 uncapped
  browser controls, 36 normal controls, eight fresh native anchors. All 900 ×
  five-pass draw/triangle sequences, hashes and dimensions match across **all**
  runs. No API/page errors/fallback; active visible/focused pages and DPR 1.
- One normal control was interrupted by the outer 20-minute runner deadline;
  its incomplete report/log are preserved with the interruption record. Resume
  skipped every completed run and reran only that unfinished attempt. No completed
  outlier/exclusion. Browser/driver binaries and source stayed unchanged throughout.
- Real GPU readbacks: both populations, poses 0/60/119, Chromium RGBA8 and Nightly
  BGRA8/RGBA8, qualitatively inspected. **No rendered pixel comparisons/gates**.
  Four harness tests cover pinned replacements, CPU parsing/PID reuse and negative
  wrong-work/incomplete/diagnostic checks; 140 game tests/build/lint/format pass.
- Linux 7.2.11-200.fc44, Ryzen 9 9950X, **Mesa 26.2.5** (prior experiments used
  26.2.4), Chromium **153.0.8010.12**, Nightly above. Do not pool old timings.
  Fresh profiles, child-only X11/pacing/device selection; no user profile, global
  compositor/display/driver/security changes. Default sandboxes/fission retained.
  Separate about:support diagnostics alone allow system access in their own
  process; **timed runs do not**. Puppeteer launch-profile overrides are avoided.
- Measured source **866edeb3c5dd3a97d1fdb0dab9936f3d35216e15**; input #476
  **11ebdcacef532da3b96b6f30c4c764096d65e944**. Core Firefox libxul SHA256
  `3842c27fc7501c4b5ba55fbb7328024e22dfa45499e0686f943c190b74ec0469`;
  RADV SHA256 `84d8f16adfb68823ae471c8b01d77f223bf23cf9180fcb32399ff74a13fcffdf`.
  Full executable/source/input hashes, preferences, actual Chrome argv, browser
  GPU diagnostics, raw CPU snapshots and launches are in the manifest/reports.

All means: [measurements.csv](measurements.csv). Full evidence, initial/resumed
controllers, analysis/captures, bad pilots, callback/identity diagnostics and raw
presentation traces: `/home/edoardo/Documents/browser-scheduling-lab/`.
**Next discussion:** canvas usage/format controls and deeper Chromium GPU/Viz
attribution, then representative full-game pacing. No optimisation is adopted,
Bun stalls/AI threading remain separate, and #485 is not closed by this partial phase.
