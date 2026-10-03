import { asphaltSurface, dirtSurface, gravelSurface } from './tsl/ground.js';
import { concreteSurface, brickSurface, plasterSurface, tileSurface } from './tsl/arch.js';
import { metalRustSurface, metalPaintedSurface, corrugatedSurface } from './tsl/metal.js';
import { brushedMetalSurface } from './tsl/metal-brushed.js';
import { woodSurface, fabricSurface, burlapSurface } from './tsl/organic.js';
import { sandSurface } from './tsl/sand.js';
import { rubberSurface } from './tsl/rubber.js';
import { foliageSurface } from './tsl/foliage.js';
import { glassSurface } from './tsl/glass.js';

// Both concrete bakes share a graph; their seed/param/relief differ in LIBRARY.
export const SURFACES_TSL = {
  concrete: concreteSurface,
  concrete_floor: concreteSurface,
  brick: brickSurface,
  plaster: plasterSurface,
  tile: tileSurface,
  asphalt: asphaltSurface,
  sand: sandSurface,
  dirt: dirtSurface,
  gravel: gravelSurface,
  metal_rust: metalRustSurface,
  metal_painted: metalPaintedSurface,
  metal_brushed: brushedMetalSurface,
  corrugated: corrugatedSurface,
  wood: woodSurface,
  fabric: fabricSurface,
  burlap: burlapSurface,
  foliage: foliageSurface,
  rubber: rubberSurface,
  glass: glassSurface,
};

export const GENERATED_SURFACES = new Set(['concrete', 'concrete_floor', 'brick',
  'plaster', 'tile', 'asphalt', 'dirt', 'gravel', 'metal_rust', 'metal_painted',
  'corrugated', 'wood', 'fabric', 'burlap']);
