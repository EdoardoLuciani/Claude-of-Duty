import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import * as foley from '../../src/audio/foley.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { runAudioSelfTest } from '../../src/audio/selftest.ts';

assert.deepEqual(
  Object.keys(foley).sort(),
  ['explosion', 'heartbeat', 'intelSiren', 'reloadPhase', 'shellCasing', 'uiSound'],
  'only remaining procedural voices are exported'
);
const source = readFileSync(new URL('../../src/audio/foley.ts', import.meta.url), 'utf8');
for (const obsolete of [
  'IMPACT',
  'STEP',
  'ImpactSpec',
  'StepSpec',
  'ImpactOptions',
  'FootstepOptions',
])
  assert(
    !new RegExp(`\\b${obsolete}\\b`).test(source),
    obsolete + ': obsolete generator data/type removed'
  );
for (const kind of ['damage', 'armour_hit', 'armour_break'])
  assert(!source.includes(`case '${kind}':`), kind + ': old physical sting removed');
assert(source.includes("case 'armour':"), 'intentional armour confirmation remains');

const original = {
  fetch: globalThis.fetch,
  offline: globalThis.OfflineAudioContext,
  dispose: WeaponSampleBank.prototype.dispose,
};
let requests = 0,
  renders = 0,
  disposals = 0;
try {
  globalThis.fetch = async () => {
    requests++;
    return { ok: false, status: 404 };
  };
  globalThis.OfflineAudioContext = class {
    decodeAudioData() {
      assert.fail('failed HTTP response cannot reach decoding');
    }
    startRendering() {
      renders++;
      assert.fail('required load failure cannot render substitutes');
    }
  };
  WeaponSampleBank.prototype.dispose = function () {
    disposals++;
    return original.dispose.call(this);
  };
  const report = await runAudioSelfTest({ verbose: false });
  assert.equal(report.ok, false);
  assert.equal(report.cases, 1);
  assert.equal(report.failures[0].name, 'samples:load');
  assert.match(report.failures[0].error, /HTTP 404/);
  assert.equal(report.results, undefined, 'public verbose option is retained');
  assert.deepEqual(report.spaces, {});
  assert.equal(
    requests,
    50 + Object.values(FOLEY_URLS).reduce((n, urls) => n + urls.length, 0) + AIRCRAFT_URLS.length
  );
  assert.equal(renders, 0);
  assert.equal(disposals, 1, 'failed run disposes its single required bank');
} finally {
  globalThis.fetch = original.fetch;
  if (original.offline === undefined) delete globalThis.OfflineAudioContext;
  else globalThis.OfflineAudioContext = original.offline;
  WeaponSampleBank.prototype.dispose = original.dispose;
}
console.log(
  'Obsolete physical generators removed; self-test required loading fails explicitly without synthesis'
);
