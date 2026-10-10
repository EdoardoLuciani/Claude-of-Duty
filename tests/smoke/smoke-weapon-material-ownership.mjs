import assert from 'node:assert/strict';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { WeaponMaterialsNode } from '../../src/weapons/materials-tsl.js';
import { WEAPON_MATERIALS } from '../../src/weapons/materials.ts';

const borrowed = new MeshStandardNodeMaterial();
let calls = 0, borrowedDisposals = 0;
borrowed.addEventListener('dispose', () => borrowedDisposals++);
const materials = new WeaponMaterialsNode({ get(name, options) {
  calls++;
  assert.equal(name, WEAPON_MATERIALS.steel[0]);
  assert.equal(options, WEAPON_MATERIALS.steel[1]);
  return borrowed;
} });
assert.equal(materials.get('steel'), borrowed);
assert.equal(materials.get('steel'), borrowed);
assert.equal(calls, 1, 'cache borrowed recipes without recreating their materials');
const owned = [];
for (const method of ['cavity', 'opticTube', 'glass', 'lensRing', 'lensVignette', 'reticleOutline', 'reticle']) {
  const mat = materials[method]();
  assert.equal(materials[method](), mat, `${method} must retain cache identity`);
  assert.equal(mat.isNodeMaterial, true);
  owned.push(mat);
}
assert.equal(materials.rimRamp(), materials.rimTexture);
owned.push(materials.rimTexture);
const disposals = new Map(owned.map(resource => [resource, 0]));
for (const resource of owned) resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
materials.dispose();
assert.equal(borrowedDisposals, 0, 'weapon resolver must not dispose library-owned materials');
assert([...disposals.values()].every(count => count === 1), 'dispose all owned optics and the shared ramp once');
assert.equal(materials.cache.size, 0);
borrowed.dispose();
console.log('native weapon recipes, cache identity and material/texture ownership preserved');
