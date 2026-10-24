import assert from 'node:assert/strict';

import { ReticleMaterials } from '../../src/weapons/materials-tsl.ts';

const materials = new ReticleMaterials();
const reticle = materials.reticle();
const outline = materials.reticleOutline();
assert.equal(materials.reticle(), reticle, 'retain additive reticle cache identity');
assert.equal(materials.reticleOutline(), outline, 'retain keyline cache identity');
const variants = [
  reticle,
  outline,
  materials.reticle(0xff1206, 0.95),
  materials.reticle(0xff1206, 0.475),
  materials.reticleOutline(0.85),
];
assert.equal(
  new Set(variants).size,
  variants.length,
  'appearance parameters distinguish materials'
);
const disposals = new Map(variants.map((material) => [material, 0]));
for (const material of variants) {
  assert.equal(material.isNodeMaterial, true);
  material.addEventListener('dispose', () => disposals.set(material, disposals.get(material) + 1));
}
materials.dispose();
materials.dispose();
assert(
  [...disposals.values()].every((count) => count === 1),
  'dispose each owned reticle once'
);
assert.notEqual(materials.reticle(), reticle, 'disposal clears the cache');
materials.dispose();
console.log('reticle variants, cache identity and idempotent ownership cleanup preserved');
