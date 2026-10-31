import assert from 'node:assert/strict';

import { AmmoPanel } from '../../src/ui/ammo.ts';
import { Compass } from '../../src/ui/compass.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { Hitmarkers } from '../../src/ui/hitmarkers.ts';
import { UiSystem } from '../../src/ui/index.ts';

let writes = 0;
const make = () => ({
  style: new Proxy(
    {
      setProperty() {
        writes++;
      },
    },
    {
      set(o, k, v) {
        writes++;
        o[k] = v;
        return true;
      },
    }
  ),
  classList: {
    toggle() {
      writes++;
    },
  },
  appendChild() {},
  remove() {},
  setAttribute() {
    writes++;
  },
  textContent: '',
  scrollWidth: 0,
  clientWidth: 100,
});
const old = globalThis.document;
try {
  globalThis.document = { createElement: make, createElementNS: make };
  const native = {
    hit: new Hitmarkers(make()),
    arcs: new DamageArcs(make()),
    compass: new Compass(make()),
    ammo: new AmmoPanel(make()),
  };
  const gpu = {
    hit: new Hitmarkers(make()),
    arcs: new DamageArcs(make()),
    compass: new Compass(make()),
    ammo: new AmmoPanel(make()),
  };
  gpu.hit.present =
    gpu.arcs.present =
    gpu.compass.present =
    gpu.ammo.presentEquipment =
    gpu.ammo.presentReadout =
      false;
  const kinds = ['hit', 'armour', 'head', 'kill'];
  for (let i = 0; i < 240; i++) {
    const dt = i > 90 && i < 120 ? 0 : 1 / 60;
    const s = {
      ammo: 20,
      reserve: 90,
      magSize: 30,
      bandages: i % 12,
      lethalCount: i % 3,
      carpetCount: i % 2,
      healing: i > 40 && i < 150,
      cooking: i < 30,
      grenadeEquipped: i > 150 && i < 170,
      radioEquipped: i > 190,
    };
    const update = (models) => {
      if (i % 3 === 0) models.hit.spawn(kinds[i % 4]);
      if (i % 8 === 0) models.arcs.spawn(Math.sin(i), Math.cos(i), i / 240);
      if (i % 4 === 0) models.compass.ping(i * 13);
      if (i === 180) {
        models.hit.clear();
        models.arcs.clear();
      }
      models.hit.update(dt);
      models.arcs.update(dt, 1, 0, 0, -1);
      models.compass.update(i * 9 - 720, null, dt);
      models.ammo.update(dt, s, 1 / 60);
    };
    update(native);
    writes = 0;
    update(gpu);
    assert.equal(
      writes,
      0,
      'suppressed combat presenters never mutate DOM, including spawn/release/clear'
    );
    assert.deepEqual(gpu.hit.visuals, native.hit.visuals);
    assert.deepEqual(gpu.arcs.visuals, native.arcs.visuals);
    assert.deepEqual(gpu.compass.pings, native.compass.pings);
    assert.equal(gpu.compass.heading, native.compass.heading);
    assert.deepEqual(gpu.ammo.equipment, native.ammo.equipment);
    for (const key of ['hit', 'arcs'])
      assert.deepEqual(
        gpu[key].pool.items.map((x) => [x.alive, x.t]),
        native[key].pool.items.map((x) => [x.alive, x.t])
      );
  }
  for (let i = 0; i < 121; i++) {
    gpu.hit.update(1 / 60);
    gpu.arcs.update(1 / 60, 1, 0, 0, -1);
    gpu.compass.update(-1, null, 1 / 60);
  }
  assert(gpu.hit.pool.items.every((x) => !x.alive));
  assert(gpu.arcs.pool.items.every((x) => !x.alive));
  assert(gpu.compass.pingPool.items.every((x) => !x.alive));
  assert.equal(gpu.compass.heading, 359);
  const ui = new UiSystem();
  ui.fps = make();
  ui.pixiHud = { gpuCombat: true };
  ui._updateFps(0);
  writes = 0;
  for (let i = 1; i <= 30; i++) ui._updateFps((i * 1000) / 60);
  assert.equal(ui.fpsText, '60 FPS');
  assert.equal(ui.fps.textContent, '');
  assert.equal(writes, 0); // no hidden textContent updates
} finally {
  if (old === undefined) delete globalThis.document;
  else globalThis.document = old;
}
console.log(
  'ok Pixi combat: shared timing/projection/pooling/equipment/FPS parity, no hidden DOM writes, expiry/clear/pause/wrap'
);
