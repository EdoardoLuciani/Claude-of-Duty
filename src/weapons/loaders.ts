import { loadAX338 } from './ax338.ts';
import { loadEvolys } from './evolys.ts';
import { loadM4 } from './m4.ts';
import { loadM590 } from './m590.ts';
import { loadMCX } from './mcx.ts';
import { loadMPX } from './mpx.ts';
import { loadP320 } from './p320.ts';
import type { WeaponModelRecord } from './runtime-types.ts';

const LOADERS: Record<string, () => Promise<WeaponModelRecord>> = {
  rifle: loadM4,
  mcx: loadMCX,
  pistol: loadP320,
  lmg: loadEvolys,
  smg: loadMPX,
  sniper: loadAX338,
  shotgun: loadM590,
};

/** Gameplay and preview mount the same required authored assets. */
export function loadWeapon(id: string): Promise<WeaponModelRecord> {
  return Object.hasOwn(LOADERS, id)
    ? LOADERS[id]()
    : Promise.reject(new Error(`[weapons] unknown weapon ${id}`));
}
