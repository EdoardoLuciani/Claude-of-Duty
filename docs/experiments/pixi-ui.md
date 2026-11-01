# PixiJS UI experiment

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

## Try it

Run the game with `?pixi=1`, then press Escape to open the pause menu. A Pixi panel
appears beside the existing settings; the control reference moves below both.
Without the query parameter, the native UI is unchanged and Pixi is not loaded.
The follow-up `?pixi=ammo` selects the real ammo/reload HUD instead; see
[its combat measurements](pixi-ammo.md). Only one Pixi trial runs at a time.

The panel contains text, a vector feedback preview, a Pixi UI slider and two Fancy
Buttons. Drag the slider, click Test Feedback / Reset, or focus the canvas and use
left/right, Enter and R. Escape still resumes through the existing pause system.
These controls affect only the demo, not settings, weapons, credits or gameplay.

Dependencies are pinned to `pixi.js` 8.22.0 and `@pixi/ui` 2.4.1. This is a separate
experiment from the hand-written GPU crosshair; neither depends on the other.

## What worked

- Pixi's `gpu` initialization option accepts the **existing Three GPUDevice**.
  Browser instrumentation observes exactly one device request, and object identity
  confirms both renderers use that device. Three does not retain its adapter, so
  the experiment makes another adapter query for metadata, not another device.
- Pixi owns a **separate renderer and canvas** inside the HTML pause layout. It does
  not borrow Three's renderer or draw into the game canvas. This deliberately avoids
  a presentation/world-resolution refactor and raw cross-engine texture sharing.
- The panel uses independent display resolution, capped at DPR 2, and MSAA. At a
  960×900 CSS viewport / DPR 2 / low quality, the world buffer was 691×648 while the
  480×360 CSS panel used a 960×720 buffer. Text remained legible and sharp.
- The library supplies text handling, vector graphics, button states, pointer hit
  testing and slider dragging. No custom shaders, font atlas implementation or
  manual slider drag calculations are needed in application code.
- There is no Pixi Application or render ticker. Existing UI raw-time updates drive
  the small feedback animation; unchanged or hidden content is not redrawn.
  Pixi still registers its separate interaction ticker: zero draws do not mean
  zero background CPU work.
- Teardown destroys Pixi-owned resources, not the supplied device. A subsequent
  world render succeeds; only final Three teardown destroys the device.

## Integration friction

Even explicit `WebGPURenderer` constructs backend-independent shaders that prepare
GLSL programs. `GlProgram` probes maximum fragment precision by opening a diagnostic
WebGL context. That violated this project's strict WebGPU-only policy in the first
trial, despite all actual rendering using WebGPU.

The final experiment uses Pixi's supported `DOMAdapter` to deny WebGL contexts on
Pixi-created internal canvases. A per-canvas proxy returns null for WebGL requests;
2D text canvases and WebGPU remain available. No browser prototype, library file or
shader source is patched. The previous Pixi adapter is restored at teardown, even
when owned-resource cleanup throws. This is scoped to the single experiment, not
infrastructure for arbitrary concurrent Pixi applications.

The hardware harness observes zero native WebGL context requests in the final path.
It also tests that failure to obtain adapter metadata leaves the native menu usable
with an explicit status message, rather than failing the game. Follow-up repairs
cover constructor/build failures and owning-UI cleanup even if Pixi disposal throws.
Hover/pressed/release-outside/cancel invalidation now uses actual widget signals;
listening on the passive stage was insufficient and is covered by redraw tests.

## Cost observations

Measured in hardware Chromium WebGPU on AMD RDNA 4, with low-quality gameplay behind
the paused menu. Timings below are warmed **synchronous CPU rendering/submission**,
not GPU execution time, browser composition, input dispatch, initialization or FPS.
The browser timer has approximately 0.1 ms granularity; do not overinterpret small
differences between the viewports.

| Probe                                                | 1920×1080 CSS / DPR 1 | 960×900 CSS / DPR 2 |
| ---------------------------------------------------- | --------------------: | ------------------: |
| Forced unchanged-content redraw, median (60 samples) |               ~0.3 ms |             ~0.2 ms |
| Changing slider/text redraw, median (120 samples)    |               ~0.6 ms |             ~0.6 ms |
| Native draw commands per dirty redraw                |                     5 |                   5 |
| Additional redraws over 30 idle frames               |                     0 |                   0 |
| Additional redraws over 30 closed-menu frames        |                     0 |                   0 |
| Managed texture-source count, before / after probe   |               13 / 13 |             13 / 13 |

Texture counts are not VRAM bytes or all native GPU attachments. This panel's
ordinary Pixi Text uses cached Canvas2D-rasterized text uploaded as GPU textures;
changing a string is more work than reusing a cached label. “GPU UI” does not mean
all text shaping/rasterization runs on the GPU.

The production build adds roughly 0.5 MB of minified optional chunks (~150 KB gzip,
including renderer/environment chunks), not just the widget code. It adds fourteen
installed dependency packages. Default browsing does not download the Pixi modules;
the browser harness verifies the default dev-server and built-preview request paths.

No HTML-equivalent panel benchmark or end-to-end GPU/FPS comparison was performed.
These observations demonstrate bounded cost, not that Pixi is faster than HTML.

## Simplicity / recommendation

This is a more meaningful library test than a crosshair. Roughly 225 lines of
initial prototype code plus about 30 lines of integration produced text, two skinned buttons,
a slider, feedback, keyboard shortcuts and resource lifetime without hand-writing
the rendering/interaction machinery. Much of the remaining code is styling, fixed
positioning and the explicit integration policy.

However, Pixi is a rendering engine and Pixi UI is a widget collection, not a complete
CSS replacement. This trial does not use a general layout engine. It still needs
application styling, sizing, invalidation and keyboard policy. The canvas has a
label and shortcuts, **not per-widget accessible semantics or full focus navigation**.
An accessibility bridge (potentially Pixi's optional DOM accessibility layer) would
need its own evaluation before replacing native controls.

**Keep it opt-in, but Pixi is a credible candidate for a future styled GPU interface.**
It saves substantial UI-engine implementation compared with writing everything in
Three/TSL. It has not demonstrated a net benefit over the current HTML menu, and a
whole-UI migration is not justified by this small experiment. No market rewrite,
world-asset changes, second GPU device, new external runtime assets or full-resolution
main-canvas refactor are included.

## Reproduce / validation

```sh
npm ci
npm test
npm run lint
npm run build
node tests/e2e/pixi-ui.mjs --out=/tmp/pixi-ui
node tests/e2e/pixi-ui.mjs --preview --out=/tmp/pixi-ui-built
```

The browser harness saves raw results and before/after/DPR-2 captures. It checks the
normal path, the enabled panel, high-DPI rendering and simulated adapter-metadata
failure. It exercises real pointer dragging/button clicks, keyboard shortcuts,
Escape, pause/resume, no idle rendering, stable measured texture counts and device
ownership during teardown. Captures use native target readback plus browser DOM
composition to avoid headless Vulkan's potentially blank swapchain screenshots.
Smoke coverage checks guarded entry, demand rendering, raw-time feedback and
failure-isolated/idempotent cleanup.

For built-preview tests, the harness first waits up to 15 seconds for hardware
adapter metadata on a plain local page. Cold headless Chromium 156 sometimes
returned null for the default game's first adapter request when loading the much
faster minified bundle; source-mode tests did not encounter it. This preflight
creates no GPUDevice, does not accept software fallback, and changes no game boot
logic. Both default and enabled production paths pass with that explicit harness
preflight. Warming is excluded from the one-device counters and render timings.
