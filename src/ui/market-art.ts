import type { MarketSystem } from '../market/index.ts';
import type { WeaponId } from '../weapons/defs.ts';

export type MarketItemId = ReturnType<MarketSystem['getHudState']>['items'][number]['id'];
type SupplyId = Exclude<MarketItemId, WeaponId>;

/** Offline-authored illustrations only; the market never calls a generation service. */
export const MARKET_ART: Record<SupplyId, { src: string; alt: string }> = {
  ammo: {
    src: '/images/market/ammo.webp',
    alt: 'Painted open olive ammunition tin with rifle and pistol cartridges and shotgun shells.',
  },
  grenade: {
    src: '/images/market/grenade.webp',
    alt: 'Painted olive M67 fragmentation grenade with its safety lever and pull ring intact.',
  },
  armour: {
    src: '/images/market/armour.webp',
    alt: 'Painted standalone graphite ceramic armour insert with clipped shoulder corners.',
  },
  bandage: {
    src: '/images/market/bandage.webp',
    alt: 'Painted rolled off-white field dressing with a short loose gauze tail.',
  },
  carpet: {
    src: '/images/market/carpet.webp',
    alt: 'Painted olive twin-propeller bomber representing a radio-called carpet-bomb strike.',
  },
};
