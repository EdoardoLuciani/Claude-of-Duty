# Engine contract

Browser FPS: Three.js r187 (`0.187.0`) + WebGPU only. Assets and WASM are local; no WebGL fallback.
Read this before changing a subsystem. Workflow and validation: [AGENTS.md](AGENTS.md).

## Ownership and subsystem API

Own only your assigned subsystem. Shared/lead-owned: `src/core/`, `src/main.ts`,
`src/dev/`, `tools/`, `vite.config.js`. Coordinate changes across owners.
Use `ctx.get(id)` rather than importing other subsystems. The existing constant
coupling `ai` → `weapons` is an exception.

| id / directory                                      | responsibility                                              |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `models` (core/models.ts + tools/export-models.mjs) | Lead-owned GLB export/loading                               |
| `render`                                            | WebGPU renderer, TSL frame graph, CSM, composite            |
| `materials`                                         | Procedural PBR texture forge, detail/triplanar materials    |
| `sky`                                               | Atmosphere, day/night, environment, volumetric fog          |
| `world` + tools/worldgen                            | Level meshes, metadata, props, spawns                       |
| `physics`                                           | Collision, controllers, rigid bodies, ragdolls, penetration |
| `player`                                            | Movement, camera, health, armour, healing                   |
| `weapons`                                           | Definitions, GLB adapters, viewmodel, handling, ballistics  |
| `fx`                                                | Particles, impacts, decals, tracers, blood, shells          |
| `ai`                                                | Soldiers, squads, navigation, perception, waves             |
| `game`                                              | Survival state, score/rewards, HUD threat cues              |
| `market`                                            | Between-wave shop/economy                                   |
| `intel`                                             | Cache spawning, interaction and credits                     |
| `radio`                                             | Strike, bomber, bombs, blast chain                          |
| `ui`                                                | HUD, menus, overlays                                        |
| `audio`                                             | Synthesis/recordings, spatialization, occlusion             |

Each system declares `static id`, `static deps`, and implements needed hooks:
`async init(ctx)`, `fixedUpdate(h, ctx)` (120 Hz), `update(dt, ctx)`,
`lateUpdate(dt, ctx)`, `resize(w, h, ctx)`, `async dispose()`.
Teardown is reverse-order and failure-isolated.

`ctx`: `scene/camera` (world), `viewScene/viewCamera` (separate first person),
`canvas`, `config`, `events`, `input`, `time`, `rng`, `get/peek/has(id)`.
`src/core/context.ts` owns the provider-keyed `EngineContext`; subsystem types
come from their implementations, not independently handwritten consumer APIs.
`Engine.add()` checks a constructor's literal static ID against that provider map.
Direct registration is `registry.add(id, instance)`; the engine's registry checks
the same ID/instance relationship. A standalone `Registry` promises only lifecycle
hooks unless given an explicit provider map. Registration also invalidates ordering
and hook caches.
`src/core/bindings.ts` owns static physical defaults, action IDs, binding labels and
action-backed contextual control reference. Input snapshots actions; gameplay
consumers own state machines. UI adapts this metadata into the existing pause
reference and adds native DOM help. F toggles flashlight; hold T interacts.
Tab and wheel are independent cycle requests, not guaranteed successful swaps.
Rebinding is deferred.
`src/core/events.ts` owns the typed event payload map used by `EventBus`.
Time contains `elapsed, raw, dt, fixed, alpha, scale, frame`; interpolate with
`alpha`. Respect `config.q` feature flags and particle/decal/shadow budgets.
Use `ctx.rng` or a retained fork, never `Math.random()`. Preallocate hot-path
state; dispose owned resources, not borrowed textures/geometry.

## Cross-subsystem events

Use `ctx.events`; [src/core/events.ts](src/core/events.ts) owns event names and
typed plain-object payloads. Add/change the type and its producers/consumers
together. Weapon identities use `WeaponId | 'ai_rifle'`; compact weapon descriptors
require an ID. Free-form external names belong at the input/audio adapter boundary,
not on gameplay events. Actor handles may remain opaque where only identity matters.
Event names and payloads stay correlated even when dispatching unions (pass a
correlated tuple rather than an independent union key and payload).
Architectural semantics not captured by those types:

- `bullet:segment` is reached free flight, clipped to collisions/range, excluding
  material interiors. Audio/suppression/tracers consume it rather than rebuilding
  rays from `weapon:fire`. Deduplicate near misses by shot; copy pooled vectors.
  `shot:resolved` is telemetry, not another damage path.
