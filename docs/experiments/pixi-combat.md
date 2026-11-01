# Pixi compass, combat feedback, equipment and FPS

> **Historical experiment.** The [current gameplay HUD](../hud.md) now uses Pixi
> by default. Its old HTML presenters/fallback, URL comparison switches and
> standalone experiment harnesses are retired. Commands and measurements below
> refer to their named historical revisions, not current runtime options; use
> Git history to reproduce them. No new performance claim accompanies promotion.

`?pixi=hud` now also presents the compass/heard-bearing pings, hitmarkers,
directional damage arcs, bandage/grenade/radio counts and highlights, and FPS.
Menus/status/killfeed/prompts/banners/radio-panel/countdown remain native.
The removed projected objective/grenade-warning feature is not restored.

Current visuals are further simplified, including ammo/health/accessory readouts:
see [simplification and Pixi-before/after measurements](pixi-simplify.md).
The initial presentation details below are retained for the historical results.

## Ownership and presentation (initial expansion)

- Existing `Compass`, `Hitmarkers`, `DamageArcs` and `AmmoPanel` owners retain
  state/events/lifetimes. Both backends consume the same derived values. Pool
  acquire/release/clear now accept an optional presentation flag, defaulting to
  native behavior. Native pool/attribute/style/text writes stop in Pixi mode.
- Compass: retained 72 ticks/eight cardinal labels/eight hearing ticks. Normalize
  heading through north, clamp bearing pings and expire after1.25s as before.
  No scrolling-label texture re-rasterization, fullscreen mask/filter or per-frame
  graphics rebuild. One owned static gradient texture provides the scrim.
  Per-node edge fading/64-column scrim feathering approximate CSS masks; font/
  shadow differences mean this is not a pixel-identical renderer substitution.
- Hitmarkers retain all four kinds, style weights/colors, punch/spin/ring
  animations, original lifetimes and ten-slot oldest-first pooling. Six damage
  arcs keep their seven bell-shaped segments, world-relative direction, punch
  and2s lifetime. Static vector geometry; owners alone advance timing.
- Equipment remains its own panel-free row, above and aligned with ammo.
  Counts/empty opacity/cooking/healing/equipped state are unchanged. Instead of a
  browser-owned keyframe, both backends use the original CSS ease-in-out curve
  and280ms alternate period from a shared, unscaled UI clock (including pause).
  The active GPU silhouettes use amber tint rather than CSS drop-shadow; their
  engraving/count shapes are retained vectors/text. No new assets/dependencies.
- FPS keeps the original wall-clock500ms sampling, including pause/hitches.
  Pixi text changes only when the sampled string changes. Paused FPS changes
  invalidate one redraw; identical values do not. No independent render ticker.
  Static-paused tests freeze the sampler to hold inputs fixed, then separately
  prove a changed paused FPS value draws once.
- Order: injury → readouts/minimap → arcs → reticle → hitmarkers → compass/
  equipment/FPS, below remaining native feedback/menus. All new elements use HUD
  fading; fullscreen injury remains independent. Resize/DPR cap/borrowed device/
  construction fallback/failure-isolated disposal contracts are unchanged.

Comparison switches (diagnostics only):

- `?pixi=hud&combat=html`: previous compass/feedback/equipment/FPS presentation;
  earlier Pixi widgets and injury remain Pixi.
- `?pixi=hud&compass=html`: only compass is native, all other migrated UI Pixi.
- `?pixi=hud&underlays=html`: only fullscreen injury is native.

## Measurements (historical pre-v1.1 integration)

The data below was collected on `471759e2`, before merging develop `57a87737`
and its v1.1.0 weapon/world asset updates after the interrupted session.
It is not a fresh performance claim for the integrated build. The post-merge
checks below revalidate functionality; the earlier ABBA data remains unchanged.

Native AMD RDNA4, Chromium156, High1920×1080/DPR1, fixed exposure, seeded60Hz
combat,180 warmup/900 measured frames per run. Separate HTML→Pixi→Pixi→HTML
comparisons for compass only and the full new group. Headless uncapped callbacks;
all modes initialize Pixi, keep the rest of the UI/game active, and differ only
in presentation selection. Readbacks/captures/functional fixtures are outside
timing. Durable per-run results: [pixi-combat.results.json](pixi-combat.results.json).

