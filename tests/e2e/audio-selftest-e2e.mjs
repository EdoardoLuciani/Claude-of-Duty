import assert from 'node:assert/strict';

import { AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import { ENVIRONMENT_URLS } from '../../src/audio/environment.ts';
import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { RADIO_URLS } from '../../src/audio/radio.ts';
import { REACTION_URLS } from '../../src/audio/reactions.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';
import {
  ensureViteServer,
  launchChromium,
  REPO_ROOT,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const server = await ensureViteServer({ root: REPO_ROOT, port: 5551 });
assert(server, 'Refusing an occupied self-test server port');
const required =
  50 +
  Object.values(FOLEY_URLS).reduce((n, urls) => n + urls.length, 0) +
  Object.values(RELOAD_URLS).reduce((n, urls) => n + urls.length, 0) +
  (AIRCRAFT_URLS.length +
    Object.values({ ...REACTION_URLS, ...ENVIRONMENT_URLS, ...RADIO_URLS }).reduce(
      (n, urls) => n + urls.length,
      0
    ));
let browser,
  fault = null,
  requests = 0;
const errors = [];
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/private-selftest', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native audio self-test' })
  );
  await page.route('**/*.opus', (route) => {
    requests++;
    if (fault && route.request().url().includes('step-metal-run-2.opus'))
      return route.fulfill({
        status: fault === 'http' ? 404 : 200,
        contentType: 'audio/ogg',
        body: 'invalid recording',
      });
    return route.continue();
  });
  await page.goto('http://127.0.0.1:5551/private-selftest');
  for (fault of [null, 'http', 'decode']) {
    requests = 0;
    const result = await page.evaluate(async () => {
      const [{ runAudioSelfTest }, { WeaponSampleBank }] = await Promise.all([
        import('/src/audio/selftest.ts'),
        import('/src/audio/samples.ts'),
      ]);
      const counts = {},
        kinds = new Set(),
        originals = new Map();
      let retained = [],
        loadedBank;
      for (const method of [
        'load',
        'impact',
        'step',
        'fall',
        'cloth',
        'damage',
        'hit',
        'reload',
        'nextAircraft',
        'radio',
        'environment',
        'reaction',
      ]) {
        const original = WeaponSampleBank.prototype[method];
        originals.set(method, original);
        WeaponSampleBank.prototype[method] = function (...args) {
          counts[method] = (counts[method] ?? 0) + 1;
          if (method === 'hit') kinds.add(args[0]);
          const value = original.apply(this, args);
          if (method === 'load') {
            loadedBank = this;
            retained = [...Object.values(this.hitBuffers), ...Object.values(this.reloadBuffers)];
          }
          return value;
        };
      }
      try {
        const report = await runAudioSelfTest();
        return {
          report,
          counts,
          kinds: [...kinds],
          cacheDisposed:
            Object.keys(loadedBank.hitBuffers).length === 0 &&
            loadedBank.aircraftBuffers.length === 0 &&
            Object.keys(loadedBank.reloadBuffers).length === 0 &&
            retained.every((buffers) => buffers.length === 0),
        };
      } finally {
        for (const [method, original] of originals) WeaponSampleBank.prototype[method] = original;
      }
    });
    assert.equal(requests, required, 'required assets requested exactly once per self-test run');
    assert.equal(result.counts.load, 1);
    assert(result.cacheDisposed, 'run-owned decoded cache disposed');
    if (!fault) {
      assert.equal(result.report.ok, true, JSON.stringify(result.report.failures));
      assert(
        result.report.cases >= 97,
        'all original cases, recorded armour states and aircraft source run'
      );
      assert.equal(result.counts.nextAircraft, 1);
      assert.equal(result.counts.radio, 3);
      assert.equal(result.counts.environment, 7);
      assert.equal(result.counts.reaction, 4);
      assert.deepEqual(result.report.failures, []);
      assert.equal(result.counts.impact, 11);
      assert.equal(result.counts.step, 17);
      assert.equal(result.counts.fall, 1);
      assert.equal(result.counts.cloth, 1);
      assert.equal(result.counts.damage, 5);
      assert.equal(result.counts.reload, Object.keys(RELOAD_URLS).length);
      for (const kind of [
        'flesh',
        'armour',
        'break',
        'gear',
        'splash',
        'cloth',
        'fall-hard',
        'impact-metal',
        'step-glass-run',
      ])
        assert(result.kinds.includes(kind), kind + ': actual recorded source selected');
      for (const name of [
        'impact:flesh',
        'impact:metal',
        'step:water',
        'step:concrete:land',
        'bodyfall',
        'cloth',
        'ui:damage',
        'damage:armour-only',
        'damage:mixed',
        'damage:break-mixed',
        'damage:break-armour-only',
        'aircraft:source',
        'radio:radio_open',
        'radio:radio_strike',
        'radio:intel_call',
        ...['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli'].map(
          (kind) => `ambient:${kind}`
        ),
        'reaction:0:hurt',
        'reaction:0:death',
        'reaction:1:hurt',
        'reaction:1:death',
        ...Object.keys(RELOAD_URLS).map((kind) => `reload:${kind}`),
      ]) {
        const row = result.report.results.find((row) => row.name === name);
        assert(
          row && !row.error && row.rms > 0.00002 && row.peak < 1,
          name + ': finite audible native render'
        );
      }
      console.log(
        `PASS: ${result.report.cases} native self-test cases, recorded methods and one ${required}-file decode cache.`
      );
    } else {
      assert.equal(result.report.ok, false);
      assert.equal(result.report.cases, 1);
      assert.equal(result.report.failures[0].name, 'samples:load');
      assert(result.report.failures[0].error);
      if (fault === 'http')
        assert.match(result.report.failures[0].error, /step-metal-run-2.*HTTP 404/);
      assert.deepEqual(
        Object.keys(result.counts),
        ['load'],
        'failed required assets never render substitute voices'
      );
      console.log(
        `PASS: ${fault} failure returns explicit self-test load failure without synthesis.`
      );
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  stopViteServer(server);
}
