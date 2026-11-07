/**
 * Soldier registry and surface contracts. Blender owns geometry authoring in
 * tools/blender/soldiers/; instances share geometry and own their skeletons.
 */
import * as THREE from 'three';

import type { SoldierMaterialOptions } from './textures-tsl.ts';
import { CLOTH_TILE } from './textures.ts';

type Vec3 = [number, number, number];

/**
 * Metres of surface per texture tile. `cloth` is deliberately large: it is the
 * tile that has to carry the 0.2-0.4 m camo macro blotches, and the 1.5 mm weave
 * it can no longer resolve is supplied by the shader detail layer instead.
 */
const MATERIALS: Record<string, { tile: number }> = {
  cloth: { tile: CLOTH_TILE },
  plate: { tile: 0.42 },
  gear: { tile: 0.26 },
  // Boots and gloves share the cordura bake with the pouches but NOT its
  // roughness: leather-and-rubber footwear is markedly smoother than webbing,
  // and having the whole kit sit at one gloss makes the figure read as a blob.
  // Runtime keeps this distinction as surface data, not another material draw.
  boot: { tile: 0.26 },
  skin: { tile: 0.2 },
  polymer: { tile: 0.15 },
  steel: { tile: 0.18 },
  rubber: { tile: 0.11 },
  glass: { tile: 1.0 },
};

export { MATERIALS as SOLDIER_MATERIALS };

/** Multiply baked roughness so its relative variation remains visible.
 * Cloth, laminate and boots use separate multipliers to distinguish their specular lobes at range.
 */
const ROUGH = { cloth: 0.85 / 0.905, plate: 0.55 / 0.62, boot: 0.7 / 0.79 };

/** Detail tile size in metres — must match `bakeDetail` in textures.js. */
const DETAIL_TILE = 0.05;

/**
 * Visual variants. Each is a different silhouette, not a recolour: helmet vs
 * wrapped head, full plate vs chest rig, carbine vs long rifle.
 *
 * The three tints are hue shifts at roughly unit luminance — value is set per
 * part by the table above, so a variant can change colour family without
 * dragging every piece of its kit out of the albedo budget.
 */
export type VariantName = 'vanguard' | 'irregular' | 'breacher';
export function resolveVariantName(name: string): VariantName {
  return name === 'irregular' || name === 'breacher' ? name : 'vanguard';
}
export interface VariantDef {
  camo: string;
  clothTint: Vec3;
  gearTint: Vec3;
  plateTint: Vec3;
  skinTint: Vec3;
  helmet: boolean;
  helmetCover?: boolean;
  helmetTint?: Vec3;
  goggles: boolean;
  gogglesDown?: boolean;
  headWrap?: boolean;
  shades?: boolean;
  faceWrap?: boolean;
  maskHard?: boolean;
  beard?: boolean;
  kneePads: boolean;
  fullCarrier: boolean;
  weapon: 'carbine' | 'ak';
  bulk: number;
  scale: number;
  wide?: number;
}
export const VARIANTS: Record<VariantName, VariantDef> = {
  vanguard: {
    camo: 'arid',
    clothTint: [1.03, 1.0, 0.94],
    gearTint: [1.08, 0.98, 0.8], // coyote brown
    plateTint: [1.02, 0.96, 0.84],
    skinTint: [1.0, 0.94, 0.88],
    helmet: true,
    helmetCover: true,
    helmetTint: [0.72, 0.72, 0.68],
    goggles: true,
    gogglesDown: true,
    faceWrap: true,
    beard: false,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.0,
    scale: 1.0,
  },
  irregular: {
    camo: 'woodland',
    clothTint: [0.98, 1.02, 0.94],
    gearTint: [0.92, 0.96, 0.74], // olive drab
    plateTint: [0.9, 0.94, 0.8],
    skinTint: [0.86, 0.8, 0.74],
    helmet: false,
    headWrap: true,
    goggles: false,
    // dark wrap-around shooting glasses: the bare head needs a hard horizontal
    // dark band at the eye line or it is a featureless egg at 35 m
    shades: true,
    faceWrap: true,
    beard: true,
    kneePads: false,
    fullCarrier: false,
    weapon: 'ak',
    bulk: 0.94,
    scale: 0.985,
  },
  breacher: {
    camo: 'urban',
    clothTint: [0.98, 0.99, 1.02],
    gearTint: [0.84, 0.86, 0.9], // wolf grey
    plateTint: [0.86, 0.88, 0.92],
    skinTint: [1.06, 0.98, 0.92],
    helmet: true,
    helmetCover: false, // bare painted shell instead of a cloth cover
    helmetTint: [0.82, 0.83, 0.86],
    // goggles parked on the shell (not over the eyes like vanguard) plus a hard
    // ballistic half-mask: same helmet family, completely different head read
    goggles: true,
    gogglesDown: false,
    faceWrap: true,
    maskHard: true,
    beard: true,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.06,
    scale: 1.025,
  },
};

