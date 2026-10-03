# OVERWATCH — engine contract

**Every agent must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty. WebGL2 + Three.js r186, with no external runtime services. Textures
and animation are procedural or Blender-authored; meshes load from local GLBs. World
geometry follows the authoring source in `tools/worldgen/`. Runtime never executes mesh builders.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another agent owns
   every other directory and your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes parallel work safe. (A few
   tolerated static couplings exist for shared constants: `ai`→`weapons`,
   `weapons/preview`→`materials`.)
3. **No new runtime npm dependencies without human approval.** The approved
   runtime set is `three` plus `@recast-navigation/core` and
   `@recast-navigation/wasm`, pinned to 0.43.1. Recast generation is offline
   dev tooling; runtime Detour consumes the committed bake. No CDN fetches or
   remotely hosted assets; source, runtime assets and WASM remain local.
4. **No `Math.random()` in gameplay or visuals.** Use `ctx.rng` (see
   `src/core/rng.js`) or a `ctx.rng.fork()` you keep. Capture reproducibility
   depends on it.
5. **Allocate nothing per-frame.** Preallocate vectors, matrices and arrays in
   `init()` and reuse. A `new THREE.Vector3()` inside `update()` is a bug.
6. **Dispose what you create.** Geometries, materials, textures and render
   targets get freed in `dispose()`.
7. `npm run build` must pass and `node tools/capture.mjs` must produce a frame
   after your change. If you break the boot, nobody else can work.

## Subsystem interface

```js
export class MySystem {
  static id = 'mysystem';       // unique; how others reach you
  static deps = ['render'];     // ids that must init before you

  async init(ctx) {}            // build resources; may await
  fixedUpdate(h, ctx) {}        // optional, 120 Hz, deterministic gameplay
  update(dt, ctx) {}            // optional, once per frame
  lateUpdate(dt, ctx) {}        // optional, after all update()
  resize(w, h, ctx) {}          // optional
  dispose() {}                  // optional
}
```

`ctx` provides: `scene`, `camera`, `viewScene`, `viewCamera`, `canvas`,
`config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, `has(id)`.

- `scene` / `camera` — the world. `viewScene` / `viewCamera` — the first-person
  weapon, drawn separately so it can never clip through walls.
- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Use `alpha` to
  interpolate rendered transforms between physics steps.
- `config.q` — the active quality preset (see `src/core/config.js`). Respect
  `q.taa`, `q.gtao`, `q.ssr`, `q.volumetrics`, `q.shadowMapSize`,
  `q.particleBudget`, `q.decalBudget`. Never exceed a budget.

## Ownership map

| id | directory | owns |
|---|---|---|
| `models` | `src/core/models.js` + `tools/export-models.mjs` | the GLB pipeline: exports the procedural weapon/soldier builders to `public/models/` and loads them at runtime |
| `render` | `src/render/` | WebGLRenderer, HDR pipeline, all post-processing, CSM shadows, the final composite |
| `materials` | `src/materials/` | procedural PBR texture generation, the shared material library, triplanar/detail mapping |
| `sky` | `src/sky/` | physical sky, sun/moon, time of day, IBL/env map generation, volumetric fog & light shafts |
| `world` | `src/world/` + `tools/worldgen/` + world export tools | JS-authored level geometry and metadata; runtime loading and queries; meshoptimizer-cooked static collision LOD |
| `physics` | `src/physics/` | broadphase, raycasts, character controller collision, rigid bodies, ragdolls, penetration |
| `player` | `src/player/` | movement state machine, camera feel, sprint/slide/mantle/lean, health, armour & bandages |
| `weapons` | `src/weapons/` | weapon meshes, viewmodel rig, ADS, recoil, sway, bob, reload & inspect animation, ballistics |
| `fx` | `src/fx/` | GPU particles, muzzle flash, tracers, impacts, decals, smoke, blood, shells |
| `ai` | `src/ai/` | enemy characters, navigation, perception, cover selection, combat behaviour, wave spawning |
| `game` | `src/game/` | survival run state, single-player score, kill and wave-clear rewards |
| `market` | `src/market/` | credits economy, between-wave shop session, purchases (grenades, armour plates, bandages, ammo refill) |
| `intel` | `src/intel/` | Al-Maktaba cache budget, distance-gated random spawning, F interaction, discovery hints, credit payouts and archived card names |
| `radio` | `src/radio/` | the field-radio strike: the bomber, bomb lines, blast chain; owns the `radio:strike` warning |
| `ui` | `src/ui/` | HUD, crosshair, hitmarkers, damage indicators, ammo, killfeed, menus |
| `audio` | `src/audio/` | synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`,
`src/dev/`, `tools/`, `vite.config.js`. (`models` appears in the map but its
files — `src/core/models.js` and `tools/export-models.mjs` — are lead-owned;
other subsystems reach it only via `ctx.get('models')`.)

