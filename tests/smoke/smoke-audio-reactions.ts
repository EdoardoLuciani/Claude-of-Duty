import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { CalloutPlayer } from '../../src/audio/callouts.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { REACTION_URLS, reactionBank } from '../../src/audio/reactions.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { SpatialField } from '../../src/audio/spatial.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import { fixtureEntries, at, fixtureBuffer, FixtureAudioBuffer } from '../lib/audio-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

const { actx, sources } = audioFixture(0);
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of fixtureEntries(REACTION_URLS))
  bank.hitBuffers[key] = urls.map(
    (_, i): FixtureAudioBuffer => new FixtureAudioBuffer({ key, index: i, duration: 0.5 })
  );
for (const id of [0, 1, 2, 3, -1, Infinity])
  for (const kind of ['hurt', 'death'] as const) {
    const voice = bank.reaction(kind, id, rng, { when: 2 });
    const source = at(sources, -1);
    assert.equal(fixtureBuffer(source.buffer).key, reactionBank(id, kind));
    assert.equal(source.playbackRate.value, 1);
    assert.equal(source.when, 2);
    assert.equal(voice.end, 2.52);
  }
const audio = new AudioSystem();
audio.running = true;
audio.actx = actx;
audio.samples = bank;
audio.rng = rng;
assert(audio._build('bark', 1, 8, { bark: 'hurt', voice: 1 }).end > 1);
assert.equal(fixtureBuffer(at(sources, -1).buffer).key, 'reaction-1-hurt');
const empty = new WeaponSampleBank(actx);
assert.throws((): AudioVoice => empty.reaction('hurt', 0, rng), /recordings are not loaded/);
assert.throws(
  (): AudioVoice => audio._build('bark', 0, 0, { bark: 'unknown' }),
  /unknown recorded reaction/,
  'unknown cues cannot synthesize or substitute tactical speech'
);
const calls: Array<{ kind: string; opts: Parameters<AudioSystem['bark']>[2] }> = [];
audio._playAt = (kind, x, y, z, opts): boolean => {
  calls.push({ kind, opts });
  return true;
};
audio._lastReactionEnd = 10;
audio._callouts = new CalloutPlayer(
  actx,
  fixture<SpatialField>({}, complete.testSpatialField()),
  bank,
  rng
);
audio._callouts.play = (): boolean => true;
audio._callouts.stop = (): void => {};
audio._callouts.forget = (): void => {};
actx.currentTime = 9;
assert.equal(audio.bark('hurt', { x: 1, y: 1, z: 1 }), false, 'duration-aware reaction gate');
assert.equal(
  audio.bark('grenade', { x: 1, y: 1, z: 1 }),
  true,
  'reaction tail never blocks tactical warning'
);
assert.equal(audio.bark('death', { x: 1, y: 1, z: 1 }, { force: true, voice: 1 }), true);
assert.equal(at(calls, -1).opts?.voice, 1);
assert.equal(at(calls, -1).opts?.bark, 'death');
const actor = { id: 31 };
calls.length = 0;
audio.ctx = createTestContext({ rng });
audio.ui = (): boolean => false;
rng.float = (): number => 0;
audio.bark = (kind, _pos, opts): boolean => {
  calls.push({ kind, opts });
  return true;
};
audio._onDamageDealt({ target: actor, point: new Vector3(1, 1, 1), killed: false, amount: 0 });
audio._onDeath({ actor, point: new Vector3(1, 1, 1), impulse: new Vector3() });
assert.equal(
  at(
    calls.filter((c): boolean => c.kind === 'hurt'),
    0
  ).opts?.voice,
  31
);
assert.equal(
  at(
    calls.filter((c): boolean => c.kind === 'death'),
    0
  ).opts?.voice,
  31
);
bank.dispose();
assert.deepEqual(bank.hitBuffers, {});
console.log(
  'Recorded nonverbal identity, variants, no synthesis fallback, duration gating and damage/death ownership'
);