- `damage:dealt` means damage **to** target; exclude player targets from hitmarkers.
  Targets alone apply health damage. Physics emits once per actor/round using the
  highest reached region, with range/penetration/region scaling already applied.
  `from` is the muzzle; `source` is the shooter.
- `damage:taken.amount` is health damage; plates halve incoming damage and absorb
  the remainder first. `armourAbsorbed` records absorption; `plateBreak` records
  consumption of a 50 HP plate. Healing consumes a bandage/applies health only
  on `complete`, never cancellation. One player-owned heartbeat clock below
  50 HP drives audio/HUD and fades after injury settles.
- A wave clear allows 10 s ammo-looting grace, then one player-dismissed shop
  session. The shop freezes scaled time and the longer AI wave countdown.
- `ai:footstep` is one boot per animated stride plant; cull by distance.
  `ai:bark` requests recorded contact on visual acquisition, reload on actual
  reload start, or an outgoing-grenade announcement after a successful launch.
  Its `voice` is the actor's immutable sequential ID: audio distributes four
  fixed identities evenly by ID, varying takes rather than pitch/speaker.
  `position` is that actor's retained position, not pooled scratch. Speech uses
  one tracked spatial slot, duration/actor cooldowns and no queue; grenade
  announcements can preempt ordinary lines. Pause/shop/death/error stop it,
  and restart clears speech history. Unsupported intents remain silent.
  `hud:search` is a coarse 45° last-enemy sector; pause/shop freeze its timer.
- Intel chooses unused sites, initially 18 m from player / 24 m from live cases,
  preferring sites absent from the last five drops. History survives reloads/runs
  except captures; relax recency, then spacing, never reuse a consumed site.
  Claiming takes 4 s; interruption closes the lid and stops alarm/sparks.
  The fictional 740+880 Hz double-pulse siren emits immediate/0.5 s hearing
  evidence within 75 m; detector pings never alert AI. Spark cadence is 0.16 s,
  using pooled FX without lights/decals. Also stop audio on shop/pause/death/
  restart/terminal error. Securing pays 500 shop credits independently of score;
  Intel yields to busy hands
  and has aimed-visible interaction priority over ammo. Prompts use owner-scoped
  `ui.setPrompt(p, owner)` / `ui.clearPrompt(owner)`.
- The first `engine:error` is terminal: abort the failed synchronous dispatch,
  skip gameplay hooks, freeze input/gameplay and require reload. Rendering
  continues unless it failed. Capture pumps reject `engine.error`. Only error
  listeners are individually isolated so UI/recorder retain the original error.
- `weapon:shell` uses pooled casings; shotgun FX selects the offline spent hull.

## Physics and world contracts

Surface names: `concrete, metal, wood, dirt, sand, glass, water, foliage, fabric,
flesh, rubber, plaster`. `src/physics/surfaces.ts` owns `SurfaceName`; carry it through
physics results, events, FX and audio. Explicit collision/ballistic metadata is
validated, never guessed or silently replaced. Only unlabelled mesh/material names
use `guessSurface`; world query/visual authoring labels are a separate vocabulary.

`physics.fireBullet({ origin, dir, shooter, damage, penetration, maxDist,
maxRange?, travelled?, from?, dropoff?, weapon?, shot?, mask?, emit? })` returns
pooled `{ impacts, segments, origin, end, shooter, weapon, shot, stopReason }`,
valid until the next call. Player flight and instantaneous AI rounds share this
resolver. Player callers use `stopAtExit`, `deferActorDamage`, `ignoreActors` and
prior `layers` to resume from the pooled `continuation` (position/direction,
cumulative distance, damage and penetration). Charge material transit time and
retain actor/layer budgets across fixed ticks; terminal interiors still resolve
atomically.
Include PLAYER in bullet masks; exclude the shooter by owner, not layer.
Resolve geometry before damage dispatch. `emit: false` defers all effects/damage;
`physics.publishBullet(result)` publishes that exact pooled result before the next
shot. AI rejects a resolved teammate contact before committing firing state.
Select actor regions only along reached free-flight/interior paths, including
penetration deflection. Timed player rounds copy actor contacts before publishing
the pooled result, withholding only actor damage. `selectBulletRegion` promotes
retained contacts on reached paths; `emitBulletDamage` publishes each once after
the round crosses that actor's forward capsule extent. Moving enabled hitboxes
may extend, never shrink, the frontier. Other actors complete independently;
world effects and free flight do not wait. Terminal stops, expiry, recycling and
clear flush remaining reached contacts before telemetry/retirement. Extreme
sideways/backwards scatter may require that terminal flush rather than normal
forward completion. Instantaneous/AI damage publication remains immediate.
Targets own health; range/region scaling is already applied and must not repeat.
AI transitions use `AiState` from `agent.ts`; player locomotion uses `PlayerMoveState`,
with presentation-only `lean` added by `PlayerState`. Keep `WeaponMode` semantic
through HUD polling (uppercase only for display), and mixer-owned `BusName`
through dry/spatial/send routing.

