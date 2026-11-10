# Engine contract

Browser FPS: Three.js r187 (`0.187.0`) + WebGPU only. Assets and WASM are local.
Read this before changing a subsystem. Workflow and validation: [AGENTS.md](AGENTS.md).
Gameplay numbers (timings, distances, rewards) live in code: `src/*/tuning.ts`,
`src/weapons/defs.ts` and subsystem constants, not in this document.

## Subsystems

Subsystems reach each other through `ctx.get(id)`, not imports; the constant coupling
`ai` → `weapons` is the one exception. `src/core/`, `src/main.ts`, `src/dev/`,
`tools/` and `build/` are shared infrastructure used by every subsystem.

| id / directory                                     | responsibility                                              |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `models` (core/models.ts + tools/export-models.ts) | GLB export/loading                                          |
| `render`                                           | WebGPU renderer, TSL frame graph, CSM, composite            |
| `materials`                                        | Procedural PBR texture forge, detail/triplanar materials    |
| `sky`                                              | Atmosphere, day/night, environment, volumetric fog          |
| `world` + tools/worldgen                           | Level meshes, metadata, props, spawns                       |
| `physics`                                          | Collision, controllers, rigid bodies, ragdolls, penetration |
| `player`                                           | Movement, camera, health, armour, healing                   |
| `weapons`                                          | Definitions, GLB adapters, viewmodel, handling, ballistics  |
| `fx`                                               | Particles, impacts, decals, tracers, blood, shells          |
| `ai`                                               | Soldiers, squads, navigation, perception, waves             |
| `game`                                             | Survival state, score/rewards, HUD threat cues              |
| `market`                                           | Between-wave shop/economy                                   |
| `intel`                                            | Cache spawning, interaction and credits                     |
| `radio`                                            | Strike, bomber, bombs, blast chain                          |
| `ui`                                               | HUD, menus, overlays                                        |
| `audio`                                            | Recordings/synthesis, spatialization, occlusion             |

Each system declares `static id`, `static deps`, and implements needed hooks:
`async init(ctx)`, `fixedUpdate(h, ctx)` (120 Hz), `update(dt, ctx)`,
`lateUpdate(dt, ctx)`, `resize(w, h, ctx)`, `async dispose()`.
Teardown is reverse-order and failure-isolated.

`ctx`: `scene/camera` (world), `viewScene/viewCamera` (separate first person),
`canvas`, `config`, `events`, `input`, `time`, `rng`, `get/peek/has(id)`.
`src/core/context.ts` owns the provider-keyed `EngineContext`; subsystem types come
from their implementations, not handwritten consumer APIs. `Engine.add()` and
`registry.add(id, instance)` check the ID/instance pairing against that map.

`src/core/bindings.ts` owns default bindings, action IDs and labels. Input snapshots
actions; gameplay consumers own their state machines. `src/ui/controls.ts` builds the
pause-menu reference from the binding labels. Tab and wheel are cycle requests, not
guaranteed swaps.

Time contains `elapsed, raw, dt, fixed, alpha, scale, frame`; interpolate with
`alpha`. Respect `config.q` feature flags and particle/decal/shadow budgets.
Use `ctx.rng` or a retained fork, never `Math.random()`. Preallocate hot-path
state; dispose owned resources, not borrowed textures/geometry.

## Cross-subsystem events

[src/core/events.ts](src/core/events.ts) owns event names and typed plain-object
payloads for `ctx.events`. Change a type together with its producers/consumers.
Weapon identities are `WeaponId | 'ai_rifle'`; free-form external names belong at the
input/audio adapter boundary, not on gameplay events. When dispatching unions, pass a
correlated name/payload tuple. Semantics the types don't capture:

- `bullet:segment` is reached free flight, clipped to collisions/range, excluding
  material interiors. Audio/suppression/tracers consume it rather than rebuilding
  rays from `weapon:fire`. Deduplicate near misses by shot; copy pooled vectors.
  `shot:resolved` is telemetry, not another damage path.
- `damage:dealt` means damage **to** target; exclude player targets from hitmarkers.
  Targets alone apply health damage. Physics emits once per actor/round using the
  highest reached region, with range/penetration/region scaling already applied.
  `from` is the muzzle; `source` is the shooter.
- `damage:taken.amount` is health damage; plates halve incoming damage and absorb
  the remainder first. `armourAbsorbed` records absorption; `plateBreak` records a
  consumed plate. Healing applies only on `complete`, never on cancellation. One
  player-owned heartbeat clock drives low-health audio/HUD.
- A wave clear starts an ammo-looting grace period, then one player-dismissed shop
  session that freezes scaled time and the AI wave countdown.
