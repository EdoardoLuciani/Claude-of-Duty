/** Shared offline cut/mono/filter/level/encode path for #474's recorded one-shots. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export function ffmpeg(args, input) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', ...args], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr?.toString() ?? result.error?.message);
  return result.stdout;
}
export function prepareOneShot(
  path,
  { start, duration, rmsDb = -22, highpass = 90, lowpass = 10000, fadeIn = 0.005, fadeOut = 0.025 }
) {
  assert(start >= 0 && duration > fadeIn + fadeOut && fadeIn >= 0 && fadeOut >= 0);
  const info = JSON.parse(
    spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path]).stdout
  );
  const channels = info.streams[0].channels;
  assert(channels === 1 || channels === 2, 'Select an explicit mono/stereo source');
  const raw = ffmpeg([
    '-i',
    path,
    '-af',
    `atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000`,
    '-f',
    'f32le',
    '-',
  ]);
  let mono = 0,
    stereo = 0;
  for (let i = 0; i < raw.length; i += channels * 4) {
    const a = raw.readFloatLE(i),
      b = channels === 2 ? raw.readFloatLE(i + 4) : a;
    mono += ((a + b) / 2) ** 2;
    stereo += (a * a + b * b) / 2;
  }
  const downmixLossDb = 10 * Math.log10(mono / stereo);
  assert(downmixLossDb > -6);
  const filter = `${channels === 2 ? 'pan=mono|c0=0.5*c0+0.5*c1,' : ''}highpass=f=${highpass},lowpass=f=${lowpass},afade=t=in:d=${fadeIn},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`;
  const pcm = ffmpeg(
    [
      '-f',
      'f32le',
      '-ar',
      '48000',
      '-ac',
      String(channels),
      '-i',
      '-',
      '-af',
      filter,
      '-f',
      'f32le',
      '-',
    ],
    raw
  );
  let peak = 0,
    energy = 0,
    active = 0;
  for (let i = 0; i < pcm.length; i += 4) {
    const v = pcm.readFloatLE(i);
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.002) {
      energy += v * v;
      active++;
    }
  }
  assert(peak > 0.005 && active > 240);
  const gain = Math.min(10 ** (rmsDb / 20) / Math.sqrt(energy / active), 10 ** (-9 / 20) / peak);
  const opus = ffmpeg(
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
      `volume=${gain}`,
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
    pcm
  );
  const decoded = ffmpeg(['-i', '-', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-'], opus);
  let decodedPeak = 0;
  for (let i = 0; i < decoded.length; i += 4)
    decodedPeak = Math.max(decodedPeak, Math.abs(decoded.readFloatLE(i)));
  assert(decodedPeak < 0.5);
  return {
    opus,
    metadata: {
      sourceSha256: sha256(readFileSync(path)),
      start,
      duration,
      sourceChannels: channels,
      filter,
      activeRmsTargetDb: rmsDb,
      gain,
      downmixLossDb,
      decodedDuration: decoded.length / 4 / 48000,
      decodedPeak,
      sha256: sha256(opus),
    },
  };
}
