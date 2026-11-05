import { recordingUrls } from './recordings.ts';
/** Required recorded combat foley; source crops and design limits live beside the assets. */
import { clamp } from './dsp.ts';

export const COMBAT_URLS = {
  whizz: recordingUrls('combat/whizz', 5),
  'casing-concrete': recordingUrls('combat/casing-concrete', 3),
  'casing-metal': recordingUrls('combat/casing-metal', 3),
  'casing-wood': recordingUrls('combat/casing-wood', 3),
  'casing-earth': recordingUrls('combat/casing-earth', 3),
  'casing-foliage': recordingUrls('combat/casing-foliage', 2),
  'casing-soft': recordingUrls('combat/casing-soft', 3),
  'casing-water': recordingUrls('combat/casing-water', 3),
  'dry-ar': recordingUrls('combat/dry-ar', 3),
  'dry-ak': recordingUrls('combat/dry-ak', 3),
  'dry-pistol': recordingUrls('combat/dry-pistol', 3),
  'dry-smg': recordingUrls('combat/dry-smg', 3),
  'dry-bolt': recordingUrls('combat/dry-bolt', 3),
  'dry-shotgun': recordingUrls('combat/dry-shotgun', 3),
  'grenade-throw': recordingUrls('combat/grenade-throw', 3),
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
