import { AX338Animation } from './ax338.ts';
import { EvolysAnimation } from './evolys.ts';
import { M4Animation } from './m4.ts';
import { M590Animation } from './m590.ts';
import { MCXAnimation } from './mcx.ts';
import { MPXAnimation } from './mpx.ts';
import { P320Animation } from './p320.ts';
import { isWeaponAdapter } from './runtime-types.ts';
import type { WeaponAnimation, WeaponDef, WeaponModelRecord } from './runtime-types.ts';

/** The same authored rest pose and mechanism visibility for gameplay and inspection. */
export function createWeaponAnimation(model: WeaponModelRecord, def: WeaponDef): WeaponAnimation {
  const animation: WeaponAnimation | null = isWeaponAdapter(model, 'rifle')
    ? new M4Animation(model)
    : isWeaponAdapter(model, 'pistol')
      ? new P320Animation(model)
      : isWeaponAdapter(model, 'lmg')
        ? new EvolysAnimation(model)
        : isWeaponAdapter(model, 'smg')
          ? new MPXAnimation(model)
          : isWeaponAdapter(model, 'sniper')
            ? new AX338Animation(model)
            : isWeaponAdapter(model, 'shotgun')
              ? new M590Animation(model)
              : isWeaponAdapter(model, 'mcx')
                ? new MCXAnimation(model, def)
                : null;
  if (!animation) throw new Error(`[weapons] unsupported authored weapon ${model.id}`);
  return animation;
}
