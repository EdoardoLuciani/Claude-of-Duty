import assert from 'node:assert/strict';

import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { FALL_BANK, FOLEY_MIX, IMPACT_BANK, STEP_BANK } from '../../src/audio/physical.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.mjs';

const { actx, sources } = audioFixture(3);
const rng = new Rng(473);
const bank = new WeaponSampleBank(actx);
for (const [kind, urls] of Object.entries(FOLEY_URLS))
  bank.hitBuffers[kind] = urls.map((url, index) => ({
    kind,
    index,
    duration: 0.3,
  }));
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

console.log(
  'Recorded material/boot/body/gear banks, timing, variants, memory, routing, budgets and required startup'
);