Collision `surface` is the impact finish; optional `ballisticSurface` determines
penetration. Preserve cooked `_solid` IDs; unlabelled geometry uses connected
components and instances remain distinct. Exits must match object/component.
Only explicit `sheetThickness` authorizes single-sided penetration; missing exits
stop as `unknown-thickness`, overlapping solids as `overlapping-solids`.
No nominal fallback or layered-solid approximation.

JS in `tools/worldgen/` is world-authoring authority; `placements/` owns
free-standing prop transforms. `npm run world` builds meshes and cooks collision
with meshoptimizer from the canonical instance buckets. Visual-only bucket
coalescing may join non-distance-LOD clouds within the existing 64 m X/Z span;
it must not change collision inputs or navigation. Both transient outputs use
assembler-owned materials and canonical `geo`. A prototype may supply an owned
`visualGeo` derivative for visual output only; support, collision and navigation
must retain canonical geometry, topology and RNG/instance inputs. The assembler
owns both geometries and handles aliased/unused inputs without double disposal.
Manifest v2 and content-hashed GLBs live in
`public/models/world/`. Preserve instancing/masks.
Never author separate collision geometry or hand-edit generated files. Commit
source + manifest + generated runtime assets together. Validate with
`npm run world -- --check`, world/physics tests and screenshots.

## AI physical planning

`src/ai/attachment.ts` owns the shared native attachment oracle; authoring and
runtime use the same controller/BVH algorithm. Physics owns immutable collision
snapshot construction in `src/physics/query-snapshot.ts`. AI owns one module
worker, its scratch/controller, revisions, bounded queues and lifetime. Initialize
before AI readiness; transfer copies, never live collision buffers.

`src/ai/attachment-*.ts` owns the caller map, exact proof/pending/cancellation
semantics, bounded native budgets, tactical revalidation and timing limitations.
Unknown is never provisional success or unreachable; failures are terminal, not
unbounded main-thread fallback. Async admission is not same-tick seeded replay
determinism.

## Render integration

Public render surface:

- `renderer`: initialized strict-WebGPU renderer.
- `hudDraw`: optional experimental single callback after final world output. UI owns
  and detaches it before disposing HUD resources; borrowed render state must be
  restored. `?crosshair=gpu` uses it for a bounded shader quad; HTML stays default.
  It shares canvas resolution and sits below HTML injury overlays. See
  [the experiment measurements](docs/experiments/gpu-crosshair.md).
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
Pickup instances retain stable slots. Birth/reuse history is validated only by the
live world camera's layer-1 prepass callback; preserve that camera/layer contract
or update the pickup owner and rendered motion-transition tests together.
Refresh CSM frustums when the unjittered projection changes. Bias depends on slope/
cascade texels. Fog borrows native cascade depth/matrices, adding no shadow draw.
Hoist noise outside the fog march; its uniform uses application frames, not native
renderer/compile time. Keep haze's private RG target.

Three hashes visible light **IDs** and shadow state. Keep authored practicals and
FX pools visible with stable identities; dim via `intensity = 0`, not visibility.
Zero intensity is not proof of zero shader work. Stable sky proxies transfer
sun/moon values without changing shader IDs/CSM ownership; source lights are hidden.
Sky is required: render borrows its pre-init direction and renders only after
sky initialization. No synthetic sun/background/environment or no-sky fill exists;
an owned zero-intensity sky remains dark.

HDR exposure samples unexposed world beauty asynchronously, at most one readback
pending. It excludes fog, TAA, viewmodel and post effects. Elapsed-time smoothing
freezes with paused time. Camera/FOV can still affect metering. Keep approved
key/limits/bias; this policy is not a WebGL visual-parity claim.

