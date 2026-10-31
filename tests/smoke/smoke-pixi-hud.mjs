import assert from 'node:assert/strict';

import { Crosshair } from '../../src/ui/crosshair.ts';
import { HealthFx } from '../../src/ui/health.ts';
import { PixiMinimap } from '../../src/ui/pixi-minimap.ts';

const element = () => ({
  styles: new Map(),
  textContent: '',
  style: {
    setProperty(key, value) {
      this.owner.styles.set(key, value);
    },
  },
  classList: { toggle() {} },
  appendChild() {},
  setAttribute() {},
  remove() {},
});
const make = () => {
  const node = element();
  node.style.owner = node;
  return node;
};
const old = globalThis.document;
try {
  globalThis.document = { createElement: make };
  const native = new Crosshair(make()),
    model = new Crosshair(make());
  const domHealth = new HealthFx(make()),
    gpuHealth = new HealthFx(make());
  for (let i = 0; i < 180; i++) {
    const state = Object.freeze({
      move: (i % 30) / 30,
      ads: i > 70,
      crouch: i < 20,
      airborne: i > 150,
      health: i % 100,
      maxHealth: 100,
      armour: i % 151,
      hurt: 0.4,
      pulse: (i % 9) / 9,
    });
    if (i % 20 === 0) {
      native.onFire();
      model.onFire();
      domHealth.onDamage();
      gpuHealth.onDamage();
      domHealth.onArmour(25);
      gpuHealth.onArmour(25);
    }
    native.update(1 / 60, state);
    model.update(1 / 60, state, false);
    domHealth.update(1 / 60, state);
    gpuHealth.update(1 / 60, state, false);
    for (const key of [
      'kick',
      'kickVel',
      'moveSpread',
      'adsBlend',
      'visible',
      'gap',
      'bladeLength',
      'bladeAlpha',
      'dotScale',
      'dotAlpha',
    ])
      assert.equal(model[key], native[key]);
    for (const key of ['hpShown', 'hurt', 'beatEnergy', 'armourShown', 'armourFlash', 'flashT'])
      assert.equal(gpuHealth[key], domHealth[key]);
  }
  assert.equal(model.blades[0].styles.size, 0, 'hidden native crosshair is not presented');
  assert.equal(gpuHealth.hpFill.styles.size, 0, 'hidden native vitals are not presented');
  assert(gpuHealth.bloodWrap.styles.size > 0, 'native injury overlay remains active');
} finally {
  if (old === undefined) delete globalThis.document;
  else globalThis.document = old;
}

const minimap = new PixiMinimap(),
  map = { baked: null, viewSpan: 60 };
const state = {
  x: 0,
  z: 0,
  heading: 0,
  fov: 80,
  blips: [
    { x: 0, z: 0, kind: 'enemy', fade: 0.4 },
    { x: 1000, z: 0, kind: 'friend' },
  ],
  objectives: [{ x: 1000, z: -1000, label: 'A' }],
  pulses: [{ x: 0, z: 0, y: 4, radius: 12 }],
  playerY: 0,
  pulseTime: 1,
};
assert.equal(minimap.update(map, state), true);
assert.equal(minimap.contacts[0].x, 89);
assert.equal(minimap.contacts[0].alpha, 0.4);
assert.equal(minimap.contacts[1].visible, false);
assert.equal(minimap.objectives[0].node.x, 171);
assert.equal(minimap.objectives[0].node.y, 7);
assert.equal(minimap.pulses[0].text.text, '↑');
assert.equal(minimap.update(map, state), false, 'unchanged paused inputs do not invalidate');
state.heading = 90;
state.x = 5;
state.blips[0].kind = 'friend';
state.pulses[0].y = -4;
assert.equal(minimap.update(map, state), true);
assert.equal(minimap.player.rotation, Math.PI / 2);
assert.equal(minimap.contacts[0].tint, 0x7ec4ff);
assert.equal(minimap.pulses[0].text.text, '↓');
state.blips = [];
state.objectives = [];
state.pulses = [];
minimap.update(map, state);
assert.equal(minimap.contacts[0].visible, false);
assert.equal(minimap.objectives[0].node.visible, false);
assert.equal(minimap.pulses[0].node.visible, false);
minimap.stage.destroy({ children: true });
console.log(
  'ok Pixi HUD: shared native model parity, no duplicate presentation, retained minimap projection/clipping/fades/objectives/pulses'
);
