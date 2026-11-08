/** Authored sites, distance-gated random selection, run limits and interaction. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';

import { AudioSystem } from '../../src/audio/index.ts';
import { DEFAULT_BINDINGS, bindingLabel } from '../../src/core/bindings.ts';
import type { EngineContext } from '../../src/core/context.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { Rng } from '../../src/core/rng.ts';
import { spawnIntelSparks } from '../../src/fx/impacts.ts';
import { IntelSystem } from '../../src/intel/index.ts';
import { randomMarker as selectRandomMarker, rollBudget } from '../../src/intel/spawn.ts';
import type { IntelMarker } from '../../src/intel/spawn.ts';
import { INTEL, lureInterval } from '../../src/intel/tuning.ts';
import { MarketSystem } from '../../src/market/index.ts';
import { MaterialSystemNode } from '../../src/materials/index.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { UiSystem } from '../../src/ui/index.ts';
import type { PauseMenu } from '../../src/ui/menu.ts';
import { Prompt } from '../../src/ui/prompts.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import type { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { INTEL_POINTS } from '../../tools/worldgen/level/intel.js';
import { createTestContext, createTestInput } from '../lib/context.ts';
import type { TestProviders } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';
import { UiInput, UiPlayer, deleteGlobal, captureMethod } from '../lib/ui-fixture.ts';

// All non-empty selections below deliberately have an eligible candidate.
function randomMarker(...args: Parameters<typeof selectRandomMarker>): IntelMarker {
  const selected = selectRandomMarker(...args);
  assert(selected);
  return selected;
}
assert.deepEqual(DEFAULT_BINDINGS.use, ['KeyT'], 'approved interact default is T');
assert.deepEqual(DEFAULT_BINDINGS.flashlight, ['KeyF'], 'approved flashlight default is F');
assert.equal(bindingLabel('use'), 'T');

const market = new MarketSystem();
market.credits = 20;
for (const invalid of [NaN, Infinity, -Infinity, 'invalid', -150, 0]) {
  // Deliberately exercise invalid runtime callers without weakening the numeric API.
  assert.equal(
    Reflect.apply(captureMethod(market, 'addCredits'), market, [invalid]),
    20,
    'invalid payouts never corrupt credits'
  );
}
assert.equal(market.addCredits(150), 170);

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../public/models/world/level.json', import.meta.url), 'utf8')
);
assert(
  typeof manifest === 'object' &&
    manifest !== null &&
    'WORLD' in manifest &&
    'transform' in manifest
);
assert(Array.isArray(manifest.transform));
const transformValues: unknown[] = manifest.transform;
assert(transformValues.every((n): n is number => typeof n === 'number'));
const world = manifest.WORLD;
assert(typeof world === 'object' && world !== null && 'MARKERS' in world);
const markerData = world.MARKERS;
assert(typeof markerData === 'object' && markerData !== null && 'INTEL' in markerData);
assert(Array.isArray(markerData.INTEL));
const rawMarkers: unknown[] = markerData.INTEL;
const exported = rawMarkers.map((row): { id: string; position: [number, number, number] } => {
  assert(typeof row === 'object' && row !== null && 'id' in row && 'position' in row);
  assert(typeof row.id === 'string' && Array.isArray(row.position));
  const point: unknown[] = row.position;
  assert(
    typeof point[0] === 'number' && typeof point[1] === 'number' && typeof point[2] === 'number'
  );
  return { id: row.id, position: [point[0], point[1], point[2]] };
});
assert.equal(INTEL_POINTS.length, 14);
assert.equal(new Set(INTEL_POINTS.map((p): string => p.id)).size, 14);
assert.deepEqual(
  exported.map((p): string => p.id),
  INTEL_POINTS.map((p): string => p.id)
);
const transform = new THREE.Matrix4().fromArray(transformValues);
for (let i = 0; i < exported.length; i++) {
  const p = INTEL_POINTS[i];
  assert.deepEqual(
    new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(transform).toArray(),
    exported[i].position
  );
}
assert(INTEL_POINTS.some((p): boolean => p.y > 2));
assert(INTEL_POINTS.some((p): boolean => p.id.endsWith('roof')));
const budgets = new Set(Array.from({ length: 100 }, (_, i): number => rollBudget(new Rng(i + 1))));
assert.deepEqual(
  [...budgets].sort((a, b): number => a - b),
  [3, 4, 5]
);
assert(lureInterval(18) > lureInterval(4));
assert.equal(INTEL.hold, 4, 'claim time is four seconds');
const markers = [
  { id: 'near', x: 1, y: 0, z: 0 },
  { id: 'far', x: 40, y: 0, z: -10 },
  { id: 'upper', x: 20, y: 6, z: 2 },
];
const zero = new THREE.Vector3();
const firstRng = new Rng(1);
firstRng.float = (): number => 0.99;
const lastRng = new Rng(1);
lastRng.float = (): number => 0;
assert.equal(randomMarker(markers, new Set(), zero, [], firstRng).id, 'far');
assert.equal(
  randomMarker(markers, new Set(), zero, [], lastRng).id,
  'upper',
  'not always the farthest site'
);
assert.equal(randomMarker(markers, new Set(['far']), zero, [], firstRng).id, 'upper');
const noDraw = {
  u32(): never {
    throw Error('empty candidate pool consumed RNG');
  },
  float(): never {
    throw new Error('empty candidate pool consumed RNG');
  },
};
assert.equal(
  selectRandomMarker(markers, new Set(markers.map((m): string => m.id)), zero, [], noDraw),
  null
);
assert.equal(selectRandomMarker([], new Set(), zero, [], noDraw), null);
const site = (id: string, x: number, y = 0, z = 0): IntelMarker => ({ id, x, y, z });
assert.equal(
  randomMarker([site('upstairs', 0, 100), site('away', 20)], new Set(), zero, [], lastRng).id,
  'away',
  'vertical separation cannot bypass the player distance gate'
);
assert.equal(
  randomMarker([site('full', 40), site('half', 10)], new Set(), zero, [], lastRng).id,
  'full',
  'full-distance candidates take precedence over fallback candidates'
);
assert.equal(
  randomMarker([site('near', 1), site('half', 10)], new Set(), zero, [], firstRng).id,
  'half',
  'halve spacing before accepting a site at the player'
);
assert.equal(
  randomMarker([site('near', 1)], new Set(), zero, [site('live', 1)], firstRng).id,
  'near',
  'waive spacing rather than withholding a drop when only close sites remain'
);
const live = [site('live', 20, 100)];
assert.equal(
  randomMarker([site('stacked', 20), site('spread', 70)], new Set(), zero, live, firstRng).id,
  'spread',
  'live-cache separation is horizontal too, and does not depend on used IDs'
);
assert.equal(
  randomMarker([site('too-close', 22), site('half-separated', 33)], new Set(), zero, live, firstRng)
    .id,
  'half-separated',
  'relax live-cache spacing to half before waiving it'
);
assert.equal(
  randomMarker(
    [site('boundary', INTEL.spawnPlayerDistance)],
    new Set(),
    zero,
    [site('live', INTEL.spawnPlayerDistance + INTEL.spawnCacheDistance)],
    firstRng
  ).id,
  'boundary',
  'distance boundaries are inclusive'
);
const spent = new Set(['spent-far', 'spent-half']);
const sparse = [site('spent-far', 40), site('spent-half', 10), site('unused-near', 1)];
assert.equal(
  randomMarker(sparse, spent, zero, [], lastRng).id,
  'unused-near',
  'fallback never reuses spent sites'
);
assert.deepEqual([...spent], ['spent-far', 'spent-half']);
assert.deepEqual(live, [site('live', 20, 100)], 'selection does not mutate live caches');

const candidates = [site('a', 20), site('b', 40), site('c', 60)];
const samples = new Rng(132);
const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
for (let i = 0; i < 6000; i++) counts[randomMarker(candidates, new Set(), zero, [], samples).id]++;
for (const count of Object.values(counts))
  assert(Math.abs(count - 2000) < 240, 'eligible sites are sampled uniformly');
const rngA = new Rng(44),
  rngB = new Rng(44);
for (let i = 0; i < 100; i++) {
  assert.equal(
    randomMarker(candidates, new Set(), zero, [], rngA).id,
    randomMarker(candidates, new Set(), zero, [], rngB).id,
    'same seed and state reproduce selection'
  );
}
type IntelEvent =
  | 'intel:spawn'
  | 'intel:secured'
  | 'intel:noise'
  | 'intel:available'
  | 'intel:operation'
  | 'intel:spark';
type IntelRecord = { [K in IntelEvent]: { type: K } & EngineEventMap[K] }[IntelEvent];
class IntelPrompt extends Prompt {
  value: Parameters<Prompt['set']>[0] = {};
  override set(p: Parameters<Prompt['set']>[0]): void {
    super.set(p);
    this.value = { ...p };
  }
}
class IntelUi extends UiSystem {
  override prompt = new IntelPrompt();
}
interface IntelHarness {
  ctx: EngineContext & {
    player: UiPlayer;
    ui: UiSystem & { prompt: IntelPrompt };
    physics: PhysicsSystem;
    market: MarketSystem;
    weapons: WeaponSystem | null;
    render: RenderSystem | null;
  };
  intel: IntelSystem;
  player: UiPlayer;
  sounds: string[];
  emitted: IntelRecord[];
  aimAt: (cache: IntelSystem['_alive'][number]) => void;
  step: (dt: number, before?: () => void) => void;
}
async function harness(
  deterministic = false,
  markerList: IntelMarker[] = markers
): Promise<IntelHarness> {
  const providers: TestProviders = {};
  const input = new UiInput();
  const base = createTestContext({
    providers,
    input,
    engine: fixture<EngineContext['engine']>({}),
    canvas: fixture<HTMLCanvasElement>({}),
  });
  base.config.deterministic = deterministic;
  base.time.elapsed = 10;
  base.rng = new Rng(7);
  const player = new UiPlayer(base);
  const sounds: string[] = [];
  const emitted: IntelRecord[] = [];
  const ui = new IntelUi();
  ui.menu = fixture<PauseMenu>({ open: false });
  const audio = new AudioSystem();
  audio.play = (kind: string): boolean => {
    sounds.push(kind);
    return true;
  };
  const market = new MarketSystem();
  market.credits = 0;
  market.open = false;
  const physics = new PhysicsSystem();
  physics.lineOfSight = (): boolean => true;
  const materials = new MaterialSystemNode();
  materials.get = (_name, options): MeshStandardNodeMaterial =>
    new MeshStandardNodeMaterial({ color: options?.tint ?? 0xffffff });
  materials.bakeMasks = (geometry): THREE.BufferGeometry => geometry;
  providers.materials = materials;
  const world = new WorldSystem();
  world.intelMarkers = markerList.map(
    (m): { tag: string; id: string; y: number; x: number; z: number } => ({ ...m, tag: 'intel' })
  );
  world.levelToWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z);
  providers.player = player;
  providers.ui = ui;
  providers.audio = audio;
  providers.market = market;
  providers.physics = physics;
  providers.world = world;
  // Accessors preserve the existing mutable test controls and typed provider lookup.
  const ctx: IntelHarness['ctx'] = {
    ...base,
    player,
    ui,
    physics,
    market,
    get weapons(): WeaponSystem | null {
      return providers.weapons ?? null;
    },
    set weapons(value: WeaponSystem | null) {
      if (value) providers.weapons = value;
      else delete providers.weapons;
    },
    get render(): RenderSystem | null {
      return providers.render ?? null;
    },
    set render(value: RenderSystem | null) {
      if (value) providers.render = value;
      else delete providers.render;
    },
  };
  ctx.events.on('intel:spawn', (e): void => {
    emitted.push({ type: 'intel:spawn', ...e, position: e.position.clone() });
  });
  ctx.events.on('intel:secured', (e): void => {
    emitted.push({ type: 'intel:secured', ...e, position: e.position.clone() });
  });
  ctx.events.on('intel:noise', (e): void => {
    emitted.push({ type: 'intel:noise', ...e, position: e.position.clone() });
  });
  ctx.events.on('intel:available', (e): void => {
    emitted.push({ type: 'intel:available', ...e });
  });
  ctx.events.on('intel:operation', (e): void => {
    emitted.push({ type: 'intel:operation', ...e, position: e.position.clone() });
  });
  ctx.events.on('intel:spark', (e): void => {
    emitted.push({ type: 'intel:spark', ...e, position: e.position.clone() });
  });
  const intel = new IntelSystem();
  providers.intel = intel;
  await intel.init(ctx);
  const aimAt = (cache: IntelSystem['_alive'][number]): void => {
    player.feetPosition.set(cache.x, cache.y, cache.z + 1.2);
    player.eyePosition.copy(player.feetPosition).add(new THREE.Vector3(0, 1.65, 0));
    ctx.camera.position.copy(player.eyePosition);
    ctx.camera.lookAt(cache.x, cache.y + INTEL.targetHeight, cache.z);
    ctx.camera.updateMatrixWorld();
  };
  const step = (dt: number, before?: () => void): void => {
    ctx.time.frame++;
    ctx.time.elapsed += dt * ctx.time.scale;
    before?.();
    intel.update(dt, ctx);
    intel.lateUpdate(dt, ctx);
  };
  return { ctx, intel, player, sounds, emitted, aimAt, step };
}

function pickupOwner(ctx: EngineContext, player: UiPlayer): WeaponSystem {
  const owner = new WeaponSystem();
  owner.ctx = ctx;
  owner.rng = new Rng(1);
  owner.player = player;
  const state = owner._makeState('rifle');
  state.reserve = 0;
  state.def = { ...state.def, reserve: 90 };
  owner.states.set('rifle', state);
  return owner;
}

const run = await harness();
run.intel.rng.float = (): number => 0.99;
run.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
assert.equal(run.intel._alive[0].id, 'far');
run.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
assert.equal(run.intel._alive.length, 1, 'duplicate wave events cannot spawn twice');
run.ctx.events.emit('wave:complete', { wave: 2, nextWave: 0, delay: 20 });
assert.equal(
  run.intel._alive[1].id,
  'upper',
  'wave spawning uses the half-spacing fallback when necessary'
);
run.ctx.events.emit('wave:complete', { wave: 3, nextWave: 0, delay: 20 });
assert.equal(run.intel._alive.length, 2);
assert.equal(run.intel._spawn(markers[0]), null, 'no unpooled third prop');
run.intel._despawn(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 4, nextWave: 0, delay: 20 });
assert.equal(run.intel._alive[1].id, 'near');
assert.equal(run.intel._used.size, 3);
run.intel._despawn(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 5, nextWave: 0, delay: 20 });
assert.equal(run.intel._used.size, 3, 'spent sites never repeat');
run.intel.reset();
run.intel.budget = 1;
run.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
run.intel._secure(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 2, nextWave: 0, delay: 20 });
assert.equal(run.intel._used.size, 1, 'run budget caps spawns');
run.intel.dispose();

const det = await harness(true);
for (let wave = 1; wave <= 20; wave++)
  det.ctx.events.emit('wave:complete', { wave, nextWave: wave + 1, delay: 20 });
assert.equal(det.intel.budget, 0);
assert.equal(det.intel._alive.length, 0);
assert.equal(det.emitted.length, 0);
det.intel.dispose();

// Physical defaults through the real Input action resolver, including ammo priority.
const controls = await harness();
controls.ctx.input = createTestInput();
const input = controls.ctx.input;
const controlledCache = controls.intel._spawn(markers[0]);
assert(controlledCache);
controls.aimAt(controlledCache);
controls.step(0.01);
assert.equal(
  controls.ctx.ui.prompt.value.key,
  bindingLabel('use'),
  'intel prompt uses the canonical label'
);
const controlledOwner = pickupOwner(controls.ctx, controls.player);
const controlledPickups = new AmmoPickups(controlledOwner);
controlledPickups.spawn(controls.player.feetPosition);
input.down.add('KeyF');
assert(input.action('flashlight'));
assert(!input.action('use'), 'F flashlight must not dispatch interaction');
controlledPickups.update(INTEL.hold);
controls.step(INTEL.hold);
assert.equal(controls.intel._hold, 0, 'F cannot start securing');
assert.equal(controls.intel.secured, 0, 'held F cannot claim intel');
assert.equal(controls.ctx.market.credits, 0, 'F cannot pay intel credits');
assert.equal(controlledOwner.state?.reserve, 0, 'F cannot collect ammunition');
assert(
  !controls.emitted.some(
    (e): e is Extract<IntelRecord, { type: 'intel:operation' }> =>
      e.type === 'intel:operation' && e.active
  )
);
input.down.delete('KeyF');
input.down.add('KeyT');
assert(input.action('use'));
assert(!input.action('flashlight'), 'T must not dispatch flashlight');
controlledPickups.update(0.5);
controls.step(0.5);
assert.equal(controls.intel._hold, 0.5, 'T starts the held operation');
assert.equal(controlledOwner.state?.reserve, 0, 'intel owns T before its update');
controls.step(INTEL.hold - 0.5);
assert.equal(controls.intel.secured, 1, 'held T claims intel');
assert.equal(controls.ctx.market.credits, INTEL.credits);
controlledPickups.update(1);
assert.equal(controlledOwner.state?.reserve, 0, 'held T cannot spill into ammo after completion');
input.down.delete('KeyT');
controls.step(0.01);
assert(!controls.intel.blocksUse(), 'releasing T clears the completion barrier');
input.down.add('KeyF');
controlledPickups.update(1);
assert.equal(
  controlledOwner.state?.reserve,
  0,
  'F cannot collect ammo even without intel priority'
);
input.down.delete('KeyF');
input.down.add('KeyT');
controls.ctx.camera.rotateY(Math.PI);
controlledPickups.update(1);
assert(controlledOwner.state?.reserve > 0, 'a fresh T hold collects ammo even looking away');
controlledPickups.dispose();
controls.intel.dispose();

const h = await harness();
const { intel, ctx, player, step, aimAt, sounds, emitted } = h;
const cache = intel._spawn(markers[0]);
assert(cache);
const beacon = cache.group.lid.children.find(
  (m): m is THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial> =>
    m instanceof THREE.Mesh &&
    m.material instanceof MeshBasicNodeMaterial &&
    m.material === intel._kit.mats.beacon
);
assert(beacon, 'exterior beacon follows the hinged lid');
beacon.geometry.computeBoundingBox();
assert(beacon.geometry.boundingBox);
assert(beacon.geometry.boundingBox.min.y > 0.0475, 'lens clears the closed lid top');
const oldTime = ctx.time.elapsed;
for (const [time, red] of [
  [0, INTEL.beaconDim],
  [INTEL.beaconPeriod / 2, INTEL.beaconBright],
  [INTEL.beaconPeriod, INTEL.beaconDim],
]) {
  ctx.time.elapsed = time;
  intel.update(1 / 60, ctx);
  assert(Math.abs(beacon.material.color.r - red) < 1e-6, `pulse at ${time}s`);
  if (time === INTEL.beaconPeriod / 2)
    assert(beacon.material.color.r > 1 && beacon.material.color.g < 0.05, 'bright red HDR pulse');
}
ctx.time.elapsed = oldTime;
aimAt(cache);
step(0.01);
assert.match(ctx.ui.prompt.value.sub ?? '', /Hold 4s/);
ctx.input.down.add('KeyT');
step(1);
assert.equal(intel.getHudState().progress, 0.25);
assert.equal(emitted.filter((e): boolean => e.type === 'intel:noise').length, 1);
assert(
  emitted.some(
    (e): e is Extract<IntelRecord, { type: 'intel:operation' }> =>
      e.type === 'intel:operation' && e.active
  ),
  'hold starts a continuous alarm'
);
assert.equal(cache.open, 1);
assert.equal(cache.group.lid.rotation.x, -INTEL.lidAngle);
assert(
  emitted.some((e): boolean => e.type === 'intel:spark'),
  'exposed electronics spark while operated'
);
step(0.1);
assert.equal(
  emitted.filter((e): boolean => e.type === 'intel:noise').length,
  1,
  'noise has its own cadence'
);
ctx.input.down.delete('KeyT');
step(0.1);
assert.equal(intel._hold, 0, 'release wipes progress');
assert(
  emitted.some(
    (e): e is Extract<IntelRecord, { type: 'intel:operation' }> =>
      e.type === 'intel:operation' && !e.active
  ),
  'release stops the siren'
);
const releaseSparks = emitted.filter((e): boolean => e.type === 'intel:spark').length;
step(INTEL.lidCloseTime);
assert.equal(cache.open, 0, 'lid closes when the unlock is released');
assert.equal(cache.group.lid.rotation.x, 0);
assert.equal(
  emitted.filter((e): boolean => e.type === 'intel:spark').length,
  releaseSparks,
  'closing does not spark'
);
ctx.input.down.add('KeyT');
step(1);
player.horizontalSpeed = 1;
step(0.1);
assert.equal(intel._hold, 0, 'walking cancels');
player.horizontalSpeed = 0;
step(1);
player.feetPosition.x += 0.2;
step(0.1);
assert.equal(intel._hold, 0, 'displacement cancels even with zero reported speed');
aimAt(cache);
step(1);
step(0.1, (): void =>
  ctx.events.emit('damage:taken', {
    amount: 0,
    armourAbsorbed: 12,
    from: new THREE.Vector3(),
    health: 100,
    armour: 0,
    plateBreak: false,
  })
);
assert.equal(intel._hold, 0, 'a plate hit also blocks progress in the damage frame');
step(1);
ctx.camera.rotateY(Math.PI);
step(0.1);
assert.equal(intel._hold, 0, 'looking away cancels');
assert(!ctx.ui.prompt.active, 'no prompt behind the player');
aimAt(cache);
step(1);
ctx.physics.lineOfSight = (): false => false;
step(INTEL.hold);
assert.equal(intel.secured, 0, 'LOS obstruction prevents securing');
ctx.physics.lineOfSight = (): true => true;
// A hidden closer crate must not mask the visible aimed target.
const second = intel._spawn({ id: 'blocked', x: cache.x, y: cache.y, z: cache.z + 1 });
assert(second);
ctx.physics.lineOfSight = (_eye, target): boolean => target.z !== second.z;
assert.equal(intel._target(), cache);
intel._despawn(second);
ctx.physics.lineOfSight = (): true => true;

// Busy hands interrupt operation, not discovery. Inactive gameplay suppresses both.
for (const [reason, discovery, setBlock] of [
  [
    'pause',
    false,
    (): void => {
      ctx.time.scale = 0;
    },
  ],
  [
    'shop',
    false,
    (): void => {
      ctx.market.open = true;
    },
  ],
  [
    'frozen input',
    false,
    (): void => {
      ctx.input.frozen = true;
    },
  ],
  [
    'disabled input',
    false,
    (): void => {
      ctx.input.enabled = false;
    },
  ],
  [
    'disabled controls',
    false,
    (): void => {
      player.controlEnabled = false;
    },
  ],
  [
    'death',
    false,
    (): void => {
      player.dead = true;
    },
  ],
  [
    'menu',
    false,
    (): void => {
      ctx.ui.menu.open = true;
    },
  ],
  [
    'healing',
    true,
    (): void => {
      player.healCtrl.active = true;
    },
  ],
  [
    'mantling',
    true,
    (): void => {
      player.mantling = true;
    },
  ],
  [
    'airborne',
    true,
    (): void => {
      player.airborne = true;
    },
  ],
  [
    'fire',
    true,
    (): void => {
      ctx.input.down.add('Mouse0');
    },
  ],
  [
    'ADS',
    true,
    (): void => {
      ctx.input.down.add('Mouse2');
    },
  ],
  ...['reloadTac', 'reloadEmpty', 'pump', 'cycle', 'inspect'].map(
    (clipName): [string, boolean, () => void] => [
      clipName,
      true,
      (): void => {
        ctx.weapons = new WeaponSystem();
        ctx.weapons.viewmodel = fixture<Viewmodel>({ clipName });
      },
    ]
  ),
  ...(
    ['disabled', 'healing', 'cooking', '_throwing', 'grenadeEquipped', 'radioEquipped'] as const
  ).map((flag): [string, boolean, () => void] => [
    flag,
    true,
    (): void => {
      ctx.weapons = new WeaponSystem();
      ctx.weapons[flag] = true;
    },
  ]),
  [
    'switching',
    true,
    (): void => {
      ctx.weapons = new WeaponSystem();
      ctx.weapons._switchTo = 'smg';
    },
  ],
] satisfies [string, boolean, () => void][]) {
  step(1);
  const openingEvents = (): number =>
    emitted.filter((e): boolean => ['intel:noise', 'intel:spark', 'intel:secured'].includes(e.type))
      .length;
  const announcements = (): number =>
    emitted.filter((e): boolean => e.type === 'intel:available').length;
  const beeps = (): number => sounds.filter((s): boolean => s === 'intel_beep').length;
  const before = openingEvents(),
    announced = announcements(),
    pinged = beeps();
  intel._beepAt = 0;
  intel._announceAt = ctx.time.elapsed + 0.01;
  setBlock();
  step(INTEL.hold);
  step(0.1);
  assert.equal(intel._hold, 0, reason);
  assert.equal(intel.secured, 0, reason);
  assert.equal(openingEvents(), before, `${reason}: no sparks, AI noise or payout`);
  assert.equal(announcements(), announced + Number(discovery), `${reason}: discovery announcement`);
  assert.equal(beeps(), pinged + Number(discovery), `${reason}: detector ping`);
  assert.equal(
    emitted
      .filter(
        (e): e is Extract<IntelRecord, { type: 'intel:operation' }> => e.type === 'intel:operation'
      )
      .at(-1)?.active,
    false,
    reason
  );
  ctx.time.scale = 1;
  ctx.market.open = false;
  ctx.input.frozen = false;
  ctx.input.enabled = true;
  player.controlEnabled = true;
  player.dead = player.mantling = player.airborne = false;
  player.healCtrl.active = false;
  ctx.ui.menu.open = false;
  ctx.input.down.delete('Mouse0');
  ctx.input.down.delete('Mouse2');
  ctx.weapons = null;
}
step(1);
step(0);
assert.equal(intel._hold, 0, 'zero-dt frame resets, never advances');
step(2.5);
assert.equal(intel.secured, 0, 'old 2.5-second hold no longer claims a cache');
assert.equal(ctx.market.credits, 0);
step(1.25);
assert.equal(intel._hold, 3.75);
assert.equal(intel.secured, 0, 'claim must not pay before four seconds');
step(0.25);
assert.equal(intel.secured, 1);
assert.equal(ctx.market.credits, 500);
assert(
  emitted.some(
    (e): e is Extract<IntelRecord, { type: 'intel:secured' }> =>
      e.type === 'intel:secured' && e.credits === 500
  )
);
assert(intel.blocksUse(), 'held T after completion cannot spill into ammunition');
intel._secure(cache);
assert.equal(ctx.market.credits, 500, 'securing twice is harmless');
ctx.input.down.delete('KeyT');
step(0.1);
assert(!intel.blocksUse());

// Both interaction owners use the same real prompt adapter.
ctx.ui.setPrompt({ text: 'replacement' }, 'ammo');
intel._prompting = true;
intel._clearPrompt();
assert(ctx.ui.prompt.active, 'intel cleanup cannot clear an ammo prompt');
ctx.ui.clearPrompt('ammo');
assert(!ctx.ui.prompt.active);
const owner = pickupOwner(ctx, player);
const pickups = new AmmoPickups(owner);
const again = intel._spawn({ id: 'again', x: 0, y: 0, z: 0 });
assert(again);
aimAt(again);
pickups.spawn(player.feetPosition);
ctx.input.down.add('KeyT');
pickups.update(0.5);
step(0.5);
assert.equal(owner.state?.reserve, 0, 'ammo yields to an aimed cache before intel.update');
assert.equal(intel._hold, 0.5);
ctx.camera.rotateY(Math.PI);
pickups.update(0.1);
step(0.1);
assert.equal(ctx.ui._promptOwner, 'ammo', 'leaving intel preserves replacement ammo prompt');
pickups.dispose();

// One detector for overlapping caches; it never generates hearing evidence.
intel._spawn({ id: 'close', x: 0.5, y: 0, z: 0 });
ctx.input.down.delete('KeyT');
intel._beepAt = 0;
const beeps = sounds.filter((s): boolean => s === 'intel_beep').length;
const noise = emitted.filter((e): boolean => e.type === 'intel:noise').length;
step(0.05);
assert.equal(sounds.filter((s): boolean => s === 'intel_beep').length, beeps + 1);
assert.equal(emitted.filter((e): boolean => e.type === 'intel:noise').length, noise);
assert.equal(intel.getHudState().pulses.length, 2);
assert.equal(intel.getHudState().pulses[0].y, again.y);
intel.reset();
assert.equal(intel._used.size, 0);
assert.equal(intel.secured, 0);
assert.equal(intel._alive.length, 0);
assert.equal(intel._lastWave, 0);
assert.equal(intel._announceAt, 0);
assert(intel._pool.every((p): boolean => !p.group.visible && !p.group.parent));
for (let i = 0; i < 7; i++) {
  const spawned = intel._spawn({ id: `cache-${i}`, x: i * 2, y: 0, z: 0 });
  assert(spawned);
  intel._secure(spawned);
  const event = emitted
    .filter((e): e is Extract<IntelRecord, { type: 'intel:secured' }> => e.type === 'intel:secured')
    .at(-1);
  assert(event);
  assert.equal(event.credits, INTEL.credits);
  assert.equal(event.id, `cache-${i}`);
}
assert.equal(intel.getHudState().secured, 7);
intel.dispose();
ctx.events.emit('wave:complete', { wave: 20, nextWave: 0, delay: 20 });
assert.equal(intel._alive.length, 0, 'dispose unsubscribes');
// Boot prewarm is simulation-transparent and restores GPU/scene state on failure.
const warm = await harness();
const lights = [
  { light: new THREE.PointLight(), range: 2 },
  { light: new THREE.PointLight(), range: 2 },
];
lights[0].light.visible = false;
lights[1].light.position.set(100, 0, 0);
let calls = 0;
let failCompile = false;
const warmRender = new RenderSystem();
warmRender.lights = lights;
warmRender.patchMaterials = (): void => {};
warmRender._warmGraph = async (): ReturnType<RenderSystem['_warmGraph']> => {
  // Native prewarm keeps the same light identities and delegates target /
  // zero-draw restoration to the renderer's real-variant graph warmup.
  assert.equal(lights[0].light.visible, false);
  assert.equal(lights[1].light.visible, true);
  assert(warm.ctx.scene.children.includes(warm.intel._pool[0].group));
  assert.equal(warm.ctx.scene.overrideMaterial, null);
  calls++;
  if (failCompile) throw new Error('compile failure');
  return { ms: 0, geometries: 0, frameUnchanged: true };
};
warm.ctx.render = warmRender;
const clock = { ...warm.ctx.time };
warm.intel.rng.u32 = (): never => {
  throw new Error('prewarm consumed gameplay RNG');
};
await warm.intel.prewarmMaterials();
assert.equal(calls, 1);
failCompile = true;
await assert.rejects(warm.intel.prewarmMaterials(), /compile failure/);
assert.equal(calls, 2);
assert.equal(warm.ctx.scene.overrideMaterial, null);
assert.equal(lights[0].light.visible, false);
assert.equal(lights[1].light.visible, true);
assert.deepEqual(warm.ctx.time, clock);
assert.equal(warm.intel._used.size, 0);
assert.equal(warm.intel._alive.length, 0);
assert(!warm.intel._pool[0].group.visible && !warm.intel._pool[0].group.parent);
warm.intel.dispose();
// Recent-site preference still respects spacing, and never makes a drop impossible.
assert.equal(randomMarker(candidates, new Set(), zero, [], firstRng, ['a']).id, 'b');
assert.equal(randomMarker(candidates, new Set(), zero, [], firstRng, ['a', 'b', 'c']).id, 'a');
assert.equal(randomMarker(candidates, new Set(['a']), zero, [], firstRng, ['a', 'b', 'c']).id, 'b');
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string): string | null {
      return saved.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      saved.set(key, value);
    },
  },
});
try {
  const worldMarkers = exported.map((m): { id: string; x: number; y: number; z: number } => ({
    id: m.id,
    x: m.position[0],
    y: m.position[1],
    z: m.position[2],
  }));
  const starts: string[] = [];
  // Identical seed/player position on six fresh boots still yields fresh eligible sites.
  for (let i = 0; i < 6; i++) {
    const game = await harness(false, worldMarkers);
    game.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
    starts.push(game.intel._alive[0].id);
    assert.equal(new Set(starts).size, starts.length);
    game.intel.dispose();
  }
  const savedSites: unknown = JSON.parse(saved.get('ow:intel-sites:v1') ?? 'null');
  assert(Array.isArray(savedSites));
  assert.equal(savedSites.length, INTEL.recentSites);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): never {
      throw new Error('blocked storage');
    },
  });
  const blocked = await harness();
  blocked.intel.rng.float = (): number => 0.99;
  blocked.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
  const previous = blocked.intel._alive[0].id;
  blocked.intel.reset();
  blocked.ctx.events.emit('wave:complete', { wave: 1, nextWave: 0, delay: 20 });
  assert.notEqual(
    blocked.intel._alive[0].id,
    previous,
    'in-session history works with blocked storage'
  );
  blocked.intel.dispose();
  const capture = await harness(true);
  assert.equal(capture.intel._recent.length, 0, 'capture does not read player history');
  capture.intel.dispose();
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else deleteGlobal('localStorage');
}
// Real audio event wiring stops a voice synchronously on every interruption path.
const audioSystem = new AudioSystem();
const audioCtx = createTestContext();
audioSystem._wireEvents(audioCtx);
for (const emission of [
  ['intel:operation', { active: false, position: new THREE.Vector3() }],
  ['game:restart', {}],
  ['player:death', { position: new THREE.Vector3(), from: null, amount: 0 }],
  ['market:open', { wave: 1 }],
  ['ui:pause', { paused: true }],
  [
    'engine:error',
    { message: 'failure', system: 'test', method: 'update', error: new Error('failure') },
  ],
] as const) {
  let stopped = 0;
  audioSystem._intelOperating = true;
  audioSystem._intelAlarm = {
    node: fixture<GainNode>({}),
    stop(): void {
      stopped++;
    },
  };
  audioCtx.events.emit(...emission);
  const [type] = emission;
  assert.equal(stopped, 1, type);
  assert.equal(audioSystem._intelAlarm, null, type);
  assert.equal(audioSystem._intelOperating, false, type);
}
audioSystem.dispose();
const particles: Parameters<Parameters<typeof spawnIntelSparks>[0]['emitAdd']>[0][] = [];
spawnIntelSparks(
  fixture<Parameters<typeof spawnIntelSparks>[0]>({
    rng: new Rng(9),
    emitAdd(p): number {
      particles.push({ ...p });
      return particles.length;
    },
  }),
  { x: 1, y: 2, z: 3 }
);
assert.equal(particles.length, 4);
assert(
  particles.every((p): boolean => p.x === 1 && p.y === 2 && p.z === 3 && p.vy > 0 && p.life < 0.3)
);
console.log(
  'ok  smoke-intel: T interaction/F isolation, canonical prompt, ammo priority/release barrier, four-second claim, history, spacing, lid/sparks/alarm, credits, cancellation, lifecycle, prewarm'
);
