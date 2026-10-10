import {
  Fn, If, abs, acos, clamp, degrees, dot, exp, float, floor, length, log, max,
  mix, normalize, pow, sin, smoothstep, step, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm3, skHash33 } from './noise.js';

/**
 * Night sky: a real starfield and a Milky Way band, both procedural — TSL port.
 *
 * "White dots on black" is the tell of a WebGL demo, so the authored detail is
 * preserved exactly: three density layers with a magnitude power law, blackbody
 * colour with the luminance normalised out, Kasten-Young airmass extinction,
 * airmass-weighted scintillation, and a Milky Way with fbm dust lanes.
 *
 * Radiance is in the same scene units as everything else, so on a bright
 * afternoon the stars are simply four orders of magnitude below the sky and
 * vanish on their own — there is no "hide the stars in daytime" switch.
 */

const SK_STAR_TINT = 0.11;

/** Galactic plane: pole and centre direction, in the equatorial frame. */
const SK_GAL_POLE = vec3(-0.4288, 0.7146, 0.5522);
const SK_GAL_CORE = vec3(0.7549, -0.2154, -0.6194);

/** Tanner Helland's blackbody fit, moved to linear light and normalised. */
const skBlackbody = Fn<[Node<'float'>], Node<'vec3'>>(([kelvin]) => {
  const t = clamp(kelvin, 1200, 40000).div(100);
  const r = float(1).toVar();
  If(t.greaterThan(66), () => {
    r.assign(clamp(float(1.29293619).mul(pow(t.sub(60), -0.13320476)), 0, 1));
  });
  const g = float(0).toVar();
  If(t.lessThanEqual(66), () => {
    g.assign(clamp(float(0.39008158).mul(log(t)).sub(0.63184144), 0, 1));
  }).Else(() => {
    g.assign(clamp(float(1.12989086).mul(pow(t.sub(60), -0.07551485)), 0, 1));
  });
  const b = float(1).toVar();
  If(t.lessThan(66), () => {
    If(t.lessThanEqual(19), () => {
      b.assign(0);
    }).Else(() => {
      b.assign(clamp(float(0.54320679).mul(log(t.sub(10))).sub(1.19625409), 0, 1));
    });
  });
  const c = vec3(r, g, b).pow(vec3(2.2));
  return c.div(max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722))));
});

/** Kasten-Young relative airmass. 1 overhead, ~38 at the horizon. */
const skAirmass = Fn<[Node<'float'>], Node<'float'>>(([cosZenith]) => {
  const z = degrees(acos(clamp(cosZenith, -1, 1)));
  return float(1).div(max(cosZenith, 0).add(
    float(0.50572).mul(pow(max(0, float(96.07995).sub(z)), -1.6364))
  ));
});

/**
 * One star per grid cell of a 3D lattice sampled on the unit sphere. Because
 * |dir * N| == N exactly, only one radial shell of cells is ever visited.
 */
interface StarLayerOptions { N: number; keep: number; gain: number; seed: number; sigma: number }
interface StarUniforms { x: Node<'float'>; y: Node<'float'>; z: Node<'float'>; w: Node<'float'> }
interface SkyStarUniforms { uStarParams: Node<'vec4'>; uCelestial: Node<'mat3'> }

const starLayer = ({ N, keep, gain, seed, sigma }: StarLayerOptions, uStarParams: StarUniforms) => Fn<[Node<'vec3'>, Node<'float'>, Node<'float'>], Node<'vec3'>>(([dir, twinkle, band]) => {
  const result = vec3(0).toVar();
  const cell = floor(dir.mul(N)).add(seed);
  const h = skHash33(cell);
  const exist = step(float(1).sub(keep), h.x);
  If(exist.greaterThan(0.5), () => {
    const h2 = skHash33(cell.add(91.7));
    const starDir = normalize(floor(dir.mul(N)).add(0.5).add(h2.sub(0.5).mul(0.94)));
    // sin(separation) — cheaper and better conditioned than acos near zero.
    const d = length(starDir.cross(dir));

    // Magnitude power law: most cells hold something you would never notice.
    const mag = pow(h.y, 5.5);
    const flux = float(gain).mul(mag.add(0.0016)).mul(float(1).add(band.mul(1.4)));

    // Core plus a faint diffraction skirt; the skirt is what makes the bright
    // ones read as stars rather than as dead pixels once bloom gets to them.
    const core = exp(d.mul(d).negate().div(sigma * sigma));
    const skirt = float(0.055).mul(exp(d.negate().div(sigma * 3.4)));

    const tw = float(1).add(twinkle.mul(
      sin(uStarParams.z.mul(float(7).add(h.z.mul(19))).add(h2.x.mul(43)))
        .add(float(0.6).mul(sin(uStarParams.z.mul(float(23).add(h2.y.mul(31))))))
    ));
    const kelvin = mix(2600, 22000, pow(h2.z, 1.9));
    // Normalised blackbody, pulled back toward white — see SK_STAR_TINT.
    const tint = mix(vec3(1), skBlackbody(kelvin), SK_STAR_TINT);
    result.assign(tint.mul(flux.mul(core.add(skirt)).mul(max(0, tw))));
  });
  return result;
});

