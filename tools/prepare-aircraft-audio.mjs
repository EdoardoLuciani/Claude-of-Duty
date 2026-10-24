#!/usr/bin/env node
/** Edited propeller texture, not a verified twin-engine bomber recording. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'oxfmt';

import { removePitchSweep, steadyLoop, measureLoop } from './lib/aircraft-loop.mjs';

assert(process.argv[2], 'Usage: node tools/prepare-aircraft-audio.mjs /path/to/Music');
const music = resolve(process.argv[2]);
const output = fileURLToPath(new URL('../src/audio/samples/aircraft/', import.meta.url));
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ff = (args, input) => {
  const p = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', ...args], {
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(p.status, 0, p.stderr?.toString());
  return p.stdout;
};
const manifest = {
  format: 'mono 48000 Hz Opus, 96 kbps VBR',
  rights:
    'Owner explicitly cleared public redistribution of edited #474 aircraft derivatives. Original masters and unrelated legacy asset permissions remain separate. Keep source entitlement/licence records; these media do not inherit the code licence.',
  design:
    'Recorded PC-21 texture with the measured dominant-line pitch sweep removed offline before 4x stretch, phase-aligned circular overlap and broad RMS-envelope correction. Not verified engine RPM or a scale-matched twin-engine bomber recording. Runtime distance/panning owns the flyby.',
  files: {},
};
// Measured dominant engine line every 50 ms across each original 0.9 s crop.
// These are recording/Doppler corrections, not claimed physical engine RPM.
for (const [index, take, start, targetHz, pitchHz] of [
  [
    1,
    '01',
    58.05,
    193,
    [
      212.4, 210.21, 208.01, 205.44, 203.25, 201.23, 198.3, 195.56, 192.99, 190.98, 188.78, 185.3,
      182.74, 181.64, 180.36, 178.16, 177.06, 174.68, 172.49,
    ],
  ],
  [
    2,
    '02',
    11.1,
    237,
    [
      275.39, 271.55, 267.15, 263.12, 259.83, 254.88, 248.29, 244.45, 240.6, 237.3, 232.54, 226.14,
      222.84, 220.28, 217.53, 213.13, 207.28, 203.43, 200.5,
    ],
  ],
]) {
  const source = `Boom ONE Update/update_23_05/AIRCRAFT/MILITARY/AEROMil_Military Jet PC-21 Fly By ${take} MS MKH 416_B00M_ONE.wav`;
  const filter = `atrim=start=${start}:duration=0.9,asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,aresample=48000,highpass=f=90,lowpass=f=8500`;
  const stereo = ff([
    '-i',
    join(music, source),
    '-af',
    `atrim=start=${start}:duration=0.9,aresample=48000`,
    '-f',
    'f32le',
    '-',
  ]);
  let monoEnergy = 0,
    stereoEnergy = 0;
  for (let i = 0; i < stereo.length; i += 8) {
    const left = stereo.readFloatLE(i),
      right = stereo.readFloatLE(i + 4);
    monoEnergy += ((left + right) * 0.5) ** 2;
    stereoEnergy += (left * left + right * right) * 0.5;
  }
  const downmixLossDb = 10 * Math.log10(monoEnergy / stereoEnergy);
  assert(downmixLossDb > -6, 'Select a different crop instead of cancelling the propeller');
  const raw = ff(['-i', join(music, source), '-af', filter, '-f', 'f32le', '-']);
  const corrected = removePitchSweep(raw, pitchHz, targetHz);
  const stretched = ff(
    [
      '-f',
      'f32le',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-i',
      '-',
      '-af',
      'atempo=0.5,atempo=0.5',
      '-f',
      'f32le',
      '-',
    ],
    corrected
  );
  const { pcm: loop, phaseTrimSamples } = steadyLoop(stretched);
  let peak = 0,
    energy = 0;
  for (let i = 0; i < loop.length; i += 4) {
    const v = loop.readFloatLE(i);
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  const rms = Math.sqrt(energy / (loop.length / 4));
  assert(rms > 1e-5);
  const level = Math.min(10 ** (-20 / 20) / rms, 10 ** (-9 / 20) / peak);
  const encoded = ff(
    [
      '-f',
      'f32le',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-i',
      '-',
      '-map_metadata',
      '-1',
      '-af',
      `volume=${level}`,
      '-c:a',
      'libopus',
      '-b:a',
      '96k',
      '-vbr',
      'on',
      '-application',
      'audio',
      '-fflags',
      '+bitexact',
      '-f',
      'opus',
      '-',
    ],
    loop
  );
  const name = `propeller-${index}`;
  writeFileSync(join(output, name + '.opus'), encoded);
  const decoded = ff([
    '-i',
    join(output, name + '.opus'),
    '-ar',
    '48000',
    '-ac',
    '1',
    '-f',
    'f32le',
    '-',
  ]);
  let decodedPeak = 0,
    maxDelta = 0;
  for (let i = 0; i < decoded.length; i += 4) {
    const v = decoded.readFloatLE(i);
    decodedPeak = Math.max(decodedPeak, Math.abs(v));
    if (i) maxDelta = Math.max(maxDelta, Math.abs(v - decoded.readFloatLE(i - 4)));
  }
  const seamDelta = Math.abs(decoded.readFloatLE(0) - decoded.readFloatLE(decoded.length - 4));
  assert(decodedPeak < 0.5 && seamDelta < Math.max(0.005, maxDelta * 1.5));
  const steadiness = measureLoop(
    ff(['-i', join(output, name + '.opus'), '-ar', '12000', '-ac', '1', '-f', 'f32le', '-']),
    targetHz
  );
  assert(steadiness.pitchSpanCents < 35, 'Recorded pitch sweep still cycles in the loop');
  assert(steadiness.rmsSpanDb < 1.5, 'Broad loop envelope still swells and falls');
  manifest.files[name] = {
    source,
    sourceSha256: hash(readFileSync(join(music, source))),
    start,
    duration: 0.9,
    filter,
    pitchCorrection: { anchorStepSeconds: 0.05, measuredHz: pitchHz, targetHz },
    stretch: 'atempo=0.5,atempo=0.5',
    crossfadeSeconds: 0.3,
    phaseTrimSamples,
    rmsWindowSeconds: 0.2,
    rmsCorrectionBounds: [0.5, 2],
    steadiness,
    targetRmsDb: -20,
    level,
    decodedDuration: decoded.length / 4 / 48000,
    decodedPeak,
    downmixLossDb,
    seamDelta,
    maxDelta,
    sha256: hash(encoded),
  };
  console.log(
    name,
    encoded.length,
    'bytes;',
    (decoded.length / 4 / 48000).toFixed(3),
    'seconds; seam delta',
    seamDelta
  );
}
const formatted = await format('provenance.json', JSON.stringify(manifest, null, 2), {
  printWidth: 100,
});
assert.equal(formatted.errors.length, 0);
writeFileSync(join(output, 'provenance.json'), formatted.code);
