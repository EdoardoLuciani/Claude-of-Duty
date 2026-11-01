# Grenade/bandage icon cost and appearance choice

The magazine remains the simplified full bar. Only **bandage and grenade
inventory icons** are compared. After these measurements, the operator requested
removal of the radio inventory indicator: its count/icon and unused UI snapshot
fields are now gone in HTML and Pixi, with regression checks for exactly two
inventory entries. Radio mechanics and the separate field-radio panel are
unchanged. The historical table/captures below included radio text in every
variant; they are not new performance claims for this removal. This does not
restore the removed projected grenade danger warnings or objective UI.

Use:

- `?pixi=hud&icons=simple` (also the provisional default): diagonal bandage/pad,
  plain grenade body/cap/lever, retained vectors.
- `?pixi=hud&icons=original`: the prior Pixi roll/tail/shading and grooved
  grenade geometry, copied from the pre-simplification implementation.
- `?pixi=hud&icons=text`: the current simplified BANDAGES/FRAGS text control.

The old full HUD is **not** reinstated: the same bars, compass, feedback, FPS,
fonts/count styling, pulse/state and renderer are used in all variants. The
original option means original **icon geometry**, not the entire historical HUD.
Variants are retained for the operator's decision; no general skinning framework.
Native HTML remains default without Pixi; its fallback is unchanged.

## Results

Native AMD RDNA4 / Chromium156, High1920×1080/DPR1, production build.
All per-run summaries and GPU samples:
[pixi-accessory-icons.results.json](pixi-accessory-icons.results.json).

| Scope, whole HUD                | Text control | Original icons | Simpler icons |
| ------------------------------- | -----------: | -------------: | ------------: |
| Steady-state UI CPU, mean       |     0.0250ms |       0.0266ms |      0.0259ms |
| Rapid stock-change UI CPU, mean |     0.0915ms |       0.0914ms |      0.0921ms |
| Observed Pixi GPU pass, mean    |     0.0596ms |       0.0598ms |      0.0599ms |

**No meaningful rendering-cost difference between original and simple icons was
established.** Steady CPU deltas from text are roughly1–2µs for the pair, with
strong timer quantization and overlapping run ranges. These are not intrinsic
per-icon costs or universal microsecond guarantees. Subtracting the rounded GPU
means to claim nanosecond differences would be unjustified. Rapid count stress
is effectively tied and deliberately much more frequent than real inventory use.

All variants still batch to the same ~5.69 average draw calls /one render pass in
the sampled replay. The two icon variants add four display objects over text
(226→230); original adds nine Graphics instructions, simple adds four
(whole HUD233/242/237). Both use the existing vector pipeline, not image uploads
or per-frame shape rebuilding. Stable stock changes only alpha/tint during the
pulse; numeric labels/row layout update only when counts change. These counts
are not GPU memory bytes.

## Method and limitations

One build with a query choice avoids comparing different gameplay/asset builds.
Steady UI-only replay:240 warmup/1200 timed UI calls per run, no world stepping
or rendering; all other snapshots remain fixed while both accessories pulse.
Three rotated mirrored six-run blocks give six samples per style and balance
order. Warm fonts/geometry before timing. This measures **complete UI CPU
submission/update**, not game frame interval or just icon shader time.

A separate12-run test changes both counts every UI call (0–19 bandages,
0–3 grenades); four runs/style. No outliers dropped. Timer resolution often
produces zero short medians; compare repeated means/ranges rather than a lone
timing call. CPU renderer time is a subset of UI time, not additive.

Six natural seeded-combat/busy-UI runs exercise the full game. Normal async AI
admission varied227–235 AI shots /408–430 impacts; these are **not exact
equivalent-work frame-time comparisons**, so no whole-game FPS gain is assigned.
There was no consistent style ordering in engine/UI/frame time. The table's GPU
samples are descriptive full-HUD observations, not a clean isolated icon delta.

GPU timestamps are from a separate900-frame replay,150 Pixi pass samples/run,
one final readback; never in throughput measurements. They exclude uploads, CPU,
queue waits, Three passes and browser composition. GPU replay damage/impact
counters also varied slightly; differences this small do not establish a win.
All resources/wrappers and test clocks restore in finally. No runtime timing hooks.

**Decision:** either icon version is affordable on the tested hardware. Choose
for recognition/appearance; simpler uses fewer paths/code, original keeps detail,
with no demonstrated FPS reason to reject it. No second-hardware acceptance.

## Validation / reproduce

```sh
npm ci
npm test
npm run build
node tests/e2e/pixi-simplify.mjs --icons --ui --rounds=3 --port=5231 --out=/tmp/pixi-icons-steady
node tests/e2e/pixi-simplify.mjs --icons --ui --stock --rounds=2 --port=5231 --out=/tmp/pixi-icons-stock
node tests/e2e/pixi-simplify.mjs --icons --busy --gpu --rounds=1 --port=5231 --out=/tmp/pixi-icons-game
node tests/e2e/pixi-hud.mjs --preview --uncapped --rounds=1 --port=5235 --out=/tmp/pixi-icons-simple-qa
node tests/e2e/pixi-hud.mjs --preview --icons=original --uncapped --rounds=0 --port=5235 --out=/tmp/pixi-icons-original-qa
node tests/e2e/pixi-hud.mjs --preview --icons=text --uncapped --rounds=0 --port=5235 --out=/tmp/pixi-icons-text-qa
```

155 tests, formatting/typecheck/lint/build and hardware checks pass. Unit tests
check all three modes, actual inventory labels/counts, empty/active tint/opacity,
pause invalidation, retained geometry across count/state changes, and radio text.
Hardware checks exercise simple/default and original/text at DPR2, including
portrait resize, native init fallback, no replaced DOM mutations, stock counts/
highlights, paused FPS, injury, shop/death/restart/Start/terminal and teardown.
Texture stress plateaus62/62/62 (DPR2:60/60/60) for icons,59/59/59 for DPR2 text;
not VRAM bytes. One map upload, one borrowed device, zero WebGL requests.
No dependency, gameplay, world/post effect or magazine changes.

The three-way4× crop and full captures are posed UI appearance checks outside
timing, not game FPS screenshots. Counts are the same across the captures.
