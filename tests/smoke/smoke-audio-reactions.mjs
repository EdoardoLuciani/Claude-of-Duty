import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { AudioSystem } from '../../src/audio/index.ts';
import { REACTION_URLS, reactionBank } from '../../src/audio/reactions.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/reactions/provenance.json' with { type: 'json' };
import { BARKS, bark } from '../../src/audio/vox.ts';
import { Rng } from '../../src/core/rng.ts';

let encoded = 0,
  decoded = 0;
for (const [key, urls] of Object.entries(REACTION_URLS)) {
  assert.equal(urls.length, 3);
  for (const [i, url] of urls.entries()) {
    const data = readFileSync(new URL(url)),
      meta = provenance.files[`${key}-${i + 1}`];
    assert.equal(createHash('sha256').update(data).digest('hex'), meta.sha256);
    const header = data.indexOf('OpusHead');
    assert(header >= 0);
    assert.equal(data[header + 9], 1);
    assert.equal(data.readInt16LE(header + 16), 0);
    assert(meta.decodedDuration < 0.65 && meta.decodedPeak < 0.5);
    encoded += data.length;
    decoded += meta.decodedDuration * 48000 * 4;
  }
}
assert(encoded < 150000 && decoded < 1500000);
const sources = [];
const actx = {
  currentTime: 0,
  createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
  createBufferSource() {
    const src = {
      playbackRate: { value: 1 },
      connect() {},
      start(when) {
        this.when = when;
      },
    };
    sources.push(src);
    return src;
  },
};
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of Object.entries(REACTION_URLS))
  bank.hitBuffers[key] = urls.map((_, i) => ({ key, index: i, duration: 0.5 }));
for (const id of [0, 1, 2, 3, -1, Infinity])
  for (const kind of ['hurt', 'death']) {
    let previous = -1;
    const seen = new Set();
    for (let i = 0; i < 18; i++) {
      const voice = bank.reaction(kind, id, rng, { when: 2 });
      const src = sources.at(-1);
      assert.equal(src.buffer.key, reactionBank(id, kind));
      assert.notEqual(src.buffer.index, previous);
      assert.equal(src.playbackRate.value, 1);
      assert.equal(src.when, 2);
      assert.equal(voice.end, 2.52);
      previous = src.buffer.index;
      seen.add(previous);
    }
    assert.equal(seen.size, 3);
  }
const audio = new AudioSystem();
Object.assign(audio, { running: true, actx, samples: bank, rng });
assert(audio._build('bark', 1, 8, { bark: 'hurt', voice: 1 }).end > 1);
assert.equal(sources.at(-1).buffer.key, 'reaction-1-hurt');
const empty = new WeaponSampleBank(actx);
assert.throws(() => empty.reaction('hurt', 0, rng), /recordings are not loaded/);
for (const k of ['hit', 'pain', 'death']) {
  assert(!Object.hasOwn(BARKS, k));
  assert.throws(() => bark(actx, null, rng, { bark: k }), /unknown synthesized speech/);
}
const calls = [];
audio._playAt = (kind, x, y, z, opts) => {
  calls.push({ kind, opts });
  return true;
};
audio._lastReactionEnd = 10;
actx.currentTime = 9;
assert.equal(audio.bark('hurt', { x: 1, y: 1, z: 1 }), false, 'duration-aware reaction gate');
assert.equal(
  audio.bark('grenade', { x: 1, y: 1, z: 1 }),
  true,
  'reaction tail never blocks tactical warning'
);
assert.equal(audio.bark('death', { x: 1, y: 1, z: 1 }, { force: true, voice: 1 }), true);
assert.equal(calls.at(-1).opts.voice, 1);
assert.equal(calls.at(-1).opts.bark, 'death');
const actor = { id: 31 };
calls.length = 0;
audio.ctx = { peek: () => null };
audio.ui = () => {};
rng.float = () => 0;
audio.bark = (kind, pos, opts) => calls.push({ kind, opts });
audio._onDamageDealt({ target: actor, point: { x: 1, y: 1, z: 1 }, killed: false });
audio._onDeath({ actor, point: { x: 1, y: 1, z: 1 } });
assert.equal(calls.find((c) => c.kind === 'hurt').opts.voice, 31);
assert.equal(calls.find((c) => c.kind === 'death').opts.voice, 31);
bank.dispose();
assert.deepEqual(bank.hitBuffers, {});
console.log(
  'Recorded nonverbal identity, variants, no synthesis fallback, duration gating and damage/death ownership'
);
