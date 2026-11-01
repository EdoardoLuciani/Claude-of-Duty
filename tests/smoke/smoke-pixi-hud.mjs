import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Crosshair } from '../../src/ui/crosshair.ts';
import { HealthFx } from '../../src/ui/health.ts';
import { PixiMinimap } from '../../src/ui/pixi-minimap.ts';

// Ignore platform-level floating-point ulps, not animation changes.
const stable = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'number' ? Number(v.toFixed(10)) : v));

// Golden trajectory captured at 3cb261b5 before removing native presentation.
const golden = createHash('sha256'),
  native = new Crosshair(),
  domHealth = new HealthFx();
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
    domHealth.onDamage();
    domHealth.onArmour(25);
  }
  native.update(1 / 60, state);
  domHealth.update(1 / 60, state);
  golden.update(
    stable({
      cross: Object.fromEntries(
        [
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
        ].map((k) => [k, native[k]])
      ),
      health: Object.fromEntries(
        ['hpShown', 'hurt', 'beatEnergy', 'armourShown', 'armourFlash', 'flashT'].map((k) => [
          k,
          domHealth[k],
        ])
      ),
    })
  );
}
assert.equal(
  golden.digest('hex'),
  'fb84e0434b8b663c89d5df5b8091e6a3a26b0c7a880ca779cf54b44376f9af0b',
  'accepted crosshair/vitals timing is unchanged'
);
assert(!('root' in native));
assert(!('vitals' in domHealth));
assert(!('bloodWrap' in domHealth));
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
  'ok Pixi HUD: accepted golden timing, no native widgets, retained minimap projection/clipping/fades/objectives/pulses'
);