## Cross-subsystem events

Emit and listen via `ctx.events`. Payloads are plain objects. The canonical set:

| event | payload | emitted by |
|---|---|---|
| `weapon:fire` | `{ actor, weapon, origin: Vector3, dir: Vector3, seed }` | weapons / ai |
| `weapon:reload` | `{ weapon, phase: 'start'\|'magout'\|'magin'\|'slide'\|'end', retained?: boolean }` | weapons |
| `weapon:shell` | `{ position, velocity }` | weapons |
| `bullet:impact` | `{ point, normal, surface, incident, damage, exit, shooter, shot }` | physics |
| `bullet:segment` | `{ from, to, shooter, shot, weapon, speed, tracer }` | physics |
| ↳ | Actual free-flight segments, clipped to collisions and range; material interiors are omitted. Audio, suppression and optional tracers consume these rather than reconstructing rays from `weapon:fire`. A round may emit several segments; near-miss consumers deduplicate by `shot`. Payload vectors are pooled: copy anything retained. | |
| `bullet:tracer` | `{ from, to, speed }` | explicit dev staging only |
| `shot:resolved` | `{ shooter, weapon, from, to, result, target, part, damage, pellet, shot, stopReason }` | weapons / ai (telemetry only) |
| `damage:dealt` | `{ target, amount, headshot, killed, point, part?, incident?, from?, source?, weapon?, shot? }` | ai / physics |
| ↳ | means *damage dealt **to** `target`*. `target` is the local player when an enemy round connects (`'player'`, the player system, or anything with `isPlayer === true`) — filter it out before drawing a hitmarker. Damage is applied by the target's own listener, never by the emitter as well. Physics emits at most one `damage:dealt` per actor per round, using the highest-scale hitbox the round intersects. Bullet range falloff, penetration loss and region scaling are already applied; receivers must not repeat them. `from` is the muzzle and `source` is the shooter. | |
| `damage:taken` | `{ amount, from: Vector3, health, armourAbsorbed, armour, plateBreak }` | player |
| ↳ | Incoming is halved while any plate remains, then leftover soaks into armour. `amount` is the damage that reached **health**; `armourAbsorbed` is what plates stopped. `plateBreak` is true when a 50 HP plate was fully consumed by this hit. |
| `actor:death` | `{ actor, point, impulse }` | ai |
| `sky:changed` | `{ hour, sunDir, sunIntensity, moonIntensity }` | sky (explicit time changes) |
| `sky:env` | `{ envMap, sunDir }` | sky |
| `wave:start` | `{ wave, enemies, squads, perSquad }` | ai |
| `wave:complete` | `{ wave, nextWave, delay }` | ai |
| `score:change` | `{ score, delta, reason, kills }` | game |
| `market:open` | `{ wave }` | market |
| `market:close` | `{}` | market |
| ↳ | A wave clear arms a 10 s grace period (loot ammo, see `MARKET_DELAY`), then the shop opens and freezes the sim clock (`time.scale = 0`), holding the AI wave countdown (its `waveDelay` of 20 s outlives the grace window). It closes on player action only (Skip/Esc), one session per wave. |
| `player:land` | `{ velocity, surface }` | player |
| `player:footstep` | `{ position, surface, running, stance }` | player |
| `ai:footstep` | `{ position, surface, gait }` | ai |
| ↳ | One boot per foot plant, taken from the animator's stride phase, so the cadence follows the clip (`gait` is `'walk'`, `'run'` or `'crouch'`). A few per second per walking actor: cull it by distance rather than logging it. | |
| `player:state` | `{ stance, sprinting, sliding, ads }` | player |
| `player:death` | `{ position, from, amount }` | player |
| `player:respawn` | `{ position }` | player |
| `player:heal` | `{ phase: 'start'\|'cancel'\|'complete', amount, health, bandages, reason }` | player |
| ↳ | Hold-to-heal bandage. Health is applied and one item consumed only on `complete`. Cancel/reset never heals. | |
| `player:heartbeat` | `{ strength, fraction }` | player |
| ↳ | Single low-health beat clock; audio plays one sound on the event, HUD renders the player's pulse. Starts below 50 HP and fades after injury settles. | |
| `ammo:pickup` | `{ amount, weapon, position }` | weapons |
| `intel:spawn` | `{ id, position }` | intel |
| ↳ | Each eligible wave clear randomly picks an unused site at least 18 m horizontally from the player and 24 m from other live caches. Within each spacing tier prefer sites absent from the last five drops (history persists across runs/reloads; ignored in captures). If none qualify, allow recent sites, then halve/waive spacing; used sites never return. | |
| `intel:available` | `{ count }` | intel |
| `intel:noise` | `{ position, loudness }` | intel |
| ↳ | The opening siren emits hearing evidence every 0.5 s within 75 m, starting immediately. Detector pings never alert AI. | |
| `intel:operation` | `{ active, position }` | intel |
| ↳ | Starts/stops the loud, looping fictional dual-tone alert (740+880 Hz, repeated double pulses; not the real government-alert signal). Claiming takes 4 s. Lid opens while held; interruptions close it and stop alarm/sparks. Audio also stops on shop, pause, death, restart and terminal error. | |
| `intel:spark` | `{ position }` | intel |
| ↳ | Small electrical arcs from the exposed electronics, every 0.16 s during operation. Uses the FX particle pool, no extra lights or decals. | |
| `intel:secured` | `{ id, position, card, cardLabel, credits }` | intel |
| ↳ | Pays +500 shop credits independently of score. Cards are unique archived names only; perk effects are deferred. Intel yields to busy hands and owns F over ammo when a case is aimed and visible. Prompt cleanup is owner-scoped via `ui.setPrompt(p, owner)` / `ui.clearPrompt(owner)`. |
| `hud:heard` | `{ bearing }` | ai |
| `hud:search` | `{ bearing, sector, remaining }` | game |
| ↳ | Coarse 45° last-enemy sector after a quiet stretch. Pause/shop do not advance the timer. |
| `game:restart` | `{ source }` | ui |
| `radio:strike` | `{ position }` | radio |
| `explosion` | `{ position, radius, damage }` | any |
| `engine:error` | `{ system, method, message }` | engine |
| ↳ | First subsystem exception (frame/resize hook or synchronous event listener) is terminal: abort the failed dispatch, skip subsequent gameplay hooks, freeze gameplay/input and show a reload-required error. Continue rendering unless rendering itself fails. Exposed as `engine.error`; capture pumps reject it. Only `engine:error` listeners are isolated individually so the modal and recorder still receive the original failure. | |
| `resize` | `{ width, height }` | engine |