Sky starts at 16:30; 9 hours pass per 600 active seconds, wrapping at 24 hours.
Automatic clock freezes in deterministic captures and on death; pause/shop freeze
scaled time. Sun/moon changes invalidate environment bakes. Explicit
`sky.setTimeOfDay()` remains available. Borrow `sky.keyDirection`, not astronomical
vectors, for rendered lighting. Streetlight outage: first 21:00, 2.1 s flicker,
180 s dark, then restoration; interiors unaffected. Restart resets it; deterministic
captures disable automation and use `world.setStreetlightPower()`.

Player owns one always-present shadowed spotlight. F/`setFlashlightEnabled()`
changes intensity, not light count; shadow updates run only while on. Warm its
skinned depth variants, then render shadows against the full forward scene.
Death/restart switch it off; pause/shop preserve it. No AI modifier.

Unexpected GPU loss is terminal and stops the loop; intentional destruction is
not a gameplay failure. Init/prewarm must not publish readiness after loss.
Detach owned callbacks/lights and finish failure-isolated teardown. Upstream now
owns TRAA depth/history disposal; keep first-build and active-history lifetime
regressions, not external disposal of its private textures. The published npm
release uses unmodified ESM bundles; no postinstall source-export correction is
needed. Keep release/export/shared-core and upstream source/bundle regressions;
see README upgrade checks. Builder-local WGSL buffer
names enable native program/pipeline reuse. Upstream reference attributes bind each
instanced mesh's own buffers while compatible meshes share shader-builder state;
object-specific builds remain uncached. Preserve pixel-level buffer isolation and
reuse regressions rather than restoring obsolete per-object cache-key IDs.

Bakes use native top-left texture UVs and shared `QuadMesh` geometry: no extra Y
flip or disposal of borrowed geometry. Gameplay readback uses its explicit
display-transform path. First-person refraction uses world coordinates.

## Models

`weapons.createInspectionModel(id)` returns an independent rest-pose scene and
`dispose()` for the market's single demand-rendered WebGPU studio. Cloned transforms,
skeletons and mixers are inspection-owned; geometry, materials and maps are borrowed
from gameplay and must not be disposed by the caller. UI drops the clone on selection,
close/restart/error and releases its renderer/environment at teardown. Controls use
DOM input, not the paused simulation clock. Only explicit weapon Buy/Swap buttons
purchase; selecting or inspecting a weapon never changes loadout or credits.

`build/models.mjs` owns explicit gltfpack runtime-model cooking and per-model
profiles (`npm run models:cook`). Normal builds consume committed `.runtime.glb`
products; they do not run the encoder. P320 is the first opt-in profile; adding
models requires adapter, animation and visual validation rather than blanket
simplification. Native authoring exports remain unchanged.

`tools/export-models.mjs` runs the same procedural builders offline with a fixed
seed; runtime never builds meshes. Regenerate ALL procedural models, since
transitive builder inputs invalidate naive per-file caches. Export uses atomic
writes and a cache lock. Vite dev/build runs it; preview uses existing `dist`.
Normal builds need no Blender.

M4/MCX/P320/EVOLYS/MPX/AX338/M590 use committed GLBs and weapon-owned adapters
under `src/weapons/`; procedural player-weapon exports are retired. M590 is a
provisional in-game review prototype, not strict 1:1/final visual acceptance.
Its seven event-only Clips sample one native mixer; `shell_insert` uses authored
STEP-scale visibility owned/reset by the adapter, never detachable-magazine
parts or drop pools. Native metres, sockets, grips and provisional 89 mm travel
remain asset-owned; damage, 6+1 accounting and per-shell interruption remain in
the common weapon system.
`src/weapons/defs.ts` owns the weapon tuning schema, IDs, slot IDs and fire modes;
check authored data against that schema rather than inferring its contract from
current values. Keep internal state keyed by `WeaponId`; narrow DOM/URL/debug
strings with `isWeaponId` at entry. Authored models carry literal adapter IDs,
and the loader table checks complete ID coverage and per-ID adapter returns.
The market UI derives its item contract from `MarketSystem.getHudState()`.

