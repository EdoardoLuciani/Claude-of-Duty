import { isAttachmentConfig, isOpticId } from '../weapons/attachment-rules.ts';
import { isWeaponId } from '../weapons/defs.ts';
import type { WeaponSystem } from '../weapons/index.ts';

/** Apply opt-in URL overrides after assets load and before material warmup. */
export function applyDebugAttachments(params: URLSearchParams, weapons: WeaponSystem): void {
  if (
    !params.has('attachmentSight') &&
    !params.has('attachmentOptic') &&
    !params.has('attachmentRail') &&
    !params.has('attachmentMuzzle')
  )
    return;
  const id = params.get('attachmentWeapon') ?? 'rifle';
  const optic = params.get('attachmentOptic');
  const sight = params.get('attachmentSight');
  const selected = sight ?? optic ?? 'none';
  const rail = params.get('attachmentRail') ?? 'none';
  const muzzle = params.get('attachmentMuzzle') ?? 'none';
  const config = {
    sight: selected === 'none' ? null : selected,
    muzzle: muzzle === 'none' ? null : muzzle,
    rail: rail === 'none' ? null : rail,
  };
  if (
    (optic !== null && (sight !== null || (optic !== 'none' && !isOpticId(optic)))) ||
    !isWeaponId(id) ||
    !isAttachmentConfig(config, id) ||
    !weapons.setAttachments(id, config)
  )
    console.warn(
      `[weapons] invalid/unavailable attachment configuration: sight=${selected}, optic=${optic ?? 'none'}, rail=${rail}, muzzle=${muzzle}`
    );
}
