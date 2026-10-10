/**
 * Deterministic PRNG (xoshiro128**). Gameplay randomness — recoil patterns,
 * spread, particle jitter, AI timing — must run through this so capture mode
 * produces byte-identical frames.
 */
export interface Point2 {
  x: number;
  y: number;
}

export class Rng {
  s0 = 0;
  s1 = 0;
  s2 = 0;
  s3 = 0;
  private _spare: number | undefined;

  constructor(seed = 0x9e3779b9) {
    this.seed(seed);
  }

  seed(s: number): this {
    // SplitMix32 to spread one 32-bit seed across the four state words.
    let z = s >>> 0;
    const next = (): number => {
      z = (z + 0x9e3779b9) >>> 0;
      let x = z;
      x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
      x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
      return (x ^ (x >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    return this;
  }

  /** Uniform uint32. */
  u32(): number {
    const rot = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rot(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rot(this.s3, 11);
    return result;
  }

  /** Uniform [0,1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform [min,max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer [min,max]. */
  int(min: number, max: number): number {
    return min + (this.u32() % (max - min + 1));
  }

  /** Uniform [-1,1]. */
  signed(): number {
    return this.float() * 2 - 1;
  }

  /** Standard normal via Box–Muller (one sample; the pair's second is cached). */
  gauss(): number {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * this.float();
    this._spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  pick<T>(arr: readonly T[]): T | undefined {
    return arr[this.u32() % arr.length];
  }

  /** Point uniformly inside the unit disc — bullet spread, particle emission. */
  disc(out: Point2 = { x: 0, y: 0 }): Point2 {
    const r = Math.sqrt(this.float());
    const a = this.float() * Math.PI * 2;
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return out;
  }

  /** Independent stream derived from this one — lets a subsystem randomise
   *  without perturbing another subsystem's sequence. */
  fork(): Rng {
    return new Rng(this.u32());
  }
}
