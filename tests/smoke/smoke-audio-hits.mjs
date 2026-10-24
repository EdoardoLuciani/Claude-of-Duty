import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { HIT_URLS } from '../../src/audio/hits.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/hits/provenance.json' with { type: 'json' };
import { Rng } from '../../src/core/rng.ts';
import { UiSystem } from '../../src/ui/index.ts';

let bytes = 0;
for (const [kind, urls] of Object.entries(HIT_URLS)) {
  assert(urls.length >= 3, `${kind}: authored variations`);
  for (const url of urls) {
    const data = readFileSync(new URL(url));
    const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
    assert.equal(createHash('sha256').update(data).digest('hex'), provenance.files[name].sha256);
    assert(provenance.files[name].duration <= 0.35, 'short contacts, not whole source reels');
    assert(provenance.files[name].decodedPeak < 0.5, 'authored headroom');
    const head = data.indexOf('OpusHead');
    assert(head >= 0);
    assert.equal(data[head + 9], 1, 'phase-checked mono positional contacts');
    assert.equal(data.readInt16LE(head + 16), 0, 'no hidden codec gain');
    bytes += data.length;
  }
}
assert.equal(Object.keys(provenance.files).length, 10);
assert(bytes < 60_000, 'compact delivery bank');

const param = () => ({ value: 0 });
const sources = [];
const actx = {
  currentTime: 3,
  createGain: () => ({ gain: param(), connect() {} }),
  createBufferSource() {
    const node = {
      playbackRate: param(),
      connect() {},
      start(when) {
        this.when = when;
      },
    };
    sources.push(node);
    return node;
  },
};
const bank = new WeaponSampleBank(actx);
const rng = new Rng(473);
for (const [kind, urls] of Object.entries(HIT_URLS))
  bank.hitBuffers[kind] = urls.map((_, index) => ({
    kind,
    index,
    duration: kind === 'break' ? 0.33 : 0.32,
  }));
for (const kind of Object.keys(HIT_URLS)) {
  let previous = -1;
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const voice = bank.hit(kind, rng, { when: 4 });
    const src = sources.at(-1);
    assert.notEqual(src.buffer.index, previous, 'no consecutive identical sample');
    previous = src.buffer.index;
    seen.add(previous);
    assert(src.playbackRate.value >= 0.98 && src.playbackRate.value <= 1.02);
    assert.equal(src.when, 4);
    assert.equal(voice.end, 4 + src.buffer.duration / src.playbackRate.value + 0.02);
  }
  assert.equal(seen.size, HIT_URLS[kind].length);
}
const cases = [
  [25, 0, false, ['flesh']],
  [0, 25, false, ['armour']],
  [15, 15, false, ['armour', 'flesh']],
  [15, 15, true, ['break', 'flesh']],
  [0, 25, true, ['break']],
];
for (const [amount, armourAbsorbed, plateBreak, expected] of cases) {
  const before = sources.length;
  const voice = bank.damage(rng, { when: 7, amount, armourAbsorbed, plateBreak });
  const added = sources.slice(before);
  assert.deepEqual(
    added.map((s) => s.buffer.kind),
    expected
  );
  assert(
    added.every((s) => s.when === 7),
    'components start together'
  );
  assert.equal(
    voice.end,
    Math.max(...added.map((s) => 7 + s.buffer.duration / s.playbackRate.value + 0.02))
  );
  assert.equal(voice.send, 0, 'incoming contact has no synthetic room tail');
}
assert.throws(
  () => new WeaponSampleBank(actx).hit('flesh', rng),
  /contact recordings are not loaded/
);