const skMilkyWay = (octaves: number) => Fn<[Node<'vec3'>, Node<'float'>], Node<'vec3'>>(([eq, gain]) => {
  const lat = dot(eq, SK_GAL_POLE);
  // Two nested bands: a tight bright spine inside a broad halo.
  const spineBand = exp(pow(abs(lat).div(0.048), 1.55).negate());
  const halo = exp(pow(abs(lat).div(0.165), 1.30).negate());
  const band = clamp(spineBand.mul(0.78).add(halo.mul(0.48)), 0, 1.4);
  const col = vec3(0).toVar();
  If(band.greaterThan(0.002), () => {
    const toCore = dot(eq, SK_GAL_CORE);
    const bulge = exp(pow(max(0, float(1).sub(toCore)).div(0.22), 1.1).negate());
    const q = eq.mul(9.0);
    const clumps = fbm3(octaves)(q);
    // Dust lanes: a second, sharper field subtracted, biased to the spine.
    const dust = fbm3(Math.max(2, octaves - 1))(eq.mul(21.0).add(3.7));
    const lane = smoothstep(0.36, 0.68, dust).mul(spineBand);
    // High clump contrast is what separates a galaxy from a painted stripe.
    let density = band.mul(float(0.20).add(clumps.mul(clumps).mul(1.35)))
      .mul(float(1).sub(lane.mul(0.80)));
    density = density.mul(float(1).add(bulge.mul(2.6)));
    // Warm toward the obscured core, cool blue-white in the outer arms.
    const tint = mix(vec3(0.72, 0.80, 1.06), vec3(1.10, 0.86, 0.62), bulge.mul(0.85));
    col.assign(tint.mul(density.mul(gain)));
  });
  return col;
});

/**
 * Build the night-sky function. `points` chooses whether the three star layers
 * are compiled in (the environment bake skips them) and `mwOctaves` the Milky
 * Way octave count.
 */
export function createNightSkyNodes(shared: SkyStarUniforms, { points = true, mwOctaves = 5 }: { points?: boolean; mwOctaves?: number } = {}) {
  const { uStarParams, uCelestial } = shared;
  const milky = skMilkyWay(mwOctaves);
  const layers = points ? [
    starLayer({ N: 21.0, keep: 0.30, gain: 1.00, seed: 0.0, sigma: 0.00165 }, uStarParams),
    starLayer({ N: 43.0, keep: 0.20, gain: 0.34, seed: 13.0, sigma: 0.00145 }, uStarParams),
    starLayer({ N: 87.0, keep: 0.10, gain: 0.11, seed: 47.0, sigma: 0.00125 }, uStarParams),
  ] : null;

  return Fn<[Node<'vec3'>], Node<'vec3'>>(([dir]) => {
    // Shared inputs must be evaluated before the conditional star layers.
    // Otherwise TSL can first cache airmass inside one layer's `exist` branch
    // and reuse its zero-initialized temporary outside that branch, imprinting
    // the star-cell lattice on the entire Milky Way / airglow extinction.
    const eq = uCelestial.mul(dir).toVar();
    const am = skAirmass(dir.y).toVar();
    // Extinction ~0.16 mag/airmass in V, plus the horizon murk of a real city.
    const ext = exp(am.mul(-0.145)).mul(smoothstep(-0.03, 0.10, dir.y));
    const mw = clamp(dot(eq, SK_GAL_POLE), -1, 1);
    const band = exp(pow(abs(mw).div(0.16), 1.4).negate()).toVar();

    const col = milky(eq, uStarParams.w).toVar();
    if (points && layers) {
      const tw = uStarParams.y.mul(clamp(am.sub(1).mul(0.16), 0, 0.85)).toVar();
      col.addAssign(layers[0](eq, tw, band));
      col.addAssign(layers[1](eq, tw, band));
      col.addAssign(layers[2](eq, tw.mul(0.5), band.mul(2.2)));
    }

    // Airglow: real, faint, and greenish — it keeps the "empty" sky off zero.
    col.addAssign(vec3(0.55, 1.0, 0.78).mul(0.00030));
    return col.mul(uStarParams.x.mul(ext));
  });
}
