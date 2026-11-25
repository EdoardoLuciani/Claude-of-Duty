import { isAttachmentConfig } from '../weapons/attachment-rules.ts';
import { isWeaponId } from '../weapons/defs.ts';
import type { WeaponSystem } from '../weapons/index.ts';

/** Apply opt-in URL overrides after assets load and before material warmup. */
export function applyDebugAttachments(params: URLSearchParams, weapons: WeaponSystem): void {
  if (
    !params.has('attachmentOptic') &&
    !params.has('attachmentRail') &&
    !params.has('attachmentMuzzle') &&
    !params.has('attachmentSupport')
  )
    return;
  const id = params.get('attachmentWeapon') ?? 'rifle';
  const optic = params.get('attachmentOptic') ?? 'none';
  const rail = params.get('attachmentRail') ?? 'none';
  const support = params.get('attachmentSupport') ?? 'none';
  const muzzle = params.get('attachmentMuzzle') ?? 'none';
  const config = {
    optic: optic === 'none' ? null : optic,
    muzzle: muzzle === 'none' ? null : muzzle,
    rail: rail === 'none' ? null : rail,
    support: support === 'none' ? null : support,
  };
  if (!isWeaponId(id) || !isAttachmentConfig(config, id) || !weapons.setAttachments(id, config))
    console.warn(
      `[weapons] invalid/unavailable attachment configuration: optic=${optic}, rail=${rail}, muzzle=${muzzle}, support=${support}`
    );
}