const audio = new AudioSystem();
const player = { isPlayer: true };
const calls = [];
Object.assign(audio, {
  running: true,
  samples: bank,
  rng,
  ctx: { peek: () => player },
  field: { distanceTo: () => 2, listenerPos: { x: 0, y: 1.6, z: 0 } },
});
audio._playDry = (...args) => calls.push(['dry', ...args]);
audio._playAt = (...args) => calls.push(['spatial', ...args]);
audio.ui = (...args) => calls.push(['ui', ...args]);
audio.bark = (...args) => calls.push(['bark', ...args]);
for (const [amount, armourAbsorbed, plateBreak] of cases) {
  calls.length = 0;
  audio._onDamageTaken({ amount, armourAbsorbed, plateBreak });
  assert.deepEqual(
    calls,
    [['dry', 'damage', { amount, armourAbsorbed, plateBreak }, 'ui', 0]],
    'one composite per incoming event'
  );
}
for (const event of [
  { amount: 0, armourAbsorbed: 0 },
  { amount: -1, armourAbsorbed: NaN },
]) {
  calls.length = 0;
  audio._onDamageTaken(event);
  assert.equal(calls.length, 0, 'no sound for empty/invalid damage');
}
const contact = { point: { x: 2, y: 1, z: 0 }, surface: 'flesh', damage: 30, exit: false, shot: 1 };
for (const actor of ['player', player, { isPlayer: true }]) {
  calls.length = 0;
  audio._budget.impact = 0;
  audio._onImpact({ ...contact, actor });
  assert.equal(calls.length, 0, 'player world contact must not double incoming feedback');
  assert.equal(audio._budget.impact, 0, 'player contact cannot consume world impact budget');
}
calls.length = 0;
audio._onImpact({ ...contact, actor: { id: 1 } });
assert.equal(calls.length, 1, 'enemy contact once, no own-bullet near-miss sound');
assert.equal(calls[0][0], 'spatial');
assert.equal(calls[0][1], 'impact');
audio._onImpact({ ...contact, actor: { id: 2 } });
assert.equal(calls.length, 2, 'separate penetrated actors can each make contact');
audio._onImpact({ ...contact, exit: true });
assert.equal(calls.length, 2, 'exit contact is silent');
audio.ctx.peek = () => null;
audio._budget.impact = 0;
calls.length = 0;
audio._onImpact({ ...contact, actor: null, surface: 'concrete' });
assert.equal(
  calls.length,
  1,
  'actorless world contact plays once without inventing a flight whizz'
);
calls.length = 0;
const segment = {
  from: { x: -9, y: 1.35, z: 0 },
  to: { x: -0.3, y: 1.35, z: 0 },
  shooter: 'enemy',
  shot: 473,
};
audio._onBulletSegment(segment);
assert.equal(calls.length, 1, 'direct incoming flight still produces a whizz');
assert.equal(calls[0][1], 'whizz');
audio._onBulletSegment(segment);
assert.equal(calls.length, 1, 'same shot does not produce another flight whizz');
audio._onImpact({ ...contact, actor: player });
audio._onDamageTaken({ amount: 25, armourAbsorbed: 0, plateBreak: false });
assert.deepEqual(
  calls.map((v) => v[1]),
  ['whizz', 'damage'],
  'flight and physical injury remain distinct intended layers'
);
calls.length = 0;
audio._onBulletSegment({ ...segment, shooter: player, shot: 474 });
assert.equal(calls.length, 0, 'own bullet does not whizz past own ears');
calls.length = 0;
audio._onDamageDealt({
  target: { id: 1 },
  amount: 25,
  point: contact.point,
  killed: true,
  headshot: true,
});
assert.deepEqual(
  calls,
  [
    ['ui', 'headshot', 1],
    ['ui', 'kill', 1],
  ],
  'damage dealt only confirms; no duplicate flesh contact'
);
calls.length = 0;
audio._onDamageDealt({ target: { id: 1 }, amount: 0, part: 'armour', killed: true });
assert.deepEqual(
  calls,
  [
    ['ui', 'armour', 1],
    ['ui', 'kill', 1],
  ],
  'armour confirmation retains its UI timbre'
);

const hud = Object.create(UiSystem.prototype);
const hudCalls = [];
Object.assign(hud, {
  arcs: { spawn: (...args) => hudCalls.push(args) },
  health: { onDamage: (...args) => hudCalls.push(args) },
  crosshair: { onFlinch: (...args) => hudCalls.push(args), onHit: () => hudCalls.push('hit') },
  hit: { spawn: (kind) => hudCalls.push(kind) },
  sfx: () => assert.fail('HUD hurt must not replay the audio-owned health sound'),
});
hud.hurt(20, -1, 1);
assert.equal(hudCalls.length, 3, 'direction arc, health flash and flinch preserved');
hud.hitmarker('armour');
assert.deepEqual(
  hudCalls.slice(3),
  ['armour', 'hit'],
  'visual confirmation remains, without a duplicate UI tick'
);

const originalFetch = globalThis.fetch;
let decodes = 0;
try {
  globalThis.fetch = async (url) => ({
    ok: !url.includes('/hits/armour-2'),
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  const missing = new WeaponSampleBank({
    decodeAudioData: async () => {
      decodes++;
      return { duration: 0.1 };
    },
  });
  await assert.rejects(missing.load(), /armour-2.*HTTP 404/);
  const reloads = Object.values(RELOAD_URLS).reduce((sum, urls) => sum + urls.length, 0);
  assert.equal(
    decodes,
    49 + reloads + Object.values(FOLEY_URLS).reduce((n, urls) => n + urls.length, 0),
    'missing contact participates in required all-settled startup'
  );
  missing.dispose();
  assert.deepEqual(missing.hitBuffers, {});
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'Recorded contact assets, variants, incoming-state composition, sole SFX ownership and spatial/UI separation'
);
