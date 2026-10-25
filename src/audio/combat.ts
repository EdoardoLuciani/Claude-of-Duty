/** Required recorded combat foley; source crops and design limits live beside the assets. */
import { clamp } from './dsp.ts';

export const COMBAT_URLS = {
  whizz: [
    new URL('./samples/combat/whizz-1.opus', import.meta.url).href,
    new URL('./samples/combat/whizz-2.opus', import.meta.url).href,
    new URL('./samples/combat/whizz-3.opus', import.meta.url).href,
    new URL('./samples/combat/whizz-4.opus', import.meta.url).href,
    new URL('./samples/combat/whizz-5.opus', import.meta.url).href,
  ],
  'casing-concrete': [
    new URL('./samples/combat/casing-concrete-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-concrete-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-concrete-3.opus', import.meta.url).href,
  ],
  'casing-metal': [
    new URL('./samples/combat/casing-metal-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-metal-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-metal-3.opus', import.meta.url).href,
  ],
  'casing-wood': [
    new URL('./samples/combat/casing-wood-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-wood-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-wood-3.opus', import.meta.url).href,
  ],
  'casing-earth': [
    new URL('./samples/combat/casing-earth-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-earth-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-earth-3.opus', import.meta.url).href,
  ],
  'casing-foliage': [
    new URL('./samples/combat/casing-foliage-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-foliage-2.opus', import.meta.url).href,
  ],
  'casing-soft': [
    new URL('./samples/combat/casing-soft-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-soft-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-soft-3.opus', import.meta.url).href,
  ],
  'casing-water': [
    new URL('./samples/combat/casing-water-1.opus', import.meta.url).href,
    new URL('./samples/combat/casing-water-2.opus', import.meta.url).href,
    new URL('./samples/combat/casing-water-3.opus', import.meta.url).href,
  ],
  'dry-ar': [
    new URL('./samples/combat/dry-ar-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-ar-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-ar-3.opus', import.meta.url).href,
  ],
  'dry-ak': [
    new URL('./samples/combat/dry-ak-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-ak-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-ak-3.opus', import.meta.url).href,
  ],
  'dry-pistol': [
    new URL('./samples/combat/dry-pistol-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-pistol-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-pistol-3.opus', import.meta.url).href,
  ],
  'dry-smg': [
    new URL('./samples/combat/dry-smg-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-smg-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-smg-3.opus', import.meta.url).href,
  ],
  'dry-bolt': [
    new URL('./samples/combat/dry-bolt-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-bolt-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-bolt-3.opus', import.meta.url).href,
  ],
  'dry-shotgun': [
    new URL('./samples/combat/dry-shotgun-1.opus', import.meta.url).href,
    new URL('./samples/combat/dry-shotgun-2.opus', import.meta.url).href,
    new URL('./samples/combat/dry-shotgun-3.opus', import.meta.url).href,
  ],
  'grenade-pin': [
    new URL('./samples/combat/grenade-pin-1.opus', import.meta.url).href,
    new URL('./samples/combat/grenade-pin-2.opus', import.meta.url).href,
    new URL('./samples/combat/grenade-pin-3.opus', import.meta.url).href,
  ],
  'grenade-throw': [
    new URL('./samples/combat/grenade-throw-1.opus', import.meta.url).href,
    new URL('./samples/combat/grenade-throw-2.opus', import.meta.url).href,
    new URL('./samples/combat/grenade-throw-3.opus', import.meta.url).href,
  ],
} as const;
export type CombatKind = keyof typeof COMBAT_URLS;
export const COMBAT_MIX = {
  whizzSend: 0.12,
  casingSend: 0.3,
  casingFlight: 0.35,
  drySend: 0.1,
  handlingSend: 0.05,
} as const;

export const CASING_BANK: Record<string, CombatKind> = {
  concrete: 'casing-concrete',
  plaster: 'casing-concrete',
  glass: 'casing-concrete',
  metal: 'casing-metal',
  wood: 'casing-wood',
  dirt: 'casing-earth',
  sand: 'casing-earth',
  foliage: 'casing-foliage',
  fabric: 'casing-soft',
  rubber: 'casing-soft',
  flesh: 'casing-soft',
  water: 'casing-water',
};

const DRY_BANK: Record<string, CombatKind> = {
  rifle: 'dry-ar',
  mcx: 'dry-ar',
  lmg: 'dry-ar',
  suppressed: 'dry-ar',
  ak: 'dry-ak',
  pistol: 'dry-pistol',
  smg: 'dry-smg',
  mpx: 'dry-smg',
  sniper: 'dry-bolt',
  shotgun: 'dry-shotgun',
};
export function dryBank(weapon = 'rifle'): CombatKind {
  return DRY_BANK[weapon] ?? 'dry-ar';
}

/** Preserve the reached-segment near-miss distance model; do not pitch-shift the take. */
export function nearMissGain(miss = 1.5): number {
  return clamp(1.1 - clamp(miss, 0.15, 6) / 6, 0.1, 1);
}
