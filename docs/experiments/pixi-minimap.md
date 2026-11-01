# Minimap CPU simplification and bottom-HUD typography

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

## Decision and scope

The operator chose the simple bandage/grenade silhouettes. They are now the only
Pixi inventory appearance; original/text geometry branches, style types/options
and URL parsing are removed. Historical icon comparisons remain documented at
[pixi-accessory-icons.md](pixi-accessory-icons.md), reproducible at `3cb261b5`.
`?pixi=hud` still opts in; native HTML remains the default/initialization fallback.
The radio inventory indicator stays removed, with radio gameplay/panel untouched.

Bottom readouts now use `src/ui/pixi-type.ts`:

| Role             | Reference pixels | Uses                                                  |
| ---------------- | ---------------: | ----------------------------------------------------- |
| Primary value    |               32 | Current health and magazine count                     |
| Secondary count  |               16 | Maximum health, reserve ammo, bandages/grenades       |
| Supporting label |               12 | HEALTH/ARMOUR, fire mode, weapon name, reload warning |

The primary value rows and supporting title rows align across the bottom corners.
Health and magazine bars align at4px thickness; the armour bar remains secondary.
Chosen icon silhouettes use their16×20 reference size beside the larger stock
counts. Static maximum/armour label and separate changing strings remain: this
is not the previously rejected combined HP/max text-rasterization design.
Minimap micro-labels, compass/cardinals and unrelated native menus are not forced
into this bottom-readout hierarchy.

## What changed in the map

The earlier Pixi minimap **already uploaded its authored terrain once**. There
was no per-frame Canvas2D map redraw/upload to remove. This pass instead:

- Removes the decorative10m grid overlay, retaining background, border, north,
  terrain and60m span caption.
- Combines each building's name/code into one multiline Text instead of a
  container plus separate Text objects. All20 names/codes remain, with fitting
  and edge fading. The smaller code is no longer a separate translucent text run.
- Updates label edge fades only when the north-up map pans or initially bakes;
  turning in place cannot change their edge distances.
- Visits current/previous contact slots instead of writing all48 inactive slots;
  the48-contact capacity, friendly/enemy colors, headings, fades and9px inset
  clipping remain. Shrinking arrays hide their previous tail.
- Uses one retained filled triangle for the FOV cue. Scaling preserves its
  camera half-angle rays; the decorative curved far edge/stroke is gone.
- Scales retained unit search circles on radius changes rather than clearing and
  retessellating them. Search centers/radii, pulse clock and height-arrow
  threshold remain. The ring's outline now scales with radius instead of staying
  pixel-constant. Player marker remains on top; clipping/order/pause behavior stay.

No world, gameplay, renderer/device ownership, HTML minimap, dependency or source
terrain-bake changes. No independent ticker or additional runtime canvas.

## CPU measurements: Pixi before versus Pixi after

Baseline **`3cb261b5`**, candidate this revision; identical production world/assets,
native AMD RDNA4 / Chromium156, High1920×1080/DPR1. These are **isolated minimap**
measurements, not an HTML comparison and not the total UI/game-frame cost.

Mean CPU milliseconds per call:

| Injected snapshot case                                                  | Update before→after | Draw/submission before→after | One update + draw before→after |
| ----------------------------------------------------------------------- | ------------------: | ---------------------------: | -----------------------------: |
| Turn in place,5 contacts, fixed FOV                                     |     0.00156→0.00094 |              0.01710→0.01577 |                0.01869→0.01702 |
| Pan/turn,5 contacts, fixed FOV,1 fixed-radius search                    |     0.00162→0.00130 |              0.02450→0.02127 |                0.02656→0.02267 |
| Pan/zoom,5 contacts,1 fixed-radius search                               |     0.00271→0.00133 |              0.03285→0.02133 |                0.03596→0.02285 |
| Animated-geometry diagnostic:5 contacts, FOV and search radius changing |     0.00387→0.00137 |              0.04752→0.02019 |                0.05177→0.02192 |
| Stress:48 contacts, FOV and3 search radii changing                      |     0.01194→0.00771 |              0.08639→0.03478 |                0.09819→0.04293 |

Interpretation:

- Normal fixed-FOV movement saves about**0.003ms** drawing CPU in these runs;
  turn-only differences are around**0.001ms**, small relative to run variation.
- Zooming saves about**0.012ms** drawing CPU (~35%). The deliberately animated
  geometry diagnostic saves~0.027ms (~58%); the48-contact stress saves~0.052ms
  (~60%). Continuously changing search radii are **synthetic stress**, not a
  claim that ordinary gameplay always pays that rebuild cost.
