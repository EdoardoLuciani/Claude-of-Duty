# Same-canvas Pixi presentation experiment

**Result: no demonstrated performance benefit over the existing separate Pixi
canvas on this hardware.** Keep the original HUD slice's presentation as the
recommended path. This experiment is not a production presentation refactor.

## Paths

- `?pixi=hud`: unchanged four-widget Pixi HUD, separate transparent canvas.
- `?pixi=hud&presentation=canvas`: same retained HUD rendered to a Pixi-owned
  antialiased GPU RenderTexture, then premultiplied-alpha blended into Three's
  final canvas with one small native WebGPU display pass. Same shared GPUDevice.

The second path has one visible WebGPU canvas, not two. It has **no CPU pixel
copies/readbacks** and does not reconfigure or take ownership of Three's context.
This is GPU render-texture integration, **not a unified renderer/shared render
pass/command encoder**, and not a proof that every possible integration performs
the same. Chrome already composites GPU-backed canvases; the integration replaces
that composition with our own texture/pass rather than making presentation free.

## Quality and layering constraints

Both measured paths render the same four widgets at **1920×1080 physical pixels,
DPR 1, High quality**, with the same antialiasing and display-referred colours.
The blend happens after ordinary world/viewmodel/FX/bloom/AgX/LUT processing; the
HUD is not exposed, fogged or tone-mapped again. No world quality changes.

The same-canvas path activates only when game/HUD physical dimensions match.
A scaled world or DPR-2 HUD above the game's DPR-1 cap would otherwise soften the
HUD. Those cases deliberately fall back to the separate canvas (including on
resize). Supporting different world/display resolutions needs a dedicated final
presentation stage, not a hidden quality reduction in this experiment.

Remaining native hurt/world-marker layers sit above the game canvas. They were
below the separate Pixi HUD, so embedding the HUD changes that ordering: e.g.
blood/flash now tints it. The **controlled** suite hides those two underlay layers
in **both** conditions to compare equivalent output. Their update code is still
running. The **live** suite retains all native layers, measures ordinary combat,
and explicitly is not visually equivalent under injury/marker overlap. Native
centre/chrome, hitmarkers, menus, equipment and other HUD remain above both paths.
Removing one canvas does not remove the remaining HTML/compositor workload.

## Method and results

AMD RDNA 4 hardware WebGPU, Chromium 156, High, 1920×1080 CSS/DPR1, fixed exposure.
180 warmup +900 measured frames/run, fixed seeded 60 Hz simulation; uncapped
headless rAF (frame limit/vsync disabled). Two runs per condition, separate → same
→ same → separate. Captures/readbacks and lifecycle checks are outside all timing.

Mean values averaged over the two runs in each condition:

| Suite                               | Presentation      | Observed frame interval | Engine CPU | CDP main-thread task/frame |
| ----------------------------------- | ----------------- | ----------------------- | ---------- | -------------------------- |
| Controlled, both underlays hidden   | Separate          | **5.30 ms**             | 4.53 ms    | 5.11 ms                    |
| Controlled, both underlays hidden   | Same final canvas | **5.50 ms**             | 4.59 ms    | 5.17 ms                    |
| Live combat, native layers retained | Separate          | **7.60 ms**             | 5.50 ms    | 6.22 ms                    |
| Live combat, native layers retained | Same final canvas | **7.77 ms**             | 5.65 ms    | 6.37 ms                    |

The same-canvas implementation was ~0.20 ms slower in the controlled sample and
~0.18 ms slower in the live sample. Individual runs overlap/noise remains; do not
claim a reliable general regression, much less a gain. The initial exploratory
controlled pair was essentially tied (5.27 vs5.26 ms). The repeated results do not
justify promoting this integration for performance.

CPU/frame/task values overlap; never add the columns. These measure uncapped
throughput and CPU/browser work, **not isolated GPU/compositor execution time** or
guaranteed real-play FPS. A built/preview controlled pair at ordinary vsync pacing
had engine median/p95 **5.1/7.4 ms separate vs5.2/7.2 ms same**, main-thread task
**6.10 vs6.13 ms**, and frame-interval p95 **16.8 ms both**: no FPS gain. No second-hardware or long-session claim. This compares
the existing _four-widget slice_, not a complete all-GPU replacement of all HTML.

All eight repeated runs matched: **25 player shots,227 AI shots,2 reloads,2 switches,
56.4784 m movement,1629.9480 damage**. One map upload and zero replaced native
minimap/ammo readout calls. Two visible presentation canvases vsone; one final GPU
blend per active measured frame. Shared device, zero WebGL requests, and only
Three destroys the device. Managed texture-source counts plateau after stress;
counts/capture-cache differences are not VRAM measurements.

Raw results/captures:

- `/tmp/pixi-canvas-controlled/results.json`
- `/tmp/pixi-canvas-live/results.json`
- `/tmp/pixi-canvas-first/` (exploratory pair and visual comparison)

## Reproduce

```sh
npm ci
npm test
npm run format:check
npm run build
node tests/e2e/pixi-hud.mjs --canvas --controlled --uncapped --rounds=2 --port=5201 --out=/tmp/pixi-canvas-controlled
node tests/e2e/pixi-hud.mjs --canvas --uncapped --rounds=2 --port=5201 --out=/tmp/pixi-canvas-live
node tests/e2e/pixi-hud.mjs --preview --canvas --controlled --rounds=1 --port=5201 --out=/tmp/pixi-canvas-built
```

The optional `--canvas` switch compares Pixi separate/same rather than HTML/Pixi;
`--controlled` hides only native hurt/world-marker underlays in both paths.
The harness rejects a purported same-canvas measurement if it actually fell back,
checks physical resolutions, visible presentation canvas count and per-frame blend
count, and retains live parity/lifecycle/resize/DPR2/fallback checks. Actual final
swapchain readback is capture-only; no screenshot composition enters runtime or
measurement. Smoke tests cover overlay ownership/unsubscribe, exact-resolution
gating, source/bind-group reuse, load-preserving blend and owned-resource cleanup.

No dependencies added. Default HTML and ordinary Pixi HUD presentation remain
unchanged. The old prototype's isolated menu/ammo diagnostics are unaffected.
