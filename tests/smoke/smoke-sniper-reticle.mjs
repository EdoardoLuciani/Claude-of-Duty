import assert from 'node:assert/strict';

import { SNIPER_RETICLE, sniperMradScale } from '../../src/weapons/sniper-reticle.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';

const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10);
const scale = sniperMradScale(20);
near(scale, 0.001 / Math.tan(Math.PI / 18));
near(sniperMradScale(20, 2), scale * 2);
assert(sniperMradScale(10) > scale, 'angular graduations grow with magnification');
assert.equal(SNIPER_RETICLE.majorMrad, 5, 'game adaptation must not claim 1-mrad ticks');
assert.equal(SNIPER_RETICLE.minorMrad, SNIPER_RETICLE.majorMrad / 2);

// Project a true angular offset: x/y pixel spacing must agree at every aspect.
for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
  [2560, 1080],
]) {
  const mrad = SNIPER_RETICLE.majorMrad;
  const xPixels = (((scale * mrad) / (width / height)) * width) / 2;
  const yPixels = (scale * mrad * height) / 2;
  near(xPixels, yPixels);
  const exactRayPixels = (Math.tan(mrad / 1000) * height) / (2 * Math.tan(Math.PI / 18));
  assert(Math.abs(xPixels - exactRayPixels) < 0.001, 'small-angle error below 0.001 px');
}

const uniforms = (names) => Object.fromEntries(names.map((name) => [name, { value: -1 }]));
const vm = Object.create(Viewmodel.prototype);
vm.ctx = { camera: { fov: 20, zoom: 1 }, viewCamera: { aspect: 16 / 9 } };
vm.scopeOverlay = {};
vm.scopeMask = {};
vm.scopeReticle = {};
vm.armL = { root: {} };
vm.armR = { root: {} };
vm.maskUniforms = uniforms(['uAlpha', 'uAspect', 'uSniper']);
vm.reticleUniforms = uniforms(['uAlpha', 'uAspect', 'uChevron', 'uMradScale']);
const sniper = { optic: { kind: 'scope', reticle: 'p4fl' }, group: {} };
vm.active = sniper;
vm._updateScope(sniper, 1);
assert.equal(vm.scopeOverlay.visible, true);
assert.equal(vm.maskUniforms.uSniper.value, 1);
assert.equal(vm.reticleUniforms.uChevron.value, 0);
near(vm.reticleUniforms.uMradScale.value, scale);
assert.equal(sniper.group.visible, false);

vm.ctx.camera.fov = 30;
vm.ctx.camera.zoom = 1.2;
vm.ctx.viewCamera.aspect = 64 / 27;
vm._updateScope(sniper, 1);
near(vm.reticleUniforms.uMradScale.value, sniperMradScale(30, 1.2));
near(vm.maskUniforms.uAspect.value, 64 / 27);
near(vm.reticleUniforms.uAspect.value, 64 / 27);

vm._updateScope(sniper, 0.5);
assert.equal(vm.scopeOverlay.visible, false);
assert.equal(vm.reticleUniforms.uAlpha.value, 0);
assert.equal(sniper.group.visible, true);
vm._grenadeState = 1;
vm._updateScope(sniper, 1);
assert.equal(vm.scopeOverlay.visible, false, 'accessories suppress scope overlay');
vm._grenadeState = 0;

// Holster can change active earlier in the frame: use live optic, not stale arg.
vm.active = { optic: { kind: 'scope', reticle: 'chevron' }, group: {} };
vm._updateScope(sniper, 1);
assert.equal(vm.maskUniforms.uSniper.value, 0, 'MCX retains its original mask');
assert.equal(vm.reticleUniforms.uChevron.value, 1);
vm.active = { optic: { kind: 'dot' }, group: {} };
vm._updateScope(sniper, 1);
assert.equal(vm.scopeOverlay.visible, false);
assert.equal(vm.active.group.visible, true);
console.log('sniper reticle projection, live FOV/aspect and scope transitions passed');
