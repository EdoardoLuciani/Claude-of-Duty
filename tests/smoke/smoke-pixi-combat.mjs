import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { AmmoPanel } from '../../src/ui/ammo.ts';
import { Compass } from '../../src/ui/compass.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { Hitmarkers } from '../../src/ui/hitmarkers.ts';
import { UiSystem } from '../../src/ui/index.ts';
// Ignore platform-level floating-point ulps, not animation changes.
const stable = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'number' ? Number(v.toFixed(10)) : v));

const models = {
  hit: new Hitmarkers(),
  arcs: new DamageArcs(),
  compass: new Compass(),
  ammo: new AmmoPanel(),
};
const golden = createHash('sha256'); // 240-frame golden captured at 3cb261b5.
assert.equal(models.ammo.equipment.length, 2);
for (const model of Object.values(models)) assert(!('root' in model));
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
  if (i % 3 === 0) models.hit.spawn(kinds[i % 4]);
  if (i % 8 === 0) models.arcs.spawn(Math.sin(i), Math.cos(i), i / 240);
  if (i % 4 === 0) models.compass.ping(i * 13);
  if (i === 180) {
    models.hit.clear();
    models.arcs.clear();
  }
  models.hit.update(dt);
  models.arcs.update(dt, 1, 0, 0, -1);
  models.compass.update(i * 9 - 720, dt);
  models.ammo.update(dt, s, 1 / 60);
  golden.update(
    stable({
      hit: models.hit.visuals,
      arcs: models.arcs.visuals,
      pings: models.compass.pings,
      heading: models.compass.heading,
      equipment: models.ammo.equipment,
      pools: ['hit', 'arcs'].map((k) => models[k].pool.items.map((x) => [x.alive, x.t])),
    })
  );
  for (const key of ['hit', 'arcs']) assert(models[key].pool.items.every((x) => x.node === null));
}
assert.equal(
  golden.digest('hex'),
  '8d7bca36ce2db659dfcb60df6802114517e3c550a28524cba56b924d7e96e5b3',
  'accepted combat/pooling/compass/equipment trajectory'
);
for (let i = 0; i < 121; i++) {
  models.hit.update(1 / 60);
  models.arcs.update(1 / 60, 1, 0, 0, -1);
  models.compass.update(-1, 1 / 60);
}
assert(models.hit.pool.items.every((x) => !x.alive));
assert(models.arcs.pool.items.every((x) => !x.alive));
assert(models.compass.pingPool.items.every((x) => !x.alive));
assert.equal(models.compass.heading, 359);

const ui = new UiSystem();
ui._updateFps(0);
for (let i = 1; i <= 30; i++) ui._updateFps((i * 1000) / 60);
assert.equal(ui.fpsText, '60 FPS');
assert(!('fps' in ui), 'no native FPS element');
console.log(
  'ok Pixi combat: golden timing/projection/pooling/equipment, expiry/clear/pause/wrap and wall-clock FPS without DOM'
);
