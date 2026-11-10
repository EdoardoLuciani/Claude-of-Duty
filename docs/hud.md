# Gameplay HUD

The gameplay HUD is drawn with PixiJS on WebGPU.

Pixi renders ammo/reload, health/armour, crosshair, minimap, injury,
compass/heard pings, hitmarkers/damage arcs, bandage/grenade inventory, FPS,
score/status, killfeed, prompts/progress and banners/countdown.
Native HTML retains startup/error controls, menus/shop/game-over and the field-radio panel.
The market's 3D weapon preview uses its own Three WebGPU renderer.

## Ownership and behavior

- Three owns the shared GPUDevice. Pixi owns one passive canvas and its renderer,
  stage, geometry, shaders and textures. No WebGL, extra HUD device or render ticker.
- Gameplay snapshots/events are authoritative. HUD models own derived animation and
  bounded pool state.
- The engine drives updates. Settled active/paused and hidden content does not redraw;
  changed wall-clock FPS samples can invalidate once during pause. Health/reticle
  easing is quantized below visible precision, and health labels are formatted only
  when their displayed integer changes.
- Injury fades independently of readouts. Inventory pulses use unscaled UI time;
  FPS samples every 500 ms. HUD canvas DPR is capped independently at 2.
- Text bitmap density includes HUD enlargement on resize; smaller layouts keep
  renderer-density text. Late minimap labels inherit the current density. Animated
  transforms do not change text resolution or trigger per-frame rasterization.
- Passive messages use `pixi-feedback.ts`; controllers retain prompt ownership,
  progress, banner timing, six pooled killfeed rows and status priority. The supply
  countdown uses raw time and its own anchor, independent of interaction prompts.
- Minimap terrain is baked once on a detached Canvas2D surface, uploaded once and
  presented with retained dynamic cues.
- Keep the simple icons, magazine bar and 32/16/12 px bottom-readout tiers. The HUD
  shows no radio inventory; radio uses its native panel.
- Required HUD initialization failures propagate to the native boot/reload dialog,
  never to gameplay without readouts. Preserve the original
  error and restore Pixi's DOM adapter even if partial cleanup fails.
- Teardown releases Pixi resources without destroying Three's device or skipping
  native-control cleanup.

## Checks

`bun run test` includes `smoke-pixi-ui.ts` for shared-device guards, initialization
error preservation, adapter restoration, failure-isolated/idempotent teardown and
passive-message state/timing contracts. `smoke-hud-redraw.ts` checks active/paused
redraw suppression and invalidation for vitals, reticle, injury, reload and feedback.
Run typecheck, lint and build as usual.
