import assert from 'node:assert/strict';

import { PixiAmmoView } from '../../src/ui/pixi-ammo-view.ts';
import { PixiCombat } from '../../src/ui/pixi-combat.ts';
import { PixiMinimap } from '../../src/ui/pixi-minimap.ts';
import { HUD_TYPE } from '../../src/ui/pixi-type.ts';

const view = new PixiMinimap(),
  map = { baked: null, viewSpan: 60 };
const state = {
  x: 0,
  z: 0,
  heading: 0,
  fov: 80,
  blips: [
    { x: 0, z: 0, kind: 'enemy', fade: 1 },
    { x: 1, z: 1, kind: 'friend', fade: 1 },
  ],
  pulses: [{ x: 0, z: 0, y: 5, radius: 12 }],
  playerY: 0,
  pulseTime: 0,
};
view.update(map, state);
const cone = view.cone.context.instructions,
  ring = view.pulses[0].ring.context.instructions;
assert.equal(cone.length, 1);
for (const fov of [50, 60, 80, 100]) {
  state.fov = fov;
  state.pulses[0].radius = fov / 5;
  view.update(map, state);
  assert.equal(
    view.cone.context.instructions,
    cone,
    'FOV changes transform, never rebuild geometry'
  );
  assert.equal(
    view.pulses[0].ring.context.instructions,
    ring,
    'search radius changes scale, never rebuild geometry'
  );
  assert(Math.abs(view.cone.scale.x - Math.sin((fov * Math.PI) / 360) * 178 * 0.42) < 1e-9);
  assert(Math.abs(view.pulses[0].ring.scale.x - ((fov / 5) * 178) / 60) < 1e-9);
  assert.equal(view.pulses[0].text.text, '↑');
}
state.blips.length = 1;
view.update(map, state);
assert(!view.contacts[1].visible);
state.blips = [];
state.pulses = [];
view.update(map, state);
assert(view.contacts.every((n) => !n.visible));
assert(!view.pulses[0].node.visible);
assert.equal(view.update(map, state), false, 'unchanged paused map does not invalidate');
view.stage.destroy({ children: true });

const ammo = new PixiAmmoView(),
  combat = new PixiCombat();
assert.equal(ammo.current.style.fontSize, HUD_TYPE.value);
assert.equal(ammo.reserve.style.fontSize, HUD_TYPE.secondary);
for (const label of [ammo.name, ammo.mode, ammo.prompt])
  assert.equal(label.style.fontSize, HUD_TYPE.label);
assert(combat.slots.every((s) => s.label.style.fontSize === HUD_TYPE.secondary));
assert.equal(ammo.current.anchor.y, 1);
assert.equal(ammo.reserve.anchor.y, 1);
assert.equal(ammo.current.y, ammo.reserve.y);
ammo.stage.destroy({ children: true });
combat.hits.destroy({ children: true });
combat.arcs.destroy({ children: true });
combat.equipment.destroy({ children: true });
combat.fps.destroy();
console.log(
  'ok minimap: retained FOV/search geometry, contact tails, tactical height/fades/pause; shared numeric/label typography'
);
