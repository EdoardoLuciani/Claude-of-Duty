import { AX338Animation } from './ax338.ts';
import type { WeaponDef } from './defs.ts';
import { EvolysAnimation } from './evolys.ts';
import { M4Animation } from './m4.ts';
import { M590Animation } from './m590.ts';
import { MCXAnimation } from './mcx.ts';
import { MPXAnimation } from './mpx.ts';
import { P320Animation } from './p320.ts';
import type { WeaponAnimation, WeaponModelRecord } from './runtime-types.ts';

/** The same authored rest pose and mechanism visibility for gameplay and inspection. */
export function createWeaponAnimation(model: WeaponModelRecord, def: WeaponDef): WeaponAnimation {
  switch (model.id) {
    case 'rifle':
      return new M4Animation(model);
    case 'pistol':
      return new P320Animation(model);
    case 'lmg':
      return new EvolysAnimation(model);
    case 'smg':
      return new MPXAnimation(model);
    case 'sniper':
      return new AX338Animation(model);
    case 'shotgun':
      return new M590Animation(model);
    case 'mcx':
      return new MCXAnimation(model, def);
  }
}
