import assert from 'node:assert/strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { AudioSystem } from '../../src/audio/index.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { resetSpawn, setSpawnColorRamp, SP } from '../../src/fx/particles.ts';
import { IntelSystem } from '../../src/intel/index.ts';
import { makeKit, makeCrate } from '../../src/intel/prop.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { MantleMotion } from '../../src/player/mantle.ts';
import { Movement } from '../../src/player/movement.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { Minimap } from '../../src/ui/minimap.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext } from '../lib/context.ts';
import { addLifecycle, createCoreFixture } from '../lib/core-fixture.ts';
import { fixture } from '../lib/fixture.ts';
import { installUiDocument } from '../lib/ui-fixture.ts';

// Keep each case correlated with its constructor, so renamed fields fail checking.
function checkOwned<T extends object>(
  create: () => T,
  fields: readonly (keyof T & string)[],
  defaults: Partial<T>
): void {
  const a = create(),
    b = create();
  for (const key of fields)
    assert.notEqual(a[key], b[key], `${a.constructor.name}.${key} is owned`);
  for (const key in defaults) assert.equal(a[key], defaults[key]);
}
// Constructor defaults remain per-instance, including nested pooled payloads.
checkOwned((): StaticWorld => new StaticWorld(), ['objects', 'contacts', '_stackNode'], {
  triCount: 0,
  dirty: false,
});
checkOwned((): MantleMotion => new MantleMotion(), [], { active: false, duration: 0.6, fz: 1 });
checkOwned(
  (): Movement => new Movement(createTestContext(), null),
  ['cmd', 'position', 'stepEvent'],
  { state: 'stand', grounded: true }
);
checkOwned((): PlayerSystem => new PlayerSystem(), ['_death', '_prev', '_nearMissShots'], {
  isPlayer: true,
  controlEnabled: true,
});
checkOwned((): AudioSystem => new AudioSystem(), ['_dry', '_probeDirs', '_budget'], {
  running: false,
  failed: false,
});
checkOwned((): WeaponSystem => new WeaponSystem(), ['states', 'owned', '_shellQueue'], {
  activeId: 'rifle',
  grenades: 2,
});
const audio = new AudioSystem();
assert.equal(audio._probeDirs.length, 9);
assert.equal(audio._dry.length, 80);
assert.equal(new Set(audio._dry).size, 80);
const weapon = new WeaponSystem();
assert.equal(weapon._shellQueue.length, 8);
assert.equal(new Set(weapon._shellQueue).size, 8);
assert.deepEqual([...weapon.owned], ['rifle', 'pistol']);
const player = new PlayerSystem();
assert.notEqual(player._death.target, new PlayerSystem()._death.target);
assert.equal(player._death.duration, 3.2);

// Color-ramp writes do not reset intensity or any other pooled spawn property.
const spawn = resetSpawn();
spawn.i0 = 7;
spawn.i1 = 3;
spawn.seed = 42;
const expected = { ...spawn, r0: 0.1, g0: 0.2, b0: 0.3, r1: 0.4, g1: 0.5, b1: 0.6 };
setSpawnColorRamp(spawn, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6);
assert.equal(spawn, SP);
assert.deepEqual(spawn, expected);
assert.equal(resetSpawn(), SP);
assert.equal(spawn.i0, 1);
console.log(
  'runtime initialization: owned defaults, pool capacities and isolated color writes passed'
);

// Actual subsystem owners must tolerate skipped init and release everything
// acquired before a later dependency/allocation rejected.
for (const system of [new PlayerSystem(), new IntelSystem(), new FxSystem()])
  assert.doesNotThrow((): void => system.dispose());
const partialPlayer = new PlayerSystem();
let movementDisposed = false,
  passDisposed = false;
partialPlayer.movement = new Movement(createTestContext(), partialPlayer);
partialPlayer.movement.dispose = (): void => {
  movementDisposed = true;
};
partialPlayer._unregisterPass = (): void => {
  passDisposed = true;
};
partialPlayer.dispose();
assert(movementDisposed && passDisposed, 'missing flashlight must not block earlier owners');
const light = new THREE.SpotLight();
const scene = new THREE.Scene();
scene.add(light, light.target);
partialPlayer.flashlight = light;
let shadowDisposed = false;
light.shadow.dispose = (): void => {
  shadowDisposed = true;
};
partialPlayer.dispose();
assert.equal(scene.children.length, 0);
assert(shadowDisposed);
const partialIntel = new IntelSystem();
partialIntel._kit = makeKit();
const kitGeometries = Object.values(partialIntel._kit.geos);
let geometriesDisposed = 0;
for (const geometry of kitGeometries)
  geometry.addEventListener('dispose', (): void => {
    geometriesDisposed++;
  });
