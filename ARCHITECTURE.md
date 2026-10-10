# Engine contract

Browser FPS: pinned Three.js 187dev + WebGPU only. Assets and WASM are local; no WebGL fallback.
Read this before changing a subsystem. Workflow and validation: [AGENTS.md](AGENTS.md).

## Ownership and subsystem API

Own only your assigned subsystem. Shared/lead-owned: `src/core/`, `src/main.js`,
`src/dev/`, `tools/`, `vite.config.js`. Coordinate changes across owners.
Use `ctx.get(id)` rather than importing other subsystems. Existing constant
couplings (`ai` → `weapons`, `weapons/preview` → `materials`) are exceptions.

| id / directory | responsibility |
|---|---|
| `models` (core/models.js + tools/export-models.mjs) | Lead-owned GLB export/loading |
| `render` | WebGPU renderer, TSL frame graph, CSM, composite |
| `materials` | Procedural PBR texture forge, detail/triplanar materials |
| `sky` | Atmosphere, day/night, environment, volumetric fog |
| `world` + tools/worldgen | Level meshes, metadata, props, spawns |
| `physics` | Collision, controllers, rigid bodies, ragdolls, penetration |
| `player` | Movement, camera, health, armour, healing |
| `weapons` | Definitions, GLB adapters, viewmodel, handling, ballistics |
| `fx` | Particles, impacts, decals, tracers, blood, shells |
| `ai` | Soldiers, squads, navigation, perception, waves |
| `game` | Survival state, score/rewards, HUD threat cues |
| `market` | Between-wave shop/economy |
| `intel` | Cache spawning, interaction, credits and archive |
| `radio` | Strike, bomber, bombs, blast chain |
| `ui` | HUD, menus, overlays |
| `audio` | Synthesis/recordings, spatialization, occlusion |

Each system declares `static id`, `static deps`, and implements needed hooks:
`async init(ctx)`, `fixedUpdate(h, ctx)` (120 Hz), `update(dt, ctx)`,
`lateUpdate(dt, ctx)`, `resize(w, h, ctx)`, `async dispose()`.
Teardown is reverse-order and failure-isolated.

`ctx`: `scene/camera` (world), `viewScene/viewCamera` (separate first person),
`canvas`, `config`, `events`, `input`, `time`, `rng`, `get/peek/has(id)`.
Time contains `elapsed, raw, dt, fixed, alpha, scale, frame`; interpolate with
`alpha`. Respect `config.q` feature flags and particle/decal/shadow budgets.
Use `ctx.rng` or a retained fork, never `Math.random()`. Preallocate hot-path
state; dispose owned resources, not borrowed textures/geometry.

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
| ↳ | First subsystem exception (frame/resize hook or synchronous event listener), or explicit `ctx.engine.fail(system, method, error)`, is terminal: abort the failed dispatch, skip subsequent gameplay hooks, freeze gameplay/input and show a reload-required error. Continue rendering unless rendering itself fails. Exposed as `engine.error`; capture pumps reject it. Only `engine:error` listeners are isolated individually so the modal and recorder still receive the original failure. | |
| `resize` | `{ width, height }` | engine |

If you need an event that is not listed, add a row here in the same commit.

## Physics and world contracts

Surface names: `concrete, metal, wood, dirt, sand, glass, water, foliage, fabric,
flesh, rubber, plaster`.

`physics.fireBullet({ origin, dir, shooter, damage, penetration, maxDist,
maxRange?, travelled?, from?, dropoff?, weapon?, shot?, mask?, emit? })` returns
pooled `{ impacts, segments, origin, end, shooter, weapon, shot, stopReason }`,
valid until the next call. Player flight and instantaneous AI rounds share this
resolver. Include PLAYER in bullet masks; exclude the shooter by owner, not layer.
Resolve geometry before damage dispatch. Targets own health; range/region scaling
is already applied and must not be repeated.

Collision `surface` is the impact finish; optional `ballisticSurface` determines
penetration. Preserve cooked `_solid` IDs; unlabelled geometry uses connected
components and instances remain distinct. Exits must match object/component.
Only explicit `sheetThickness` authorizes single-sided penetration; missing exits
stop as `unknown-thickness`, overlapping solids as `overlapping-solids`.
No nominal fallback or layered-solid approximation.

JS in `tools/worldgen/` is world-authoring authority; `placements/` owns
free-standing prop transforms. `npm run world` builds visual meshes, cooks
collision from those same meshes with meshoptimizer, and exports manifest v2
plus content-hashed GLBs under `public/models/world/`. Preserve instancing/masks.
Never author separate collision geometry or hand-edit generated files. Commit
source + manifest + generated runtime assets together. Validate with
`npm run world -- --check`, world/physics tests and screenshots.

## AI physical planning

`src/ai/attachment.js` owns the shared native attachment oracle; authoring and
runtime use the same controller/BVH algorithm. Physics owns immutable collision
snapshot construction in `src/physics/query-snapshot.js`. AI owns one module
worker, its scratch/controller, revisions, bounded queues and lifetime. Initialize
before AI readiness; transfer copies, never live collision buffers.

