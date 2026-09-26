/** Shared authored material defaults for both the legacy and TSL paths. */
export const DEFAULT_PARAMS = {
  uvMode: 'planar', // dominant world axis | triplanar | mesh UV
  localSpace: false,
  scale: 2, // metres per tile in projected modes; repeat in mesh mode
  offset: [0, 0],
  parallax: 0,
  parallaxFade: [6, 14],
  parallaxLayers: 22,
  detail: [11, 0.55, 0.35, 16],
  // Detail grain stays at 0.26 m even on differently sized props. Set to 0 to
  // use detail[0] instead (the viewmodel needs a much smaller micro tooth).
  detailWorld: 0.26,
  macro: [0.045, 0.35, 0.1, 0.35],
  macroBig: [1, 0, 0.03, 0], // contrast, amplitude, world scale, reserved
  patch: [0, 2.6, 0.12, -0.08], // coverage, cell m, tint delta, rough delta
  cloth: [0, 1, 0, 0], // light transmission, underside, fold, reserved
  macroRelief: 0,
  detile: 0,
  weather: [0.35, 0.3, 0.55, 0.4], // dust, rain, splash, cavity
  groundY: 0,
  wear: [0.5, 0.7, 0.5, 0], // vertex R/G/B, reserved
  // Non-metal substrates must never acquire a metallic wear layer by default.
  wearMaterial: [0.42, 0.0, 0, 0.5],
  wearColor: 0x8d8b86,
  dustColor: 0x6b6154,
  grimeColor: 0x2a2620,
  rustColor: 0x6d3a1c,
  tint: 0xffffff,
  normalStrength: 1,
  roughness: [1, 0, 0.06], // scale, offset, minimum
  aoStrength: 1,
  alphaMask: false,
  vertexMasks: false,
  noGrad: false,
};
