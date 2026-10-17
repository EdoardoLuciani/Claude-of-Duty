import assert from 'node:assert/strict';

import {
  buildMagazineClips,
  buildManifestClips,
  makeSampleResult,
} from '../../src/weapons/clips.ts';

const manifest = {
  Reload: {
    duration: 3,
    events: [
      { time: 0.5, event: 'magazine_out' },
      { time: 1.5, event: 'magazine_in' },
      { time: 2, event: 'bolt_forward' },
      { time: 2.5, event: 'asset_only' },
    ],
  },
  Inspect: { duration: 1, events: [] },
};
const aliases = { reloadEmpty: 'Reload', inspect: 'Inspect' };
const clips = buildMagazineClips(aliases, manifest);
assert.deepEqual(clips.reloadEmpty.events, [
  { t: 0, name: 'start' },
  { t: 0.5, name: 'magout' },
  { t: 1.5, name: 'magin' },
  { t: 2, name: 'boltrelease' },
  { t: 2.9999, name: 'end' },
]);
assert.deepEqual(clips.inspect.events, [{ t: 0.9999, name: 'end' }]);
const nativeDuration = buildMagazineClips(aliases, manifest, () => 4).reloadEmpty;
assert.equal(nativeDuration.duration, 4);
assert.deepEqual(nativeDuration.events.slice(0, -1), clips.reloadEmpty.events.slice(0, -1));
assert.deepEqual(nativeDuration.events.at(-1), { t: 3.9999, name: 'end' });
const authored = buildManifestClips(aliases, manifest);
assert.deepEqual(authored.reloadEmpty.events, [
  { t: 0.5, name: 'magazine_out' },
  { t: 1.5, name: 'magazine_in' },
  { t: 2, name: 'bolt_forward' },
  { t: 2.5, name: 'asset_only' },
]);
assert.deepEqual(authored.inspect.events, []);
const pose = makeSampleResult();
authored.inspect.sample(0.5, pose);
assert.deepEqual(pose.pos, [0, 0, 0]);
assert.deepEqual(pose.rot, [0, 0, 0]);
assert.equal(pose.lhand.weight, 0);
console.log(
  'authored clips: native beats/durations versus synthesized magazine boundaries; no procedural pose'
);
