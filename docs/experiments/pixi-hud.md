# Playable Pixi HUD slice

Use `?pixi=hud` for ammo/reload, health/armour, crosshair and a live minimap.
Omit the parameter for the unchanged native HUD. Menus, shop/inspection,
startup/error handling, equipment, compass, markers, injury overlays, prompts,
radio and killfeed remain native. This is **not** the no-UI benchmark state.

Supersedes draft PRs #564, #565 and #566 (closed at the operator's request).
The shared-device and ammo groundwork is reused; `?pixi=ammo` and `?pixi=1`
remain isolated earlier diagnostics, not combined renderers. The custom Three
crosshair experiment is not included.

## Implementation

- One passive display-resolution Pixi WebGPU canvas, capped at DPR 2, borrows
  Three's existing GPUDevice. There is no WebGL fallback or second device.
  Pixi's supported DOM adapter restriction is restored even on init/cleanup failure.
- The engine drives one HUD render per active frame. No independent Application
  or render ticker. A hidden HUD does not render; unchanged paused HUD graphics
  do not render. CSS handles HUD/menu opacity without rerasterizing its content.
- Canvas placement is after the world-marker layer and before native centre/chrome
  feedback. Native hitmarkers/damage arcs, equipment and menus stay above it;
  native blood/flash overlays stay below the HUD, as before.
- The shared `PixiAmmoView` is the previous ammo presenter without renderer ownership.
  The old ammo-only wrapper and the new HUD reuse the same code/pip calculation.
- Crosshair spring/stance/ADS/hit/flinch and health/bar/armour animation state stay
  in their existing native owners. Those owners can skip DOM widget presentation;
  event wiring/gameplay behavior is not duplicated. Health's screen-space injury
  overlays intentionally remain native and active.
- Minimap uses the same north-up world bake, footprint geometry, traversables,
  labels, 60 m span, LOS/recent-shot contacts and intel/objective snapshots.
  Canvas2D is used **once** for the existing authored bake, then uploaded once.
  Map scrolling, grid, labels, cone, player arrow, pooled contacts, edge-clamped
  objectives, pulsing search areas and above/below arrows are retained Pixi objects.
  It never draws/uploads an entire Canvas2D minimap each frame.
- The replaced native ammo readout, vitals/crosshair presentation and minimap draw
  are not updated behind the experiment. Equipment and all remaining UI still update.
- No changes to Three's frame graph, world resolution, post-effects or viewmodel.
  A separate Pixi canvas still requires browser composition; this is not a final
  single-canvas presentation integration.

## Measurements

AMD RDNA 4 hardware adapter, Chromium 156, High quality, 1920×1080 CSS, DPR 1.
Fixed seeded lockstep gameplay; fixed exposure in both cases (no asynchronous
metering). 180 warmup frames and 900 measured frames per run, HTML → Pixi →
Pixi → HTML. Vsync/frame limiting disabled for the following throughput test.
Captures, functional checks and GPU readback are outside all timing intervals.

| Run | HUD        | Mean frame interval | Engine median / p95 | UI update mean | CDP main-thread task/frame |
| --- | ---------- | ------------------- | ------------------- | -------------- | -------------------------- |
| 1   | HTML       | 8.28 ms             | 5.6 / 7.2 ms        | 0.369 ms       | 6.76 ms                    |
| 2   | Pixi slice | 7.48 ms             | 5.3 / 6.9 ms        | 0.255 ms       | 6.09 ms                    |
| 3   | Pixi slice | 7.64 ms             | 5.5 / 7.1 ms        | 0.263 ms       | 6.25 ms                    |
| 4   | HTML       | 8.46 ms             | 5.8 / 7.4 ms        | 0.372 ms       | 6.95 ms                    |

Average frame interval **8.37 → 7.56 ms** (~0.81 ms / 9.6% lower).
Average main-thread task time **6.86 → 6.17 ms**. These overlap with engine/UI
measurements: never add the columns. This is a small single-machine sample of
uncapped headless throughput, **not guaranteed real-play FPS** or GPU/compositor
execution attribution. No claim to recover the entire ~3 ms no-UI suppression
budget; most other HUD/DOM injury presentation is still present. No second
hardware or long-session validation yet.

All four runs matched: 25 player shots, 227 AI shots, 2 completed reloads,
2 switches, 56.4784 m moved and 1629.9480 damage. Replaced native minimap/ammo
presenter calls were zero throughout Pixi warmup/combat. One map texture upload.
Managed texture-source counts plateaued at **35 → 35 → 35** after repeated
ammo/health stress (DPR 2: **32 → 32 → 32**); these are counts, not VRAM bytes.

Built/preview confirmation with ordinary vsync pacing: HTML engine median/p95
**6.2/7.6 ms**, Pixi **5.9/7.2 ms**; main-thread task time **7.40 → 6.70 ms**.
Frame-interval p95 remained **16.8 ms** in both: no demonstrated FPS increase at
the 60 Hz cap. The earlier ammo-only comparison also passes after presenter reuse.

Raw source results/captures: `/tmp/pixi-hud-abba/`; built results:
`/tmp/pixi-hud-built/`; additional lifecycle checks: `/tmp/pixi-hud-lifecycle/`.
Screenshots normalize player/weapon/armour state and settle
both backends for the same 180 frames after combat. They are appearance comparisons,
not identical-design/pixel-equivalence tests.

## Checks and limitations

```sh
npm ci
npm test
npm run format:check
npm run build
node tests/e2e/pixi-hud.mjs --uncapped --rounds=2 --out=/tmp/pixi-hud-abba
node tests/e2e/pixi-hud.mjs --preview --rounds=1 --out=/tmp/pixi-hud-built
```

Smoke coverage compares native model/presentation-disabled crosshair and health
state and checks minimap projection, off-map contacts, fades, objective clamping,
height arrows and pause invalidation. Hardware browser checks exercise live readout
parity during combat, armour damage, critical HP, reload and switch, static pause,
HUD hiding/reveal, shop, death/restart, native Start waiting/terminal-error handoff,
texture plateau, portrait resizing, DPR 2, shared-device lifetime,
zero WebGL context requests, no Pixi download by default and native fallback when
Pixi cannot obtain adapter metadata.

Prototype visual differences are intentional: ammo/health use dark framed panels;
minimap contact/player glow, edge vignette and view-cone gradient are simplified.
Labels/fades and tactical data remain, but this is not a pixel-identical renderer
swap. Pixi Text uses cached Canvas2D-rasterized text textures: changing text still
has CPU/upload cost. Fonts and all runtime assets remain local. Gameplay canvas
accessibility has not been implemented; native menu/start/error controls remain.
No new general UI framework, compute effects, menu migration or dependency beyond
the existing pinned Pixi prototype dependencies.
