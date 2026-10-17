import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mutateSource } from '../../tools/lib/source-mutation.mjs';

const marker = 'this.viewmodel.radio, this.viewmodel.grenade,';
const source = readFileSync(new URL('../../src/weapons/index.ts', import.meta.url), 'utf8');
const mutated = mutateSource(source, marker, 'this.viewmodel.radio,');
assert.notEqual(mutated, source);
assert.equal(
  (mutated.match(/this\.viewmodel\.grenade,/g) ?? []).length,
  (source.match(/this\.viewmodel\.grenade,/g) ?? []).length - 1
);
for (const whitespace of [' ', '\n  ', '\r\n\t'])
  assert.equal(mutateSource('a.b,' + whitespace + 'c.d,', 'a.b, c.d,', 'a.b,'), 'a.b,');
assert.throws(() => mutateSource('aXb, cXd,', 'a.b, c.d,', ''), /must match/);
assert.throws(() => mutateSource('missing', marker, ''), /must match/);
assert.throws(() => mutateSource('same', 'same', 'same'), /must alter/);
console.log('source mutation: formatting-safe, literal, matched and effective controls');
