import assert from 'node:assert/strict';

import type { WeaponId } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import type { WeaponState } from '../../src/weapons/runtime-types.ts';

/** A real weapon system whose selected state is checked before each access. */
export class ArmedWeaponSystem extends WeaponSystem {
  override get state(): WeaponState {
    const state = super.state;
    assert(state, `missing weapon state for ${this.activeId}`);
    return state;
  }

  override get current(): NonNullable<WeaponSystem['current']> {
    const current = super.current;
    assert(current, `missing weapon definition for ${this.activeId}`);
    return current;
  }
}

export function weaponState(wp: WeaponSystem, id: WeaponId): WeaponState {
  const state = wp.states.get(id);
  assert(state, `missing weapon state for ${id}`);
  return state;
}
