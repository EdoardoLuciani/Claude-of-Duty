#!/usr/bin/env node
/** Historical CC0 MCX prototype recipe, NOT the current commercial report bank.
 * Input/output WAVs live outside the game repository. No runtime asset writes.
 * Usage: node tools/mcx-audio.mjs <legacy-master-directory> <output-directory>
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert(process.argv[2] && process.argv[3], 'Provide external legacy input and output directories');
const inputDirectory = resolve(process.argv[2]);
const outputDirectory = resolve(process.argv[3]);
const repo = fileURLToPath(new URL('../', import.meta.url));
assert(
  outputDirectory !== resolve(repo) && !outputDirectory.startsWith(repo),
  'Keep generated WAVs outside the game repository'
);
assert.notEqual(inputDirectory, outputDirectory, 'Do not overwrite archived masters');
mkdirSync(outputDirectory, { recursive: true });

const SR = 48000;
const LENGTH = 0.32;
const PEAK = 10 ** (-4.5 / 20);

function readPCM(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not WAV');
  let channels, data;
  for (let i = 12; i + 8 <= b.length;) {
    const size = b.readUInt32LE(i + 4),
      start = i + 8;
    const tag = b.toString('ascii', i, i + 4);
    if (tag === 'fmt ') {
      if (
        b.readUInt16LE(start) !== 1 ||
        b.readUInt16LE(start + 14) !== 16 ||
        b.readUInt32LE(start + 4) !== SR
      )
        throw new Error('expected 48 kHz PCM16');
      channels = b.readUInt16LE(start + 2);
    }
    if (tag === 'data') data = b.subarray(start, start + size);
    i = start + size + (size & 1);
  }
  if (!channels || !data) throw new Error('missing PCM');
  const mono = new Float64Array(data.length / (2 * channels));
  for (let i = 0; i < mono.length; i++) {
    for (let c = 0; c < channels; c++)
      mono[i] += data.readInt16LE((i * channels + c) * 2) / (32768 * channels);
  }
  return mono;
}

function lowpass(cutoff) {
  // Butterworth, Q = sqrt(.5). Retain a sharp pressure pop; no brickwall gate.
  const w = (2 * Math.PI * cutoff) / SR,
    c = Math.cos(w),
    a = Math.sin(w) / Math.SQRT2;
  const b0 = (1 - c) / 2 / (1 + a),
    b1 = 2 * b0,
    a1 = (-2 * c) / (1 + a),
    a2 = (1 - a) / (1 + a);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

for (const n of [1, 2]) {
  const input = readPCM(resolve(inputDirectory, `suppressed-${n}.wav`));
  let peak = 0;
  for (const x of input) peak = Math.max(peak, Math.abs(x));
  const onset = Math.max(0, input.findIndex((x) => Math.abs(x) > peak * 0.025) - 24);
  const lp = lowpass(n === 1 ? 3300 : 3100);
  const out = new Float64Array(SR * LENGTH);
  const hpA = Math.exp((-2 * Math.PI * 55) / SR);
  let prev = 0,
    hp = 0,
    max = 0;
  for (let i = 0; i < out.length; i++) {
    const x = lp(input[onset + i] ?? 0),
      t = i / SR;
    hp = hpA * (hp + x - prev);
    prev = x;
    const attack = Math.min(1, i / 24);
    const tail = Math.exp(-Math.max(0, t - 0.055) / 0.064);
    const fade = Math.min(1, (out.length - 1 - i) / (SR * 0.025));
    out[i] = hp * attack * tail * fade;
    max = Math.max(max, Math.abs(out[i]));
  }
  const wav = Buffer.alloc(44 + out.length * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(out.length * 2, 40);
  for (let i = 0; i < out.length; i++)
    wav.writeInt16LE(Math.round(((out[i] * PEAK) / max) * 32767), 44 + i * 2);
  const dest = resolve(outputDirectory, `mcx-${n}.wav`);
  writeFileSync(dest, wav);
  console.log(
    `[mcx audio] ${dest}: ${LENGTH}s mono PCM16, -4.5 dBFS peak, onset trim ${((onset / SR) * 1000).toFixed(2)}ms`
  );
}
