import { CONCRETE, BRICK, PLASTER, TILE } from './surfaces-arch.js';
import { ASPHALT, SAND, DIRT, GRAVEL } from './surfaces-ground.js';
import { METAL_RUST, METAL_PAINTED, METAL_BRUSHED, CORRUGATED } from './surfaces-metal.js';
import { WOOD, FABRIC, BURLAP, FOLIAGE, RUBBER, GLASS } from './surfaces-organic.js';

// Legacy WebGL bake sources, intentionally separate from the shared material
// descriptors. The strict WebGPU material library never imports this module.
export const GLSL_SURFACES = {
  concrete: CONCRETE, concrete_floor: CONCRETE, brick: BRICK, plaster: PLASTER,
  tile: TILE, asphalt: ASPHALT, sand: SAND, dirt: DIRT, gravel: GRAVEL,
  metal_rust: METAL_RUST, metal_painted: METAL_PAINTED, metal_brushed: METAL_BRUSHED,
  corrugated: CORRUGATED, wood: WOOD, fabric: FABRIC, burlap: BURLAP,
  foliage: FOLIAGE, rubber: RUBBER, glass: GLASS,
};
