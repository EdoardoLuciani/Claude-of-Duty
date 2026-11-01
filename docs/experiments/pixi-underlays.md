# Pixi injury overlays

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

`?pixi=hud` renders blood edges, heartbeat vignette and hit flash through the same
Pixi canvas. `?pixi=hud&underlays=html` retains native injury for comparison.
Omitting Pixi still uses the native UI throughout. The later
[combat extension](pixi-combat.md) also migrates compass, hitmarkers/damage arcs,
equipment and FPS, retaining their gameplay state/events.

## Removed unused marker UI

The pre-Pixi code had no gameplay caller of `ui.spawnGrenade()`, and nothing
populated `ui._objectives`. Thus these overlays were dormant, not missing because
of a diagnosed rendering bug. Earlier screenshots injected objective/grenade
markers explicitly to test their presenters; they were not normal gameplay cues.
At the operator's request both HTML and Pixi projected marker/grenade-warning
renderers, their styles/pools, spawning API, objective-list plumbing and injected
fixtures have now been removed. Actual grenades, explosions, minimap contacts/
search areas, hitmarkers and directional damage arcs are unchanged.

The measurements below are historical, from before this removal; they are not a
new performance claim for the cleanup. They exercised injury during combat and
had no live objective/grenade HUD markers in their timed phases.

Cleanup validation:150 smoke tests, formatting/typecheck/lint/build, source and
production hardware checks passed. Both backends and fallback have no projected
marker owner/API/layer nodes. Injury pixels, zero hidden injury DOM mutations,
independent HUD fade, pause/shop/death/restart/Start/error, resize/DPR2 and shared
device ownership remain checked. Ammo/health texture stress plateaus at38/38/38
sources (DPR2:35/35/35); the map still uploads once. This is not a new benchmark.

```sh
node tests/e2e/pixi-hud.mjs --uncapped --rounds=1 --port=5211 --out=/tmp/pixi-no-markers-source
node tests/e2e/pixi-hud.mjs --preview --underlays --uncapped --rounds=1 --port=5211 --out=/tmp/pixi-no-markers-built
```

## Ownership and presentation

- Existing `HealthFx` owns damage/heartbeat/healing animation state. The same
  update publishes blood opacity/scale, beat opacity and flash opacity for either
  presenter. Native injury DOM writes are skipped in Pixi mode, not merely hidden.
  Low-health desaturation/other existing WebGPU game effects are unchanged.
- One WebGPU-only Pixi Mesh evaluates the existing CSS gradient stops/positions:
  the enlarged/scaled blood vignette, four asymmetric edge spots, beat and flash.
  Colours use premultiplied source-over, including CSS layer/group opacity.
  No per-frame Canvas2D bakes/uploads, fullscreen filter chain, GLSL or WebGL path.
- The mesh is skipped when healthy/no flash. Its geometry/program are owned by
  the UI and explicitly released; the game's borrowed device is never destroyed.
- Layering is **injury → minimap/readouts/crosshair** in Pixi, below remaining
  native centre/chrome/menu layers. Readouts fade with HUD visibility; injury
  stays independent during pause/death/HUD hiding. The canvas hides only when
  its content is absent or Start/error owns presentation. Static paused content
  does not redraw after the group fade settles.
- The native hurt container remains for fallback, hidden with no mutations behind
  Pixi. Other HUD/menu presenters remain native. Map backgrounds stay retained
  and readouts panel-free.

## Historical comparison (before marker cleanup)

AMD RDNA 4, Chromium156, High,1920×1080CSS/DPR1; fixed exposure and seeded60Hz
simulation.180warmup/900measured frames per run, uncapped headless. Same branch,
HUD style, game rendering and remaining UI. HTML underlays → Pixi → Pixi → HTML
underlays, two runs each. Capture/readback and all mutation/functional probes are
outside timing. Timings overlap; never add the columns.

| Underlays    | Mean frame interval | Engine mean | Whole UI update mean | Main-thread task/frame |
| ------------ | ------------------- | ----------- | -------------------- | ---------------------- |
| HTML/CSS/SVG | **7.79ms**          | 5.65ms      | 0.270ms              | 6.38ms                 |
| Pixi         | **5.81ms**          | 4.86ms      | 0.232ms              | 5.47ms                 |

~**1.98ms /25% lower observed frame interval**, and ~0.92ms lower main-thread task
per frame, in this small uncapped sample. Individual frame means were7.75/7.83ms
HTML and5.90/5.71ms Pixi. Not a guaranteed real-play FPS gain or separate GPU timing.
The earlier ~0.18msCPU/~0.054msGPU attribution applied to the four-widget slice,
**before this fullscreen/marker extension**, not the complete updated Pixi HUD.
No second-hardware or long-session performance validation yet.

Two built/preview pairs with ordinary vsync pacing had engine median/p95
**6.0/7.8 → 5.6/7.6ms** and **6.1/7.6 → 6.1/8.2ms** (HTML → Pixi).
Main-thread task/frame was **6.93 → 6.49ms** and **6.97 → 7.04ms** respectively;
this variability does not establish a consistent capped CPU improvement.
Frame-interval p95 remained **16.8ms throughout**: no demonstrated FPS gain at the
60Hz cap. Built results/captures: `/tmp/pixi-underlays-built/` and
`/tmp/pixi-underlays-stress/`.

All four runs matched25player shots,227AI shots,2reloads,2switches,56.4784m movement,
1629.9480damage. The combat fixture has no live objective/grenade HUD markers, so
this result primarily tests injury presentation; no isolated marker speedup is
claimed. Explicit post-timing fixtures cover three front/side/behind objectives,
distance/name text, grenade warning and injury together. Native underlay mutation
counts are zero in Pixi mode and nonzero in the HTML comparison. Map still uploads
once. Repeated moving-distance marker/grenade, ammo and health stress warms the
texture buckets then plateaus: **50 → 53 → 53** at DPR1 and **48 → 50 → 50** at
DPR2 in the final built stress run. These are source counts, not VRAM bytes.

Source results and before/after captures: `/tmp/pixi-underlays-abba/`. Native/Pixi
injury captures use the same seeded combat, normalized pose/state and65damage
six frames before capture. Their displayed FPS counters reflect later capture
work, not the timing loop. Capture readback now correctly unpremultiplies colour
for ImageData; no readback/capture changes enter runtime rendering.

## Validation / reproduction

```sh
npm ci
npm test
npm run format:check
npm run build
node tests/e2e/pixi-hud.mjs --underlays --uncapped --rounds=2 --port=5207 --out=/tmp/pixi-underlays-abba
node tests/e2e/pixi-hud.mjs --preview --underlays --rounds=1 --port=5207 --out=/tmp/pixi-underlays-built
```

Current smoke tests compare native/presentation-disabled health state and prove
model-only updates do not write DOM styles. Removed marker APIs/layers are checked
as absent, rather than hidden. Synthetic marker checks were removed with the feature. Hardware fixtures check
actual GPU injury pixels, no hidden native mutations, transparent uninjured
readouts, independent injury/HUD visibility, resize/DPR2, paused redraw suppression,
texture plateau, native init fallback, shared device, zero WebGL requests and
shop/death/restart/Start/terminal teardown behavior. Default native HUD remains.

The benchmark's `--underlays` flag now compares just injury presentation; without
it the existing HTML/Pixi whole-HUD comparison remains available.
