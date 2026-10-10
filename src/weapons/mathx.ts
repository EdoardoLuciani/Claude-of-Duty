/**
 * Small deterministic math kit for the viewmodel rig.
 *
 * Everything here is allocation-free after construction: springs hold their own
 * state, the noise fields hold their own tables, and every function either
 * mutates its target or returns a scalar. No `new` inside update().
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

interface SignedRng { signed(): number }

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 5th-order smootherstep — zero 1st AND 2nd derivative at both ends. */
export function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Slight overshoot ease used for mag slaps and bolt releases. */
export function easeOutBack(t: number, k = 1.6): number {
  const p = t - 1;
  return 1 + p * p * ((k + 1) * p + k);
}

export function easeOutCubic(t: number): number {
  const p = 1 - t;
  return 1 - p * p * p;
}

/**
 * Frame-rate independent exponential approach. `rate` is the reciprocal of the
 * time constant: how many e-folds per second.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/**
 * Critically-ish damped spring on a scalar. `f` is the natural frequency in Hz,
 * `z` the damping ratio (1 = no overshoot, 0.5 = lively, >1 = sluggish).
 * Semi-implicit integration so it stays stable at large dt.
 */
export class Spring {
  f: number;
  z: number;
  x: number;
  v: number;
  target: number;

  constructor(f = 12, z = 1, value = 0) {
    this.f = f;
    this.z = z;
    this.x = value;
    this.v = 0;
    this.target = value;
  }

  set(v: number): this {
    this.x = v;
    this.v = 0;
    this.target = v;
    return this;
  }

  /** Instantaneous velocity kick — the recoil impulse path. */
  kick(dv: number): this {
    this.v += dv;
    return this;
  }

  step(dt: number, target = this.target): number {
    this.target = target;
    const w = TAU * this.f;
    // Semi-implicit Euler: solve for v(n+1) then integrate x with it.
    const denom = 1 + 2 * this.z * w * dt + w * w * dt * dt;
    this.v = (this.v + w * w * dt * (target - this.x)) / denom;
    this.x += this.v * dt;
    return this.x;
  }
}

/** Three independent springs sharing frequency/damping — position or euler. */
export class Spring3 {
  a: Spring;
  b: Spring;
  c: Spring;

  constructor(f = 12, z = 1) {
    this.a = new Spring(f, z);
    this.b = new Spring(f, z);
    this.c = new Spring(f, z);
  }

  set f(v: number) {
    this.a.f = this.b.f = this.c.f = v;
  }

  get f() {
    return this.a.f;
  }

  set damping(v: number) {
    this.a.z = this.b.z = this.c.z = v;
  }

  get damping() {
    return this.a.z;
  }

  kick(x: number, y: number, z: number): this {
    this.a.kick(x);
    this.b.kick(y);
    this.c.kick(z);
    return this;
  }

  reset(): this {
    this.a.set(0);
    this.b.set(0);
    this.c.set(0);
    return this;
  }

  step(dt: number, tx = 0, ty = 0, tz = 0): this {
    this.a.step(dt, tx);
    this.b.step(dt, ty);
    this.c.step(dt, tz);
    return this;
  }

  get x() {
    return this.a.x;
  }

  get y() {
    return this.b.x;
  }

  get z() {
    return this.c.x;
  }
}

/**
 * Layered 1-D value noise with cubic interpolation.
 *
 * Idle sway needs to never visibly loop, so each octave gets its own
 * incommensurate rate and a table long enough that the pattern does not repeat
 * inside a play session. Sampling is a table lookup + a lerp: cheap enough to
 * run a dozen of these every frame.
 */
export class Noise1 {
  size: number;
  t: Float32Array;

  constructor(rng: SignedRng, size = 512) {
    this.size = size;
    this.t = new Float32Array(size);
    for (let i = 0; i < size; i++) this.t[i] = rng.signed();
    // Smooth the table once so the low octaves are gentle rather than jittery.
    const tmp = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      tmp[i] =
        (this.t[(i - 1 + size) % size] + this.t[i] * 2 + this.t[(i + 1) % size]) * 0.25;
    }
    this.t.set(tmp);
  }

  at(x: number): number {
    const size = this.size;
    const fx = x - Math.floor(x);
    const i = ((Math.floor(x) % size) + size) % size;
    const a = this.t[(i - 1 + size) % size];
    const b = this.t[i];
    const c = this.t[(i + 1) % size];
    const d = this.t[(i + 2) % size];
    // Catmull-Rom keeps the curve C1 so the weapon never ticks.
    const t = fx;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      ((2 * b) +
        (-a + c) * t +
        (2 * a - 5 * b + 4 * c - d) * t2 +
        (-a + 3 * b - 3 * c + d) * t3)
    );
  }

  /** fBm over `oct` octaves; irrational lacunarity keeps octaves out of phase. */
  fbm(x: number, oct = 3, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < oct; i++) {
      sum += this.at(x * freq + i * 37.19) * amp;
      norm += amp;
      amp *= gain;
      freq *= 2.11713;
    }
    return sum / (norm || 1);
  }
}

/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
