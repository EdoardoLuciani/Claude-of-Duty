/**
 * Small deterministic math kit for the viewmodel rig.
 *
 * Everything here is allocation-free after construction: springs hold their own
 * state, the noise fields hold their own tables, and every function either
 * mutates its target or returns a scalar. No `new` inside update().
 */

import { Spring, TAU } from '../core/math.ts';

interface SignedRng {
  signed(): number;
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

/** Three independent springs sharing frequency/damping — position or euler. */
export class Spring3 {
  a: Spring;
  b: Spring;
  c: Spring;

  constructor(freq = 12, damping = 1) {
    this.a = new Spring(freq, damping);
    this.b = new Spring(freq, damping);
    this.c = new Spring(freq, damping);
  }

  set freq(v: number) {
    this.a.freq = this.b.freq = this.c.freq = v;
  }

  get freq(): number {
    return this.a.freq;
  }

  set damping(v: number) {
    this.a.damping = this.b.damping = this.c.damping = v;
  }

  get damping(): number {
    return this.a.damping;
  }

  impulse(x: number, y: number, z: number): this {
    this.a.impulse(x);
    this.b.impulse(y);
    this.c.impulse(z);
    return this;
  }

  reset(): this {
    this.a.reset();
    this.b.reset();
    this.c.reset();
    return this;
  }

  step(dt: number, tx = 0, ty = 0, tz = 0): this {
    this.a.step(dt, tx);
    this.b.step(dt, ty);
    this.c.step(dt, tz);
    return this;
  }

  get x(): number {
    return this.a.value;
  }

  get y(): number {
    return this.b.value;
  }

  get z(): number {
    return this.c.value;
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
    if (!Number.isInteger(size) || size < 1)
      throw new RangeError('[weapons] noise table size must be a positive integer');
    this.size = size;
    this.t = new Float32Array(size);
    for (let i = 0; i < size; i++) this.t[i] = rng.signed();
    // Smooth the table once so the low octaves are gentle rather than jittery.
    const tmp = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      tmp[i] = (this.t[(i - 1 + size) % size] + this.t[i] * 2 + this.t[(i + 1) % size]) * 0.25;
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
      (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
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
