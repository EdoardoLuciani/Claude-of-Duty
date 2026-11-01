import assert from 'node:assert/strict';

import { PixiCombat } from '../../src/ui/pixi-combat.ts';

const models = {
  hit: {
    visuals: Array.from({ length: 10 }, () => ({})),
    pool: { items: Array.from({ length: 10 }, () => ({ alive: false })) },
  },
  arcs: {
    visuals: Array.from({ length: 6 }, () => ({})),
    pool: { items: Array.from({ length: 6 }, () => ({ alive: false })) },
  },
  ammo: {
    equipment: [
      { count: 2, active: false, alpha: 0.9 },
      { count: 3, active: false, alpha: 0.9 },
    ],
  },
  fpsText: '60 FPS',
};
// The operator chose the simple icons; original/text modes are retired.
const view = new PixiCombat();
for (const slot of view.slots) Object.defineProperty(slot.node, 'width', { get: () => 30 }); // real font/layout checked in browser
const geometry = view.slots.map((s) => s.symbol.context.instructions);
assert.equal(view.slots.filter((s) => s.symbol).length, 2);
assert.equal(view.slots.length, 2, 'radio inventory indicator is removed, not hidden');
view.update(models);
assert.deepEqual(
  view.slots.map((s) => s.label.text),
  ['2', '3']
);
assert.equal(view.update(models), false, 'unchanged paused icons must not redraw');
models.ammo.equipment[0] = { count: 0, active: false, alpha: 0.34 };
models.ammo.equipment[1] = { count: 12, active: true, alpha: 0.6 };
assert(view.update(models));
assert.equal(view.slots[0].node.alpha, 0.34);
assert.equal(view.slots[1].node.alpha, 0.6);
assert.equal(view.slots[1].label.tint, 0xffb02a);
{
  assert.equal(view.slots[1].symbol.tint, 0xffb02a);
  assert.equal(view.slots[0].symbol.tint, 0xffffff);
  assert.equal(
    view.slots[0].symbol.context.instructions,
    geometry[0],
    'no geometry rebuild on stock/state changes'
  );
  assert.equal(view.slots[1].symbol.context.instructions, geometry[1]);
  assert.equal(geometry[0].length, 2);
  assert.equal(geometry[1].length, 2);
}
view.hits.destroy({ children: true });
view.arcs.destroy({ children: true });
view.equipment.destroy({ children: true });
view.fps.destroy();
models.ammo.equipment[0] = { count: 2, active: false, alpha: 0.9 };
models.ammo.equipment[1] = { count: 3, active: false, alpha: 0.9 };
console.log(
  'ok chosen accessory silhouettes: counts/empty/active/pause, retained geometry, no comparison mode or radio inventory slot'
);