- `ai:footstep` is one boot per animated stride plant; cull by distance.
  `ai:bark` requests contact on visual acquisition, reload on reload start, or a
  grenade announcement after a successful launch. `voice` is the actor's immutable
  sequential ID (audio maps it to a fixed identity); `position` is retained, not
  pooled scratch. Speech has one spatial slot, cooldowns and no queue; grenade
  announcements preempt. Pause/shop/death/error stop speech; restart clears it.
  Intents without recordings stay silent.
- `hud:search` is a coarse last-enemy sector; pause/shop freeze its timer.
- Intel picks unused sites by player/case spacing and recency, relaxing recency
  before spacing and never reusing a consumed site. Interrupting a claim closes the
  lid and stops alarm/sparks; shop/pause/death/restart/error also stop its audio.
  The siren is AI hearing evidence; detector pings are not. Securing pays shop
  credits independently of score. Intel yields to busy hands and has aimed-visible
  priority over ammo. Prompts use `ui.setPrompt(p, owner)` / `ui.clearPrompt(owner)`.
- The first `engine:error` is terminal: abort the failed synchronous dispatch,
  skip gameplay hooks, freeze input/gameplay and require reload. Rendering
  continues unless it failed. Capture pumps reject `engine.error`. Only error
  listeners are individually isolated so UI/recorder retain the original error.
- `weapon:shell` uses pooled casings; shotgun FX uses the offline spent hull.

## Physics and world

`src/physics/surfaces.ts` owns `SurfaceName`; carry it through physics results,
events, FX and audio. Explicit collision/ballistic metadata is validated, never
guessed or replaced. Only unlabelled mesh/material names use `guessSurface`; world
query/visual authoring labels are a separate vocabulary.

`physics.fireBullet({ origin, dir, shooter, damage, penetration, maxDist,
maxRange?, travelled?, from?, dropoff?, weapon?, shot?, mask?, emit? })` returns
pooled `{ impacts, segments, origin, end, shooter, weapon, shot, stopReason }`,
valid until the next call. Player flight and instantaneous AI rounds share this
resolver. Player callers use `stopAtExit`, `deferActorDamage`, `ignoreActors` and
prior `layers` to resume from the pooled `continuation` (position/direction,
cumulative distance, damage and penetration). Charge material transit time and
retain actor/layer budgets across fixed ticks; terminal interiors resolve atomically.
Include PLAYER in bullet masks; exclude the shooter by owner, not layer.
Resolve geometry before damage dispatch. `emit: false` defers all effects/damage;
`physics.publishBullet(result)` publishes that exact pooled result before the next
shot. AI rejects a resolved teammate contact before committing firing state.
Select actor regions only along reached free-flight/interior paths, including
penetration deflection. Timed player rounds copy actor contacts before publishing,
withholding only actor damage. `emitBulletDamage` publishes each contact once after
the round crosses that actor's forward capsule extent; moving hitboxes may extend,
never shrink, that frontier. World effects and free flight do not wait. Terminal
stops, expiry, recycling and clear flush remaining reached contacts. AI damage
publishes immediately. Targets own health; scaling is already applied.

AI states use `AiState` from `agent.ts`; player locomotion uses `PlayerMoveState`,
with presentation-only `lean` added by `PlayerState`. `WeaponMode` stays semantic
through HUD polling (uppercase only for display); `BusName` is mixer-owned.

Collision `surface` is the impact finish; optional `ballisticSurface` determines
penetration. Preserve cooked `_solid` IDs; unlabelled geometry uses connected
components and instances stay distinct. Exits must match object/component. Only
explicit `sheetThickness` authorizes single-sided penetration; missing exits stop
as `unknown-thickness`, overlapping solids as `overlapping-solids`.

Checked TypeScript in `tools/worldgen/` is the world source. Map layout,
configuration, intel sites and prop transforms live in `level/`; `level/placements/`
is data-only and `placement.ts` owns validation, placement and clutter clearance.
See the [world editing map](tools/worldgen/README.md). `bun run world` builds meshes
and cooks collision with meshoptimizer from canonical instance buckets. Visual-only
coalescing may join non-distance-LOD clouds within a 64 m X/Z span but never changes
collision or navigation inputs. A prototype's optional `visualGeo` is visual only;
support, collision and navigation use canonical `geo`, topology and RNG/instance
inputs. Manifest v2 and content-hashed GLBs are generated into ignored
`public/models/world/`. Preserve instancing/masks; never author separate collision
geometry. Validate with `bun run world -- --check`, world/physics tests and screenshots.

## AI physical planning

`src/ai/attachment.ts` owns the shared native attachment oracle; authoring and
runtime use the same controller/BVH algorithm. Physics builds immutable collision
snapshots in `src/physics/query-snapshot.ts`. AI owns one module worker, its
scratch/controller, revisions, bounded queues and lifetime. Initialize before AI
readiness; transfer copies, never live collision buffers.