If you need an event that is not listed, add a row here in the same commit.

## Surface types

Shared vocabulary for impact FX, decals, audio and footsteps. Physics tags every
collider with one of: `concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`,
`water`, `foliage`, `fabric`, `flesh`, `rubber`, `plaster`.

### Bullet resolution

`physics.fireBullet({ origin, dir, shooter, damage, penetration, maxDist,
maxRange?, travelled?, from?, dropoff?, weapon?, shot?, mask?, emit? })` returns
one pooled `{ impacts, segments, origin, end, shooter, weapon, shot, stopReason }`
result, valid until the next call. Both player projectiles and AI use this same
terminal resolver. All bullet layers include PLAYER; explicitly exclude the
shooter by owner identity, never the target's entire layer. Geometry resolves
before damage dispatch so deaths/removal/ragdolls cannot change the current shot.
Player rounds retain simulated flight; AI rounds retain instantaneous flight.

Collision `surface` names describe the impact finish. Optional `ballisticSurface`
describes the underlying structure (plaster-covered masonry uses concrete).
Cooked `_solid` vertex IDs preserve submitted kit-solid identity through material
batching and simplification (including warped face seams). Unlabelled geometry
uses connected components; instancing preserves distinct solid identity. A measured exit must belong to the
same object and component. Single-sided geometry only penetrates when explicitly
marked with `sheetThickness` in metres. Otherwise missing exits stop the round
with `unknown-thickness`, exposed in shot telemetry. No nominal-thickness fallback.
A different solid/proxy inside the entry-to-exit interval stops conservatively at
the entry with `overlapping-solids`; a matching exit never authorizes skipping
intervening cover. This does not model layered/overlapping construction.

## Render integration

`render` exposes these to other subsystems:

```js
const r = ctx.get('render');
r.renderer            // THREE.WebGLRenderer — do not change its state outside a frame
r.registerPass(pass)  // insert a custom post pass
r.addLight(light)     // register a punctual light so it participates in culling/budgets
r.prewarmLightShadow(light) // warm native depth at the live culled light count
r.requestEnvMap()     // PMREM env map currently in use
r.screenSize          // { width, height } of the internal render target
r.depthTexture        // linear depth, for soft particles / SSR
r.velocityTexture     // motion vectors, for TAA
```

