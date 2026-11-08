/**
 * Issue 602 pilot: indexed reads made explicit for noUncheckedIndexedAccess keep
 * accepting valid inputs and fail (or report absence) at the original boundary.
 *
 *   node tests/smoke/smoke-indexed-access-pilot.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { series } from '../../src/audio/dsp.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { WEAPON_PROFILES } from '../../src/audio/weapons.ts';
import { isRecord } from '../../src/core/guards.ts';
import { parseWorldManifest } from '../../src/core/model-metadata.ts';
import { Rng } from '../../src/core/rng.ts';
import { RadioSystem } from '../../src/radio/index.ts';
import { GRADE_PRESETS, createGradeLut } from '../../src/render/lut.ts';
import { buildMagazineClips, buildManifestClips } from '../../src/weapons/clips.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

/* ---- metadata vec3: exactly three finite coordinates ----------------------- */
const level = readFileSync(
  new URL('../../public/models/world/level.json', import.meta.url),
  'utf8'
);
const withSpawnPosition = (position: unknown): Record<string, unknown> => {
  const manifest: unknown = JSON.parse(level);
  assert(isRecord(manifest) && Array.isArray(manifest.spawns));
  const spawn: unknown = manifest.spawns[0];
  assert(isRecord(spawn));
  spawn.position = position;
  return manifest;
};
const committed: unknown = JSON.parse(level);
assert(isRecord(committed) && Array.isArray(committed.spawns));
const committedSpawn: unknown = committed.spawns[0];
assert(isRecord(committedSpawn));
assert.deepEqual(parseWorldManifest(committed).spawns[0].position, committedSpawn.position);
assert.deepEqual(
  parseWorldManifest(withSpawnPosition([0, -1.5, 2])).spawns[0].position,
  [0, -1.5, 2]
);
for (const short of [[], [1], [1, 2]])
  assert.throws(
    (): ReturnType<typeof parseWorldManifest> => parseWorldManifest(withSpawnPosition(short)),
    /three metadata coordinates/
  );
assert.throws(
  (): ReturnType<typeof parseWorldManifest> => parseWorldManifest(withSpawnPosition([1, 2, 3, 4])),
  /three metadata coordinates/
);
assert.throws(
  (): ReturnType<typeof parseWorldManifest> => parseWorldManifest(withSpawnPosition([1, null, 3])),
  /finite metadata number/
);
assert.throws(
  (): ReturnType<typeof parseWorldManifest> =>
    parseWorldManifest(withSpawnPosition({ 0: 1, 1: 2, 2: 3 })),
  /metadata array/
);

/* ---- world spawn: wraps authored spawns; absent when there are none -------- */
const a = { position: new THREE.Vector3(), yaw: 0, tag: 'a' };
const b = { position: new THREE.Vector3(), yaw: 0, tag: 'b' };
const world = new WorldSystem();
world.spawnPoints = [a, b];
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
assert(lut.texture.image.data);
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
  clips.reload.events.map((ev): string => ev.name),
  ['magazine_out', 'foley', 'magazine_in']
);
const magazine = buildMagazineClips({ reload: 'Reload' }, manifest);
assert.deepEqual(
  magazine.reload.events.map((ev): [number, string] => [ev.t, ev.name]),
  [
    [0, 'start'],
    [0.5, 'magout'],
    [1.4, 'magin'],
    [2 - 0.0001, 'end'],
  ],
  'only mapped magazine beats survive; unmapped authored events are dropped'
);
assert.equal(magazine.reload.duration, 2, 'magazine clips keep the authored manifest length');
for (const build of [buildManifestClips, buildMagazineClips])
  assert.throws(
    (): ReturnType<typeof build> => build({ reload: 'Reload', inspect: 'Inspect' }, manifest),
    /animation manifest has no clip 'Inspect'/
  );

/* ---- audio: series wiring and round-robin bank reads ------------------------ */
const wired: [string, string][] = [];
const audioNode = (name: string): AudioNode & { name: string } => {
  const node = fixture<AudioNode & { name: string }>({
    name,
    connect(next: AudioNode | AudioParam): AudioNode {
      assert('name' in next && typeof next.name === 'string');
      wired.push([name, next.name]);
      return node;
    },
  });
  return node;
};
const [n1, n2, n3] = ['a', 'b', 'c'].map(audioNode);
assert.equal(series(n1), n1, 'a single node is its own tail');
assert.equal(series(n1, n2, n3), n3);
assert.deepEqual(wired, [
  ['a', 'b'],
  ['b', 'c'],
]);
const { actx } = audioFixture(0);
const bank = new WeaponSampleBank(actx);
const kind = WEAPON_PROFILES.rifle.sample;
bank.buffers[kind] = [
  fixture<AudioBuffer>({ duration: 0.4 }),
  fixture<AudioBuffer>({ duration: 0.5 }),
];
const rng = new Rng(1);
bank.shot(WEAPON_PROFILES.rifle, rng);
assert.equal(bank.indices[kind], 1, 'valid round robin advances');
bank.indices[kind] = 5; // stale index from a larger, since-replaced bank
assert.throws(
  (): ReturnType<WeaponSampleBank['shot']> => bank.shot(WEAPON_PROFILES.rifle, rng),
  /recording 5 is not loaded/
);

/* ---- radio: a strike needs a finite bomb line ------------------------------ */
const added: THREE.Object3D[] = [];
const emitted: string[] = [];
const radioWorld = (bounds: THREE.Box3): WorldSystem =>
  fixture<WorldSystem>({
    bounds,
    spawn: (): WorldSystem['spawnPoints'][number] => ({
      yaw: 0.3,
      position: new THREE.Vector3(),
      tag: 'test',
    }),
  });
const radio = new RadioSystem();
radio.ctx = createTestContext();
radio.ctx.scene.add = (...objects): THREE.Scene => {
  added.push(...objects);
  return radio.ctx.scene;
};
radio.ctx.events.on('radio:strike', (): number => emitted.push('radio:strike'));
radio.active = [];
radio._off = [];
radio._world = radioWorld(new THREE.Box3(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 1, 1)));
assert.equal(radio.callStrike(), false, 'non-finite bounds give no drop line');
assert.deepEqual([added.length, emitted.length, radio.active.length], [0, 0, 0]);
radio._world = radioWorld(
  new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 5, 10))
);
assert.equal(radio.callStrike(), true);
const [strike] = radio.active;
assert.equal(strike.lastDrop, strike.drops.at(-1));
assert.equal(strike.drops[0], 0, 'the first drop is at the start of the bomb line');

console.log('ALL PASS: indexed-access boundaries keep valid inputs and reject absent data');
