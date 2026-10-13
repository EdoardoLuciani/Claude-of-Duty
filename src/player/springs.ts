/**
 * Scalar maths + spring integrators used by the player controller.
 *
 * Everything here is allocation-free after construction and framerate
 * independent: the springs sub-step internally so a 8 ms physics tick and a
 * 33 ms hitch produce the same visible motion.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

/** C2-continuous ease — used for rooted mantle curves where velocity must not pop. */
export function smootherstep(t: number): number {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Exponential approach with a real time constant. `tau` is the 63 % time, so
 * "reach it in about a tenth of a second" is tau = 0.1 / 2.3.
 */
export function approach(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 1e-6) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Deterministic value noise in 1D — camera shake without touching any RNG. */
export function hashNoise(x: number, seed = 0): number {
  const xi = Math.floor(x);
  const f = x - xi;
  const h = (i: number): number => {
    let n = (i | 0) ^ (seed * 374761393);
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    n ^= n >>> 15;
    return ((n >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(xi) * (1 - u) + h(xi + 1) * u;
}

const MAX_SUB_DT = 1 / 360;

/**
 * Damped harmonic oscillator, driven by frequency (Hz) and damping ratio.
 *   zeta < 1  under-damped, overshoots — good for punchy recoil
 *   zeta = 1  critically damped, fastest non-overshooting — good for FOV/ADS
 * `impulse()` injects velocity (the physical way to kick a spring), `set()`
 * displaces it instantly.
 */
export class Spring {
  declare freq: number;
  declare damping: number;
  declare value: number;
  declare velocity: number;
  declare target: number;

  constructor(freq = 8, damping = 0.7, value = 0) {
    this.freq = freq;
    this.damping = damping;
    this.value = value;
    this.velocity = 0;
    this.target = 0;
  }

  reset(value = 0): this {
    this.value = value;
    this.velocity = 0;
    return this;
  }

  impulse(v: number): this {
    this.velocity += v;
    return this;
  }

  set(v: number): this {
    this.value = v;
    return this;
  }

  step(dt: number): number {
    if (dt <= 0) return this.value;
    const w = TAU * this.freq;
    const k = w * w;
    const c = 2 * this.damping * w;
    // Sub-step so a stiff spring stays stable through a dropped frame.
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-7 && guard++ < 24) {
      const h = remaining > MAX_SUB_DT ? MAX_SUB_DT : remaining;
      remaining -= h;
      const a = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    // Kill denormal ringing so idle frames are bit-stable for capture.
    if (Math.abs(this.value - this.target) < 1e-7 && Math.abs(this.velocity) < 1e-6) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
}

/**
 * Two-layer response: a fast under-damped spring plus a slow exponential
 * residual. Real weapon/camera recoil rises instantly, snaps most of the way
 * back, then settles — a single spring can only do two of those three.
 */
export class RecoilAxis {
  declare spring: Spring;
  declare residual: number;
  declare residualTau: number;
  declare residualShare: number;
  declare value: number;

  constructor(freq = 9.5, damping = 0.52, residualTau = 0.3, residualShare = 0.34) {
    this.spring = new Spring(freq, damping, 0);
    this.residual = 0;
    this.residualTau = residualTau;
    this.residualShare = residualShare;
    this.value = 0;
  }

  reset(): void {
    this.spring.reset(0);
    this.residual = 0;
    this.value = 0;
  }

  /** `amount` is an angle in radians (or metres for a positional axis). */
  kick(amount: number): void {
    // A displacement kick reads snappier than a velocity kick for recoil.
    this.spring.value += amount * (1 - this.residualShare);
    this.residual += amount * this.residualShare;
    // Publish the impulse immediately. Gameplay can fire after the camera's
    // update for this frame; leaving `value` stale hid the recoil for one render
    // and let a stiff spring decay before the first visible sample.
    this.value = this.spring.value + this.residual;
  }

  step(dt: number): number {
    this.spring.step(dt);
    this.residual = approach(this.residual, 0, this.residualTau, dt);
    this.value = this.spring.value + this.residual;
    return this.value;
  }
}
