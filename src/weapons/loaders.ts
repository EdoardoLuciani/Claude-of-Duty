import type { Renderer } from 'three/webgpu';

import { loadAX338 } from './ax338.ts';
import { isWeaponId, WEAPON_DEFS } from './defs.ts';
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
export async function loadWeapon(
  id: string,
  renderer: Pick<Renderer, 'hasFeature'>
): Promise<WeaponModelRecord> {
  if (!isWeaponId(id)) throw new Error(`[weapons] unknown weapon ${id}`);
  const model = await LOADERS[id](renderer);
  // Fail this weapon's load, not the batch it is mounted with.
  for (const [slot, fits] of Object.entries(WEAPON_DEFS[id].fits ?? {}))
    if (Object.keys(fits).length > 0 && !model.root.getObjectByName(`MOUNT_${slot}`))
      throw new Error(`[weapons] ${id} accepts ${slot} attachments but has no MOUNT_${slot}`);
  return model;
}
