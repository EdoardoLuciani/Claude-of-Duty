import assert from 'node:assert/strict';

import { AmmoPanel } from '../../src/ui/ammo.ts';
import { PixiAmmoView } from '../../src/ui/pixi-ammo-view.ts';
import { PixiCombat } from '../../src/ui/pixi-combat.ts';
import { PixiCompass } from '../../src/ui/pixi-compass.ts';

const compass = new PixiCompass();
assert.equal(compass.ticks.length, 24);
assert.equal(compass.labels.length, 8);
const model = {
  heading: 359,
  pings: Array.from({ length: 8 }, () => ({ x: 0, alpha: 1 })),
  pingPool: { items: Array.from({ length: 8 }, () => ({ alive: false })) },
};
assert(compass.update(model));
const north = compass.labels.find((l) => l.bearing === 0).node;
assert(Math.abs(north.x - (235 + 470 / 120)) < 1e-8, 'north remains adjacent across 360');
assert.equal(compass.update(model), false, 'unchanged compass does not invalidate');
model.heading = 1;
compass.update(model);
assert(Math.abs(north.x - (235 - 470 / 120)) < 1e-8);
model.pingPool.items[0].alive = true;
model.pings[0].x = 25;
assert(compass.update(model));
assert.equal(compass.pings[0].x, 260);

const magazine = new PixiAmmoView();
assert.equal(magazine.stage.children.length, 9, 'two magazine-bar graphics instead of thirty pips');
magazine.update(1 / 60, { ammo: 15, magSize: 30, reserve: 90, weaponName: 'M4A1' });
assert.equal(magazine.magFill.scale.x, 0.5);
assert.equal(magazine.current.text, '15');
assert.equal(magazine.reserve.text, '/ 90');
magazine.stage.destroy({ children: true });

const combat = new PixiCombat();
for (const slot of combat.slots)
  assert.equal('symbol' in slot, false, 'accessories use compact text, not vector icons');
assert.equal(combat.hitSlots.length, 10);
for (const slot of combat.hitSlots) {
  assert.equal(slot.node.children.length, 2, 'one common X plus ring, not four shape variants');
  assert.equal(slot.mark.context.instructions.length, 2, 'backing and main stroke only');
  assert.equal(slot.kind, null);
}
assert.equal(combat.arcSlots.length, 6);
for (const arc of combat.arcSlots)
  assert.equal(arc.context.instructions.length, 2, 'single arc with backing');
combat.hits.destroy({ children: true });
combat.arcs.destroy({ children: true });
combat.equipment.destroy({ children: true });
combat.fps.destroy();
compass.stage.destroy({ children: true });

const old = globalThis.document;
try {
  const make = () => ({
    style: { setProperty() {} },
    classList: { toggle() {} },
    appendChild() {},
    setAttribute() {},
    textContent: '',
  });
  globalThis.document = { createElement: make, createElementNS: make };
  const ammo = new AmmoPanel(make());
  ammo.presentEquipment = ammo.presentReadout = false;
  const s = { ammo: 10, reserve: 20, magSize: 30, bandages: 2, healing: true };
  ammo.update(0, s, 0);
  assert.equal(ammo.equipment[0].alpha, 0.35);
  ammo.update(0, s, 0.14);
  assert(Math.abs(ammo.equipment[0].alpha - 0.675) < 1e-12);
  ammo.update(0, s, 0.14);
  assert.equal(ammo.equipment[0].alpha, 1);
  ammo.update(0, s, 0.28);
  assert.equal(ammo.equipment[0].alpha, 0.35);
  s.healing = false;
  s.bandages = 0;
  ammo.update(0, s, 1);
  assert.equal(ammo.equipment[0].alpha, 0.34);
  s.bandages = 2;
  ammo.update(0, s, 1);
  assert.equal(ammo.equipment[0].alpha, 0.9);
  s.healing = true;
  ammo.update(0, s, 1);
  assert.equal(ammo.equipment[0].elapsed, 0, 'activation resets phase');
} finally {
  if (old === undefined) delete globalThis.document;
  else globalThis.document = old;
}
console.log(
  'ok simplified Pixi: sparse north-wrap compass, common X, outlined arcs, pulse period/range/reset/unscaled pause'
);