const crate = makeCrate(partialIntel._kit);
scene.add(crate);
partialIntel._pool = [
  { id: '', x: 0, y: 0, z: 0, group: crate, open: 0, pulse: { x: 0, y: 0, z: 0, radius: 0 } },
];
partialIntel.dispose();
assert.equal(geometriesDisposed, kitGeometries.length);
assert.equal(scene.children.length, 0);
const fetch = globalThis.fetch;
const restoreUiDocument = installUiDocument();
try {
  globalThis.fetch = Object.assign(
    async (): Promise<Response> => new Response(null, { status: 503 }),
    { preconnect: fetch.preconnect }
  );
  const fx = new FxSystem();
  await assert.rejects(fx.init(createTestContext()), /HTTP 503/);
  assert.doesNotThrow((): void => fx.dispose());
  assert.doesNotThrow((): void => new UiSystem().dispose());
  const partialUi = new UiSystem();
  let rootRemoved = false,
    minimapDisposed = false;
  partialUi.root = fixture<HTMLElement>({
    remove(): void {
      rootRemoved = true;
    },
  });
  partialUi.minimap = new Minimap(createTestContext().rng.fork());
  partialUi.minimap.dispose = (): void => {
    Minimap.prototype.dispose.call(partialUi.minimap);
    minimapDisposed = true;
  };
  assert.doesNotThrow((): void => partialUi.dispose());
  assert(
    rootRemoved && minimapDisposed,
    'absent later controls must not block acquired UI cleanup'
  );

  // Required FX loading fails before UI init; automatic teardown must release
  // a real skipped UiSystem without adding a secondary AggregateError.
  const { engine, registry } = createCoreFixture();
  engine.input.detach = (): void => {};
  for (const id of ['render', 'materials', 'game', 'market']) addLifecycle(registry, id, {});
  registry.add('fx', new FxSystem());
  registry.add('ui', new UiSystem());
  await assert.rejects(engine.init(), /HTTP 503/);
  await assert.doesNotReject(engine.dispose());
} finally {
  globalThis.fetch = fetch;
  restoreUiDocument();
}
console.log('skipped/partial player, intel, FX and UI teardown releases earlier acquisitions');

const bitmap = globalThis.createImageBitmap;
// oxlint-disable-next-line typescript/unbound-method -- restore the original prototype method
const loadHull = GLTFLoader.prototype.loadAsync;
try {
  globalThis.fetch = Object.assign(async (): Promise<Response> => new Response('atlas'), {
    preconnect: fetch.preconnect,
  });
  globalThis.createImageBitmap = async (): Promise<ImageBitmap> =>
    fixture<ImageBitmap & { then?: undefined; depth?: number }>(
      { width: 1, height: 1, close(): void {} },
      ['then', 'depth']
    );
  const hullFailure = new Error('spent hull load failed');
  GLTFLoader.prototype.loadAsync = async (): Promise<never> => {
    throw hullFailure;
  };
  const fx = new FxSystem(),
    ctx = createTestContext();
  await assert.rejects(fx.init(ctx), (error: unknown): boolean => error === hullFailure);
  const resources = [
    ...[fx.lit, fx.add, fx.motes, fx.viewAdd, fx.viewLit, fx.hazeSys.layer, fx.decals].flatMap(
      (layer): Array<THREE.Material | THREE.BufferGeometry> => [layer.material, layer.geometry]
    ),
    fx._atlas.texture,
    fx._decalAtlas.albedo,
    fx._decalAtlas.normal,
    fx._decalAtlas.orm,
  ];
  let released = 0;
  for (const resource of resources)
    resource.addEventListener('dispose', (): void => {
      released++;
    });
  fx.dispose();
  assert.equal(
    released,
    resources.length,
    'hull rejection releases completed particle/decal/haze/atlas resources'
  );
  assert.equal(ctx.scene.children.length, 0, 'detach particles, decals and pooled lights');
} finally {
  globalThis.fetch = fetch;
  globalThis.createImageBitmap = bitmap;
  GLTFLoader.prototype.loadAsync = loadHull;
}
