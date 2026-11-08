import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { resetSpawn, setSpawnColorRamp, SP } from '../../src/fx/particles.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { MantleMotion } from '../../src/player/mantle.ts';
import { Movement } from '../../src/player/movement.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext } from '../lib/context.ts';

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
checkOwned((): StaticWorld => new StaticWorld(), ['objects', 'contacts', '_stackNode'], { triCount: 0, dirty: false });
checkOwned((): MantleMotion => new MantleMotion(), [], { active: false, duration: 0.6, fz: 1 });
checkOwned((): Movement => new Movement(createTestContext(), null), ['cmd', 'position', 'stepEvent'], { state: 'stand', grounded: true });
checkOwned((): PlayerSystem => new PlayerSystem(), ['_death', '_prev', '_nearMissShots'], { isPlayer: true, controlEnabled: true });
checkOwned((): AudioSystem => new AudioSystem(), ['_dry', '_probeDirs', '_budget'], { running: false, failed: false });
checkOwned((): WeaponSystem => new WeaponSystem(), ['states', 'owned', '_shellQueue'], { activeId: 'rifle', grenades: 2 });
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
