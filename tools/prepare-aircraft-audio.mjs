#!/usr/bin/env node
/** Edited propeller texture, not a verified twin-engine bomber recording. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    'Short near-pass propeller texture, pitch-preserving 4x stretch and circular overlap edit. PC-21 turboprop source, not a steady or scale-matched twin-engine bomber recording. Runtime distance/panning owns the flyby; no complete baked-in stereo pass is played.',
  files: {},
};
for (const [index, take, start] of [
  [1, '01', 58.05],
  [2, '02', 11.1],
]) {
  const source = `Boom ONE Update/update_23_05/AIRCRAFT/MILITARY/AEROMil_Military Jet PC-21 Fly By ${take} MS MKH 416_B00M_ONE.wav`;
  const filter = `atrim=start=${start}:duration=0.9,asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,aresample=48000,highpass=f=90,lowpass=f=8500,atempo=0.5,atempo=0.5`;
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
  const frames = raw.length / 4,
    overlap = 14400; // 300 ms circular linear crossfade.
  assert(frames > overlap * 3);
  const loop = Buffer.alloc((frames - overlap) * 4);
  for (let i = 0; i < overlap; i++) {
    const mix = i / overlap;
    loop.writeFloatLE(
      raw.readFloatLE((frames - overlap + i) * 4) * (1 - mix) + raw.readFloatLE(i * 4) * mix,
      i * 4
    );
  }
  raw.copy(loop, overlap * 4, overlap * 4, (frames - overlap) * 4);
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
  manifest.files[name] = {
    source,
    sourceSha256: hash(readFileSync(join(music, source))),
    start,
    duration: 0.9,
    filter,
    crossfadeSeconds: overlap / 48000,
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
writeFileSync(join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