| New presentation   | Mean uncapped frame interval | Engine mean | Main-thread task/frame |
| ------------------ | ---------------------------: | ----------: | ---------------------: |
| Compass only: HTML |                       5.24ms |      4.47ms |                 4.94ms |
| Compass only: Pixi |                       4.68ms |      4.41ms |                 4.64ms |
| All four: HTML     |                       5.81ms |      4.85ms |                 5.46ms |
| All four: Pixi     |                       4.82ms |      4.55ms |                 4.78ms |

~0.56ms/10.8% lower observed interval for compass alone, ~0.99ms/17% for the new
group, in these small single-machine samples. **Not guaranteed real-play FPS**,
isolated GPU/compositor cost or savings for individual hit/equipment/FPS widgets.
Do not subtract/add the two experiments or overlapping timing columns.

Tiny CPU scopes for the compass-only comparison averaged0.0106ms native
model/presentation versus0.0004ms shared model and0.0068ms Pixi view update.
Timers are strongly quantized, with many zero samples and variation between
experiments; these scopes exclude Pixi rendering, browser paint/composition and
GPU work, and are not reliable standalone cost attribution.

Both source ABBA sets matched exactly:25 player/227 AI shots,2 completed reloads,
2 switches,408 impacts,56.4784m movement,1629.9480 damage.
One vsync-paced production pair matched within that pair (238 AI shots,
435 impacts,1630.0446 damage; other counters unchanged). Engine median/p95
5.2/7.0→5.4/7.5ms, UI mean0.258→0.304ms, task/frame6.08→5.90ms: mixed CPU changes.
Frame-interval p95 **16.8ms both**: no demonstrated FPS increase at60Hz.
Do not claim the prior four-widget0.053ms GPU estimate for this expanded HUD.
No second-hardware/long-session acceptance yet.

## Validation / reproduce

```sh
npm ci
npm test
npm run format:check
npm run build
node tests/e2e/pixi-hud.mjs --compass --uncapped --rounds=2 --port=5217 --out=/tmp/pixi-compass-abba
node tests/e2e/pixi-hud.mjs --combat --uncapped --rounds=2 --port=5217 --out=/tmp/pixi-combat-abba
node tests/e2e/pixi-hud.mjs --preview --combat --rounds=1 --port=5217 --out=/tmp/pixi-combat-built
node tests/e2e/pixi-hud.mjs --preview --uncapped --rounds=1 --port=5217 --out=/tmp/pixi-combat-default
```

After merging develop v1.1.0, a fresh `npm ci`, **153 smoke tests**, formatting,
typecheck, lint and production build pass (151 tests before integration).
Production hardware was rerun with:

```sh
node tests/e2e/pixi-hud.mjs --preview --combat --uncapped --rounds=1 --port=5217 --out=/tmp/pixi-resume-built
```

This passed native/Pixi comparison, all hit/equipment fixtures, paused FPS,
full-circle texture plateau (64/64/64; DPR2:62/62/62), fallback, lifecycle and DPR2
on the native AMD adapter with zero WebGL requests. This single post-merge pair
is a correctness check, not a replacement for the historical performance suite.

New coverage compares model state across backends, pause,
expiry/oldest-first reuse/clear, wrap, count/highlight/empty state and FPS, including
zero suppressed DOM writes on spawn/release/clear. Existing FPS/hitch tests remain.

Hardware checks cover default no-Pixi download, native fallback, device ownership/
zero WebGL, all four hit styles/rings, world-relative arcs, hearing pings, empty
equipment/multi-digit counts/healing/cooking/radio highlights, real injury pixels,
independent HUD fading, static pause plus live paused FPS, resize/portrait/DPR2,
shop/death/restart/Start/terminal and resource plateau.
The posed `feedback-*.png` captures inject UI state/123FPS **only for visual
validation**, not as gameplay evidence or a performance counter. Natural combat
runs exercise existing event producers; no new gameplay triggers were added.

After the initial mixed fixture, texture sources plateau at59/59/59 (DPR2:57/57/57).
A final full-circle rotation stress warms every cardinal, repeatedly crosses north,
and plateaus at64/64/64 (DPR2:62/62/62); new group native:50/50/50.
Production source/default/fallback and isolated ammo-only regressions also pass.
Final rotation checks: `/tmp/pixi-combat-circles/`; ammo-only:
`/tmp/pixi-combat-ammo/`. Counts, not VRAM bytes. Map uploads once.
The entire HUD is engine-driven on the existing passive Pixi canvas; no new device,
render graph integration, runtime network dependency, world asset or weapon change.
