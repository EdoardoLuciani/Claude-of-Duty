import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { fixture } from './fixture.ts';

class Controls {
  value = 0;
  untouched = 7;
  read(): number {
    return this.value;
  }
}

test('fixture retains its complete target and shares mutable override controls', (): void => {
  const controls = { value: 1 };
  const target = new Controls();
  const installed = fixture(controls, target);
  assert.equal(installed, target);
  assert(installed instanceof Controls);
  assert.equal(installed.untouched, 7);
  assert.equal(installed.read(), 1);
  controls.value = 2;
  assert.equal(installed.read(), 2);
  installed.value = 3;
  assert.equal(controls.value, 3);
});

test('fixture installs accessors lazily and preserves their target receiver', (): void => {
  let reads = 0;
  const target = new Controls();
  const installed = fixture<Controls>(
    {
      get value(): number {
        reads++;
        return this.untouched ?? 0;
      },
    },
    target
  );
  assert.equal(reads, 0);
  assert.equal(installed.value, 7);
  assert.equal(reads, 1);
});

test('complete throwing implementations retain explicit unsupported-operation failures', (): void => {
  const target = {
    value: 1,
    unsupported(): never {
      throw new Error('unsupported operation');
    },
  };
  const installed = fixture({ value: 2 }, target);
  assert.equal(installed.value, 2);
  assert.throws((): never => installed.unsupported(), /unsupported operation/);
});
