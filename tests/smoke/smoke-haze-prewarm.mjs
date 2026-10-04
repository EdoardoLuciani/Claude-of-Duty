import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HazeSystem } from '../../src/fx/haze.js';
const geometry = new THREE.PlaneGeometry(); geometry.setDrawRange(2, 9); geometry.instanceCount = 7;
const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material); mesh.visible = false;
const scene = new THREE.Scene(); scene.add(mesh);
const camera = new THREE.PerspectiveCamera(), target = {}, original = {};
const haze = Object.assign(Object.create(HazeSystem.prototype), { rt: target, scene, layer: { mesh, geometry }, _live: false });
let current = original, alpha = .4, fail = false, draws = 0;
const color = new THREE.Color(.1, .2, .3), saved = color.clone();
const renderer = {
  getRenderTarget: () => current, setRenderTarget: value => { current = value; },
  getClearColor: out => out.copy(color), getClearAlpha: () => alpha,
  setClearColor: (value, a = alpha) => { color.set(value); alpha = a; }, clear() {},
  render(s, c) {
    draws++; assert.equal(current, target); assert.equal(s, scene); assert.equal(c, camera);
    assert.equal(geometry.drawRange.count, 0); assert.equal(geometry.instanceCount, 1);
    assert.equal(mesh.visible, true);
    if (fail) throw new Error('intentional haze warm failure');
  },
};
for (const bad of [false, true]) {
  fail = bad;
  const result = await haze.prewarm(renderer, camera);
  assert.equal(result.ok, !bad);
  if (bad) assert.match(result.error, /intentional haze warm failure/);
  assert.equal(current, original); assert.deepEqual(color, saved); assert.equal(alpha, .4);
  assert.deepEqual(geometry.drawRange, { start: 2, count: 9 }); assert.equal(geometry.instanceCount, 7);
  assert.equal(mesh.visible, false); assert.equal(haze._live, false);
}
assert.equal(draws, 2); geometry.dispose(); material.dispose();
console.log('haze native zero-range warmup and failure restoration passed');
