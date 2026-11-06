import type { Renderer } from 'three/webgpu';

import { loadAX338 } from './ax338.ts';
import { isWeaponId } from './defs.ts';
import type { WeaponId } from './defs.ts';
import { loadEvolys } from './evolys.ts';
import { loadM4 } from './m4.ts';
import { loadM590 } from './m590.ts';
import { loadMCX } from './mcx.ts';
import { loadMPX } from './mpx.ts';
import { loadP320 } from './p320.ts';
import type { AuthoredModels, WeaponModelRecord } from './runtime-types.ts';

const LOADERS: {
  [K in WeaponId]: (renderer: Pick<Renderer, 'hasFeature'>) => Promise<AuthoredModels[K]>;
} = {
  rifle: loadM4,
  mcx: loadMCX,
  pistol: loadP320,
  lmg: loadEvolys,
  smg: loadMPX,
  sniper: loadAX338,
  shotgun: loadM590,
};

/** Gameplay and preview mount the same required authored assets. */
export function loadWeapon(
  id: string,
  renderer: Pick<Renderer, 'hasFeature'>
): Promise<WeaponModelRecord> {
  return isWeaponId(id)
    ? LOADERS[id](renderer)
    : Promise.reject(new Error(`[weapons] unknown weapon ${id}`));
}
