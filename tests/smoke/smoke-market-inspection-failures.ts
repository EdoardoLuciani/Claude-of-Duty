import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import { MarketInspection } from '../../src/ui/market-inspection.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { installUiDocument } from '../lib/ui-fixture.ts';

installUiDocument();
type InspectionModel = Awaited<ReturnType<WeaponSystem['createInspectionModel']>>;
interface TrackedModel extends InspectionModel {
  disposed: number;
}

// Real controllers/scenes; only GPU work and asset loading are fixture overrides.
function fixture(createInspectionModel: WeaponSystem['createInspectionModel']): MarketInspection {
  const weapons = new WeaponSystem();
  weapons.createInspectionModel = createInspectionModel;
  const preview = new MarketInspection(document.createElement('div'), weapons);
  preview.active = true;
  preview.ready = Promise.resolve();
  const renderer = new THREE.Renderer(new THREE.WebGPUBackend({ canvas: preview.canvas }));
  renderer.setSize = (): void => {};
  renderer.render = (): void => {};
  preview.renderer = renderer;
  preview.reset = (): void => {};
  return preview;
}
function model(): TrackedModel {
  const scene = new THREE.Group();
  return {
    scene,
    disposed: 0,
    dispose(): void {
      this.disposed++;
      scene.removeFromParent();
    },
  };
}

const warn = console.warn;
const warnings: unknown[][] = [];
console.warn = (...args: unknown[]): void => {
  warnings.push(args);
};
try {
  const missing = new Error('missing rifle');
  const pistol = model();
  const preview = fixture(async (id): Promise<TrackedModel> => {
    if (id === 'rifle') throw missing;
    return pistol;
  });
  await preview.select('rifle', 'Rifle');
  assert.equal(preview.failed, false, 'model failure does not poison the renderer');
  assert.equal(preview.model, null);
  assert.equal(preview.controls.enabled, false);
  assert.equal(preview.threeControls.hidden, true);
  assert.match(preview.status.textContent ?? '', /Select another item/);
  assert.equal(warnings.at(-1)?.[1], missing, 'preserve the original diagnostic');
  await preview.select('pistol', 'Pistol');
  assert.equal(preview.model, pistol, 'another weapon still renders');
  assert.equal(preview.canvas.hidden, false);
  assert.equal(preview.controls.enabled, true);
  preview.hide();
  assert.equal(pistol.disposed, 1);

  let reject: (error: Error) => void = (): never => {
    throw Error('rejection not initialized');
  };
  const current = model();
  const stale = fixture((id): Promise<{ scene: THREE.Group; dispose(): void }> =>
    id === 'rifle'
      ? new Promise((_, fail): void => {
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

  const broken = fixture(async (): Promise<never> => {
    throw Error('must not load after renderer failure');
  });
  const gpuError = new Error('adapter unavailable');
  broken.ready = Promise.reject(gpuError);
  await broken.select('rifle', 'Rifle');
  assert.equal(broken.failed, true, 'renderer initialization failure is terminal');
  assert.equal(warnings.at(-1)?.[1], gpuError);
  await broken.select('pistol', 'Pistol');
  assert.equal(broken.model, null);
  assert.match(broken.status.textContent ?? '', /3D preview unavailable/);
} finally {
  console.warn = warn;
}
console.log('Market model failures remain local; renderer failures remain terminal.');
