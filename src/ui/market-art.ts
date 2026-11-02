import type { MarketSystem } from '../market/index.ts';
import type { WeaponId } from '../weapons/defs.ts';

export type MarketItemId = ReturnType<MarketSystem['getHudState']>['items'][number]['id'];
type SupplyId = Exclude<MarketItemId, WeaponId>;

// UI smoke checks also import this map directly in Node, outside Vite.
const baseUrl = import.meta.env?.BASE_URL ?? '/';

/** Offline-authored illustrations only; the market never calls a generation service. */
export const MARKET_ART: Record<SupplyId, { src: string; alt: string }> = {
  ammo: {
    src: `${baseUrl}images/market/ammo.webp`,
    alt: 'Painted open olive ammunition tin with rifle and pistol cartridges and shotgun shells.',
  },
  grenade: {
    src: `${baseUrl}images/market/grenade.webp`,
    alt: 'Painted olive M67 fragmentation grenade with its safety lever and pull ring intact.',
  },
  armour: {
    src: `${baseUrl}images/market/armour.webp`,
    alt: 'Painted standalone graphite ceramic armour insert with clipped shoulder corners.',
  },
  bandage: {
    src: `${baseUrl}images/market/bandage.webp`,
    alt: 'Painted upright off-white field dressing with a complete spiral top and a loose tail to the side.',
  },
  carpet: {
    src: `${baseUrl}images/market/carpet.webp`,
    alt: 'Painted line of bomb explosions along an empty industrial avenue, with a twin-propeller bomber overhead.',
  },
};
