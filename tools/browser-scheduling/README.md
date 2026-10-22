# #485: browser scheduling and Firefox Nightly controls

Read-only rendering investigation, not a game/renderer change. Uses #476's pinned
**limited historical recorded renderer**, not full-game FPS. This phase covers
(1) Chromium scheduling × output target and (2) Firefox Nightly controls. It does
not adopt an optimisation, investigate Bun's WSI stalls, refactor AI workers or
claim the entire #485 investigation is complete.

## Run

```sh
npm ci
cd tools/browser-scheduling
npm ci # isolated dev-only Puppeteer/BiDi + PNG helper; root manifests unchanged
node run.mjs --browser=chromium --executable=/absolute/chrome \
  --reference=/checkout/of/476 --data=/local/recordings \
  --target=canvas --scheduler=raf --pace=uncapped --format=rgba8unorm \
  --agents=12 --frames=900 --warmup=120 --in-flight=8 --out=/tmp/run.json
node check.mjs /tmp/run.json /tmp/another-run.json
node --test test.mjs
```

- `--browser=firefox --executable=/absolute/firefox-nightly` uses supported
  Puppeteer WebDriver BiDi **connection** to a directly launched browser. Avoids
  Puppeteer's unrelated launch-profile prefs (including its forced fission mode).
- All paths are **headful**, same 1920×1080 / DPR 1. `--target=offscreen|canvas`;
  `--scheduler=raf|task|completion`. Task is one MessageChannel task per rendered
  frame, not a clamped setTimeout or a tight synchronous loop. Completion has no
  explicit task/rAF yield and serves as an offscreen anchor. All use actual GPU
  completion promises, the same outstanding bound, warmup/reset and final drain.
- `--pace=uncapped|normal`: Chromium's explicit disable-vsync/frame-limit flags,
  versus omission; Firefox's profile-local `layout.frame_rate=0` versus `-1`.
  Normal refresh scheduling does **not** imply a task-driven GPU loop is capped.
  Observe cadence; do not infer browser WSI mode or display FPS from a flag.
- Formats are explicit unorm RGBA8/BGRA8, shader gamma unchanged; depth32,
  three 1024² shadows, no MSAA, canvas COPY_SRC unchanged. Chromium prefers RGBA8
  on this host. Nightly prefers BGRA8: **forcing RGBA8 disables its SharedTexture
  swapchain path**. Keep format-matched and preferred-path controls separate.
- `--capture=DIR` does actual GPU readbacks of poses 0/60/119 **after** timing.
  Qualitative checks only; no pixel comparisons or pixel-diff gates.

## Measurement boundaries

Browser JS executes the entire replay locally, not through per-frame automation
RPC. Every sample retains scene draws/triangles, render-call wall, scheduling wait,
completion-bound wait, dispatch timestamp and encoding start. Callback delivery
includes browser IPC/event-loop effects: **not GPU timestamp execution**. Linux
/proc process CPU is across threads; missing/recycled PIDs are marked, not counted
as savings. Do not add overlapping CPU/GPU times to predict FPS.

GPU-completed frames, rAF callbacks, unique canvas texture objects and compositor
presentations are different counts. The primary report leaves presentation count
**unknown**. Optional `--identity` adds a separate canvas-object diagnostic, not
an actual presentation counter. `--trace` collects Chrome-only, separately timed
presentation-feedback diagnostics; neither is eligible for primary pooling.
No GPU API overrides/private engine hooks or timing wrappers in primary runs.

## Safety / provenance

Every browser uses a fresh profile. X11/XWayland, graphics-device selection and
Firefox pacing prefs are child-local; no user's profile, global display/driver,
compositor or security setting changes. Sandboxes/isolation remain enabled.
`support.mjs --executable=FIREFOX --out=JSON` is a **separate diagnostic**: it enables
system access for that private process only to read built-in `about:support`.
Timed runs never enable it. This corroborates Firefox's redacted content adapter
strings with Vulkan/RADV/RX 9070 XT identity; owned DRM FDs also corroborate hardware.

The renderer/math/scene/shaders are served from the explicit clean #476 checkout
`11ebdcacef532da3b96b6f30c4c764096d65e944`. Only output-target bootstrap, explicit
format and the existing equivalent Naga output-constructor workaround change.
All input/harness hashes, launches/preferences, GPU status, process snapshots and
warnings are retained. New native interfaces, production policies and quality
settings are not introduced.

Results: [RESULTS.md](RESULTS.md); all 140 completed run means:
[measurements.csv](measurements.csv). Full evidence, raw traces, profiles,
interrupted attempt and diagnostic/capture runs:
`/home/edoardo/Documents/browser-scheduling-lab/`.
