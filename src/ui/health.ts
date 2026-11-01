import { clamp01, damp, ease } from './util.ts';

export interface HealthState {
  health?: number;
  maxHealth?: number;
  armour?: number;
  maxArmour?: number;
  hurt?: number;
  pulse?: number;
  healing?: boolean;
  healProgress?: number;
}
/** Injury/vitals animation state; the player remains the heartbeat-clock owner. */
export class HealthFx {
  hpShown = 1;
  hurt = 0;
  flashT = 1;
  flashPeak = 1;
  beatEnergy = 0;
  armourShown = 0;
  armourFlash = 0;
  bloodAlpha = 0;
  bloodScale = 1;
  beatAlpha = 0;
  flashAlpha = 0;
  onDamage(intensity = 1): void {
    this.flashT = 0;
    this.flashPeak = 0.35 + 0.65 * clamp01(intensity);
  }

  /** Plate flash when the player's armour absorbs damage. */
  onArmour(absorbed = 1, plateBreak = false): void {
    this.armourFlash = Math.min(1, (plateBreak ? 0.85 : 0.3) + absorbed / 70);
  }

  /** @param {object} s { health, maxHealth, armour, maxArmour, hurt, pulse } */
  update(dt: number, s: HealthState): void {
    const h = clamp01((s.health ?? 100) / (s.maxHealth || 100));
    const targetHurt = s.hurt !== undefined ? clamp01(s.hurt) : clamp01((0.78 - h) / 0.78) ** 1.3;
    this.hurt = damp(this.hurt, targetHurt, 7, dt);
    const hurt = this.hurt;

    // The player owns the heartbeat clock; the HUD only renders its pulse.
    this.beatEnergy = damp(this.beatEnergy, clamp01(s.pulse ?? 0), 18, dt);

    const healPulse = s.healing ? 0.08 * (s.healProgress ?? 0) : 0;

    this.bloodAlpha = clamp01(hurt * 1.4 + this.beatEnergy * 0.16);
    this.bloodScale = 1 + this.beatEnergy * 0.022 + healPulse * 0.12;
    this.beatAlpha = clamp01(this.beatEnergy * 0.55);
    const flashing = this.flashT < 1;
    if (flashing) this.flashT = Math.min(1, this.flashT + dt / 0.19);
    this.flashAlpha = flashing ? (this.flashPeak ?? 1) * (1 - ease.outQuad(this.flashT)) * 0.8 : 0;
    // --- vitals readout ---------------------------------------------------
    // the bar chases the value so a burst reads as a slide, not a jump; the
    // numeral is the truth and updates immediately
    this.hpShown = damp(this.hpShown, h, 16, dt);
    const armour = Math.max(0, s.armour ?? 0);
    this.armourShown = damp(this.armourShown, armour > 0 ? 1 : 0, 10, dt);
    if (this.armourShown > 0.01) this.armourFlash = Math.max(0, this.armourFlash - dt * 3.2);
  }
}
