import { Fn, If, Loop, clamp, cos, dot, float, floor, fract, int, max, min, mix,
  mod, normalize, sin, smoothstep, sqrt, vec2, vec3, vec4 } from 'three/tsl';

// Periodic, sin-free lattice hash from the authored GLSL noise stack. Wrapping
// the lattice (not the fractional coordinate) is what makes tile edges meet.
const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

const hash22 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.xx.add(p3.yz).mul(p3.zy));
});

const grad2 = Fn(([i, period]) => {
  const angle = hash12(mod(i, period).add(0.317)).mul(6.28318530718);
  return vec2(cos(angle), sin(angle));
});

export const periodicNoise = Fn(([p, period]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const a = dot(grad2(i, period), f);
  const b = dot(grad2(i.add(vec2(1, 0)), period), f.sub(vec2(1, 0)));
  const c = dot(grad2(i.add(vec2(0, 1)), period), f.sub(vec2(0, 1)));
  const d = dot(grad2(i.add(vec2(1, 1)), period), f.sub(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4142);
});

// Octave count is fixed at graph construction, not a dynamic per-fragment loop.
function fbm(octaves) {
  return Fn(([p, period, gain]) => {
    const frequency = p.toVar();
    const tile = period.toVar();
    const amplitude = float(0.5).toVar();
    const sum = float(0).toVar();
    const weight = float(0).toVar();
    for (let i = 0; i < octaves; i++) {
      sum.addAssign(amplitude.mul(periodicNoise(frequency, tile)));
      weight.addAssign(amplitude);
      frequency.mulAssign(2);
      tile.mulAssign(2);
      amplitude.mulAssign(gain);
    }
    return sum.div(max(weight, 0.0001));
  });
}

export const fbm3 = fbm(3);
export const fbm4 = fbm(4);
export const fbm5 = fbm(5);
export const fbm01 = (noise) => noise.mul(0.5).add(0.5);

// Returns F1, F2 and the two id hashes of the closest periodic cell.
export const worley = Fn(([p, period, jitter]) => {
  const ip = floor(p), fp = fract(p);
  const f1 = float(8).toVar(), f2 = float(8).toVar();
  const id = vec2(0).toVar();
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const g = vec2(x, y);
    const cell = mod(ip.add(g), period);
    const offset = hash22(cell.add(0.771)).mul(jitter).add(float(1).sub(jitter).mul(0.5));
    const r = g.add(offset).sub(fp);
    const d = dot(r, r);
    const closer = d.lessThan(f1);
    f2.assign(closer.select(f1, min(f2, d)));
    id.assign(closer.select(hash22(cell.add(3.117)), id));
    f1.assign(min(f1, d));
  }
  return vec4(sqrt(f1), sqrt(f2), id);
});

export const warp = (p, period, amount) => p.add(vec2(
  fbm3(p.add(vec2(1.7, 9.2)), period, 0.5),
  fbm3(p.add(vec2(8.3, 2.8)), period, 0.5)
).mul(amount));

// Two-pass periodic Voronoi edge distance (Quilez), used for physical cracks.
export const voronoiEdge = Fn(([p, period, jitter]) => {
  const ip = floor(p), fp = fract(p);
  const nearest = vec2(0).toVar(), cellOffset = vec2(0).toVar();
  const minDistance = float(8).toVar();
  Loop({ start: int(-1), end: int(1), name: 'y', condition: '<=' }, ({ y }) => {
    Loop({ start: int(-1), end: int(1), name: 'x', condition: '<=' }, ({ x }) => {
      const g = vec2(float(x), float(y));
      const o = hash22(mod(ip.add(g), period).add(0.771)).mul(jitter)
        .add(float(1).sub(jitter).mul(0.5));
      const r = g.add(o).sub(fp);
      const d = dot(r, r);
      If(d.lessThan(minDistance), () => {
        minDistance.assign(d);
        nearest.assign(r);
        cellOffset.assign(g);
      });
    });
  });
  minDistance.assign(8);
  Loop({ start: int(-2), end: int(2), name: 'y', condition: '<=' }, ({ y }) => {
    Loop({ start: int(-2), end: int(2), name: 'x', condition: '<=' }, ({ x }) => {
      const g = cellOffset.add(vec2(float(x), float(y)));
      const o = hash22(mod(ip.add(g), period).add(0.771)).mul(jitter)
        .add(float(1).sub(jitter).mul(0.5));
      const r = g.add(o).sub(fp);
      const diff = r.sub(nearest);
      If(dot(diff, diff).greaterThan(1e-5), () => {
        minDistance.assign(min(minDistance,
          dot(nearest.add(r).mul(0.5), normalize(diff))));
      });
    });
  });
  return minDistance;
});

export const cracks = (p, period, jitter, width, breakUp) => {
  const e = voronoiEdge(warp(p, period, 0.20), period, jitter);
  const line = smoothstep(0, width, e).oneMinus();
  const mask = fbm01(fbm4(p.mul(1.7).add(11.3), period.mul(1.7), 0.55));
  return clamp(line.mul(smoothstep(breakUp, breakUp + 0.28, mask)), 0, 1);
};

export const scratches = (p, period, stretch, shear, thin) => {
  const q = vec2(p.x.add(p.y.mul(shear)), p.y.mul(stretch));
  const tile = vec2(period.x, period.y.mul(stretch));
  const n = fbm01(fbm4(q, tile, 0.5));
  return smoothstep(thin, thin + 0.06, n)
    .mul(smoothstep(thin + 0.06, thin + 0.2, n).oneMinus());
};
