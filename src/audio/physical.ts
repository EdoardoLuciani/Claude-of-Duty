import type { FoleyKind } from './foley-urls.ts';

/** Explicit related-material mappings; source/design limits are intentional related-material approximations. */
export const IMPACT_BANK: Record<string, FoleyKind> = {
  concrete: 'impact-concrete',
  plaster: 'impact-concrete',
  metal: 'impact-metal',
  wood: 'impact-wood',
  dirt: 'impact-dirt',
  sand: 'impact-sand',
  glass: 'impact-glass',
  water: 'impact-water',
  foliage: 'impact-foliage',
  fabric: 'impact-fabric',
  rubber: 'impact-rubber',
};
const concrete = { walk: 'step-concrete-walk', run: 'step-concrete-run' } as const;
const fabric = { walk: 'step-fabric-walk', run: 'step-fabric-run' } as const;
export const STEP_BANK: Record<string, { walk: FoleyKind; run: FoleyKind }> = {
  concrete,
  plaster: concrete,
  metal: { walk: 'step-metal-walk', run: 'step-metal-run' },
  wood: { walk: 'step-wood-walk', run: 'step-wood-run' },
  dirt: { walk: 'step-dirt-walk', run: 'step-dirt-run' },
  sand: { walk: 'step-sand-walk', run: 'step-sand-run' },
  foliage: { walk: 'step-grass-walk', run: 'step-grass-run' },
  glass: { walk: 'step-glass-walk', run: 'step-glass-run' },
  fabric,
  rubber: fabric,
  flesh: fabric,
  water: fabric,
};
export const FALL_BANK: Record<string, FoleyKind> = {
  concrete: 'fall-hard',
  plaster: 'fall-hard',
  metal: 'fall-hard',
  glass: 'fall-hard',
  wood: 'fall-wood',
  dirt: 'fall-earth',
  sand: 'fall-earth',
  foliage: 'fall-grass',
  fabric: 'fall-soft',
  rubber: 'fall-soft',
  flesh: 'fall-soft',
  water: 'fall-water',
};
export const FOLEY_MIX = {
  impact: 1,
  plaster: 0.8,
  step: 1,
  gait: { walk: 0.62, run: 1, sprint: 1.25, crouch: 0.42, land: 1.3 } as Record<string, number>,
  // Fixed surface references measured through the normal graph, not per-event normalization.
  stepLevel: {
    'step-concrete-walk': 1.3,
    'step-concrete-run': 1.55,
    'step-metal-walk': 0.76,
    'step-metal-run': 0.73,
    'step-wood-walk': 0.85,
    'step-wood-run': 0.82,
    'step-dirt-walk': 1.5,
    'step-grass-walk': 0.83,
    'step-grass-run': 0.57,
    'step-sand-walk': 1.28,
    'step-sand-run': 1.2,
  } as Partial<Record<FoleyKind, number>>,
  gear: { walk: 0.25, run: 0.7, sprint: 1, crouch: 0.08, land: 1 } as Record<string, number>,
  gearLevel: 0.45,
  splashLevel: 0.65,
  cloth: 0.85,
  fall: 1.25,
  impactSend: 0.25,
  stepSend: 0.3,
  clothSend: 0.2,
  fallSend: 0.4,
} as const;
export interface FoleyOptions {
  when?: number;
  surface?: string;
  gait?: string;
  level?: number;
  gear?: number;
}