Workers return exact static proofs, not tactical decisions. `NAV_PENDING` and
`NAV_CANCELLED` are not unreachable/blocked answers. Reevaluate live visibility,
threats, claims and scoring before committing. Local observation candidate geometry
is frozen for its intent; movement still requires `_goTo`'s complete route from
the live foot. A close live-origin prefix may execute at most one native motor
move; unknown delegates the original full budget, never a shortened rejection.
Exact repeated-state rejection may end a failed scratch simulation early, after
arrival/prefix gates, without rounding state or shortening its physical budget.
Explicit scratch-only `lookAhead` scopes may use provisional positive answers to
discover further requests, but still return `NAV_PENDING`: no claims, endpoint
cache publication, Detour solve or movement may consume provisional success.
Only audited cover/peek/observation scans opt in; normal routes do not.
Failures are terminal rather than falling back to unbounded main-thread work.
The runtime-only efficiency trial and its limits are in
[docs/runtime-query-efficiency.md](docs/runtime-query-efficiency.md).
Async tactical admission is **not** same-tick seeded replay determinism; that
contract and diagnostic/validation boundaries are in [docs/ai-worker.md](docs/ai-worker.md).

## Render integration

Public render surface:
- `renderer`: initialized strict-WebGPU renderer.
- `registerPass({ order, asNode(color, exposure), resize, dispose })`.
- `addLight(light)`, `prewarmLightShadow(light)`.
- `viewLightLevel`; borrowed `sunDir` (never mutate).
- `screenSize`; `depthTexture` (positive view-space metres),
  `velocityTexture`, `hdrTexture` (world only).

Post passes normally consume textures through `asNode`; optional
`asColorNode(color, exposure)` must not sample displaced/neighbouring pixels.
The graph owns RTTs it creates, not borrowed outputs. Pipeline disposal is not recursive.

Graph order: opaque depth/normal/velocity → GTAO/world lighting → world TAA →
optional additive SSR → fog/haze → separate transparent-black, non-MSAA first-person
pass → low-health effects → exposure → bloom → AgX → optional LUT.
SSR composition/temporal quality is deferred to #370. Exposure works without a LUT.
SSR uses evaluated roughness/metalness, not overridden scalar material defaults.
First-person depth/history never merges with world depth/history or world haze.
View-pass context identity prevents camera-specialized environment cache sharing.
World beauty alone uses clustered point lighting; the unlit prepass and first-person
lighting stay separate. The graph sizes its owned clustered node from the drawing
buffer **before** rendering and explicitly disposes it. Do not rely on automatic
late resizing or recursive PassNode cleanup. Defaults support the current 24-point
light pool within 64 lights/cluster; new active points must fit that capacity and
have positive cutoff ranges.
First-person RGB is premultiplied; additive FX/optics preserve destination alpha,
ordinary translucency uses source-over. Injury effects include the viewmodel.

Prepass layer 1 contains opaque meshes/lights, not sky/transparent FX. Schedule it
exactly once before world rendering at every quality, even without AO.
`afterDepth` draws haze against current-frame depth; soft particles borrow it.
Mesh opt-outs: `userData.owNoPrepass = true`, native `castShadow = false`.
Refresh CSM frustums when the unjittered projection changes. Bias depends on slope/
cascade texels. Fog borrows native cascade depth/matrices, adding no shadow draw.
Hoist noise outside the fog march; its uniform uses application frames, not native
renderer/compile time. Keep haze's private RG target.

Three hashes visible light **IDs** and shadow state. Keep authored practicals and
FX pools visible with stable identities; dim via `intensity = 0`, not visibility.
Zero intensity is not proof of zero shader work. Stable sky proxies transfer
sun/moon values without changing shader IDs/CSM ownership; source lights are hidden.
An owned zero-intensity sky must not reactivate fallback daylight.

HDR exposure samples unexposed world beauty asynchronously, at most one readback
pending. It excludes fog, SSR/TAA, viewmodel and post effects. Elapsed-time smoothing
freezes with paused time. Camera/FOV can still affect metering. Keep approved
key/limits/bias; this policy is not a WebGL visual-parity claim.

Sky starts at 16:30; 9 hours pass per 600 active seconds, wrapping at 24 hours.
Automatic clock freezes in deterministic captures and on death; pause/shop freeze
scaled time. Sun/moon changes invalidate environment bakes. Explicit
`sky.setTimeOfDay()` remains available. Borrow `sky.keyDirection`, not astronomical
vectors, for rendered lighting. Streetlight outage: first 21:00, 2.1 s flicker,
180 s dark, then restoration; interiors unaffected. Restart resets it; deterministic
captures disable automation and use `world.setStreetlightPower()`.

