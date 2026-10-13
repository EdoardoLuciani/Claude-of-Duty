import * as THREE from 'three';

/**
 * Authored finishes for procedural weapon geometry (gameplay shotgun; legacy
 * model previews). Native M4/MCX/P320/EVOLYS/MPX/AX338 preserve their GLB finishes.
 * Player gloves/sleeves come from Blender arms.glb, never these recipes.
 *
 * Tint is a linear multiplier of the baked base: dielectric albedo or conductor
 * F0. These finishes are stylized recipes, not measured optical constants.
 * Do not use historical tone-mapped pixels to compensate for current lighting.
 * Keep hand-held texel density, cavity grime and geometry-driven edge wear.
 */

// Finish variation follows object space; rain/splash/dust are disabled.
const BASE = {
  uvMode: 'triplanar',
  localSpace: true,
  vertexMasks: true,
  weather: [0, 0, 0, 0.62],
  macro: [0.55, 0.05, 0.07, 0.06],
  aoStrength: 1,
};
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
export const WEAPON_MATERIALS = {
  // Matte oxide approximation over a dielectric base; chipped corners expose alloy.
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
  // Finer bead-blasted coating for optic housings, not a different light budget.
  alu_fine: [
    'rubber',
    {
      ...BASE,
      bake: { size: 1024, seed: 733, relief: 0.0025 },
      scale: 0.038,
       tint: c(0.135, 0.144, 0.165),
      roughness: [0.56, 0.07, 0.26],
      normalStrength: 1.15,
      detail: [30, 0.85, 0.6, 4],
      wear: [0.18, 0.5, 0.5, 0],
      wearColor: 0x40444a,
      wearMaterial: [0.5, 0.8, 0, 0.75],
      grimeColor: 0x0b0a08,
      three: { physical: true, specularIntensity: 0.08 },
    },
  ],
  // Stylized phosphate finish: dark conductor with polished wear.
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
  // Carbon deposit is diffuse-dominant; retain a little exposed-metal response.
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
  // Oiled metal with restrained highlights; base tint controls F0.
  steel_bright: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.05,
      tint: c(0.155, 0.155, 0.164),
      roughness: [0.5, 0.44, 0.58],
      normalStrength: 1.0,
      detail: [12, 0.8, 0.3, 5],
      wear: [0.16, 0.45, 0.4, 0],
      wearColor: 0x5c6066,
      wearMaterial: [0.18, 1.0, 0, 0.6],
      grimeColor: 0x0a0806,
      three: { anisotropy: 0.12 },
    },
  ],
  // Dark nitrided conductor, distinct from a painted dielectric coating.
  steel_black: [
    'metal_brushed',
    {
      ...BASE,
      bake: { size: 512, seed: 829, relief: 0.004 },
      scale: 0.07,
      tint: c(0.155, 0.158, 0.165),
      roughness: [0.56, 0.14, 0.36],
      normalStrength: 0.95,
      detail: [18, 0.7, 0.3, 5],
      wear: [0.24, 0.5, 0.5, 0],
      wearColor: 0x6a6f75,
      wearMaterial: [0.22, 1.0, 0, 0.75],
      grimeColor: 0x0a0806,
      three: { anisotropy: 0.14 },
    },
  ],
  // Moulded dielectric furniture with stipple and non-metallic wear.
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
  // FDE pigment variant of the same dielectric furniture.
  polymer_tan: [
    'rubber',
    {
      ...BASE,
      bake: { seed: 131 },
      scale: 0.08,
      tint: c(0.62, 0.498, 0.358),
      roughness: [0.63, 0.16, 0.3],
      normalStrength: 1.2,
      detail: [24, 1.0, 0.5, 5],
      wear: [0.24, 0.7, 0.5, 0],
      wearColor: 0x5c5340,
      wearMaterial: [0.44, 0.0, 0, 0.5],
      grimeColor: 0x0f0c08,
      three: { physical: true, specularIntensity: 0.14 },
    },
  ],
  // Matte overmould/eyecup. Low specular is an authored grazing policy, not IOR.
  rubber: [
    'rubber',
    {
      ...BASE,
      bake: { seed: 211 },
      scale: 0.055,
      tint: c(0.147, 0.137, 0.127),
      roughness: [0.86, 0.04, 0.55],
      normalStrength: 1.35,
      detail: [14, 1.0, 0.55, 5],
      wear: [0.22, 0.8, 0.6, 0],
      wearColor: 0x24262a,
      wearMaterial: [0.72, 0.0, 0, 0.35],
      grimeColor: 0x0a0908,
      weather: [0, 0, 0, 0.55],
      three: { physical: true, specularIntensity: 0.12 },
    },
  ],
  // Warm conductor; tint may exceed one because it multiplies a dark baked base.
  brass: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.05,
      tint: c(2.3, 1.58, 0.74),
      roughness: [0.55, 0.16, 0.36],
      normalStrength: 0.75,
      detail: [10, 0.55, 0.28, 4],
      wear: [0.8, 0.3, 0.3, 0],
      wearColor: 0xe8c98a,
      wearMaterial: [0.12, 1.0, 0, 0.8],
      three: { anisotropy: 0.05 },
    },
  ],
  // Projectile-jacket conductor, separate from brass.
  copper: [
    'metal_brushed',
    {
      ...BASE,
      scale: 0.04,
      tint: c(2.25, 1.4, 1.09),
      roughness: [0.6, 0.18, 0.34],
      normalStrength: 0.75,
      detail: [10, 0.55, 0.28, 4],
      wear: [0.5, 0.3, 0.3, 0],
      wearColor: 0xd9a271,
      wearMaterial: [0.2, 1.0, 0, 0.8],
      three: { anisotropy: 0.05 },
    },
  ],
};
