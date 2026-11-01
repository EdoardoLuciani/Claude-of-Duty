import assert from 'node:assert/strict';

import { AmmoPanel, filledMagazinePips } from '../../src/ui/ammo.ts';
import { PixiAmmoHud } from '../../src/ui/pixi-ammo.ts';

for (const [ammo, mag, reserve, reload, progress, expected] of [
  [30, 30, 90, false, 0, 30],
  [0, 30, 90, false, 0, 0],
  [12, 30, 90, true, 0.45, 0],
  [12, 30, 90, true, 1, 30],
  [0, 6, 3, true, 1, 3],
  [200, 200, 0, false, 0, 30],
])
  assert.equal(filledMagazinePips(ammo, mag, reserve, reload, progress), expected);

const make = () => {
  const classes = new Set(),
    styles = new Map();
  return {
    classes,
    styles,
    textContent: '',
    clientWidth: 100,
    scrollWidth: 80,
    style: {
      setProperty(key, value) {
        styles.set(key, value);
      },
    },
    classList: {
      toggle(key, on) {
        if (on) classes.add(key);
        else classes.delete(key);
      },
    },
    appendChild() {},
    setAttribute() {},
    remove() {},
  };
};
const scale = () => ({
  x: 1,
  set(value) {
    this.x = value;
  },
});
const text = () => ({ text: '', scale: scale(), width: 100, tint: 0xffffff, alpha: 1 });
const oldDocument = globalThis.document;
try {
  globalThis.document = { createElement: make, createElementNS: make };
  const dom = new AmmoPanel(make());
  const gpu = Object.create(PixiAmmoHud.prototype);
  Object.assign(gpu, {
    disposed: false,
    enabled: false,
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
        dom.update(1 / 60, s);
        gpu.update(1 / 60, s);
        assert.equal(gpu.current.text, dom.cur.textContent);
        assert.equal(gpu.reserve.text, `/ ${dom.res.textContent}`);
        assert.equal(gpu.name.text, dom.name.textContent);
        assert.equal(gpu.mode.text, dom.mode.textContent);
        assert.equal(
          gpu.prompt.text,
          dom.reload.styles.get('display') === 'none' ? '' : dom.reload.textContent
        );
        assert.equal(gpu.prompt.alpha, Number(dom.reload.styles.get('opacity')));
        const color = dom.root.classes.has('ow-ammo-empty')
          ? 0xff5145
          : dom.root.classes.has('ow-ammo-low')
            ? 0xffb02a
            : 0xe7f2ef;
        assert.equal(gpu.current.tint, color);
        assert.equal(gpu.current.scale.x, 1, 'simplified number has no decorative shot punch');
        const domFilled = dom.pips.filter(
          (p) => p.styles.get('display') !== 'none' && !p.classes.has('off')
        ).length;
        assert.equal(
          gpu.magFill.scale.x,
          domFilled / Math.min(30, Math.max(1, s.magSize | 0 || 30)),
          'single magazine bar retains the same fill/reload quantity'
        );
        assert.equal(gpu.bar.visible, reloading);
      }
  dom.dispose();
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
console.log(
  'ok Pixi ammo: canonical pips and HTML/Pixi semantic parity across reload/weapon edge cases'
);
