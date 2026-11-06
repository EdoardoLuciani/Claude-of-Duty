import type { MaterialSystemNode } from '../materials/index.ts';

/** Canonical world finishes/variants; meshes sharing a key can batch together.
 * surface controls impacts; optional ballisticSurface describes the underlying structure.
 * Only sheetThickness authorises single-sided sheets. Tint multiplies linear baked albedo.
 */
export const PALETTE = {
  // architecture
  plaster_cream: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: { vertexMasks: true, tint: 0xcfc0a4, scale: 2.35, weather: [0.4, 0.5, 1.4, 0.55] },
  },
  plaster_sand: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: { vertexMasks: true, tint: 0xb9a582, scale: 2.1, weather: [0.45, 0.5, 1.5, 0.6] },
  },
  plaster_blue: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: { vertexMasks: true, tint: 0x8f9aa0, scale: 2.2, weather: [0.4, 0.55, 1.5, 0.6] },
  },
  plaster_pink: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: { vertexMasks: true, tint: 0xc09a86, scale: 2.5, weather: [0.45, 0.5, 1.3, 0.55] },
  },
  plaster_white: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: { vertexMasks: true, tint: 0xd8d2c4, scale: 1.9, weather: [0.3, 0.35, 0.9, 0.5] },
  },
  brick: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa8846c, scale: 1.3 },
  },
  /** Hollow clay block exposed where the render has spalled off. */
  brick_fine: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9c8068, scale: 0.62, weather: [0.45, 0.5, 0.8, 0.6] },
  },
  concrete: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a49a, scale: 2.5 },
  },
  /** Tighter tiling preserves visible concrete texture on sub-metre props. */
  concrete_prop: {
    name: 'concrete',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0xa5a096,
      scale: 0.9,
      normalStrength: 1.3,
      weather: [0.45, 0.5, 0.35, 0.55],
    },
  },
  concrete_dark: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x7d7a73, scale: 2.2, weather: [0.4, 0.6, 1.2, 0.6] },
  },
  /** Roof screed: flat, sand-dusted, and the biggest surface in any skyline. */
  roof_screed: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xb5a992, scale: 2.8, weather: [0.6, 0.2, 0.3, 0.45] },
  },
  floor_concrete: {
    name: 'concrete_floor',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9e9a91, scale: 3.0 },
  },
  tile_floor: {
    name: 'tile',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a08d, scale: 1.4 },
  },

  // ground
  /** Sand-buried tarmac: warm compacted earth, with asphalt exposed in tyre ruts. */
  road_dust: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xc9b896,
      // 2.2 m tiling resolves 25-45 mm aggregate and puts macro relief on ruts.
      scale: 2.2,
      // Suppress visible tiling along long streets.
      detile: 0.9,
      // .w is cavity grime; keep it low to avoid over-darkening every aggregate gap.
      weather: [0.4, 0.04, 0.08, 0.14],
      // Disable prop-edge wear: it would brighten every road stone crown.
      wear: [0, 0.5, 0.45, 0],
    },
  },
  asphalt: {
    name: 'asphalt',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9d968a, scale: 3.2, detile: 0.6, wear: [0, 0.55, 0.45, 0] },
  },
  /** Polished, oil-stained driving line; darker than road_dust so ruts remain visible. */
  road_rut: {
    name: 'asphalt',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0x6f6a62,
      scale: 1.5,
      detile: 0.7,
      weather: [0.3, 0.5, 0.15, 0.28],
      wear: [0, 0.55, 0.45, 0],
    },
  },
  sand: {
    name: 'sand',
    surface: 'sand',
    opts: { vertexMasks: true, scale: 2.6, detile: 0.7, wear: [0, 0.45, 0.45, 0] },
  },
  dirt: {
    name: 'dirt',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 2.4, detile: 0.8, wear: [0, 0.5, 0.45, 0] },
  },
  gravel: {
    name: 'gravel',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 1.8, wear: [0, 0.5, 0.45, 0] },
  },
  /** Contact grit (Assembler.put / props.dustSkirt) shares the road's gravel
   * generator, with darker, greyer tint and contact-line grime rather than mud cracks.
   */
  dust_skirt: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xa89d86,
      scale: 1.1,
      weather: [0.3, 0.0, 0.0, 0.16],
      wear: [0, 0.9, 0.7, 0],
    },
  },

  // metal
  metal_rust: { name: 'metal_rust', surface: 'metal', opts: { vertexMasks: true, scale: 1.1 } },
  /** Sub-metre rust tiling resolves texture on drums and buckets at eye level. */
  metal_rust_prop: {
    name: 'metal_rust',
    surface: 'metal',
    opts: {
      vertexMasks: true,
      tint: 0x9d7c66,
      scale: 0.4,
      normalStrength: 1.35,
      weather: [0.5, 0.35, 0.3, 0.5],
    },
  },
  metal_blue: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x6d8390, scale: 1.3 },
  },
  metal_green: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x76806a, scale: 1.3 },
  },
  metal_dark: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x4a4a48, scale: 1.0 },
  },
  steel: { name: 'metal_brushed', surface: 'metal', opts: { vertexMasks: true, scale: 0.9 } },
  corrugated: {
    name: 'corrugated',
    surface: 'metal',
    sheetThickness: 0.002,
    opts: { vertexMasks: true, scale: 2.2 },
  },

  // organic
  wood: { name: 'wood', surface: 'wood', opts: { vertexMasks: true, scale: 1.8 } },
  /** ~0.5 m timber tiling keeps grain and saw marks visible on crate slats and planks. */
  wood_prop: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0xb08a5e,
      scale: 0.55,
      normalStrength: 1.45,
      weather: [0.35, 0.3, 0.35, 0.5],
    },
  },
  wood_prop_dark: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0x7d6244,
      scale: 0.5,
      normalStrength: 1.45,
      weather: [0.35, 0.35, 0.4, 0.55],
    },
  },
  wood_dark: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x8a6a4a, scale: 1.5 },
  },
  wood_pale: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0xc0a482, scale: 1.2 },
  },
  fabric_red: {
    name: 'fabric',
    surface: 'fabric',
    sheetThickness: 0.002,
    opts: { vertexMasks: true, tint: 0xa2564a, scale: 0.26, three: { side: 2 } },
  },
  fabric_teal: {
    name: 'fabric',
    surface: 'fabric',
    sheetThickness: 0.002,
    opts: { vertexMasks: true, tint: 0x5f8a8c, scale: 0.26, three: { side: 2 } },
  },
  fabric_cream: {
    name: 'fabric',
    surface: 'fabric',
    sheetThickness: 0.002,
    opts: { vertexMasks: true, tint: 0xbcb298, scale: 0.26, three: { side: 2 } },
  },
  /** Fine hessian weave avoids oversized fibres on repeated sandbags.
   * Filled hessian is a 0.18-0.24 linear mid-tone, darker than plaster and road dust.
   */
  burlap: {
    name: 'burlap',
    surface: 'fabric',
    sheetThickness: 0.002,
    opts: { vertexMasks: true, tint: 0xa2957a, scale: 0.16, weather: [0.5, 0.3, 0.4, 0.5] },
  },
  rubber: { name: 'rubber', surface: 'rubber', opts: { vertexMasks: true, scale: 0.45 } },
  glass: { name: 'glass', surface: 'glass', opts: { scale: 2.0 } },
  foliage: { name: 'foliage', surface: 'foliage', opts: { vertexMasks: true } },

  // apertures
  /** Dark plaster backing 15-25 cm behind glass provides reveal shadows and parallax.
   * Linear albedo is ~0.03 after tint multiplication, retaining texture in unlit rooms.
   */
  window_void: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x474441,
      scale: 1.1,
      roughness: [1.0, 0.15],
      weather: [0.2, 0.7, 0.2, 0.7],
    },
  },
  /** Non-enterable interior, a stop above window_void for readable doors and breaches. */
  interior_shell: {
    name: 'plaster',
    surface: 'plaster',
    ballisticSurface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0x5f5b56,
      scale: 1.6,
      roughness: [1.0, 0.1],
      weather: [0.25, 0.8, 0.3, 0.65],
    },
  },
  /** Separate from bottle glass so low roughness and sky reflections remain controllable. */
  window_glass: {
    name: 'glass',
    surface: 'glass',
    sheetThickness: 0.006,
    opts: {
      scale: 2.0,
      roughness: [0.3, 0.06],
      three: { opacity: 0.16, envMapIntensity: 2.1 },
    },
  },
  /** Plywood sheet nailed over a broken window. */
  plywood: {
    name: 'wood',
    surface: 'wood',
    sheetThickness: 0.018,
    opts: {
      vertexMasks: true,
      tint: 0x7a6549,
      scale: 0.62,
      normalStrength: 1.2,
      weather: [0.5, 0.45, 0.5, 0.6],
    },
  },

  // emissive
  /** Bare interior bulb. Tiny surface, so it needs real radiance to read. */
  emissive_warm: {
    name: 'plaster',
    surface: 'glass',
    opts: {
      scale: 0.4,
      tint: 0xfff0d8,
      three: { emissive: 0xffd39a, emissiveIntensity: 12, toneMapped: true },
    },
  },
  /** Whole-room glow is dimmer than the bulb; just lift the opening above window_void. */
  window_glow: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x6a5a45,
      scale: 1.2,
      three: { emissive: 0xffb066, emissiveIntensity: 1.1, toneMapped: true },
    },
  },
  /** Street-lamp diffuser. Emission is driven by time of day at runtime. */
  lamp_lens: {
    name: 'glass',
    surface: 'glass',
    opts: {
      scale: 1.0,
      three: { emissive: 0xffc47a, emissiveIntensity: 0, opacity: 0.5 },
    },
  },
} satisfies Record<
  string,
  {
    name: string;
    surface: import('../physics/surfaces.ts').SurfaceName;
    ballisticSurface?: import('../physics/surfaces.ts').SurfaceName;
    sheetThickness?: number;
    opts: Parameters<MaterialSystemNode['get']>[1];
  }
>;
