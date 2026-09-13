# OVERWATCH — engine contract

**Every agent must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty. WebGL2 + Three.js r185, with no runtime network dependencies. Textures
and animation are generated procedurally; meshes load from local GLBs. World
geometry follows the authoring source in `tools/worldgen/`. Runtime never executes mesh builders.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another agent owns
   every other directory and your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes parallel work safe. (A few
   tolerated static couplings exist for shared constants: `ai`→`weapons`,
   `weapons/preview`→`materials`.)
3. **No new runtime npm dependencies.** `three` only at runtime. Offline build
   tooling may use dev dependencies; no CDN fetches or remotely hosted
   images/HDRIs/models/audio files — the game must run fully offline. Authored
   source and generated runtime assets live in this repository.
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
| `player` | `src/player/` | movement state machine, camera feel, sprint/slide/mantle/lean, health & armour |
| `weapons` | `src/weapons/` | weapon meshes, viewmodel rig, ADS, recoil, sway, bob, reload & inspect animation, ballistics |
| `fx` | `src/fx/` | GPU particles, muzzle flash, tracers, impacts, decals, smoke, blood, shells |
| `ai` | `src/ai/` | enemy characters, navigation, perception, cover selection, combat behaviour, wave spawning |
| `game` | `src/game/` | survival run state, single-player score, kill and wave-clear rewards |
| `market` | `src/market/` | credits economy, between-wave shop session, purchases (grenades, armour plates, ammo refill) |
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
| `weapon:reload` | `{ weapon, phase: 'start'\|'magout'\|'magin'\|'end' }` | weapons |
| `weapon:shell` | `{ position, velocity }` | weapons |
| `bullet:impact` | `{ point, normal, surface, incident, damage }` | physics |
| `bullet:tracer` | `{ from, to, speed }` | weapons |
| `shot:resolved` | `{ shooter, weapon, from, to, result, target, part, damage, pellet }` | weapons / ai (telemetry only) |
| `damage:dealt` | `{ target, amount, headshot, killed, point }` | ai / physics |
| ↳ | means *damage dealt **to** `target`*. `target` is the local player when an enemy round connects (`'player'`, the player system, or anything with `isPlayer === true`) — filter it out before drawing a hitmarker. Damage is applied by the target's own listener, never by the emitter as well. Physics emits at most one `damage:dealt` per actor per round, using the highest-scale hitbox the round intersects. | |
| `damage:taken` | `{ amount, from: Vector3, health, armourAbsorbed, armour, plateBreak }` | player |
| ↳ | Incoming is halved while any plate remains, then leftover soaks into armour. `amount` is the damage that reached **health**; `armourAbsorbed` is what plates stopped. `plateBreak` is true when a 50 HP plate was fully consumed by this hit. |
| `actor:death` | `{ actor, point, impulse }` | ai |
| `wave:start` | `{ wave, enemies, squads, perSquad }` | ai |
| `wave:complete` | `{ wave, nextWave, delay }` | ai |
| `score:change` | `{ score, delta, reason, kills }` | game |
| `market:open` | `{ wave }` | market |
| `market:close` | `{}` | market |
| ↳ | A wave clear arms a 10 s grace period (loot ammo, see `MARKET_DELAY`), then the shop opens and freezes the sim clock (`time.scale = 0`), holding the AI wave countdown (its `waveDelay` of 20 s outlives the grace window). It closes on player action only (Skip/Esc), one session per wave. |
| `player:land` | `{ velocity, surface }` | player |
| `player:footstep` | `{ position, surface, running }` | player |
| `player:state` | `{ stance, sprinting, sliding, ads }` | player |
| `player:death` | `{ position, from, amount }` | player |
| `player:respawn` | `{ position }` | player |
| `ammo:pickup` | `{ amount, weapon, position }` | weapons |
| `hud:heard` | `{ bearing }` | ai |
| `game:restart` | `{ source }` | ui |
| `radio:strike` | `{ position }` | radio |
| `explosion` | `{ position, radius, damage }` | any |
| `resize` | `{ width, height }` | engine |

If you need an event that is not listed, add a row here in the same commit.

## Surface types

Shared vocabulary for impact FX, decals, audio and footsteps. Physics tags every
collider with one of: `concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`,
`water`, `foliage`, `fabric`, `flesh`, `rubber`, `plaster`.

## Render integration

`render` exposes these to other subsystems:

```js
const r = ctx.get('render');
r.renderer            // THREE.WebGLRenderer — do not change its state outside a frame
r.registerPass(pass)  // insert a custom post pass
r.addLight(light)     // register a punctual light so it participates in culling/budgets
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

The MCX VIRTUS is the authored exception: `src/weapons/mcx.js` loads the committed
`assets/weapons/mcx-virtus/mcx-virtus.glb` directly through a Vite asset URL.
The procedural exporter skips `mcx`; normal builds bundle it without Blender.
Its weapon-owned adapter converts coordinates, preserves packed PBR detail,
samples five gameplay clips, fits shared IK arms and maps manifest beats to
the existing reload events. Live casing ejection uses the FX pool, not the single
showcase casing. It is a separate shop primary; the starting M4A1 stays unchanged.

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
`prewarmMaterials(ctx)` on every subsystem that implements it (`render`,
`world`, `ai`). The contract: **build and compile every material the subsystem
can produce, without spawning gameplay objects, drawing a gameplay frame, or
touching the clock/RNG.** `renderer.compileAsync(scene, camera)` alone only
reaches the forward lit variant — not the CSM depth pass, the MRT prepass, or
the post chain. Two traps:

- A render target must be bound while compiling. `outputColorSpace` and
  `toneMapping` are part of the cache key and are read off the *currently bound*
  target, so compiling with the canvas bound warms the wrong variant.
- `fx` is excluded and self-warms on frame 2: its key depends on the visible
  light count, which is only settled inside the first rendered frame.

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
