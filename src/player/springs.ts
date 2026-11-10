/**
 * Player-controller response helpers. Allocation-free after construction and
 * framerate independent (the shared Spring sub-steps internally).
 */

import { Spring } from '../core/math.ts';

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

/**
 * Two-layer response: a fast under-damped spring plus a slow exponential
 * residual. Real weapon/camera recoil rises instantly, snaps most of the way
 * back, then settles — a single spring can only do two of those three.
 */
export class RecoilAxis {
  declare spring: Spring;
  declare residualTau: number;
  declare residualShare: number;

  residual: number = 0;
  value: number = 0;

  constructor(freq = 9.5, damping = 0.52, residualTau = 0.3, residualShare = 0.34) {
    this.spring = new Spring(freq, damping, 0);
    this.residualTau = residualTau;
    this.residualShare = residualShare;
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
