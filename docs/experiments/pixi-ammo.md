# Pixi ammo / reload HUD trial

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

## Try / scope

Use `?pixi=ammo` for the real ammo/reload HUD. Omit the parameter for HTML.
`?pixi=1` still selects the original pause-panel experiment instead. The two modes
are mutually exclusive: one Pixi renderer/canvas and one scoped DOM-adapter owner.
Default browsing does not load Pixi. No new dependencies beyond the initial trial.

The bounded, pointer-transparent canvas sits **inside the original AmmoPanel in
chromeLayer**. It inherits HUD opacity, damage/menu layering and the existing scale
policy. It has its own display-resolution buffer (DPR capped at 2), independent of
world render scale. It does not change Three's frame graph or use a fullscreen
high-DPI overlay. Equipment icons/counts stay native, above the firearm readout.

The canvas displays actual weapon name/mode, current/reserve ammo, magazine pips,
low/empty colors, fire punch, reload progress and the pulsing empty prompt. Inputs
are the existing `AmmoState` snapshot, with no weapon/gameplay writes. Both paths
use the same magazine-pip function. The native firearm presenter is not updated or
visible when the Pixi path is active; only equipment uses the native update path.
A failed optional initialization leaves HTML available.

This is one product slice, not an interface framework, menu migration, bitmap-font
project, market rewrite, or cross-engine texture-compositing system.

## Prototype repairs included first

- Hover, pressed, release-outside and cancellation invalidate from widget signals,
  not a passive stage. Browser tests verify state **and a subsequent draw** before
  another action can hide the defect. Cancel/blur also clear pressed feedback.
- The adapter is acquired outside construction and restored for field-initializer
  failures. Throwing setup/callback registration runs inside a guarded build step
  after the owner exists, so cleanup can abort registered callbacks too.
- A Pixi cleanup exception no longer skips native UiSystem cleanup. Ownership is
  detached before cleanup, and the remaining UI is released in `finally`.
- Shared device initialization/strict-canvas policy is a small two-consumer helper,
  not a general UI abstraction. Supplied devices are never destroyed by Pixi.
- The wording is corrected: no Application/render ticker, but Pixi does install an
  interaction ticker. Zero idle redraws are not zero background CPU activity.

## Combat measurements

Hardware Chromium WebGPU, AMD RDNA 4, low quality, 1920×1080 CSS / DPR 1. Reused the
repository's living-combat fixture: 900 fixed-60-Hz simulation frames per run after
90 warmup frames. The browser is vsync-paced. Timings exclude captures and targeted
functional fixtures; this is not a maximum-throughput or GPU-execution benchmark.

Every measured run produced the same 25 player shots, 250 AI shots, two completed
reloads, two weapon switches, ~56.45 m travel and ~1613.14 damage received. Finite
large health pools keep actors alive while normal sensing, movement, firing,
physics, damage and effects execute. HUD values are checked during the run.

Order was HTML → Pixi → Pixi → HTML to expose run-order noise:

| Run    | Engine-step median / p95 | Browser frame-interval p95 | Main-thread TaskDuration/frame |
| ------ | -----------------------: | -------------------------: | -----------------------------: |
| HTML 1 |             5.8 / 7.2 ms |                    16.8 ms |                        7.06 ms |
| Pixi 1 |             6.1 / 7.9 ms |                    16.8 ms |                        7.28 ms |
| Pixi 2 |             6.0 / 7.5 ms |                    16.8 ms |                        7.16 ms |
| HTML 2 |             6.2 / 7.6 ms |                    16.8 ms |                        7.36 ms |

The ammo update's p95 was approximately **0.1 ms HTML versus 0.3 ms Pixi**. Pixi is
not a free rendering substitution. The first adjacent engine-step pair exceeded
our proposed 5% investigation threshold (~9.7%); the reversed pair did not (~−1.3%).
There is no repeatable >5% whole-frame result in this small sample, but this is not
proof of parity: vsync masks throughput differences, the timer is quantized around
0.1 ms, and one hardware/browser configuration is insufficient for promotion.

A separate built-preview check gave engine-step p95 7.1 ms HTML / 7.2 ms Pixi and
frame-interval p95 16.8 ms for both. These correctness runs are not additional
statistical evidence of a speedup. No GPU execution/compositor timings were taken.

CDP TaskDuration includes deferred main-thread work and fixture overhead; it is not
UI-only time, GPU work or worker CPU. The engine-step measurements omit deferred
browser style/layout/composition. Raw metrics and full activity counters are saved
by the harness, rather than collapsing everything into one FPS claim.

## Resources / rendering

- Settled live HUD: zero extra redraws over 30 frames; likewise when paused and
  unchanged. Fire punch, reload progress and the empty prompt intentionally redraw
  while their visible animation changes. Faded/Start-gated HUDs submit no draws.
- The first combat cycle increased managed texture sources from 8 to 11. Ordinary
  Pixi Text returns differently sized raster textures to its power-of-two pool;
  it does not necessarily destroy a source on each string change.
- After functional/capture probes, three repeated 60-state stress cycles held at
  **18 → 18 → 18 → 18** sources. Counts are not VRAM bytes, all GPU attachments, or
  a proof against every possible leak. Changing text has a real raster/upload cost.
- At fixed window size, render scales 1 / 0.8 / 0.72 changed the world buffer but
  not the ammo buffer. Both DPR 1 and DPR 2, narrower windows and resize were tested.
- Hardware checks observed one logical device, zero native WebGL context requests,
  and sole device destruction by Three at final engine teardown.

The usual Pixi interaction ticker still exists. This read-only canvas has no tab
stop, uses `pointer-events:none`, and disables stage interaction. Pointer hit tests
at its position resolve to the game canvas, so it cannot steal firing/pointer lock.
It is not a full accessible-widget implementation; native menus/start/error UI
remain available, and the readout is a labelled image rather than a live announcer.

## Validation / reproduce

```sh
npm ci
npm test
npm run lint
npm run build
node tests/e2e/pixi-ui.mjs --preview --out=/tmp/pixi-prototype-fixed
node tests/e2e/pixi-ammo.mjs --rounds=2 --out=/tmp/pixi-ammo-abba
node tests/e2e/pixi-ammo.mjs --preview --rounds=1 --out=/tmp/pixi-ammo-built
```

148 smoke checks pass. New semantic parity coverage exercises HTML/Pixi values,
colors' input conditions, punch, prompt, pips and reload phases across magazine
sizes, long names, invalid numeric bounds and weapon modes. Failure tests cover
constructor/build failures, callback abort, local and owning-UI cleanup.

Hardware cases cover the real combat sequence, tactical reload, interruption by a
weapon swap, a real last-round shot/empty prompt, complete empty reload, shotgun
reload interrupted by switching, pause/shop/death/restart/Start gate, resize, DPR,
world scaling, pool plateau, pointer transparency and initialization fallback.
Captures show idle/reload/empty and resized states using actual GPU target readback
composited with DOM. Built tests use the documented bounded hardware-adapter
metadata preflight for cold headless Chromium; game boot logic is unchanged.

## Decision

Keep this **opt-in** for visual playtesting. It demonstrates a real game HUD using
an existing library, with a small (~220-line) presenter plus a ~50-line shared-device
helper, rather than a home-grown UI toolkit. It buys a styled, self-contained GPU
readout and sharp independent resolution, not proven efficiency over HTML.

Before making it default: user acceptance during combat, a longer frame/GPU/
compositor profile, and another relevant hardware/browser configuration. Stop or
keep the design in HTML if sustained text churn or integration upkeep outweighs
the visual benefit. No further UI migration is implied by this trial.
