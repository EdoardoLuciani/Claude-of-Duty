import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import { MarketInspection } from '../../src/ui/market-inspection.ts';

// Exercise selection/lifetime behavior without requiring a DOM or GPU.
function fixture(createInspectionModel) {
  return Object.assign(Object.create(MarketInspection.prototype), {
    active: true,
    activeId: null,
    disposed: false,
    failed: false,
    revision: 0,
    ready: Promise.resolve(),
    model: null,
    image: null,
    title: {},
    status: {},
    canvas: { hidden: true, clientWidth: 100, clientHeight: 100 },
    threeControls: { hidden: true },
    controls: { enabled: false },
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    framing: new THREE.Box3(),
    renderer: { setSize() {}, render() {} },
    weapons: { createInspectionModel },
    reset() {},
  });
}
function model() {
  const scene = new THREE.Group();
  return {
    scene,
    disposed: 0,
    dispose() {
      this.disposed++;
      scene.removeFromParent();
    },
  };
}

const warn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args);
try {
  const missing = new Error('missing rifle');
  const pistol = model();
  const preview = fixture(async (id) => {
    if (id === 'rifle') throw missing;
    return pistol;
  });
  await preview.select('rifle', 'Rifle');
  assert.equal(preview.failed, false, 'model failure does not poison the renderer');
  assert.equal(preview.model, null);
  assert.equal(preview.controls.enabled, false);
  assert.equal(preview.threeControls.hidden, true);
  assert.match(preview.status.textContent, /Select another item/);
  assert.equal(warnings.at(-1)[1], missing, 'preserve the original diagnostic');
  await preview.select('pistol', 'Pistol');
  assert.equal(preview.model, pistol, 'another weapon still renders');
  assert.equal(preview.canvas.hidden, false);
  assert.equal(preview.controls.enabled, true);
  preview.hide();
  assert.equal(pistol.disposed, 1);

  let reject;
  const current = model();
  const stale = fixture((id) =>
    id === 'rifle'
      ? new Promise((_, fail) => {
          reject = fail;
        })
      : Promise.resolve(current)
  );
  const pending = stale.select('rifle', 'Rifle');
  await Promise.resolve();
  await stale.select('pistol', 'Pistol');
  reject(missing);
  await pending;
  assert.equal(stale.model, current, 'late model failure cannot clear a newer selection');
  assert.equal(current.disposed, 0);
  assert.equal(stale.failed, false);

  const broken = fixture(async () => {
    throw Error('must not load after renderer failure');
  });
  const gpuError = new Error('adapter unavailable');
  broken.ready = Promise.reject(gpuError);
  await broken.select('rifle', 'Rifle');
  assert.equal(broken.failed, true, 'renderer initialization failure is terminal');
  assert.equal(warnings.at(-1)[1], gpuError);
  await broken.select('pistol', 'Pistol');
  assert.equal(broken.model, null);
  assert.match(broken.status.textContent, /3D preview unavailable/);
} finally {
  console.warn = warn;
}
console.log('Market model failures remain local; renderer failures remain terminal.');
