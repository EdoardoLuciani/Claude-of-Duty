import { concreteSurface, brickSurface, plasterSurface, tileSurface } from './tsl/arch.ts';
import { foliageSurface } from './tsl/foliage.ts';
import { glassSurface } from './tsl/glass.ts';
import { asphaltSurface, dirtSurface, gravelSurface } from './tsl/ground.ts';
import { brushedMetalSurface } from './tsl/metal-brushed.ts';
import { metalRustSurface, metalPaintedSurface, corrugatedSurface } from './tsl/metal.ts';
import { woodSurface, fabricSurface, burlapSurface } from './tsl/organic.ts';
import { rubberSurface } from './tsl/rubber.ts';
import { sandSurface } from './tsl/sand.ts';

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

const GENERATED_NAMES = [
  'concrete',
  'concrete_floor',
  'brick',
  'plaster',
  'tile',
  'asphalt',
  'dirt',
  'gravel',
  'metal_rust',
  'metal_painted',
  'corrugated',
  'wood',
  'fabric',
  'burlap',
] as const;
export const GENERATED_SURFACES = new Set<string>(GENERATED_NAMES);
export function isGeneratedSurface(
  name: keyof typeof SURFACES_TSL
): name is (typeof GENERATED_NAMES)[number] {
  return GENERATED_SURFACES.has(name);
}
