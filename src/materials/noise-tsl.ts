import { Fn, If, Loop, abs, clamp, cos, dot, float, floor, fract, int, max, min, mix,
  mod, normalize, sin, smoothstep, sqrt, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type NamedLoopSpec = { start: Node<'int'>; end: Node<'int'>; name: 'x' | 'y'; condition: '<=' };
type NamedLoopVariables = { x: Node<'int'>; y: Node<'int'> };
const namedLoop = Loop as unknown as (spec: NamedLoopSpec, callback: (variables: NamedLoopVariables) => void) => void;

// Periodic, sin-free lattice hash from the authored GLSL noise stack. Wrapping
// the lattice (not the fractional coordinate) is what makes tile edges meet.
export const hash11 = Fn<[Node<'float'>], Node<'float'>>(([input]) => {
  const p = fract(input.mul(0.1031)).toVar();
  p.mulAssign(p.add(33.33));
  p.mulAssign(p.add(p));
  return fract(p);
});

// Explicit layouts emit reusable shader functions instead of expanding the
// lattice arithmetic into every octave/cell and rebuilding that TSL graph.
export const hash42 = Fn<[Node<'vec2'>], Node<'vec4'>>(([p]) => {
  const p4 = fract(vec4(p.xy, p.xy).mul(vec4(0.1031, 0.1030, 0.0973, 0.1099))).toVar();
  p4.addAssign(dot(p4, p4.wzxy.add(33.33)));
  return fract(p4.xxyz.add(p4.yzzw).mul(p4.zywx));
}).setLayout({ name: 'ow_hash42', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }] });

export const hash12 = Fn<[Node<'vec2'>], Node<'float'>>(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ow_hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const hash22 = Fn<[Node<'vec2'>], Node<'vec2'>>(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'ow_hash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

const grad2 = Fn<[Node<'vec2'>, Node<'vec2'>], Node<'vec2'>>(([i, period]) => {
  const angle = hash12(mod(i, period).add(0.317)).mul(6.28318530718);
  return vec2(cos(angle), sin(angle));
}).setLayout({ name: 'ow_grad2', type: 'vec2', inputs: [
  { name: 'i', type: 'vec2' }, { name: 'period', type: 'vec2' },
] });

export const periodicNoise = Fn<[Node<'vec2'>, Node<'vec2'>], Node<'float'>>(([p, period]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const a = dot(grad2(i, period), f);
  const b = dot(grad2(i.add(vec2(1, 0)), period), f.sub(vec2(1, 0)));
  const c = dot(grad2(i.add(vec2(0, 1)), period), f.sub(vec2(0, 1)));
  const d = dot(grad2(i.add(vec2(1, 1)), period), f.sub(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4142);
}).setLayout({ name: 'ow_periodicNoise', type: 'float', inputs: [
  { name: 'p', type: 'vec2' }, { name: 'period', type: 'vec2' },
] });

// Octave count is fixed at graph construction, not a dynamic per-fragment loop.
function fbm(octaves: number) {
  return Fn<[Node<'vec2'>, Node<'vec2'>, Node<'float'>], Node<'float'>>(([p, period, gain]) => {
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
export const fbm01 = (noise: Node<'float'>) => noise.mul(0.5).add(0.5);

function shapedFbm(octaves: number, billowy: boolean) {
  return Fn<[Node<'vec2'>, Node<'vec2'>, Node<'float'>], Node<'float'>>(([p, period, gain]) => {
    const frequency = p.toVar(), tile = period.toVar();
    const amplitude = float(0.5).toVar(), sum = float(0).toVar();
    const weight = float(0).toVar();
    for (let i = 0; i < octaves; i++) {
      const n = periodicNoise(frequency, tile);
      const shape = billowy ? abs(n) : float(1).sub(abs(n)).pow(2);
      sum.addAssign(amplitude.mul(shape));
      weight.addAssign(amplitude);
      frequency.mulAssign(2);
      tile.mulAssign(2);
      amplitude.mulAssign(gain);
    }
    return sum.div(max(weight, 0.0001));
  });
}
export const billow5 = shapedFbm(5, true);
export const ridged4 = shapedFbm(4, false);
export const ridged5 = shapedFbm(5, false);

// Returns F1, F2 and the two id hashes of the closest periodic cell.
export const worley = Fn<[Node<'vec2'>, Node<'vec2'>, Node<'float'>], Node<'vec4'>>(([p, period, jitter]) => {
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

export const warp = (p: Node<'vec2'>, period: Node<'vec2'>, amount: Node<'float'> | number, octaves = 3) => {
  const noise = octaves === 4 ? fbm4 : fbm3;
  return p.add(vec2(
    noise(p.add(vec2(1.7, 9.2)), period, 0.5),
    noise(p.add(vec2(8.3, 2.8)), period, 0.5)
  ).mul(amount));
};

// Two-pass periodic Voronoi edge distance (Quilez), used for physical cracks.
export const voronoiEdge = Fn<[Node<'vec2'>, Node<'vec2'>, Node<'float'>], Node<'float'>>(([p, period, jitter]) => {
  const ip = floor(p), fp = fract(p);
  const nearest = vec2(0).toVar(), cellOffset = vec2(0).toVar();
  const minDistance = float(8).toVar();
  namedLoop({ start: int(-1), end: int(1), name: 'y', condition: '<=' }, ({ y }) => {
    namedLoop({ start: int(-1), end: int(1), name: 'x', condition: '<=' }, ({ x }) => {
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
  namedLoop({ start: int(-2), end: int(2), name: 'y', condition: '<=' }, ({ y }) => {
    namedLoop({ start: int(-2), end: int(2), name: 'x', condition: '<=' }, ({ x }) => {
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

export const cracks = (p: Node<'vec2'>, period: Node<'vec2'>, jitter: Node<'float'> | number, width: Node<'float'> | number, breakUp: Node<'float'> | number) => {
  const e = voronoiEdge(warp(p, period, 0.20), period, jitter);
  const line = smoothstep(0, width, e).oneMinus();
  const mask = fbm01(fbm4(p.mul(1.7).add(11.3), period.mul(1.7), 0.55));
  const breakUpNode = typeof breakUp === 'number' ? float(breakUp) : breakUp;
  return clamp(line.mul(smoothstep(breakUpNode, breakUpNode.add(0.28), mask)), 0, 1);
};

export const shear = (p: Node<'vec2'>, slope: Node<'float'> | number, stretch: Node<'float'> | number) =>
  vec2(p.x.add(p.y.mul(slope)), p.y.mul(stretch));
export const shearPeriod = (period: Node<'vec2'>, stretch: Node<'float'> | number) => vec2(period.x, period.y.mul(stretch));

export const scratches = (p: Node<'vec2'>, period: Node<'vec2'>, stretch: Node<'float'> | number, slope: Node<'float'> | number, thin: Node<'float'> | number) => {
  const q = shear(p, slope, stretch);
  const tile = shearPeriod(period, stretch);
  const n = fbm01(fbm4(q, tile, 0.5));
  const edge = typeof thin === 'number' ? float(thin) : thin;
  return smoothstep(edge, edge.add(0.06), n)
    .mul(smoothstep(edge.add(0.06), edge.add(0.2), n).oneMinus());
};
