import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PhysicsSystem } from '../../src/physics/index.js';

function fixture() {
  const physics = Object.create(PhysicsSystem.prototype);
  physics.ragdolls = [];
  physics.radialImpulses = [];
  physics.bodies = {
    applyRadialImpulse(...args) { physics.radialImpulses.push(args); },
  };
  return physics;
}

const physics = fixture();
physics.explode({ position: new Vector3(), radius: 4, damage: 250 });
physics.explode({ position: new Vector3(1, 0, 0), radius: 12, damage: 1400 });
physics.explode({ position: new Vector3(), radius: 3, damage: 250, impulse: 50 });
physics.explode(new Vector3(2, 0, 0));
assert.deepEqual(physics.radialImpulses.map(([x, y, z, radius]) => [x, y, z, radius]), [
  [0, 0, 0, 4], [1, 0, 0, 12], [0, 0, 0, 3], [2, 0, 0, 5],
]);
for (const [actual, expected] of physics.radialImpulses.map(([,,,, strength], i) => [strength, [13.5, 75.6, 3, 5.4][i]])) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `radial strength ${actual} should be ${expected}`);
}
console.log('Explosion events preserve damage-derived impulse and vector fallback');
