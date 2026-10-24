import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { FALL_BANK, FOLEY_MIX, IMPACT_BANK, STEP_BANK } from '../../src/audio/physical.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/foley/provenance.json' with { type: 'json' };
import { Rng } from '../../src/core/rng.ts';

let totalBytes = 0,
  decodedBytes = 0;
for (const [kind, urls] of Object.entries(FOLEY_URLS)) {
  assert(urls.length >= 3, kind + ': genuine crop/take variants');
  const cuts = new Set();
  for (const url of urls) {
    const bytes = readFileSync(new URL(url));
    const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
    const file = provenance.files[name];
    assert(file, name + ': provenance');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert(provenance.sources[file.source]?.sha256);
    assert(file.duration >= 0.2 && file.duration <= 0.8);
    assert(file.decodedPeak < 0.5 && file.downmixLossDb > -6);
    const head = bytes.indexOf('OpusHead');
    assert(head >= 0);
    assert.equal(bytes[head + 9], 1, 'mono source, stereo spatial playback');
    assert.equal(bytes.readInt16LE(head + 16), 0, 'no hidden codec gain');
    cuts.add(file.source + ':' + file.start);
    totalBytes += bytes.length;
    decodedBytes += file.duration * 48000 * 4;
  }
  assert.equal(cuts.size, urls.length, kind + ': no microphone duplicates or pitch-only variants');
}
assert.equal(Object.keys(provenance.files).length, 123);
assert(totalBytes < 700000 && decodedBytes < 9000000, 'bounded authored delivery/decoded bank');

const sources = [];
const actx = {
  currentTime: 3,
  createGain: () => ({
    gain: { value: 0 },
    connect(target) {
      this.target = target;
    },
  }),
  createBufferSource() {
    const node = {
      playbackRate: { value: 1 },
      connect(target) {
        this.target = target;
      },
      start(when) {
        this.when = when;
      },
    };
    sources.push(node);
    return node;
  },
};
const rng = new Rng(473);
const bank = new WeaponSampleBank(actx);
for (const [kind, urls] of Object.entries(FOLEY_URLS))
  bank.hitBuffers[kind] = urls.map((url, index) => ({
    kind,
    index,
    duration:
      provenance.files[new URL(url).pathname.split('/').at(-1).replace('.opus', '')].duration,
  }));
for (const kind of Object.keys(FOLEY_URLS)) {
  let previous = -1;
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const voice = bank.hit(kind, rng, { when: 5 });
    const source = sources.at(-1);
    assert.notEqual(source.buffer.index, previous, kind + ': no immediate repeats');
    previous = source.buffer.index;
    seen.add(previous);
    assert(source.playbackRate.value >= 0.98 && source.playbackRate.value <= 1.02);
    assert.equal(source.when, 5);
    assert.equal(voice.end, 5 + source.buffer.duration / source.playbackRate.value + 0.02);
  }
  assert.equal(seen.size, FOLEY_URLS[kind].length);
}
for (const surface of Object.keys(IMPACT_BANK)) {
  const voice = bank.impact(rng, { when: 6, surface, level: 1.2 });
  assert.equal(sources.at(-1).buffer.kind, IMPACT_BANK[surface]);
  assert.equal(voice.send, FOLEY_MIX.impactSend);
}
bank.impact(rng, { surface: 'unlabelled' });
assert.equal(sources.at(-1).buffer.kind, 'impact-concrete');
for (const surface of Object.keys(STEP_BANK))
  for (const gait of ['walk', 'run', 'sprint', 'crouch', 'land']) {
    const before = sources.length;
    const voice = bank.step(rng, { when: 8, surface, gait, level: 0.7 });
    const added = sources.slice(before);
    assert.equal(
      added[0].buffer.kind,
      STEP_BANK[surface][['run', 'sprint', 'land'].includes(gait) ? 'run' : 'walk']
    );
    assert.deepEqual(
      added.map((s) => s.buffer.kind),
      [added[0].buffer.kind, ...(surface === 'water' ? ['splash'] : []), 'gear']
    );
    assert(
      added.every((s) => s.when === 8),
      'single clock for boot/gear/water'
    );
    assert.equal(voice.node.gain.value, 0.7 * FOLEY_MIX.gait[gait] * FOLEY_MIX.step);
    assert.equal(
      voice.end,
      Math.max(...added.map((s) => 8 + s.buffer.duration / s.playbackRate.value + 0.02))
    );
    assert.equal(voice.send, FOLEY_MIX.stepSend);
  }
