import { createAX338Animation } from './ax338.ts';
import type { WeaponDef } from './defs.ts';
import { createEvolysAnimation } from './evolys.ts';
import { createM4Animation } from './m4.ts';
import { createM590Animation } from './m590.ts';
import { MCXAnimation } from './mcx.ts';
import { createMPXAnimation } from './mpx.ts';
import { createP320Animation } from './p320.ts';
import type { WeaponAnimation, WeaponModelRecord } from './runtime-types.ts';

/** The same authored rest pose and mechanism visibility for gameplay and inspection. */
export function createWeaponAnimation(model: WeaponModelRecord, def: WeaponDef): WeaponAnimation {
  switch (model.id) {
    case 'rifle':
      return createM4Animation(model);
    case 'pistol':
      return createP320Animation(model);
    case 'lmg':
      return createEvolysAnimation(model);
    case 'smg':
      return createMPXAnimation(model);
    case 'sniper':
      return createAX338Animation(model);
    case 'shotgun':
      return createM590Animation(model);
    case 'mcx':
      return new MCXAnimation(model, def);
  }
}
