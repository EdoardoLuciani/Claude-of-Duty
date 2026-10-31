import assert from 'node:assert/strict';

import { PerspectiveCamera, Vector3 } from 'three';

import { HealthFx } from '../../src/ui/health.ts';
import { WorldMarkers, projectMarker } from '../../src/ui/markers.ts';
import { PixiWorldMarkers } from '../../src/ui/pixi-markers.ts';

let writes = 0;
const make = () => ({
  style: new Proxy(
    {
      setProperty() {
        writes++;
      },
    },
    {
      set(target, key, value) {
        if (key !== 'owner') writes++;
        target[key] = value;
        return true;
      },
    }
  ),
  classList: { toggle() {}, add() {} },
  appendChild() {},
  setAttribute() {},
  remove() {},
  textContent: '',
});
const old = globalThis.document;
try {
  globalThis.document = { createElement: make, createElementNS: make };
  const native = new HealthFx(make()),
    gpu = new HealthFx(make());
  for (let i = 0; i < 180; i++) {
    const state = {
      health: i < 90 ? 20 : 100,
      hurt: i < 90 ? 0.8 : 0,
      pulse: (i % 10) / 10,
      healing: i > 60 && i < 120,
      healProgress: i / 180,
    };
    if (i % 30 === 0) {
      native.onDamage(0.7);
      gpu.onDamage(0.7);
    }
    native.update(1 / 60, state);
    writes = 0;
    gpu.update(1 / 60, state, false, false);
    assert.equal(writes, 0, 'GPU injury/vitals model does not mutate DOM');
    for (const key of [
      'hurt',
      'hpShown',
      'beatEnergy',
      'flashT',
      'bloodAlpha',
      'bloodScale',
      'beatAlpha',
      'flashAlpha',
    ])
      assert.equal(gpu[key], native[key]);
  }
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  camera.updateMatrixWorld();
  const model = new WorldMarkers(make()),
    html = new WorldMarkers(make()),
    view = new PixiWorldMarkers();
  const objectives = [
    { position: new Vector3(0, 0, -10), label: 'A', name: 'CACHE' },
    { position: new Vector3(100, 0, -10), label: 'B', name: 'SIDE' },
    { position: new Vector3(-40, 0, 5), label: 'C', name: 'BEHIND' },
    { position: new Vector3(0, 0, -200), label: 'D', name: 'FAR' },
  ];
  html.updateObjectives(objectives, camera, 800, 600, 1);
  writes = 0;
  model.updateObjectives(objectives, camera, 800, 600, 1, false);
  assert.equal(writes, 0);
  assert.deepEqual(model.objectives, html.objectives);
  assert.equal(model.objectives[0].distance, '10M');
  assert.equal(model.objectives[0].edge, false);
  assert.equal(model.objectives[1].x, 726);
  assert.equal(model.objectives[2].edge, true);
  assert(model.objectives[3].alpha < model.objectives[0].alpha);
  assert.equal(view.update(model, 1), true);
  assert.equal(view.objectives[0].letter.text, 'A');
  assert.equal(view.objectives[1].arrow.visible, true);
  assert.equal(view.objectives[1].letter.visible, false);
  assert.equal(view.update(model, 1), false, 'static paused marker view does not invalidate');
  const behind = { ...projectMarker(new Vector3(40, 0, 5), camera, 800, 600, 74) };
  assert(behind.behind && behind.offscreen && behind.x > 400);
  const callerPosition = new Vector3(1, 0, -5);
  writes = 0;
  const grenade = model.spawnGrenade(callerPosition, 2.4);
  assert.equal(writes, 0);
  callerPosition.x = 100;
  assert.equal(grenade.position.x, 1, 'caller scratch position is copied');
  html.spawnGrenade(new Vector3(1, 0, -5), 2.4);
  html.updateGrenades(0.2, camera, 800, 600, 1);
  writes = 0;
  model.updateGrenades(0.2, camera, 800, 600, 1, false);
  assert.equal(writes, 0);
  assert.deepEqual(model.grenades, html.grenades);
  assert.equal(grenade.label, 'DANGER CLOSE');
  view.update(model, 1);
  assert.equal(view.grenades[0].text.text, 'DANGER CLOSE');
  const age = grenade.t;
  model.updateGrenades(0, camera, 800, 600, 1, false);
  assert.equal(grenade.t, age);
  model.updateGrenades(3, camera, 800, 600, 1, false);
  view.update(model, 1);
  assert.equal(view.grenades[0].root.visible, false);
  for (let i = 0; i < 4; i++) model.spawnGrenade(new Vector3(i, 0, -10), 2);
  model.updateGrenades(0.5, camera, 800, 600, 1, false);
  const oldest = model.grenades[model.nextGrenade];
  assert.equal(model.spawnGrenade(new Vector3(8, 0, -10), 1), oldest, 'bounded oldest-first reuse');
  writes = 0;
  model.clear(false);
  model.updateObjectives([], camera, 800, 600, 1, false);
  assert.equal(writes, 0);
  view.update(model, 1);
  assert(view.grenades.every((g) => !g.root.visible));
  assert(view.objectives.every((o) => !o.root.visible));
  view.stage.destroy({ children: true });
  model.dispose();
  html.dispose();
} finally {
  if (old === undefined) delete globalThis.document;
  else globalThis.document = old;
}
console.log(
  'ok Pixi underlays: injury model parity/no DOM writes, native/GPU projection and grenade state parity, clipping/fades/lifetime/pooling/pause/clear'
);
