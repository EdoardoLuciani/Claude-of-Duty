import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { NoiseBank } from '../../src/audio/dsp.ts';
import { Rng } from '../../src/core/rng.ts';
import { SP, resetSpawn, setSpawnPosition, setSpawnVelocity } from '../../src/fx/particles.ts';

const spawn = resetSpawn();
const defaults = { ...spawn };
assert.equal(spawn, SP);
setSpawnPosition(spawn, -1, 2, 3);
assert.deepEqual(spawn, { ...defaults, x: -1, y: 2, z: 3 });
setSpawnVelocity(spawn, 4, -5, 6);
assert.deepEqual(spawn, { ...defaults, x: -1, y: 2, z: 3, vx: 4, vy: -5, vz: 6 });

// Ambient smoke and its ember share this descriptor; reset must precede reads.
const ember = resetSpawn();
assert.equal(ember, spawn);
setSpawnPosition(ember, spawn.x, 7, spawn.z);
assert.deepEqual(ember, { ...defaults, y: 7 });
assert.equal(resetSpawn(), spawn);
assert.deepEqual(spawn, defaults);

const context = {
  sampleRate: 8000,
  createBuffer(channels, length, sampleRate) {
    assert.equal(channels, 2);
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, getChannelData: (channel) => data[channel] };
  },
  createBufferSource() {
    return { playbackRate: { value: 1 } };
  },
};
const parent = new Rng(0x5eed);
const bank = new NoiseBank(context, parent.fork(), 0.02);
assert.deepEqual(Object.keys(bank.buffers), ['white', 'pink']);

// Golden stereo bytes from develop dd2d12cd, before unused colours were removed.
const hashes = {
  white: '3f1c3b8826fd9aa214d7f4ac7aeaa54107fcf27ba6e444d548a444b124ece047',
  pink: 'a54b8f42bdd1e02f228bbac2042def171c46315682a062aaa3fbb4bf2265b02b',
};
for (const [kind, expected] of Object.entries(hashes)) {
  const hash = createHash('sha256');
  for (const channel of [0, 1])
    hash.update(new Uint8Array(bank.buffers[kind].getChannelData(channel).buffer));
  assert.equal(hash.digest('hex'), expected, `${kind} retains both authored noise channels`);
}
const reference = new Rng(0x5eed);
reference.fork();
for (let i = 0; i < 8; i++) assert.equal(parent.u32(), reference.u32());
assert.deepEqual(parent.fork(), reference.fork());
assert.equal(bank.source('white', null).buffer, bank.buffers.white);
assert.equal(bank.source('pink', null).buffer, bank.buffers.pink);
bank.dispose();
assert.throws(() => bank.source('white', null), /noise bank is disposed/);

console.log('[shared-primitives] spawn fields, aliasing and stereo-noise/RNG parity passed');
