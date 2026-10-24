import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { makeEvolysModel, EVOLYS_URL } from '../../src/weapons/evolys.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

// Owner selected M4 F. Other weapons retain their own eye/arm constraints.
for (const [id, eye, fov] of [
  ['rifle', 0.06, 0.7],
  ['lmg', 0.125, 0.48],
  ['pistol', 0.34, 0.7],
  ['shotgun', 0.28, 0.72],
  ['smg', 0.28, 0.145],
  ['mcx', 0.11, 0.86],
  ['sniper', 0.09, 0.72],
]) {
  assert.equal(WEAPON_DEFS[id].eyeRelief, eye, `${id}: eye distance`);
  assert.equal(WEAPON_DEFS[id].viewFov, fov, `${id}: weapon framing`);
  if (id !== 'mcx' && id !== 'sniper')
    assert.equal(WEAPON_DEFS[id].adsFovScale, undefined, `${id}: default world zoom unchanged`);
}
assert.equal(WEAPON_DEFS.mcx.adsFovScale, 0.28);
assert.equal(WEAPON_DEFS.sniper.adsFovScale, 0.25);

const model = makeEvolysModel(await parseGLB(readFileSync(new URL(EVOLYS_URL))));
const optic = model.nodes.opticGlass;
assert.equal(optic.reticle, 'dot');
assert.equal(optic.dotMoa, 3.25);
assert.equal(optic.minDotPixels, 5);
const vm = Object.create(Viewmodel.prototype),
  screenSize = { height: 1080 };
vm.ctx = {
  camera: new THREE.PerspectiveCamera(49.6, 16 / 9),
  viewCamera: new THREE.PerspectiveCamera(28.8, 16 / 9),
  get: () => ({ screenSize }),
};
vm.anchor = new THREE.Object3D();
vm.rig = new THREE.Object3D();
vm.reticle = new THREE.Object3D();
for (const key of ['dotCore', 'dotHalo', 'dotRim', 'dotRing'])
  vm[key] = new THREE.Mesh(new THREE.CircleGeometry(1), new THREE.MeshBasicMaterial());
for (const height of [720, 1080, 2160, 24000])
  for (const worldFov of [40, 49.6, 70])
    for (const viewFov of [16.8, 28.8, 50.4, 60])
      for (const distance of [0.09, 0.125, 0.2]) {
        screenSize.height = height;
        vm.ctx.camera.fov = worldFov;
        vm.ctx.viewCamera.fov = viewFov;
        vm.rig.position.set(-optic.center[0], -optic.center[1], -distance - optic.center[2]);
        vm._updateReticle({ optic }, 1);
        const pixels =
          (vm.dotCore.scale.x * height) / (distance * Math.tan((viewFov * Math.PI) / 360));
        const angularPixels =
          (height * Math.tan((optic.dotMoa * Math.PI) / (180 * 120))) /
          Math.tan((worldFov * Math.PI) / 360);
        assert(
          Math.abs(pixels - Math.max(5, angularPixels)) < 1e-10,
          'RMR dot footprint follows world FOV/resolution, never weapon framing'
        );
        assert(
          vm.reticle.visible && !vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible
        );
        assert.equal(vm.dotCore.material.opacity, 0.9);
        assert(vm.reticle.position.distanceTo(new THREE.Vector3(0, 0, -distance)) < 1e-10);
      }
vm.rig.position.x += 0.02;
vm._updateReticle({ optic }, 1);
assert(!vm.reticle.visible, 'larger RMR window retains off-axis reticle clipping');
for (const key of ['dotCore', 'dotHalo', 'dotRim', 'dotRing']) {
  vm[key].geometry.dispose();
  vm[key].material.dispose();
}
for (const material of model.materials) material.dispose();
for (const texture of model.textures) texture.dispose();
console.log('M4 F / roster framing, unchanged world zoom and world-sized RMR dot passed');