Preserve shared IK, ADS/sway/recoil and pooled casings. Source/regen/reference
contracts live beside each asset. Weapons force physical materials and borrow
source maps. Arms consolidate authored Physical finishes into one opaque material
per independent skeleton, accepting single and grouped indexed surfaces. Preserve
UV0 AO, UV1 detail, weights, mirrored binding, specular factors and sleeve-only blood.
The arm asset owns packed texture arrays and releases source images after packing.
Native copy, clone/cache-safe soldier output and render-owned environment
re-registration follow the same ownership rules.

FX particle/decal PNGs are required runtime assets; generation
lives in `tools/lib/fx-atlas.ts` and the offline texture exporter. Missing/invalid
atlases reject FX initialization. Recorded audio fetch/decode failures disable the
audio graph rather than substituting synthesis. Physical hits and movement/body/
equipment foley, bomber loops, nonverbal reactions, explosions and sparse environmental
events use required recordings. Explosions carry optional `kind: 'grenade' | 'bomb'`
(legacy default: grenade); audio blends recorded close/mid/far perspectives with no
synthetic blast layers. Radio owns aircraft pose/pass lifetime; audio owns source
cleanup. Radio textures supplement intentional electronic tones. Do not invent
ambient human/tactical actors.
Tactical contact/reload/outgoing-grenade speech uses required offline-generated,
locally bundled Opus recordings with source hashes, prompts and processing in
`src/audio/samples/callouts/provenance.json`; authoring/rights notes live in
`assets/audio/tactical-callouts/README.md`. No runtime TTS or credential access.
Reached-segment bullet near-misses, material-mapped casing drops, family-matched dry
fire and grenade throw foley also use required recordings. Physical grenade
handling uses the foley bus; the pin cue is silent pending a suitable recording,
and cooking the fuse has no synthetic warning beep. Empty
triggers play a click without emitting a shot, muzzle flash or AI-hearing evidence.
All firearm reports, including close/distant AK and background gunfire, use required
recordings without synthetic reinforcement. MCX/MPX select explicit suppressed
recordings; unsupported generic-suppressed requests stay silent rather than using
another gun's report. Remaining synthesis is intentional UI/electronic feedback,
healing-completion cues, tinnitus and shop music/reverb. Other spoken intents remain deferred.

`models.getSoldier(name)` returns `{ name, geometry, slots, boneNames, weapon,
stats, variant }`. Merge GLTF primitives into one skinned geometry with slot
groups, slicing shared accessors correctly. Bone order must match
`RIG.createSkeleton()`; models and AI validate names/order, groups, slots and skin
attributes and fail boot on mismatches. AI annotates those disjoint surfaces once
with `soldierSurface`; one native material per variant ignores the authoring groups
when drawing. AI owns the shared texture arrays and immutable finish lookup textures;
meshes retain ordinary Three.js skinning, history, culling and shadow ownership.

## Prewarm

`src/core/prewarm.ts` awaits subsystem `prewarmMaterials(ctx)` before gameplay.
Build all producible variants without spawning gameplay entities, advancing
clock/RNG or drawing gameplay geometry. Restore spawn camera state before hooks. Bind the actual target: tone mapping/output color space affect keys.
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

Diagnostic counter/readback contracts live in `src/dev/render-info.ts`; they do not
change warmup staging or renderer-info reset scheduling.

## Type contracts

Optional override/patch fields mean omission, not an explicit `undefined` write
(`exactOptionalPropertyTypes`). Config, material/bake and weather patches also
skip undefined values from untyped JS/debug callers via `applyDefinedPatch`.
Snapshots, telemetry and defaulted inputs may explicitly permit undefined where
that means unavailable or use the default. Use straightforward assignments there;
do not manufacture property omission when consumers do not distinguish it.
Required-state patches remain strict.
Material authoring options are closed and use native Three material parameter
types, not node-graph inputs. Physical-only values require `physical: true`;
callers cannot downgrade a library-authored physical finish to a standard material.
Live uniforms, pooled bookkeeping and internally supplied world/time inputs
are not authoring options. Keep finite catalogs exhaustive and sparse maps sparse.

## Quality

Aim for rich, physically plausible materials/lighting and convincing motion, not
flat colours or uniform light. Respect albedo/metalness conventions, detail maps,
contact shadows, irregularity and weapon feedback. Finish units, authored asset
ownership and explicit readability/optics exceptions follow the material policy
above. Smoke tests are correctness gates, not visual or combat-performance
acceptance.
