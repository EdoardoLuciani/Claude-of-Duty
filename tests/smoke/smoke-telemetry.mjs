/**
 * Node smoke test for telemetry archives — no browser.
 *
 *   node tests/smoke/smoke-telemetry.mjs
 */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

import {
  TelemetrySystem,
  collectProvenance,
  extractTar,
  hitchVerdict,
  packTgz,
} from '../../src/dev/telemetry.ts';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

// Provenance is the loaded world, not a newly deployed manifest. An older
// session's pending read must not overwrite a restarted recording either.
{
  let resolve;
  const recorder = new TelemetrySystem();
  const meta = {
    sourceHash: 'loaded-A',
    assets: { visual: 'visual-A', collision: 'collision-A', nav: 'nav-A' },
  };
  const models = {
    worldPrefetch: new Promise((r) => {
      resolve = r;
    }),
  };
  recorder.ctx = { get: () => models };
  const first = (recorder.meta = { provenance: { revision: 'code-A', world: 'unknown' } });
  const fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('must not request deployment B');
  };
  try {
    recorder._fillWorldProvenance();
    recorder.meta = { provenance: { revision: 'next-session', world: 'unknown' } };
    resolve({ meta });
    await recorder._provenanceReady;
    assert.equal(first.provenance.world.sourceHash, 'loaded-A');
    assert.equal(first.provenance.world.nav, 'nav-A');
    assert.equal(recorder.meta.provenance.world, 'unknown');
  } finally {
    globalThis.fetch = fetch;
  }
}

// Canonical healing events and live inventory/progress survive recording.
{
  const recorder = new TelemetrySystem();
  const player = {
    health: { value: 40, armour: 0 },
    bandages: 2,
    healCtrl: { active: true, progress: 0.5 },
  };
  const systems = {
    player,
    weapons: {},
    ai: { getWaveState: () => ({}) },
    game: {},
    market: {},
    render: { renderer: { info: { render: {} } } },
  };
  recorder.ctx = {
    time: { elapsed: 0, raw: 0, frame: 1 },
    camera: { position: {}, rotation: {} },
    get: (id) => systems[id],
    input: { action: (name) => name === 'heal', moveVector() {}, look: {} },
  };
  recorder.recording = true;
  recorder.events = [];
  recorder.playerSamples = [];
  recorder._move = {};
  recorder._contacts = new Map();
  recorder._samplePlayer();
  const sample = recorder.playerSamples[0];
  assert.deepEqual(sample.actions, ['heal']);
  assert.deepEqual([sample.bandages, sample.healing, sample.healProgress], [2, true, 0.5]);
  for (const phase of ['start', 'cancel', 'complete'])
    recorder._recordEvent('player:heal', {
      phase,
      amount: phase === 'complete' ? 50 : 0,
      health: 40,
      bandages: 2,
      reason: phase,
    });
  assert.deepEqual(
    recorder.events.map((e) => e.phase),
    ['start', 'cancel', 'complete']
  );
  assert.equal(recorder.events[2].amount, 50);
}

const json = new TextEncoder().encode(
  JSON.stringify({
    schema: 3,
    events: [{ t: 1, type: 'session:start' }],
    markers: [
      {
        t: 2,
        raw: 2,
        frame: 10,
        label: 'manual',
        note: 'enemy stuck behind crate',
        screenshot: 'marks/001.jpg',
        player: [1, 0, 2],
      },
    ],
    playerSamples: [],
    enemySamples: [],
  })
);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

// The adaptive hitch threshold. A machine slower than the 50 ms floor has to raise
// the bar instead of logging every frame — an earlier version fed the baseline
// only from frames under the threshold, so on a 10 fps machine it could never
// move and all 300 frames of a steady stream were logged.
const sim = (frames) => {
  let ema = 16.7;
  let threshold = 0;
  const hitches = [];
  for (const ms of frames) {
    const verdict = hitchVerdict(ema, ms);
    ema = verdict.ema;
    threshold = verdict.threshold;
    if (verdict.hitch) hitches.push(ms);
  }
  return { hitches, threshold: Math.round(threshold) };
};
const steady = (ms, n) => Array(n).fill(ms);
check('60 fps logs only the freeze', sim([...steady(16.7, 300), 2000]).hitches.join() === '2000');
check(
  '10 fps stops logging its own frames',
  sim(steady(100, 300)).hitches.length === 4,
  String(sim(steady(100, 300)).hitches.length)
);
check('10 fps raises its own bar', sim(steady(100, 300)).threshold === 300);
check('10 fps still logs a freeze', sim([...steady(100, 300), 2000]).hitches.at(-1) === 2000);
check('19 fps no longer logs every frame', sim(steady(52.6, 300)).hitches.length === 1);
check('20 fps logs nothing', sim(steady(50, 300)).hitches.length === 0);

const tgz = await packTgz([
  { name: 'telemetry.json', data: json },
  { name: 'marks/001.jpg', data: jpeg },
]);
check('tgz is gzip', tgz[0] === 0x1f && tgz[1] === 0x8b);
const fromGz = extractTar(gunzipSync(tgz));
check('tgz roundtrip json', Buffer.from(fromGz['telemetry.json']).equals(Buffer.from(json)));
check('tgz roundtrip jpeg', Buffer.from(fromGz['marks/001.jpg']).equals(Buffer.from(jpeg)));

check(
  'missing provenance is unknown',
  collectProvenance().revision === 'unknown' && collectProvenance().world === 'unknown'
);
check(
  'missing world source hash is unknown',
  collectProvenance({ world: { visual: 'level-visual.abc.glb.gz' } }).world.sourceHash === 'unknown'
);

if (failures) {
  console.error(`${failures} telemetry smoke checks failed`);
  process.exit(1);
}
console.log('telemetry smoke ok');
