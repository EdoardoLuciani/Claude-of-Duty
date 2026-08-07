/**
 * SHARED scalar math + spring integrators (lead-owned: any subsystem may
 * import this — see ARCHITECTURE.md "Shared, owned by the lead").
 *
 * This is the single canonical home for the helpers that used to be
 * re-implemented in player/springs.js, weapons/mathx.js, ui/util.js,
 * fx/noise.js and ai/geo.js — five copies of clamp01 that had already drifted
 * apart. Subsystems that want a stable local import path keep their old file
 * as a re-export shim (e.g. player/springs.js).
 *
 * Everything here is allocation-free after construction and deterministic:
 * no Math.random(), no wall-clock dependence.
 *
 * Two spring integrators coexist on purpose — they are different solvers with
 * different feel:
 *   Spring       sub-stepped semi-implicit, driven by `impulse()`/`set()`
 *                around a fixed `target` (player camera rig)
 *   SpringEuler  single-step semi-implicit, driven by `kick()`/`step(dt, t)`
 *                (viewmodel rig). Exported as `Spring` from weapons/mathx.js.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return clamp01((v - a) / (b - a || 1));
}

/**
 * GLSL-style smoothstep. `smoothstep(t)` (one argument) is `smoothstep(0, 1, t)`
 * — both calling conventions existed across subsystems and are unified here.
 */
export function smoothstep(a, b, x) {
  if (x === undefined) { x = a; b = 1; a = 0; }
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

/** 5th-order smootherstep — zero 1st AND 2nd derivative at both ends. */
export function smootherstep(a, b, x) {
  if (x === undefined) { x = a; b = 1; a = 0; }
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInCubic(t) {
  return t * t * t;
}

export function easeInOutSine(t) {
  return 0.5 - 0.5 * Math.cos(clamp01(t) * Math.PI);
}

/** Slight overshoot ease used for mag slaps and bolt releases. */
export function easeOutBack(t, k = 1.6) {
  const p = t - 1;
  return 1 + p * p * ((k + 1) * p + k);
}

/**
 * Exponential approach with a real time constant. `tau` is the 63 % time, so
 * "reach it in about a tenth of a second" is tau = 0.1 / 2.3.
 */
export function approach(current, target, tau, dt) {
  if (tau <= 1e-6) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Constant-rate move, for things that must not have an asymptotic tail. */
export function moveToward(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (d > step) return current + step;
  if (d < -step) return current - step;
  return target;
}

/** Frame-rate independent exponential approach. `rate` = 1/e per second. */
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Shortest signed angular difference, radians. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Deterministic value noise in 1D — camera shake without touching any RNG. */
export function hashNoise(x, seed = 0) {
  const xi = Math.floor(x);
  const f = x - xi;
  const h = (i) => {
    let n = (i | 0) ^ (seed * 374761393);
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    n ^= n >>> 15;
    return ((n >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(xi) * (1 - u) + h(xi + 1) * u;
}

/** Critically-damped spring step, in place on {v} holder. Returns new value. */
export function spring(current, target, holder, stiffness, damping, dt) {
  const a = (target - current) * stiffness - holder.v * damping;
  holder.v += a * dt;
  return current + holder.v * dt;
}

const MAX_SUB_DT = 1 / 360;

/**
 * Damped harmonic oscillator, driven by frequency (Hz) and damping ratio.
 *   zeta < 1  under-damped, overshoots — good for punchy recoil
 *   zeta = 1  critically damped, fastest non-overshooting — good for FOV/ADS
 * `impulse()` injects velocity (the physical way to kick a spring), `set()`
 * displaces it instantly. The spring oscillates around `target` (public field).
 */
export class Spring {
  constructor(freq = 8, damping = 0.7, value = 0) {
    this.freq = freq;
    this.damping = damping;
    this.value = value;
    this.velocity = 0;
    this.target = 0;
  }

  reset(value = 0) {
    this.value = value;
    this.velocity = 0;
    return this;
  }

  impulse(v) {
    this.velocity += v;
    return this;
  }

  set(v) {
    this.value = v;
    return this;
  }

  step(dt) {
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
 * Semi-implicit Euler spring on a scalar. `f` is the natural frequency in Hz,
 * `z` the damping ratio (1 = no overshoot, 0.5 = lively, >1 = sluggish).
 * Stays stable at large dt without sub-stepping; target is passed per-step.
 */
export class SpringEuler {
  constructor(f = 12, z = 1, value = 0) {
    this.f = f;
    this.z = z;
    this.x = value;
    this.v = 0;
    this.target = value;
  }

  set(v) {
    this.x = v;
    this.v = 0;
    this.target = v;
    return this;
  }

  /** Instantaneous velocity kick — the recoil impulse path. */
  kick(dv) {
    this.v += dv;
    return this;
  }

  step(dt, target = this.target) {
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
  constructor(f = 12, z = 1) {
    this.a = new SpringEuler(f, z);
    this.b = new SpringEuler(f, z);
    this.c = new SpringEuler(f, z);
  }

  set f(v) {
    this.a.f = this.b.f = this.c.f = v;
  }

  get f() {
    return this.a.f;
  }

  set z(v) {
    this.a.z = this.b.z = this.c.z = v;
  }

  get z() {
    return this.a.z;
  }

  kick(x, y, z) {
    this.a.kick(x);
    this.b.kick(y);
    this.c.kick(z);
    return this;
  }

  reset() {
    this.a.set(0);
    this.b.set(0);
    this.c.set(0);
    return this;
  }

  step(dt, tx = 0, ty = 0, tz = 0) {
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

  /** Copy the spring state into a THREE.Vector3-like target. */
  writeTo(v, scale = 1) {
    v.x = this.a.x * scale;
    v.y = this.b.x * scale;
    v.z = this.c.x * scale;
    return v;
  }
}

/**
 * Two-layer response: a fast under-damped spring plus a slow exponential
 * residual. Real weapon/camera recoil rises instantly, snaps most of the way
 * back, then settles — a single spring can only do two of those three.
 */
export class RecoilAxis {
  constructor(freq = 9.5, damping = 0.52, residualTau = 0.3, residualShare = 0.34) {
    this.spring = new Spring(freq, damping, 0);
    this.residual = 0;
    this.residualTau = residualTau;
    this.residualShare = residualShare;
    this.value = 0;
  }

  reset() {
    this.spring.reset(0);
    this.residual = 0;
    this.value = 0;
  }

  /** `amount` is an angle in radians (or metres for a positional axis). */
  kick(amount) {
    // A displacement kick reads snappier than a velocity kick for recoil.
    this.spring.value += amount * (1 - this.residualShare);
    this.residual += amount * this.residualShare;
    // Publish the impulse immediately. Gameplay can fire after the camera's
    // update for this frame; leaving `value` stale hid the recoil for one render
    // and let a stiff spring decay before the first visible sample.
    this.value = this.spring.value + this.residual;
  }

  step(dt) {
    this.spring.step(dt);
    this.residual = approach(this.residual, 0, this.residualTau, dt);
    this.value = this.spring.value + this.residual;
    return this.value;
  }
}