Anything drawn into `viewScene` is composited after the world with a cleared
depth buffer.

Per-object opt-outs, honoured every frame by `render._collect`:

```js
mesh.userData.owNoPrepass = true  // keep out of the depth/normal/velocity prepass
mesh.userData.owNoShadow  = true  // do not cast into the CSM cascades
```

`owNoShadow` is the ONLY shadow-caster switch: the cascades draw with
`scene.overrideMaterial` and never consult `mesh.castShadow`. `src/ai` relies on
this for its off-screen actor LOD.

### The point-light count is a shader permutation key

`r.addLight()` puts a light under distance culling, and the cull sets
`light.visible = false` once the fade reaches zero. Three bakes the number of
**visible** point lights into every material's program cache key, so one lamp
crossing its radius recompiles every lit material in the scene — measured at
+33 to +36 programs and 640-900 ms on that single frame, five times in 900
frames. Anything that registers distance-culled point lights must keep the
visible count constant. Two ways, both pixel-exact:

- drive `intensity` to 0 and leave `visible` true (what `src/fx/lights.js` does), or
- park zero-intensity "ballast" lights and top the count up to a fixed slot
  budget every `lateUpdate` (what `src/world` does for its 17 practicals — see
  `_stabiliseLightCount`, which mirrors the renderer's own fade test because the
  cull runs *after* `lateUpdate`).

A light whose colour × intensity is exactly 0 adds a float `0.0` to the
irradiance accumulator, so extra lit slots cannot move a pixel.

### Run lighting

Sky owns the continuous clock (16:30 start, 9 hours / 600 active seconds,
24-hour wrap). Automatic progression is frozen in deterministic captures and
on player death; scaled dt freezes it during pause/shop. Explicit
`sky.setTimeOfDay()` remains available for captures. Both sun and moon movement
invalidate the sky/environment bakes. An owned zero-intensity sky must never
reactivate render's fallback daylight sun.

World owns one streetlight outage per run: first 21:00, 2.1-second flicker,
180 seconds dark, then restoration. Interiors are unaffected.
`world.setStreetlightPower(0..1)` stages captures; automatic outages are disabled
in deterministic mode. Restart resets clock and power.