let before = sources.length;
bank.step(rng, { gait: 'walk', gear: 0 });
assert.equal(sources.length - before, 1, 'explicit zero gear is respected');
for (const [surface, kind] of Object.entries(FALL_BANK)) {
  assert.equal(bank.fall(rng, { surface }).send, FOLEY_MIX.fallSend);
  assert.equal(sources.at(-1).buffer.kind, kind);
}
assert.equal(bank.cloth(rng).send, FOLEY_MIX.clothSend);
assert.equal(sources.at(-1).buffer.kind, 'cloth');

const audio = new AudioSystem(),
  calls = [];
const player = { isPlayer: true };
const raycasts = [];
const physics = {
  MASK: { WORLD: 1 },
  raycast(...args) {
    raycasts.push(args);
    return { hit: true, surface: 'wood' };
  },
};
Object.assign(audio, {
  running: true,
  samples: bank,
  rng,
  ctx: { peek: (id) => (id === 'player' ? player : id === 'physics' ? physics : null) },
  field: {
    listenerPos: { x: 0, y: 1.6, z: 0 },
    distanceTo: (x, y, z) => Math.hypot(x, y - 1.6, z),
  },
});
audio._playAt = (...args) => calls.push(['spatial', ...args]);
audio._playDry = (...args) => calls.push(['dry', ...args]);
audio.bark = (...args) => calls.push(['bark', ...args]);
const impact = {
  point: { x: 2, y: 1, z: 0 },
  damage: 30,
  surface: 'metal',
  shooter: player,
  actor: null,
  shot: 12,
};
audio._budget.impact = 0;
audio._onImpact(impact);
assert.equal(calls.length, 1, 'nearby own wall hit never invents a near miss');
audio._onImpact({ ...impact, exit: true });
assert.equal(calls.length, 1, 'exits remain silent');
audio._onBulletSegment({
  from: { x: -9, y: 1.6, z: 0 },
  to: { x: 1, y: 1.6, z: 0 },
  shooter: 'enemy',
  shot: 13,
});
audio._onImpact({ ...impact, shooter: 'enemy' });
assert.deepEqual(
  calls.map((c) => c[1]),
  ['impact', 'whizz', 'impact'],
  'canonical flight survives without duplicate contact whizzes'
);
calls.length = 0;
for (let i = 0; i < 5; i++)
  audio._onAiFootstep({ position: { x: 2, y: 0, z: 0 }, surface: 'wood', gait: 'run' });
assert.equal(calls.length, 3, 'existing per-frame AI plant budget');
const count = calls.length;
audio._budget.aiStep = 0;
audio._onAiFootstep({ position: { x: 100, y: 0, z: 0 }, surface: 'wood' });
assert.equal(calls.length, count, 'distant AI steps culled before playback');
assert.equal(audio._budget.aiStep, 0, 'range culling precedes budget');
calls.length = 0;
audio._onLand({ velocity: 12, surface: 'metal', position: { x: 3, y: 0, z: 2 } });
assert.equal(calls.length, 1, 'heavy land owns one boot/gear composite');
assert.deepEqual(calls[0].slice(1, 5), ['step', 3, 0, 2]);
assert.equal(calls[0][5].gear, 1);
assert.equal(calls[0][5].gait, 'land');
calls.length = 0;
audio._onDeath({ actor: { id: 1 }, point: { x: 3, y: 1, z: 2 } });
assert.equal(raycasts.length, 1);
assert.equal(calls[1][1], 'bodyfall');
assert.equal(calls[1][5].surface, 'wood', 'body fall samples the physical ground material');
assert(
  calls[1][5].extraDelay >= 0.45 && calls[1][5].extraDelay <= 0.85,
  'existing death-to-fall timing'
);
const retained = Object.values(bank.hitBuffers);
bank.dispose();
assert(retained.every((a) => a.length === 0));
assert.deepEqual(bank.hitBuffers, {});
assert.deepEqual(bank.hitIndices, {});

const originalFetch = globalThis.fetch;
try {
  let decodes = 0;
  globalThis.fetch = async (url) => ({
    ok: !url.includes('step-metal-run-2'),
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  const missing = new WeaponSampleBank({
    decodeAudioData: async () => {
      decodes++;
      return { duration: 0.2 };
    },
  });
  await assert.rejects(missing.load(), /step-metal-run-2.*HTTP 404/);
  assert.equal(
    decodes,
    49 +
      Object.values(FOLEY_URLS).reduce((n, urls) => n + urls.length, 0) +
      Object.values(RELOAD_URLS).reduce((n, urls) => n + urls.length, 0),
    'all other required jobs settle before failure teardown'
  );
  missing.dispose();
  assert.deepEqual(missing.hitBuffers, {});
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'Recorded material/boot/body/gear banks, timing, variants, memory, routing, budgets and required startup'
);
