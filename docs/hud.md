# Gameplay HUD

The gameplay HUD is drawn with PixiJS on WebGPU.

Pixi renders ammo/reload, health/armour, crosshair, minimap, injury,
compass/heard pings, hitmarkers/damage arcs, bandage/grenade inventory, FPS,
score/status, killfeed, prompts/progress and banners/countdown.
Native HTML retains startup/error controls and menus/shop/game-over.
The Supply Market opens at wave breaks and at range counters with the native weapon
catalog, attachment editor, stats and 3D preview, which uses its own Three WebGPU renderer.
Opening it suspends gameplay; gameplay resumes only after mouse capture succeeds. Maps
with range targets add a target reset.

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
- Ammo/reload, vitals, inventory, FPS, score and feedback use Pixi bitmap text
  backed by two shared glyph atlases: one for small labels and one for large
  values. The HUD uploads the game's glyphs at startup and keeps the atlases
  resident; changing these labels reuses the glyphs without making a text texture. Compass and minimap labels use canvas text at the current
  layout density. Animated transforms do not change text resolution.
- Passive messages use `pixi-feedback.ts`; controllers retain prompt ownership,
  progress, banner timing, six pooled killfeed rows and status priority. The supply
  countdown uses raw time and its own anchor, independent of interaction prompts.
- The minimap shows the map's exported PNG and draws labels and live markers over it;
  [ARCHITECTURE.md](../ARCHITECTURE.md#physics-and-world) covers the bake and prefetch.
- The magazine bar empties at the removal beat and jumps to the actual ammo count
  when the new magazine seats. Tube reloads update the count one shell at a time.
  The separate progress bar tracks the active reload clip. In the opt-in Survival
  playtest, the counts and precise bar are replaced by a coarse fill silhouette
  for the loaded magazine, belt, or tube and each spare. The spare count and
  next-spare marker are visible; a crossed-out silhouette means no spares.
- Keep the simple icons and bottom-readout tiers. There is no radio inventory or
  panel; the held radio's LCD is its interface.
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
`bun tests/e2e/world-smoke.ts` (WebGPU-capable Chromium) also verifies that changing
ammo, reload, FPS and banner text does not upload new canvas textures.
Run typecheck, lint and build as usual.
