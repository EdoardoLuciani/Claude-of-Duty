import assert from 'node:assert/strict';

import * as THREE from 'three';

import { DecalSystem } from '../../src/fx/decals.ts';
import { ParticleLayer, resetSpawn, STRIDE, disposeQuadSource } from '../../src/fx/particles.ts';

// Evicting one permanent mark must keep the batch visible until the last one goes.
const atlas = new THREE.Texture();
const marks = new DecalSystem({ capacity: 8, cols: 4, albedo: atlas, normal: atlas, orm: atlas });
const mark = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 1, 0),
  size: 0.18,
  tile: 0,
  now: 0,
  life: Infinity,
};
marks.add(mark);
marks.add(mark);
mark.life = 1;
for (let i = 0; i < marks.capacity - 1; i++) marks.add(mark);
marks.flush(2);
assert(marks.mesh.visible);
marks.add(mark);
marks.flush(2);
assert(!marks.mesh.visible);
marks.dispose();
atlas.dispose();

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
  // A sub-frame flame must draw at emission and expire before the next 120 Hz frame.
  const flash = { ...defaults, life: 0.005, delay: -0.0003 };
  layer.emit(flash, 3, 0.005);
  layer.flush(3);
  assert.equal(layer.mesh.visible, true);
  layer.flush(3 + 1 / 120);
  assert.equal(layer.mesh.visible, false);
  assert.equal(layer.material.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(layer.material.blendDstAlpha, THREE.OneFactor);
} finally {
  layer.dispose();
  texture.dispose();
  disposeQuadSource();
}
console.log('[fx-recipes] particle packing, slot reuse and upload/expiry lifecycle passed');
