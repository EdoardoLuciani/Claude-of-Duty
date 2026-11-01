# Gameplay HUD

The gameplay HUD uses **PixiJS/WebGPU by default**, with no opt-in URL parameter
and no legacy HTML presenter/fallback for its migrated widgets. The operator
accepted the simplified appearance and explicitly approved promotion.

## What renders where

| Presentation                                                                   | Owner                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Ammo/name/mode/reload, health/armour, reticle, minimap                         | Pixi HUD                                        |
| Blood edges/heartbeat/hit flash                                                | Pixi injury mesh, independent of readout fading |
| Compass/heard pings, hitmarkers/damage arcs                                    | Pixi retained geometry                          |
| Bandage/grenade inventory and wall-clock FPS                                   | Pixi HUD                                        |
| Start/error controls, pause/shop/game-over menus                               | Native HTML                                     |
| Score/status, killfeed, prompts/progress, banners/countdown, field-radio panel | Native HTML                                     |
| Independent market weapon-inspection studio                                    | Existing Three WebGPU renderer, unchanged       |

The radio inventory indicator stays removed; radio gameplay/charges/market and
its request panel are unchanged. The chosen simple icons, magazine bar, minimap
simplifications and32/16/12px bottom-readout hierarchy remain.

## State, rendering and lifetime

- Three owns the shared GPUDevice. One passive Pixi canvas owns only its stage,
  geometry/shaders/textures and renderer resources. No WebGL or extra HUD device.
- Engine `lateUpdate` advances state and presents once; no Pixi Application or
  independent render ticker. Paused static frames do not redraw after settling.
  A changed500ms FPS sample can invalidate once even during pause.
- Existing player/weapon/game snapshots and events remain authoritative.
  `HealthFx`, `Crosshair`, `Hitmarkers`, `DamageArcs`, `Compass` and `AmmoPanel`
  retain animation/derived state but do not create hidden legacy elements.
- Hit/arc/heard-ping pools use null nodes, retaining the same bounded oldest-first
  reuse/lifetimes. The common pool still supports native killfeed elements.
- `minimap.ts` owns the detached, one-time authored Canvas2D bake and labels, not
  a live widget/canvas/draw loop. Pixi retains the uploaded terrain and dynamic cues.
- Startup, HUD fade, injury independence, pointer transparency, independent DPR
  cap2, resize and failure-isolated teardown preserve the accepted behavior.

The old `pixi`, `combat`, `compass`, `underlays` and `icons` query controls no longer
select a different backend. Old bookmarked URLs still load the complete default
HUD. Standalone pause/ammo prototypes and unused `@pixi/ui` are removed; pinned
`pixi.js` remains. HTML/SVG/CSS implementations for migrated widgets are deleted,
not hidden behind a feature flag.

## Failure behavior

A required HUD import/constructor/renderer initialization failure propagates to
`main.ts`'s existing native **BOOT FAILURE / Reload game** dialog. Do not publish
readiness, begin gameplay without a HUD, destroy Three's device, or silently
restore the removed HTML path. Preserve the original initialization error even
if partial cleanup also fails; always restore Pixi's restricted DOM adapter.
Native error/start/menu controls remain usable without the HUD renderer.

## Qualification

Fresh `npm ci`, **156 smoke tests**, format/typecheck/lint and production build.
Reference trajectories captured from `3cb261b5` preserve recoil, vitals,
injury, compass, hit/arc lifetimes/pooling and inventory pulse values after DOM
removal (10-decimal rounding ignores platform floating-point ulps). Ammo edge-case/reload/low/empty/numeric/bar tests use canonical state,
not a retired native renderer. FPS tests assert its shared sampled string.

```sh
node tests/e2e/pixi-hud.mjs --preview --uncapped --rounds=1 --port=5261 --out=/tmp/pixi-mainline-qualified
```

Production native AMD RDNA4/Chromium156 qualification covers:

- No-parameter default, portrait/DPR2 and retired-URL flags all render the full
  HUD, with one borrowed device, zero WebGL, no legacy elements/models/draw loops
  and null-node state pools. Health/ammo, all hit kinds, world-relative damage
  arcs/pings, empty/multi-digit equipment and injury actually render.
- Menu/pause/static redraw versus live paused FPS, hidden HUD, reload/switch,
  shop/death/restart/Start/terminal behavior and teardown. Only Three destroys
  the borrowed device; repeated HUD disposal does not do so.
- One terrain upload; texture sources plateau58/58/58 (DPR2:56/56/56). Counts are
  not VRAM bytes. No GPU validation/device-loss errors.
- Injected Pixi adapter-metadata failure leaves the native boot/reload dialog,
  zero legacy widgets, no readiness/public engine and no premature device destroy.
  Activating its real Reload button after unblocking initialization reaches normal
  HUD readiness; normal engine teardown destroys the device once.

Logs/captures: `/tmp/pixi-mainline-tests-final.log`,
`/tmp/pixi-mainline-qualified/`, `/tmp/pixi-mainline-qualified.log`.
Before/after promotion captures normalize health/ammo and inject123FPS outside
measurement; screenshots are not benchmark evidence. Qualification is not a new
performance comparison or second-hardware/long-session certification.

Historical methods/results stay under `docs/experiments/pixi-*.md` and in Git.
Use their named revisions, or `8664e572` for the last complete opt-in implementation
and comparison scripts. Those runtime switches and standalone/performance
experiment harnesses are retired from the mainline checkout; the focused default
HUD qualification above replaces its native-versus-Pixi browser matrix.