`src/ai/attachment-*.ts` owns the caller map, proof/pending/cancellation semantics,
bounded native budgets and tactical revalidation. Unknown is never provisional
success or unreachable; failures are terminal, with no main-thread fallback. Async
admission is not same-tick seeded replay determinism.

## Render

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
fog/haze → separate transparent-black, non-MSAA first-person pass → low-health
effects → exposure → bloom → AgX → optional LUT. Exposure works without a LUT.
First-person depth/history never merges with world depth/history or world haze.
View-pass context identity prevents camera-specialized environment cache sharing.
Only world beauty uses clustered point lighting. The graph sizes its clustered node
from the drawing buffer **before** rendering and disposes it explicitly. Active point
lights must fit the light pool/cluster capacity and have positive cutoff ranges.
First-person RGB is premultiplied; additive FX/optics preserve destination alpha,
ordinary translucency uses source-over. Injury effects include the viewmodel.

Prepass layer 1 contains opaque meshes/lights, not sky/transparent FX. Schedule it
exactly once before world rendering at every quality, even without AO.
`afterDepth` draws haze against current-frame depth; soft particles borrow it.
Mesh opt-outs: `userData.owNoPrepass = true`, native `castShadow = false`.
Pickup instances keep stable slots; the world camera's layer-1 prepass callback
validates their birth/reuse history.
Refresh CSM frustums when the unjittered projection changes. Bias depends on slope/
cascade texels. Fog borrows native cascade depth/matrices, adding no shadow draw.
Hoist noise outside the fog march; its uniform uses application frames. Haze keeps
a private RG target.

Three hashes visible light **IDs** and shadow state. Keep authored practicals and
FX pools visible with stable identities; dim via `intensity = 0`, not visibility.
Zero intensity is not zero shader work. Stable sky proxies carry sun/moon values
without changing shader IDs/CSM ownership; source lights are hidden.
Sky is required: render borrows its pre-init direction and renders only after sky
initialization; a zero-intensity sky stays dark. Borrow `sky.keyDirection` for
lighting. The clock (`src/sky/tuning.ts`) freezes in deterministic captures, on
death and with paused time; `sky.setTimeOfDay()` sets it. Sun/moon changes
invalidate environment bakes. The one-off streetlight outage (`src/world/lighting.ts`)
spares interiors and resets on restart; deterministic captures use
`world.setStreetlightPower()`.

HDR exposure asynchronously samples unexposed world beauty with at most one readback
pending, excluding fog, TAA, viewmodel and post effects. Smoothing freezes with paused
time. Keep the approved key/limits/bias.

Player owns one always-present shadowed spotlight. F/`setFlashlightEnabled()`
changes intensity, not light count; shadow updates run only while on. Death/restart
switch it off; pause/shop preserve it.

Unexpected GPU loss is terminal and stops the loop; intentional destruction is not
a gameplay failure. Init/prewarm must not publish readiness after loss. Detach owned
callbacks/lights and finish failure-isolated teardown. Builder-local WGSL buffer names
let compatible instanced meshes share shader-builder state and pipelines, never
object buffers; object-specific builds stay uncached. On a Three upgrade, keep the
TRAA lifetime and pixel-level buffer isolation/reuse regressions passing.

Bakes use native top-left texture UVs and shared `QuadMesh` geometry: no extra Y
flip or disposal of borrowed geometry. Gameplay readback uses its explicit
display-transform path. First-person refraction uses world coordinates.

## Gameplay HUD

The HUD is `ui/pixi-hud.ts` (`PixiHud`): one passive WebGPU canvas that borrows
Three's GPUDevice through `ui/pixi-device.ts`, below the native centre/chrome/menu
layers. Only Three destroys the device; Pixi owns its stage, geometry, shaders,
textures and canvas. Gameplay snapshots/events are the authority; controllers own
prompts, progress, banners and status priority, and presenters redraw only changed
visible values. HUD initialization failure goes to the native reload dialog; the
game never starts without a HUD. Start/error controls, menus, shop, game-over and
the field-radio panel are native DOM. Details: [docs/hud.md](docs/hud.md).

## Models

The [asset/world editing map](docs/assets.md) connects authoring tools, products
and runtime consumers. Each weapon's authoring lives in `tools/blender/<weapon>/`
(`build.py`, `check.py`).

`build/models.ts` owns gltfpack runtime cooking and per-model profiles
(`bun run models:cook`); `tools/build-assets.ts` rebuilds stale models during
dev/build. New profiles need adapter, animation and visual validation.
All seven weapons (M4, MCX, P320, EVOLYS, MPX, AX338, M590) use generated GLBs with
weapon-owned adapters in `src/weapons/`. M4/MCX adapters decode packed finish
metadata. Rigid assemblies use ordinary meshes (EVOLYS skins only its belt); keep
moving controls and magazines independent. The M590 is a provisional review
prototype; its event-only clips share one mixer and shell insertion uses adapter-owned
visibility, while damage and 6+1 accounting stay in the common weapon system.

