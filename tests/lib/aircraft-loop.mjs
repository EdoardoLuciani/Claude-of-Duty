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
