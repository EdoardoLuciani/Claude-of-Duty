/**
 * Issue 602 pilot: indexed reads made explicit for noUncheckedIndexedAccess keep
 * accepting valid inputs and fail (or report absence) at the original boundary.
 *
 *   node tests/smoke/smoke-indexed-access-pilot.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseWorldManifest } from '../../src/core/model-metadata.ts';
import { GRADE_PRESETS, createGradeLut } from '../../src/render/lut.ts';
import { buildMagazineClips, buildManifestClips } from '../../src/weapons/clips.ts';
import { WorldSystem } from '../../src/world/index.ts';

/* ---- metadata vec3: exactly three finite coordinates ----------------------- */
const level = readFileSync(
  new URL('../../public/models/world/level.json', import.meta.url),
  'utf8'
);
const withSpawnPosition = (position) => {
  const manifest = JSON.parse(level);
  manifest.spawns[0].position = position;
  return manifest;
};
const committed = JSON.parse(level);
assert.deepEqual(parseWorldManifest(committed).spawns[0].position, committed.spawns[0].position);
assert.deepEqual(
  parseWorldManifest(withSpawnPosition([0, -1.5, 2])).spawns[0].position,
  [0, -1.5, 2]
);
for (const short of [[], [1], [1, 2]])
  assert.throws(() => parseWorldManifest(withSpawnPosition(short)), /three metadata coordinates/);
assert.throws(
  () => parseWorldManifest(withSpawnPosition([1, 2, 3, 4])),
  /three metadata coordinates/
);
assert.throws(() => parseWorldManifest(withSpawnPosition([1, null, 3])), /finite metadata number/);
assert.throws(() => parseWorldManifest(withSpawnPosition({ 0: 1, 1: 2, 2: 3 })), /metadata array/);

/* ---- world spawn: wraps authored spawns; absent when there are none -------- */
const a = { position: 'a' };
const b = { position: 'b' };
const world = Object.assign(Object.create(WorldSystem.prototype), { spawnPoints: [a, b] });
assert.equal(world.spawn(), a);
assert.equal(world.spawn(1), b);
assert.equal(world.spawn(2), a, 'positive indices wrap');
assert.equal(world.spawn(-1), b, 'negative indices wrap');
world.spawnPoints = [];
assert.equal(world.spawn(0), undefined, 'a manifest without spawns has no spawn point');
assert.equal(world.spawn(3), undefined);

/* ---- grade LUT: presets are a closed set ----------------------------------- */
assert.deepEqual(Object.keys(GRADE_PRESETS), ['default']);
const lut = createGradeLut();
assert.equal(lut.texture.image.data.length, lut.size ** 3 * 4);
assert.deepEqual(createGradeLut('default').texture.image.data, lut.texture.image.data);

/* ---- weapon clips: alias sources must exist in the asset manifest ---------- */
const manifest = {
  Reload: {
    duration: 2,
    events: [
      { time: 0.5, event: 'magazine_out' },
      { time: 0.9, event: 'foley' },
      { time: 1.4, event: 'magazine_in' },
    ],
  },
};
const clips = buildManifestClips({ reload: 'Reload' }, manifest);
assert.equal(clips.reload.duration, 2);
assert.deepEqual(
  clips.reload.events.map((ev) => ev.name),
  ['magazine_out', 'foley', 'magazine_in']
);
const magazine = buildMagazineClips({ reload: 'Reload' }, manifest);
assert.deepEqual(
  magazine.reload.events.map((ev) => [ev.t, ev.name]),
  [
    [0, 'start'],
    [0.5, 'magout'],
    [1.4, 'magin'],
    [2 - 0.0001, 'end'],
  ],
  'only mapped magazine beats survive; unmapped authored events are dropped'
);
assert.equal(buildMagazineClips({ reload: 'Reload' }, manifest, () => 3).reload.duration, 3);
for (const build of [buildManifestClips, buildMagazineClips])
  assert.throws(
    () => build({ reload: 'Reload', inspect: 'Inspect' }, manifest),
    /animation manifest has no clip 'Inspect'/
  );

console.log('ALL PASS: indexed-access pilot boundaries keep valid inputs and reject absent data');
