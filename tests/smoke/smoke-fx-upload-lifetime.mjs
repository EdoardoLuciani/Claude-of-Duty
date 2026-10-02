import assert from 'node:assert/strict';
import { StreamDrawUsage, Texture, Vector3 } from 'three';
import { ParticleLayer, resetSpawn } from '../../src/fx/particles.js';
import { DecalSystem } from '../../src/fx/decals.js';

const atlas = new Texture();
for (let restart = 0; restart < 2; restart++) {
  const layer = new ParticleLayer({ capacity: 16, mode: 'additive', atlas, cols: 1 });
  const decals = new DecalSystem({ capacity: 8, albedo: atlas, normal: atlas, orm: atlas, cols: 1 });
  const attributes = [layer.ibuf, decals.aPos, decals.aNrm, decals.aUv, decals.aDec];
  for (const a of attributes) assert.equal(a.usage, StreamDrawUsage);
  const s = resetSpawn(); s.z = -2; s.life = 2;
  const point = new Vector3(0, 0, -2), normal = new Vector3(0, 0, 1);
  const birth = now => {
    layer.emit(s, now);
    assert.equal(decals.add({ point, normal, size: .3, tile: 0, life: 2, now, world: null }), true);
    layer.flush(now); decals.flush(now);
  };
  birth(0);
  const versions = attributes.map(a => a.version);
  for (let t = 0; t <= 3; t++) { layer.flush(t); decals.flush(t); }
  assert.deepEqual(attributes.map(a => a.version), versions, 'quiet/expired FX data is immutable');
  assert.equal(layer.mesh.visible, false); assert.equal(decals.mesh.visible, false);
  for (let i = 0; i < 21; i++) birth(4);
  assert.equal(layer._wrapped, true); assert.equal(decals._wrapped, true);
  for (let i = 0; i < attributes.length; i++) {
    assert.equal(attributes[i].version, versions[i] + 21, 'every birth flush publishes');
    assert.ok(attributes[i].updateRanges.length > 0, 'hidden/wrapped edits accumulate dirty ranges');
  }
  assert.equal(layer.geometry.instanceCount, layer.capacity);
  assert.equal(decals.geometry.drawRange.count, decals.capacity * decals.vertsPerDecal);
  layer.dispose(); decals.dispose();
}
atlas.dispose();
console.log('FX event-data stream usage, versions, expiry, wrap and fresh owners: OK');