Player owns one always-present shadowed spotlight. T/`setFlashlightEnabled()`
changes intensity, not light count; shadow updates run only while on. Warm its
skinned depth variants, then render shadows against the full forward scene.
Death/restart switch it off; pause/shop preserve it. No AI modifier.

Unexpected GPU loss is terminal and stops the loop; intentional destruction is
not a gameplay failure. Init/prewarm must not publish readiness after loss.
Detach owned callbacks/lights and finish failure-isolated teardown. Upstream now
owns TRAA depth/history disposal; keep first-build and active-history lifetime
regressions, not external disposal of its private textures. The Git dependency's
ESM exports use source so committed stale bundles cannot hide the pinned fixes.
Keep source-export/buffer-name corrections exact-commit/hash guarded; see README
upgrade checks. Builder-local WGSL buffer names enable native program/pipeline reuse;
never remove per-object instanced-buffer identity from shader-builder cache keys.

Bakes use native top-left texture UVs and shared `QuadMesh` geometry: no extra Y
flip or disposal of borrowed geometry. Preview PNGs redirect the output target
with an untagged attachment, avoiding double sRGB. Gameplay readback uses its
explicit display-transform path. Standalone FX reuses depth/world/view/haze
composition with its ACES transform; first-person refraction uses world coordinates.

## Models

`tools/export-models.mjs` runs the same procedural builders offline with a fixed
seed; runtime never builds meshes. Regenerate ALL procedural models, since
transitive builder inputs invalidate naive per-file caches. Export uses atomic
writes and a cache lock. Vite dev/build runs it; preview uses existing `dist`.
Normal builds need no Blender.

M4/MCX/P320/EVOLYS/MPX/AX338 use committed GLBs and weapon-owned adapters under
`src/weapons/`; only shotgun remains a procedural weapon export.
Preserve shared IK, ADS/sway/recoil and pooled casings. Source/regen/reference
contracts live beside each asset. Weapons force physical materials; arms select
standard/physical from their source. Preserve authored maps/specular factors and
borrowed texture ownership. Native copy, clone/cache-safe soldier output and
render-owned environment re-registration contracts are documented in
[docs/material-integration.md](docs/material-integration.md).

`models.getWeapon(id)` returns `{ id, label, fxClass, body, moving, nodes,
shell, magSize }`. Groups contain meshes keyed by `userData.mat`; viewmodel
curvature/wear masks are built from loaded geometry.
`models.getSoldier(name)` returns `{ name, geometry, slots, boneNames, weapon,
stats, variant }`. Merge GLTF primitives into one skinned geometry with slot
groups, slicing shared accessors correctly. Bone order must match
`RIG.createSkeleton()`; models and AI validate names/order, groups, slots and skin
attributes and fail boot on mismatches.

## Prewarm

`src/core/prewarm.js` awaits subsystem `prewarmMaterials(ctx)` before gameplay.
Build all producible variants without spawning gameplay entities, advancing
clock/RNG or drawing gameplay geometry. Restore spawn camera/fallback light state
before hooks. Bind the actual target: tone mapping/output color space affect keys.
`compileAsync` alone does not warm CSM, MRT or the post graph. Render owns world/view
warming through the actual graph; do not reintroduce pose/direct scene compiles
that build unused contexts or repeat it in a world hook.

- Warm actual native graph variants with zero draw ranges. Await visible rAF;
  each graph has a 120 s deadline. Hidden/stalled tabs must fail visibly, not
  publish readiness. Timeout/loss/disposal cancels pending callbacks.
- One failure-safe cleanup boundary restores visibility, ranges/counts, camera
  layers/jitter/projection, native MRT/lighting/context, scene overrides and clear/
  target state. Failure is terminal except diagnostic `?prewarm=0`.
- Weapons await deferred models and reveal hidden weapon/optic/grenade ancestors,
  dropped magazines and a temporary ammo visual. Boot-only; no gameplay retry,
  pickup ID/body or RNG consumption.
- AI cannot cache successful warmup before graph creation. Temporary meshes borrow
  real geometry/groups and cast/receive shadows; dispose only their skeletons.
  Await player/AI flashlight warming while the temporary skinned caster is attached.
- Radio stages borrowed bomber/bomb visuals and detaches on success/failure,
  without strike/events/gameplay advancement. Intel uses actual graph variants.
- Haze warms its private RG context, restoring target/clear/ranges/counts/
  visibility/activity even after failure.

Diagnostic counter/readback contracts and canonical prewarm reporting are in
[docs/native-maintenance.md](docs/native-maintenance.md). They do not change warmup
staging or renderer-info reset scheduling.

## Quality

Aim for rich, physically plausible materials/lighting and convincing motion, not
flat colours or uniform light. Respect albedo/metalness conventions, detail maps,
contact shadows, irregularity and weapon feedback. Finish units, authored asset
ownership and explicit readability/optics exceptions are documented in
[docs/material-calibration.md](docs/material-calibration.md). Smoke tests are
correctness gates, not visual or combat-performance acceptance.
