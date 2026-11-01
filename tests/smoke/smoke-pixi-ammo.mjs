import assert from 'node:assert/strict';

import { filledMagazinePips } from '../../src/ui/ammo.ts';
import { PixiAmmoView } from '../../src/ui/pixi-ammo-view.ts';

for (const [ammo, mag, reserve, reload, progress, expected] of [
  [30, 30, 90, false, 0, 30],
  [0, 30, 90, false, 0, 0],
  [12, 30, 90, true, 0.45, 0],
  [12, 30, 90, true, 1, 30],
  [0, 6, 3, true, 1, 3],
  [200, 200, 0, false, 0, 30],
])
  assert.equal(filledMagazinePips(ammo, mag, reserve, reload, progress), expected);

const scale = () => ({
  x: 1,
  set(value) {
    this.x = value;
  },
});
const text = () => ({ text: '', scale: scale(), width: 100, tint: 0xffffff, alpha: 1 });
const gpu = Object.create(PixiAmmoView.prototype);
Object.assign(gpu, {
  dirty: true,
  lastAmmo: -1,
  lastReserve: -1,
  lastMode: null,
  current: text(),
  reserve: text(),
  name: text(),
  mode: text(),
  prompt: text(),
  magFill: { scale: scale(), tint: 0xffffff },
  bar: { visible: true },
  fill: { visible: true, scale: scale() },
});
const cases = [
  { ammo: 30, magSize: 30, reserve: 210, weaponName: 'M4A1', fireMode: 'auto' },
  { ammo: 9, magSize: 30, reserve: 1, weaponName: 'Long weapon name to fit', fireMode: 'burst' },
  { ammo: 0, magSize: 30, reserve: 0, weaponName: 'EMPTY', fireMode: 'semi' },
  { ammo: 2, magSize: 6, reserve: 4, weaponName: 'M590', fireMode: 'semi' },
  { ammo: 200, magSize: 200, reserve: 999, weaponName: 'EVOLYS', fireMode: 'auto' },
  { ammo: -1, magSize: 0, reserve: -2, weaponName: 'Invalid inputs clamp safely' },
];
for (const sample of cases)
  for (const reloading of [false, true])
    for (const progress of [0, 0.2, 0.45, 0.7, 1]) {
      const s = Object.freeze({ ...sample, reloading, reloadProgress: progress, time: 1.23 });
      gpu.update(1 / 60, s);
      assert.equal(gpu.current.text, String(Math.max(0, s.ammo | 0)));
      assert.equal(gpu.reserve.text, `/ ${Math.max(0, s.reserve | 0)}`);
      assert.equal(gpu.name.text, s.weaponName);
      assert.equal(gpu.mode.text, (s.fireMode ?? 'auto').toUpperCase());
      assert.equal(
        gpu.prompt.text,
        reloading ? 'RELOADING' : s.ammo <= 0 ? 'PRESS R TO RELOAD' : ''
      );
      assert.equal(
        gpu.prompt.alpha,
        !reloading && s.ammo <= 0
          ? Number((0.55 + 0.45 * Math.abs(Math.sin(s.time * 3.8))).toFixed(3))
          : 1
      );
      const color =
        s.ammo <= 0
          ? 0xff5145
          : s.ammo / Math.max(1, s.magSize | 0 || 30) <= 0.34
            ? 0xffb02a
            : 0xe7f2ef;
      assert.equal(gpu.current.tint, color);
      assert.equal(gpu.current.scale.x, 1, 'simplified number has no decorative shot punch');
      const filled = filledMagazinePips(
        Math.max(0, s.ammo | 0),
        Math.max(1, s.magSize | 0 || 30),
        s.reserve,
        reloading,
        progress
      );
      assert.equal(
        gpu.magFill.scale.x,
        filled / Math.min(30, Math.max(1, s.magSize | 0 || 30)),
        'single magazine bar retains the same fill/reload quantity'
      );
      assert.equal(gpu.bar.visible, reloading);
    }
console.log(
  'ok Pixi ammo: canonical fill and Pixi readout semantics across reload/weapon edge cases'
);
