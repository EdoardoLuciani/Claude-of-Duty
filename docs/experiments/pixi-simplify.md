# Simpler Pixi HUD: before/after, not HTML/Pixi

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

Later, the operator requested a [bandage/grenade icon comparison](pixi-accessory-icons.md).
The magazine bar remains; accessory text/original/simple silhouettes are selectable.
This report's text-only measurements remain historical, not icon-cost attribution.

Both builds use the complete opt-in Pixi HUD, WebGPU device, v1.1.0 assets and
game code. Baseline: `3a90a615`. The user explicitly authorized visual differences
instead of reproducing CSS pixel-for-pixel. Menus/native default/fallback remain.
No world/weapon/render-graph change, new dependency or injury/FPS rewrite.

## Changes

- Compass:24 ticks rather than72; eight cardinals/hearing pings retained. Simple
  translucent backing rather than64 feathered columns/gradient texture.
- Hitmarkers: one outlined X per slot, tinted by kind; same colours, scale/spin,
  ring/lifetime/pooling, but a common main stroke width. No four hidden variants.
- Damage: one outlined red arc rather than seven bell segments and outer accent;
  same radius/angular coverage, direction/intensity/punch/lifetime/six slots.
- Equipment pulse: cosine instead of six-iteration CSS Bezier inversion; same
  0.35–1 range,280ms each way, activation reset and unscaled/pause clock.
- Accessories: compact BANDAGES/FRAGS/RADIO text/counts instead of detailed vector
  icons. Empty dimming and active amber/pulsing remain. Only relayout on count change.
- Ammo/reserve: existing numeric/mode/name/reload/empty-warning data retained.
  One magazine-fill bar replaces30 pip objects, using the existing canonical
  magazine/reload fill quantity. Decorative number punch removed.
- Health: simpler stable number/static maximum, plain health bar and a single
  armour bar/label instead of three plate widgets/health dividers/number beat.
  Low-health colours, smoothed health fraction and armour flash/fade remain.
  Fullscreen injury/heartbeat still use the existing independent mesh.

Five affected runtime files:1137→1033 lines (104 fewer). Whole HUD retained objects
344→226; Graphics instructions714→233; compass ticks72→24. Counts are structural,
not milliseconds or VRAM bytes. One map upload. Sampled draw calls ~15.7→5.7,
still one Pixi render pass. Busy renderer texture sources45→43.

## Final measurements

Native AMD RDNA4, Chromium156, High1920×1080/DPR1, production builds.
Per-run summaries, counters and all final GPU samples are durable:
[pixi-simplify.results.json](pixi-simplify.results.json).

| Test/scope                  |   Before |    After | Interpretation                                   |
| --------------------------- | -------: | -------: | ------------------------------------------------ |
| Deterministic UI-only CPU   |  0.148ms |  0.125ms | ~15% lower, ~0.023ms saved                       |
| Busy game whole-UI CPU      |  0.255ms |  0.208ms | ~18% lower, ~0.047ms saved                       |
| Busy game uncapped interval |  4.312ms |  4.248ms | ~1.5% lower in this small sample                 |
| Busy game Pixi GPU pass     | 0.0603ms | 0.0595ms | <1µs difference; no material GPU win established |
| Busy game capped UI CPU     |  0.332ms |  0.266ms | ~20% lower, ~0.065ms saved                       |
| Capped interval p95         |   16.8ms |   16.8ms | no demonstrated60Hz FPS gain                     |

The UI-only replay has240 warmup and1200 timed UI calls per run, with no world/AI
stepping/rendering. Two complete before→after→after→before blocks (four runs each).
It drives identical health/armour/ammo/reload/count/FPS snapshots and hit/arc/ping
cues. CPU means:before0.146–0.151ms,after0.120–0.132ms. Of1440 total calls,
180hits/60arcs/48pings include warmup (timed:150/50/40).
Only batch boundaries yield to rAF; these figures are CPU submission/update costs,
**not game frame time**. One queue drain occurs before, not within timed samples.

