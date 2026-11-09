/** Scalar helpers shared by every subsystem. */
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential approach. `rate` is the reciprocal of the
 * time constant: how many e-folds per second.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export const TAU = Math.PI * 2;

/** Cubic Hermite ease of x across [a, b], clamped. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Quintic ease of x across [a, b]: zero 1st and 2nd derivatives at both ends. */
export function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 40 sub-steps cover the engine's 0.1 s frame clamp without dropping time.
const SPRING_SUB_DT = 1 / 360;

/**
 * Damped harmonic oscillator driven by frequency (Hz) and damping ratio:
 * below 1 overshoots (punchy recoil), 1 is critically damped. `impulse()`
 * injects velocity. Sub-stepped semi-implicit Euler keeps the response
 * frame-rate independent and stable through hitches. Allocation-free.
 */
export class Spring {
  declare freq: number;
  declare damping: number;
  declare value: number;
  declare target: number;

  velocity: number = 0;

  constructor(freq = 8, damping = 0.7, value = 0) {
    this.freq = freq;
    this.damping = damping;
    this.value = value;
    this.target = value;
  }

  reset(value = 0): this {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    return this;
  }

  impulse(dv: number): this {
    this.velocity += dv;
    return this;
  }

  step(dt: number, target = this.target): number {
    this.target = target;
    if (dt <= 0) return this.value;
    const w = TAU * this.freq;
    const k = w * w;
    const c = 2 * this.damping * w;
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-7 && guard++ < 40) {
      const h = remaining > SPRING_SUB_DT ? SPRING_SUB_DT : remaining;
      remaining -= h;
      this.velocity += (-k * (this.value - target) - c * this.velocity) * h;
      this.value += this.velocity * h;
    }
    // Kill denormal ringing so idle frames are bit-stable for capture.
    if (Math.abs(this.value - target) < 1e-7 && Math.abs(this.velocity) < 1e-6) {
      this.value = target;
      this.velocity = 0;
    }
    return this.value;
  }
}
