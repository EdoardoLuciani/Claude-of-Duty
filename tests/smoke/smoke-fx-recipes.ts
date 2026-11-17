import assert from 'node:assert/strict';

import * as THREE from 'three';

import { ParticleLayer, resetSpawn, STRIDE, disposeQuadSource } from '../../src/fx/particles.ts';

// A real particle layer verifies bounded slot reuse, exact packing and upload/expiry lifecycle.
const texture = new THREE.Texture();
const layer = new ParticleLayer({ capacity: 16, mode: 'additive', atlas: texture, cols: 4 });
const defaults = { ...resetSpawn() };
try {
  for (let i = 0; i < 18; i++) {
    const spawn = { ...defaults, x: i, life: 0, delay: 0.25, flags: 2 };
    assert.equal(layer.emit(spawn, 2), i % 16);
  }
  assert.equal(layer.spawned, 18);
  assert.equal(layer.highWater, 16);
  assert.equal(layer.cursor, 2);
  assert.equal(layer.expireAt, 2.266);
  assert.deepEqual(
    Array.from(layer.array.slice(0, STRIDE)),
    [
      16, 0, 0, 0.2, 0, 0, 0, 0.3, 2.25, 62.5, 1.4, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0.4,
      1, 1, 0, 1, 0, 2,
    ].map(Math.fround)
  );
  layer.flush(2.25);
  assert.equal(layer.geometry.instanceCount, 16);
  assert.equal(layer.mesh.visible, true);
  assert.deepEqual(layer.ibuf.updateRanges, [{ start: 0, count: 16 * STRIDE }]);
  const version = layer.ibuf.version;
  layer.flush(3);
  assert.equal(layer.mesh.visible, false);
  assert.equal(layer.ibuf.version, version, 'time-only frames do not republish slot data');
  assert.equal(layer.material.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(layer.material.blendDstAlpha, THREE.OneFactor);
} finally {
  layer.dispose();
  texture.dispose();
  disposeQuadSource();
}
console.log('[fx-recipes] particle packing, slot reuse and upload/expiry lifecycle passed');
