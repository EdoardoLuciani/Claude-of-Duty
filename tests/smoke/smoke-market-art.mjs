import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { MARKET_ART } from '../../src/ui/market-art.ts';
import { isWeaponId } from '../../src/weapons/defs.ts';

assert.deepEqual(Object.keys(MARKET_ART).sort(), [
  'ammo',
  'armour',
  'bandage',
  'carpet',
  'grenade',
]);
const provenance = JSON.parse(
  readFileSync(new URL('../../assets/ui/market/provenance.json', import.meta.url), 'utf8')
);
assert.deepEqual(Object.keys(provenance.images).sort(), Object.keys(MARKET_ART).sort());
const paths = new Set();
for (const [id, art] of Object.entries(MARKET_ART)) {
  assert.equal(isWeaponId(id), false, 'weapons keep interactive 3D previews');
  assert.match(art.src, /^\/images\/market\/[a-z]+\.webp$/);
  assert(art.alt.length > 30, id + ' has descriptive alternative text');
  assert(!paths.has(art.src), id + ' has its own artwork');
  paths.add(art.src);
  const bytes = readFileSync(new URL('../../public' + art.src, import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert(bytes.length > 1000 && bytes.length < 160_000, id + ' is a locally optimized WebP');
  const source = provenance.images[id];
  assert.equal(source.file, art.src);
  assert.equal(source.model, 'gpt-image-2.5-sunburst');
  assert.match(source.prompt, /HAND-PAINTED TACTICAL (?:GAME )?INVENTORY ILLUSTRATION/);
  assert.equal(source.bytes, bytes.length);
  assert.equal(source.sha256, createHash('sha256').update(bytes).digest('hex'));
}
console.log('Five non-weapon market illustrations are local, distinct, described and optimized.');
