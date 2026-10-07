import { Fn, dot, float, fract, max, mix, vec2, vec3 } from 'three/tsl';

/**
 * Procedural noise shared by the stars, the clouds and the fog — the TSL port
 * of the GLSL that used to live here. Every consumer references these same
 * functions, so the clouds in the sky and the cloud shadows in the fog cannot
 * disagree.
 *
 * Octave counts are compile-time constants: `fbm2(5)` returns a `Fn` whose JS
 * loop is unrolled while the node graph is built. A caller that wants a
 * different count (the environment bake uses fewer) asks for a different
 * function; there is no runtime octave argument, exactly like the shader this
 * replaces.
 */

const rot2 = (p) => vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8)));

// Share pure shader functions across octaves and consumers. Keep the authored
// arithmetic and octave counts; only the TSL/WGSL expansion changes.
export const skHash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ow_skHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const skHash13 = Fn(([p]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
}).setLayout({ name: 'ow_skHash13', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

export const skHash33 = Fn(([p]) => {
  const q = fract(p.mul(vec3(0.1031, 0.11369, 0.13787))).toVar();
  q.addAssign(dot(q, q.yxz.add(19.19)));
  return fract(vec3(
    q.x.add(q.y).mul(q.z),
    q.x.add(q.z).mul(q.y),
    q.y.add(q.z).mul(q.x)
  ));
}).setLayout({ name: 'ow_skHash33', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] });

/** Interleaved gradient noise (Jimenez) — the right dither for a raymarch. */
export const skIGN = Fn(([p]) =>
  fract(fract(dot(p, vec2(0.06711056, 0.00583715))).mul(52.9829189))
).setLayout({ name: 'ow_skIGN', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const skVal2 = Fn(([p]) => {
  const i = p.floor().toVar();
  const f0 = p.fract().toVar();
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  return mix(
    mix(skHash12(i), skHash12(i.add(vec2(1, 0))), f.x),
    mix(skHash12(i.add(vec2(0, 1))), skHash12(i.add(vec2(1, 1))), f.x),
    f.y
  );
}).setLayout({ name: 'ow_skVal2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const skVal3 = Fn(([p]) => {
  const i = p.floor().toVar();
  const f0 = p.fract().toVar();
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  return mix(
    mix(
      mix(skHash13(i), skHash13(i.add(vec3(1, 0, 0))), f.x),
      mix(skHash13(i.add(vec3(0, 1, 0))), skHash13(i.add(vec3(1, 1, 0))), f.x),
      f.y
    ),
    mix(
      mix(skHash13(i.add(vec3(0, 0, 1))), skHash13(i.add(vec3(1, 0, 1))), f.x),
      mix(skHash13(i.add(vec3(0, 1, 1))), skHash13(i.add(vec3(1, 1, 1))), f.x),
      f.y
    ),
    f.z
  );
}).setLayout({ name: 'ow_skVal3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

export const fbm2 = (octaves) => Fn(([p]) => {
  const a = float(0.5).toVar();
  const s = float(0).toVar();
  const n = float(0).toVar();
  const q = p.toVar();
  for (let i = 0; i < octaves; i++) {
    s.addAssign(a.mul(skVal2(q)));
    n.addAssign(a);
    q.assign(rot2(q).mul(2.04).add(7.13));
    a.mulAssign(0.5);
  }
  return s.div(max(n, 1e-4));
});

/** Ridged variant — fibrous cirrus streaks and wind-torn fog wisps. */
export const ridge2 = (octaves) => Fn(([p]) => {
  const a = float(0.5).toVar();
  const s = float(0).toVar();
  const n = float(0).toVar();
  const q = p.toVar();
  for (let i = 0; i < octaves; i++) {
    s.addAssign(a.mul(skVal2(q).mul(2).sub(1).abs().oneMinus()));
    n.addAssign(a);
    q.assign(rot2(q).mul(2.11).add(3.71));
    a.mulAssign(0.52);
  }
  return s.div(max(n, 1e-4));
});

export const fbm3 = (octaves) => Fn(([p]) => {
  const a = float(0.5).toVar();
  const s = float(0).toVar();
  const n = float(0).toVar();
  const q = p.toVar();
  for (let i = 0; i < octaves; i++) {
    s.addAssign(a.mul(skVal3(q)));
    n.addAssign(a);
    q.assign(q.mul(2.07).add(vec3(11.3, 5.1, 7.7)));
    a.mulAssign(0.5);
  }
  return s.div(max(n, 1e-4));
});

export { rot2 };
