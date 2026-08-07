/**
 * SHARED deterministic noise toolkit (lead-owned: any subsystem may import
 * this — see ARCHITECTURE.md "Shared, owned by the lead").
 *
 * One `Noise` class for every CPU noise need, merged from the two
 * implementations that used to live in ai/geo.js (3D Perlin for the soldier
 * builder) and fx/noise.js (2D Perlin + Worley for the FX atlas bakes).
 *
 * Determinism contract (capture byte-identity):
 *  - The constructor consumes EXACTLY the same rng draws as the old 3D-only
 *    class: 255 `rng.int(0, i)` calls for the permutation shuffle.
 *  - The Worley cell-jitter table is built LAZILY on the first `worley()` /
 *    `worleyEdge()` call, so a 3D-only user (the model exporter) never draws
 *    the 512 floats and its rng stream is unchanged. 2D users draw the same
 *    512 floats from the same dedicated stream, just later — values identical.
 *  - Nothing here runs per frame; it is all boot-time work.
 */

/** 16 evenly spread unit gradients — cheap and directionally unbiased enough. */
const GRAD = new Float32Array(32);
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  GRAD[i * 2] = Math.cos(a);
  GRAD[i * 2 + 1] = Math.sin(a);
}

/** 12 evenly spread 3D gradient directions. */
const G3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const F = (t) => t * t * t * (t * (t * 6 - 15) + 10); // quintic fade

export class Noise {
  constructor(rng) {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) t[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const s = t[i];
      t[i] = t[j];
      t[j] = s;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = t[i & 255];
    // Retained only until the Worley table is built (see class doc).
    this._rng = rng;
    this._cells = null;
  }

  _hash(ix, iy) {
    return this.perm[(this.perm[ix & 255] + (iy & 255)) & 255];
  }

  /** Jittered feature points for the Worley lattice (lumpy smoke, cracks). */
  _ensureCells() {
    if (this._cells) return;
    const rng = this._rng;
    this._rng = null;
    const cell = new Float32Array(256 * 2);
    for (let i = 0; i < 256; i++) {
      cell[i * 2] = rng.float();
      cell[i * 2 + 1] = rng.float();
    }
    this._cells = cell;
  }

  /* ---------------- 2D (FX atlas bakes) ---------------- */

  /** Perlin gradient noise, roughly -1..1. */
  perlin(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = F(fx);
    const v = F(fy);
    const g = GRAD;
    const h00 = this._hash(ix, iy) & 15;
    const h10 = this._hash(ix + 1, iy) & 15;
    const h01 = this._hash(ix, iy + 1) & 15;
    const h11 = this._hash(ix + 1, iy + 1) & 15;
    const d00 = g[h00 * 2] * fx + g[h00 * 2 + 1] * fy;
    const d10 = g[h10 * 2] * (fx - 1) + g[h10 * 2 + 1] * fy;
    const d01 = g[h01 * 2] * fx + g[h01 * 2 + 1] * (fy - 1);
    const d11 = g[h11 * 2] * (fx - 1) + g[h11 * 2 + 1] * (fy - 1);
    const a = d00 + u * (d10 - d00);
    const b = d01 + u * (d11 - d01);
    return (a + v * (b - a)) * 1.42;
  }

  /** fBm in 0..1. */
  fbm(x, y, oct = 5, lac = 2.03, gain = 0.5) {
    let amp = 0.5;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += this.perlin(x * f, y * f) * amp;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm / 2 + 0.5;
  }

  /** Ridged multifractal in 0..1 — veins, cracks, filaments. */
  ridged(x, y, oct = 4, lac = 2.11, gain = 0.5) {
    let amp = 0.5;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      const n = 1 - Math.abs(this.perlin(x * f, y * f));
      sum += n * n * amp;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** Domain-warped fBm — the single cheapest way to stop noise looking like noise. */
  warped(x, y, warp = 0.6, oct = 5) {
    const wx = this.perlin(x * 0.7 + 13.1, y * 0.7 - 4.2) * warp;
    const wy = this.perlin(x * 0.7 - 8.6, y * 0.7 + 21.5) * warp;
    return this.fbm(x + wx, y + wy, oct);
  }

  /** F1 Worley distance, 0..~1. */
  worley(x, y) {
    this._ensureCells();
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let best = 8;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const h = this._hash(ix + ox, iy + oy);
        const cx = ix + ox + this._cells[h * 2];
        const cy = iy + oy + this._cells[h * 2 + 1];
        const dx = cx - x;
        const dy = cy - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  }

  /** F2-F1 Worley — cell walls, i.e. crack networks. */
  worleyEdge(x, y) {
    this._ensureCells();
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let b1 = 8;
    let b2 = 8;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const h = this._hash(ix + ox, iy + oy);
        const cx = ix + ox + this._cells[h * 2];
        const cy = iy + oy + this._cells[h * 2 + 1];
        const dx = cx - x;
        const dy = cy - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < b1) {
          b2 = b1;
          b1 = d;
        } else if (d < b2) b2 = d;
      }
    }
    return Math.min(1, b2 - b1);
  }

  /* ---------------- 3D (soldier / character builder) ---------------- */

  /** Perlin 3D, roughly [-1,1]. */
  n3(x, y, z) {
    const p = this.perm;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, B = p[X + 1] + Y;
    const AA = p[A] + Z, AB = p[A + 1] + Z;
    const BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = (h, dx, dy, dz) => {
      const q = G3[h % 12];
      return q[0] * dx + q[1] * dy + q[2] * dz;
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
        lerp(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
        lerp(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  /** fBm 3D, roughly -1..1. */
  fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n3(x * f, y * f, z * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return s / norm;
  }

  /** Billowed / ridged variant — good for cloth folds and rock. */
  ridge3(x, y, z, oct = 3) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * (1 - Math.abs(this.n3(x * f, y * f, z * f)) * 2);
      norm += a;
      a *= 0.5;
      f *= 2.07;
    }
    return s / norm;
  }
}

/**
 * Layered 1-D value noise with cubic interpolation (viewmodel sway).
 *
 * Idle sway needs to never visibly loop, so each octave gets its own
 * incommensurate rate and a table long enough that the pattern does not repeat
 * inside a play session. Sampling is a table lookup + a lerp: cheap enough to
 * run a dozen of these every frame.
 */
export class Noise1 {
  constructor(rng, size = 512) {
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

  at(x) {
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
  fbm(x, oct = 3, gain = 0.5) {
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
