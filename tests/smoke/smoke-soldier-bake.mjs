import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Rng } from '../../src/core/rng.js';
import { SoldierMaterials } from '../../src/ai/textures.js';

// Golden from 3926d40 before removing its unused runtime material factory.
// Small tiles keep CI cheap; the full 512px exporter is compared separately.
const parent = new Rng(0x5eed1234), rng = parent.fork();
const bake = new SoldierMaterials(rng, { size: 64, anisotropy: 8, camo: ['arid', 'woodland', 'urban'] });
const hash = createHash('sha256'), textures = [];
for (const [name, maps] of Object.entries(bake.sets))
  for (const [kind, texture] of Object.entries(maps)) textures.push([`${name}/${kind}`, texture]);
for (const [name, texture] of Object.entries(bake.details)) textures.push([`detail/${name}`, texture]);
assert.equal(textures.length, 29);
for (const [name, t] of textures) {
  hash.update(JSON.stringify([name, t.image.width, t.image.height, t.type, t.format,
    t.wrapS, t.wrapT, t.colorSpace, t.anisotropy, t.minFilter, t.magFilter, t.generateMipmaps]));
  hash.update(t.image.data);
}
hash.update(JSON.stringify([bake.camoStats,
  [parent.s0, parent.s1, parent.s2, parent.s3], [rng.s0, rng.s1, rng.s2, rng.s3]]));
assert.equal(hash.digest('hex'), '0f539854692dfb497e9f526e9249e5820f1c9af3e320fe5f64de34d8632367aa',
  'bake bytes, metadata, statistics, order and RNG must retain the authored baseline');
const disposals = new Map(textures.map(([, t]) => [t, 0]));
for (const t of disposals.keys()) t.addEventListener('dispose', () => disposals.set(t, disposals.get(t) + 1));
bake.dispose(); bake.dispose();
assert([...disposals.values()].every(count => count === 1), 'each baked texture must be disposed exactly once');
console.log('29 authored texture bakes: bytes, metadata, RNG and disposal preserved');
