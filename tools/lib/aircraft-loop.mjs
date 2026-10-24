/** Offline PC-21 loop edits/measurements. Never imported by bundled runtime. */
import assert from 'node:assert/strict';

/** Undo the measured recording's pitch sweep by fractional resampling, before stretching. */
export function removePitchSweep(raw, pitchHz, targetHz, rate = 48000) {
  assert(pitchHz.length >= 2 && pitchHz.every((v) => v > 0 && Number.isFinite(v)));
  assert(targetHz > 0 && Number.isFinite(targetHz));
  const frames = raw.length / 4,
    samples = [];
  for (let pos = 0; pos < frames - 1;) {
    const at = Math.min(pos / rate / 0.05, pitchHz.length - 1);
    const index = Math.min(Math.floor(at), pitchHz.length - 2);
    const hz = pitchHz[index] + (pitchHz[index + 1] - pitchHz[index]) * (at - index);
    const i = Math.floor(pos),
      mix = pos - i;
    samples.push(raw.readFloatLE(i * 4) * (1 - mix) + raw.readFloatLE((i + 1) * 4) * mix);
    pos += targetHz / hz;
  }
  const result = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => result.writeFloatLE(v, i * 4));
  return result;
}

/** Phase-align circular overlap, then flatten only the broad cyclic RMS envelope. */
export function steadyLoop(raw, rate = 48000) {
  let frames = raw.length / 4;
  const overlap = Math.round(rate * 0.3),
    phaseSearch = Math.round((rate * 512) / 48000);
  assert(frames > overlap * 3 + phaseSearch);
  let phaseTrimSamples = 0,
    best = -Infinity;
  for (let trim = 0; trim < phaseSearch; trim++) {
    let score = 0;
    for (let i = 0; i < overlap; i += 8)
      score += raw.readFloatLE(i * 4) * raw.readFloatLE((frames - overlap - trim + i) * 4);
    if (score > best) {
      best = score;
      phaseTrimSamples = trim;
    }
  }
  frames -= phaseTrimSamples;
  const loop = Buffer.alloc((frames - overlap) * 4);
  for (let i = 0; i < overlap; i++) {
    const mix = i / overlap;
    loop.writeFloatLE(
      raw.readFloatLE((frames - overlap + i) * 4) * (1 - mix) + raw.readFloatLE(i * 4) * mix,
      i * 4
    );
  }
  raw.copy(loop, overlap * 4, overlap * 4, (frames - overlap) * 4);
  const n = loop.length / 4,
    width = Math.round(rate * 0.2),
    half = Math.floor(width / 2);
  let energy = 0,
    windowEnergy = 0;
  for (let i = 0; i < n; i++) energy += loop.readFloatLE(i * 4) ** 2;
  for (let i = -half; i < width - half; i++)
    windowEnergy += loop.readFloatLE(((i + n) % n) * 4) ** 2;
  const rms = Math.sqrt(energy / n),
    result = Buffer.alloc(loop.length);
  for (let i = 0; i < n; i++) {
    const envelope = Math.sqrt(Math.max(0, windowEnergy) / width);
    const correction = Math.max(0.5, Math.min(2, rms / Math.max(envelope, 1e-9)));
    result.writeFloatLE(loop.readFloatLE(i * 4) * correction, i * 4);
    windowEnergy +=
      loop.readFloatLE(((i + width - half) % n) * 4) ** 2 -
      loop.readFloatLE(((i - half + n) % n) * 4) ** 2;
  }
  return { pcm: result, phaseTrimSamples };
}

/** Circular 250ms windows include the wrap; track the dominant engine line, not verified RPM. */
export function measureLoop(pcm, targetHz, rate = 12000) {
  const n = pcm.length / 4,
    width = Math.round(rate * 0.25),
    hop = Math.round(rate * 0.125);
  const frame = new Float64Array(width),
    pitches = [],
    levels = [];
  for (let start = 0; start < n; start += hop) {
    let energy = 0;
    for (let i = 0; i < width; i++) {
      const v = pcm.readFloatLE(((start + i - Math.floor(width / 2) + n) % n) * 4);
      energy += v * v;
      frame[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (width - 1)));
    }
    levels.push(10 * Math.log10(Math.max(energy / width, 1e-20)));
    let best = -Infinity,
      pitch = 0;
    for (let hz = targetHz * 0.75; hz <= targetHz * 1.25; hz += 0.25) {
      const coefficient = 2 * Math.cos((2 * Math.PI * hz) / rate);
      let a = 0,
        b = 0;
      for (const v of frame) {
        const next = v + coefficient * a - b;
        b = a;
        a = next;
      }
      const power = a * a + b * b - coefficient * a * b;
      if (power > best) {
        best = power;
        pitch = hz;
      }
    }
    pitches.push(pitch);
  }
  return {
    pitchMinHz: Math.min(...pitches),
    pitchMaxHz: Math.max(...pitches),
    pitchSpanCents: 1200 * Math.log2(Math.max(...pitches) / Math.min(...pitches)),
    rmsSpanDb: Math.max(...levels) - Math.min(...levels),
  };
}
