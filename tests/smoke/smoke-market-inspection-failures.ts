import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import { MarketInspection } from '../../src/ui/market-inspection.ts';
import { BASE_ATTACHMENTS, type AttachmentConfig } from '../../src/weapons/attachment-rules.ts';
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
  weapons.getAttachments = (): AttachmentConfig => BASE_ATTACHMENTS;
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

  // Reconfiguring the same weapon must reload its clone, not hit the id-only cache.
  const requests: Array<AttachmentConfig | undefined> = [];
  const base = model();
  const redDot = model();
  const configured = fixture(async (_id, config): Promise<TrackedModel> => {
    requests.push(config);
    return config?.optic === 'micro_t2' ? redDot : base;
  });
  configured.reset = MarketInspection.prototype.reset.bind(configured);
  const config = { ...BASE_ATTACHMENTS, optic: 'micro_t2' } as const;
  await configured.select('rifle', 'Rifle', BASE_ATTACHMENTS);
  configured.camera.position.set(2, 1, 1);
  const orbit = configured.camera.position.clone();
  await configured.select('rifle', 'Rifle', config);
  assert.deepEqual(requests, [BASE_ATTACHMENTS, config], 'preview receives the exact draft');
  assert.equal(base.disposed, 1, 'old configured clone is released');
  assert.equal(configured.model, redDot);
  assert(
    configured.camera.position.distanceTo(orbit) < 1e-10,
    'attachment changes preserve inspection angle'
  );
  await configured.select('rifle', 'Rifle', config);
  assert.equal(requests.length, 2, 'unchanged draft does not rebuild');
  await configured.select('rifle', 'Rifle', { ...config });
  assert.equal(requests.length, 2, 'equivalent draft does not rebuild');
  assert.equal(redDot.disposed, 0, 'equivalent draft preserves the current clone');
  configured.weapons.getAttachments = (): AttachmentConfig => ({ ...config });
  await configured.select('rifle', 'Rifle');
  assert.equal(requests.length, 2, 'stored and explicit builds share value-based deduplication');
  configured.weapons.getAttachments = (): AttachmentConfig => BASE_ATTACHMENTS;
  await configured.select('rifle', 'Rifle');
  assert.equal(requests.length, 3, 'omitted config resolves the latest stored build');
  assert.equal(redDot.disposed, 1);
  configured.hide();
  assert.equal(configured.model, null);

  let finish: (value: TrackedModel) => void = (): never => {
    throw Error('not initialized');
  };
  const oldConfig = model();
  const newConfig = model();
  const racing = fixture((_id, value): Promise<TrackedModel> =>
    value === BASE_ATTACHMENTS
      ? new Promise((resolve): void => {
          finish = resolve;
        })
      : Promise.resolve(newConfig)
  );
  let resets = 0;
  racing.reset = (): void => {
    resets++;
  };
  const oldRequest = racing.select('rifle', 'Rifle', BASE_ATTACHMENTS);
  await Promise.resolve();
  await racing.select('rifle', 'Rifle', config);
  finish(oldConfig);
  await oldRequest;
  assert.equal(oldConfig.disposed, 1, 'late same-weapon draft is released');
  assert.equal(racing.model, newConfig, 'late draft cannot overwrite the latest config');
  assert.equal(resets, 1, 'rapid edits before the first clone loads still frame the weapon');
  const closedModel = model();
  const closedRequest = racing.select('rifle', 'Rifle', BASE_ATTACHMENTS);
  await Promise.resolve();
  racing.hide();
  finish(closedModel);
  await closedRequest;
  assert.equal(closedModel.disposed, 1, 'closing releases a late preview');
  assert.equal(racing.model, null, 'closed market cannot recreate previews');

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