/**
 * Canonical authoring/GLB surface order, shared with the Blender reference.
 * All three variants use all nine. Runtime draws one material and selects each
 * finish by per-vertex surface ID, not by splitting material draws.
 */
export const MATERIAL_SLOTS = Object.freeze([
  'cloth',
  'gear',
  'boot',
  'rubber',
  'plate',
  'polymer',
  'skin',
  'glass',
  'steel',
]);

/** Keep authored finishes as data, not separate runtime draws. */
export function soldierSurface(
  name: VariantName,
  slot: string
): {
  set: string;
  options: SoldierMaterialOptions;
} {
  const V = VARIANTS[name];
  const detail = (
    set: string,
    matName: string,
    normal: number,
    rough: number
  ): { set: string; scale: number; normal: number; rough: number } => ({
    set,
    scale: MATERIALS[matName].tile / DETAIL_TILE,
    normal,
    rough,
  });
  const options = (
    set: string,
    value: SoldierMaterialOptions = {}
  ): { set: string; options: SoldierMaterialOptions } => ({ set, options: value });
  switch (slot) {
    case 'cloth':
      return options(`camo_${V.camo}`, {
        tint: V.clothTint,
        rough: ROUGH.cloth,
        metal: 1,
        // 1.15, not 1.0: the base tile now carries a 1-2 cm crease field and
        // the folds have to actually catch the key light at 25 m.
        normalScale: 1.15,
        detail: detail('cloth', 'cloth', 0.45, 0.16),
      });
    case 'plate':
      return options('plate', {
        tint: V.plateTint,
        rough: ROUGH.plate,
        normalScale: 1.0,
        detail: detail('nylon', 'plate', 0.45, 0.1),
      });
    case 'gear':
      return options('nylon', {
        tint: V.gearTint,
        normalScale: 1.1,
        detail: detail('nylon', 'gear', 0.5, 0.14),
      });
    case 'boot':
      return options('nylon', {
        tint: V.gearTint,
        rough: ROUGH.boot,
        normalScale: 1.1,
        detail: detail('nylon', 'boot', 0.5, 0.1),
      });
    case 'skin':
      return options('skin', { tint: V.skinTint, normalScale: 0.8, ao: 0.6 });
    case 'polymer':
      return options('polymer', { normalScale: 1.0 });
    case 'steel':
      return options('steel', { normalScale: 1.0 });
    case 'rubber':
      return options('rubber', { normalScale: 1.2 });
    case 'glass':
      return options('glass', {
        tint: [0.06, 0.07, 0.08],
        rough: 0.11,
        metal: 0,
        ao: 0,
        normalScale: 0,
      });
    default:
      return options('polymer');
  }
}

/** GLB groups label disjoint surfaces. Keep them for metadata, not draw splitting. */
export function prepareSoldierSurfaces(geometry: THREE.BufferGeometry): void {
  if (geometry.hasAttribute('soldierSurface')) return;
  const index = geometry.getIndex();
  if (!index) throw new Error('[ai] soldier surface labels require indexed geometry');
  const ids = new Float32Array(geometry.getAttribute('position').count).fill(-1);
  for (let slot = 0; slot < geometry.groups.length; slot++) {
    const { start, count } = geometry.groups[slot];
    for (let i = start; i < start + count; i++) {
      const vertex = index.getX(i);
      if (ids[vertex] !== -1 && ids[vertex] !== slot)
        throw new Error('[ai] soldier surfaces must not share vertices across slots');
      ids[vertex] = slot;
    }
  }
  geometry.setAttribute('soldierSurface', new THREE.BufferAttribute(ids, 1));
}
