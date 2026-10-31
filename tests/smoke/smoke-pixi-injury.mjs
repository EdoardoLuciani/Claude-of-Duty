import assert from 'node:assert/strict';

import { HealthFx } from '../../src/ui/health.ts';

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
} finally {
  if (old === undefined) delete globalThis.document;
  else globalThis.document = old;
}
console.log('ok Pixi injury: shared native/GPU animation-state parity with no hidden DOM writes');
