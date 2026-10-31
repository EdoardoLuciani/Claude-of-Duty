# GPU crosshair experiment

## Verdict

**Keep HTML as the default. This experiment does not justify migrating the HUD.**

A bounded shader quad can reproduce the crosshair reasonably well and removes its
DOM updates. However, it requires more code, adds a render submission every visible
frame, and loses sharpness when the canvas is upscaled. It also moves below HTML
damage overlays. No end-to-end performance improvement was demonstrated.

The useful merit is an inexpensive place for future shader-specific reticle effects
or canvas-only HUD capture. That is a capability, not a reason to port the existing
UI. This is not an immediate-mode widget system and does not change the market.

## Try / reproduce

- Normal play: `/?crosshair=gpu` opts in; omit it or use `crosshair=dom` for HTML.
- Both paths use the same spring, spread, ADS, hit and flinch animation code.
- The GPU path creates no crosshair DOM nodes. It uses the existing renderer/device,
  one plane, one material and no extra texture or render target.
- There are no new dependencies, changes to quality sizing, or menu conversions.

```sh
npm ci
node tests/e2e/crosshair.mjs --q=high --frames=120 --out=/tmp/crosshair-high
node tests/e2e/crosshair.mjs --q=medium --frames=120 --out=/tmp/crosshair-medium
node tests/e2e/crosshair.mjs --q=low --frames=120 --out=/tmp/crosshair-low
```

The harness writes `results.json` and paired PNGs for normal/bright backgrounds,
render scales 1 / 0.8 / 0.72, damage flash, and a narrow viewport at DPR 2. It uses
native target readback followed by browser DOM composition, because headless Vulkan
swapchain screenshots can be blank. The ordinary native capture helper renders
only the world graph; this harness explicitly includes the experimental HUD slot.

## Measurements

Hardware Chromium WebGPU reported AMD RDNA 4, non-fallback. Measurements below used
a 1920 × 1080 CSS viewport at DPR 1, deterministic `hero` capture, and the actual
high/medium/low presets. These are one-machine experiments, not a portable benchmark.

### Synchronous work and GPU cost

| Preset | HTML update, median | GPU update, median | GPU draw submission, mean | GPU HUD pass, median |
| ------ | ------------------: | -----------------: | ------------------------: | -------------------: |
| High   |             4.25 µs |           0.045 µs |                    ~30 µs |              4.60 µs |
| Medium |             4.18 µs |           0.040 µs |                    ~24 µs |              4.48 µs |
| Low    |             4.18 µs |           0.040 µs |                    ~28 µs |              4.68 µs |

Update timings use nine batches of 20,000 scripted updates after two warmup batches.
They isolate animation/presentation update code, **excluding deferred browser style,
paint and compositing**. They benefit from batching/JIT optimization and are not
complete per-frame UI costs. The GPU update avoids transform-string formatting and
style writes, but its additional draw-submission CPU cost exceeds that measured
saving. Browser timer quantization is 0.1 ms for individual draw samples; the mean
across 120 frames is only an approximate estimate, not precise microsecond timing.

The native timestamp phase separately measures only the HUD render pass over 60
samples. It does not include world rendering, queue wait, copies, browser composition
or presentation. GPU timestamp queries/readbacks are disabled during CPU sampling.
The HTML path has **not** been assigned zero total GPU cost: browser rendering of
DOM layers is outside this renderer's counters.

Full engine-step medians, HTML / GPU respectively, were 4.3 / 4.5 ms (high),
4.3 / 4.2 ms (medium), and 3.9 / 4.1 ms (low). These exclude deferred browser work,
are noisy, and do not show a consistent improvement. They are not FPS measurements.

### Work / resource counts

- Animated feedback over 120 frames: HTML made 472 observed style mutations; GPU
  made zero. Both made zero crosshair style mutations in a settled 30-frame probe.
- GPU adds exactly **one draw / two triangles** per visible frame, including when
  stationary. Fully faded/disabled crosshairs submit nothing.
- GPU adds one geometry and two renderer shader-stage records; texture count is
  unchanged. Counts stayed stable during each measured run. These are not VRAM-byte
  measurements, and do not account for browser-owned DOM/compositor resources.
- First-use shader compilation is excluded from warmed timings.

A first naive implementation also triggered Three's implicit full-screen output
conversion, adding an unintended second draw. The final experiment avoids it:
white/black shader output is already display-referred, and the renderer temporarily
uses no tone mapping / linear output settings just like its final pipeline draw.
This preserves the encoded world beneath it without a second color conversion.
The changed state is restored even if drawing fails.

## Simplicity / appearance

The existing presenter is six DOM elements and roughly twenty lines of CSS; the
animation class is shared either way. The prototype adds about 180 runtime lines,
including a roughly 150-line GPU presenter and the small render/UI integration.
It trades declarative CSS for distance-field masks, coverage, shadows, color/blend
handling and explicit resource lifetime. It is **not simpler for this crosshair**.

At full resolution the result is visually close, though the shader shadows and
antialiasing are an approximation rather than pixel-identical CSS. Captures show:

- At render scale 0.72, the GPU crosshair softens with the world; HTML stays sharp.
- At a narrow DPR-2 viewport, subpixel GPU blades lose considerably more definition.
  Shader coverage prevents harsh geometric edges but cannot restore missing pixels.
- A damage flash tints the GPU crosshair, because all HTML overlays are above the
  canvas. The current HTML crosshair remains above that flash.
- On a bright sky background, the shader's dark seat preserves basic readability.

Fixing sharpness would require separate presentation/world resolution. Fixing the
HTML injury-layer ordering would require another composition decision. Neither is
silently included in this prototype.

## Validation and boundaries

Smoke coverage verifies identical animation state for 1,200 scripted updates,
including firing, flinch, hit pulse, ADS, stance, zero dt, hidden state and scaling.
It also checks no GPU-path DOM creation, draw skipping, failure-safe render-state
restoration and owned-resource disposal.

Hardware browser checks cover the three quality presets, one active presenter,
one added draw, stable measured resource counts, HUD hide/show, pause/resume, ADS,
death/restart, Start-gate suppression, teardown, resize/DPR probes and WebGPU errors.

This is enough to retain an opt-in experiment, not accept a production replacement.
Text, widgets, accessibility, general batching, the market, full-resolution output,
and a whole-UI rewrite remain out of scope. No claim is made for integrated-GPU
performance, reduced GC, lower total VRAM usage, or a statistically significant
end-to-end speedup.
