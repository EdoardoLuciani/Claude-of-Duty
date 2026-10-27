import assert from 'node:assert/strict';

import { PerspectiveCamera, Vector3 } from 'three';

import { Rng } from '../../src/core/rng.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { muzzleFlash, MUZZLE_PROFILES } from '../../src/fx/muzzle.ts';

const camera = new PerspectiveCamera(),
  viewCamera = new PerspectiveCamera();
camera.position.set(7, 2, -3);
camera.rotation.set(0.1, 0.8, 0);
viewCamera.position.set(0.1, -0.1, 0.2);
viewCamera.rotation.set(0, -0.2, 0);
camera.updateMatrixWorld();
viewCamera.updateMatrixWorld();
for (const view of [false, true]) {
  const position = new Vector3(0.16, -0.13, -0.72),
    direction = new Vector3(0, 0, -1);
  const expected = position.clone().addScaledVector(direction, 0.1);
  if (view) expected.applyMatrix4(viewCamera.matrixWorldInverse).applyMatrix4(camera.matrixWorld);
  let actual;
  const fx = {
    ctx: { camera, viewCamera },
    rng: new Rng(123),
    pScale: 1,
    _p2: new Vector3(),
    _fromView: FxSystem.prototype._fromView,
    emitAdd() {},
    emitLit() {},
    emitViewAdd() {},
    emitViewLit() {},
    viewFlash() {},
    haze(x, y, z) {
      actual = new Vector3(x, y, z);
    },
  };
  muzzleFlash(fx, { position, direction, view, weapon: 'rifle' });
  assert(actual.distanceTo(expected) < 1e-10, `muzzle haze must be in world space (view=${view})`);
  const profile = muzzleFlash(fx, { position, direction, view, weapon: { id: 'pistol' } });
  assert.equal(
    profile,
    MUZZLE_PROFILES.pistol,
    'compact descriptors resolve their weapon identity'
  );
}
console.log('world and translated/rotated first-person muzzle haze coordinates passed');