Game comparisons use180 warmup/900 timed frames and one full ABBA block each,
uncapped and vsync-paced. A synthetic busy-UI overlay exercises the simplified
features while the real seeded combat/physics/world render remains active.
FPS strings are driven identically at half-second simulated intervals rather
than allowing each build's own measured speed to change the text workload.
UI/renderer timer scopes overlap; renderer submission is included in UI CPU.
Short timers are quantized; use repeated means, not zero-valued short medians.
Do not add scopes or forecast these savings for another machine/long session.

Each final uncapped run matched25player/227AI shots,408impacts,2reloads,2switches,
56.4784m,1629.9480damage. Capped runs matched within their set:238AI shots,
435impacts,1630.0446damage; other counters unchanged. Captures/probes are outside
throughput timing. Differences between capped/uncapped sets are not backend deltas.

GPU timestamps run in a **separate**900-frame replay after90 warmup frames,
sampling150 Pixi passes and resolving/readback once at the end. GPU replay
counters also matched before/after (226AI shots,425impacts,1613.1276damage,
56.4075m). Timings exclude CPU, uploads, queue waiting, Three passes and browser
composition. Fewer draw calls did not translate to a material GPU-time reduction.
Existing `tests/lib/pixi-gpu-timing.mjs` is reused from the earlier attribution
experiment; all wrappers/resources restore in finally, with no runtime hooks.

**Conclusion:** materially simpler scene/CPU work, modest absolute CPU savings,
little change to GPU/overall FPS. Not a17% whole-game speedup or another injury win.
The default HTML path is not the baseline for any numbers in this table.

## Rejected design / exploratory runs

The first bottom-row design combined HP/max into one changing text run and added
a changing numeric armour label. The same isolated stress got slower:
~0.149→0.183ms. That version was rejected, not hidden in the final averages;
its per-run results are retained. A small static maximum and static armour label
avoid that repeated rasterization while preserving the previous information.

Earlier natural-combat exploratory runs had227–235AI shots from async scheduling;
their frame-time differences are not used to establish a speedup. An earlier
broad command timed out after seven capped runs on the rejected design. Final
data above come from complete new blocks, with no runs discarded within them.

## Reproduce / validation

Build a separate baseline worktree at `3a90a615` (default sibling name below),
then build this branch. Both use `npm ci && npm run build`.

```sh
git worktree add ../Claude-of-Duty-pixi-simplify-before 3a90a615
(cd ../Claude-of-Duty-pixi-simplify-before && npm ci && npm run build)
npm ci
npm test
npm run build
node tests/e2e/pixi-simplify.mjs --ui --rounds=2 --out=/tmp/pixi-simple-ui-final
node tests/e2e/pixi-simplify.mjs --busy --gpu --rounds=1 --out=/tmp/pixi-simple-game-final
node tests/e2e/pixi-simplify.mjs --busy --capped --rounds=1 --out=/tmp/pixi-simple-cap-final
node tests/e2e/pixi-hud.mjs --preview --uncapped --rounds=1 --port=5225 --out=/tmp/pixi-simple-qa-final
node tests/e2e/pixi-ammo.mjs --preview --rounds=1 --port=5225 --out=/tmp/pixi-simple-ammo-final
```

Use `--before=/absolute/baseline/root` to select a different baseline worktree.
The harness owns two preview servers at5221/5222 and restores the browser fixtures.
`--baseline` records the old build before editing. Images inject head-hit/arc/ping
and123FPS as an explicit appearance fixture; they are not performance screenshots.

154 smoke tests, typecheck/lint/format/build pass. Ammo tests now verify the bar's
canonical fill quantity rather than a deliberately removed pip/punch shape; all
numeric/reload/empty/mode/long-name/edge-case checks remain. Health/max/armour fraction
and all accessory labels/counts are checked. Hardware default/fallback, hidden DOM,
four hit kinds/rings, north-wrap/rotation, pause/live FPS, injury/fade independence,
resize/DPR2 and shop/death/restart/Start/terminal pass; ammo-only regressions pass.
Final texture stress plateaus61/61/61 (DPR2:59/59/59), not VRAM bytes; no WebGL,
one borrowed device, only Three destroys it. Readouts remain panel-free.