- This widget was already inexpensive in CPU terms. Relative improvements do
  **not** establish a visible/capped FPS increase, GPU gain or compositor saving.
- Draw CPU is nested in the inclusive one-update+draw scope; never add those
  columns. Batched update is a separate scope, not another whole-frame latency.
  Rendering this widget alone also does not measure its exact marginal cost in
  the full HUD, where batching/state sharing can differ.

The pooled minimap scene falls **111→80 nodes** without search pools,114→83 with
one search,120→89 with three. Resident Graphics instructions fall by only2 in
each case: the important dynamic difference is avoiding rebuild/tessellation,
not just reducing a static instruction count. Every run keeps one map upload
and all20 original name/code strings.

### Method and retained evidence

`tests/e2e/pixi-minimap-cost.mjs` starts two built checkouts, boots/warm-loads the
same actual authored map, then detaches only the retained minimap stage and
renders it into a178×202 resolution-1 RenderTexture. Three and the rest of the
UI do **not** run inside timing. The widget returns to its parent afterwards;
GPU-readback screenshots and teardown are outside measurement.

Each case uses1024 precomputed deterministic snapshots. Fixture creation,
trigonometry and allocation are outside every CPU scope.240 warm draws each
perform20 updates, then one queue drain outside timing. There are1200 timed draw
samples, each with a separately timed20-update batch plus one update/draw pair.
The pass uses the existing borrowed-device Pixi renderer. It measures synchronous
CPU traversal, geometry preparation and WebGPU submission—not GPU execution,
queue fences, browser composition, world rendering or live AI costs. Short loop,
clock and snapshot-selection overhead remains.

`performance.now()` is quantized at roughly0.1ms here: individual draw medians
are often zero and cannot represent intrinsic per-draw cost. Reported means pool
1200 samples per run; update scopes batch20 calls. Do not overinterpret tiny
steady-state deltas or extrapolate precise per-label/per-contact costs.

All **44 trials in complete ABBA blocks** are retained: two blocks each for turn,
pan, ADS and animated-geometry diagnostic; three blocks for busy. A180s harness
timeout interrupted the next busy block after two trials. Those two are retained
but excluded as an incomplete block, not as performance outliers. The first busy
block completed before timeout and **is included**. Two new complete busy blocks
followed. An earlier pilot accidentally included fixture advancement in update
CPU; it is explicitly excluded, with its data retained. Functional-browser runs
are validation, not replacement before/after performance claims.

Per-run summaries, exact value/count histograms for every timed sample, source
hashes, included/excluded selections and artifact references:
[pixi-minimap.results.json](pixi-minimap.results.json). Full ordered timings and
captures remain in `/tmp/pixi-map-final`, `/tmp/pixi-map-busy` and
`/tmp/pixi-map-controls`; pilot in `/tmp/pixi-map-initial`.

### Reproduce

```sh
git worktree add ../Claude-of-Duty-pixi-minimap-before 3cb261b5
(cd ../Claude-of-Duty-pixi-minimap-before && npm ci && npm run build)
npm ci && npm run build
node tests/e2e/pixi-minimap-cost.mjs --rounds=2 --out=/tmp/pixi-map-repro
# Shorter independent cases:
node tests/e2e/pixi-minimap-cost.mjs --scenario=pan,ads --rounds=2 --out=/tmp/pixi-map-controls
```

Default cases run40 pages; allow several minutes. `--before` overrides the
baseline checkout and `--port` overrides the paired preview ports. Historical
icon `--icons` comparison mode now rejects with a checkout instruction rather
than silently measuring identical retired variants.

## Correctness / visual acceptance

- Fresh install; **156 smoke tests**, formatting/typecheck/lint/build pass.
- New unit checks prove FOV/search geometry is retained while angles/radii change,
  contact tails disappear, height arrows/pause remain and readouts use shared sizes.
- Production hardware native/Pixi/default/fallback, portrait/DPR2, empty/multi-digit
  equipment, hit kinds/arcs, reload/health/armour, injury, hidden-native-DOM
  suppression, paused FPS, shop/death/restart/Start/terminal and teardown pass.
- Source counts plateau58/58/58 (DPR2:56/56/56), one map upload, borrowed device
  not destroyed by Pixi; zero WebGL requests/device-loss/validation errors.
- Isolated ammo-only production lifecycle/DPR2/fallback regression also passes.
- Before/after captures normalize health/ammo and inject `123 FPS` **outside
  timing**. They show the authored map/current spawn, not measured gameplay FPS.
  Benchmark contact/FOV/search states are injected fixtures, not new producers.

HTML default and longer-session/second-hardware acceptance remain unchanged.
