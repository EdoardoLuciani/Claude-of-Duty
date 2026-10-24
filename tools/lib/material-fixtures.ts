import { Color } from 'three';

/** Frozen dry surface recipes for shader calibration, not gameplay weapon materials. */
const BASE = {
  uvMode: 'triplanar',
  localSpace: true,
  vertexMasks: true,
  weather: [0, 0, 0, 0.62],
  macro: [0.55, 0.05, 0.07, 0.06],
  aoStrength: 1,
};
const c = (r: number, g: number, b: number): Color => new Color(r, g, b);
export const SURFACE_FIXTURES = {
  alu: [
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 601, relief: 0.005 },
      scale: 0.095,
      tint: c(0.285, 0.302, 0.349),
      roughness: [0.66, 0.09, 0.24],
      three: { physical: true, specularIntensity: 0.11 },
      normalStrength: 1.5,
      detail: [22, 1.2, 0.72, 5],
      wear: [0.2, 0.6, 0.5, 0],
      wearColor: 0x34383d,
      wearMaterial: [0.54, 0.8, 0, 0.8],
      grimeColor: 0x0b0a08,
    },
  ],
  polymer: [
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 149, relief: 0.009 },
      scale: 0.055,
      tint: c(0.224, 0.211, 0.192),
      roughness: [0.63, 0.15, 0.3],
      normalStrength: 1.5,
      detail: [26, 1.15, 0.55, 6],
      wear: [0.26, 0.6, 0.5, 0],
      wearColor: 0x3e4145,
      wearMaterial: [0.46, 0.0, 0, 0.5],
      grimeColor: 0x0b0a08,
      three: { physical: true, specularIntensity: 0.13 },
    },
  ],
  steel: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 617, relief: 0.006 },
      scale: 0.12,
      tint: c(0.17, 0.162, 0.152),
      roughness: [0.66, 0.24, 0.42],
      normalStrength: 1.2,
      detail: [13, 0.95, 0.42, 5],
      wear: [0.16, 0.55, 0.5, 0],
      wearColor: 0x62666b,
      wearMaterial: [0.26, 1.0, 0, 0.7],
      grimeColor: 0x0c0a07,
      three: { anisotropy: 0.1 },
    },
  ],
  steel_soot: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 617, relief: 0.006 },
      scale: 0.1,
      tint: c(0.022, 0.02, 0.018),
      roughness: [0.42, 0.5, 0.8],
      normalStrength: 1.3,
      detail: [15, 1.0, 0.5, 5],
      wear: [0.06, 0.7, 0.55, 0],
      wearColor: 0x3a3c3e,
      wearMaterial: [0.55, 1.0, 0, 0.6],
      grimeColor: 0x070604,
      weather: [0, 0, 0, 0.75],
      three: { physical: true, metalness: 0.12, specularIntensity: 0.1, anisotropy: 0.06 },
    },
  ],
};
