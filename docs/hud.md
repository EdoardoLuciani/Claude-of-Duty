# Gameplay HUD

PixiJS/WebGPU is the default gameplay HUD. No opt-in flag or legacy HTML backend
is available; old presenter-selection query flags are ignored.

Pixi renders ammo/reload, health/armour, crosshair, minimap, injury,
compass/heard pings, hitmarkers/damage arcs, bandage/grenade inventory, FPS,
score/status, killfeed, prompts/progress and banners/countdown.
Native HTML retains startup/error controls, menus/shop/game-over and the field-radio panel.
The independent Three WebGPU market-inspection renderer is unchanged.

## Ownership and behavior

- Three owns the shared GPUDevice. Pixi owns one passive canvas and its renderer,
  stage, geometry, shaders and textures. No WebGL, extra HUD device or render ticker.
- Existing gameplay snapshots/events remain authoritative. HUD models own derived
  animation and bounded pool state, not hidden legacy elements.
- The engine drives updates. Settled paused/hidden content does not redraw;
  changed wall-clock FPS samples can invalidate once during pause.
- Injury fades independently of readouts. Inventory pulses use unscaled UI time;
  FPS samples every 500 ms. DPR is capped independently at 2.
- Passive messages use `pixi-feedback.ts`; controllers retain prompt ownership,
  progress, banner timing, six pooled killfeed rows and status priority. The supply
  countdown uses raw time and its own anchor, independent of interaction prompts.
- Minimap terrain is baked once on a detached Canvas2D surface, uploaded once and
  presented with retained dynamic cues. There is no live Canvas2D drawing loop.
- Preserve the chosen simple icons, magazine bar and 32/16/12 px bottom-readout tiers.
  Radio inventory indication remains absent; radio gameplay/panel remain intact.
- Required HUD initialization failures propagate to the native boot/reload dialog,
  never to an HTML fallback or gameplay without readouts. Preserve the original
  error and restore Pixi's DOM adapter even if partial cleanup fails.
- Teardown releases Pixi resources without destroying Three's device or skipping
  native-control cleanup.

## Checks

`npm test` includes `smoke-pixi-ui.mjs` for shared-device guards, initialization
error preservation, adapter restoration, failure-isolated/idempotent teardown and
passive-message state/timing contracts.
Run typecheck, lint and build as usual. Earlier experiment reports and the larger
HUD test/capture harnesses remain available in Git history at `d5858ebc`.
