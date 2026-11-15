import assert from 'node:assert/strict';

import { NoiseBank } from '../../src/audio/dsp.ts';
import { Rng } from '../../src/core/rng.ts';
import { SP, resetSpawn, setSpawnPosition, setSpawnVelocity } from '../../src/fx/particles.ts';
import { FixtureAudioParam } from '../lib/audio-fixture.ts';
import { fixture } from '../lib/fixture.ts';

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

const context = fixture<BaseAudioContext>({
  sampleRate: 8000,
  createBuffer(channels, length, sampleRate): AudioBuffer {
    assert.equal(channels, 2);
    const data = Array.from(
      { length: channels },
      (): Float32Array<ArrayBuffer> => new Float32Array(length)
    );
    return fixture<AudioBuffer>({
      duration: length / sampleRate,
      getChannelData: (channel): Float32Array<ArrayBuffer> => data[channel],
    });
  },
  createBufferSource(): AudioBufferSourceNode {
    return fixture<AudioBufferSourceNode>({ playbackRate: new FixtureAudioParam(1) });
  },
});
const parent = new Rng(0x5eed);
const bank = new NoiseBank(context, parent.fork(), 0.02);
assert.deepEqual(Object.keys(bank.buffers), ['white', 'pink']);

const reference = new Rng(0x5eed);
reference.fork();
for (let i = 0; i < 8; i++) assert.equal(parent.u32(), reference.u32());
assert.deepEqual(parent.fork(), reference.fork());
assert.equal(bank.source('white', null).buffer, bank.buffers.white);
assert.equal(bank.source('pink', null).buffer, bank.buffers.pink);
bank.dispose();
assert.throws(
  (): ReturnType<NoiseBank['source']> => bank.source('white', null),
  /noise bank is disposed/
);

console.log('[shared-primitives] spawn aliasing, noise ownership and parent RNG isolation passed');
