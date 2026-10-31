import { el, setText, setStyle, setClass, clamp01, damp, ease } from './util.ts';

/**
 * Health feedback: the screen-space hurt state *and* the vitals widget.
 *
 * Blood edges and desaturation scale with injury; the player pulse animates
 * the vignette. Damage also adds a brief red flash.
 *
 * Blood detail uses ordinary alpha-composited gradients. Desaturation lives
 * in the prewarmed WebGPU low-health pass, not a second full-screen CSS
 * backdrop filter; SVG displacement is particularly costly in Firefox.
 *
 * The vitals widget lives in the bottom-LEFT of the safe area — the mirror of
 * the ammo block — because it holds the most important number on the screen and
 * it has to be findable. It was previously a 90px unlabelled 4-segment bar dead
 * centre bottom, half behind the viewmodel sleeve, with a track so faint it
 * vanished over gravel: it read as leftover debug UI. Now: label, numeric
 * readout, a genuinely dark track behind the empty segments, and a visually
 * distinct armour row underneath.
 *
 * @param {HTMLElement} parent      full-screen layer for the hurt overlays
 * @param {HTMLElement} [chrome]    layer for the widget (fades with the HUD)
 */
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
export class HealthFx {
  declare bloodWrap: HTMLElement;
  declare beat: HTMLElement;
  declare flash: HTMLElement;
  declare vitals: HTMLElement;
  declare hpNum: HTMLElement;
  declare hpVal: HTMLElement;
  declare hpMax: HTMLElement;
  declare hpFill: HTMLElement;
  declare armour: HTMLElement;
  declare plates: HTMLElement[];
  declare hpShown: number;
  declare _lastHp: number;
  declare hurt: number;
  declare flashT: number;
  declare flashPeak: number;
  declare beatEnergy: number;
  declare armourShown: number;
  declare armourFlash: number;
  bloodAlpha = 0;
  bloodScale = 1;
  beatAlpha = 0;
  flashAlpha = 0;
  constructor(parent: HTMLElement, chrome: HTMLElement = parent) {
    this.bloodWrap = el('div', 'ow-blood', parent);
    el('div', 'ow-blood-a', this.bloodWrap);
    el('div', 'ow-blood-b', this.bloodWrap);
    this.beat = el('div', 'ow-lowbeat', parent);
    this.flash = el('div', 'ow-hitflash', parent);

    // ---- vitals widget ----------------------------------------------------
    this.vitals = el('div', 'ow-vitals', chrome);
    const head = el('div', 'ow-vt-head', this.vitals);
    el('div', 'ow-vt-lbl', head, 'Health');
    this.hpNum = el('div', 'ow-vt-num', head);
    this.hpVal = el('span', null, this.hpNum, '100');
    this.hpMax = el('i', null, this.hpNum, '/100');
    const track = el('div', 'ow-vt-track', this.vitals);
    this.hpFill = el('i', null, track);
    el('u', null, track); // segment dividers, drawn over the fill

    this.armour = el('div', 'ow-armour', this.vitals);
    el('div', 'ow-vt-lbl', this.armour, 'Armour');
    const plates = el('div', 'ow-arm-plates', this.armour);
    this.plates = new Array<HTMLElement>(3);
    for (let i = 0; i < 3; i++) {
      const p = el('div', 'ow-plate', plates);
      this.plates[i] = el('i', null, p);
    }

    this.hpShown = 1;
    this._lastHp = -1;
    this.hurt = 0;
    this.flashT = 1;
    this.beatEnergy = 0;
    this.armourShown = 0;
    this.armourFlash = 0; // plate strike flash, decays in update

    setStyle(this.bloodWrap, 'opacity', '0');
    setStyle(this.flash, 'opacity', '0');
    setStyle(this.beat, 'opacity', '0');
  }

  onDamage(intensity = 1): void {
    this.flashT = 0;
    this.flashPeak = 0.35 + 0.65 * clamp01(intensity);
  }

  /** Plate flash when the player's armour absorbs damage. */
  onArmour(absorbed = 1, plateBreak = false): void {
    this.armourFlash = Math.min(1, (plateBreak ? 0.85 : 0.3) + absorbed / 70);
  }

  /** @param {object} s { health, maxHealth, armour, maxArmour, hurt, pulse } */
  update(dt: number, s: HealthState, presentVitals = true, presentInjury = true): void {
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
    if (presentInjury) {
      setStyle(this.bloodWrap, 'opacity', this.bloodAlpha.toFixed(3));
      setStyle(this.bloodWrap, 'display', this.bloodAlpha < 0.004 ? 'none' : '');
      setStyle(this.bloodWrap, 'transform', `scale(${this.bloodScale.toFixed(4)})`);
      setStyle(this.beat, 'opacity', this.beatAlpha.toFixed(3));
      setStyle(this.beat, 'display', this.beatAlpha < 0.004 ? 'none' : '');
      if (flashing) setStyle(this.flash, 'opacity', this.flashAlpha.toFixed(3));
      setStyle(this.flash, 'display', flashing ? '' : 'none');
    }

    // --- vitals readout ---------------------------------------------------
    const maxH = s.maxHealth || 100;
    const hp = Math.max(0, Math.min(maxH, s.health ?? maxH));
    // the bar chases the value so a burst reads as a slide, not a jump; the
    // numeral is the truth and updates immediately
    this.hpShown = damp(this.hpShown, h, 16, dt);
    const maxA = s.maxArmour || 150;
    const armour = Math.max(0, s.armour ?? 0);
    this.armourShown = damp(this.armourShown, armour > 0 ? 1 : 0, 10, dt);
    if (this.armourShown > 0.01) this.armourFlash = Math.max(0, this.armourFlash - dt * 3.2);
    if (!presentVitals) return;
    setStyle(this.hpFill, 'transform', `scaleX(${clamp01(this.hpShown).toFixed(4)})`);
    const shownHp = Math.round(hp);
    if (shownHp !== this._lastHp) {
      this._lastHp = shownHp;
      setText(this.hpVal, shownHp);
      setText(this.hpMax, '/' + Math.round(maxH));
    }
    setClass(this.vitals, 'low', h < 0.5 && h > 0.28);
    setClass(this.vitals, 'crit', h <= 0.28);
    // the numeral pulses on the same heartbeat as the vignette
    setStyle(this.hpNum, 'transform', `scale(${(1 + this.beatEnergy * 0.05).toFixed(3)})`);

    // --- armour plates ----------------------------------------------------
    setStyle(this.armour, 'opacity', this.armourShown.toFixed(3));
    setStyle(this.armour, 'display', this.armourShown < 0.01 ? 'none' : '');
    if (this.armourShown > 0.01) {
      setStyle(
        this.armour,
        'filter',
        this.armourFlash > 0.01 ? `brightness(${(1 + this.armourFlash * 0.9).toFixed(3)})` : ''
      );
      const per = maxA / 3;
      for (let i = 0; i < 3; i++) {
        const f = clamp01((armour - i * per) / per);
        setStyle(this.plates[i], 'transform', `scaleX(${f.toFixed(3)})`);
        setStyle(this.plates[i], 'opacity', f > 0.001 ? '1' : '0');
      }
    }
  }

  dispose(): void {
    this.bloodWrap.remove();
    this.beat.remove();
    this.flash.remove();
    this.vitals.remove();
  }
}