`src/weapons/defs.ts` owns the tuning schema, IDs, slots and fire modes; check data
against the schema. Key internal state by `WeaponId`; narrow DOM/URL/debug strings
with `isWeaponId`. `weapons.ammo` always returns a complete snapshot; `mag` includes
the chamber, `inMag` excludes it. Preserve shared IK, ADS/sway/recoil and pooled
casings. Weapons force physical materials and borrow source maps; arms use one
opaque material per skeleton with packed texture arrays.

`src/weapons/asset-loader.ts` fetches models concurrently, bounds parsing memory and
shares one Basis transcoder per renderer during boot, released at boot end, failure
or teardown. Static map clones are shared only when source, UV, color space and
sampler match.

`weapons.createInspectionModel(id)` returns an independent rest-pose clone with
`dispose()` for the market's 3D preview; geometry, materials and maps are borrowed.
Selecting or inspecting never buys: only Buy/Swap changes loadout or credits. Model
or renderer failures disable 3D inspection only, never purchases. Supply artwork is
mapped in `src/ui/market-art.ts`; its offline sources live in `assets/ui/market/`.

`tools/blender/soldiers/` builds seeded parametric soldiers; a Bun GLTFExporter cook
preserves the runtime joint/attribute format. `tools/export-models.ts` validates and
stages them and generates the spent hull; missing/stale/corrupt products fail rather
than triggering Blender or a fallback. `models.getSoldier(name)` returns
`{ name, geometry, slots, boneNames, weapon, stats, variant }` as one skinned geometry
with slot groups. Bone order must match `RIG.createSkeleton()`; mismatches fail boot.
AI owns the soldier texture arrays and finish lookup textures.

FX atlases (`tools/lib/fx-atlas.ts`) and recorded audio are required: missing
atlases reject FX init, and recording failures disable the audio graph. Gameplay
sound (firearms, impacts, foley, explosions, aircraft, callouts) is recorded;
synthesis is only UI/electronic feedback, healing cues, tinnitus and shop music.
Requests without a matching recording stay silent. Explosions carry optional
`kind: 'grenade' | 'bomb'` (default grenade). Radio owns aircraft lifetime; audio
owns source cleanup. Empty triggers click without a shot, flash or AI hearing
evidence. Callout provenance is `src/audio/samples/callouts/provenance.json`; there
is no runtime TTS or credential access.

## Prewarm

`src/core/prewarm.ts` awaits subsystem `prewarmMaterials(ctx)` before gameplay.
Build all producible variants without spawning gameplay entities, advancing
clock/RNG or drawing gameplay geometry. Restore spawn camera state before hooks and
bind the actual target (tone mapping/output color space affect keys).
`compileAsync` alone does not warm CSM, MRT or the post graph; render warms world/view
through the actual graph.

- Warm actual native graph variants with zero draw ranges. Await visible rAF;
  each graph has a 120 s deadline. Hidden/stalled tabs fail visibly.
- One failure-safe cleanup restores visibility, ranges/counts, camera layers/jitter/
  projection, MRT/lighting/context, scene overrides and clear/target state. Failure
  is terminal except with diagnostic `?prewarm=0`.
- Weapons await deferred models and reveal hidden parts and a temporary ammo visual,
  without gameplay side effects. Their warmup shares one promise; failures stay
  rejected. Calls before graph/viewmodel readiness reject without caching.
- AI temporary meshes borrow real geometry and cast/receive shadows; dispose only
  their skeletons. Await flashlight warming while the skinned caster is attached.
- Radio stages borrowed bomber/bomb visuals and detaches on success/failure.
- Haze warms its private RG context and restores its state even after failure.

Diagnostic counters/readback live in `src/dev/render-info.ts`.

## Type contracts

Optional patch fields mean omission, not an explicit `undefined`
(`exactOptionalPropertyTypes`). Config, material/bake and weather patches skip
undefined values from untyped callers via `applyDefinedPatch`. Snapshots, telemetry
and defaulted inputs may use `undefined` for unavailable/default. Material authoring
options are closed and use native Three parameter types; physical-only values need
`physical: true`. Keep finite catalogs exhaustive and sparse maps sparse.

## Quality

Aim for rich, physically plausible materials/lighting and convincing motion, not
flat colours or uniform light. Respect albedo/metalness conventions, detail maps,
contact shadows, irregularity and weapon feedback. Smoke tests are correctness
gates, not visual or performance acceptance.
