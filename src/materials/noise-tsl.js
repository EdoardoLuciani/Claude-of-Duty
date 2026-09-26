import { Fn, cos, dot, float, floor, fract, max, mix, mod, sin, vec2, vec3 } from 'three/tsl';

// Periodic, sin-free lattice hash from the authored GLSL noise stack. Wrapping
// the lattice (not the fractional coordinate) is what makes tile edges meet.
const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
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
export const fbm01 = (noise) => noise.mul(0.5).add(0.5);
