/**
 * Player-activated bandage: inventory, hold-to-heal timer, cancel/complete.
 *
 * Gameplay state is authoritative. The viewmodel follows progress and must
 * never award health on its own. One bandage is consumed only when the hold
 * completes; every cancel resets progress and keeps the item.
 */

import { HEALING } from './tuning.js';

export class HealController {
  constructor(player) {
    this.player = player;
    this.bandages = HEALING.startCount;
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
    this._wrapSoundT = 0;
    this._payload = {
      phase: 'start', amount: 0, health: 0, bandages: HEALING.startCount, reason: '',
    };
  }

  reset() {
    this.cancel('reset');
    this.bandages = HEALING.startCount;
  }

  /** @returns {number} bandages actually added */
  add(n) {
    const want = Math.max(0, Math.floor(n));
    if (want <= 0) return 0;
    const before = this.bandages;
    this.bandages = Math.min(HEALING.maxCount, this.bandages + want);
    return this.bandages - before;
  }

  fillHud(h) {
    h.bandages = this.bandages;
    h.maxBandages = HEALING.maxCount;
    h.healing = this.active;
    h.healProgress = this.active ? this.progress : 0;
    h.regen = false;
  }

  canStart() {
    const p = this.player;
    const hp = p.health;
    if (this.active) return false;
    if (!p.controlEnabled || hp.dead) return false;
    if (hp.value >= hp.max - 0.01) return false;
    if (this.bandages <= 0) return false;
    if (p.sprinting || p.tacticalSprint || p.sliding || p.mantling || p.airborne) return false;
    return true;
  }

  tryStart() {
    if (!this.canStart()) {
      this._deny();
      return false;
    }
    const wp = this.player.ctx.peek('weapons');
    if (wp?.canBeginHeal && !wp.canBeginHeal()) {
      this._deny();
      return false;
    }
    if (wp?.beginHeal && !wp.beginHeal()) {
      this._deny();
      return false;
    }
    this.active = true;
    this.progress = 0;
    this.elapsed = 0;
    this._wrapSoundT = 0;
    wp?.setHealProgress?.(0);
    this._sfx('heal_start', 0.85);
    this._emit('start');
    return true;
  }

  cancel(reason = 'cancel') {
    if (!this.active) return false;
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
    this._wrapSoundT = 0;
    this.player.ctx.peek('weapons')?.endHeal?.();
    if (reason !== 'reset') this._sfx('heal_cancel', 0.45);
    this._emit('cancel', 0, reason);
    return true;
  }

  complete() {
    if (!this.active) return false;
    const hp = this.player.health;
    if (hp.dead) {
      this.cancel('dead');
      return false;
    }
    const applied = hp.heal(HEALING.amount);
    this.bandages = Math.max(0, this.bandages - 1);
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
    this._wrapSoundT = 0;
    this.player.ctx.peek('weapons')?.endHeal?.();
    this._sfx('heal_complete', 0.9);
    this._emit('complete', applied, 'complete');
    return true;
  }

  update(dt) {
    const p = this.player;
    const input = p.ctx.input;
    const live =
      p.controlEnabled &&
      !p.health.dead &&
      input &&
      !input.frozen &&
      input.enabled !== false;

    if (this.active) {
      if (!live) {
        this.cancel('interrupt');
        return;
      }
      if (!input.action('heal')) {
        this.cancel('release');
        return;
      }
      if (this._motionCancel()) {
        this.cancel('move');
        return;
      }
      this.elapsed += dt;
      this.progress = Math.min(1, HEALING.duration > 0 ? this.elapsed / HEALING.duration : 1);
      p.ctx.peek('weapons')?.setHealProgress?.(this.progress);
      this._wrapSoundT -= dt;
      if (this._wrapSoundT <= 0) {
        this._wrapSoundT = 0.38;
        this._sfx('heal_wrap', 0.55);
      }
      if (this.progress >= 1) this.complete();
      return;
    }

    if (live && input.actionPressed?.('heal')) this.tryStart();
  }

  _motionCancel() {
    const p = this.player;
    return p.sprinting || p.tacticalSprint || p.sliding || p.mantling || p.airborne || !!p.movement?.jumped;
  }

  _deny() {
    this._sfx('heal_deny', 0.7);
  }

  _sfx(id, gain) {
    const audio = this.player.ctx.peek('audio');
    audio?.playUi?.(id, gain);
  }

  _emit(phase, amount = 0, reason = '') {
    const p = this._payload;
    p.phase = phase;
    p.amount = amount;
    p.health = this.player.health.value;
    p.bandages = this.bandages;
    p.reason = reason;
    this.player.ctx.events.emit('player:heal', p);
  }
}
