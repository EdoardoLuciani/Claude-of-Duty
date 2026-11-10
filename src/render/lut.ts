import * as THREE from 'three';

/** Procedural 33^3 RGBA8 grading LUT in display-referred space.
 * Chain: ASC-CDL, split tone, luminance-preserving saturation, highlight
 * desaturation, then a filmic S-curve about mid-grey.
 */

const SIZE = 33;
type GradeVector = readonly [number, number, number];
interface GradePreset {
  slope: GradeVector;
  offset: GradeVector;
  power: GradeVector;
  shadowTint: GradeVector;
  highlightTint: GradeVector;
  saturation: number;
  contrast: number;
  pivot: number;
  highlightDesat: number;
  toe: number;
  shoulder: number;
  shoulderSoft?: number;
}

const LUM: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export const GRADE_PRESETS = {
  // Neutral-but-cinematic default: slightly cool shadows, warm highlights,
  // a touch of contrast, mild highlight desaturation.
  default: {
    slope: [1.0, 0.995, 0.985],
    offset: [-0.004, -0.002, 0.004],
    power: [1.0, 1.005, 1.02],
    shadowTint: [-0.001, 0.006, 0.022],
    highlightTint: [0.03, 0.014, -0.006],
    // Display-space saturation compensates for AgX's desaturating transform and shoulder.
    saturation: 1.2,
    // Pivot at display code 0.5, where AgX maps 18% scene grey, to avoid an exposure lift.
    contrast: 1.28,
    pivot: 0.5,
    // Mild shoulder desaturation avoids neon speculars without bleaching the sky.
    highlightDesat: 0.1,
    // Toe lift in code values / 255: about two codes, retaining dark detail without a veil.
    toe: 0.008,
    // Display-space knee: roll off contrast outputs above 1 without flattening highlights.
    shoulder: 0.6,
    // Softness uses post-contrast units. Normalisation in shoulderParams makes
    // scurve(1) == 1 so display white remains reachable.
    shoulderSoft: 1.2,
  },
} satisfies Record<string, GradePreset>;
export type GradePresetName = keyof typeof GRADE_PRESETS;

/**
 * Shoulder constants for a preset: knee, softness, and the normaliser that
 * makes the curve land on 1.0 at input 1.0.
 */
function shoulderParams(g: GradePreset): { k: number; s: number; norm: number } {
  const k = Math.min(0.98, Math.max(0.05, g.shoulder));
  const s = Math.max(1e-3, g.shoulderSoft ?? 0.55 * (1 - k));
  // Largest post-contrast value an in-gamut input (1.0) can produce.
  const cMax = g.pivot * Math.pow(1 / g.pivot, g.contrast);
  const norm = 1 - Math.exp(-Math.max(cMax - k, 1e-3) / s);
  return { k, s, norm };
}

function applyGrade(
  rgb: GradeVector,
  g: GradePreset,
  sh: { k: number; s: number; norm: number }
): [number, number, number] {
  let r = rgb[0];
  let gg = rgb[1];
  let b = rgb[2];

  // ASC CDL: slope / offset / power
  r = Math.pow(Math.max(0, r * g.slope[0] + g.offset[0]), g.power[0]);
  gg = Math.pow(Math.max(0, gg * g.slope[1] + g.offset[1]), g.power[1]);
  b = Math.pow(Math.max(0, b * g.slope[2] + g.offset[2]), g.power[2]);

  // split toning by luminance
  const l = r * LUM[0] + gg * LUM[1] + b * LUM[2];
  const shadowW = Math.pow(1 - Math.min(1, l), 2.2);
  const highW = Math.pow(Math.min(1, l), 2.0);
  r += g.shadowTint[0] * shadowW + g.highlightTint[0] * highW;
  gg += g.shadowTint[1] * shadowW + g.highlightTint[1] * highW;
  b += g.shadowTint[2] * shadowW + g.highlightTint[2] * highW;

  // saturation about luminance
  const l2 = r * LUM[0] + gg * LUM[1] + b * LUM[2];
  r = l2 + (r - l2) * g.saturation;
  gg = l2 + (gg - l2) * g.saturation;
  b = l2 + (b - l2) * g.saturation;

  // highlights lose saturation the way film does
  const hd = g.highlightDesat * Math.pow(Math.min(1, Math.max(0, l2)), 3.0);
  r += (l2 - r) * hd;
  gg += (l2 - gg) * hd;
  b += (l2 - b) * hd;

  // Filmic S-curve with a lifted toe.
  const scurve = (x: number): number => {
    const t = Math.max(0, x);
    // contrast as a power about the pivot: the pivot itself never moves
    let c = t <= 0 ? 0 : g.pivot * Math.pow(t / g.pivot, g.contrast);
    // Normalise the soft shoulder by sh.norm to reach white at input 1.
    if (c > sh.k) {
      c = sh.k + (1 - sh.k) * ((1 - Math.exp(-(c - sh.k) / sh.s)) / sh.norm);
    }
    return g.toe + (1 - g.toe) * Math.min(1, Math.max(0, c));
  };
  return [scurve(r), scurve(gg), scurve(b)];
}

export function createGradeLut(preset: GradePresetName = 'default'): {
  texture: THREE.Data3DTexture;
  size: number;
} {
  const g = GRADE_PRESETS[preset];
  const sh = shoulderParams(g);
  const n = SIZE;
  const data = new Uint8Array(n * n * n * 4);
  let p = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inp: GradeVector = [x / (n - 1), y / (n - 1), z / (n - 1)];
        const out = applyGrade(inp, g, sh);
        data[p++] = Math.round(Math.min(1, Math.max(0, out[0])) * 255);
        data[p++] = Math.round(Math.min(1, Math.max(0, out[1])) * 255);
        data[p++] = Math.round(Math.min(1, Math.max(0, out[2])) * 255);
        data[p++] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = 'ow-grade-lut';
  return { texture: tex, size: n };
}
