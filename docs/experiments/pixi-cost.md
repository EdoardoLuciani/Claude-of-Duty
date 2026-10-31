# Isolated Pixi CPU / GPU attribution

**The current four-widget slice does not show a 1 ms GPU UI cost.** Its measured
active presenter + renderer CPU-side wall time is about **0.175 ms/frame** and its
GPU render pass about **0.053 ms/frame** on this machine. CPU and GPU overlap;
these are not an additive prediction of frame-interval change.

This answers a different question from comparing complete HTML/Pixi game frames
or separate/same canvases. Those whole-frame comparisons did not isolate Pixi.
There is no native egui benchmark here, so no claim of equal native-library cost.

## Fixed conditions

AMD RDNA 4 hardware WebGPU, Chromium 156, High, 1920×1080 CSS and physical pixels,
DPR 1, same four-widget separate-canvas HUD (`?pixi=hud`), same antialiasing and
fixed exposure. Remaining native injury/world-marker/compass/menu/equipment/etc.
presentation and update code stays unchanged and active. No world/viewmodel/FX
or post-processing changes, resolution reduction or UI styling changes.

Every page initializes and warms the **full** Pixi HUD for 180 frames before any
condition is applied. Native replacement widgets remain disabled throughout all
conditions. Thus this measures incremental **active work**, not library setup,
GPU residency or any idle interaction-ticker cost common to initialized instances.

| Condition | Pixi presenter updates | Pixi render calls | Canvas visible |
| --------- | ---------------------- | ----------------- | -------------- |
| none      | No                     | No                | No             |
| update    | Yes                    | Stubbed           | No             |
| hidden    | Yes                    | Yes               | No             |
| full      | Yes                    | Yes               | Yes            |

The hidden-render control still submits normal drawing, but a browser may treat
invisible canvas resources differently; it is not a pure compositor stopwatch.
Presenter-only timing excludes renderer-side scene processing, text rasterization,
uploads and draw submission, which are included in the real renderer call.

900 fixed-60-Hz combat frames per run, uncapped headless callbacks. Four repeats
per condition (16 source runs), balanced order:

1. none → update → hidden → full
2. full → hidden → update → none
3. update → none → full → hidden
4. hidden → full → none → update

Production preview repeats one complete four-condition set. No timestamps,
readbacks, screenshots or queue fences enter either throughput measurement.
CPU-side timers measure wall time inside synchronous calls, not CPU hardware cycles.
The browser timer is coarse for very short calls; use means over 900 samples, not
the frequently zero presenter-only median.

## Scoped results

Mean per frame, source full averaged over four runs:

| Work                                                       | Source        | Production check |
| ---------------------------------------------------------- | ------------- | ---------------- |
| Presenter updates only (update condition)                  | **0.030 ms**  | **0.034 ms**     |
| Renderer preparation/submission CPU-side (full)            | **0.145 ms**  | **0.151 ms**     |
| Entire Pixi update CPU-side, **including renderer** (full) | **0.175 ms**  | **0.185 ms**     |
| Pixi GPU render-pass duration                              | **0.0532 ms** | **0.0536 ms**    |
| Pixi GPU render-pass p95                                   | **0.0572 ms** | **0.0575 ms**    |

The inclusive CPU row already contains renderer work: do not add it to the
renderer row. The hidden-render condition's inclusive CPU mean was 0.182 ms,
close to visible rendering. Full update CPU p95 was about 0.3 ms. There is no
measured 1 ms Pixi drawing component in these results.

### GPU method and limits

A **separate** 900-frame diagnostic replay measures actual WebGPU timestamps,
sampling every sixth frame (150 samples). Only command encoders/render passes
created synchronously inside Pixi's `renderer.render()` are instrumented. Native
Three passes are untouched. There are **one render pass and five draw calls** in
every captured Pixi sample. Queries are accumulated and resolved/read back **once,
after the complete replay**, avoiding per-sample queue fences/pacing distortion.
All temporary method wrappers and owned GPU query/buffer resources are restored
or destroyed in `finally` blocks; none enter runtime code.

Render-pass GPU duration excludes external texture uploads/copies, CPU work,
queue waiting and browser compositing/presentation. Renderer CPU-side time includes
CPU preparation/upload submission. The replay recorded **39 texture-upload calls
on 31 of 900 frames** (not every frame), and 1845 buffer-write calls. These are API
call counts, not byte bandwidth or extra milliseconds. No GPU upload-duration claim.

## Whole-frame results: do not over-interpret

Average per-run mean, source:

| Condition | Frame interval | Engine step | Main-thread task/frame |
| --------- | -------------- | ----------- | ---------------------- |
| none      | 7.29 ms        | 5.21 ms     | 5.90 ms                |
| update    | 7.41 ms        | 5.31 ms     | 6.01 ms                |
| hidden    | 7.44 ms        | 5.38 ms     | 6.07 ms                |
| full      | 7.06 ms        | 5.26 ms     | 5.94 ms                |

**This is not evidence that rendering the HUD makes the game faster.** Whole-frame
callback pacing/run variation is larger than the isolated small cost: full run
means ranged 6.24–7.41 ms despite similar engine/update times. No outlier was
discarded. This matrix cannot assign a precise small incremental frame cost or a
browser-compositing duration. Task/engine/Pixi times overlap; never sum the columns.

The production single-set absent/full comparison was **7.25 → 7.43 ms** frame
interval, **5.17 → 5.35 ms** engine time and **5.85 → 6.04 ms** main-thread task
(about 0.18–0.19 ms extra). That is consistent with the scoped CPU budget, but
one pair is not a guaranteed FPS prediction. The directly scoped CPU/GPU results
were much more stable between source and production than callback intervals.

All 16 source runs matched exactly: **25 player shots,227 AI shots,2 reloads,
2 switches,56.4784 m movement,1629.9480 damage**. Actual presenter/render call counts
are asserted (0 or900 as appropriate), as are unchanged visible native underlays,
shared device, disabled native replacements and equal physical resolutions.

## Interpretation

The egui/native-Vulkan intuition was reasonable: five batched UI draws are cheap
on this GPU. Our earlier whole-frame numbers were not a measurement of Pixi-only
cost. Remaining HTML, browser paint/composition, world rendering and scheduling
still account for most of the frame. This is a **four-widget slice**, not a full
all-GPU HUD or menu suite; more text/filters/geometry and higher DPR can cost more.
No second-hardware validation or isolated native egui comparison is implied.

## Reproduce / artifacts

```sh
npm ci
npm test
npm run format:check
npm run build
node tests/e2e/pixi-cost.mjs --rounds=4 --out=/tmp/pixi-cost-balanced
node tests/e2e/pixi-cost.mjs --preview --rounds=1 --out=/tmp/pixi-cost-built
```

- Durable run summaries and all 150 GPU samples per source/production replay:
  [pixi-cost.results.json](pixi-cost.results.json).
- Raw local results: `/tmp/pixi-cost-balanced/results.json` and
  `/tmp/pixi-cost-built/results.json`.
- Test-only GPU probe: `tests/lib/pixi-gpu-timing.mjs`.
- No runtime code, dependencies or visual changes in this measurement commit.
