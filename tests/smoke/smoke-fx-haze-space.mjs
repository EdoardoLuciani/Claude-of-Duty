import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { Rng } from '../../src/core/rng.ts';
import { FxSystem } from '../../src/fx/index.js';
import { muzzleFlash } from '../../src/fx/muzzle.js';

const camera = new PerspectiveCamera(), viewCamera = new PerspectiveCamera();
camera.position.set(7, 2, -3); camera.rotation.set(.1, .8, 0);
viewCamera.position.set(.1, -.1, .2); viewCamera.rotation.set(0, -.2, 0);
camera.updateMatrixWorld(); viewCamera.updateMatrixWorld();
for (const view of [false, true]) {
  const position = new Vector3(.16, -.13, -.72), direction = new Vector3(0, 0, -1);
  const expected = position.clone().addScaledVector(direction, .1);
  if (view) expected.applyMatrix4(viewCamera.matrixWorldInverse).applyMatrix4(camera.matrixWorld);
  let actual;
  const fx = {
    ctx: { camera, viewCamera }, rng: new Rng(123), pScale: 1, _p2: new Vector3(),
    _fromView: FxSystem.prototype._fromView,
    emitAdd() {}, emitLit() {}, emitViewAdd() {}, emitViewLit() {}, viewFlash() {},
    haze(x, y, z) { actual = new Vector3(x, y, z); },
  };
  muzzleFlash(fx, { position, direction, view, weapon: 'rifle' });
  assert(actual.distanceTo(expected) < 1e-10, `muzzle haze must be in world space (view=${view})`);
}
console.log('world and translated/rotated first-person muzzle haze coordinates passed');