Player owns an always-present, shadowed spot light in the world scene.
`player.setFlashlightEnabled(bool)` stages captures; T toggles it in live play.
Keep the spot/shadow count constant while off (zero intensity), prewarm its
depth variants (including AI's dummy skinned caster), and only update its shadow while on. Native shadow updates
must run against the full forward scene, not CSM-culling or prepass overrides.
Restart/death turn it off; pause/shop preserve its state. No AI modifiers.

### The world asset pipeline

JS under `tools/worldgen/` owns spatial and semantic world authoring. `npm run
world` compiles it into the visual GLB, uses meshoptimizer in Node to derive the
collision LOD directly from the assembled scene, and writes committed
content-hashed visual/collision GLBs plus manifest v2 under
`public/models/world/`, preserving GPU instancing and instance masks. Collision
is generated from solid visual geometry, not authored as a second spatial
source. Normal builds validate the committed files and their source fingerprint
without regenerating them. Runtime queries consume the generated manifest.

Authoring contract (`tools/worldgen/`): `layout.js`, `build.js`, `buildings.js`,
`interiors.js`, `ground.js`, `dressing.js`, `props.js`, `kit.js`, `util.js`
assemble the scene, and `placements/` is the sole authority for free-standing
objects (each placement has a stable ID + named `position/rotationDeg/scale`
fields in level-space metres). Change a building in `layout.js` or its owning
builder, never generated wall geometry. Collision has no separate authored
source — visual topology, prototype sharing, transforms and `surface` assignment
derive the cook. Before committing a world change: `npm run world -- --check`
must be byte-identical with committed outputs, then world smoke + physics tests
+ selected screenshots pass; commit JS source, `level.json`, and both hashed
runtime assets together.

### The model pipeline (`models`, `tools/export-models.mjs`)

The weapon and soldier meshes are authored as code (`src/weapons/models/*`,
`src/ai/soldier.js`) but the game never builds them: `export-models.mjs` runs the
SAME builders offline with a fixed RNG seed and writes GLBs + metadata JSON under
`public/models/` (deterministic — rebuilds of an unchanged tree are byte-identical).
Every invocation regenerates ALL procedural models; there is no mtime freshness check, because
the builders share transitive inputs (parts.js, geometry.js, rig.js, geo.js, ...)
that a per-file check cannot see. Writes are temp-file + atomic rename, and a pid
lock in `node_modules/.cache` serialises concurrent runs. The Vite config is an
async factory that runs the exporter before development and production builds, so
a clean checkout receives fresh models before it is served. Preview serves the
existing `dist` tree and does not regenerate source assets. Restart Vite or run
`npm run models` explicitly after changing an authoring module.

M4A1 Block II, MCX VIRTUS, P320 Compact, FN EVOLYS 7.62 and the early AX338
are authored exceptions: `src/weapons/m4.js`, `mcx.js`, `p320.js`, `evolys.js`
and `ax338.js` load committed GLBs under `assets/weapons/` through Vite asset
URLs. The procedural exporter builds only SMG and shotgun.
Normal builds need no Blender. Weapon-owned adapters sample authored curves and
map manifest beats to reload events. MCX retains shared procedural draw/holster;
M4/P320/EVOLYS own those clips and wrist/finger curves too. All use shared IK arms
and pooled live casings. EVOLYS has one native skinned cartridge/link belt;
weapon-owned ammunition masks its tail and restores it at the feed insertion beat.
M4/P320 are the starting primary/secondary; MCX and EVOLYS are shop primaries.
AX338 owns nine weapon/wrist/finger clips, including its manual bolt cycle.
Its original combat statistics, ammunition rules, action/event timings and
scope overlay remain unchanged. Review screenshots/reels are disposable
ignored output; rebuild instructions live beside each asset.

Runtime contract (`ctx.get('models')`, procedural weapons/soldiers):

- `await models.getWeapon(id)` → `{ id, label, fxClass, body, moving, nodes,
  shell, magSize }` with `body`/`moving` as Groups of one mesh per material slot
  (each mesh carries `userData.mat` via glTF extras). The viewmodel bakes the
  curvature wear/grime masks into the loaded geometry at build time exactly as it
  did for procedural builds, so GLB meshes are indistinguishable from them.
- `await models.getSoldier(name)` → `{ name, geometry, slots, boneNames, weapon,
  stats, variant }`. The GLB's material groups are re-merged into ONE skinned
  BufferGeometry (one draw call per slot, as before) — each glTF primitive's
  accessors span the shared vertex buffer, so the merge slices each primitive to
  the range its indices use. The exported skeleton keeps RIG bone order; agents
  bind the geometry to their own `RIG.createSkeleton()` by index, and both the
  exporter and `ai` assert the order matches.
- The AI system VALIDATES every loaded soldier record before caching it (bone
  order vs RIG, material slots vs geometry groups, skin attributes, variant
  name) and throws a boot-failing error naming the mismatch — a stale asset
  cannot silently spawn broken actors.

Verified byte-identical round-trip: positions/normals/uvs/colors/indices diff at
0.0 against the procedural builds (skin weights within 1 float32 ULP from the
loader's weight normalisation).

### Pre-warm

`src/core/prewarm.js` runs before the first frame and calls
`prewarmMaterials(ctx)` on every subsystem that implements it, including
`render`, `world`, `ai`, `fx`, `weapons` and `radio`. The contract: **build and compile every material the subsystem
can produce, without spawning gameplay objects, drawing a gameplay frame, or
touching the clock/RNG.** `renderer.compileAsync(scene, camera)` alone only
reaches the forward lit variant — not the CSM depth pass, the MRT prepass, or
the post chain. Two traps:

- A render target must be bound while compiling. `outputColorSpace` and
  `toneMapping` are part of the cache key and are read off the *currently bound*
  target, so compiling with the canvas bound warms the wrong variant.
- Hooks compile after restoring the spawn camera and hiding the renderer’s
  fallback sun, matching the sky-owned directional-light count. Hidden authored
  weapons and FX participate in boot prewarm; do not skip them as legacy docs did.

## Quality bar

Every visual subsystem is reviewed by an adversarial critic against real CoD
frames. Non-negotiables:

- **No flat/untextured surfaces.** Every material needs albedo variation, a
  normal map, roughness variation, and a detail layer visible at 0.5 m.
- **No uniform lighting.** Contact shadows, bounce, ambient occlusion, and a
  clear key/fill/rim separation.
- **Physically plausible values.** Albedo in 0.02–0.9, metals are 0 or 1,
  real-world light intensities, exposure-driven not multiplier-driven.
- **Nothing perfectly straight, clean, or repeated.** Edge wear, grime in
  crevices, subtle warp, varied instance rotation/scale.
- **Every action has weight.** Recoil, camera shake, screen-space impulse,
  audio transient, and a visual FX on every impact.
