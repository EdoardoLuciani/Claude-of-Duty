import type { WeaponMode } from '../weapons/defs.ts';

export const MAX_PIPS = 30;

export interface AmmoState {
  ammo: number;
  magSize: number;
  reserve: number;
  weaponName?: string;
  name?: string;
  fireMode?: WeaponMode;
  reloading?: boolean;
  reloadProgress?: number;
  time?: number;
  bandages?: number;
  healing?: boolean;
  lethalCount?: number;
  cooking?: boolean;
  grenadeEquipped?: boolean;
}
export function filledMagazinePips(
  ammo: number,
  magSize: number,
  reserve: number,
  reloading: boolean,
  progress: number
): number {
  let count = ammo;
  if (reloading) {
    const after = Math.min(magSize, ammo + Math.max(0, reserve | 0));
    count = progress < 0.45 ? ammo * (1 - progress / 0.45) : after * ((progress - 0.45) / 0.55);
  }
  return count <= 0.001
    ? 0
    : Math.max(1, Math.round((count / magSize) * Math.min(MAX_PIPS, magSize)));
}

export interface EquipmentSlot {
  count: number;
  active: boolean;
  elapsed: number;
  alpha: number;
}

function updateSlot(slot: EquipmentSlot, count: number, active: boolean, dt: number): void {
  slot.elapsed = active ? (slot.active ? slot.elapsed + dt : 0) : 0;
  slot.count = count;
  slot.active = active;
  if (!active) {
    slot.alpha = count <= 0 ? 0.34 : 0.9;
    return;
  }
  // Same 280ms each way; a smooth cosine instead of solving a CSS Bezier.
  slot.alpha = 0.35 + 0.325 * (1 - Math.cos(slot.elapsed * (Math.PI / 0.28)));
}

/** Inventory pulse state; Pixi owns all presentation. */
export class AmmoPanel {
  readonly equipment: EquipmentSlot[] = Array.from({ length: 2 }, (): EquipmentSlot => ({
    count: 0,
    active: false,
    elapsed: 0,
    alpha: 0.34,
  }));
  update(dt: number, s: AmmoState, rawDt = dt): void {
    updateSlot(this.equipment[0], s.bandages ?? 0, !!s.healing, rawDt);
    updateSlot(this.equipment[1], s.lethalCount ?? 0, !!s.cooking || !!s.grenadeEquipped, rawDt);
  }
}
